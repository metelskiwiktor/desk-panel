// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import {
  reviewMaterials, runRybka, fetchTaskSpec, isTaskId, parseRybkaArgs,
  validReport, formatReportHeader, splitReportComments, AGY_MODEL, CLAUDE_MODEL, MODEL,
} from './rybka.mjs';

const dirs = [];
const goodReport = 'BLOKUJĄCE:\nbrak uwag blokujących\n\nROZMIAR: adekwatny';
it('preserves report whitespace through API trimming and respects UTF-16 and JSON byte limits', () => {
  const report = ' \n\t' + ('ą😀"\\\n   '.repeat(1800)) + '\r\n\t ';
  const parts = splitReportComments(report);
  expect(parts.length).toBeGreaterThan(2);
  const saved = parts.map(text => text.trim());
  for (const text of saved) {
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(Buffer.byteLength(JSON.stringify({ action: 'addComment', task: 't-12345678', by: 'codex', text }))).toBeLessThanOrEqual(4096);
  }
  const restored = saved.map(text => text.slice(text.indexOf('<!-- rybka:start -->\n') + '<!-- rybka:start -->\n'.length, text.lastIndexOf('\n<!-- rybka:end -->'))).join('');
  expect(restored).toBe(report);
});
afterEach(() => { vi.useRealTimers(); for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });
function fixture(attachments = 'docs/mock.html') {
  const dir = mkdtempSync(join(tmpdir(), 'dp-rybka-')); dirs.push(dir);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'spec.md'), `CEL:\nNowy widok.\nPOZA ZAKRESEM:\nZałączniki do zadań i docs/nie-czytaj.md.\nZAŁĄCZNIKI:\n${attachments}\n`);
  writeFileSync(join(dir, 'AGENTS.md'), 'Zasady repo.');
  writeFileSync(join(dir, 'role.md'), '---\nname: rybka\n---\nRecenzujesz specyfikację. BLOKUJĄCE: DROBNE: ROZMIAR:');
  writeFileSync(join(dir, 'docs/mock.html'), '<h1>Makieta</h1>');
  return dir;
}
function setup(overrides = {}) {
  const cwd = fixture(); const child = new EventEmitter(); child.pid = 4242;
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  const calls = [], printed = [], configs = [];
  const options = { specPath: 'spec.md', runner: 'opencode', cwd, rolePath: join(cwd, 'role.md'), log: line => printed.push(line),
    env: { SECRET_TOKEN: 'do-not-print', OPENCODE_CONFIG_CONTENT: 'host-inline' },
    execImpl: (command, args, opts) => {
      configs.push(opts.env.OPENCODE_CONFIG_CONTENT);
      return opts.env.OPENCODE_CONFIG_CONTENT ?? JSON.stringify({ permission: { read: { '*': 'ask' }, custom: 'allow' }, mcp: { host: { enabled: true } } });
    },
    spawnImpl: (...args) => { calls.push(args); return child; },
    killTree: () => child.emit('close', null), ...overrides };
  return { cwd, child, calls, printed, configs, options };
}
function event(child, frame) { child.stdout.write(JSON.stringify(frame) + '\n'); }
function report(child, text = goodReport) {
  event(child, { type: 'text', part: { text } });
  event(child, { type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { input: 10, output: 4, reasoning: 2, total: 16 } } });
}

it('reads only the spec, AGENTS and explicit attachments once, including prose and backticks', () => {
  const cwd = fixture('`docs/mock.html`; AGENTS.md; docs/mock.html. To załącznik.');
  const result = reviewMaterials('spec.md', cwd);
  expect(result.reads).toBe(3);
  expect(result.materials.map(m => m.path)).toEqual(['AGENTS.md', 'docs/mock.html']);
});

