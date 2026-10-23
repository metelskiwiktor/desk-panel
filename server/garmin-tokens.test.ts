// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGarminTokenStore, GarminStorageError } from './garmin-tokens';

const tokens = { oauth1: { oauth_token: 'FAKE-1', oauth_token_secret: 'FAKE-2' }, oauth2: { access_token: 'FAKE-3', expires_at: 1 } } as never;
const io = (over: Record<string, unknown> = {}) => ({ read: vi.fn(async () => tokens as unknown), write: vi.fn(async () => {}), remove: vi.fn(async () => {}), ...over });

describe('Garmin token store', () => {
  it('has no tokens before the first sign-in', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(await createGarminTokenStore('x', io({ read: async () => { throw missing; } })).load()).toBeNull();
  });
  it('tells an unreadable or malformed file from a missing one', async () => {
    await expect(createGarminTokenStore('x', io({ read: async () => { throw new Error('Private store unavailable'); } })).load()).rejects.toBeInstanceOf(GarminStorageError);
    await expect(createGarminTokenStore('x', io({ read: async () => ({ oauth1: {} }) })).load()).rejects.toBeInstanceOf(GarminStorageError);
    await expect(createGarminTokenStore('x', io({ read: async () => 'text' })).load()).rejects.toBeInstanceOf(GarminStorageError);
  });
  it('saves, loads and clears through the private store', async () => {
    const fake = io();
    const store = createGarminTokenStore('C:/tokens.dpapi', fake);
    await store.save(tokens);
    expect(fake.write).toHaveBeenCalledWith('C:/tokens.dpapi', tokens);
    expect(await store.load()).toBe(tokens);
    await store.clear();
    expect(fake.remove).toHaveBeenCalledWith('C:/tokens.dpapi');
  });
  it.skipIf(process.platform !== 'win32')('keeps the tokens encrypted on disk and reads them back', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desk-garmin-test-'));
    const file = join(directory, 'garmin.dpapi');
    try {
      const store = createGarminTokenStore(file);
      expect(await store.load()).toBeNull();
      await store.save(tokens);
      expect(await readFile(file, 'utf8')).not.toContain('FAKE-');
      expect(await store.load()).toEqual(tokens);
      await store.clear();
      expect(await store.load()).toBeNull();
    } finally {
      if (!directory.startsWith(join(tmpdir(), 'desk-garmin-test-'))) throw new Error('Invalid cleanup target');
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
