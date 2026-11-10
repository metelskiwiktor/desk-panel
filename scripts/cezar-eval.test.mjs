import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  buildReport,
  assertSuiteOutsideInputs,
  createIsolatedRepository,
  createReadOnlyReviewWorkspace,
  changedSnapshotPaths,
  injectTooling,
  opencodeConfigContent,
  parseArgs,
  parseJsonLines,
  parseOpenCodeConfig,
  parseWorkflow,
  processSelectedTrials,
  nodeValues,
  renderPrompt,
  runAgent,
  runCheck,
  runChild,
  removeTemporaryTree,
  safeEnv,
  snapshotReviewTree,
  summarizeAcceptance,
  trialDisposition,
  usageFromEvents,
} from './cezar-eval.mjs';
import { executeAgentWorkflow } from './cezar-eval-workflow.mjs';

const workflowPath = fileURLToPath(new URL('../.ai/cezar/workflows/desk-panel-task.yaml', import.meta.url));
const workflowText = readFileSync(workflowPath, 'utf8');

function scriptedSpawn(handler, calls = []) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = 987654;
    const call = { command, args: [...args], options, stdin: '' };
    const chunks = [];
    calls.push(call);
    child.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.stdin.on('finish', () => {
      call.stdin = Buffer.concat(chunks).toString('utf8');
      setImmediate(() => handler(call, child));
    });
    return child;
  };
}

function finishChild(child, { stdout = '', stderr = '', code = 0 } = {}) {
  child.stdout.end(stdout);
  child.stderr.end(stderr);
  child.emit('close', code, null);
}

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('cezar-eval workflow adapter', () => {
  it('accepts the real workflow and reads its model, retries and approval transitions', () => {
    const parsed = parseWorkflow(workflowText);
    expect(parsed.nodes.get('implement').model).toBe('openrouter/deepseek/deepseek-v4.1-flash-1017');
    expect(parsed.nodes.get('review').model).toBe('gemini-3.8-flash-high');
    expect(parsed.retries).toEqual({ verify: 2, review: 1 });
    expect(parsed.edgeSet.has('review.approve->commit')).toBe(true);
    expect(parsed.edgeSet.has('commit.pass->pr')).toBe(true);
    for (const node of parsed.workflow.nodes.filter(node => node.timeoutMs !== undefined)) expect(Number.isSafeInteger(node.timeoutMs) && node.timeoutMs > 0).toBe(true);
  });

  it('rejects a workflow whose commit boundary or runner changed', () => {
    const changedEdge = YAML.parse(workflowText);
    changedEdge.edges.find(edge => edge.from === 'review.approve').to = 'done';
    expect(() => parseWorkflow(YAML.stringify(changedEdge))).toThrow(/transition changed/);
    const changedRunner = YAML.parse(workflowText);
    changedRunner.nodes.find(node => node.id === 'implement').runner = 'codex';
    expect(() => parseWorkflow(YAML.stringify(changedRunner))).toThrow(/executor runner changed/);
    const missingReviewLimit = YAML.parse(workflowText);
    delete missingReviewLimit.nodes.find(node => node.id === 'review-retry').max;
    expect(() => parseWorkflow(YAML.stringify(missingReviewLimit))).toThrow(/retry limits/);
    const invalidTimeout = YAML.parse(workflowText);
    invalidTimeout.nodes.find(node => node.id === 'review').timeoutMs = 0;
    expect(() => parseWorkflow(YAML.stringify(invalidTimeout))).toThrow(/positive integer/);
  });

  it('requires a value for every interpolation and substitutes workflow fields', () => {
    expect(renderPrompt('task={{task}}; review={{nodes.review.summary}}', {
      task: 'brief', 'nodes.review.summary': 'Findings: none',
    })).toBe('task=brief; review=Findings: none');
    expect(() => renderPrompt('missing={{nodes.fix.output}}', {})).toThrow(/No workflow value/);
  });

  it('parses every interpolation in the current workflow without exposing prompt text in assertions', () => {
    const parsed = parseWorkflow(workflowText);
    const state = {
      verify: { summary: 'check output', output: 'check output' },
      'verify-retry': { iteration: 1, max: parsed.retries.verify },
      review: { summary: 'Findings: none', verdict: 'approve' },
    };
    const values = { task: 'frozen brief', ...nodeValues(state, parsed.workflow) };
    for (const node of parsed.workflow.nodes.filter(item => item.prompt)) expect(() => renderPrompt(node.prompt, values)).not.toThrow();
  });
});