it('refuses escaped paths, credentials, links outside the repo, and excessive input before spawning', async () => {
  const cwd = fixture('../outside.md');
  expect(() => reviewMaterials('spec.md', cwd)).toThrow(/poza repo/);
  writeFileSync(join(cwd, 'spec.md'), 'ZAŁĄCZNIKI:\nauth.json');
  expect(() => reviewMaterials('spec.md', cwd)).toThrow(/poufny/);
  const outside = fixture();
  symlinkSync(join(outside, 'docs'), join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(cwd, 'spec.md'), 'ZAŁĄCZNIKI:\nlinked/mock.html');
  expect(() => reviewMaterials('spec.md', cwd)).toThrow(/dowiązania/);
  const files = Array.from({ length: 11 }, (_, i) => `docs/${i}.md`);
  for (const file of files) writeFileSync(join(cwd, file), 'x');
  writeFileSync(join(cwd, 'spec.md'), 'ZAŁĄCZNIKI:\n' + files.join('\n'));
  expect(() => reviewMaterials('spec.md', cwd)).toThrow(/limit 12/);
  writeFileSync(join(cwd, 'spec.md'), 'x'.repeat(200_001));
  expect(() => reviewMaterials('spec.md', cwd)).toThrow(/200000/);
});

it('uses a fresh pinned review with only explicit file reads and preserves separate private files', async () => {
  const f = setup(); const done = runRybka(f.options);
  report(f.child); f.child.emit('close', 0); const result = await done;
  expect(result.ok).toBe(true);
  expect(f.calls).toHaveLength(1);
  const [command, args, opts] = f.calls[0];
  expect(command).toBe('opencode');
  expect(args).toContain('--pure');
  expect(args).not.toContain('--session');
  expect(args.at(-1)).toBe(readFileSync(join(f.cwd, 'spec.md'), 'utf8'));
  const config = JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT);
  expect(config.model).toBe('openrouter/deepseek/deepseek-v4.1-flash-1017');
  expect(config.small_model).toBe(config.model);
  expect(Object.entries(config.permission).filter(([k]) => k !== 'read').every(([, v]) => v === 'deny')).toBe(true);
  expect(config.permission.read['*']).toBe('deny');
  expect(config.permission.read[join(f.cwd, 'AGENTS.md')]).toBe('allow');
  expect(config.permission.read[join(f.cwd, 'docs/mock.html')]).toBe('allow');
  expect(config.permission.read[join(f.cwd, 'spec.md')]).toBeUndefined();
  expect(config.mcp.host.enabled).toBe(false);
  expect(Object.values(config.agent)[0].model).toBe(config.model);
  expect(Object.values(config.agent)[0]).not.toHaveProperty('steps');
  expect(Object.values(config.agent)[0].prompt).toContain(join(f.cwd, 'docs/mock.html'));
  expect(Object.values(config.agent)[0].prompt).toContain('Recenzujesz specyfikację');
  expect(Object.values(config.agent)[0].prompt).not.toContain('name: rybka');
  expect(Object.values(config.agent)[0].prompt).not.toContain('<h1>Makieta</h1>');
  expect(opts.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX).toBe('64000');
  expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  expect(f.configs[0]).toBeUndefined();
  expect(readFileSync(result.reportPath, 'utf8')).toContain('brak uwag');
  expect(readFileSync(result.reportPath, 'utf8')).toContain('# Przegląd specyfikacji: spec.md');
  expect(readFileSync(result.reportPath, 'utf8')).toContain('- Model: openrouter/deepseek/deepseek-v4.1-flash-1017');
  expect(JSON.parse(readFileSync(join(result.dir, 'report-comments.json'), 'utf8'))).toEqual(splitReportComments(readFileSync(result.reportPath, 'utf8')));
  expect(result.metrics).toMatchObject({ eventCount: 2, fileReads: 3, firstTokenMs: null, totalTokens: 16 });
  expect(f.printed.join('\n')).not.toContain('do-not-print');
  const second = setup(); second.options.cwd = f.cwd;
  const again = runRybka(second.options); report(second.child); second.child.emit('close', 0);
  expect((await again).dir).not.toBe(result.dir);
  expect(existsSync(result.reportPath)).toBe(true);
});

