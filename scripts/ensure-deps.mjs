// Ensures `node_modules` is available in a Cezar git worktree before running `just check` or `just screenshots`.
// If `node_modules` already exists, exits immediately (0ms).
// If running inside a git worktree whose main checkout has `node_modules` and matching `package-lock.json`,
// creates a directory symlink `node_modules -> <main>/node_modules`. Otherwise falls back to `npm ci`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const cwd = process.cwd();
const localModules = join(cwd, 'node_modules');

if (!existsSync(localModules)) {
  let linked = false;
  try {
    const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const mainRoot = dirname(resolve(cwd, commonGitDir));
    const mainModules = join(mainRoot, 'node_modules');
    const localLock = join(cwd, 'package-lock.json');
    const mainLock = join(mainRoot, 'package-lock.json');
    if (mainRoot !== cwd && existsSync(mainModules) && existsSync(localLock) && existsSync(mainLock)) {
      if (readFileSync(localLock, 'utf8') === readFileSync(mainLock, 'utf8')) {
        symlinkSync(mainModules, localModules, 'dir');
        linked = true;
      }
    }
  } catch {
    // Fall back to npm ci below if symlinking is unavailable or fails.
  }
  if (!linked) {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], { cwd, stdio: 'inherit' });
  }
}
