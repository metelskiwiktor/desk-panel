import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename as pathBasename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { arch as osArch, platform as osPlatform, release as osRelease, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { executeAgentWorkflow } from './cezar-eval-workflow.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SUITE = 'C:/Users/Viktor/.role-evals/cezar/TABL-2-H2-v4';
const DEFAULT_SOURCE = 'C:/t/hcal';
const WORKFLOW = '.ai/cezar/workflows/desk-panel-task.yaml';
const TASK = 'H2';
const FALLBACK_WALL_MS = 30 * 60_000;
const FALLBACK_IDLE_MS = 4 * 60_000;
const CHILD_ENV = [
  'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_ARCHITECTURE',
];
const TOOL_FILES = [
  WORKFLOW,
  'docs/agent-workflows/executor-brief.md',
  'scripts/dependencies.mjs',
  'scripts/executor-prepare.mjs',
  'scripts/executor-scope.mjs',
  'scripts/executor-commit.mjs',
];
const SNAPSHOT_FILES = [...TOOL_FILES, 'scripts/cezar-eval.mjs', 'scripts/cezar-eval-workflow.mjs'];
const TRIAL_SUPPORT_FILES = TOOL_FILES.filter(file => file !== WORKFLOW);
const TRIAL_ORDERS = [
  { id: 'deepseek-r1', runner: 'opencode', modelSource: 'implement', repeat: 1 },
  { id: 'codex-r1', runner: 'codex', modelSource: 'implement', repeat: 1 },
  { id: 'deepseek-r2', runner: 'opencode', modelSource: 'implement', repeat: 2 },
  { id: 'codex-r2', runner: 'codex', modelSource: 'implement', repeat: 2 },
];

function ensureInside(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing path outside suite: ${resolvedTarget}`);
  return resolvedTarget;
}

function canonicalFuturePath(path) {
  const absolute = resolve(path);
  let cursor = absolute;
  const tail = [];
  while (!existsSync(cursor)) {
    const next = dirname(cursor);
    if (next === cursor) throw new Error(`Cannot resolve path parent: ${absolute}`);
    tail.unshift(pathBasename(cursor));
    cursor = next;
  }
  return resolve(realpathSync.native(cursor), ...tail);
}

function pathsOverlap(left, right) {
  const a = canonicalFuturePath(left);
  const b = canonicalFuturePath(right);
  const relativePath = (root, target) => relative(root, target);
  const within = (root, target) => {
    const rel = relativePath(root, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  return within(a, b) || within(b, a);
}

export function assertSuiteOutsideInputs(suite, source, repository = ROOT) {
  for (const [label, path] of [['source fixture tree', source], ['source repository', repository]]) {
    if (pathsOverlap(suite, path)) throw new Error(`Evaluation suite must be disjoint from the ${label}: ${resolve(path)}`);
  }
  return resolve(suite);
}

export function removeTemporaryTree(root, target, expectedPrefix) {
  const tempRoot = canonicalFuturePath(root);
  const absolute = resolve(target);
  const resolvedTarget = canonicalFuturePath(absolute);
  const rel = relative(tempRoot, resolvedTarget);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !pathBasename(resolvedTarget).startsWith(expectedPrefix)) {
    throw new Error(`Refusing recursive deletion outside owned temporary directory: ${absolute}`);
  }
  rmSync(resolvedTarget, { recursive: true, force: true });
}

export function safeEnv(source = process.env, extra = {}) {
  const env = {};
  for (const name of CHILD_ENV) if (source[name] !== undefined) env[name] = source[name];
  env.CI = '1';
  env.NO_COLOR = '1';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  for (const [name, value] of Object.entries(extra)) {
    if (/^(DESK_|.*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY).*)$/i.test(name)) throw new Error(`Unsafe child environment key: ${name}`);
    env[name] = String(value);
  }
  return env;
}

export function parseArgs(args) {
  const [command, ...rest] = args;
  if (!['freeze', 'validate', 'run', 'report'].includes(command) && command !== '--help' && command !== '-h') {
    throw new Error('Use: node scripts/cezar-eval.mjs freeze|validate|run|report [--suite PATH]');
  }
  if (command === '--help' || command === '-h') return { command: 'help' };
  const options = { command, suite: DEFAULT_SUITE, source: DEFAULT_SOURCE };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--suite' || arg === '--source') {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      options[arg.slice(2)] = value;
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--trials') {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error('--trials requires comma-separated trial ids');
      options.trials = value.split(',').map(item => item.trim());
      if (options.trials.some(item => !item)) throw new Error('--trials contains an empty trial id');
      if (!options.trials.length || new Set(options.trials).size !== options.trials.length) throw new Error('--trials must contain unique non-empty trial ids');
    }
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseWorkflow(text) {
  const workflow = YAML.parse(text);
  if (!workflow || workflow.name !== 'desk-panel-task' || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
    throw new Error('Unsupported or malformed desk-panel-task workflow');
  }
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]));
  const edgeSet = new Set(workflow.edges.map(edge => `${edge.from}->${edge.to}`));
  const required = ['prepare', 'implement', 'implementation-scope', 'verify', 'verify-retry', 'fix', 'fix-scope', 'changed', 'review', 'review-retry', 'address', 'address-scope', 'commit', 'pr'];
  for (const id of required) if (!nodes.has(id)) throw new Error(`Workflow is missing node ${id}`);
  for (const link of [
    'start->prepare', 'prepare.pass->implement', 'prepare.fail->prepare-failed',
    'implement.done->implementation-scope', 'implementation-scope.pass->verify', 'implementation-scope.fail->scope-failed',
    'verify.pass->changed', 'verify.fail->verify-retry', 'verify-retry.repeat->fix', 'verify-retry.exhausted->verify-failed',
    'fix.done->fix-scope', 'fix-scope.pass->verify', 'fix-scope.fail->scope-failed',
    'changed.true->review', 'changed.false->no-changes', 'review.approve->commit', 'review.changes->review-retry',
    'review-retry.repeat->address', 'review-retry.exhausted->review-failed', 'address.done->address-scope',
    'address-scope.pass->verify', 'address-scope.fail->scope-failed', 'commit.pass->pr',
  ]) {
    if (!edgeSet.has(link)) throw new Error(`Workflow transition changed: ${link}`);
  }
  for (const [id, type] of Object.entries({ prepare: 'check', implement: 'agent', verify: 'check', fix: 'agent', review: 'agent', address: 'agent' })) {
    if (nodes.get(id).type !== type) throw new Error(`Workflow node type changed: ${id}`);
  }
  for (const id of ['implement', 'fix', 'review', 'address']) if (!nodes.get(id).prompt) throw new Error(`Workflow node ${id} has no prompt`);
  if (nodes.get('implement').runner !== 'opencode' || nodes.get('fix').runner !== 'opencode' || nodes.get('address').runner !== 'opencode') {
    throw new Error('The workflow executor runner changed; local evaluation adapter needs review');
  }
  if (JSON.stringify(nodes.get('review').allowedTools) !== JSON.stringify(['Read', 'Glob', 'Grep'])) {
    throw new Error('The workflow review allowedTools changed; local read-only adapter needs review');
  }
  const retries = {
    verify: nodes.get('verify-retry').max,
    review: nodes.get('review-retry').max,
  };
  if (!Number.isSafeInteger(retries.verify) || retries.verify < 0 || !Number.isSafeInteger(retries.review) || retries.review < 0) {
    throw new Error('Workflow retry limits must be non-negative integers');
  }
  for (const node of workflow.nodes) {
    if (node.timeoutMs !== undefined && (!Number.isSafeInteger(node.timeoutMs) || node.timeoutMs <= 0)) {
      throw new Error(`Workflow timeoutMs must be a positive integer: ${node.id}`);
    }
  }
  return { workflow, nodes, edgeSet, retries };
}

export function renderPrompt(template, values) {
  const rendered = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, key) => {
    if (!(key in values)) throw new Error(`No workflow value supplied for ${whole}`);
    return String(values[key] ?? '');
  });
  if (/\{\{[^{}]+\}\}/.test(rendered)) throw new Error('Workflow prompt contains unresolved interpolation');
  return rendered;
}

export function nodeValues(state, workflow) {
  const map = {};
  for (const node of workflow.nodes) {
    const value = state[node.id] ?? {};
    for (const [key, item] of Object.entries(node)) {
      if (['id', 'prompt', 'command', 'session'].includes(key)) continue;
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') map[`nodes.${node.id}.${key}`] = item;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'raw' && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) map[`nodes.${node.id}.${key}`] = item;
    }
  }
  return map;
}

export function parseJsonLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch { /* Preserve non-JSON output separately; it is not a usage event. */ }
  }
  return events;
}

export function usageFromEvents(events) {
  const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  let sawTokens = false;
  let sawCost = false;
  for (const event of events) {
    const candidates = [event?.usage, event?.data?.usage, event?.result?.usage, event?.part?.tokens, event?.tokens, event?.data?.tokens].filter(Boolean);
    for (const value of candidates) {
      const input = Number(value.input_tokens ?? value.inputTokens ?? value.input ?? value.prompt_tokens ?? value.promptTokens);
      const output = Number(value.output_tokens ?? value.outputTokens ?? value.output ?? value.completion_tokens ?? value.completionTokens);
      const cacheRead = Number(value.cache_read_input_tokens ?? value.cacheReadTokens ?? value.cache_read ?? value.cache?.read ?? 0);
      const cacheWrite = Number(value.cache_creation_input_tokens ?? value.cacheWriteTokens ?? value.cache_write ?? value.cache?.write ?? 0);
      if ([input, output, cacheRead, cacheWrite].some(Number.isFinite) && (input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0)) {
        total.inputTokens += Number.isFinite(input) ? input : 0;
        total.outputTokens += Number.isFinite(output) ? output : 0;
        total.cacheReadTokens += Number.isFinite(cacheRead) ? cacheRead : 0;
        total.cacheWriteTokens += Number.isFinite(cacheWrite) ? cacheWrite : 0;
        sawTokens = true;
      }
    }
    const cost = Number(event?.cost ?? event?.data?.cost ?? event?.part?.cost ?? event?.usage?.cost_usd ?? event?.result?.usage?.cost_usd);
    if (Number.isFinite(cost) && cost > 0) { total.costUsd += cost; sawCost = true; }
  }
  return {
    inputTokens: sawTokens ? total.inputTokens : null,
    outputTokens: sawTokens ? total.outputTokens : null,
    cacheReadTokens: sawTokens ? total.cacheReadTokens : null,
    cacheWriteTokens: sawTokens ? total.cacheWriteTokens : null,
    costUsd: sawCost ? Number(total.costUsd.toFixed(8)) : null,
  };
}

export function summarizeAcceptance(report, cases) {
  if (!report || !Array.isArray(report.testResults)) return {
    valid: false, passed: null, total: cases.length,
    cases: cases.map(item => ({ id: item.id, severity: item.severity, status: 'not-reported' })),
  };
  const assertions = report.testResults.flatMap(file => file.assertionResults ?? []);
  const caseResults = cases.map(item => {
    const match = assertions.find(assertion => `${assertion.ancestorTitles?.join(' ')} ${assertion.title}`.includes(item.id));
    return { id: item.id, severity: item.severity, status: match?.status ?? 'missing' };
  });
  return {
    valid: caseResults.every(item => item.status !== 'missing'),
    passed: caseResults.some(item => ['passed', 'failed', 'skipped', 'pending'].includes(item.status))
      ? caseResults.filter(item => item.status === 'passed').length : null,
    total: caseResults.length,
    cases: caseResults,
  };
}

function git(root, args, env = safeEnv()) {
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readSuiteManifest(suite) {
  const manifestPath = join(suite, 'evaluation.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing frozen evaluation manifest: ${manifestPath}`);
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function hashFile(file) { return sha256(readFileSync(file)); }

function copyTreeFile(sourceRoot, relativePath, targetRoot) {
  const from = ensureInside(sourceRoot, resolve(sourceRoot, relativePath));
  const to = ensureInside(targetRoot, join(targetRoot, relativePath));
  if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`Required evaluation input is missing: ${relativePath}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return hashFile(to);
}

async function freeze(options) {
  const source = resolve(options.source);
  const suite = assertSuiteOutsideInputs(options.suite, source);
  if (existsSync(suite)) throw new Error(`Refusing to overwrite existing suite: ${suite}`);
  const sourceManifestPath = join(source, 'manifest.json');
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  const task = sourceManifest.tasks?.[TASK];
  if (!sourceManifest.frozen || !task?.base || !task?.reference || !task?.brief?.path || !task?.test?.source || !Array.isArray(task.cases)) {
    throw new Error('The frozen H2 source manifest is incomplete');
  }
  mkdirSync(dirname(suite), { recursive: true });
  mkdirSync(suite, { recursive: false });
  mkdirSync(join(suite, 'source'), { recursive: true });
  mkdirSync(join(suite, 'tooling'), { recursive: true });
  copyFileSync(sourceManifestPath, join(suite, 'source', 'manifest.json'));
  const briefHash = copyTreeFile(source, task.brief.path, join(suite, 'source'));
  const hiddenSource = join(source, task.test.source);
  if (!existsSync(hiddenSource)) throw new Error(`Frozen H2 acceptance input missing: ${task.test.source}`);
  const hiddenTarget = join(suite, 'source', 'hidden-h2.test.ts');
  copyFileSync(hiddenSource, hiddenTarget);
  const hiddenHash = hashFile(hiddenTarget);
  if (briefHash !== task.brief.sha256 || hiddenHash !== task.test.sha256) throw new Error('H2 brief or hidden-test SHA-256 does not match source manifest');
  const toolHashes = {};
  for (const file of SNAPSHOT_FILES) toolHashes[file] = copyTreeFile(ROOT, file, join(suite, 'tooling'));
  const workflowText = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  const workflow = parseWorkflow(workflowText);
  const main = git(ROOT, ['rev-parse', 'HEAD']);
  const evaluation = {
    format: 1,
    id: basename(suite),
    task: TASK,
    frozenAt: new Date().toISOString(),
    sourceManifestSha256: hashFile(join(suite, 'source', 'manifest.json')),
    base: task.base,
    reference: task.reference,
    brief: { path: 'source/brief-H2.md', sha256: briefHash },
    acceptance: { path: 'source/hidden-h2.test.ts', sha256: hiddenHash, stagedAs: task.test.stagedAs },
    cases: task.cases.map(({ id, severity, baseline, reference }) => ({ id, severity, baseline, reference })),
    workflow: { path: WORKFLOW, sha256: sha256(Buffer.from(workflowText)) },
    tooling: { files: toolHashes, runnerSha256: toolHashes['scripts/cezar-eval.mjs'] },
    deskPanelMainAtFreeze: main,
    selectionRationale: 'H2 has four bounded acceptance cases, with an expected 1/4 baseline and 4/4 reference result; it gives a clear calibration for comparing two implementers on the same task.',
    environment: {
      os: `${osPlatform()} ${osRelease()}`,
      architecture: osArch(),
      node: process.version,
      workspace: 'one-commit shallow repository in the OS temp directory, outside the evaluation suite; same OS user',
    },
    runs: TRIAL_ORDERS.map(order => ({
      ...order,
      model: order.runner === 'codex' ? 'gpt-6.1-sol' : workflow.nodes.get(order.modelSource).model,
      reasoning: order.runner === 'codex' ? 'high' : 'workflow/default',
    })),
    reviewer: {
      runner: workflow.nodes.get('review').runner,
      model: workflow.nodes.get('review').model,
      reasoning: 'workflow/default',
      allowedTools: workflow.nodes.get('review').allowedTools ?? 'See review prompt; local adapter uses plan + sandbox',
    },
    localVariant: { stopsAfterReview: true, commitNode: 'not run', prNode: 'not run', autosave: 'none' },
  };
  writeJson(join(suite, 'evaluation.json'), evaluation);
  writeFileSync(join(suite, 'README.txt'), [
    'TABL-2 frozen H2 evaluation inputs and trial artifacts.',
    'The source hidden acceptance test is evaluator-only. It is copied into a trial checkout only after its agent/review workflow ends.',
    'Do not expose source/hidden-h2.test.ts or validation outputs to evaluated CLI sessions.',
  ].join('\n') + '\n');
  console.log(`Frozen ${TASK} suite ${suite}`);
  console.log(`base=${evaluation.base} reference=${evaluation.reference} brief=${briefHash} hidden=${hiddenHash}`);
}

function executable(name, env) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const output = execFileSync(command, [name], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const paths = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const selected = paths.find(value => /\.exe$/i.test(value)) ?? paths[0];
  if (!selected) throw new Error(`CLI executable not found: ${name}`);
  return selected;
}

export function createIsolatedRepository(target, sha, forbiddenSha, sourceRoot = ROOT) {
  mkdirSync(target, { recursive: true });
  execFileSync('git', ['-C', target, 'init', '--quiet'], { env: safeEnv(), stdio: 'ignore' });
  execFileSync('git', ['-C', target, 'fetch', '--quiet', '--depth=1', '--no-tags', sourceRoot, sha], { env: safeEnv(), stdio: 'ignore' });
  execFileSync('git', ['-C', target, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { env: safeEnv(), stdio: 'ignore' });
  const head = git(target, ['rev-parse', 'HEAD']);
  const shallow = git(target, ['rev-parse', '--is-shallow-repository']);
  const refs = git(target, ['for-each-ref', '--format=%(refname)']);
  const commits = Number(git(target, ['rev-list', '--all', '--count']));
  if (head !== sha || shallow !== 'true' || refs || commits !== 1) {
    throw new Error(`Isolated checkout must contain only the requested shallow commit (${sha})`);
  }
  let forbiddenCommitPresent = false;
  try {
    execFileSync('git', ['-C', target, 'cat-file', '-e', `${forbiddenSha}^{commit}`], { env: safeEnv(), stdio: 'ignore' });
    forbiddenCommitPresent = true;
  } catch { /* The opposite evaluation commit must not exist in this repository. */ }
  if (forbiddenCommitPresent) throw new Error('Isolated checkout unexpectedly contains the opposite evaluation commit');
}

function copyReviewFiles(source, target, relativePath = '') {
  const sourceDir = relativePath ? join(source, relativePath) : source;
  for (const entry of readdirSync(sourceDir)) {
    if (!relativePath && ['.git', 'node_modules'].includes(entry)) continue;
    const rel = join(relativePath, entry);
    const from = ensureInside(source, join(source, rel));
    const to = ensureInside(target, join(target, rel));
    const info = lstatSync(from);
    if (info.isSymbolicLink()) {
      const link = readlinkSync(from);
      const resolvedLink = resolve(dirname(from), link);
      const linkRel = relative(source, resolvedLink);
      if (linkRel.startsWith('..') || isAbsolute(linkRel)) continue;
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    } else if (info.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copyReviewFiles(source, target, rel);
    } else if (info.isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

export function snapshotReviewTree(root) {
  const result = {};
  const visit = directory => {
    for (const entry of readdirSync(directory)) {
      const file = join(directory, entry);
      const rel = relative(root, file).replaceAll('\\', '/');
      const info = lstatSync(file);
      if (info.isSymbolicLink()) result[rel] = `symlink:${readlinkSync(file)}`;
      else if (info.isDirectory()) visit(file);
      else if (info.isFile()) result[rel] = `file:${hashFile(file)}`;
    }
  };
  visit(root);
  return result;
}

export function changedSnapshotPaths(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(key => before[key] !== after[key]).sort();
}

export function createReadOnlyReviewWorkspace(source, prefix = 'desk-panel-cezar-review-') {
  const target = mkdtempSync(join(tmpdir(), prefix));
  try {
    copyReviewFiles(source, target);
    const snapshot = snapshotReviewTree(target);
    if (existsSync(join(target, '.git')) || existsSync(join(target, 'node_modules'))) {
      throw new Error('Reviewer copy unexpectedly includes Git history or installed dependencies');
    }
    return { path: target, snapshot };
  } catch (error) {
    removeTemporaryTree(tmpdir(), target, prefix);
    throw error;
  }
}

function trialEnv(hookDir, additions = {}) {
  return safeEnv(process.env, {
    ...additions,
    GIT_CONFIG_COUNT: 1,
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hookDir,
    GIT_OPTIONAL_LOCKS: 0,
  });
}

function basename(value) { return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value; }

function makeCommitGuard(repository) {
  const dir = join(git(repository, ['rev-parse', '--absolute-git-dir']), 'eval-hooks');
  mkdirSync(dir, { recursive: true });
  const hook = join(dir, 'reference-transaction');
  writeFileSync(hook, '#!/bin/sh\nif [ "$1" = "prepared" ]; then\n  echo "Commits are disabled in the evaluation worktree." >&2\n  exit 1\nfi\nexit 0\n', 'utf8');
  try { execFileSync('chmod', ['+x', hook], { stdio: 'ignore' }); } catch { /* Git for Windows also accepts hooks with the executable bit set by its POSIX layer. */ }
  return dir;
}

export function injectTooling(suite, worktree) {
  for (const file of TRIAL_SUPPORT_FILES) {
    const from = join(suite, 'tooling', file);
    const to = ensureInside(worktree, join(worktree, file));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  const env = safeEnv();
  const absoluteGitDir = git(worktree, ['rev-parse', '--absolute-git-dir'], env);
  const gitDir = git(worktree, ['rev-parse', '--git-path', 'info/exclude'], env);
  const exclude = isAbsolute(gitDir) ? resolve(gitDir) : resolve(worktree, gitDir);
  ensureInside(absoluteGitDir, exclude);
  mkdirSync(dirname(exclude), { recursive: true });
  const exclusions = [
    '/docs/agent-workflows/executor-brief.md', '/scripts/dependencies.mjs', '/scripts/executor-prepare.mjs',
    '/scripts/executor-scope.mjs', '/scripts/executor-commit.mjs', '/.ai/executor-base.json',
    '/.ai/implementation-scope.json', '/.ai/check-failures.json', '/.ai/screenshots/',
  ];
  let existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  for (const rule of exclusions) if (!existing.split(/\r?\n/).includes(rule)) existing += `${rule}\n`;
  writeFileSync(exclude, existing, 'utf8');
}

function commandNode(cwd, script, args, env, outputBase, wallMs = FALLBACK_WALL_MS, processAdapters = {}) {
  return runChild(process.execPath, [script, ...args], { cwd, env, outputBase, wallMs, idleMs: FALLBACK_IDLE_MS, ...processAdapters });
}

export function runChild(command, args, {
  cwd, env, outputBase, wallMs = FALLBACK_WALL_MS, idleMs = FALLBACK_IDLE_MS, stdinText,
  spawnImpl = spawn, terminateImpl = terminate,
} = {}) {
  mkdirSync(dirname(outputBase), { recursive: true });
  const stdoutFile = `${outputBase}.stdout.raw`;
  const stderrFile = `${outputBase}.stderr.raw`;
  writeFileSync(stdoutFile, Buffer.alloc(0));
  writeFileSync(stderrFile, Buffer.alloc(0));
  return new Promise(resolvePromise => {
    let child;
    let wallTimer;
    let idleTimer;
    let settled = false;
    let timedOut = null;
    let lastOutputAt = Date.now();
    const startedAt = Date.now();
    let stdoutText = '';
    let stderrText = '';
    let pulse;
    const settle = (code, signal, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      clearTimeout(idleTimer);
      clearInterval(pulse);
      const result = { code, signal, error: error?.message ?? null, timedOut, durationMs: Date.now() - startedAt, stdoutFile, stderrFile, stdoutText, stderrText };
      resolvePromise(result);
    };
    const resetIdle = () => {
      lastOutputAt = Date.now();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = 'idle-timeout';
        terminate(child);
      }, idleMs);
    };
    try {
      child = spawnImpl(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      writeJson(`${outputBase}.invocation.json`, { command, args, cwd, startedAt: new Date(startedAt).toISOString(), wallMs, idleMs });
    } catch (error) {
      settle(null, null, error);
      return;
    }
    child.stdout.on('data', chunk => {
      const bytes = Buffer.from(chunk);
      appendFileSync(stdoutFile, bytes);
      stdoutText += bytes.toString('utf8');
      resetIdle();
    });
    child.stderr.on('data', chunk => {
      const bytes = Buffer.from(chunk);
      appendFileSync(stderrFile, bytes);
      stderrText += bytes.toString('utf8');
      resetIdle();
    });
    child.on('error', error => settle(null, null, error));
    child.on('close', (code, signal) => settle(code, signal));
    wallTimer = setTimeout(() => { timedOut = 'wall-timeout'; terminateImpl(child); }, wallMs);
    idleTimer = setTimeout(() => { timedOut = 'idle-timeout'; terminateImpl(child); }, idleMs);
    pulse = setInterval(() => {
      if (!settled) process.stdout.write(`  running ${basename(outputBase)} (${Math.round((Date.now() - startedAt) / 60_000)}m; output ${Math.round((Date.now() - lastOutputAt) / 60_000)}m ago)\n`);
      else clearInterval(pulse);
    }, 60_000);
    child.stdin.end(stdinText ?? '');
  });
}

function terminate(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 15_000 }); } catch { /* The child may have exited between timeout and kill. */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

function writeActionResult(base, result, runner) {
  const events = parseJsonLines(result.stdoutText);
  const record = {
    runner,
    exitCode: result.code,
    signal: result.signal,
    error: result.error,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    usage: usageFromEvents(events),
    stdoutSha256: hashFile(result.stdoutFile),
    stderrSha256: hashFile(result.stderrFile),
    eventCount: events.length,
  };
  writeJson(`${base}.result.json`, record);
  return record;
}

export function findSummary(result) {
  const events = parseJsonLines(result.stdoutText);
  const pieces = [];
  for (const event of events) {
    const values = [event?.result?.response, event?.part?.text, event?.text, event?.message?.content, event?.content];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) pieces.push(value);
      else if (Array.isArray(value)) for (const item of value) if (typeof item?.text === 'string') pieces.push(item.text);
    }
  }
  if (!pieces.length) return result.stdoutText.trim();
  return pieces.join('\n').trim();
}

export function opencodeConfigContent(model, serverNames) {
  const servers = Object.fromEntries(serverNames.map(name => [name, {
    type: 'local',
    command: [process.execPath, '-e', 'process.exit(1)'],
    disabled: true,
  }]));
  return JSON.stringify({
    model, small_model: model,
    permission: { '*': 'allow', task: 'deny', question: 'deny', external_directory: 'deny', webfetch: 'deny' },
    mcp: { servers },
    plugin: [],
  });
}

export function openCodeMcpServerNames(config) {
  const mcp = config?.mcp;
  if (mcp === undefined || mcp === null) return [];
  if (typeof mcp !== 'object' || Array.isArray(mcp)) throw new Error('Cannot verify OpenCode MCP configuration; refusing to run');
  if (mcp.servers === undefined) {
    if (Object.keys(mcp).length === 0) return [];
    throw new Error('Unsupported OpenCode MCP config shape; refusing to enable unverified servers');
  }
  if (!mcp.servers || typeof mcp.servers !== 'object' || Array.isArray(mcp.servers)) {
    throw new Error('Cannot verify OpenCode MCP servers; refusing to run');
  }
  return Object.keys(mcp.servers);
}

export function parseOpenCodeConfig(text) {
  try { return JSON.parse(text); }
  catch { throw new Error('OpenCode debug config did not return JSON; refusing to run with unknown MCP state'); }
}

export async function runAgent({
  node, prompt, worktree, artifacts, hookDir, modelOverride, reasoning, timeoutMs,
  spawnImpl = spawn, terminateImpl = terminate, resolveExecutable = executable, execFileImpl = execFileSync,
}) {
  const runner = node.runner;
  const model = modelOverride ?? node.model;
  const codexMessagePath = join(worktree, '.eval-last-message.txt');
  const promptPath = `${artifacts}.prompt.txt`;
  let command;
  let args;
  let env = trialEnv(hookDir);
  if (runner === 'opencode') {
    command = resolveExecutable('opencode', safeEnv());
    const configText = execFileImpl(command, ['debug', 'config', '--pure'], {
      cwd: worktree, env: safeEnv(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
      maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const configuredServers = openCodeMcpServerNames(parseOpenCodeConfig(configText));
    env = trialEnv(hookDir, { OPENCODE_CONFIG_CONTENT: opencodeConfigContent(model, configuredServers) });
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, prompt, 'utf8');
    args = [
      'run', '--pure', '--format', 'json', '--model', model, '--dir', worktree, '--title', basename(artifacts),
      '--file', promptPath, '--', 'Follow the attached workflow instructions in full.',
    ];
  } else if (runner === 'codex') {
    command = resolveExecutable('codex', safeEnv());
    args = [
      'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--disable', 'multi_agent', '--sandbox', 'workspace-write',
      '--cd', worktree, '-m', model, '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"',
      '-c', 'sandbox_mode="workspace-write"', '-o', codexMessagePath, '-',
    ];
    reasoning = 'high';
  } else if (runner === 'agy') {
    command = resolveExecutable('agy', safeEnv());
    args = [
      '--model', model, '--mode', 'plan', '--sandbox', '--output-format', 'stream-json',
      '--input-format', 'stream-json', '-p', '',
    ];
  } else throw new Error(`Unsupported workflow runner: ${runner}`);
  const timeout = timeoutMs ?? node.timeoutMs ?? FALLBACK_WALL_MS;
  const stdinText = runner === 'codex'
    ? prompt
    : runner === 'agy'
      ? `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`
      : '';
  const result = await runChild(command, args, {
    cwd: worktree, env, outputBase: artifacts, wallMs: timeout, idleMs: FALLBACK_IDLE_MS,
    stdinText, spawnImpl, terminateImpl,
  });
  const record = writeActionResult(artifacts, result, runner);
  const summary = runner === 'codex' && existsSync(codexMessagePath)
    ? readFileSync(codexMessagePath, 'utf8').trim()
    : findSummary(result);
  if (runner === 'codex' && existsSync(codexMessagePath)) {
    copyFileSync(codexMessagePath, `${artifacts}.last-message.txt`);
    rmSync(codexMessagePath);
  }
  writeFileSync(`${artifacts}.summary.txt`, summary, 'utf8');
  return { ...record, model, reasoning: reasoning ?? 'workflow/default', summary, raw: result };
}

function localCommand(name, cwd, args, env, artifacts, timeoutMs = FALLBACK_WALL_MS, processAdapters = {}) {
  const resolveExecutable = processAdapters.resolveExecutable ?? executable;
  const command = isAbsolute(name) ? name : resolveExecutable(name, safeEnv());
  return runChild(command, args, { cwd, env, outputBase: artifacts, wallMs: timeoutMs, idleMs: FALLBACK_IDLE_MS, ...processAdapters });
}

export async function runCheck(worktree, hookDir, artifacts, phase, node = {}, { processAdapters = {}, gitImpl = git } = {}) {
  const env = trialEnv(hookDir);
  const timeout = node.timeoutMs ?? FALLBACK_WALL_MS;
  const check = await localCommand('just', worktree, ['check'], env, join(artifacts, phase, 'just-check'), timeout, processAdapters);
  const diff = await commandNode(worktree, 'scripts/executor-commit.mjs', ['--diff'], env, join(artifacts, phase, 'workflow-diff'), timeout, processAdapters);
  const diffNames = gitImpl(worktree, ['diff', '--name-only', 'HEAD'], env).split(/\r?\n/).filter(Boolean);
  const checkRecord = {
    phase,
    exitCode: check.code,
    signal: check.signal,
    error: check.error,
    timedOut: check.timedOut,
    durationMs: check.durationMs,
    diffExitCode: diff.code,
    diffError: diff.error,
    diffTimedOut: diff.timedOut,
    changedPaths: diffNames,
    passed: check.code === 0 && diff.code === 0 && !check.timedOut && !diff.timedOut,
  };
  writeJson(join(artifacts, phase, 'check.json'), checkRecord);
  return { ...checkRecord, stdoutText: check.stdoutText, stderrText: check.stderrText };
}

function checkHeadAndCommits(worktree, expectedSha, env) {
  const head = git(worktree, ['rev-parse', 'HEAD'], env);
  const commits = Number(git(worktree, ['rev-list', '--count', expectedSha + '..HEAD'], env));
  return { head, commits, unchanged: head === expectedSha && commits === 0 };
}

export async function runTrial(order, suite, evaluation, workflow) {
  const base = ensureInside(suite, resolve(suite, 'runs', order.id));
  if (existsSync(base)) throw new Error('Trial artifacts already exist; refusing to overwrite: ' + base);
  mkdirSync(base, { recursive: true });
  const startedAt = Date.now();
  const progress = {
    id: order.id, status: 'running', phase: 'prepare', startedAt: new Date(startedAt).toISOString(),
    actions: [], workflow: null,
  };
  const progressFile = join(base, 'trial-progress.json');
  const saveProgress = (phase, extra = {}) => {
    progress.phase = phase;
    progress.updatedAt = new Date().toISOString();
    Object.assign(progress, extra);
    writeJson(progressFile, progress);
  };
  const worktree = mkdtempSync(join(tmpdir(), 'desk-panel-cezar-' + order.id + '-'));
  let stagedTest = null;
  try {
    saveProgress('isolate-base');
    createIsolatedRepository(worktree, evaluation.base, evaluation.reference);
    const hookDir = makeCommitGuard(worktree);
    const env = trialEnv(hookDir);
    injectTooling(suite, worktree);

    const prepareNode = workflow.nodes.get('prepare');
    saveProgress('prepare');
    const prepare = await commandNode(worktree, 'scripts/executor-prepare.mjs', [], env, join(base, 'prepare'), prepareNode.timeoutMs ?? FALLBACK_WALL_MS);
    const prepareRecord = writeActionResult(join(base, 'prepare'), prepare, 'node');
    progress.actions.push({ step: 'prepare', exitCode: prepare.code, error: prepare.error, timedOut: prepare.timedOut, durationMs: prepare.durationMs, usage: prepareRecord.usage });
    saveProgress('prepare', { actions: [...progress.actions] });
    if (prepare.code !== 0 || prepare.timedOut) throw new Error(order.id + ': prepare failed; see ' + base);

    const brief = readFileSync(join(suite, 'source', 'brief-H2.md'), 'utf8');
    const inputModel = order.runner === 'codex' ? 'gpt-6.1-sol' : workflow.nodes.get('implement').model;
    const reasoning = order.runner === 'codex' ? 'high' : undefined;
    const state = {};
    const implementNode = workflow.nodes.get('implement');
    const implementPrompt = renderPrompt(implementNode.prompt, { task: brief, ...nodeValues(state, workflow.workflow) });
    saveProgress('implement');
    const implement = await runAgent({
      node: { ...implementNode, runner: order.runner }, prompt: implementPrompt, worktree,
      artifacts: join(base, 'implement'), hookDir, modelOverride: inputModel, reasoning,
      timeoutMs: implementNode.timeoutMs,
    });
    state.implement = implement;
    progress.actions.push({
      step: 'implement', exitCode: implement.exitCode, error: implement.error, timedOut: implement.timedOut,
      durationMs: implement.durationMs, model: inputModel, reasoning: implement.reasoning, usage: implement.usage,
    });
    saveProgress('implement', { actions: [...progress.actions] });
    if (implement.exitCode !== 0) throw new Error(order.id + ': implement CLI failed; see ' + base);

    saveProgress('implementation-scope');
    const scopeNode = workflow.nodes.get('implementation-scope');
    const scope = await commandNode(worktree, 'scripts/executor-scope.mjs', ['--save'], env, join(base, 'implementation-scope'), scopeNode.timeoutMs ?? FALLBACK_WALL_MS);
    const scopeRecord = writeActionResult(join(base, 'implementation-scope'), scope, 'node');
    progress.actions.push({ step: 'implementation-scope', exitCode: scope.code, error: scope.error, timedOut: scope.timedOut, durationMs: scope.durationMs, usage: scopeRecord.usage });
    saveProgress('implementation-scope', { actions: [...progress.actions] });
    if (scope.code !== 0) throw new Error(order.id + ': implementation scope could not be saved; see ' + base);
    state['implementation-scope'] = { summary: 'implementation-scope passed' };

    const preWorkflowActions = [...progress.actions];
    const runResult = await executeAgentWorkflow({
      order, evaluation, workflow, brief, worktree, artifacts: base, hookDir, env, inputModel, reasoning, state,
      agent: runAgent, check: runCheck, command: commandNode, git, renderPrompt, nodeValues,
      createReviewWorkspace: createReadOnlyReviewWorkspace,
      snapshotReviewTree,
      changedSnapshotPaths,
      removeReviewWorkspace: path => removeTemporaryTree(tmpdir(), path, 'desk-panel-cezar-review-'),
      onPhase: (phase, context) => {
        saveProgress(phase, {
          actions: [...preWorkflowActions, ...context.actions],
          workflow: {
            verifyCount: context.verifyCount, fixCount: context.fixCount, reviewCount: context.reviewCount,
            firstVerify: context.firstVerify, finalVerify: context.finalVerify,
          },
        });
      },
    });
    progress.actions = [...preWorkflowActions, ...runResult.actions];
    const beforeAcceptance = git(worktree, ['diff', '--binary', 'HEAD'], env);
    const result = {
      id: order.id,
      ...runResult,
      noCommitNodeRun: true,
      noPrNodeRun: true,
      head: checkHeadAndCommits(worktree, evaluation.base, env),
      actions: [...progress.actions],
      startedAt: progress.startedAt,
      durationMs: Date.now() - startedAt,
    };
    writeFileSync(join(base, 'diff-before-acceptance.patch'), beforeAcceptance, 'utf8');
    saveProgress('acceptance', {
      actions: [...progress.actions],
      workflow: {
        workflowCompleted: true,
        firstVerify: result.firstVerify, finalVerify: result.finalVerify,
        verificationRuns: result.verificationRuns, reviewRounds: result.reviewRounds,
        reviewerVerdict: result.reviewer.verdict, changedPaths: result.changedPaths,
      },
      modelActivityEndedAt: new Date().toISOString(),
    });

    stagedTest = ensureInside(worktree, join(worktree, evaluation.acceptance.stagedAs));
    if (existsSync(stagedTest)) throw new Error(order.id + ': hidden acceptance staging path already exists; refusing to overwrite');
    mkdirSync(dirname(stagedTest), { recursive: true });
    copyFileSync(join(suite, evaluation.acceptance.path), stagedTest);
    const acceptanceDir = join(base, 'acceptance');
    mkdirSync(acceptanceDir, { recursive: true });
    let acceptance;
    let parsed;
    let reportError = null;
    let stagedHash = null;
    try {
      stagedHash = hashFile(stagedTest);
      if (stagedHash !== evaluation.acceptance.sha256) throw new Error(order.id + ': hidden test hash changed while staging');
      acceptance = await localCommand(process.execPath, worktree, [
        join(worktree, 'node_modules/vitest/vitest.mjs'), 'run', evaluation.acceptance.stagedAs,
        '--reporter=verbose', '--reporter=json', '--outputFile=' + join(acceptanceDir, 'hidden.json'),
      ], env, join(acceptanceDir, 'hidden-test'), FALLBACK_WALL_MS);
      const jsonFile = join(acceptanceDir, 'hidden.json');
      if (existsSync(jsonFile)) {
        try { parsed = summarizeAcceptance(JSON.parse(readFileSync(jsonFile, 'utf8')), evaluation.cases); }
        catch (error) {
          reportError = error instanceof Error ? error.message : String(error);
          parsed = summarizeAcceptance(null, evaluation.cases);
        }
      } else parsed = summarizeAcceptance(null, evaluation.cases);
    } finally {
      if (existsSync(stagedTest)) rmSync(stagedTest);
    }
    const afterAcceptanceDiff = git(worktree, ['diff', '--binary', 'HEAD'], env);
    const removedOnlyTest = !existsSync(stagedTest) && beforeAcceptance === afterAcceptanceDiff;
    const acceptanceResult = {
      exitCode: acceptance.code,
      processError: acceptance.error,
      signal: acceptance.signal,
      timedOut: acceptance.timedOut,
      durationMs: acceptance.durationMs,
      usage: usageFromEvents(parseJsonLines(acceptance.stdoutText)),
      reportError,
      stagedSha256: stagedHash,
      removedOnlyStagedTest: removedOnlyTest,
      ...parsed,
      accepted: acceptance.code === 0 && parsed.valid && parsed.passed === parsed.total && removedOnlyTest,
    };
    writeJson(join(acceptanceDir, 'acceptance-result.json'), acceptanceResult);
    result.acceptance = acceptanceResult;
    result.durationMs = Date.now() - startedAt;
    writeJson(join(base, 'workflow-result.json'), result);
    saveProgress('complete', { status: 'complete', acceptance: acceptanceResult, actions: [...progress.actions] });
    process.stdout.write('[' + order.id + '] complete: review=' + result.reviewer.verdict + ', hidden=' + String(acceptanceResult.passed ?? 'N/D') + '/' + acceptanceResult.total + '\n');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const context = error?.workflowContext ?? {};
    const completedActions = progress.actions ?? [];
    const lastAction = completedActions.at(-1);
    const failure = {
      id: order.id, status: 'incomplete', phase: context.phase ?? progress.phase,
      workflowCompleted: progress.workflow?.workflowCompleted === true,
      error: message, errorType: error instanceof Error ? error.name : 'Error',
      errorKind: lastAction?.timedOut ? 'timeout' : 'workflow-error',
      timedOut: lastAction?.timedOut ?? null,
      startedAt: progress.startedAt, durationMs: Date.now() - startedAt,
      firstVerify: context.firstVerify ?? progress.workflow?.firstVerify ?? null,
      finalVerify: context.finalVerify ?? progress.workflow?.finalVerify ?? null,
      verificationRuns: context.verificationRuns ?? progress.workflow?.verifyCount ?? null,
      reviewRounds: context.reviewRounds ?? progress.workflow?.reviewCount ?? null,
      reviewerVerdict: context.reviewerVerdict ?? progress.workflow?.reviewerVerdict ?? null,
      actions: completedActions,
      acceptance: existsSync(join(base, 'acceptance', 'acceptance-result.json'))
        ? JSON.parse(readFileSync(join(base, 'acceptance', 'acceptance-result.json'), 'utf8')) : null,
      resumable: false,
      retryPolicy: 'automatic retry disabled; preserve this attempt and use a new suite version for an explicit rerun',
    };
    writeJson(join(base, 'trial-error.json'), failure);
    saveProgress('failed', { status: 'incomplete', error: failure });
    throw error;
  } finally {
    if (stagedTest && existsSync(stagedTest)) rmSync(stagedTest);
    removeTemporaryTree(tmpdir(), worktree, 'desk-panel-cezar-' + order.id + '-');
  }
}
async function validateInputs(suite, { strictCurrent = true } = {}) {
  assertSuiteOutsideInputs(suite, DEFAULT_SOURCE, ROOT);
  const evaluation = readSuiteManifest(suite);
  if (evaluation.task !== TASK || !/^TABL-2-H2-v\d+$/.test(evaluation.id)) throw new Error('Unexpected evaluation suite identity');
  for (const item of [evaluation.brief, evaluation.acceptance]) {
    if (hashFile(join(suite, item.path)) !== item.sha256) throw new Error(`Frozen input hash mismatch: ${item.path}`);
  }
  if (hashFile(join(suite, 'source', 'manifest.json')) !== evaluation.sourceManifestSha256) throw new Error('Frozen source manifest hash mismatch');
  const workflowText = readFileSync(join(suite, 'tooling', WORKFLOW), 'utf8');
  const workflowHash = sha256(Buffer.from(workflowText));
  if (workflowHash !== evaluation.workflow.sha256) throw new Error('Frozen workflow hash mismatch');
  if (strictCurrent && sha256(Buffer.from(readFileSync(join(ROOT, WORKFLOW), 'utf8'))) !== workflowHash) throw new Error('Current workflow changed since freeze; freeze a new suite version');
  for (const [file, hash] of Object.entries(evaluation.tooling.files)) {
    if (hashFile(join(suite, 'tooling', file)) !== hash) throw new Error(`Frozen tooling hash mismatch: ${file}`);
    if (strictCurrent && hashFile(join(ROOT, file)) !== hash) throw new Error(`Current tooling changed since freeze: ${file}; freeze a new suite version`);
  }
  if (strictCurrent && hashFile(fileURLToPath(import.meta.url)) !== evaluation.tooling.runnerSha256) throw new Error('Runner changed since freeze; freeze a new suite version');
  return { evaluation, parsed: parseWorkflow(workflowText) };
}

async function validateBaseAndReference(suite, evaluation) {
  const taskManifest = JSON.parse(readFileSync(join(suite, 'source', 'manifest.json'), 'utf8')).tasks[TASK];
  const testPath = evaluation.acceptance.stagedAs;
  const results = [];
  for (const variant of [
    { name: 'baseline', sha: evaluation.base, expected: 'baseline' },
    { name: 'reference', sha: evaluation.reference, expected: 'reference' },
  ]) {
    const dir = join(suite, 'validation', variant.name);
    const existingResult = join(suite, 'validation', `${variant.name}-result.json`);
    if (existsSync(existingResult)) {
      const record = JSON.parse(readFileSync(existingResult, 'utf8'));
      if (record.commit !== variant.sha || !record.valid || !record.matchesExpected) throw new Error(`Existing ${variant.name} validation is incomplete or mismatched`);
      results.push(record);
      process.stdout.write(`${variant.name}: reused validated result ${record.passed}/${record.total}\n`);
      continue;
    }
    if (existsSync(dir)) throw new Error(`Validation worktree already exists: ${dir}`);
    const opposite = variant.name === 'baseline' ? evaluation.reference : evaluation.base;
    createIsolatedRepository(dir, variant.sha, opposite);
    const staged = ensureInside(dir, join(dir, testPath));
    mkdirSync(dirname(staged), { recursive: true });
    copyFileSync(join(suite, evaluation.acceptance.path), staged);
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!existsSync(npmCli)) throw new Error(`npm CLI entrypoint not found beside Node: ${npmCli}`);
    const install = await runChild(process.execPath, [npmCli, 'ci', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: dir, env: safeEnv(), outputBase: join(suite, 'validation', `${variant.name}-npm-ci`), wallMs: 10 * 60_000, idleMs: FALLBACK_IDLE_MS,
    });
    if (install.code !== 0) throw new Error(`${variant.name} npm ci failed; see validation logs`);
    const output = join(suite, 'validation', `${variant.name}-acceptance`);
    const test = await runChild(process.execPath, [
      join(dir, 'node_modules/vitest/vitest.mjs'), 'run', testPath, '--reporter=verbose', '--reporter=json', `--outputFile=${output}.json`,
    ], { cwd: dir, env: safeEnv(), outputBase: output, wallMs: FALLBACK_WALL_MS, idleMs: FALLBACK_IDLE_MS });
    const parsedReport = existsSync(`${output}.json`) ? JSON.parse(readFileSync(`${output}.json`, 'utf8')) : null;
    const summary = summarizeAcceptance(parsedReport, evaluation.cases);
    let typecheck = null;
    if (variant.name === 'reference') {
      const tsc = join(dir, 'node_modules', 'typescript', 'lib', 'tsc.js');
      typecheck = await runChild(process.execPath, [tsc, '--noEmit'], {
        cwd: dir, env: safeEnv(), outputBase: join(suite, 'validation', 'reference-typecheck'), wallMs: FALLBACK_WALL_MS, idleMs: FALLBACK_IDLE_MS,
      });
    }
    const expected = taskManifest.cases.map(item => ({ id: item.id, status: item[variant.expected] }));
    const matchesExpected = expected.every(item => summary.cases.some(actual => actual.id === item.id && actual.status === item.status));
    rmSync(staged);
    const record = {
      variant: variant.name, commit: variant.sha, installExitCode: install.code, testExitCode: test.code,
      typecheckExitCode: typecheck?.code ?? null, matchesExpected, expected, ...summary,
    };
    writeJson(join(suite, 'validation', `${variant.name}-result.json`), record);
    results.push(record);
    process.stdout.write(`${variant.name}: ${summary.passed}/${summary.total}; expected pattern ${matchesExpected ? 'matches' : 'MISMATCH'}\n`);
  }
  if (results.some(item => !item.valid || !item.matchesExpected || (item.variant === 'reference' && item.typecheckExitCode !== 0))) throw new Error('Baseline/reference validation did not match frozen expectations or reference typecheck failed');
  return results;
}

function readResult(suite, order) {
  const file = join(suite, 'runs', order.id, 'workflow-result.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const errorFile = join(suite, 'runs', order.id, 'trial-error.json');
  if (existsSync(errorFile)) return { ...JSON.parse(readFileSync(errorFile, 'utf8')), errorRecord: true };
  const progressFile = join(suite, 'runs', order.id, 'trial-progress.json');
  if (existsSync(progressFile)) {
    const progress = JSON.parse(readFileSync(progressFile, 'utf8'));
    return {
      ...progress,
      workflowCompleted: progress.workflow?.workflowCompleted === true,
      firstVerify: progress.workflow?.firstVerify ?? null,
      finalVerify: progress.workflow?.finalVerify ?? null,
      reviewerVerdict: progress.workflow?.reviewerVerdict ?? null,
      errorRecord: true,
      interrupted: true,
      errorMessage: 'Process ended before workflow-result.json was written',
    };
  }
  return null;
}

export function trialDisposition(runDirectoryExists, result) {
  if (!runDirectoryExists) return 'run';
  if (result?.workflowCompleted && result.acceptance) return 'reuse';
  return 'preserve';
}

export async function processSelectedTrials(suite, selected, { executeTrial, writeReport, output = () => {}, errorOutput = () => {} }) {
  for (const order of selected) {
    const base = join(suite, 'runs', order.id);
    const directoryExists = existsSync(base);
    const prior = directoryExists ? readResult(suite, order) : null;
    const disposition = trialDisposition(directoryExists, prior);
    if (disposition === 'reuse') output(`[${order.id}] reusing saved workflow and acceptance result; no model call\n`);
    else if (disposition === 'preserve') output(`[${order.id}] preserving existing partial attempt; no automatic retry or model call\n`);
    else {
      try {
        await executeTrial(order);
      } catch (error) {
        if (!existsSync(join(base, 'trial-error.json'))) writeJson(join(base, 'trial-error.json'), {
          id: order.id, status: 'incomplete', phase: 'startup', error: error instanceof Error ? error.message : String(error),
          recordedAt: new Date().toISOString(), resumable: false,
        });
        errorOutput(`[${order.id}] trial error recorded; continuing with the next independent repeat\n`);
      }
    }
    writeReport();
  }
}

function formatNumber(value) { return value === null || value === undefined ? 'N/D' : Number(value).toLocaleString('en-US'); }
function formatPass(result) {
  if (!result?.acceptance) return 'N/D · nieuruchomiono';
  if (result.acceptance.passed === null || result.acceptance.passed === undefined) return 'N/D · brak wyniku';
  const known = result.acceptance.cases?.filter(item => ['passed', 'failed', 'skipped', 'pending'].includes(item.status)).length ?? 0;
  const total = result.acceptance.total ?? result.acceptance.cases?.length ?? 0;
  return `${result.acceptance.passed}/${total}${known < total ? ` · częściowe, ${total - known} N/D` : ''}`;
}

function actionMetrics(actions = []) {
  const modelActions = actions.filter(action => action.step === 'implement' || /^(fix|address|review)-\d+$/.test(action.step ?? ''));
  const metric = key => {
    const values = modelActions.map(action => action.usage?.[key]).filter(Number.isFinite);
    if (!values.length) return 'N/D';
    const text = formatNumber(values.reduce((sum, value) => sum + value, 0));
    return values.length === modelActions.length ? text : `${text} (częściowe ${values.length}/${modelActions.length})`;
  };
  const costs = modelActions.map(action => action.usage?.costUsd).filter(Number.isFinite);
  const cost = costs.length
    ? `$${costs.reduce((sum, value) => sum + value, 0).toFixed(4)}${costs.length < modelActions.length ? ` (częściowe ${costs.length}/${modelActions.length})` : ''}`
    : 'N/D';
  return { tokens: `${metric('inputTokens')} / ${metric('outputTokens')}`, cost };
}

const KNOWN_ACCEPTANCE_STATUSES = new Set(['passed', 'failed', 'skipped', 'pending']);

function caseStatus(result, id) {
  const status = result?.acceptance?.cases?.find(item => item.id === id)?.status;
  return KNOWN_ACCEPTANCE_STATUSES.has(status) ? status : null;
}

function compactError(value) {
  return String(value ?? 'brak szczegółów').replace(/[\r\n|]+/g, ' ').slice(0, 500);
}

export function buildReport(evaluation, results, validation = []) {
  const attempted = TRIAL_ORDERS.map(order => results.find(item => item?.id === order.id)).filter(Boolean);
  const completed = attempted.filter(result => result.workflowCompleted && result.acceptance).length;
  const experimentStatus = attempted.length === 0
    ? 'NIEPRZEPROWADZONY — 0/4 prób; uruchomienie odłożono decyzją użytkownika'
    : completed < TRIAL_ORDERS.length
      ? `NIEPEŁNY — ukończono ${completed}/4 prób; zapisano ${attempted.length}/4 przebiegów, pozostałe nieukończone lub nieuruchomione`
      : '4/4 próby zapisane; odbiór wymaga analizy wyników i dowodów';
  const toolingHashes = Object.entries(evaluation.tooling.files ?? {})
    .map(([file, hash]) => `${file}=${hash}`).join('; ') || 'N/D';
  const environment = evaluation.environment
    ? `${evaluation.environment.os} · ${evaluation.environment.architecture} · Node ${evaluation.environment.node} · ${evaluation.environment.workspace}`
    : 'N/D';
  const lines = [
    '# TABL-2 — wyniki pilota H2', '',
    `Zestaw: **${evaluation.id}**; base \`${evaluation.base}\`; reference \`${evaluation.reference}\`.`,
    `Brief SHA-256: \`${evaluation.brief.sha256}\`; workflow SHA-256: \`${evaluation.workflow.sha256}\`; runner SHA-256: \`${evaluation.tooling.runnerSha256}\`.`,
    `DeskPanel main przy zamrożeniu: \`${evaluation.deskPanelMainAtFreeze ?? 'N/D'}\`; manifest SHA-256: \`${evaluation.sourceManifestSha256 ?? 'N/D'}\`; ukryty test SHA-256: \`${evaluation.acceptance.sha256 ?? 'N/D'}\`.`,
    `Pliki narzędzi SHA-256: ${toolingHashes}.`,
    `Środowisko: ${environment}.`,
    `Uzasadnienie H2: ${evaluation.selectionRationale ?? 'N/D'}`,
    `Status eksperymentu: **${experimentStatus}**.`,
    '',
    '## Kontrola zestawu', '',
    '| Punkt | Commit | Wynik testów | Zgodny z manifestem |',
    '| --- | --- | ---: | --- |',
    ...['baseline', 'reference'].map(name => {
      const item = validation.find(entry => entry.variant === name);
      return item ? `| ${name} | \`${item.commit}\` | ${item.passed ?? 'N/D'}/${item.total ?? 'N/D'} | ${item.matchesExpected ? 'tak' : item.matchesExpected === false ? 'nie' : 'N/D'} |` : `| ${name} | brak | N/D | brak dowodu |`;
    }),
    '',
    '## Próby', '',
    '| Próba | Obsada implement/fix/address | Reviewer | Pierwszy verify | Ostatni verify | Ukryta akceptacja | Ukończono do review | Czas | Tokeny wej./wyj. | Koszt | Commity |',
    '| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |',
  ];
  for (const order of TRIAL_ORDERS) {
    const result = results.find(item => item?.id === order.id);
    if (!result) {
      const plan = evaluation.runs?.find(item => item.id === order.id);
      const runner = plan?.runner ?? order.runner;
      const model = plan?.model ?? (runner === 'codex' ? 'gpt-6.1-sol' : 'model z workflow');
      const reasoning = plan?.reasoning === 'high' ? ' · high' : ' · workflow/default';
      const review = evaluation.reviewer ? `${evaluation.reviewer.runner} · ${evaluation.reviewer.model} (nieuruchomiony)` : 'agy z workflow (nieuruchomiony)';
      lines.push(`| ${order.id} | ${runner} · ${model}${reasoning} | ${review} | N/D · nie uruchomiono | N/D · nie uruchomiono | N/D · nie uruchomiono | nie uruchomiono | N/D | N/D | N/D | N/D |`);
      continue;
    }
    const plan = evaluation.runs?.find(item => item.id === order.id);
    const runner = result.runner ?? plan?.runner ?? order.runner;
    const model = result.model ?? plan?.model ?? (runner === 'codex' ? 'gpt-6.1-sol' : 'model z workflow');
    const reasoning = result.reasoning ?? plan?.reasoning ?? (runner === 'codex' ? 'high' : 'workflow/default');
    const reviewer = result.reviewer ?? {};
    const reviewerVerdict = reviewer.verdict ?? result.reviewerVerdict ?? 'N/D';
    const reviewerText = `${reviewer.runner ?? evaluation.reviewer?.runner ?? 'agy'} · ${reviewer.model ?? evaluation.reviewer?.model ?? 'workflow'} · ${reviewerVerdict}`;
    const verifyLabel = verify => verify?.passed === true ? 'pass' : verify?.passed === false ? 'fail' : 'N/D';
    const firstVerify = result.firstVerify ?? result.workflow?.firstVerify;
    const finalVerify = result.finalVerify ?? result.workflow?.finalVerify;
    const metrics = actionMetrics(result.actions);
    const completionLabel = result.workflowCompleted ? 'tak' : `nie · ${result.phase ?? 'przerwano'}`;
    const duration = Number.isFinite(result.durationMs) ? `${(result.durationMs / 60000).toFixed(1)} min` : 'N/D';
    lines.push(`| ${result.id} | ${runner} · ${model}${reasoning === 'high' ? ' · high' : reasoning === 'workflow/default' ? ' · workflow/default' : ''} | ${reviewerText} | ${verifyLabel(firstVerify)} | ${verifyLabel(finalVerify)} | ${formatPass(result)} | ${compactError(completionLabel)} | ${duration} | ${metrics.tokens} | ${metrics.cost} | ${result.head?.commits ?? 'N/D'} |`);
  }
  lines.push('', '## Akceptacja według klasy', '', '| Próba | Ogółem | P1 | P2 |', '| --- | ---: | ---: | ---: |');
  for (const order of TRIAL_ORDERS) {
    const result = results.find(item => item?.id === order.id);
    const byClass = severity => {
      const expected = evaluation.cases.filter(item => item.severity === severity).length;
      const known = result?.acceptance?.cases?.filter(item => item.severity === severity && KNOWN_ACCEPTANCE_STATUSES.has(item.status)) ?? [];
      if (!known.length) return 'N/D';
      const passed = known.filter(item => item.status === 'passed').length;
      return `${passed}/${known.length}${known.length < expected ? ` · częściowe, ${expected - known.length} N/D` : ''}`;
    };
    lines.push(`| ${order.id} | ${result ? formatPass(result) : 'N/D · nieuruchomiono'} | ${byClass('P1')} | ${byClass('P2')} |`);
  }
  lines.push('', '## Przypadki ukrytej akceptacji', '', '| Przypadek | Klasa | DeepSeek r1 | DeepSeek r2 | Codex r1 | Codex r2 |', '| --- | --- | --- | --- | --- | --- |');
  for (const item of evaluation.cases) {
    const cell = id => {
      const trial = results.find(result => result?.id === id);
      return caseStatus(trial, item.id) ?? 'N/D (nieraportowany)';
    };
    lines.push(`| ${item.id} | ${item.severity} | ${cell('deepseek-r1')} | ${cell('deepseek-r2')} | ${cell('codex-r1')} | ${cell('codex-r2')} |`);
  }
  lines.push('', '## Powtarzalność i ograniczenia', '');
  for (const model of ['DeepSeek (OpenCode)', 'Codex gpt-6.1-sol high']) {
    const ids = model.startsWith('Deep') ? ['deepseek-r1', 'deepseek-r2'] : ['codex-r1', 'codex-r2'];
    const pair = ids.map(id => results.find(result => result?.id === id));
    const completePair = pair.every(result => result?.acceptance && evaluation.cases.every(item => caseStatus(result, item.id)));
    const agreement = completePair && evaluation.cases.every(item => caseStatus(pair[0], item.id) === caseStatus(pair[1], item.id));
    lines.push(`- ${model}: zgodność wyników przypadków w dwóch powtórzeniach — ${completePair ? agreement ? 'tak' : 'nie' : 'N/D (brak dwóch kompletnych raportów akceptacji)'}.`);
  }
  lines.push(
    '- Koszt subskrypcji Codexa i koszt Agy są N/D; koszt OpenRouter tylko wtedy, gdy CLI raportuje go w surowym strumieniu.',
    '- Tokeny i czas pochodzą z zapisanych logów/metryk. Brak pola kosztu nie jest szacowany.',
    '- Lokalny adapter czyta prompty, modele, retry i przejścia z zamrożonego YAML. Uruchamia lokalny prepare, implement, verify, warunkowe fix/address i read-only review; zatrzymuje się przed commit i PR. Cezar nie był dispatchowany.',
    '- Reviewer działa w osobnej tymczasowej kopii bez .git, historii, referencji i ukrytego testu; po runie porównanie snapshotu wykrywa zmiany, a kopia jest usuwana. Agy dostaje tryb plan + sandbox, OpenCode jawnie wyłącza skonfigurowane MCP. To ograniczenia narzędzia i CLI w tym samym koncie Windows, nie izolacja systemowa od wykonawcy.',
    '- Porównanie obejmuje jedno zadanie i dwie powtórki na obsadę. Wynik nie wyznacza progu jakości roli ani nie izoluje statystycznie wpływu losowości/providerów.',
    '',
  );
  const failures = results.flatMap(result => {
    if (!result) return [];
    const items = (result.acceptance?.cases ?? []).filter(item => item.status !== 'passed').map(item => ({
      trial: result.id, case: item.id, severity: item.severity, status: item.status,
      attribution: 'nierozstrzygnięta — wynik zapisano; wymaga porównania testu, diffu i przebiegu review',
      evidence: `runs/${result.id}/acceptance/acceptance-result.json; runs/${result.id}/acceptance/hidden.json; runs/${result.id}/acceptance/hidden-test.stdout.raw; runs/${result.id}/diff-before-acceptance.patch`,
    }));
    if (result.firstVerify && !result.firstVerify.passed) items.push({
      trial: result.id, case: 'just check (pierwszy verify)', severity: '—', status: 'failed',
      attribution: 'nierozstrzygnięta — surowy wynik just check zachowany; przyczyna wymaga oceny logów',
      evidence: `runs/${result.id}/verify-1/check.json; runs/${result.id}/verify-1/just-check.stdout.raw; runs/${result.id}/verify-1/just-check.stderr.raw`,
    });
    if (result.acceptance && (result.acceptance.exitCode !== 0 || result.acceptance.timedOut || result.acceptance.reportError)) items.push({
      trial: result.id, case: 'hidden acceptance process', severity: '—', status: result.acceptance.timedOut ?? result.acceptance.exitCode,
      attribution: 'nierozstrzygnięta — zachowano exit code/timeout i surowe wyjścia; wymaga oceny logów',
      evidence: `runs/${result.id}/acceptance/acceptance-result.json; runs/${result.id}/acceptance/hidden-test.stdout.raw; runs/${result.id}/acceptance/hidden-test.stderr.raw`,
    });
    if (result.error || !result.workflowCompleted) items.push({
      trial: result.id, case: `workflow · ${result.phase ?? 'przerwano'}`, severity: '—', status: compactError(result.errorMessage ?? result.error ?? 'incomplete'),
      attribution: 'nierozstrzygnięta — zapisany etap i częściowe artefakty nie ustalają jeszcze przyczyny; operator powinien sprawdzić dowody',
      evidence: `runs/${result.id}/trial-error.json; runs/${result.id}/trial-progress.json; runs/${result.id}/`,
    });
    if (result.workflowCompleted && !result.acceptance) items.push({
      trial: result.id, case: 'hidden acceptance missing', severity: '—', status: 'not-reported',
      attribution: 'nierozstrzygnięta — workflow jest ukończony, ale brak raportu ukrytej akceptacji',
      evidence: `runs/${result.id}/workflow-result.json; runs/${result.id}/acceptance/`,
    });
    return items;
  });
  lines.push('', '## Porażki i atrybucja', '');
  if (failures.length === 0) lines.push('Brak zarejestrowanych porażek w dostępnych próbach.');
  else for (const item of failures) lines.push(`- **${item.trial} · ${item.case} (${item.severity}) — ${item.status}.** Atrybucja: ${item.attribution}. Dowody: \`${item.evidence}\`.`);
  return lines.join('\n');
}

