// @vitest-environment node
// Contract of the local executor CLI: pinned DeepSeek model, no stdin, autonomous-but-denied permissions, raw JSONL and
// metrics, and timeouts that kill only the child we started. No real opencode process or model call is used.
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_IDLE_MS, DEFAULT_WALL_MS, MODEL, opencodeConfigContent, parseArgs, runExecutor, metricsFromEvents } from './executor-run.mjs';

const dirs = [];
const quiet = () => undefined;

function tempBrief() {
  const dir = mkdtempSync(join(tmpdir(), 'dp-executor-'));
  dirs.push(dir);
  const brief = join(dir, 'brief.md');
  writeFileSync(brief, '# Goal\nMake the tile readable.\n');
  return { dir, brief };
}

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => undefined;
  return child;
}

/** Spawns nothing: returns the child and records the command/options the runner would use. */
function fakeSpawn(child) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };
  return { spawn, calls };
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

it('pins the model, ignores stdin and keeps the host config with explicit permissions', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild();
  const spawn = fakeSpawn(child);
  const done = runExecutor({ briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: spawn.spawn, log: quiet, env: {} });
  child.stdout.write('{"type":"step_finish","part":{"type":"step-finish","reason":"stop","tokens":{"input":10,"output":4,"total":20,"reasoning":2,"cache":{"read":2,"write":1}},"cost":0.01}}\n');
  child.emit('close', 0);
  const result = await done;

  expect(result.ok).toBe(true);
  expect(spawn.calls).toHaveLength(1);
  const { command, args, options } = spawn.calls[0];
  expect(command).toBe('opencode');
  expect(args.slice(0, 7)).toEqual(['run', '--format', 'json', '--model', MODEL, '--dir', process.cwd()]);
  expect(args).not.toContain('--continue');
  expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  expect(options.env.OPENCODE_CONFIG_CONTENT).toBeTypeOf('string');
  const config = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
  expect(config.permission['*']).toBe('allow');
  for (const tool of ['read', 'edit', 'glob', 'grep', 'list', 'bash']) expect(config.permission[tool]).toBe('allow');
  expect(config.permission.question).toBe('deny');
  expect(config.permission.task).toBe('deny');
  expect(config.model).toBe(MODEL);
  expect(config.small_model).toBe(MODEL);
  expect(args).toContain(MODEL);
  expect(args.at(-1)).toContain('Make the tile readable.');
  expect(args.at(-1)).toContain('Do not run git commit');
  expect(result.metrics).toMatchObject({ inputTokens: 10, outputTokens: 4, totalTokens: 20, reasoningTokens: 2, cacheReadTokens: 2, cacheWriteTokens: 1, costUsd: 0.01, steps: 1, completed: true, stopReason: 'stop' });
});

it('merges the host inline config and overrides inherited per-tool ask objects', () => {
  const host = JSON.stringify({ model: 'host/model', permission: { bash: { 'rm *': 'ask' }, edit: 'ask', customtool: { '*': 'ask' }, question: 'ask' }, mcp: { x: {} } });
  const config = JSON.parse(opencodeConfigContent(host));
  expect(config.model).toBe(MODEL);
  expect(config.small_model).toBe(MODEL);
  expect(config.mcp).toEqual({ x: {} });
  expect(config.permission.bash).toBe('allow');
  expect(config.permission.edit).toBe('allow');
  expect(config.permission.customtool).toBe('allow');
  expect(config.permission.question).toBe('deny');
  expect(JSON.parse(opencodeConfigContent('not json')).permission.read).toBe('allow');
});

it('fails on a non-zero exit even with no error event', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild();
  const done = runExecutor({ briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: fakeSpawn(child).spawn, log: quiet, env: {} });
  child.emit('close', 3);
  const result = await done;
  expect(result.ok).toBe(false);
  expect(result.reason).toBe('exit');
  expect(result.code).toBe(3);
});

it('fails when the JSON stream reports an error even though the process exits 0', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild();
  const done = runExecutor({ briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: fakeSpawn(child).spawn, log: quiet, env: {} });
  child.stdout.write('{"type":"error","error":{"message":"provider said no"}}\n');
  child.emit('close', 0);
  const result = await done;
  expect(result.ok).toBe(false);
  expect(result.reason).toBe('error');
  expect(result.code).toBe(1);
});

it('kills only its own child tree on a wall timeout', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild(777);
  const killed = [];
  const done = runExecutor({
    briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: fakeSpawn(child).spawn, log: quiet, env: {},
    wallMs: 30, idleMs: 60_000,
    killTree: process => { killed.push(process.pid); process.emit('close', null, 'SIGKILL'); },
  });
  const result = await done;
  expect(killed).toEqual([777]);
  expect(result.ok).toBe(false);
  expect(result.reason).toBe('timeout');
  expect(result.code).toBe(124);
});

