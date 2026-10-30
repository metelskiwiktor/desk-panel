// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/preview.mjs');

describe('preview state directory', () => {
  it('uses the same explicit absolute root for status and cleanup regardless of TEMP', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-root-test-'));
    try {
      const root = join(dir, 'short');
      const old = join(root, 'pr-123');
      mkdirSync(old, { recursive: true });
      const env = { ...process.env, DESK_PREVIEW_ROOT: root, TEMP: join(dir, 'different-temp'), TMP: join(dir, 'different-temp'), TMPDIR: join(dir, 'different-temp') };
      const run = (...args) => spawnSync(process.execPath, [script, ...args, '123'], { env, encoding: 'utf8' });
      const status = run('status');
      expect(status.status).toBe(0);
      expect(JSON.parse(status.stdout)).toEqual({ status: 'stale', pr: 123 });
      expect(run('stop').status).toBe(0);
      expect(existsSync(old)).toBe(false);
      expect(JSON.parse(run('status').stdout).status).toBe('stopped');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects a relative root before accessing state', () => {
    const result = spawnSync(process.execPath, [script, 'status', '123'], { env: { ...process.env, DESK_PREVIEW_ROOT: 'relative' }, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('absolute');
  });
  it('does not delete a checkout while its starter is preparing dependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-preparing-'));
    try {
      const root = join(dir, 'root'), stateDir = join(root, 'pr-123');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, 'setup.json'), JSON.stringify({ pid: process.pid }));
      const stopped = spawnSync(process.execPath, [script, 'stop', '123'], { env: { ...process.env, DESK_PREVIEW_ROOT: root }, encoding: 'utf8' });
      expect(stopped.status).not.toBe(0);
      expect(stopped.stderr).toContain('still preparing');
      expect(existsSync(stateDir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform !== 'win32')('stops an unresponsive startup worker and refuses a reused PID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-recovery-'));
    const root = join(dir, 'root'), stateDir = join(root, 'pr-123');
    mkdirSync(stateDir, { recursive: true });
    const marker = 'a'.repeat(64);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], { stdio: 'ignore', windowsHide: true });
    const helper = resolve('scripts/preview-process.ps1');
    const identify = () => spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Operation', 'identify', '-ProcessId', String(child.pid), '-Marker', marker], { encoding: 'utf8', timeout: 20000 });
    const runStop = () => spawnSync(process.execPath, [script, 'stop', '123'], { env: { ...process.env, DESK_PREVIEW_ROOT: root }, encoding: 'utf8', timeout: 40000 });
    try {
      const identity = identify();
      expect(identity.status, identity.stderr).toBe(0);
      const creation = identity.stdout.trim();
      expect(creation).toMatch(/^\d+$/);
      const launch = { pid: child.pid, marker, creation: '1' };
      writeFileSync(join(stateDir, 'launch.json'), JSON.stringify(launch));
      const refused = runStop();
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain('different process');
      expect(existsSync(stateDir)).toBe(true);
      expect(child.exitCode).toBeNull();
      // Simulate a crash immediately after spawn, before the starter persisted the PID.
      writeFileSync(join(stateDir, 'launch.json'), JSON.stringify({ marker, pending: true }));
      const stopped = runStop();
      expect(stopped.status, stopped.stderr).toBe(0);
      expect(existsSync(stateDir)).toBe(false);
      await new Promise(resolve => child.once('exit', resolve));
    } finally {
      if (child.exitCode === null) child.kill();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 60000);

  it.skipIf(process.platform !== 'win32')('stops workers when startup fails after spawn and when readiness times out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-start-failure-'));
    const fixture = join(dir, 'fixture'); mkdirSync(fixture);
    const helper = join(fixture, 'preview-process.ps1');
    copyFileSync(resolve('scripts/preview-process.ps1'), helper);
    const original = readFileSync(script, 'utf8');
    const setupStart = original.indexOf('    const cwd = process.cwd();');
    const setupEnd = original.indexOf('    const token = randomBytes(32)', setupStart);
    expect(setupStart).toBeGreaterThan(0); expect(setupEnd).toBeGreaterThan(setupStart);
    // Replace only external checkout/install and the worker entrypoint; preserve the controller's real catch/recovery.
    let fixtureSource = original.slice(0, setupStart) + "    mkdirSync(checkout);\n    const env = { ...process.env }; const sha = 'b'.repeat(40);\n" + original.slice(setupEnd);
    const workerArgs = "['--import', 'tsx', 'scripts/.desk-preview-worker.ts', marker]";
    expect(fixtureSource).toContain(workerArgs);
    fixtureSource = fixtureSource.replace(workerArgs, "['-e', 'setInterval(() => {}, 1000)', marker]");
    const controller = join(fixture, 'preview.mjs');
    try {
      for (const mode of ['post-spawn', 'identity-failure', 'timeout']) {
        const root = join(dir, mode);
        const source = mode === 'post-spawn'
          ? fixtureSource.replace('    spawned = launch;', "    spawned = launch; throw new Error('injected identity failure');")
          : mode === 'identity-failure'
            ? fixtureSource.replace('    child.unref(); closeSync(log);', "    child.unref(); closeSync(log); throw new Error('injected identity failure');")
            : fixtureSource.replace('i < 120; i++', 'i < 0; i++');
        expect(source).not.toBe(fixtureSource);
        writeFileSync(controller, source);
        const env = { ...process.env, DESK_PREVIEW_ROOT: root };
        const result = spawnSync(process.execPath, [controller, 'start', '123'], { env, encoding: 'utf8', timeout: 40000 });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('The preview worker has stopped');
        expect(result.stderr).toContain('preview.log');
        const record = JSON.parse(readFileSync(join(root, 'pr-123', 'launch.json'), 'utf8'));
        const found = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Operation', 'find', '-Marker', record.marker], { encoding: 'utf8', timeout: 20000 });
        expect(found.status, found.stderr).toBe(0);
        expect(found.stdout.trim()).toBe('gone');
        const stopped = spawnSync(process.execPath, [controller, 'stop', '123'], { env, encoding: 'utf8', timeout: 40000 });
        expect(stopped.status, stopped.stderr).toBe(0);
      }
    } finally {
      for (const mode of ['post-spawn', 'identity-failure', 'timeout']) {
        const root = join(dir, mode);
        if (!existsSync(join(root, 'pr-123'))) continue;
        const stopped = spawnSync(process.execPath, [controller, 'stop', '123'], { env: { ...process.env, DESK_PREVIEW_ROOT: root }, encoding: 'utf8', timeout: 40000 });
        if (stopped.status !== 0) throw new Error(`Fixture cleanup refused; inspect ${root}: ${stopped.stderr}`);
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  }, 90000);

});
