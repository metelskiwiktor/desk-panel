// The deterministic git steps of the desk-panel-task workflow (never an agent step):
//   node scripts/executor-commit.mjs --diff    capture `.ai/diff.patch` (verify, after `just check`)
//   node scripts/executor-commit.mjs           commit exactly that approved diff (after review approves it)
// Both diff against the pinned base `scripts/executor-prepare.mjs` recorded, include untracked files (intent-to-add) and
// leave ignored artifacts out. Tracked production config under `.ai/cezar/workflows/` is not ignored, so it is reviewed
// and committed like any other tracked file. Commit subjects are the conventional English line the executor left in
// `.ai/commit-message.txt`, validated here; attribution lines never reach the commit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASE_FILE = '.ai/executor-base.json';
export const DIFF_FILE = '.ai/diff.patch';
export const COMMIT_MESSAGE_FILE = '.ai/commit-message.txt';
/** Used only when the executor left no valid subject; still conventional, English and unattributed. */
export const FALLBACK_SUBJECT = 'chore(task): apply desk-panel task changes';
export const CONVENTIONAL_SUBJECT = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9._-]*\))?!?: [A-Za-z0-9][^\r\n]{1,80}$/;
/** Cezar's own checkpoint commits; only these may be collapsed into the final publication commit. */
export const AUTOSAVE_SUBJECT = /^cezar autosave\b/i;
/** Branch names whose history is never rewritten here, even for checkpoint commits. */
export const PROTECTED_BRANCHES = new Set(['main', 'master']);

const USAGE = `Użycie: node scripts/executor-commit.mjs [--diff]

--diff  zapisuje .ai/diff.patch względem bazy z ${BASE_FILE} (weryfikacja, po just check)
Bez flagi: porównuje worktree z zatwierdzonym .ai/diff.patch i robi jeden commit z
tematem z ${COMMIT_MESSAGE_FILE} (fallback: "${FALLBACK_SUBJECT}").`;

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The pinned base from prepare; a missing/broken file is an error, never a diff against an unknown commit. */
export function readBase(root) {
  let value;
  try {
    value = JSON.parse(readFileSync(join(root, BASE_FILE), 'utf8'));
  } catch {
    throw new Error(`no pinned base in ${BASE_FILE}; run scripts/executor-prepare.mjs first`);
  }
  if (typeof value?.sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(value.sha)) throw new Error(`${BASE_FILE} does not name a commit`);
  return value;
}

/** The whole worktree diff against the pinned base, untracked (and not ignored) files included. */
export function captureDiff(root, base) {
  // Intent-to-add makes an untracked file visible to `git diff` without staging its content; ignored paths (`.ai/**`
  // artifacts, `output/**`, `node_modules`) are skipped by git itself, while tracked `.ai/cezar/workflows/**` stays in.
  git(root, ['add', '-N', '--', '.']);
  const patch = git(root, ['diff', '--no-renames', '--binary', base.sha, '--', '.']);
  const paths = git(root, ['diff', '--no-renames', '--name-only', base.sha, '--', '.']).split('\n').filter(Boolean);
  return { patch, files: paths.length, paths };
}

/** Writes `.ai/diff.patch` and returns how many files it covers. */
export function saveDiff(root, log = console.log) {
  const base = readBase(root);
  const { patch, files } = captureDiff(root, base);
  mkdirSync(dirname(join(root, DIFF_FILE)), { recursive: true });
  writeFileSync(join(root, DIFF_FILE), patch);
  log(files ? `executor-commit: ${files} changed file(s) against ${base.sha.slice(0, 12)} -> ${DIFF_FILE}` : 'executor-commit: no changes against the pinned base');
  return { files, patch };
}

