import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectAutomationStore } from './automations';

/** Inspect saved Hermes mappings without constructing an engine or resuming pending turns. */
export async function inspectLockedChats(directory: string) {
  const root = join(directory, 'hermes-chats');
  let files: string[];
  try { files = await readdir(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { chats: [] }; throw error; }
  const chats = [];
  for (const file of files) {
    if (!/^[0-9a-f-]{36}\.json$/.test(file)) throw new Error('Niepełny odczyt mapowań rozmów.');
    const value = JSON.parse(await readFile(join(root, file), 'utf8'));
    if (value.id !== file.slice(0, -5) || typeof value.title !== 'string' || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !Array.isArray(value.turns) ||
        value.turns.some((turn: { status?: unknown }) => !['streaming', 'done', 'error', 'stopped'].includes(String(turn.status)))) throw new Error('Niepoprawne mapowanie rozmowy.');
    chats.push({ id: value.id, title: value.title, createdAt: value.createdAt, updatedAt: value.updatedAt,
      messages: value.turns.length * 2, running: value.turns.some((turn: { status: string }) => turn.status === 'streaming'),
      engine: 'hermes', archived: !!value.archived, temporary: !!value.temporary });
  }
  return { chats };
}

/** Only status, counters and scheduled times; no automation instructions, tokens or personal content. */
export async function inspectLockedAutomations(directory: string) {
  const file = join(directory, 'automations.json');
  return inspectAutomationStore(JSON.parse(await readFile(file, 'utf8')));
}