it('fails closed before a model call if resolved MCP or permissions remain enabled', async () => {
  const f = setup({ execImpl: () => JSON.stringify({ mcp: { host: { enabled: true } } }) });
  expect(await runRybka(f.options)).toMatchObject({ ok: false, reason: 'configuration-error' });
  expect(f.calls).toHaveLength(0);
});

it.each([
  ['empty', 'no-report'], ['partial', 'incomplete-report'], ['max-steps', 'incomplete-report'], ['length', 'length'], ['provider', 'provider-error'], ['exit', 'process-error'], ['tool', 'unexpected-tool'],
])('does not mistake %s output for a successful report', async (kind, reason) => {
  const f = setup(); const done = runRybka(f.options);
  // Authentic live failure: the provider ended normally after reasoning, with zero visible output tokens.
  if (kind === 'empty') {
    event(f.child, { type: 'reasoning', part: { type: 'reasoning', text: 'Private reasoning is not a final report.' } });
    event(f.child, { type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { output: 0, reasoning: 231 } } });
  }
  if (kind === 'partial') report(f.child, 'Niejasność: jedno pole');
  if (kind === 'max-steps') report(f.child, 'I reached the maximum number of steps. I did not finish the review. Required fields:\n- Niejasność\n- Niezapisane założenie\n- Wpływ na wykonanie\n- Pytanie');
  if (kind === 'length') {
    event(f.child, { type: 'text', part: { text: 'Niejasność: ucięty raport przez limit tokenów wyjścia...' } });
    event(f.child, { type: 'step_finish', part: { type: 'step-finish', reason: 'length', tokens: { output: 64000 } } });
  }
  if (kind === 'provider') event(f.child, { type: 'error', error: { message: 'provider failed' } });
  if (kind === 'tool') event(f.child, { type: 'tool_use', part: { tool: 'bash' } });
  if (kind === 'exit') f.child.stderr.write('private diagnostic');
  f.child.emit('close', kind === 'exit' ? 3 : 0);
  const result = await done;
  expect(result).toMatchObject({ ok: false, code: 1, reason, reportPath: null });
  expect(existsSync(join(result.dir, 'report.md'))).toBe(false);
});

