import { mkdtemp, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { saveChatFiles } from './chat-files';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});
let dir: string;
afterEach(async () => { vi.clearAllMocks(); if (dir) await rm(dir, { recursive: true, force: true }); });

it('publishes attachments by rename and cleans a partially written temporary file', async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'chat-files-'));
  const upload = { name: 'a.txt', type: 'text/plain' as const, size: 3, data: 'YWJj' };
  await saveChatFiles(dir, 'chat', [upload]);
  expect(rename).toHaveBeenCalledTimes(1);
  const before = await readdir(path.join(dir, 'chat-files', 'chat'));
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(writeFile).mockImplementationOnce(async (file) => {
    await actual.writeFile(file, 'partial');
    throw new Error('disk full');
  });
  await expect(saveChatFiles(dir, 'chat', [upload])).rejects.toThrow('disk full');
  expect(await readdir(path.join(dir, 'chat-files', 'chat'))).toEqual(before);
  vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
  await expect(saveChatFiles(dir, 'chat', [upload])).rejects.toThrow('rename failed');
  expect(await readdir(path.join(dir, 'chat-files', 'chat'))).toEqual(before);
  await expect(saveChatFiles(dir, 'chat', [upload, { ...upload, type: 'image/png' }])).rejects.toMatchObject({ status: 400 });
  expect(await readdir(path.join(dir, 'chat-files', 'chat'))).toEqual(before);
});
