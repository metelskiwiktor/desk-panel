import { createHash } from 'node:crypto';
import { z } from 'zod';
import { filaDataSchema, filaThreadSchema, filaTypeSchema, type FilaData, type FilaThread } from '../src/fila-contract';
import { TODO_STATUSES, todoDataSchema, type TodoTask } from '../src/todo-contract';
import { parseWorkspace } from '../src/tile-grid';
import { defaultFilaData, legacyBlockerId } from './fila';
import { seedStarterBoards } from './fila-boards';
import { compileFilaQuery, selectFilaThreads } from './fila-query';
import { migrateCockpitCopy } from './cockpit';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const migrationHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const project = z.enum(['DESK', 'CEZR', 'TABL']);
const contextSchema = z.object({ source: z.string(), kind: z.string(), id: z.string() }).passthrough();
export const migrationInputSchema = z.object({
  todos: z.unknown(), cockpit: z.unknown(),
  workspaces: z.array(z.object({ source: z.string().min(1), raw: z.string() }).strict()),
  contexts: z.array(contextSchema),
  coverage: z.object({ workspaces: z.boolean(), contexts: z.boolean(), notes: z.array(z.string()) }).strict(),
}).strict();
export type MigrationInput = z.infer<typeof migrationInputSchema>;
export const migrationPlanSchema = z.object({
  version: z.literal(1), id: z.string().min(1), sourceHash: z.string().length(64),
  status: z.literal('proposal'), at: z.number().finite(),
  records: z.array(z.object({
    oldId: z.string().regex(/^t-[0-9a-f]{8}$/), project, type: filaTypeSchema,
    newId: z.string().regex(/^(DESK|CEZR|TABL)-[1-9][0-9]*$/), uid: z.string().regex(/^f-[0-9a-f]{8}$/),
    module: z.string().max(60).nullable(), fields: filaThreadSchema.shape.fields,
    reason: z.string().min(1), unresolved: z.array(z.string()),
  }).strict()),
  tiles: z.array(z.object({
    source: z.string(), tile: z.string(), query: z.string().max(2000),
    settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    reason: z.string().min(1), unresolved: z.array(z.string()),
  }).strict()),
  unresolved: z.array(z.string()),
}).strict();
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;

/** Internal lookup, not an HTTP redirect or old API. Stable uid also follows later project moves. */
function resolveTodo(data: FilaData, oldId: string) {
  const found = data.threads.filter(t => Array.isArray(t.fields['Dawne ID']) && t.fields['Dawne ID'].includes(oldId));
  if (found.length > 1) throw new Error(`Niejednoznaczne Dawne ID: ${oldId}`);
  return found[0];
}

const actor = (by: TodoTask['by']) => by === 'claude' ? 'claude-code' as const : by;
const idOf = (t: FilaThread) => `${t.project}-${t.number}`;
const fail = (message: string): never => { throw new Error(message); };

