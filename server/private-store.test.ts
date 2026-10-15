// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPrivate, writePrivate } from './private-store';

it.skipIf(process.platform !== 'win32')('persists a DPAPI encrypted value and reads it after a separate invocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desk-private-test-'));
  const path = join(directory, 'token.dpapi');
  const value = { refreshToken: 'FAKE-TEST-TOKEN', email: 'test@example.com' };
  try {
    await writePrivate(path, value);
    const file = await readFile(path, 'utf8');
    expect(file).not.toContain(value.refreshToken);
    expect(file).not.toContain(value.email);
    expect(await readPrivate(path)).toEqual(value);
  } finally {
    if (!directory.startsWith(join(tmpdir(), 'desk-private-test-'))) throw new Error('Invalid cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
