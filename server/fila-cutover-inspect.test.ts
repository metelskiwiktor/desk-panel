import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectLockedAutomations, inspectLockedChats } from './fila-cutover-inspect';

it('inspects saved states without constructing engines, writing files or disclosing content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fila-inspect-'));
  try {
    const chats = join(dir, 'hermes-chats'); await mkdir(chats);
    const id = '12345678-1234-1234-1234-123456789abc';
    const raw = JSON.stringify({ id, title: 'Rozmowa', createdAt: 1, updatedAt: 2, turns: [{ status: 'streaming', text: 'prywatne' }] });
    await writeFile(join(chats, `${id}.json`), raw);
    expect(await inspectLockedChats(dir)).toMatchObject({ chats: [{ id, running: true }] });
    expect(JSON.stringify(await inspectLockedChats(dir))).not.toContain('prywatne');
    expect(await readFile(join(chats, `${id}.json`), 'utf8')).toBe(raw);
    const file = join(dir, 'automations.json');
    await writeFile(file, JSON.stringify({ version: 1, automations: [], pending: [], outbox: [] }));
    expect(await inspectLockedAutomations(dir)).toEqual({ automations: [], pendingCount: 0, executionCount: 0, outboxCount: 0 });
    await writeFile(file, JSON.stringify({ version: 1, automations: [] }));
    await expect(inspectLockedAutomations(dir)).rejects.toThrow('Niepełny');
    await writeFile(join(chats, `${id}.json`), '{');
    await expect(inspectLockedChats(dir)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