async function runAll(options) {
  const suite = resolve(options.suite);
  const { evaluation, parsed } = await validateInputs(suite);
  const validation = await validateBaseAndReference(suite, evaluation);
  const selectedIds = options.trials ?? TRIAL_ORDERS.map(order => order.id);
  const unknown = selectedIds.filter(id => !TRIAL_ORDERS.some(order => order.id === id));
  if (unknown.length) throw new Error(`Unknown trial id(s): ${unknown.join(', ')}`);
  const selected = selectedIds.map(id => TRIAL_ORDERS.find(order => order.id === id));
  const currentResults = () => TRIAL_ORDERS.map(order => readResult(suite, order)).filter(Boolean);
  const writeReport = () => writeFileSync(join(suite, 'implementation-report.md'), `${buildReport(evaluation, currentResults(), validation)}\n`, 'utf8');
  if (options.dryRun) {
    writeReport();
    console.log(`Validated ${evaluation.id}; ${selected.length} selected run(s) planned; no model calls made.`);
    return;
  }
  await processSelectedTrials(suite, selected, {
    executeTrial: order => runTrial(order, suite, evaluation, parsed),
    writeReport,
    output: message => process.stdout.write(message),
    errorOutput: message => process.stderr.write(message),
  });
  writeReport();
  console.log(`Selected trials processed without rerunning saved attempts. Report: ${join(suite, 'implementation-report.md')}`);
}

