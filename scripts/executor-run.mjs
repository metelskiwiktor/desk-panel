// Local Cezar executor: one non-interactive opencode run on the pinned OpenRouter DeepSeek model.
//   node scripts/executor-run.mjs --brief ABS_PATH [--timeout-ms N] [--idle-ms N]
// The brief is read from disk and sent as the first message; stdin is /dev/null (no follow-up turns), the host's inline
// OpenCode config is kept, and every tool permission the executor needs is set explicitly (question and task are denied).
// Raw JSON events and a metrics record land in a private directory outside Git (~/.desk-panel/executor-runs).
// Permission allow is autonomy, not a sandbox: the run has this user's files, network and credentials.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The only model an executor run may use (Wektor's OpenRouter model; also the workflow's implement/fix/address). */
export const MODEL = 'openrouter/deepseek/deepseek-v4.1-flash-1017';
export const DEFAULT_WALL_MS = 20 * 60_000;
export const DEFAULT_IDLE_MS = 4 * 60_000;

/** Appended to every brief: the run may write, but never publish or reach for another agent. */
export const RUN_INSTRUCTIONS = [
  'Execution contract (fixed for this run):',
  '- Work only inside the current directory; never create another worktree or clone.',
  '- Do not run git commit, git push, gh, or anything that dispatches Cezar tasks: leave every change in the worktree for the orchestrator.',
  '- Never print, copy or commit secrets, tokens, panel.env, DPAPI files or credentials.',
  '- Run only the targeted tests and the typecheck while working; the orchestrator runs the full check afterwards.',
  '- If the task needs a dependency, module or credential the brief did not name, stop and report it instead of a broad refactor.',
].join('\n');

/**
 * Explicit permissions for a headless autonomous run. Every listed tool is a plain "allow", which replaces an inherited
 * per-tool ask object or pattern map; `question` and `task` are denied because there is no user to answer and an executor
 * must not spawn other agent turns. The rest of the host's inline config is preserved.
 */
export const EXECUTOR_PERMISSION = {
  '*': 'allow',
  read: 'allow',
  edit: 'allow',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  bash: 'allow',
  external_directory: 'allow',
  todowrite: 'allow',
  skill: 'allow',
  webfetch: 'allow',
  websearch: 'allow',
  lsp: 'allow',
  doom_loop: 'allow',
  question: 'deny',
  task: 'deny',
};

/**
 * `OPENCODE_CONFIG_CONTENT` for the run: the host value merged with explicit executor permissions, and both the main and
 * the small/helper model pinned to the one executor model (a host default must never make a title/compaction call on
 * another provider). The `--model` CLI flag carries the same model.
 */
export function opencodeConfigContent(existing) {
  let base = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed;
    } catch {
      // An unparseable host value cannot be merged into; the executor permissions still apply.
    }
  }
  const hostPermission = base.permission && typeof base.permission === 'object' && !Array.isArray(base.permission) ? base.permission : {};
  // Every inherited permission (known or unknown, e.g. a custom tool's `{'*':'ask'}`) becomes an explicit allow, so a
  // headless run is never blocked by an inherited ask; the two tools with no user to answer stay denied.
  const inherited = Object.fromEntries(Object.keys(hostPermission).map(key => [key, key === 'question' || key === 'task' ? 'deny' : 'allow']));
  return JSON.stringify({ ...base, model: MODEL, small_model: MODEL, permission: { ...inherited, ...EXECUTOR_PERMISSION } });
}

class UsageError extends Error {}

function positiveInt(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new UsageError(`${flag} needs a positive integer of milliseconds`);
  return number;
}

/** Parses the CLI. `--help` and a bad argument are answered before anything is spawned. */
export function parseArgs(argv) {
  const options = { help: false, brief: null, wallMs: DEFAULT_WALL_MS, idleMs: DEFAULT_IDLE_MS };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--brief') {
      options.brief = argv[++index];
      if (!options.brief) throw new UsageError('--brief needs an absolute path to the brief file');
    } else if (arg === '--timeout-ms') options.wallMs = positiveInt(argv[++index], '--timeout-ms');
    else if (arg === '--idle-ms') options.idleMs = positiveInt(argv[++index], '--idle-ms');
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.brief) throw new UsageError('--brief is required');
  return options;
}

/** One JSON event per line; a line the stream could not parse is kept raw and never hidden as an error. */
export function parseEventLine(line) {
  const text = line.trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : { type: 'unparsed', raw: text };
  } catch {
    return { type: 'unparsed', raw: text };
  }
}