it('stops a silent run after the no-output limit', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild();
  const killed = [];
  const done = runExecutor({
    briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: fakeSpawn(child).spawn, log: quiet, env: {},
    wallMs: 60_000, idleMs: 30,
    killTree: process => { killed.push(process.pid); process.emit('close', null, 'SIGKILL'); },
  });
  const result = await done;
  expect(killed).toHaveLength(1);
  expect(result.reason).toBe('idle-timeout');
  expect(result.code).toBe(124);
});

it('settles a spawn error without leaving a timer behind', async () => {
  const { dir, brief } = tempBrief();
  const result = await runExecutor({
    briefPath: brief, runsDir: join(dir, 'runs'), log: quiet, env: {},
    spawnImpl: () => { throw new Error('ENOENT opencode'); },
  });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe('spawn-error');
  expect(result.code).toBe(1);
});

it('records private JSONL and a metrics file, printing no environment', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild();
  const printed = [];
  const done = runExecutor({
    briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: fakeSpawn(child).spawn, env: { SECRET_TOKEN: 'do-not-print' },
    log: line => printed.push(line),
  });
  child.stdout.write('{"type":"text","part":{"type":"text","text":"hello"}}\n');
  child.emit('close', 0);
  const result = await done;
  expect(existsSync(result.jsonlPath)).toBe(true);
  expect(readFileSync(result.jsonlPath, 'utf8')).toContain('"hello"');
  const metrics = JSON.parse(readFileSync(result.metricsPath, 'utf8'));
  expect(metrics).toMatchObject({ model: MODEL, reason: 'incomplete', ok: false, steps: 0, inputTokens: null, costUsd: null, completed: false });
  expect(printed.join('\n')).not.toContain('do-not-print');
  expect(printed.join('\n')).not.toContain('OPENCODE');
});

it('counts the authentic wire frame and tolerates chunks split inside a line', async () => {
  const { dir, brief } = tempBrief();
  const child = fakeChild();
  const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'opencode-step-finish.jsonl'), 'utf8');
  const done = runExecutor({ briefPath: brief, runsDir: join(dir, 'runs'), spawnImpl: fakeSpawn(child).spawn, log: quiet, env: {} });
  const cut = Math.floor(fixture.length / 3);
  child.stdout.write(fixture.slice(0, cut));
  child.stdout.write(fixture.slice(cut, cut + 7));
  child.stdout.write(fixture.slice(cut + 7));
  child.emit('close', 0);
  const result = await done;
  expect(result.ok).toBe(true);
  expect(result.metrics).toMatchObject({
    inputTokens: 10919,
    outputTokens: 6,
    totalTokens: 25427,
    reasoningTokens: 166,
    cacheReadTokens: 14336,
    cacheWriteTokens: 0,
    costUsd: 0.001784058,
    steps: 2,
    errors: 0,
    textLength: 8,
    completed: true,
    stopReason: 'stop',
  });
});

it('never starts the model for --help or invalid arguments', () => {
  const script = join(import.meta.dirname, 'executor-run.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', timeout: 20_000 });
  expect(help.status).toBe(0);
  expect(help.stdout).toContain('--brief');
  const invalid = spawnSync(process.execPath, [script, '--bogus'], { encoding: 'utf8', timeout: 20_000 });
  expect(invalid.status).toBe(2);
  expect(invalid.stderr).toContain('unknown argument');
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 20_000 });
  expect(missing.status).toBe(2);
});

it('parses the documented defaults and rejects a non-positive limit', () => {
  expect(parseArgs(['--brief', 'x.md'])).toEqual({ help: false, brief: 'x.md', wallMs: DEFAULT_WALL_MS, idleMs: DEFAULT_IDLE_MS });
  expect(DEFAULT_WALL_MS).toBe(20 * 60_000);
  expect(DEFAULT_IDLE_MS).toBe(4 * 60_000);
  expect(() => parseArgs(['--brief', 'x.md', '--idle-ms', '0'])).toThrow(/positive integer/);
});

it('sums step_finish tokens and cost, and leaves missing values null', () => {
  const metrics = metricsFromEvents([
    { type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', tokens: { total: 20, input: 5, output: 2, reasoning: 1, cache: { read: 1, write: 0 } }, cost: 0.002 } },
    { type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { total: 30, input: 3, output: 1, reasoning: 2 }, cost: 0.003 } },
    { type: 'text', part: { type: 'text', text: 'done' } },
  ]);
  expect(metrics).toMatchObject({ inputTokens: 8, outputTokens: 3, totalTokens: 50, reasoningTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 0, cacheTokens: 1, costUsd: 0.005, steps: 2, errors: 0, textLength: 4, completed: true, stopReason: 'stop' });
  expect(metricsFromEvents([])).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cacheTokens: null, costUsd: null, steps: 0, completed: false });
});