it.each([['timeout', 100, 1000], ['idle-timeout', 1000, 100]])('reports progress and kills its own tree on %s', async (reason, wallMs, idleMs) => {
  vi.useFakeTimers();
  const f = setup(); const killed = [];
  const done = runRybka({ ...f.options, wallMs, idleMs, progressMs: 15, killTree: child => { killed.push(child.pid); child.emit('close', null); } });
  await vi.advanceTimersByTimeAsync(101);
  expect(await done).toMatchObject({ ok: false, reason, code: 124 });
  expect(killed).toEqual([4242]);
  expect(f.printed.some(line => /zdarzenia=0.*narzędzie=brak.*pozostało=/.test(line))).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('resets idle only for events, decodes split UTF-8, and accepts a complete four-field report', async () => {
  vi.useFakeTimers(); const f = setup();
  const done = runRybka({ ...f.options, wallMs: 1000, idleMs: 100 });
  await vi.advanceTimersByTimeAsync(80);
  event(f.child, { type: 'step_start' });
  await vi.advanceTimersByTimeAsync(80);
  const text = 'BLOKUJĄCE:\n1. Niejasność: A\nNiezapisane założenie: B\nWpływ na wykonanie: C\nPytanie: D?\n\nROZMIAR: adekwatny';
  const raw = Buffer.from(JSON.stringify({ type: 'text', part: { text } }) + '\n');
  const cut = raw.indexOf(Buffer.from('ś')) + 1;
  f.child.stdout.write(raw.subarray(0, cut)); f.child.stdout.write(raw.subarray(cut));
  event(f.child, { type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } });
  f.child.emit('close', 0);
  const result = await done;
  expect(result.ok).toBe(true);
  expect(readFileSync(result.reportPath, 'utf8')).toContain('Niejasność');
});

it('stderr chatter and unfinished JSON cannot keep a stalled model alive', async () => {
  vi.useFakeTimers(); const f = setup();
  const done = runRybka({ ...f.options, wallMs: 1000, idleMs: 100 });
  await vi.advanceTimersByTimeAsync(80);
  f.child.stderr.write('still starting');
  f.child.stdout.write('{"type":');
  await vi.advanceTimersByTimeAsync(21);
  expect(await done).toMatchObject({ reason: 'idle-timeout', code: 124 });
});

it('shows cumulative tokens including cache and warns near one million without inventing current-step usage', async () => {
  vi.useFakeTimers(); const f = setup();
  const done = runRybka({ ...f.options, progressMs: 15 });
  await vi.advanceTimersByTimeAsync(16);
  expect(f.printed.some(line => line.includes('tokeny=n/d'))).toBe(true);
  event(f.child, { type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', tokens: { total: 450_000, input: 50_000, cache: { read: 400_000 } } } });
  event(f.child, { type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', tokens: { total: 400_000, input: 50_000, cache: { read: 350_000 } } } });
  expect(f.printed.some(line => line.includes('tokeny=850000 (cache=750000; zakończone kroki)'))).toBe(true);
  expect(f.printed.filter(line => line.includes('UWAGA'))).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(16);
  expect(f.printed.filter(line => line.includes('UWAGA'))).toHaveLength(1);
  report(f.child); f.child.emit('close', 0);
  expect((await done).metrics.totalTokens).toBe(850_016);
});

it('allows bounded read calls and stops after the thirteenth, without accepting a report', async () => {
  const f = setup(); const done = runRybka(f.options);
  for (let i = 0; i < 12; i++) event(f.child, { type: 'tool_use', part: { tool: 'read' } });
  event(f.child, { type: 'tool_use', part: { tool: 'read' } });
  expect(await done).toMatchObject({ ok: false, reason: 'read-limit', metrics: { modelReads: 13 } });
});

it('fetches the whole multiline spec and revision by task ID, rejecting empty spec or 404', async () => {
  const spec = [
    'CEL:', 'Pełne zadanie po ID.', '',
    'ZAKRES:', 'Plik testowy.', '',
    'POZA ZAKRESEM:', 'Zmiany UI.', '',
    'DECYZJE:', '- Zachować całość.', '',
    'WARUNKI ODBIORU:', '1. Końcowa część też trafia do rybki.', '',
    'WYKONAWCA:', 'cezar', '',
    'REPO:', 'desk-panel', '',
    'TRYB:', 'implementacja', '',
    'ZAŁĄCZNIKI:', '`AGENTS.md`',
  ].join('\n');
  const validTaskView = [
    'Zadanie z listy użytkownika...',
    '  [ ] t-00c6c30f  Zadanie testowe (2026-11-02)',
    '    Stan: przygotowanie (przygotowanie)',
    '    Specyfikacja (v4, agent, 2026-11-02 12:00):',
    spec,
    '    Komentarz (2026-11-02 12:05, agent): Pierwszy komentarz',
  ].join('\n');

  const fetchSuccess = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => validTaskView,
  });

  const parsed = await fetchTaskSpec('t-00c6c30f', { fetchImpl: fetchSuccess });
  expect(parsed.taskId).toBe('t-00c6c30f');
  expect(parsed.revision).toBe(4);
  expect(parsed.spec).toBe(spec);
  // End of the view without comments is true EOF, not the first end-of-line; Windows CRLF also works.
  const noComments = validTaskView.slice(0, validTaskView.indexOf('\n    Komentarz'));
  const atEof = await fetchTaskSpec('t-00c6c30f', { fetchImpl: async () => ({ ok: true, text: async () => noComments.replaceAll('\n', '\r\n') }) });
  expect(atEof.spec).toBe(spec.replaceAll('\n', '\r\n'));

  const emptyTaskView = [
    'Zadanie z listy użytkownika...',
    '  [ ] t-00c6c30f  Zadanie bez specyfikacji',
    '    Specyfikacja: Brak specyfikacji',
  ].join('\n');

  const fetchEmpty = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => emptyTaskView,
  });

  await expect(fetchTaskSpec('t-00c6c30f', { fetchImpl: fetchEmpty })).rejects.toThrow(
    /Zadanie t-00c6c30f nie ma specyfikacji \(„Brak specyfikacji”\)/
  );

  const fetch404 = vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => 'Nie ma zadania',
  });

  await expect(fetchTaskSpec('t-00c6c30f', { fetchImpl: fetch404 })).rejects.toThrow(
    /Błąd pobierania zadania t-00c6c30f \(404\)/
  );
});