const sum = (current, value) => (current ?? 0) + value;

/**
 * Token/cost totals from `step_finish` frames; a value no frame carried stays null (never 0). OpenCode's wire frame is
 * `{"type":"step_finish","part":{"type":"step-finish",...}}` — the outer type uses an underscore and the inner part a
 * hyphen — so both spellings count. `completed` is true only for a terminal `step_finish` whose reason is `stop`: an
 * exit code of 0 with no finished step is not a finished model turn.
 */
export function metricsFromEvents(events) {
  let inputTokens = null;
  let outputTokens = null;
  let totalTokens = null;
  let reasoningTokens = null;
  let cacheReadTokens = null;
  let cacheWriteTokens = null;
  let costUsd = null;
  let steps = 0;
  let errors = 0;
  let textLength = 0;
  let completed = false;
  let stopReason = null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const part = event.part && typeof event.part === 'object' ? event.part : event;
    if (event.type === 'error' || event.error || part.error) errors++;
    // The stream's top-level type uses underscores (`step_finish`); the part itself may use a hyphen (`step-finish`).
    const type = String(part.type ?? event.type ?? '').replace(/-/g, '_');
    if (type === 'text' && typeof part.text === 'string') textLength += part.text.length;
    if (type !== 'step_finish') continue;
    steps++;
    const tokens = part.tokens ?? event.tokens;
    if (tokens && typeof tokens === 'object') {
      if (typeof tokens.input === 'number') inputTokens = sum(inputTokens, tokens.input);
      if (typeof tokens.output === 'number') outputTokens = sum(outputTokens, tokens.output);
      if (typeof tokens.total === 'number') totalTokens = sum(totalTokens, tokens.total);
      if (typeof tokens.reasoning === 'number') reasoningTokens = sum(reasoningTokens, tokens.reasoning);
      const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : null;
      if (typeof cache?.read === 'number') cacheReadTokens = sum(cacheReadTokens, cache.read);
      if (typeof cache?.write === 'number') cacheWriteTokens = sum(cacheWriteTokens, cache.write);
    }
    const cost = typeof part.cost === 'number' ? part.cost : event.cost;
    if (typeof cost === 'number') costUsd = sum(costUsd, cost);
    const reason = typeof part.reason === 'string' ? part.reason : typeof event.reason === 'string' ? event.reason : null;
    if (reason) {
      stopReason = reason;
      if (reason === 'stop') completed = true;
    }
  }
  const cacheTokens = cacheReadTokens === null && cacheWriteTokens === null ? null : (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  return { inputTokens, outputTokens, totalTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, cacheTokens, costUsd, steps, errors, textLength, completed, stopReason };
}

