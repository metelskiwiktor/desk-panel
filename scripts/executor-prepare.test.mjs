// @vitest-environment node
// The executor prepare is what makes a Cezar worktree self-sufficient: its own node_modules from this lockfile and a
// pinned base for the review diff. These tests run it against throwaway git repos; `npm ci` itself is faked.
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { BASE_FILE, EXPECTED_BINARIES, INSTALL_TIMEOUT_MS, npmCiArgs, prepare, runBounded } from './executor-prepare.mjs';
import { DEPENDENCIES_MARKER, lockHash } from './dependencies.mjs';

const quiet = () => undefined;
const roots = [];
const links = [];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'dp-prepare-'));
  roots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'package.json'), '{}\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'base');
  return root;
}

function installBinaries(cwd) {
  mkdirSync(join(cwd, 'node_modules', '.bin'), { recursive: true });
  for (const name of EXPECTED_BINARIES) writeFileSync(join(cwd, 'node_modules', '.bin', name), '');
}

/** A stand-in for `npm ci`: records the call and (unless told to fail) produces the expected binaries. */
function fakeNpm({ status = 0, error = null } = {}) {
  const calls = [];
  const spawn = (args, options) => {
    calls.push({ args, options });
    if (!error && status === 0) installBinaries(options.cwd);
    return { status, error };
  };
  return { spawn, calls };
}

afterEach(() => {
  for (const link of links) {
    try {
      if (lstatSync(link).isSymbolicLink()) {
        try { unlinkSync(link); } catch { rmdirSync(link); }
      }
    } catch {
      // Already removed by the test.
    }
  }
  links.length = 0;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

it('pins the base commit and installs the worktree its own dependencies', async () => {
  const root = repo();
  const npm = fakeNpm();
  const result = await prepare({ root, npmSpawn: npm.spawn, log: quiet });
  expect(result.installed).toBe(true);
  expect(npm.calls.map(call => call.args)).toEqual([npmCiArgs]);
  expect(npm.calls[0].options.timeoutMs).toBe(INSTALL_TIMEOUT_MS);
  expect(INSTALL_TIMEOUT_MS).toBe(600_000);
  expect(readFileSync(join(root, DEPENDENCIES_MARKER), 'utf8').trim()).toBe(lockHash(root));
  expect(JSON.parse(readFileSync(join(root, BASE_FILE), 'utf8')).sha).toBe(git(root, 'rev-parse', 'HEAD'));
});

it('reuses an installation only when the marker matches and the binaries exist', async () => {
  const root = repo();
  const first = fakeNpm();
  await prepare({ root, npmSpawn: first.spawn, log: quiet });
  const second = fakeNpm();
  const result = await prepare({ root, npmSpawn: second.spawn, log: quiet });
  expect(result.installed).toBe(false);
  expect(second.calls).toEqual([]);
});

it('installs again when the marker does not match this package-lock.json', async () => {
  const root = repo();
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, DEPENDENCIES_MARKER), 'a-different-lock\n');
  const npm = fakeNpm();
  const result = await prepare({ root, npmSpawn: npm.spawn, log: quiet });
  expect(result.installed).toBe(true);
  expect(npm.calls).toHaveLength(1);
  expect(readFileSync(join(root, DEPENDENCIES_MARKER), 'utf8').trim()).toBe(lockHash(root));
});

it('installs again when a matching marker sits next to missing binaries', async () => {
  const root = repo();
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, DEPENDENCIES_MARKER), lockHash(root) + '\n');
  const npm = fakeNpm();
  await prepare({ root, npmSpawn: npm.spawn, log: quiet });
  expect(npm.calls).toHaveLength(1);
  expect(existsSync(join(root, 'node_modules', '.bin', 'tsc'))).toBe(true);
});

it('fails on a failed install and records no marker', async () => {
  const root = repo();
  const npm = fakeNpm({ status: 1 });
  await expect(prepare({ root, npmSpawn: npm.spawn, log: quiet })).rejects.toThrow(/npm ci did not finish/);
  expect(existsSync(join(root, DEPENDENCIES_MARKER))).toBe(false);
  expect(existsSync(join(root, BASE_FILE))).toBe(true);
});

it('reports a bounded install timeout instead of pretending dependencies are ready', async () => {
  const root = repo();
  const npm = fakeNpm({ status: null, error: new Error('ETIMEDOUT') });
  await expect(prepare({ root, npmSpawn: npm.spawn, log: quiet })).rejects.toThrow(/ETIMEDOUT/);
  expect(existsSync(join(root, DEPENDENCIES_MARKER))).toBe(false);
});

it('replaces a linked node_modules without traversing into its target', async () => {
  const root = repo();
  const target = mkdtempSync(join(tmpdir(), 'dp-prepare-target-'));
  roots.push(target);
  writeFileSync(join(target, 'keep.txt'), 'the other checkout\n');
  const link = join(root, 'node_modules');
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  links.push(link);
  const npm = fakeNpm();
  const result = await prepare({ root, npmSpawn: npm.spawn, log: quiet });
  expect(result.installed).toBe(true);
  expect(npm.calls).toHaveLength(1);
  expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('the other checkout\n');
  expect(existsSync(join(root, 'node_modules', '.bin', 'tsc'))).toBe(true);
});

it('keeps the pinned base on a repeat run and moves it only when reset is requested', async () => {
  const root = repo();
  const npm = fakeNpm();
  const first = await prepare({ root, npmSpawn: npm.spawn, log: quiet });
  writeFileSync(join(root, 'later.txt'), 'later\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'later');
  const second = await prepare({ root, npmSpawn: npm.spawn, log: quiet });
  expect(second.base.sha).toBe(first.base.sha);
  const forced = await prepare({ root, npmSpawn: npm.spawn, log: quiet, forceBase: true });
  expect(forced.base.sha).toBe(git(root, 'rev-parse', 'HEAD'));
  expect(forced.base.sha).not.toBe(first.base.sha);
});

it('terminates the whole owned npm tree on the install timeout instead of leaving children', async () => {
  const child = new EventEmitter();
  child.pid = 31337;
  const killed = [];
  const result = await runBounded('npm.cmd', npmCiArgs, {
    cwd: tmpdir(),
    timeoutMs: 20,
    spawnImpl: () => child,
    killTree: process => { killed.push(process.pid); process.emit('close', null, 'SIGKILL'); },
  });
  expect(killed).toEqual([31337]);
  expect(result.status).toBeNull();
  expect(result.error?.message).toMatch(/exceeded|terminated/);
});