it('parses CLI arguments for task ID or file path and runner selection with both as default', () => {
  expect(isTaskId('t-00c6c30f')).toBe(true);
  expect(isTaskId('spec.md')).toBe(false);

  expect(parseRybkaArgs(['t-00c6c30f'])).toEqual({ specPath: 't-00c6c30f', runner: 'both' });
  expect(parseRybkaArgs(['spec.md', '--runner', 'claude'])).toEqual({ specPath: 'spec.md', runner: 'claude' });
  expect(parseRybkaArgs(['spec.md', '--runner', 'agy'])).toEqual({ specPath: 'spec.md', runner: 'agy' });
  expect(parseRybkaArgs(['spec.md', '--runner=opencode'])).toEqual({ specPath: 'spec.md', runner: 'opencode' });
  expect(parseRybkaArgs(['--help'])).toEqual({ help: true });

  expect(() => parseRybkaArgs([])).toThrow(/Wymagany argument SPEC/);
  expect(() => parseRybkaArgs(['spec.md', '--runner', 'invalid'])).toThrow(/Nieprawidłowy runner: invalid/);
  expect(() => parseRybkaArgs(['spec.md', 'extra.md'])).toThrow(/Zbyt wiele argumentów/);
});

it('runs agy runner without tool permissions, with inlined materials, stream-json protocol and header', async () => {
  const cwd = fixture();
  const child = new EventEmitter();
  child.pid = 5050;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();

  let capturedStdin = '';
  child.stdin.on('data', chunk => { capturedStdin += chunk.toString(); });

  const calls = [];
  const printed = [];
  const options = {
    specPath: 'spec.md',
    runner: 'agy',
    cwd,
    rolePath: join(cwd, 'role.md'),
    log: line => printed.push(line),
    spawnImpl: (...args) => { calls.push(args); return child; },
    killTree: () => child.emit('close', null),
  };

  const done = runRybka(options);

  expect(calls).toHaveLength(1);
  const [bin, args] = calls[0];
  expect(bin).toMatch(/agy(\.exe)?$/);
  expect(args).toContain('--model');
  expect(args).toContain(AGY_MODEL);
  expect(args).toContain('--output-format');
  expect(args).toContain('stream-json');
  expect(args).toContain('--input-format');
  expect(args).not.toContain('--dangerously-skip-permissions');

  expect(capturedStdin).toContain('Recenzujesz specyfikację');
  expect(capturedStdin).toContain('Recenzujesz specyfikację');
  expect(capturedStdin).not.toContain('name: rybka');
  expect(capturedStdin).toContain('--- Plik referencyjny: AGENTS.md ---');
  expect(capturedStdin).toContain('--- Plik referencyjny: docs/mock.html ---');
  expect(capturedStdin).toContain('<h1>Makieta</h1>');
  expect(capturedStdin).toContain('Specyfikacja do recenzji:');

  // Stream agy frames
  child.stdout.write(JSON.stringify({ event: 'init', init: { model: AGY_MODEL } }) + '\n');
  child.stdout.write(JSON.stringify({
    event: 'step_update',
    step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: goodReport }
  }) + '\n');
  child.stdout.write(JSON.stringify({
    event: 'result',
    result: {
      status: 'SUCCESS',
      response: goodReport,
      usage: { input_tokens: 1500, output_tokens: 25, total_tokens: 1525 }
    }
  }) + '\n');
  child.emit('close', 0);

  const result = await done;
  expect(result.ok).toBe(true);
  expect(result.metrics.model).toBe(AGY_MODEL);
  expect(result.metrics.totalTokens).toBe(1525);
  expect(result.metrics.costUsd).toBeNull();

  const reportContent = readFileSync(result.reportPath, 'utf8');
  expect(reportContent).toContain('# Przegląd specyfikacji: spec.md');
  expect(reportContent).toContain('- Zadanie: plik');
  expect(reportContent).toContain('- Rewizja: brak');
  expect(reportContent).toContain(`- Model: ${AGY_MODEL}`);
  expect(reportContent).toContain('brak uwag');
});