describe('cezar-eval process and evidence parsing', () => {
  it('keeps child environments to the allowlist and rejects secret-shaped additions', () => {
    const filtered = safeEnv({ PATH: 'safe-path', SystemRoot: 'windows', DESK_PANEL_SECRET: 'never-copy', OPENROUTER_API_KEY: 'never-copy', RANDOM_VALUE: 'never-copy' });
    expect(filtered).toMatchObject({ PATH: 'safe-path', SystemRoot: 'windows', GIT_TERMINAL_PROMPT: '0' });
    expect(filtered).not.toHaveProperty('DESK_PANEL_SECRET');
    expect(filtered).not.toHaveProperty('OPENROUTER_API_KEY');
    expect(filtered).not.toHaveProperty('RANDOM_VALUE');
    expect(() => safeEnv({}, { OPENROUTER_API_KEY: 'never-copy' })).toThrow(/Unsafe child environment/);
  });

  it('creates a shallow base checkout without the opposite reference commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'cezar-eval-isolation-test-'));
    const source = join(root, 'source');
    const isolated = join(root, 'isolated');
    mkdirSync(source);
    const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git(source, 'init', '--quiet');
      git(source, 'config', 'user.name', 'TABL-2 test');
      git(source, 'config', 'user.email', 'tabl-2@example.invalid');
      writeFileSync(join(source, 'base.txt'), 'baseline\n');
      git(source, 'add', 'base.txt');
      git(source, 'commit', '--quiet', '-m', 'base');
      const base = git(source, 'rev-parse', 'HEAD');
      writeFileSync(join(source, 'reference-only.txt'), 'reference\n');
      git(source, 'add', 'reference-only.txt');
      git(source, 'commit', '--quiet', '-m', 'reference');
      const reference = git(source, 'rev-parse', 'HEAD');

      createIsolatedRepository(isolated, base, reference, source);

      expect(git(isolated, 'rev-parse', 'HEAD')).toBe(base);
      expect(git(isolated, 'rev-list', '--all', '--count')).toBe('1');
      expect(() => git(isolated, 'cat-file', '-e', `${reference}^{commit}`)).toThrow();
      expect(() => readFileSync(join(isolated, 'reference-only.txt'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('accepts only known commands and explicit paths', () => {
    expect(parseArgs(['run', '--suite', 'C:/eval', '--dry-run'])).toMatchObject({ command: 'run', suite: 'C:/eval', dryRun: true });
    expect(parseArgs(['run', '--trials', 'deepseek-r1,codex-r2']).trials).toEqual(['deepseek-r1', 'codex-r2']);
    expect(() => parseArgs(['run', '--trials', 'deepseek-r1,deepseek-r1'])).toThrow(/unique non-empty/);
    expect(() => parseArgs(['run', '--other'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['freeze', '--suite'])).toThrow(/requires a path/);
  });

  it('reuses completed acceptance attempts, preserves partial attempts, and runs only missing IDs', () => {
    expect(trialDisposition(true, { workflowCompleted: true, acceptance: { accepted: false } })).toBe('reuse');
    expect(trialDisposition(true, { status: 'incomplete', phase: 'review-1' })).toBe('preserve');
    expect(trialDisposition(true, null)).toBe('preserve');
    expect(trialDisposition(false, null)).toBe('run');
  });

  it('rejects suite overlap with protected inputs and can safely create it outside both trees', () => {
    const root = tempRoot('cezar-eval-path-guard-');
    try {
      const repository = join(root, 'repo');
      const source = join(root, 'source');
      mkdirSync(repository);
      mkdirSync(source);
      expect(() => assertSuiteOutsideInputs(join(repository, 'suite'), source, repository)).toThrow(/source repository/);
      expect(() => assertSuiteOutsideInputs(join(source, 'suite'), source, repository)).toThrow(/source fixture tree/);
      expect(assertSuiteOutsideInputs(join(root, 'new-parent', 'suite'), source, repository)).toBe(join(root, 'new-parent', 'suite'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes only owned temporary trees inside the supplied temp root', () => {
    const root = tempRoot('cezar-eval-delete-guard-');
    const ownedRoot = join(root, 'owned-root');
    mkdirSync(ownedRoot);
    const owned = mkdtempSync(join(ownedRoot, 'cezar-owned-'));
    const unrelated = mkdtempSync(join(root, 'unrelated-'));
    try {
      removeTemporaryTree(ownedRoot, owned, 'cezar-owned-');
      expect(existsSync(owned)).toBe(false);
      expect(() => removeTemporaryTree(ownedRoot, unrelated, 'cezar-owned-')).toThrow(/Refusing recursive deletion/);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not write a linked worktree shared Git exclude file', () => {
    const root = tempRoot('cezar-eval-git-exclude-');
    const main = join(root, 'main');
    const linked = join(root, 'linked');
    const suite = join(root, 'suite');
    mkdirSync(main);
    mkdirSync(join(suite, 'tooling'), { recursive: true });
    const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env: safeEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git(main, 'init', '--quiet');
      git(main, 'config', 'user.name', 'TABL-2 test');
      git(main, 'config', 'user.email', 'tabl-2@example.invalid');
      writeFileSync(join(main, 'base.txt'), 'base\n');
      git(main, 'add', 'base.txt');
      git(main, 'commit', '--quiet', '-m', 'base');
      git(main, 'worktree', 'add', '--quiet', linked, 'HEAD');
      for (const path of [
        'docs/agent-workflows/executor-brief.md', 'scripts/dependencies.mjs', 'scripts/executor-prepare.mjs',
        'scripts/executor-scope.mjs', 'scripts/executor-commit.mjs',
      ]) {
        const target = join(suite, 'tooling', path);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, `tool fixture for ${path}\n`);
      }
      const common = git(linked, 'rev-parse', '--git-common-dir');
      const sharedExclude = join(resolve(linked, common), 'info', 'exclude');
      const sharedBefore = existsSync(sharedExclude) ? readFileSync(sharedExclude, 'utf8') : null;
      const gitDir = git(linked, 'rev-parse', '--absolute-git-dir');
      const reportedExclude = git(linked, 'rev-parse', '--git-path', 'info/exclude');
      const excludePath = resolve(linked, reportedExclude);
      if (excludePath === sharedExclude || excludePath.startsWith(`${resolve(linked, common)}\\`)) {
        expect(() => injectTooling(suite, linked)).toThrow(/Refusing path outside suite/);
      } else injectTooling(suite, linked);
      const sharedAfter = existsSync(sharedExclude) ? readFileSync(sharedExclude, 'utf8') : null;
      expect(sharedAfter).toBe(sharedBefore);
      expect(gitDir).toContain('worktrees');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('parses effective OpenCode configuration and creates disabled replacements for configured MCP servers', () => {
    const serverNames = Object.keys(parseOpenCodeConfig(JSON.stringify({ mcp: { servers: { first: {}, second: {} } } })).mcp.servers);
    const config = JSON.parse(opencodeConfigContent('deepseek/test', serverNames));
    expect(Object.keys(config.mcp.servers)).toEqual(['first', 'second']);
    expect(Object.values(config.mcp.servers).every(server => server.disabled && server.type === 'local')).toBe(true);
    expect(() => parseOpenCodeConfig('not json')).toThrow(/did not return JSON/);
  });

  it('parses JSONL usage without inventing missing token or cost values', () => {
    const events = parseJsonLines([
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 12, output: 5, cache: { read: 2, write: 1 } }, cost: 0.004 } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 3 } }),
      'plain text',
    ].join('\n'));
    expect(usageFromEvents(events)).toEqual({ inputTokens: 20, outputTokens: 8, cacheReadTokens: 2, cacheWriteTokens: 1, costUsd: 0.004 });
    expect(usageFromEvents([])).toEqual({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null });
  });

  it('reconstructs named case results from the JSON reporter', () => {
    const summary = summarizeAcceptance({ testResults: [{ assertionResults: [
      { ancestorTitles: ['H2'], title: 'H2-C1 answer settles', status: 'passed' },
      { ancestorTitles: ['H2'], title: 'H2-C2 no repost', status: 'failed' },
    ] }] }, [
      { id: 'H2-C1', severity: 'P1' }, { id: 'H2-C2', severity: 'P1' }, { id: 'H2-C3', severity: 'P2' },
    ]);
    expect(summary).toEqual({
      valid: false, passed: 1, total: 3,
      cases: [
        { id: 'H2-C1', severity: 'P1', status: 'passed' },
        { id: 'H2-C2', severity: 'P1', status: 'failed' },
        { id: 'H2-C3', severity: 'P2', status: 'missing' },
      ],
    });
  });

  it('renders first and final verification, repeated cases, missing costs, and workflow limits', () => {
    const evaluation = {
      id: 'TABL-2-H2-v1', base: 'base-sha', reference: 'ref-sha',
      brief: { sha256: 'brief-hash' }, workflow: { sha256: 'workflow-hash' },
      tooling: { files: { 'scripts/cezar-eval.mjs': 'runner-hash' }, runnerSha256: 'runner-hash' },
      deskPanelMainAtFreeze: 'main-sha', sourceManifestSha256: 'manifest-hash', acceptance: { sha256: 'hidden-hash' },
      selectionRationale: 'H2 calibration',
      environment: { os: 'Windows test', architecture: 'x64', node: 'v-test', workspace: 'shallow temporary repository' },
      runs: [
        { id: 'deepseek-r1', runner: 'opencode', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', reasoning: 'workflow/default' },
        { id: 'codex-r1', runner: 'codex', model: 'gpt-6.1-sol', reasoning: 'high' },
        { id: 'deepseek-r2', runner: 'opencode', model: 'openrouter/deepseek/deepseek-v4.1-flash-1017', reasoning: 'workflow/default' },
        { id: 'codex-r2', runner: 'codex', model: 'gpt-6.1-sol', reasoning: 'high' },
      ],
      reviewer: { runner: 'agy', model: 'gemini-3.8-flash-high', reasoning: 'workflow/default' },
      cases: [{ id: 'H2-C1', severity: 'P1' }],
    };
    const makeRun = (id, runner, pass) => ({
      id, runner, model: runner === 'codex' ? 'gpt-6.1-sol' : 'deepseek', reasoning: runner === 'codex' ? 'high' : 'workflow/default',
      reviewer: { model: 'gemini-3.8-flash-high', verdict: 'approve' },
      firstVerify: { passed: true }, finalVerify: { passed: true }, workflowCompleted: true, durationMs: 60_000,
      head: { commits: 0 }, actions: [{ usage: { inputTokens: 11, outputTokens: 7, costUsd: null } }],
      acceptance: { passed: Number(pass), total: 1, cases: [{ id: 'H2-C1', status: pass ? 'passed' : 'failed' }] },
    });
    const report = buildReport(evaluation, [makeRun('deepseek-r1', 'opencode', true), makeRun('deepseek-r2', 'opencode', true), makeRun('codex-r1', 'codex', false), makeRun('codex-r2', 'codex', false)]);
    expect(report).toContain('Pierwszy verify');
    expect(report).toContain('deepseek-r1');
    expect(report).toContain('gpt-6.1-sol');
    expect(report).toContain('zgodność wyników przypadków w dwóch powtórzeniach — tak');
    expect(report).toContain('Koszt subskrypcji Codexa i koszt Agy są N/D');
    expect(report).toContain('Status eksperymentu: **4/4 próby zapisane');
    const unrunReport = buildReport(evaluation, []);
    expect(unrunReport).toContain('Status eksperymentu: **NIEPRZEPROWADZONY — 0/4 prób');
    expect(unrunReport).toContain('openrouter/deepseek/deepseek-v4.1-flash-1017 · workflow/default');
    expect(unrunReport).toContain('codex · gpt-6.1-sol · high');
    expect(unrunReport).toContain('agy · gemini-3.8-flash-high (nieuruchomiony)');
    expect(unrunReport).toContain('Środowisko: Windows test · x64 · Node v-test');
    expect(unrunReport).toContain('DeskPanel main przy zamrożeniu');
    expect(unrunReport).toContain('scripts/cezar-eval.mjs=runner-hash');

    const interrupted = buildReport(evaluation, [
      { id: 'deepseek-r1', errorRecord: true, phase: 'review-1', error: 'review CLI timed out', actions: [], durationMs: 12_000 },
      { id: 'deepseek-r2', workflowCompleted: true, acceptance: { valid: false, passed: null, total: 1, cases: [{ id: 'H2-C1', severity: 'P1', status: 'not-reported' }] } },
    ]);
    expect(interrupted).toContain('NIEPEŁNY — ukończono 1/4 prób');
    expect(interrupted).toContain('N/D · nieuruchomiono');
    expect(interrupted).toContain('N/D (brak dwóch kompletnych raportów akceptacji)');
    expect(interrupted).toContain('workflow · review-1');
    expect(interrupted).toContain('trial-progress.json');
    expect(interrupted).not.toContain('zgodność wyników przypadków w dwóch powtórzeniach — tak');
    expect(interrupted).not.toContain('| deepseek-r2 | błąd | błąd | błąd |');
  });
});

describe('cezar-eval real adapter routing with fake child processes', () => {
  it('sends the complete Codex prompt through stdin and preserves the final response and usage', async () => {
    const root = tempRoot('cezar-eval-codex-route-');
    const calls = [];
    const prompt = 'A long workflow prompt whose full text must arrive over stdin.';
    const spawnImpl = scriptedSpawn((call, child) => {
      const messagePath = call.args[call.args.indexOf('-o') + 1];
      writeFileSync(messagePath, 'Codex final answer');
      finishChild(child, { stdout: `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 31, output_tokens: 9 } })}\n` });
    }, calls);
    try {
      const result = await runAgent({
        node: { runner: 'codex', model: 'gpt-6.1-sol' }, prompt, worktree: root, artifacts: join(root, 'artifacts', 'implement'),
        hookDir: join(root, 'hooks'), spawnImpl, resolveExecutable: name => `fake-${name}`,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].stdin).toBe(prompt);
      expect(calls[0].args.at(-1)).toBe('-');
      expect(calls[0].args.join(' ')).not.toContain(prompt);
      expect(result.summary).toBe('Codex final answer');
      expect(result.usage).toMatchObject({ inputTokens: 31, outputTokens: 9 });
      expect(readFileSync(join(root, 'artifacts', 'implement.last-message.txt'), 'utf8')).toBe('Codex final answer');
      expect(existsSync(join(root, '.eval-last-message.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sends Agy the documented stream-json user envelope and parses its final response and usage', async () => {
    const root = tempRoot('cezar-eval-agy-route-');
    const calls = [];
    const prompt = 'Agy prompt over JSONL stdin';
    const spawnImpl = scriptedSpawn((_call, child) => finishChild(child, {
      stdout: `${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'CEZ:VERDICT approve', usage: { input_tokens: 19, output_tokens: 8, cost_usd: 0.002 } } })}\n`,
    }), calls);
    try {
      const result = await runAgent({
        node: { runner: 'agy', model: 'gemini-3.8-flash-high' }, prompt, worktree: root, artifacts: join(root, 'artifacts', 'review'),
        hookDir: join(root, 'hooks'), spawnImpl, resolveExecutable: name => `fake-${name}`,
      });
      expect(calls[0].args).toEqual(['--model', 'gemini-3.8-flash-high', '--mode', 'plan', '--sandbox', '--output-format', 'stream-json', '--input-format', 'stream-json', '-p', '']);
      expect(calls[0].stdin).toBe(`${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`);
      expect(JSON.parse(readFileSync(join(root, 'artifacts', 'review.invocation.json'), 'utf8'))).toMatchObject({ wallMs: 30 * 60_000, idleMs: 4 * 60_000 });
      expect(result.summary).toBe('CEZ:VERDICT approve');
      expect(result.usage).toMatchObject({ inputTokens: 19, outputTokens: 8, costUsd: 0.002 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps OpenCode prompts in a file and disables each configured MCP server in the effective run config', async () => {
    const root = tempRoot('cezar-eval-opencode-route-');
    const calls = [];
    const prompt = 'A very long OpenCode workflow prompt. '.repeat(3000);
    const globalConfig = { mcp: { servers: { one: { type: 'local', command: ['server-one'] }, two: { type: 'remote', url: 'http://127.0.0.1:4999/mcp' } } } };
    const spawnImpl = scriptedSpawn((_call, child) => finishChild(child, {
      stdout: [
        JSON.stringify({ type: 'text', part: { text: 'OpenCode final answer' } }),
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 22, output: 11 }, cost: 0.003 } }),
      ].join('\n') + '\n',
    }), calls);
    try {
      const result = await runAgent({
        node: { runner: 'opencode', model: 'deepseek/test' }, prompt, worktree: root, artifacts: join(root, 'artifacts', 'implement'),
        hookDir: join(root, 'hooks'), timeoutMs: 1000, spawnImpl, resolveExecutable: name => `fake-${name}`,
        execFileImpl: (_command, args, options) => {
          expect(args).toEqual(['debug', 'config', '--pure']);
          expect(options.env).not.toHaveProperty('DESK_HERMES_KEY');
          return JSON.stringify(globalConfig);
        },
      });
      expect(calls[0].stdin).toBe('');
      expect(calls[0].args).toContain('--file');
      expect(calls[0].args.join(' ').length).toBeLessThan(1000);
      const promptPath = calls[0].args[calls[0].args.indexOf('--file') + 1];
      expect(readFileSync(promptPath, 'utf8')).toBe(prompt);
      const effective = JSON.parse(calls[0].options.env.OPENCODE_CONFIG_CONTENT);
      expect(Object.keys(effective.mcp.servers)).toEqual(['one', 'two']);
      expect(Object.values(effective.mcp.servers).every(server => server.disabled)).toBe(true);
      expect(effective.plugin).toEqual([]);
      expect(result.summary).toBe('OpenCode final answer');
      expect(result.usage).toMatchObject({ inputTokens: 22, outputTokens: 11, costUsd: 0.003 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on unrecognized OpenCode MCP configuration and preserves process failures', async () => {
    const root = tempRoot('cezar-eval-adapter-errors-');
    try {
      await expect(runAgent({
        node: { runner: 'opencode', model: 'deepseek/test' }, prompt: 'prompt', worktree: root, artifacts: join(root, 'bad-config'),
        hookDir: join(root, 'hooks'), resolveExecutable: name => `fake-${name}`,
        execFileImpl: () => JSON.stringify({ mcp: { legacyServers: { unexpected: true } } }),
      })).rejects.toThrow(/Unsupported OpenCode MCP config shape/);

      const spawnImpl = scriptedSpawn((_call, child) => finishChild(child, { stderr: 'provider failed', code: 17 }));
      const failed = await runAgent({
        node: { runner: 'agy', model: 'gemini/test' }, prompt: 'failure-path', worktree: root, artifacts: join(root, 'failed-run'),
        hookDir: join(root, 'hooks'), timeoutMs: 1000, spawnImpl, resolveExecutable: name => `fake-${name}`,
      });
      expect(failed.exitCode).toBe(17);
      expect(readFileSync(join(root, 'failed-run.stderr.raw'), 'utf8')).toBe('provider failed');
      expect(JSON.parse(readFileSync(join(root, 'failed-run.result.json'), 'utf8')).exitCode).toBe(17);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records wall timeout and spawn errors while preserving partial raw output', async () => {
    const root = tempRoot('cezar-eval-child-failure-');
    try {
      const hangingSpawn = scriptedSpawn((_call, child) => child.stdout.write('partial output'));
      const timed = await runChild('fake-cli', [], {
        cwd: root, env: safeEnv({ PATH: 'test' }), outputBase: join(root, 'timeout'), wallMs: 15, idleMs: 1000,
        spawnImpl: hangingSpawn, terminateImpl: child => child.emit('close', null, 'SIGTERM'),
      });
      expect(timed.timedOut).toBe('wall-timeout');
      expect(timed.signal).toBe('SIGTERM');
      expect(readFileSync(timed.stdoutFile, 'utf8')).toBe('partial output');

      const spawnError = scriptedSpawn((_call, child) => child.emit('error', new Error('executable missing')));
      const errored = await runChild('fake-missing', [], {
        cwd: root, env: safeEnv({ PATH: 'test' }), outputBase: join(root, 'spawn-error'), wallMs: 1000,
        spawnImpl: spawnError,
      });
      expect(errored.error).toBe('executable missing');
      expect(errored.code).toBeNull();
      expect(existsSync(errored.stderrFile)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('routes verification through the real just/diff adapter and records check failures', async () => {
    const root = tempRoot('cezar-eval-check-route-');
    let runNumber = 0;
    const calls = [];
    const spawnImpl = scriptedSpawn((_call, child) => {
      const index = runNumber++ % 4;
      if (index === 0) finishChild(child, { stdout: 'tests passed\n' });
      else if (index === 1) finishChild(child, { stdout: 'scope diff captured\n' });
      else if (index === 2) finishChild(child, { stderr: 'one test failed\n', code: 2 });
      else finishChild(child, { stdout: 'scope diff captured\n' });
    }, calls);
    try {
      const deps = { processAdapters: { spawnImpl, resolveExecutable: name => `fake-${name}` }, gitImpl: (_cwd, args) => {
        expect(args).toEqual(['diff', '--name-only', 'HEAD']);
        return 'src/answer.ts';
      } };
      const first = await runCheck(root, join(root, 'hooks'), join(root, 'artifacts'), 'verify-1', { timeoutMs: 4321 }, deps);
      expect(first.passed).toBe(true);
      expect(first.changedPaths).toEqual(['src/answer.ts']);
      expect(calls.slice(0, 2).map(call => call.command)).toEqual(['fake-just', process.execPath]);
      expect(calls[0].args).toEqual(['check']);
      expect(calls[1].args).toEqual(['scripts/executor-commit.mjs', '--diff']);
      expect(JSON.parse(readFileSync(join(root, 'artifacts', 'verify-1', 'just-check.invocation.json'), 'utf8')).wallMs).toBe(4321);
      expect(JSON.parse(readFileSync(join(root, 'artifacts', 'verify-1', 'workflow-diff.invocation.json'), 'utf8')).wallMs).toBe(4321);

      const second = await runCheck(root, join(root, 'hooks'), join(root, 'artifacts'), 'verify-2', { timeoutMs: 7654 }, deps);
      expect(second.passed).toBe(false);
      expect(second.exitCode).toBe(2);
      expect(readFileSync(join(root, 'artifacts', 'verify-2', 'just-check.stderr.raw'), 'utf8')).toBe('one test failed\n');
      expect(JSON.parse(readFileSync(join(root, 'artifacts', 'verify-2', 'check.json'), 'utf8'))).toMatchObject({ phase: 'verify-2', exitCode: 2, passed: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cezar-eval workflow state machine with fake adapters', () => {
  function harness(root, { checkOutcomes, reviewResponses, mutateReview = false }) {
    const worktree = join(root, 'working-copy');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    mkdirSync(join(worktree, '.git'), { recursive: true });
    writeFileSync(join(worktree, 'src', 'thing.ts'), 'const answer = 1;\n');
    const workflow = parseWorkflow(workflowText);
    const evaluation = { base: 'base-sha' };
    const calls = [];
    const reviewPaths = [];
    let checkIndex = 0;
    let reviewIndex = 0;
    const check = async (_worktree, _hookDir, artifacts, phase, node) => {
      const passed = checkOutcomes[checkIndex++];
      calls.push({ kind: 'check', phase, timeoutMs: node.timeoutMs });
      return { phase, passed, exitCode: passed ? 0 : 1, stdoutText: passed ? 'all checks passed' : 'check failed', stderrText: '', durationMs: 4 };
    };
    const agent = async ({ node, worktree: agentTree, timeoutMs }) => {
      calls.push({ kind: 'agent', node: node.id, timeoutMs });
      if (node.id === 'review') {
        reviewPaths.push(agentTree);
        expect(existsSync(join(agentTree, '.git'))).toBe(false);
        expect(existsSync(join(agentTree, 'hidden-h2.test.ts'))).toBe(false);
        if (mutateReview) writeFileSync(join(agentTree, 'src', 'thing.ts'), 'reviewer wrote here\n');
        return { exitCode: 0, summary: `CEZ:VERDICT ${reviewResponses[reviewIndex++]}`, model: node.model, usage: { inputTokens: 2, outputTokens: 1 } };
      }
      return { exitCode: 0, summary: `${node.id} done`, model: node.model, usage: { inputTokens: 3, outputTokens: 2 } };
    };
    const command = async (_cwd, path, args, _env, output, timeoutMs) => {
      calls.push({ kind: 'command', path, args, output, timeoutMs });
      return { code: 0, durationMs: 1 };
    };
    const run = () => executeAgentWorkflow({
      order: { id: 'test-run', runner: 'codex' }, evaluation, workflow, brief: 'synthetic task data', worktree,
      artifacts: join(root, 'artifacts'), hookDir: join(root, 'hooks'), env: safeEnv({ PATH: 'test' }),
      inputModel: 'gpt-6.1-sol', reasoning: 'high', state: {}, agent, check, command,
      git: () => 'src/thing.ts', renderPrompt, nodeValues,
      createReviewWorkspace: createReadOnlyReviewWorkspace,
      snapshotReviewTree,
      changedSnapshotPaths,
      removeReviewWorkspace: path => {
        expect(path.startsWith(join(tmpdir(), 'desk-panel-cezar-review-'))).toBe(true);
        rmSync(path, { recursive: true, force: true });
      },
    });
    return { run, calls, reviewPaths, worktree };
  }

  it('routes verify failure through fix and scope, then reviewer changes through address and a final verify/review', async () => {
    const root = tempRoot('cezar-eval-workflow-transitions-');
    try {
      const flow = harness(root, { checkOutcomes: [false, true, true], reviewResponses: ['changes', 'approve'] });
      const result = await flow.run();
      expect(result.workflowCompleted).toBe(true);
      expect(result.firstVerify.passed).toBe(false);
      expect(result.finalVerify.passed).toBe(true);
      expect(result.verificationRuns).toBe(3);
      expect(result.reviewRounds).toBe(2);
      expect(flow.calls.filter(call => call.kind === 'agent').map(call => call.node)).toEqual(['fix', 'review', 'address', 'review']);
      expect(flow.calls.filter(call => call.kind === 'check').map(call => call.phase)).toEqual(['verify-1', 'verify-2', 'verify-3']);
      expect(flow.calls.filter(call => call.kind === 'command').map(call => call.path)).toEqual([
        'scripts/executor-scope.mjs', 'scripts/executor-scope.mjs',
      ]);
      expect(result.actions.map(action => action.step)).toEqual([
        'verify-1', 'fix-1', 'fix-scope-1', 'verify-2', 'review-1', 'address-1', 'address-scope', 'verify-3', 'review-2',
      ]);
      expect(result.reviewer.readOnlyGuard).toMatchObject({ separateCopy: true, noGitHistory: true, mutationPaths: [] });
      expect(existsSync(join(flow.worktree, 'hidden-h2.test.ts'))).toBe(false);
      expect(readFileSync(join(flow.worktree, 'src', 'thing.ts'), 'utf8')).toBe('const answer = 1;\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors the YAML verify retry limit and stops before review when checks remain failed', async () => {
    const root = tempRoot('cezar-eval-workflow-limits-');
    try {
      const flow = harness(root, { checkOutcomes: [false, false, false], reviewResponses: [] });
      await expect(flow.run()).rejects.toThrow(/verify-retry.exhausted/);
      expect(flow.calls.filter(call => call.kind === 'check')).toHaveLength(3);
      expect(flow.calls.filter(call => call.kind === 'agent').map(call => call.node)).toEqual(['fix', 'fix']);
      expect(flow.calls.filter(call => call.kind === 'command')).toHaveLength(2);
      expect(flow.calls.some(call => call.node === 'review')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors the YAML review retry limit and stops after the final unanswered change request', async () => {
    const root = tempRoot('cezar-eval-review-limits-');
    try {
      const flow = harness(root, { checkOutcomes: [true, true], reviewResponses: ['changes', 'changes'] });
      await expect(flow.run()).rejects.toThrow(/review-retry.exhausted/);
      expect(flow.calls.filter(call => call.kind === 'agent').map(call => call.node)).toEqual(['review', 'address', 'review']);
      expect(flow.calls.filter(call => call.kind === 'check')).toHaveLength(2);
      expect(flow.calls.filter(call => call.node === 'address')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces reviewer mutation detection and removes the changed review copy', async () => {
    const root = tempRoot('cezar-eval-review-guard-');
    try {
      const flow = harness(root, { checkOutcomes: [true], reviewResponses: ['approve'], mutateReview: true });
      await expect(flow.run()).rejects.toThrow(/reviewer mutation guard detected changes/);
      expect(readFileSync(join(flow.worktree, 'src', 'thing.ts'), 'utf8')).toBe('const answer = 1;\n');
      expect(flow.reviewPaths).toHaveLength(1);
      expect(existsSync(flow.reviewPaths[0])).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('continues after an attempt fails, reuses completed runs, and never retries partial attempts automatically', async () => {
    const root = tempRoot('cezar-eval-selected-runs-');
    const selected = ['completed', 'partial', 'fails', 'after-failure'].map(id => ({ id }));
    const calls = [];
    const output = [];
    const errorOutput = [];
    let reportWrites = 0;
    try {
      const completed = join(root, 'runs', 'completed');
      const partial = join(root, 'runs', 'partial');
      mkdirSync(completed, { recursive: true });
      mkdirSync(partial, { recursive: true });
      writeFileSync(join(completed, 'workflow-result.json'), JSON.stringify({
        id: 'completed', workflowCompleted: true, acceptance: { passed: 0, total: 1, accepted: false },
      }));
      writeFileSync(join(partial, 'trial-progress.json'), JSON.stringify({ id: 'partial', phase: 'review-1', status: 'running' }));

      const executeTrial = async order => {
        calls.push(order.id);
        const base = join(root, 'runs', order.id);
        mkdirSync(base, { recursive: true });
        if (order.id === 'fails') {
          writeFileSync(join(base, 'trial-progress.json'), JSON.stringify({ id: order.id, phase: 'implement', status: 'running' }));
          throw new Error('synthetic run failure');
        }
        writeFileSync(join(base, 'workflow-result.json'), JSON.stringify({
          id: order.id, workflowCompleted: true, acceptance: { passed: 1, total: 1, accepted: true },
        }));
      };
      const options = {
        executeTrial, writeReport: () => { reportWrites++; },
        output: message => output.push(message), errorOutput: message => errorOutput.push(message),
      };
      await processSelectedTrials(root, selected, options);
      expect(calls).toEqual(['fails', 'after-failure']);
      expect(errorOutput).toHaveLength(1);
      expect(errorOutput[0]).toContain('continuing with the next independent repeat');
      expect(readFileSync(join(root, 'runs', 'fails', 'trial-error.json'), 'utf8')).toContain('synthetic run failure');
      expect(reportWrites).toBe(4);

      await processSelectedTrials(root, selected, options);
      expect(calls).toEqual(['fails', 'after-failure']);
      expect(reportWrites).toBe(8);
      expect(output).toHaveLength(6);
      const reused = output.filter(message => message.includes('reusing saved')).map(message => message.trim());
      expect(reused.filter(message => message.startsWith('[completed]'))).toHaveLength(2);
      expect(reused.at(-1)).toBe('[after-failure] reusing saved workflow and acceptance result; no model call');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