/** Deterministic rehearsal only. No filesystem, HTTP, agent/model, credentials or service-store access. */
export function previewMigration(rawInput: unknown, rawPlan: unknown) {
  const input = migrationInputSchema.parse(rawInput);
  const plan = migrationPlanSchema.parse(rawPlan);
  if (migrationHash(input) !== plan.sourceHash) fail('Dane wejściowe zmieniły się od przygotowania planu.');
  const todos = todoDataSchema.parse(input.todos);
  const dropped = (raw: unknown, parsed: unknown, at: string): void => {
    if (!raw || typeof raw !== 'object') return;
    for (const [key, value] of Object.entries(raw)) {
      if (at === 'todos' && key === 'version' && [1, 2].includes(value as number)) continue;
      if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, key)) fail(`Nieznane dane wejściowe: ${at}.${key}; nie pomijamy.`);
      dropped(value, (parsed as Record<string, unknown>)[key], `${at}.${key}`);
    }
  };
  dropped(input.todos, todos, 'todos');
  const items = todos.lists.flatMap(list => list.tasks.map(todo => ({ list, todo })));
  const unique = (values: string[], what: string) => { if (new Set(values).size !== values.length) fail(`Duplikat: ${what}.`); };
  unique(items.map(i => i.todo.id), 'stare ID');
  unique(plan.records.map(r => r.oldId), 'plan stare ID');
  unique(plan.records.map(r => r.newId), 'nowe ID');
  unique(plan.records.map(r => r.uid), 'uid');
  if (items.length !== plan.records.length || items.some(i => !plan.records.some(r => r.oldId === i.todo.id))) fail('Plan musi zawierać dokładnie wszystkie zadania.');
  const data = defaultFilaData();
  data.fieldDefs.push({ name: 'Dawne ID', kind: 'multi' });
  data.fieldDefs.push({ name: 'Dawna lista', kind: 'text' });
  const names = { DESK: 'DeskPanel', CEZR: 'Cezar', TABL: 'Tabularium' };
  for (const key of project.options) data.projects.push({ key, name: names[key], createdAt: plan.at, modules: [], nextNumber: 1 });
  const warnings: string[] = [];
  for (const { todo, list } of items) {
    const row = plan.records.find(r => r.oldId === todo.id)!;
    if (!row.newId.startsWith(`${row.project}-`)) fail(`ID nie pasuje do projektu: ${todo.id}.`);
    const number = Number(row.newId.split('-')[1]);
    if (!Number.isSafeInteger(number)) fail(`Niepoprawny numer: ${todo.id}.`);
    const target = data.projects.find(p => p.key === row.project)!;
    target.nextNumber = Math.max(target.nextNumber, number + 1);
    if (row.module && !target.modules.includes(row.module)) target.modules.push(row.module);
    for (const [name, value] of Object.entries(row.fields)) {
      if (['Dawne ID', 'Dawna lista'].includes(name)) fail('Dawne ID i Dawną listę ustala migrator.');
      const kind = Array.isArray(value) ? 'multi' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'text';
      const def = data.fieldDefs.find(d => d.name.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'));
      if (def && (def.name !== name || def.kind !== kind)) fail(`Konflikt definicji pola: ${name}.`);
      if (!def) data.fieldDefs.push({ name, kind });
    }
    const revisions = [...todo.specRevisions].sort((a, b) => a.revision - b.revision);
    unique(revisions.map(r => String(r.revision)), `rewizje ${todo.id}`);
    const latest = revisions.at(-1);
    if ((todo.specRevision > 0 && (!latest || latest.revision !== todo.specRevision || latest.spec !== todo.spec)) ||
      (todo.specRevision === 0 && (todo.spec !== '' || revisions.length))) fail(`Brak lub sprzeczna bieżąca rewizja: ${todo.id}.`);
    if (revisions.some((r, i) => r.revision !== (revisions[i - 1]?.revision ?? 0) + 1)) warnings.push(`${todo.id}: luki rewizji z dawnej retencji; nie odtwarzamy.`);
    if (todo.history.length === 200) warnings.push(`${todo.id}: historia osiąga dawny limit 200; wcześniejszych wpisów nie odtwarzamy.`);
    const history: FilaThread['history'] = [
      { kind: 'created', by: actor(todo.by), at: todo.createdAt },
      ...todo.history.map(h => ({
        kind: h.kind === 'comment' ? 'comment' as const : 'changed' as const, by: actor(h.by), at: h.at,
        ...(h.text !== undefined ? { text: h.text } : {}),
        ...(h.kind === 'status' ? { changes: [{ field: 'Stan', from: h.from ? TODO_STATUSES[h.from] : null, to: h.to ? TODO_STATUSES[h.to] : null }] } : {}),
      })),
    ];
    const updatedAt = Math.max(todo.createdAt, todo.completedAt ?? 0, ...todo.history.map(h => h.at), ...revisions.map(r => r.at), ...todo.links.map(l => l.at));
    data.threads.push({
      uid: row.uid, project: row.project, number, type: row.type, workflow: 'w-praca', state: TODO_STATUSES[todo.status],
      title: todo.title, description: todo.note, parent: null, module: row.module,
      fields: { Tagi: [], ...row.fields, 'Dawne ID': [todo.id], 'Dawna lista': list.id },
      spec: { enabled: true, revisions: revisions.map(r => ({ number: r.revision, text: r.spec, by: actor(r.by), at: r.at })) },
      cezar: { enabled: true, executor: todo.executor, repo: todo.repo, mode: todo.mode, links: todo.links.filter(l => l.kind !== 'chat') as NonNullable<FilaThread['cezar']>['links'] },
      // The to-do's manual block is the thread's „Zablokowane” (2.3a): the entry a loaded `cezar.blocked` would become, written here already.
      blockers: todo.blocked?.trim() ? [{ id: legacyBlockerId(row.uid), reason: todo.blocked.trim(), origin: { kind: 'ręczne' as const }, at: updatedAt, by: 'panel' as const }] : [],
      archived: false, revision: 1, createdAt: todo.createdAt, updatedAt,
      history, migratedTodo: { list: list.id, listName: list.name, original: structuredClone(todo) },
    });
  }
  seedStarterBoards(data, plan.at);
  // Normal creation uses random ids. An offline plan must produce byte-identical data on every rehearsal.
  for (const p of data.projects) {
    const board = data.boards.find(b => b.id === data.starterBoards[p.key])!;
    const stable = (prefix: string) => `${prefix}-${migrationHash([plan.sourceHash, p.key, prefix]).slice(0, 8)}`;
    board.id = stable('b'); board.views[0].id = stable('v'); board.views[0].sections[0].id = stable('s');
    data.starterBoards[p.key] = board.id;
  }
  filaDataSchema.parse(data);
  // Native domain validation for custom field names, types, dates and project modules.
  for (const def of data.fieldDefs) compileFilaQuery(`projekt = DESK AND pole(${JSON.stringify(def.name)}) istnieje`, data, 'section');
  const mapping = Object.fromEntries(data.threads.map(t => [t.migratedTodo!.original.id, { uid: t.uid, thread: idOf(t) }]));
  const migrated = migrateCockpitCopy(input.cockpit, mapping);
  const records = items.map(({ todo }) => {
    const t = resolveTodo(data, todo.id)!;
    const checks = {
      provenance: migrationHash(t.migratedTodo!.original) === migrationHash(todo),
      content: t.title === todo.title && t.description === todo.note,
      state: t.state === TODO_STATUSES[todo.status],
      times: t.createdAt === todo.createdAt && t.migratedTodo!.original.completedAt === todo.completedAt,
      author: t.history[0].by === actor(todo.by),
      history: t.history.length === todo.history.length + 1 && todo.history.every((h, i) => t.history[i + 1].at === h.at && t.history[i + 1].by === actor(h.by) && t.history[i + 1].text === h.text),
      revisions: todo.specRevisions.every(r => t.spec!.revisions.some(s => s.number === r.revision && s.text === r.spec && s.by === actor(r.by) && s.at === r.at)),
      execution: t.cezar!.executor === todo.executor && t.cezar!.repo === todo.repo && t.cezar!.mode === todo.mode && (t.blockers[0]?.reason ?? null) === (todo.blocked?.trim() || null),
      links: migrationHash(t.cezar!.links) === migrationHash(todo.links.filter(l => l.kind !== 'chat')),
    };
    return { oldId: todo.id, ...mapping[todo.id], project: t.project, type: t.type, state: t.state, module: t.module, fields: t.fields, checks, ok: Object.values(checks).every(Boolean) };
  });
  const sourceTiles = input.workspaces.flatMap(w => {
    const tiles = parseWorkspace(w.raw) ?? fail(`Niepoprawny eksport pulpitu: ${w.source}.`);
    return tiles.filter(t => t.kind === 'todo').map(tile => ({ source: w.source, tile }));
  });
  unique(sourceTiles.map(t => `${t.source}:${t.tile.id}`), 'kafelek źródłowy');
  unique(plan.tiles.map(t => `${t.source}:${t.tile}`), 'kafelek planu');
  if (sourceTiles.length !== plan.tiles.length || sourceTiles.some(s => !plan.tiles.some(t => t.source === s.source && t.tile === s.tile.id))) fail('Plan musi zawierać dokładnie wszystkie kafelki Zadania z eksportów.');
  const tiles = sourceTiles.map(({ source, tile }) => {
    const row = plan.tiles.find(r => r.source === source && r.tile === tile.id)!;
    const list = todos.lists.find(l => l.id === tile.config?.list) ?? todos.lists[0];
    const oldIds = list?.tasks.filter(t => !list.hideDone || !t.done).map(t => t.id) ?? [];
    const selected = selectFilaThreads(data, compileFilaQuery(row.query, data, 'section'));
    const newIds = selected.map(t => t.migratedTodo!.original.id);
    return { source, tile: tile.id, before: tile, after: { ...tile, config: { ...row.settings, query: row.query } },
      list: list?.id ?? null, oldIds, newIds, added: newIds.filter(id => !oldIds.includes(id)), removed: oldIds.filter(id => !newIds.includes(id)),
      oldSettings: { hideDone: list?.hideDone ?? false, showAgent: list?.showAgent ?? false }, reason: row.reason };
  });
  const contexts = input.contexts.map(c => {
    if (c.kind === 'todoList') {
      const list = todos.lists.find(l => l.id === c.id);
      return { source: c.source, context: c, listTargets: list ? data.projects.filter(p => list.tasks.some(t => mapping[t.id].thread.startsWith(`${p.key}-`))).map(p => ({
        project: p.key, query: `projekt = ${p.key} AND pole("Dawna lista") = ${JSON.stringify(list.id)}`,
      })) : null };
    }
    if (c.kind !== 'todo' || !c.id.startsWith('t-')) return { source: c.source, context: c, unchanged: true };
    const t = resolveTodo(data, c.id);
    return { source: c.source, context: c, target: t ? { uid: t.uid, thread: idOf(t) } : null };
  });
  const unresolved = [...plan.unresolved, ...plan.records.flatMap(r => r.unresolved.map(s => `${r.oldId}: ${s}`)), ...plan.tiles.flatMap(t => t.unresolved),
    ...migrated.cockpit.threadDispatches.filter((d: { uid: string }) => !data.threads.some(t => t.uid === d.uid)).map((d: { uid: string }) => `Rejestr wskazuje wątek poza planem pustego celu: ${d.uid}`),
    ...migrated.missing.map(id => `Osierocone zlecenie: ${id}`), ...contexts.filter(c => ('target' in c && !c.target) || ('listTargets' in c && !c.listTargets)).map(c => `Osierocony kontekst: ${c.context.id}`),
    ...(!input.coverage.workspaces ? ['Brak pełnego eksportu konfiguracji urządzeń/pulpitów.'] : []),
    ...(!input.coverage.contexts ? ['Niepełny spis kontekstów rozmów.'] : []), ...input.coverage.notes];
  const report = { plan: plan.id, planHash: migrationHash(plan), sourceHash: plan.sourceHash, status: 'proposal' as const,
    comparison: 'Każdy rekord: treść, Stan, autor, czasy, historia, rewizje, wykonanie, powiązania, pełne pochodzenie; kafelki: różnice zbiorów i ustawień.',
    records, tiles, contexts, dispatches: { mapped: migrated.cockpit.threadDispatches, missing: migrated.missing }, warnings, unresolved,
    matches: records.every(r => r.ok), approved: false, cutoverAllowed: false };
  return { fila: { version: 1 as const, data }, cockpit: migrated.cockpit, report };
}