it('runs both runners in parallel, each creating its own directory under .ai/rybka-runs/', async () => {
  const cwd = fixture();
  const children = [];
  const calls = [];
  const inputs = [];

  const spawnImpl = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.pid = 6000 + calls.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const index = children.length;
    inputs[index] = '';
    child.stdin.on('data', chunk => { inputs[index] += chunk.toString(); });
    children.push(child);
    return child;
  };

  const done = runRybka({
    specPath: 'spec.md',
    runner: 'both',
    cwd,
    rolePath: join(cwd, 'role.md'),
    log: () => {},
    spawnImpl,
    killTree: child => child.emit('close', null),
    execImpl: (cmd, args, opts) => opts.env.OPENCODE_CONFIG_CONTENT ?? JSON.stringify({ permission: { read: { '*': 'ask' } }, mcp: {} }),
  });

  // Both should have been spawned
  expect(calls).toHaveLength(2);
  const [claudeCall, agyCall] = calls;
  expect(claudeCall[0]).toBe('claude');
  expect(agyCall[0]).toMatch(/agy(\.exe)?$/);

  const [claudeChild, agyChild] = children;

  // Emit report on Claude
  event(claudeChild, { type: 'result', subtype: 'success', result: goodReport });
  claudeChild.emit('close', 0);

  // Emit report on agy
  agyChild.stdout.write(JSON.stringify({
    event: 'result',
    result: { status: 'SUCCESS', response: goodReport, usage: { total_tokens: 200 } }
  }) + '\n');
  agyChild.emit('close', 0);

  const result = await done;
  expect(result.ok).toBe(true);
  expect(result.results).toHaveLength(2);
  const [claudeRes, agyRes] = result.results;

  expect(claudeRes.ok).toBe(true);
  expect(agyRes.ok).toBe(true);
  expect(claudeRes.dir).not.toBe(agyRes.dir);
  expect(claudeRes.dir).toContain('-claude-');
  expect(agyRes.dir).toContain('-agy-');
  expect(existsSync(claudeRes.reportPath)).toBe(true);
  const claudeReport = readFileSync(claudeRes.reportPath, 'utf8');
  expect(claudeReport).toContain(`- Model: ${CLAUDE_MODEL}`);
  expect(JSON.parse(readFileSync(join(claudeRes.dir, 'report-comments.json'), 'utf8'))).toEqual(splitReportComments(claudeReport));
  expect(inputs[0]).toContain('Recenzujesz specyfikację');
  expect(inputs[0]).not.toContain('name: rybka');
  expect(inputs[0]).toContain('<h1>Makieta</h1>');
  expect(inputs[0]).toContain(readFileSync(join(cwd, 'spec.md'), 'utf8'));
  expect(JSON.parse(inputs[1]).message.content).toBe(inputs[0]);
  expect(existsSync(agyRes.reportPath)).toBe(true);
});

