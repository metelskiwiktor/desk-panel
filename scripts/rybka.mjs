// Local specification review: fresh session, explicit reference files, bounded read-only tools.
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { killProcessTree, metricsFromEvents, MODEL, parseEventLine } from './executor-run.mjs';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
const ROLE_PATH = 'C:/Tabularium/skills/rybka/SKILL.md';

export const AGY_MODEL = 'gemini-3.8-flash-high';
export { MODEL };

/** Markers keep boundary whitespace inside the comment when the API trims its outer whitespace. */
export function splitReportComments(report) {
  const parts = [];
  let chunk = '';
  const wrap = (text, index, total) => `Przegląd rybki — część ${String(index).padStart(6, '0')}/${String(total).padStart(6, '0')}\n<!-- rybka:start -->\n${text}\n<!-- rybka:end -->`;
  const fits = text => {
    const body = { action: 'addComment', task: 't-00000000', by: 'codex', text: wrap(text, 999999, 999999) };
    return body.text.length <= 2000 && Buffer.byteLength(JSON.stringify(body), 'utf8') <= 4096;
  };
  for (const char of report) {
    if (!fits(chunk + char)) { parts.push(chunk); chunk = ''; }
    chunk += char;
  }
  if (chunk) parts.push(chunk);
  return parts.map((text, i) => wrap(text, i + 1, parts.length));
}

function saveReport(reportPath, text) {
  writeFileSync(reportPath, text, { mode: 0o600 });
  writeFileSync(join(resolve(reportPath, '..'), 'report-comments.json'), JSON.stringify(splitReportComments(text), null, 2) + '\n', { mode: 0o600 });
}

const WALL_MS = 10 * 60_000;
// JSON CLI emits a reasoning/text block only when it ends (pilot 1 needed 218 s for a block).
// Leave room for a longer single-block review; the independent 10-minute wall limit remains.
const IDLE_MS = 8 * 60_000;
const MAX_FILES = 12;
const MAX_CHARS = 200_000;
const SECRET = /(?:^|\/)(?:\.env[^/]*|panel\.env|auth\.json|private\.pem|[^/]*token[^/]*|[^/]*\.dpapi)(?:$|\/)/i;
function readRole(path) {
  let text;
  try { text = readFileSync(path, 'utf8').replace(/^\uFEFF/, ''); }
  catch { throw Error(`Nie można odczytać skilla rybka: ${path}. Nie uruchomiono modeli.`); }
  const role = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
  if (!role) throw Error(`Pusty skill rybka: ${path}. Nie uruchomiono modeli.`);
  return role;
}

export function isTaskId(value) {
  return typeof value === 'string' && /^t-[0-9a-f]{8}$/i.test(value.trim());
}

/** Fetches current specification revision from desk-panel agent API. */
export async function fetchTaskSpec(taskId, { baseUrl = process.env.DESK_PANEL_URL || 'http://127.0.0.1:5174', fetchImpl = globalThis.fetch } = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/agent/todos?zadanie=${encodeURIComponent(taskId)}`;
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw Error(`Nie udało się pobrać zadania ${taskId}: ${error.message}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw Error(`Błąd pobierania zadania ${taskId} (${response.status}): ${text.trim() || response.statusText}`);
  }
  const text = await response.text();
  if (/^\s*Specyfikacja:\s*Brak specyfikacji\s*$/m.test(text)) {
    throw Error(`Zadanie ${taskId} nie ma specyfikacji („Brak specyfikacji”).`);
  }
  // With /m, `$` also matches the end of the first spec line. The final alternative must mean true EOF.
  const match = text.match(/^\s*Specyfikacja\s*\((?:v(\d+))[^)]*\):\r?\n([\s\S]*?)(?=\r?\n[ \t]+Komentarz[ \t]*\(|(?![\s\S]))/m);
  if (!match) {
    throw Error(`Zadanie ${taskId} nie ma specyfikacji („Brak specyfikacji”).`);
  }
  const revision = Number(match[1]);
  const spec = match[2].trim();
  if (!spec) {
    throw Error(`Zadanie ${taskId} nie ma specyfikacji („Brak specyfikacji”).`);
  }
  return { taskId, revision, spec };
}

