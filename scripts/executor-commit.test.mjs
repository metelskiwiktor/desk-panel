// @vitest-environment node
// The deterministic review-diff and commit steps: the commit may only carry the diff verify captured and review approved,
// against the base prepare pinned, with a conventional unattributed English subject. Real throwaway git repos.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { BASE_FILE, COMMIT_MESSAGE_FILE, DIFF_FILE, FALLBACK_SUBJECT, captureDiff, commitSubject, commitWork, readBase, saveDiff } from './executor-commit.mjs';

const roots = [];
const quiet = () => undefined;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo(branch = 'main') {
  const root = mkdtempSync(join(tmpdir(), 'dp-commit-'));
  roots.push(root);
  git(root, 'init', '-q', '-b', branch);
  mkdirSync(join(root, '.ai', 'cezar', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.ai/**\n!.ai/cezar/\n!.ai/cezar/workflows/\n!.ai/cezar/workflows/**\noutput/\nnode_modules/\n');
  writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, '.ai', 'cezar', 'workflows', 'desk-panel-task.yaml'), 'version: 2\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'base');
  mkdirSync(join(root, '.ai'), { recursive: true });
  writeFileSync(join(root, BASE_FILE), JSON.stringify({ sha: git(root, 'rev-parse', 'HEAD'), branch }) + '\n');
  return root;
}

/** A linked worktree on its own task branch, the shape Cezar uses for a run (the main checkout stays untouched). */
function linkedRepo() {
  const main = repo();
  const root = mkdtempSync(join(tmpdir(), 'dp-commit-wt-'));
  roots.push(root);
  rmSync(root, { recursive: true, force: true });
  git(main, 'worktree', 'add', '-q', '-b', 'task/exec', root, 'HEAD');
  mkdirSync(join(root, '.ai'), { recursive: true });
  writeFileSync(join(root, BASE_FILE), JSON.stringify({ sha: git(root, 'rev-parse', 'HEAD'), branch: 'task/exec' }) + '\n');
  return root;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

it('captures untracked files against the pinned base, excluding ignored artifacts', () => {
  const root = repo();
  writeFileSync(join(root, 'app.ts'), 'export const a = 2;\n');
  writeFileSync(join(root, 'new.ts'), 'export const b = 3;\n');
  mkdirSync(join(root, 'output'), { recursive: true });
  writeFileSync(join(root, 'output', 'shot.png'), 'not a diff\n');
  writeFileSync(join(root, '.ai', 'diff.patch'), 'artifact\n');
  const { files } = saveDiff(root, quiet);
  const patch = readFileSync(join(root, DIFF_FILE), 'utf8');
  expect(files).toBe(2);
  expect(patch).toContain('new.ts');
  expect(patch).not.toContain('output/shot.png');
  expect(patch).not.toContain('artifact');
  expect(readBase(root).sha).toHaveLength(40);
});

it('includes a tracked .ai workflow change in the reviewed diff and the commit', () => {
  const root = repo();
  const workflow = join(root, '.ai', 'cezar', 'workflows', 'desk-panel-task.yaml');
  writeFileSync(workflow, 'version: 2\n# reviewed\n');
  writeFileSync(join(root, 'new.ts'), 'export const b = 3;\n');
  const { files } = saveDiff(root, quiet);
  const patch = readFileSync(join(root, DIFF_FILE), 'utf8');
  expect(files).toBe(2);
  expect(patch).toContain('desk-panel-task.yaml');
  writeFileSync(join(root, COMMIT_MESSAGE_FILE), 'docs(cezar): review the workflow\n');
  commitWork(root, quiet);
  expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toContain('.ai/cezar/workflows/desk-panel-task.yaml');
  expect(git(root, 'status', '--porcelain')).toBe('');
});

it('commits exactly the approved diff with the executor subject and leaves the tree clean', () => {
  const root = repo();
  writeFileSync(join(root, 'app.ts'), 'export const a = 2;\n');
  saveDiff(root, quiet);
  writeFileSync(join(root, COMMIT_MESSAGE_FILE), 'fix(app): keep the tile title readable\n');
  const result = commitWork(root, quiet);
  expect(result.subject).toBe('fix(app): keep the tile title readable');
  expect(git(root, 'log', '-1', '--format=%s')).toBe('fix(app): keep the tile title readable');
  expect(git(root, 'status', '--porcelain')).toBe('');
  expect(git(root, 'log', '-1', '--format=%B')).not.toMatch(/Co-Authored-By|Generated with/);
});

it('collapses Cezar autosave commits into one conventional commit on the pinned base', () => {
  const root = linkedRepo();
  const base = readBase(root).sha;
  writeFileSync(join(root, 'app.ts'), 'export const a = 2;\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'cezar autosave (turn end)');
  saveDiff(root, quiet);
  writeFileSync(join(root, COMMIT_MESSAGE_FILE), 'feat(app): change the value\n');
  const result = commitWork(root, quiet);
  expect(result.subject).toBe('feat(app): change the value');
  expect(result.changed).toBe(true);
  expect(git(root, 'rev-list', '--count', `${base}..HEAD`)).toBe('1');
  expect(git(root, 'log', '-1', '--format=%s')).toBe('feat(app): change the value');
  expect(git(root, 'status', '--porcelain')).toBe('');
});

it('is a no-op when the exact reviewed tree is already the final conventional commit', () => {
  const root = linkedRepo();
  writeFileSync(join(root, 'app.ts'), 'export const a = 2;\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'cezar autosave (turn end)');
  saveDiff(root, quiet);
  writeFileSync(join(root, COMMIT_MESSAGE_FILE), 'feat(app): change the value\n');
  const first = commitWork(root, quiet);
  const second = commitWork(root, quiet);
  expect(second.changed).toBe(false);
  expect(second.sha).toBe(first.sha);
  expect(git(root, 'rev-parse', 'HEAD')).toBe(first.sha);
});

it('refuses to duplicate or rewrite checkpoint commits on main instead of rewriting its history', () => {
  const root = repo();
  const base = readBase(root).sha;
  writeFileSync(join(root, 'app.ts'), 'export const a = 2;\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'cezar autosave (turn end)');
  const before = git(root, 'rev-parse', 'HEAD');
  saveDiff(root, quiet);
  writeFileSync(join(root, COMMIT_MESSAGE_FILE), 'feat(app): change the value\n');
  expect(() => commitWork(root, quiet)).toThrow(/must not rewrite/);
  expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
  expect(git(root, 'rev-list', '--count', `${base}..HEAD`)).toBe('1');
});

it('refuses to commit when the worktree moved on after verify', () => {
  const root = repo();
  writeFileSync(join(root, 'app.ts'), 'export const a = 2;\n');
  saveDiff(root, quiet);
  writeFileSync(join(root, 'app.ts'), 'export const a = 3;\n');
  expect(() => commitWork(root, quiet)).toThrow(/changed after verify\/review/);
});

it('refuses without a pinned base or an approved diff', () => {
  const root = repo();
  rmSync(join(root, BASE_FILE), { force: true });
  expect(() => readBase(root)).toThrow(/pinned base/);
  const other = repo();
  writeFileSync(join(other, 'app.ts'), 'export const a = 2;\n');
  expect(() => commitWork(other, quiet)).toThrow(/verify step must capture the diff/);
});

it('refuses an empty diff instead of committing nothing', () => {
  const root = repo();
  saveDiff(root, quiet);
  expect(readFileSync(join(root, DIFF_FILE), 'utf8')).toBe('');
  expect(() => commitWork(root, quiet)).toThrow(/nothing to commit/);
});

it('keeps only a conventional English subject and never an attribution line', () => {
  expect(commitSubject('feat(chat): show the status chip\n')).toBe('feat(chat): show the status chip');
  expect(commitSubject('  `perf(calendar): trim the payload`  ')).toBe('perf(calendar): trim the payload');
  expect(commitSubject('Co-Authored-By: Someone <x@example.com>\nfeat: x')).toBe(FALLBACK_SUBJECT);
  expect(commitSubject('coś zmienione')).toBe(FALLBACK_SUBJECT);
  expect(commitSubject('')).toBe(FALLBACK_SUBJECT);
});
