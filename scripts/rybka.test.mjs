// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { reviewMaterials, runRybka } from './rybka.mjs';

const dirs = [];
afterEach(() => { vi.useRealTimers(); for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });
function fixture(attachments = 'docs/mock.html') {
  const dir = mkdtempSync(join(tmpdir(), 'dp-rybka-')); dirs.push(dir);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'spec.md'), `CEL:\nNowy widok.\nPOZA ZAKRESEM:\nZałączniki do zadań i docs/nie-czytaj.md.\nZAŁĄCZNIKI:\n${attachments}\n`);
  writeFileSync(join(dir, 'AGENTS.md'), 'Zasady repo.');
  writeFileSync(join(dir, 'docs/mock.html'), '<h1>Makieta</h1>');
  return dir;
}
function setup(overrides = {}) {
  const cwd = fixture(); const child = new EventEmitter(); child.pid = 4242;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const calls = [], printed = [], configs = [];
  const options = { specPath: 'spec.md', cwd, log: line => printed.push(line),
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
function report(child, text = 'brak uwag') {
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
  expect(Object.values(config.agent)[0].prompt).not.toContain('<h1>Makieta</h1>');
  expect(opts.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX).toBe('64000');
  expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  expect(f.configs[0]).toBeUndefined();
  expect(readFileSync(result.reportPath, 'utf8')).toBe('brak uwag\n');
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
  const text = 'Niejasność: A\nNiezapisane założenie: B\nWpływ na wykonanie: C\nPytanie: D?';
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