/** Locate the agy executable locally. */
export function agyExecutable(env = process.env, home = homedir()) {
  if (env.DESK_AGY_BIN) return env.DESK_AGY_BIN;
  const bin = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = [
    join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'agy', 'bin', bin),
    join(home, '.agy', 'bin', bin),
    join(home, '.local', 'bin', bin),
  ];
  return candidates.find(existsSync) ?? bin;
}

/** Inlines materials into the single user prompt for agy (which runs without tools). */
export function buildAgyPrompt(role, materials, spec, cwd) {
  const fileBlocks = materials.map(m => {
    const abs = resolve(cwd, m.path);
    const text = readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    return `--- Plik referencyjny: ${m.path} ---\n${text}`;
  });
  return [
    role,
    '',
    'Materiały referencyjne (wklejone poniżej; nie używaj narzędzi, wszystkie materiały masz w tej wiadomości):',
    fileBlocks.join('\n\n'),
    '',
    'Specyfikacja do recenzji:',
    spec,
  ].join('\n');
}

/** Read only explicitly named, local text files. No following links outside the repo or opening credentials. */
export function reviewMaterials(specPath, cwd = process.cwd(), { spec: providedSpec } = {}) {
  const root = realpathSync(cwd);
  const checked = path => {
    const lexical = resolve(root, path);
    const inside = candidate => {
      const rel = relative(root, candidate);
      return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
    };
    if (!inside(lexical) || SECRET.test(relative(root, lexical).replaceAll('\\', '/'))) throw Error('Plik poza repo lub plik poufny.');
    const actual = realpathSync(lexical);
    if (!inside(actual) || SECRET.test(relative(root, actual).replaceAll('\\', '/'))) throw Error('Niedozwolony cel dowiązania.');
    if (!statSync(actual).isFile()) throw Error('Materiał nie jest plikiem.');
    return actual;
  };
  let spec = providedSpec;
  let specFile = null;
  if (spec === undefined) {
    specFile = checked(specPath);
    if (statSync(specFile).size > MAX_CHARS * 4) throw Error('Specyfikacja jest za duża.');
    spec = readFileSync(specFile, 'utf8').replace(/^\uFEFF/, '');
  }
  if (!spec.trim()) throw Error('Brak specyfikacji.');
  if (spec.length > MAX_CHARS) throw Error(`Materiały przekraczają ${MAX_CHARS} znaków.`);
  const attachments = spec.match(/^ZAŁĄCZNIKI(?:[ \t]*:[ \t]*|[ \t]*\r?$)([\s\S]*)/mi)?.[1] ?? '';
  // Explicit repo paths, with or without backticks. Directories/globs/URLs are not attachment files.
  const names = [...attachments.matchAll(/(?<![\w:/\\.-])(?:[\w.-]+\/)*[\w.-]+\.(?:md|txt|html|css|ts|tsx|js|mjs|json|yaml|yml)\b/g)].map(m => m[0]);
  const files = [...new Set([...(specFile ? [specFile] : []), checked('AGENTS.md'), ...names.map(checked)])];
  const totalCount = specFile ? files.length : files.length + 1;
  if (totalCount > MAX_FILES) throw Error(`Za dużo materiałów: ${totalCount}; limit ${MAX_FILES} plików łącznie ze specyfikacją i AGENTS.md.`);
  let chars = spec.length;
  const materials = [];
  for (const file of files) {
    if (file === specFile) continue;
    if (statSync(file).size > MAX_CHARS * 4) throw Error('Za duży plik materiału.');
    const text = readFileSync(file, 'utf8');
    chars += text.length;
    if (chars > MAX_CHARS) throw Error(`Materiały przekraczają ${MAX_CHARS} znaków.`);
    materials.push({ path: relative(root, file).replaceAll('\\', '/') });
  }
  if (chars > MAX_CHARS) throw Error(`Materiały przekraczają ${MAX_CHARS} znaków.`);
  return { spec, materials, reads: totalCount };
}