it('handles task ID in runRybka, writing task ID and revision in report headers', async () => {
  const cwd = fixture();
  const child = new EventEmitter();
  child.pid = 7070;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();

  const mockTaskView = [
    'Zadanie...',
    '    Specyfikacja (v2, agent, 2026-11-02 11:00):',
    'CEL: Zadanie z nagłówkiem rev.',
    'ZAŁĄCZNIKI: AGENTS.md',
  ].join('\n');

  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => mockTaskView,
  });

  const done = runRybka({
    specPath: 't-00c6c30f',
    runner: 'opencode',
    cwd,
    rolePath: join(cwd, 'role.md'),
    log: () => {},
    fetchImpl,
    spawnImpl: () => child,
    execImpl: (cmd, args, opts) => opts.env.OPENCODE_CONFIG_CONTENT ?? JSON.stringify({ permission: { read: { '*': 'ask' } }, mcp: {} }),
  });

  setImmediate(() => {
    report(child);
    child.emit('close', 0);
  });

  const result = await done;
  expect(result.ok).toBe(true);
  const saved = readFileSync(result.reportPath, 'utf8');
  expect(saved).toContain('# Przegląd specyfikacji: t-00c6c30f');
  expect(saved).toContain('- Zadanie: t-00c6c30f');
  expect(saved).toContain('- Rewizja: v2');
  expect(saved).toContain(`- Model: ${MODEL}`);
  expect(saved).toContain('brak uwag');
});

it('validReport accepts reports with headers and rejects incomplete reports', () => {
  const header = formatReportHeader({
    taskId: 't-00c6c30f',
    revision: 3,
    model: 'gemini-3.8-flash-high',
  });

  expect(validReport(header + '\n' + goodReport)).toBe(true);

  const issueReport = [
    header,
    'BLOKUJĄCE:',
    '1. Niejasność: brak opisu błędu',
    'Niezapisane założenie: zakładamy status 400',
    'Wpływ na wykonanie: niejednoznaczna implementacja',
    'Pytanie: czy 400 czy 422?',
    'ROZMIAR: za duży: wydzielić drugi widok',
  ].join('\n');
  expect(validReport(issueReport)).toBe(true);

  const incompleteReport = [
    header,
    'Niejasność: tylko jedno pole',
  ].join('\n');
  expect(validReport(incompleteReport)).toBe(false);
});


it('reads the role at startup and fails before spawning if it is missing', async () => {
  const f = setup();
  await expect(runRybka({ ...f.options, rolePath: join(f.cwd, 'missing.md') })).rejects.toThrow(/skill.*Nie uruchomiono modeli/);
  expect(f.calls).toHaveLength(0);
});

it.each(['empty', 'partial', 'length', 'tool', 'provider', 'exit', 'unfinished'])('rejects unsuccessful Claude output: %s', async kind => {
  const f = setup({ runner: 'claude' }); const done = runRybka(f.options);
  const [, args, opts] = f.calls[0];
  expect(args).toEqual(expect.arrayContaining(['--model', CLAUDE_MODEL, '--effort', 'medium', '--tools', '', '--strict-mcp-config']));
  expect(opts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
  if (kind === 'tool') event(f.child, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } });
  else if (kind !== 'unfinished') event(f.child, { type: 'result', subtype: kind === 'provider' ? 'error_during_execution' : 'success',
    result: kind === 'empty' ? '' : kind === 'partial' ? 'BLOKUJĄCE:\nbrak uwag blokujących' : goodReport,
    stop_reason: kind === 'length' ? 'max_tokens' : 'end_turn' });
  f.child.emit('close', kind === 'exit' ? 1 : 0);
  expect((await done).ok).toBe(false);
});

it('requires a complete skill verdict, including every blocking issue', () => {
  for (const text of ['', 'brak uwag', 'BLOKUJĄCE:\nbrak uwag blokujących', goodReport.replace('adekwatny', 'za duży:'),
    'BLOKUJĄCE:\n1. Niejasność: A / Niezapisane założenie: B / Wpływ na wykonanie: C / Pytanie: D?\n2. Niejasność: urwane\nROZMIAR: adekwatny']) expect(validReport(text)).toBe(false);
  expect(validReport('**BLOKUJĄCE:**\nbrak uwag blokujących\n\n**DROBNE:**\n- Nazwa.\n\n**ROZMIAR:** adekwatny')).toBe(true);
});
