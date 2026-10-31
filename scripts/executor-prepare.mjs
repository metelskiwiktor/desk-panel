// Prepares a Cezar executor worktree for the desk-panel-task workflow, and is safe to run by hand:
//   node scripts/executor-prepare.mjs [--reset-base]
// - Captures the pinned base commit (`.ai/executor-base.json`) that `verify` diffs against. A repeat run keeps it.
// - Gives the worktree its own node_modules installed by `npm ci` (npm's shared cache) from this package-lock.json:
//   a matching dependencies marker and the expected binaries let a repeat run skip the install; a linked node_modules is
//   removed as a link (never traversed into) and replaced. Nothing is reset, cleaned or normalized and no tracked file is
//   deleted: the agent's work belongs to the worktree, and Cezar autosaves it.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEPENDENCIES_MARKER, installedMatches, recordInstalled } from './dependencies.mjs';

export const INSTALL_TIMEOUT_MS = 10 * 60_000;
/** What `just check` (and the targeted steps before it) needs to exist after an install. */
export const EXPECTED_BINARIES = ['tsc', 'vitest', 'vite', 'tsx', 'knip'];
export const BASE_FILE = '.ai/executor-base.json';
/** `npm ci` exactly at the lockfile, offline-first, without the audit and funding requests. */
export const npmCiArgs = ['ci', '--prefer-offline', '--no-audit', '--no-fund'];

const USAGE = `Użycie: node scripts/executor-prepare.mjs [--reset-base]

Przygotowuje worktree wykonawcy: własne node_modules z package-lock.json (marker w
${DEPENDENCIES_MARKER}) i przypięta baza diffu w ${BASE_FILE}.
--reset-base  przypina bieżący HEAD od nowa (domyślnie powtórny run zostawia zapisaną bazę).`;