/** A conventional English subject from the executor's file; anything else (including attribution) falls back. */
export function commitSubject(text) {
  const first = String(text ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
  const cleaned = first.replace(/^[`"']+|[`"']+$/g, '').replace(/\s+/g, ' ').trim();
  return CONVENTIONAL_SUBJECT.test(cleaned) ? cleaned : FALLBACK_SUBJECT;
}

function readCommitMessage(root) {
  try {
    return readFileSync(join(root, COMMIT_MESSAGE_FILE), 'utf8');
  } catch {
    return '';
  }
}

/** True when `sha` is HEAD or an ancestor of HEAD (the branch prepare measured). */
function isAncestor(root, sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The branch checkout is one of Cezar's isolated linked worktrees, not the main checkout. */
function isLinkedWorktree(root) {
  const absolute = arg => {
    try {
      return resolve(root, git(root, ['rev-parse', '--path-format=absolute', arg]).trim());
    } catch {
      return resolve(root, git(root, ['rev-parse', arg]).trim());
    }
  };
  return absolute('--git-dir').toLowerCase() !== absolute('--git-common-dir').toLowerCase();
}

/** A task branch that is safe to collapse: not main/master, not published, and only Cezar autosaves above the base. */
function squashable(root, base) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (PROTECTED_BRANCHES.has(branch) || !isLinkedWorktree(root)) return false;
  if (git(root, ['for-each-ref', '--format=%(refname)', '--contains', 'HEAD', 'refs/remotes']).trim()) return false;
  const subjects = git(root, ['log', '--format=%s', `${base.sha}..HEAD`]).split('\n').filter(Boolean);
  return subjects.length > 0 && subjects.every(subject => AUTOSAVE_SUBJECT.test(subject));
}

/** An already finalized run: one conventional commit above the base carrying exactly the approved tree. */
function alreadyFinalized(root, base, approved, subject) {
  if (git(root, ['status', '--porcelain']).trim()) return null;
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  if (!isAncestor(root, base.sha)) return null;
  const count = git(root, ['rev-list', '--count', `${base.sha}..HEAD`]).trim();
  const message = git(root, ['log', '-1', '--format=%s', 'HEAD']).trim();
  const headPatch = git(root, ['diff', '--no-renames', '--binary', base.sha, 'HEAD', '--', '.']);
  return count === '1' && message === subject && headPatch === approved ? head : null;
}

/** Commits exactly the reviewed diff: refuses when the worktree moved on since verify/review. */
export function commitWork(root = process.cwd(), log = console.log) {
  const base = readBase(root);
  const { patch, files, paths } = captureDiff(root, base);
  if (!patch.trim()) throw new Error('nothing to commit: the worktree matches the pinned base');
  let approved;
  try {
    approved = readFileSync(join(root, DIFF_FILE), 'utf8');
  } catch {
    throw new Error(`no ${DIFF_FILE}; the verify step must capture the diff before review`);
  }
  if (approved !== patch) throw new Error(`the worktree changed after verify/review (${files} file(s) now); re-run verify so the commit matches the approved diff`);
  const subject = commitSubject(readCommitMessage(root));
  if (!isAncestor(root, base.sha)) throw new Error(`the pinned base ${base.sha.slice(0, 12)} is not an ancestor of HEAD; refusing to rewrite this branch`);

  // A repeated finalization after verify/review is a plain no-op: the exact reviewed tree already sits in one
  // conventional commit above the pinned base. No reset, amend or new commit.
  const finalized = alreadyFinalized(root, base, approved, subject);
  if (finalized) {
    log(`executor-commit: already finalized ${finalized.slice(0, 12)} ${subject}`);
    return { sha: finalized, subject, changed: false };
  }

  // Cezar autosaves at the end of every agent turn, so the approved diff may already be in `cezar autosave` commits on
  // this isolated, unpublished task branch. Collapse only those onto the pinned base. Any other history is left alone:
  // the reviewed paths are committed on top instead of rewriting commits this script does not own.
  const canSquash = squashable(root, base);
  if (!canSquash && git(root, ['diff', '--no-renames', '--binary', base.sha, 'HEAD', '--', '.']) === approved) {
    throw new Error('the reviewed diff is already in checkpoint commits on a branch this script must not rewrite (main/master, a non-worktree checkout, a published head or unrelated commits); refusing to create a duplicate commit');
  }
  if (canSquash) {
    git(root, ['reset', '--soft', base.sha]);
  }
  if (paths.length) git(root, ['add', '--', ...paths]);
  git(root, ['commit', '-m', subject, '--', ...paths]);
  const dirty = git(root, ['status', '--porcelain']).trim();
  if (dirty) throw new Error(`worktree still dirty after the commit:\n${dirty}`);
  const sha = git(root, ['rev-parse', 'HEAD']).trim();
  log(`executor-commit: committed ${sha.slice(0, 12)} ${subject}`);
  return { sha, subject, changed: true };
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
  } else if (args.some(arg => arg !== '--diff')) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    try {
      if (args.includes('--diff')) saveDiff(process.cwd());
      else commitWork(process.cwd());
    } catch (error) {
      console.error(`executor-commit: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
