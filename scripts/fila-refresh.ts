import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrationHash, migrationInputSchema, migrationPlanSchema, type MigrationInput } from '../server/fila-migration';
import { todoDataSchema } from '../src/todo-contract';

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Build a reviewable fresh input from the saved snapshot; new records never get an inferred project. */
export async function refreshFilaCopy(operation: string, previous: string, expectedPreviousHash: string) {
  const snapshot = join(operation, 'snapshot');
  const manifest = await readJson(join(snapshot, 'manifest.json'));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Brak pełnego snapshotu.');
  for (const entry of manifest.entries) {
    if (typeof entry.name !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(entry.name) || entry.name.split('/').includes('..')) throw new Error('Niepoprawny manifest snapshotu.');
    if (entry.sha256 === null) continue;
    const file = join(snapshot, ...entry.name.split('/'));
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || typeof entry.sha256 !== 'string' || hash(await readFile(file)) !== entry.sha256) throw new Error('Snapshot został zmieniony.');
  }
  const oldInput = migrationInputSchema.parse(await readJson(join(previous, 'input.json')));
  const oldPlan = migrationPlanSchema.parse(await readJson(join(previous, 'plan.json')));
  if (migrationHash(oldPlan) !== expectedPreviousHash) throw new Error('Poprzedni plan nie zgadza się ze skrótem.');
  const todos = await readJson(join(snapshot, 'panel', 'todos.json'));
  const cockpit = await readJson(join(snapshot, 'panel', 'cockpit.json'));
  const lists = todoDataSchema.parse(todos).lists;
  const oldLists = todoDataSchema.parse(oldInput.todos).lists;
  const oldRecords = new Map(oldLists.flatMap(list => list.tasks.map(task => [task.id, { list: list.id, task }] as const)));
  const records = new Map(lists.flatMap(list => list.tasks.map(task => [task.id, { list: list.id, task }] as const)));
  const added = [...records.keys()].filter(id => !oldRecords.has(id));
  const removed = [...oldRecords.keys()].filter(id => !records.has(id));
  const changed = [...records.keys()].filter(id => oldRecords.has(id) && migrationHash(records.get(id)) !== migrationHash(oldRecords.get(id)));
  const kiosk = await readJson(join(snapshot, 'kiosk', 'kiosk-export.json'));
  if (!kiosk || typeof kiosk.origin !== 'string' || !Array.isArray(kiosk.workspaces)) throw new Error('Niepoprawny eksport kiosku.');
  const workspaces = kiosk.workspaces.map((workspace: { key: string; raw: string }) => {
    if (!workspace || typeof workspace.key !== 'string' || typeof workspace.raw !== 'string') throw new Error('Niepoprawny układ kiosku.');
    const matches = oldInput.workspaces.filter(item => item.source.endsWith(` ${workspace.key}`) && item.source.includes(` / ${kiosk.origin} / `));
    if (matches.length !== 1) throw new Error('Nowy albo niejednoznaczny układ kiosku wymaga osobnej decyzji.');
    return { source: matches[0].source, raw: workspace.raw };
  });
  if (workspaces.length !== oldInput.workspaces.length) throw new Error('Liczba układów kiosku zmieniła się; wymagana decyzja.');
  const changedWorkspaces = workspaces.filter((workspace: { source: string; raw: string }) => oldInput.workspaces.find(old => old.source === workspace.source)?.raw !== workspace.raw);
  const contexts: MigrationInput['contexts'] = [];
  const collect = (value: unknown, source: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((child, i) => collect(child, `${source}/${i}`)); return; }
    const object = value as Record<string, unknown>;
    if ((object.kind === 'todo' || object.kind === 'todoList') && typeof object.id === 'string' && typeof object.title === 'string' && typeof object.text === 'string') {
      contexts.push({ source, kind: object.kind, id: object.id, title: object.title, text: object.text }); return;
    }
    for (const [key, child] of Object.entries(object)) collect(child, `${source}/${key}`);
  };
  for (const name of ['hermes-chats', 'chats']) {
    const directory = join(snapshot, 'panel', name);
    let files: string[];
    try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const file of files.sort()) {
      if (!file.endsWith('.json')) throw new Error('Nieznany plik w katalogu mapowań rozmów.');
      collect(await readJson(join(directory, file)), `${name}/${file}`);
    }
  }
  const input = migrationInputSchema.parse({ todos, cockpit, workspaces, contexts, coverage: { workspaces: true, contexts: true, notes: [] } });
  const unresolved = [...added.map(id => `Nowe zadanie wymaga decyzji: ${id}`), ...changed.map(id => `Zmienione zadanie wymaga decyzji: ${id}`), ...removed.map(id => `Usunięte zadanie wymaga decyzji: ${id}`),
    ...changedWorkspaces.map((workspace: { source: string }) => `Zmieniony układ kiosku wymaga decyzji: ${workspace.source}`)];
  const plan = { ...oldPlan, id: `fila-1.6-refresh-${Date.now()}`, at: Date.now(), sourceHash: migrationHash(input),
    records: oldPlan.records.filter(record => records.has(record.oldId)), unresolved };
  const changes = { added: added.map(id => records.get(id)), removed: removed.map(id => oldRecords.get(id)), changed: changed.map(id => ({ before: oldRecords.get(id), after: records.get(id) })),
    workspaces: changedWorkspaces.map((workspace: { source: string; raw: string }) => ({ before: oldInput.workspaces.find(old => old.source === workspace.source), after: workspace })) };
  for (const [name, value] of [['input.json', input], ['plan.json', plan], ['differences.json', changes]] as const)
    await writeFile(join(operation, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  return { sourceHash: plan.sourceHash, planHash: migrationHash(plan), added: added.length, removed: removed.length, changed: changed.length, contexts: contexts.length };
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()) {
  const [operation, previous, hashValue] = process.argv.slice(2);
  if (!operation || !previous || !hashValue) { console.error('Użycie: fila-refresh KATALOG_NOWEJ_KOPII KATALOG_POPRZEDNIEGO_PLANU HASH_PLANU'); process.exitCode = 1; }
  else (async () => {
    const root = await realpath(join(homedir(), '.desk-panel', 'fila-migration'));
    const next = await realpath(resolve(operation)), prior = await realpath(resolve(previous));
    const inside = (value: string) => { const rel = relative(root, value); return !!rel && rel !== '..' && !rel.startsWith(`..${requireSeparator()}`) && !isAbsolute(rel); };
    if (!inside(next) || !inside(prior) || next === prior) throw new Error('Wybierz dwa osobne katalogi migracji.');
    for (const name of ['input.json', 'plan.json']) { const info = await lstat(join(prior, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error('Niepoprawny poprzedni plan.'); }
    const marker = await readJson(join(next, 'offline.json'));
    if (marker.kind !== 'fila-migration-copy' || marker.version !== 1) throw new Error('Brak znacznika kopii.');
    return refreshFilaCopy(next, prior, hashValue);
  })().then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Nie utworzono kompletnej propozycji. Sprawdź snapshot, poprzedni plan i zmiany kiosku.'); process.exitCode = 1;
  });
}

function requireSeparator() { return process.platform === 'win32' ? '\\' : '/'; }