/** A node_modules that is a link to another checkout is never reused: it is mutable and shared. */
export function linkedModules(root) {
  try {
    return lstatSync(join(root, 'node_modules')).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Removes only the link itself (a junction on Windows), never its target; a real folder is left alone. */
export function removeModulesLink(root) {
  const path = join(root, 'node_modules');
  if (!linkedModules(root)) return false;
  try {
    unlinkSync(path);
  } catch {
    // A directory junction/symlink on Windows is removed with rmdir, which also does not traverse it.
    rmdirSync(path);
  }
  return true;
}

/** Expected binaries missing from this worktree's own node_modules/.bin. */
export function missingBinaries(root, platform = process.platform) {
  const bin = join(root, 'node_modules', '.bin');
  const suffixes = platform === 'win32' ? ['', '.cmd', '.exe', '.ps1'] : ['', '.cmd'];
  return EXPECTED_BINARIES.filter(name => !suffixes.some(suffix => existsSync(join(bin, name + suffix))));
}

/** The recorded pinned base, or null when prepare has not run (or the file is broken). */
export function pinnedBase(root) {
  try {
    const value = JSON.parse(readFileSync(join(root, BASE_FILE), 'utf8'));
    return typeof value?.sha === 'string' && /^[0-9a-f]{7,64}$/.test(value.sha) ? value : null;
  } catch {
    return null;
  }
}

/** Records HEAD once; `force` moves it (a local re-prepare after edits must not silently lose them). */
export function captureBase(root, force = false, log = console.log) {
  const existing = pinnedBase(root);
  if (existing && !force) {
    log(`pinned base ${existing.sha.slice(0, 12)}${existing.branch ? ` (${existing.branch})` : ''}`);
    return existing;
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sha = git('rev-parse', 'HEAD');
  let branch = '';
  try {
    branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    // Detached HEAD is fine: only the sha is used for the diff.
  }
  const base = { sha, ...(branch && branch !== 'HEAD' ? { branch } : {}), capturedAt: new Date().toISOString() };
  mkdirSync(join(root, '.ai'), { recursive: true });
  writeFileSync(join(root, BASE_FILE), JSON.stringify(base, null, 2) + '\n');
  log(`pinned base ${sha.slice(0, 12)}${base.branch ? ` (${base.branch})` : ''}`);
  return base;
}

/** How long a killed install may take to actually close before the run settles anyway. */
export const KILL_GRACE_MS = 10_000;

/** Kills the process tree we started: on Windows `taskkill /T /F` on our own child's PID, elsewhere SIGKILL. */
export function killOwnedTree(child, { platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
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

/**
 * Runs a command with a wall limit and, on timeout, terminates its whole owned process tree (the Windows shell and the
 * npm children below it), so no install keeps running after prepare refused. Resolves to the exit status or an error;
 * it never rejects.
 */
export function runBounded(command, args, {
  cwd,
  timeoutMs = INSTALL_TIMEOUT_MS,
  shell = process.platform === 'win32',
  spawnImpl = spawn,
  killTree = child => killOwnedTree(child),
  graceMs = KILL_GRACE_MS,
} = {}) {
  return new Promise(resolve => {
    let child;
    let timer;
    let graceTimer;
    let done = false;
    let timedOut = null;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve(timedOut ? { status: null, error: timedOut } : result);
    };
    try {
      child = spawnImpl(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell });
    } catch (error) {
      finish({ status: null, error });
      return;
    }
    child.on('error', error => finish({ status: null, error }));
    child.on('close', (status, signal) => finish(signal ? { status: null, signal, error: new Error(`npm ci was terminated by ${signal}`) } : { status }));
    timer = setTimeout(() => {
      timedOut = new Error(`npm ci exceeded ${Math.round(timeoutMs / 60_000)} min; its process tree was terminated`);
      try {
        killTree(child);
      } catch {
        // The grace timer still settles the run with the timeout.
      }
      graceTimer = setTimeout(() => finish({ status: null, error: timedOut }), graceMs);
    }, timeoutMs);
  });
}

/**
 * `npm ci` through npm's default shared cache, bounded by `timeoutMs`. On Windows npm is a `.cmd` shim, which a
 * shell-less spawn rejects with EINVAL; running it through the shell lets the PATHEXT lookup do its job, and the tree
 * kill (not a bare shell timeout) removes the npm children if the install hangs.
 */
export async function defaultNpmSpawn(args, { cwd, timeoutMs = INSTALL_TIMEOUT_MS, log = console.log } = {}) {
  log(`executor-prepare: npm ${args.join(' ')} (timeout ${Math.round(timeoutMs / 60_000)}m)`);
  return runBounded(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, timeoutMs });
}

/**
 * Prepares `root` (the worktree) and resolves to what happened. Reuses an installation only when the marker proves it
 * came from this lockfile and every expected binary exists; anything else is installed again, bounded by 10 minutes.
 */
export async function prepare({ root = process.cwd(), log = console.log, npmSpawn = defaultNpmSpawn, forceBase = false, platform = process.platform } = {}) {
  const base = captureBase(root, forceBase, log);
  mkdirSync(join(root, '.ai', 'screenshots'), { recursive: true });

  if (removeModulesLink(root)) log('executor-prepare: removed a linked node_modules (linking a shared, mutable checkout is never used)');
  const missing = missingBinaries(root, platform);
  if (existsSync(join(root, 'node_modules')) && installedMatches(root) && missing.length === 0) {
    log('executor-prepare: node_modules matches package-lock.json; reusing it');
    return { installed: false, base };
  }

  log(missing.length ? `executor-prepare: installing; missing binaries: ${missing.join(', ')}` : 'executor-prepare: installing; node_modules was not installed from this package-lock.json');
  const result = await npmSpawn(npmCiArgs, { cwd: root, timeoutMs: INSTALL_TIMEOUT_MS });
  if (result?.error || result?.status !== 0) {
    const why = result?.error ? result.error.message : `exit code ${result?.status}`;
    throw new Error(`npm ci did not finish (${why}); dependencies are not ready`);
  }
  recordInstalled(root);
  const stillMissing = missingBinaries(root, platform);
  if (stillMissing.length) throw new Error(`npm ci finished but the binaries are missing: ${stillMissing.join(', ')}`);
  log('executor-prepare: dependencies installed and recorded');
  return { installed: true, base };
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
  } else if (args.some(arg => arg !== '--reset-base')) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    try {
      await prepare({ forceBase: args.includes('--reset-base') });
    } catch (error) {
      console.error(`executor-prepare: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
