// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), renameSync: vi.fn(), rmSync: vi.fn(), writeFileSync: vi.fn() }));

const files = new Map();
const installed = () => createHash('sha256').update(files.get('package.json')).update(files.get('package-lock.json')).digest('hex');

beforeEach(() => {
  vi.resetModules();
  files.clear();
  files.set('package.json', '{}');
  files.set('package-lock.json', 'new-lock');
  files.set('node_modules', '');
  files.set('.deployed', createHash('sha256').update('head').update('').digest('hex'));
  vi.mocked(existsSync).mockImplementation(path => files.has(path));
  vi.mocked(readFileSync).mockImplementation(path => files.get(path));
  vi.mocked(execFileSync).mockImplementation((_command, args) => {
    if (args[0] === 'rev-parse') return args.includes('--abbrev-ref') ? 'main' : 'head';
    if (args[0] === 'rev-list') return '0'; // A separate pull already brought main up to date.
    return '';
  });
  vi.mocked(spawnSync).mockImplementation((command, args) => {
    if (command === 'npm' && args[0] === 'ci') throw new Error('INSTALL_REACHED');
    return { status: 0 };
  });
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('SKIPPED'); });
});

it('installs dependencies after a separate pull even when the deployed fingerprint matches', async () => {
  files.set('node_modules/.desk-panel-dependencies', 'old-lock-hash');
  await expect(import('./update.mjs')).rejects.toThrow('INSTALL_REACHED');
});

it('reinstalls when node_modules exists without an installation marker', async () => {
  await expect(import('./update.mjs')).rejects.toThrow('INSTALL_REACHED');
});

it('skips an unchanged deployment whose installed dependencies match', async () => {
  files.set('node_modules/.desk-panel-dependencies', installed());
  await expect(import('./update.mjs')).rejects.toThrow('SKIPPED');
  expect(spawnSync).not.toHaveBeenCalledWith('npm', ['ci'], expect.anything());
});