async function validate(options) {
  const { evaluation } = await validateInputs(resolve(options.suite));
  console.log(`Frozen inputs verified: ${evaluation.id}`);
}

async function report(options) {
  const suite = resolve(options.suite);
  const { evaluation } = await validateInputs(suite, { strictCurrent: false });
  const results = TRIAL_ORDERS.map(order => readResult(suite, order)).filter(Boolean);
  const validation = ['baseline', 'reference'].flatMap(name => {
    const file = join(suite, 'validation', `${name}-result.json`);
    return existsSync(file) ? [JSON.parse(readFileSync(file, 'utf8'))] : [];
  });
  const reportText = buildReport(evaluation, results, validation);
  writeFileSync(join(suite, 'implementation-report.md'), `${reportText}\n`, 'utf8');
  console.log(`Report recomputed from ${results.length} trial result(s): ${join(suite, 'implementation-report.md')}`);
}

const USAGE = `Usage:
  node scripts/cezar-eval.mjs freeze [--source C:/t/hcal] [--suite PATH]
  node scripts/cezar-eval.mjs validate [--suite PATH]
  node scripts/cezar-eval.mjs run [--suite PATH] [--dry-run] [--trials id1,id2]
  node scripts/cezar-eval.mjs report [--suite PATH]

freeze copies the H2 brief, hidden acceptance file and workflow/tool snapshots into a new external suite directory.
run validates base/reference, then runs selected trials serially. Saved attempts are reused or preserved; they are never automatically repeated. Each hidden acceptance test is staged only after that run's model and review activity ends.`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'help') console.log(USAGE);
    else if (options.command === 'freeze') await freeze(options);
    else if (options.command === 'validate') await validate(options);
    else if (options.command === 'run') await runAll(options);
    else if (options.command === 'report') await report(options);
  } catch (error) {
    console.error(`cezar-eval: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
