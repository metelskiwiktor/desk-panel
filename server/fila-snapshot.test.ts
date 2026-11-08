import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { captureCutoverSnapshot, verifyCutoverSnapshot } from './fila-snapshot';

it('captures named files and explicit absence without changing their sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fila-snapshot-'));
  try {
    const source = join(root, 'source'), operation = join(root, 'operation');
    await mkdir(source); await mkdir(operation); await mkdir(join(source, 'chats'));
    await writeFile(join(source, 'todos.json'), 'original');
    await writeFile(join(source, 'chats', 'one.json'), 'chat');
    let checks = 0;
    const inputs = { 'panel/todos.json': join(source, 'todos.json'), 'panel/missing.json': join(source, 'missing.json'), 'panel/chats': join(source, 'chats') };
    await captureCutoverSnapshot(operation, inputs, async () => { checks++; });
    expect(checks).toBe(2);
    const manifest = JSON.parse(await readFile(join(operation, 'snapshot', 'manifest.json'), 'utf8'));
    expect(manifest.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'panel/missing.json', sha256: null }), expect.objectContaining({ name: 'panel/chats/one.json' })]));
    expect(await readFile(join(operation, 'snapshot', 'panel', 'todos.json'), 'utf8')).toBe('original');
    expect(await readFile(join(source, 'todos.json'), 'utf8')).toBe('original');
    await verifyCutoverSnapshot(operation, inputs, async () => {});
    await writeFile(join(source, 'missing.json'), 'new');
    await expect(verifyCutoverSnapshot(operation, inputs, async () => {})).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
