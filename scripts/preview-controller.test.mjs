// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
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
});