/** Kills the process tree we started: on Windows `taskkill /T /F` on our child's PID only. */
export function killProcessTree(child, { platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    spawnSyncImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
    return;
  }
  try {
    process.kill(child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/** Default private directory for the raw JSONL and metrics records (outside Git). */
export function defaultRunsDir(env = process.env) {
  return env.DESK_EXECUTOR_RUNS?.trim() || join(homedir(), '.desk-panel', 'executor-runs');
}

/**
 * Runs one executor turn and resolves to a result (never rejects). `spawnImpl` and `killTree` are injectable so the
 * timeout/error paths can be tested without the real CLI or a model call.
 */
export function runExecutor({
  briefPath,
  wallMs = DEFAULT_WALL_MS,
  idleMs = DEFAULT_IDLE_MS,
  cwd = process.cwd(),
  env = process.env,
  spawnImpl = spawn,
  killTree = child => killProcessTree(child),
  runsDir = defaultRunsDir(env),
  log = console.log,
  now = () => Date.now(),
} = {}) {
  const brief = readFileSync(briefPath, 'utf8');
  const prompt = `${brief.trimEnd()}\n\n---\n${RUN_INSTRUCTIONS}\n`;
  const args = ['run', '--format', 'json', '--model', MODEL, '--dir', cwd, '--', prompt];
  const childEnv = { ...env, OPENCODE_CONFIG_CONTENT: opencodeConfigContent(env.OPENCODE_CONFIG_CONTENT) };
  const startedAt = now();
  const id = `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  mkdirSync(runsDir, { recursive: true, mode: 0o700 });
  const jsonlPath = join(runsDir, `${id}.jsonl`);
  const metricsPath = join(runsDir, `${id}.metrics.json`);
  writeFileSync(jsonlPath, '', { mode: 0o600 });

  return new Promise(resolve => {
    const events = [];
    const started = now();
    let resolved = false;
    let ending = null;
    let buffer = '';
    let child;
    let wallTimer;
    let idleTimer;
    let forceTimer;

    const logLine = line => {
      if (line.trim()) appendFileSync(jsonlPath, line.trim() + '\n', { mode: 0o600 });
    };
    const consume = line => {
      if (!line.trim()) return;
      const event = parseEventLine(line);
      logLine(line);
      if (event) events.push(event);
    };
    const cleanup = () => {
      clearTimeout(wallTimer);
      clearTimeout(idleTimer);
      clearTimeout(forceTimer);
    };
    const settle = (reason, code, detail) => {
      if (resolved) return { ok: false, code: 1, reason };
      resolved = true;
      cleanup();
      const metrics = metricsFromEvents(events);
      const terminal = metrics.completed && metrics.steps > 0;
      const failed = reason !== 'completed' || code !== 0 || metrics.errors > 0 || !terminal;
      const exitReason = failed && reason === 'completed'
        ? (code !== 0 ? 'exit' : metrics.errors > 0 ? 'error' : 'incomplete')
        : reason;
      const record = {
        model: MODEL,
        brief: briefPath,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(now()).toISOString(),
        durationMs: now() - started,
        exitCode: code ?? null,
        reason: exitReason,
        ok: !failed,
        ...(detail ? { detail } : {}),
        ...metrics,
      };
      try {
        writeFileSync(metricsPath, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      } catch {
        // The result is still returned; the record is best effort.
      }
      const failureCode = code && code !== 0 ? code : (reason === 'timeout' || reason === 'idle-timeout' ? 124 : 1);
      const result = { ok: !failed, code: failed ? failureCode : 0, reason: exitReason, metrics, jsonlPath, metricsPath };
      const tokens = metrics.inputTokens === null && metrics.outputTokens === null ? 'tokens n/a' : `in=${metrics.inputTokens ?? '?'} out=${metrics.outputTokens ?? '?'}`;
      log(`executor-run: ${result.ok ? 'ok' : 'failed'} (${exitReason}, ${Math.round(record.durationMs / 1000)}s, ${tokens}, cost=${metrics.costUsd === null ? 'n/a' : metrics.costUsd})`);
      log(`executor-run: events ${jsonlPath}`);
      return result;
    };

    try {
      child = spawnImpl('opencode', args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve(settle('spawn-error', null, error instanceof Error ? error.message : String(error)));
      return;
    }

    const stop = reason => {
      if (resolved || ending) return;
      ending = reason;
      clearTimeout(wallTimer);
      clearTimeout(idleTimer);
      try {
        killTree(child);
      } catch {
        // The fallback below still settles the run.
      }
      // A kill can make the child close synchronously; in that case settle already cleared every timer.
      if (resolved) return;
      forceTimer = setTimeout(() => resolve(settle(reason, null)), 10_000);
    };
    const resetIdle = () => {
      if (resolved || ending) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop('idle-timeout'), idleMs);
    };

    child.on('error', error => resolve(settle('spawn-error', null, error instanceof Error ? error.message : String(error))));
    child.stdout?.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        consume(line);
      }
      resetIdle();
    });
    child.stderr?.on('data', chunk => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) logLine(JSON.stringify({ type: 'stderr', line }));
      resetIdle();
    });
    child.on('close', (code, signal) => {
      if (buffer.trim()) consume(buffer);
      buffer = '';
      resolve(settle(ending ?? 'completed', code, signal && !code ? signal : undefined));
    });

    wallTimer = setTimeout(() => stop('timeout'), wallMs);
    idleTimer = setTimeout(() => stop('idle-timeout'), idleMs);
  });
}

const USAGE = `Użycie: node scripts/executor-run.mjs --brief ABS_PATH [--timeout-ms N] [--idle-ms N]

Runs opencode on ${MODEL} with the brief as its only message. Defaults: wall 20 min,
no output 4 min. Records raw JSONL and metrics in ~/.desk-panel/executor-runs (DESK_EXECUTOR_RUNS overrides it).
The run may edit files and run commands (autonomy, not a filesystem sandbox); it is told not to commit, push or dispatch.`;

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 2;
  }
  if (options?.help) {
    console.log(USAGE);
  } else if (options) {
    try {
      const result = await runExecutor({ briefPath: options.brief, wallMs: options.wallMs, idleMs: options.idleMs });
      process.exitCode = result.code;
    } catch (error) {
      console.error(`executor-run: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