/** Suppress inherited asks and MCP; permit only the enumerated reads, with all other tools denied. */
function configuration(host, agent, materials, cwd, role) {
  const permission = { ...Object.fromEntries(Object.keys(host.permission ?? {}).map(key => [key, 'deny'])), '*': 'deny' };
  permission.read = { '*': 'deny' };
  for (const material of materials) {
    const absolute = resolve(cwd, material.path);
    for (const name of [material.path, absolute, absolute.replaceAll('\\', '/')]) permission.read[name] = 'allow';
  }
  return { model: MODEL, small_model: MODEL, permission,
    mcp: Object.fromEntries(Object.keys(host.mcp ?? {}).map(key => [key, { enabled: false }])),
    // steps:1 injects OpenCode's MAX_STEPS_PROMPT as an assistant prefill on the very first request.
    // Bound reads and time instead: any steps limit eventually injects the unrelated assistant prefill.
    agent: { [agent]: { mode: 'primary', description: 'Przegląd samodzielnej specyfikacji', model: MODEL,
      permission, prompt: role + '\n\nDozwolone pliki:\n' + materials.map(m => '- ' + resolve(cwd, m.path)).join('\n') } } };
}

function configuredEnv(env, agent, materials, cwd, role, exec = execFileSync) {
  const childEnv = { ...env, OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' };
  delete childEnv.OPENCODE_CONFIG_CONTENT;
  const resolved = () => JSON.parse(exec('opencode', ['debug', 'config', '--pure'], {
    cwd, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 20 * 1024 * 1024,
  }));
  const host = resolved();
  const config = configuration(host, agent, materials, cwd, role);
  childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  const effective = resolved();
  const actualAgent = effective.agent?.[agent];
  if (Object.values(effective.mcp ?? {}).some(m => m.enabled !== false)
    || effective.model !== MODEL || effective.small_model !== MODEL
    || !actualAgent || actualAgent.model !== MODEL || actualAgent.steps !== undefined
    || actualAgent.prompt !== config.agent[agent].prompt
    || JSON.stringify(effective.permission) !== JSON.stringify(config.permission)
    || JSON.stringify(actualAgent.permission) !== JSON.stringify(config.permission)) throw Error('Nie potwierdzono ograniczeń konfiguracji.');
  return childEnv;
}

export function formatReportHeader({ taskId, revision, model, specPath }) {
  return [
    `# Przegląd specyfikacji: ${taskId ?? specPath}`,
    `- Zadanie: ${taskId ?? 'plik'}`,
    `- Rewizja: ${revision !== null && revision !== undefined ? `v${revision}` : 'brak'}`,
    `- Model: ${model}`,
    '',
  ].join('\n');
}

export function validReport(text) {
  const stripped = text.replace(/^# Przegląd specyfikacji:.*?\n(?:- [^\n]+\n)*\r?\n?/s, '').trim();
  // Markdown emphasis/headings are presentation; the skill defines section names and verdict.
  const plain = stripped.replace(/\*\*/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^```(?:text)?\s*$/gm, '').trim();
  const match = plain.match(/^BLOKUJĄCE:[ \t]*\n([\s\S]*?)\n(?:DROBNE:[ \t]*\n[\s\S]*?\n)?ROZMIAR:[ \t]*(adekwatny[.!]?|za duży:[ \t]*\S[^\n]*)\s*$/i);
  if (!match) return false;
  const blocking = match[1].trim();
  if (/^[„"']?brak uwag blokujących[”"']?[.!]?$/i.test(blocking)) return true;
  const issues = blocking.split(/(?=^\d+[.)]\s)/m).map(s => s.trim()).filter(Boolean);
  if (!issues.length || issues.length > 5) return false;
  return issues.every(issue => /^\d+[.)]\s/.test(issue) &&
    /^\d+[.)]\s+Niejasność:\s*\S[\s\S]*?Niezapisane założenie:\s*\S[\s\S]*?Wpływ na wykonanie:\s*\S[\s\S]*?Pytanie:\s*\S/i.test(issue));
}

const REASONS = {
  completed: 'raport gotowy — oceń go z użytkownikiem', timeout: 'timeout: przekroczono limit całkowity',
  'idle-timeout': 'zawieszenie bez zdarzeń: przekroczono limit ciszy', 'provider-error': 'błąd dostawcy zgłoszony w zdarzeniu',
  'process-error': 'błąd procesu runnera (szczegóły w prywatnym stderr)',
  length: 'ucięcie odpowiedzi przez limit długości (stopReason: length)',
  'no-report': 'brak raportu lub zakończenia tury',
  'incomplete-report': 'niekompletny raport: brakuje wymaganych pól', 'unexpected-tool': 'niedozwolone wywołanie narzędzia',
  'read-limit': 'przekroczono limit 12 odczytów modelu',
  'configuration-error': 'błąd konfiguracji: nie uruchomiono modelu', cancelled: 'przerwano na żądanie',
};

/** Executes a review run using a single runner ('claude', 'agy' or 'opencode'). */
async function runRybkaOne({ runner = 'opencode', specPath, spec, taskId = null, revision = null, materials, reads, role,
  cwd = process.cwd(), env = process.env, wallMs = WALL_MS, idleMs = IDLE_MS,
  progressMs = 15_000, spawnImpl = spawn, execImpl = execFileSync, killTree = killProcessTree,
  log = console.log, now = Date.now } = {}) {
  const model = runner === 'agy' ? AGY_MODEL : runner === 'claude' ? CLAUDE_MODEL : MODEL;
  const started = now();
  const dir = join(cwd, '.ai', 'rybka-runs', new Date(started).toISOString().replace(/[:.]/g, '-') + '-' + runner + '-' + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const jsonlPath = join(dir, 'events.jsonl'), stderrPath = join(dir, 'stderr.log'), reportPath = join(dir, 'report.md');
  writeFileSync(jsonlPath, '', { mode: 0o600 });
  writeFileSync(stderrPath, '', { mode: 0o600 });
  writeFileSync(join(dir, 'spec.md'), spec, { mode: 0o600 });
  const header = formatReportHeader({ taskId, revision, model, specPath });

  if (runner === 'opencode') {
    const agent = 'rybka-' + process.pid + '-' + randomUUID().slice(0, 4);
    log(`Rybka (${runner}): ${reads}/12 plików sprawdzonych; model może czytać tylko wskazane materiały (maks. 12 odczytów). Konfiguracja (maks. 2 × 15 s).`);
    let childEnv;
    try { childEnv = configuredEnv(env, agent, materials, cwd, role, execImpl); }
    catch {
      writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ ok: false, reason: 'configuration-error',
        model, runner, durationMs: now() - started, fileReads: reads, eventCount: 0 }, null, 2) + '\n', { mode: 0o600 });
      log(`Rybka (${runner}): ${REASONS['configuration-error']}.`);
      return { ok: false, code: 1, reason: 'configuration-error', dir, runner };
    }
    return new Promise(resolveResult => {
      const events = [];
      let buffer = '', ending, settled = false, child, wallTimer, idleTimer, progressTimer, forceTimer;
      let firstEventMs = null, firstTextMs = null, lastTool = 'brak', usageWarning = false, modelReads = 0;
      const usageLabel = metrics => {
        const costStr = metrics.costUsd !== null && metrics.costUsd !== undefined ? `$${metrics.costUsd.toFixed(4)}` : 'brak danych';
        return `tokeny=${metrics.totalTokens ?? 'n/d'} (cache=${metrics.cacheReadTokens ?? 'n/d'}; zakończone kroki); koszt=${costStr}`;
      };
      const progress = () => {
        if (settled) return;
        const metrics = metricsFromEvents(events);
        log(`Rybka (${runner}): zdarzenia=${events.length}; ostatnie narzędzie=${lastTool}; ${usageLabel(metrics)}; pozostało=${Math.max(0, Math.ceil((wallMs - (now() - started)) / 1000))} s`);
        if (!usageWarning && (metrics.totalTokens ?? 0) >= 800_000) {
          usageWarning = true;
          log(`Rybka (${runner}): UWAGA — zużycie zbliża się do miliona: ${metrics.totalTokens} tokenów łącznie z cache.`);
        }
      };
      const finish = code => {
        if (settled) return;
        settled = true;
        for (const timer of [wallTimer, idleTimer, progressTimer, forceTimer]) clearTimeout(timer);
        process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
        const metrics = metricsFromEvents(events);
        const report = events.filter(e => e.type === 'text').map(e => e.part?.text ?? '').join('\n').trim();
        const reason = ending ?? (metrics.errors ? 'provider-error' : code !== 0 ? 'process-error'
          : metrics.stopReason === 'length' ? 'length'
          : !metrics.completed || !report ? 'no-report' : !validReport(report) ? 'incomplete-report' : 'completed');
        const ok = reason === 'completed';
        const record = { reason, ok, model, runner, startedAt: new Date(started).toISOString(), durationMs: now() - started,
          eventCount: events.length, lastEventAt: events.at(-1)?.timestamp ?? null, lastTool, fileReads: reads, modelReads,
          firstEventMs, firstTextMs, firstTokenMs: null, exitCode: code, ...metrics };
        writeFileSync(join(dir, 'metrics.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
        if (ok) saveReport(reportPath, header + '\n' + report + '\n');
        else if (report) writeFileSync(join(dir, 'partial-report.md'), header + '\n' + report + '\n', { mode: 0o600 });
        log(`Rybka (${runner}): ${REASONS[reason]}. Zdarzenia: ${events.length}; ${usageLabel(metrics)}; czas: ${Math.round(record.durationMs / 1000)} s.`);
        log(`Rybka (${runner}): ${ok ? reportPath : dir}`);
        resolveResult({ ok, code: ok ? 0 : ['timeout', 'idle-timeout'].includes(reason) ? 124 : 1, reason, dir, reportPath: ok ? reportPath : null, metrics: record, runner });
      };
      const stop = reason => {
        if (settled || ending) return;
        ending = reason;
        try { killTree(child); } catch { /* Still settle if the process cannot be reaped. */ }
        if (!settled) forceTimer = setTimeout(() => finish(null), 10_000);
      };
      const cancel = () => stop('cancelled');
      const resetIdle = () => {
        clearTimeout(idleTimer);
        if (!settled && !ending) idleTimer = setTimeout(() => stop('idle-timeout'), idleMs);
      };
      const consume = line => {
        if (!line.trim()) return;
        appendFileSync(jsonlPath, line + '\n');
        const event = parseEventLine(line);
        if (!event || event.type === 'unparsed') return;
        events.push(event);
        firstEventMs ??= now() - started;
        if (event.type === 'text') firstTextMs ??= now() - started;
        resetIdle();
        if (event.type === 'step_finish') progress();
        if (event.type === 'error') stop('provider-error');
        if (event.type === 'tool_use') {
          lastTool = event.part?.tool ?? 'nieznane';
          if (lastTool !== 'read') stop('unexpected-tool');
          else if (++modelReads > 12) stop('read-limit');
        }
      };
      try {
        child = spawnImpl('opencode', ['run', '--pure', '--agent', agent, '--model', model, '--format', 'json', '--', spec],
          { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch { finish(1); return; }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while (!settled && (index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); consume(line);
        }
      });
      child.stderr.on('data', chunk => appendFileSync(stderrPath, chunk));
      child.on('error', () => finish(1));
      child.on('close', code => { if (!settled && buffer.trim()) consume(buffer); finish(code); });
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      wallTimer = setTimeout(() => stop('timeout'), Math.max(1, wallMs - (now() - started)));
      resetIdle();
      progressTimer = setInterval(progress, progressMs);
      log(`Rybka (${runner}): model ${model}; limit 10 min, bez zdarzeń 8 min; postęp co 15 s.`);
    });
  }

  // Claude and agy receive role and materials in a single prompt, without tools.
  log(`Rybka (${runner}): ${reads}/12 materiałów wklejonych do promptu; model bez narzędzi.`);
  const prompt = buildAgyPrompt(role, materials, spec, cwd);
  const bin = runner === 'claude' ? 'claude' : agyExecutable(env);

  return new Promise(resolveResult => {
    const events = [];
    let buffer = '', ending, settled = false, child, wallTimer, idleTimer, progressTimer, forceTimer;
    let firstEventMs = null, firstTextMs = null, usageWarning = false;
    let accumulatedText = '', finalResponse = null;
    let inputTokens = null, outputTokens = null, totalTokens = null, reasoningTokens = null, cacheReadTokens = null;
    let costUsd = null, completed = false, stopReason = null;

    const currentMetrics = () => ({
      inputTokens, outputTokens, totalTokens, reasoningTokens, cacheReadTokens,
      cacheWriteTokens: null, cacheTokens: cacheReadTokens, costUsd,
      steps: 1, errors: ending === 'provider-error' ? 1 : 0, textLength: (finalResponse || accumulatedText).length,
      completed, stopReason: stopReason ?? (completed ? 'stop' : null),
    });

    const usageLabel = metrics => {
      const costStr = metrics.costUsd !== null && metrics.costUsd !== undefined ? `$${metrics.costUsd.toFixed(4)}` : 'brak danych';
      return `tokeny=${metrics.totalTokens ?? 'n/d'} (cache=${metrics.cacheReadTokens ?? 'n/d'}; zakończone kroki); koszt=${costStr}`;
    };

    const progress = () => {
      if (settled) return;
      const metrics = currentMetrics();
      log(`Rybka (${runner}): zdarzenia=${events.length}; ostatnie narzędzie=brak; ${usageLabel(metrics)}; pozostało=${Math.max(0, Math.ceil((wallMs - (now() - started)) / 1000))} s`);
      if (!usageWarning && (metrics.totalTokens ?? 0) >= 800_000) {
        usageWarning = true;
        log(`Rybka (${runner}): UWAGA — zużycie zbliża się do miliona: ${metrics.totalTokens} tokenów łącznie z cache.`);
      }
    };

    const finish = code => {
      if (settled) return;
      settled = true;
      for (const timer of [wallTimer, idleTimer, progressTimer, forceTimer]) clearTimeout(timer);
      process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
      const metrics = currentMetrics();
      const report = (finalResponse || accumulatedText).trim();
      const reason = ending ?? (metrics.errors ? 'provider-error' : code !== 0 ? 'process-error'
        : metrics.stopReason === 'length' ? 'length'
        : !metrics.completed || !report ? 'no-report' : !validReport(report) ? 'incomplete-report' : 'completed');
      const ok = reason === 'completed';
      const record = { reason, ok, model, runner, startedAt: new Date(started).toISOString(), durationMs: now() - started,
        eventCount: events.length, lastEventAt: null, lastTool: 'brak', fileReads: reads, modelReads: 0,
        firstEventMs, firstTextMs, firstTokenMs: null, exitCode: code, ...metrics };
      writeFileSync(join(dir, 'metrics.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      if (ok) saveReport(reportPath, header + '\n' + report + '\n');
      else if (report) writeFileSync(join(dir, 'partial-report.md'), header + '\n' + report + '\n', { mode: 0o600 });
      log(`Rybka (${runner}): ${REASONS[reason]}. Zdarzenia: ${events.length}; ${usageLabel(metrics)}; czas: ${Math.round(record.durationMs / 1000)} s.`);
      log(`Rybka (${runner}): ${ok ? reportPath : dir}`);
      resolveResult({ ok, code: ok ? 0 : ['timeout', 'idle-timeout'].includes(reason) ? 124 : 1, reason, dir, reportPath: ok ? reportPath : null, metrics: record, runner });
    };

    const stop = reason => {
      if (settled || ending) return;
      ending = reason;
      try { killTree(child); } catch { /* Still settle if the process cannot be reaped. */ }
      if (!settled) forceTimer = setTimeout(() => finish(null), 10_000);
    };
    const cancel = () => stop('cancelled');
    const resetIdle = () => {
      clearTimeout(idleTimer);
      if (!settled && !ending) idleTimer = setTimeout(() => stop('idle-timeout'), idleMs);
    };

    const consume = line => {
      if (!line.trim()) return;
      appendFileSync(jsonlPath, line + '\n');
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (!ev || typeof ev !== 'object') return;
      events.push(ev);
      firstEventMs ??= now() - started;
      resetIdle();

      if (ev.type === 'tool_use' || ev.type === 'tool_call' || ev.message?.content?.some?.(p => p.type === 'tool_use')) {
        stop('unexpected-tool');
        return;
      }
      if (runner === 'claude') {
        if (ev.type === 'assistant') {
          const parts = ev.message?.content ?? [];
          accumulatedText += parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
          if (accumulatedText) firstTextMs ??= now() - started;
          if (ev.message?.stop_reason === 'max_tokens') stopReason = 'length';
        }
        if (ev.type === 'result') {
          finalResponse = typeof ev.result === 'string' ? ev.result : null;
          if (finalResponse) firstTextMs ??= now() - started;
          const u = ev.usage ?? {};
          inputTokens = u.input_tokens ?? null; outputTokens = u.output_tokens ?? null;
          cacheReadTokens = u.cache_read_input_tokens ?? null;
          totalTokens = inputTokens === null ? null : inputTokens + (outputTokens ?? 0) + (cacheReadTokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          costUsd = ev.total_cost_usd ?? null;
          if (ev.stop_reason === 'max_tokens' || ev.subtype === 'error_max_tokens') stopReason = 'length';
          completed = ev.subtype === 'success' && !ev.is_error;
          if (!completed && !stopReason) stop('provider-error');
        }
        if (ev.type === 'error' || ev.error) stop('provider-error');
        return;
      }
      if (ev.event === 'permission_request') {
        stop('unexpected-tool');
        return;
      }
      if (ev.event === 'error' || ev.error) {
        stop('provider-error');
        return;
      }
      if (ev.event === 'step_update' && ev.step_update) {
        const su = ev.step_update;
        if (su.step_type === 'tool_use' || su.step_type === 'tool_call' || su.tool_calls || su.tool_call || su.tools) {
          stop('unexpected-tool');
          return;
        }
        if (typeof su.text_delta === 'string') {
          firstTextMs ??= now() - started;
          accumulatedText += su.text_delta;
        }
        if (su.usage && typeof su.usage === 'object') {
          if (typeof su.usage.input_tokens === 'number') inputTokens = su.usage.input_tokens;
          if (typeof su.usage.output_tokens === 'number') outputTokens = su.usage.output_tokens;
          if (typeof su.usage.total_tokens === 'number') totalTokens = su.usage.total_tokens;
          if (typeof su.usage.thinking_tokens === 'number') reasoningTokens = su.usage.thinking_tokens;
          if (typeof su.usage.cache_read_tokens === 'number') cacheReadTokens = su.usage.cache_read_tokens;
          if (typeof su.usage.cost_usd === 'number') costUsd = su.usage.cost_usd;
          progress();
        }
        if (su.stop_reason === 'length' || su.finish_reason === 'length' || su.status === 'LENGTH') {
          stopReason = 'length';
        }
      }
      if (ev.event === 'result' && ev.result) {
        const r = ev.result;
        if (typeof r.response === 'string') finalResponse = r.response;
        if (r.usage && typeof r.usage === 'object') {
          if (typeof r.usage.input_tokens === 'number') inputTokens = r.usage.input_tokens;
          if (typeof r.usage.output_tokens === 'number') outputTokens = r.usage.output_tokens;
          if (typeof r.usage.total_tokens === 'number') totalTokens = r.usage.total_tokens;
          if (typeof r.usage.thinking_tokens === 'number') reasoningTokens = r.usage.thinking_tokens;
          if (typeof r.usage.cache_read_tokens === 'number') cacheReadTokens = r.usage.cache_read_tokens;
          if (typeof r.usage.cost_usd === 'number') costUsd = r.usage.cost_usd;
        }
        if (r.stop_reason === 'length' || r.finish_reason === 'length' || r.status === 'LENGTH' || r.status === 'MAX_TOKENS') {
          stopReason = 'length';
        }
        if (r.status === 'SUCCESS') {
          completed = true;
        } else if (!stopReason) {
          stop('provider-error');
        }
      }
    };

    try {
      // agy does not get --dangerously-skip-permissions; materials and role are in the prompt
      const args = runner === 'claude'
        ? ['-p', '--model', CLAUDE_MODEL, '--effort', 'medium', '--tools', '', '--strict-mcp-config',
          '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']
        : ['--model', AGY_MODEL, '--output-format', 'stream-json', '--input-format', 'stream-json', '-p', ''];
      child = spawnImpl(bin, args,
        { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch { finish(1); return; }

    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.write(runner === 'claude' ? prompt : JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n');
      child.stdin.end();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while (!settled && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); consume(line);
      }
    });
    child.stderr.on('data', chunk => appendFileSync(stderrPath, chunk));
    child.on('error', () => finish(1));
    child.on('close', code => { if (!settled && buffer.trim()) consume(buffer); finish(code); });
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    wallTimer = setTimeout(() => stop('timeout'), Math.max(1, wallMs - (now() - started)));
    resetIdle();
    progressTimer = setInterval(progress, progressMs);
    log(`Rybka (${runner}): model ${model}; limit 10 min, bez zdarzeń 8 min; postęp co 15 s.`);
  });
}

/** A fresh run and its private files; supports single or both runners in parallel. */
export async function runRybka(options = {}) {
  const {
    specPath,
    runner = 'both',
    cwd = process.cwd(),
    baseUrl = process.env.DESK_PANEL_URL || 'http://127.0.0.1:5174',
    fetchImpl = globalThis.fetch,
  } = options;

  const role = readRole(options.rolePath ?? ROLE_PATH);
  let spec = options.spec;
  let taskId = null;
  let revision = null;

  if (isTaskId(specPath)) {
    const fetched = await fetchTaskSpec(specPath, { baseUrl, fetchImpl });
    taskId = fetched.taskId;
    revision = fetched.revision;
    spec = fetched.spec;
  }

  const { spec: finalSpec, materials, reads } = reviewMaterials(specPath, cwd, { spec });
  const common = {
    ...options,
    role,
    specPath,
    spec: finalSpec,
    taskId,
    revision,
    materials,
    reads,
  };

  if (runner === 'opencode') {
    return runRybkaOne({ ...common, runner: 'opencode' });
  }
  if (runner === 'claude') return runRybkaOne({ ...common, runner: 'claude' });
  if (runner === 'agy') {
    return runRybkaOne({ ...common, runner: 'agy' });
  }
  if (runner === 'both') {
    const [claude, agy] = await Promise.all([
      runRybkaOne({ ...common, runner: 'claude' }),
      runRybkaOne({ ...common, runner: 'agy' }),
    ]);
    const ok = claude.ok && agy.ok;
    const code = claude.code !== 0 ? claude.code : (agy.code !== 0 ? agy.code : 0);
    return {
      ok,
      code,
      results: [claude, agy],
      claude,
      agy,
      dir: claude.dir,
      reportPath: claude.reportPath ?? agy.reportPath,
      metrics: claude.metrics,
    };
  }
  throw Error(`Nieprawidłowy runner: ${runner}. Dozwolone: claude, agy, opencode, both.`);
}

export function parseRybkaArgs(argv) {
  let specPath = null;
  let runner = 'both';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--runner') {
      const val = argv[++i];
      if (!val || !['claude', 'agy', 'opencode', 'both'].includes(val)) {
        throw Error(`Nieprawidłowy runner: ${val}. Dozwolone: claude, agy, opencode, both.`);
      }
      runner = val;
    } else if (arg.startsWith('--runner=')) {
      const val = arg.slice('--runner='.length);
      if (!['claude', 'agy', 'opencode', 'both'].includes(val)) {
        throw Error(`Nieprawidłowy runner: ${val}. Dozwolone: claude, agy, opencode, both.`);
      }
      runner = val;
    } else if (arg.startsWith('-')) {
      throw Error(`Nieznana opcja: ${arg}`);
    } else {
      if (specPath !== null) throw Error(`Zbyt wiele argumentów: nieoczekiwany argument "${arg}".`);
      specPath = arg;
    }
  }
  if (!specPath) throw Error('Wymagany argument SPEC (ścieżka pliku lub id zadania t-…).');
  return { specPath, runner };
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()) {
  try {
    const parsed = parseRybkaArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log('Użycie: just rybka SPEC [--runner claude|agy|opencode|both]');
      console.log('  SPEC: id zadania t-… lub ścieżka pliku w repo');
      console.log('  --runner: claude (Sonnet 5.5 medium), agy (Gemini 3.8 Flash high), opencode (DeepSeek), both (domyślnie claude + agy)');
      process.exitCode = 0;
    } else {
      const result = await runRybka({ specPath: parsed.specPath, runner: parsed.runner });
      process.exitCode = result.code;
    }
  } catch (error) {
    console.error(`Rybka: ${error.message}`);
    process.exitCode = 2;
  }
}
