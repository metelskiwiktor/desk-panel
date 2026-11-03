// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { agyLauncher, agyProcessEnv } from './agent-chat';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }));
const dirs: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

it('passes no panel.env variable or known panel secret to agy while preserving its OS environment and arguments', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dp-agy-env-')); dirs.push(dir);
  const file = path.join(dir, 'panel.env');
  writeFileSync(file, '# ignored=value\r\nCUSTOM_PANEL_TOKEN=private\r\n PLAIN_OPTION =yes\r\n');
  const env = { Path: 'system-path', USERPROFILE: dir, APPDATA: dir, LOCALAPPDATA: dir, TEMP: dir,
    CUSTOM_PANEL_TOKEN: 'private', plain_option: 'yes', OpenRouter_Api_Key: 'private', DESK_HERMES_KEY: 'private',
    DESK_NTFY_URL: 'private', DESK_AGY_BIN: 'configured-agy', DESK_AGY_MODEL: 'configured-model', DESK_AGY_EFFORT: 'high' };
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  agyLauncher(env, file)(['-p', ''], dir);
  expect(spawn).toHaveBeenCalledWith('configured-agy', expect.arrayContaining(['--model', 'configured-model', '--effort', 'high']), expect.objectContaining({
    env: { Path: 'system-path', USERPROFILE: dir, APPDATA: dir, LOCALAPPDATA: dir, TEMP: dir },
  }));
  expect(env.CUSTOM_PANEL_TOKEN).toBe('private');
  writeFileSync(file, 'NEW_PANEL_SETTING=private\n');
  expect(agyProcessEnv({ ...env, NEW_PANEL_SETTING: 'private' }, file)).not.toHaveProperty('NEW_PANEL_SETTING');
});

it('filters known secrets without a file and fails closed on an unreadable env file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dp-agy-env-')); dirs.push(dir);
  expect(agyProcessEnv({ PATH: 'system', OPENROUTER_API_KEY: 'private', DESK_HERMES_KEY: 'private', DESK_NTFY_URL: 'private' }, path.join(dir, 'missing'))).toEqual({ PATH: 'system' });
  expect(() => agyProcessEnv({}, dir)).toThrow('agy nie został uruchomiony');
});
