import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationHash, previewMigration, type MigrationInput, type MigrationPlan } from './fila-migration';
import { todoTaskSchema, TODO_STATUSES } from '../src/todo-contract';
import { createFilaStore } from './fila';
import { migrateCockpitCopy, createCockpit } from './cockpit';
import { runMigration } from '../scripts/fila-migrate';
import { installCutoverCopy, openCutoverCopy, restoreCutoverCopy } from './fila-cutover-install';
import { readCutoverMode } from './fila-cutover-gate';
import { resolveFilaContext, resolveLegacyThread } from './fila-context';
import { callFilaTool } from './fila-mcp';
import { captureCutoverSnapshot } from './fila-snapshot';
import { refreshFilaCopy } from '../scripts/fila-refresh';
import type { PanelSources } from './sources';

function fixture() {
  const todos = Object.keys(TODO_STATUSES).map((status, i) => todoTaskSchema.parse({
    id: `t-${String(i + 1).padStart(8, '0')}`, title: `Przykład ${i}`, note: 'opis\n🙂', done: false,
    status, createdAt: 10, completedAt: 20, by: ['user', 'claude', 'codex', 'panel', 'agent', 'wektor', 'claude'][i],
    executor: 'lokalnie', repo: 'desk-panel', mode: 'analiza', blocked: 'czeka',
    links: [{ kind: 'chat', id: 'chat-1', at: 12 }, { kind: 'cezar', id: `run-${i}`, at: 13 }, { kind: 'pr', id: 'https://github.com/a/b/pull/1', at: 14 }],
    history: [{ kind: 'comment', by: 'claude', at: 15, text: 'pełny komentarz\n🙂' }, { kind: 'status', by: 'panel', at: 16, from: 'pomysl', to: status }, { kind: 'blocked', by: 'agent', at: 17, text: 'czeka' }],
    spec: 'nowa', specRevision: 13, specRevisions: [{ revision: 11, spec: 'stara', by: 'panel', at: 21 }, { revision: 13, spec: 'nowa', by: 'claude', at: 22 }],
  }));
  const input: MigrationInput = {
    todos: { version: 2, lists: [{ id: 'l-00000001', name: 'Mieszana', createdAt: 1, hideDone: true, showAgent: true, tasks: todos }] },
    cockpit: { version: 1, todoDispatches: [
      { todoId: todos[0].id, specRevision: 13, mode: 'analiza', taskId: 'failed-run', url: 'http://localhost/run/old', at: 10 },
      { todoId: todos[0].id, specRevision: 13, mode: 'analiza', taskId: 'latest-run', url: 'http://localhost/run/new', at: 11 },
    ], chats: { chat1: { runs: ['card-run'], dispatches: { card: { decision: 'dispatched', taskId: 'card-run', todoId: todos[1].id, url: 'http://localhost/card', prompt: 'keep literally', at: 19 } } } }, unrelated: { keep: true } },
    contexts: [{ source: 'chat/turn', kind: 'todo', id: todos[0].id, title: 'dawny tytuł', text: 'stary tekst' }, { source: 'chat/turn2', kind: 'todoList', id: 'l-00000001' }],
    workspaces: [{ source: 'device/main', raw: JSON.stringify({ version: 1, tiles: [{ kind: 'todo', id: 'todo#1', c: 0, r: 0, w: 2, h: 1, config: { list: 'l-00000001' } }] }) }],
    coverage: { workspaces: true, contexts: true, notes: [] },
  };
  const plan: MigrationPlan = {
    version: 1, id: 'proposal-test', at: 100, sourceHash: migrationHash(input), status: 'proposal', unresolved: [],
    records: todos.map((t, i) => ({ oldId: t.id, project: i % 2 ? 'TABL' : 'DESK', newId: `${i % 2 ? 'TABL' : 'DESK'}-${i + 1}`, uid: `f-${String(i + 1).padStart(8, '0')}`, type: 'funkcja', module: 'Próba', fields: { Tagi: ['test'], Liczba: 7, Flaga: true }, reason: 'jawna decyzja próbna', unresolved: [] })),
    tiles: [{ source: 'device/main', tile: 'todo#1', query: 'projekt = DESK AND otwarte', settings: { showAgent: true }, reason: 'jawna zmiana zbioru', unresolved: [] }],
  };
  return { input, plan, todos };
}

describe('offline migration integrity', () => {
  it('refreshes from a snapshot without guessing mappings for new or changed records', async () => {
    const fixtureData = fixture();
    const input = structuredClone(fixtureData.input), plan = structuredClone(fixtureData.plan);
    const origin = 'http://127.0.0.1:5174', key = 'desk-panel.workspace';
    const source = `kiosk / Chrome kiosk-chrome / ${origin} / ${key}`;
    input.workspaces[0].source = source; plan.tiles[0].source = source; plan.sourceHash = migrationHash(input);
    const freshTodos = structuredClone(input.todos) as { lists: { tasks: unknown[] }[] };
    freshTodos.lists[0].tasks.push(todoTaskSchema.parse({ ...(freshTodos.lists[0].tasks[0] as object), id: 't-99999999', title: 'Nowe' }));
    const root = await mkdtemp(join(tmpdir(), 'fila-refresh-'));
    const sourceDir = join(root, 'source'), operation = join(root, 'operation'), previous = join(root, 'previous');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(sourceDir); await mkdir(operation); await mkdir(previous);
    await writeFile(join(previous, 'input.json'), JSON.stringify(input));
    await writeFile(join(previous, 'plan.json'), JSON.stringify(plan));
    await writeFile(join(sourceDir, 'todos.json'), JSON.stringify(freshTodos));
    await writeFile(join(sourceDir, 'cockpit.json'), JSON.stringify(input.cockpit));
    await writeFile(join(sourceDir, 'kiosk.json'), JSON.stringify({ origin, workspaces: [{ key, raw: input.workspaces[0].raw }] }));
    await captureCutoverSnapshot(operation, { 'panel/todos.json': join(sourceDir, 'todos.json'), 'panel/cockpit.json': join(sourceDir, 'cockpit.json'), 'kiosk/kiosk-export.json': join(sourceDir, 'kiosk.json') }, async () => {});
    const result = await refreshFilaCopy(operation, previous, migrationHash(plan));
    expect(result.added).toBe(1);
    const next = JSON.parse(await readFile(join(operation, 'plan.json'), 'utf8'));
    expect(next.records).toEqual(plan.records);
    expect(next.records.some((record: { oldId: string }) => record.oldId === 't-99999999')).toBe(false);
    expect(next.unresolved.join(' ')).toContain('t-99999999');
    expect(JSON.parse(await readFile(join(previous, 'plan.json'), 'utf8'))).toEqual(plan);
  });
  it('installs only a matching rehearsal and refuses startup after interrupted installation', async () => {
    const { input, plan } = fixture();
    const result = previewMigration(input, plan);
    const output = { fila: result.fila, cockpit: result.cockpit };
    const root = await mkdtemp(join(tmpdir(), 'fila-install-'));
    const operation = join(root, 'operation'), target = join(root, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(operation); await mkdir(target);
    for (const [name, value] of Object.entries({ 'input.json': input, 'plan.json': plan, 'result.json': output,
      'trial.json': { planHash: migrationHash(plan), sourceHash: plan.sourceHash, resultHash: migrationHash(output) } }))
      await writeFile(join(operation, name), JSON.stringify(value));
    await writeFile(join(target, 'todos.json'), JSON.stringify(input.todos));
    await writeFile(join(target, 'cockpit.json'), JSON.stringify(input.cockpit));
    let checks = 0;
    await expect(installCutoverCopy(target, operation, migrationHash(plan), async () => { if (++checks === 4) throw new Error('przerwano'); })).rejects.toThrow('przerwano');
    expect(() => readCutoverMode(target)).toThrow();
    expect(JSON.parse(await readFile(join(target, 'fila-cutover.json'), 'utf8')).state).toBe('installing');
    expect(JSON.parse(await readFile(join(operation, 'install-backup', 'todos.json'), 'utf8'))).toEqual(input.todos);
    await writeFile(join(target, 'cockpit.json'), '{}');
    await expect(restoreCutoverCopy(target, operation, async () => {})).rejects.toThrow('nieznane zmiany');
    await writeFile(join(target, 'cockpit.json'), JSON.stringify(output.cockpit, null, 2));
    await restoreCutoverCopy(target, operation, async () => {});
    expect(readCutoverMode(target)).toBe('legacy');
  });
  it('installs the compared result and validates both files before opening the read-only gate', async () => {
    const { input, plan } = fixture();
    const result = previewMigration(input, plan);
    const output = { fila: result.fila, cockpit: result.cockpit };
    const root = await mkdtemp(join(tmpdir(), 'fila-install-'));
    const operation = join(root, 'operation'), target = join(root, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(operation); await mkdir(target);
    for (const [name, value] of Object.entries({ 'input.json': input, 'plan.json': plan, 'result.json': output,
      'trial.json': { planHash: migrationHash(plan), sourceHash: plan.sourceHash, resultHash: migrationHash(output) } }))
      await writeFile(join(operation, name), JSON.stringify(value));
    await writeFile(join(target, 'todos.json'), JSON.stringify(input.todos));
    await writeFile(join(target, 'cockpit.json'), JSON.stringify(input.cockpit));
    await installCutoverCopy(target, operation, migrationHash(plan), async () => {});
    expect(readCutoverMode(target)).toBe('locked');
    expect(JSON.parse(await readFile(join(target, 'fila.json'), 'utf8'))).toEqual(output.fila);
    expect(JSON.parse(await readFile(join(target, 'cockpit.json'), 'utf8'))).toEqual(output.cockpit);
    for (const name of ['input.json', 'plan.json', 'trial.json', 'result.json']) await unlink(join(operation, name));
    await restoreCutoverCopy(target, operation, async () => {});
    expect(readCutoverMode(target)).toBe('legacy');
    expect(JSON.parse(await readFile(join(target, 'cockpit.json'), 'utf8'))).toEqual(input.cockpit);
    await expect(readFile(join(target, 'fila.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects an installation when the source has changed', async () => {
    const { input, plan } = fixture();
    const result = previewMigration(input, plan);
    const output = { fila: result.fila, cockpit: result.cockpit };
    const root = await mkdtemp(join(tmpdir(), 'fila-install-'));
    const operation = join(root, 'operation'), target = join(root, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(operation); await mkdir(target);
    for (const [name, value] of Object.entries({ 'input.json': input, 'plan.json': plan, 'result.json': output,
      'trial.json': { planHash: migrationHash(plan), sourceHash: plan.sourceHash, resultHash: migrationHash(output) } }))
      await writeFile(join(operation, name), JSON.stringify(value));
    await writeFile(join(target, 'todos.json'), '{}');
    await writeFile(join(target, 'cockpit.json'), JSON.stringify(input.cockpit));
    await expect(installCutoverCopy(target, operation, migrationHash(plan), async () => {})).rejects.toThrow('zmienił');
    expect(readCutoverMode(target)).toBe('legacy');
    expect(await readFile(join(target, 'todos.json'), 'utf8')).toBe('{}');
  });
  it('keeps the previous system usable before the marker and can restore after the marker', async () => {
    for (const failAt of [2, 3]) {
      const { input, plan } = fixture();
      const result = previewMigration(input, plan), output = { fila: result.fila, cockpit: result.cockpit };
      const root = await mkdtemp(join(tmpdir(), 'fila-install-'));
      const operation = join(root, 'operation'), target = join(root, 'target');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(operation); await mkdir(target);
      for (const [name, value] of Object.entries({ 'input.json': input, 'plan.json': plan, 'result.json': output,
        'trial.json': { planHash: migrationHash(plan), sourceHash: plan.sourceHash, resultHash: migrationHash(output) } }))
        await writeFile(join(operation, name), JSON.stringify(value));
      await writeFile(join(target, 'todos.json'), JSON.stringify(input.todos));
      await writeFile(join(target, 'cockpit.json'), JSON.stringify(input.cockpit));
      let checks = 0;
      await expect(installCutoverCopy(target, operation, migrationHash(plan), async () => { if (++checks === failAt) throw new Error('przerwano'); })).rejects.toThrow('przerwano');
      if (failAt === 2) expect(readCutoverMode(target)).toBe('legacy');
      else {
        expect(() => readCutoverMode(target)).toThrow();
        await restoreCutoverCopy(target, operation, async () => {});
        expect(readCutoverMode(target)).toBe('legacy');
      }
      expect(JSON.parse(await readFile(join(target, 'cockpit.json'), 'utf8'))).toEqual(input.cockpit);
      await expect(readFile(join(target, 'fila.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
  it('preserves an external change noticed after the prepared marker', async () => {
    const { input, plan } = fixture();
    const result = previewMigration(input, plan), output = { fila: result.fila, cockpit: result.cockpit };
    const root = await mkdtemp(join(tmpdir(), 'fila-install-'));
    const operation = join(root, 'operation'), target = join(root, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(operation); await mkdir(target);
    for (const [name, value] of Object.entries({ 'input.json': input, 'plan.json': plan, 'result.json': output,
      'trial.json': { planHash: migrationHash(plan), sourceHash: plan.sourceHash, resultHash: migrationHash(output) } }))
      await writeFile(join(operation, name), JSON.stringify(value));
    await writeFile(join(target, 'todos.json'), JSON.stringify(input.todos));
    await writeFile(join(target, 'cockpit.json'), JSON.stringify(input.cockpit));
    let checks = 0;
    await expect(installCutoverCopy(target, operation, migrationHash(plan), async () => {
      if (++checks === 3) await writeFile(join(target, 'cockpit.json'), '{"new":true}');
    })).rejects.toThrow('zmienił');
    await restoreCutoverCopy(target, operation, async () => {});
    expect(await readFile(join(target, 'cockpit.json'), 'utf8')).toBe('{"new":true}');
    expect(readCutoverMode(target)).toBe('legacy');
  });
  it('opens only after all acceptance checks and forbids restoration after the boundary', async () => {
    const { input, plan } = fixture();
    const result = previewMigration(input, plan), output = { fila: result.fila, cockpit: result.cockpit };
    const root = await mkdtemp(join(tmpdir(), 'fila-install-'));
    const operation = join(root, 'operation'), target = join(root, 'target');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(operation); await mkdir(target);
    for (const [name, value] of Object.entries({ 'input.json': input, 'plan.json': plan, 'result.json': output,
      'trial.json': { planHash: migrationHash(plan), sourceHash: plan.sourceHash, resultHash: migrationHash(output) } }))
      await writeFile(join(operation, name), JSON.stringify(value));
    await writeFile(join(target, 'todos.json'), JSON.stringify(input.todos));
    await writeFile(join(target, 'cockpit.json'), JSON.stringify(input.cockpit));
    const kiosk = { snapshot: { origin: 'test' }, rows: [] };
    await installCutoverCopy(target, operation, migrationHash(plan), async () => {}, kiosk);
    await writeFile(join(operation, 'acceptance.json'), JSON.stringify({ planHash: migrationHash(plan), kioskHash: migrationHash(kiosk.snapshot), checks: {} }));
    await expect(openCutoverCopy(target, operation, migrationHash(plan), async () => {})).rejects.toThrow('Odbiór');
    const checks = Object.fromEntries(['data', 'legacyIds', 'kiosk', 'clients', 'cezar', 'oldApi', 'gate'].map(name => [name, true]));
    await writeFile(join(operation, 'acceptance.json'), JSON.stringify({ planHash: migrationHash(plan), kioskHash: migrationHash(kiosk.snapshot), checks }));
    await openCutoverCopy(target, operation, migrationHash(plan), async () => {});
    expect(readCutoverMode(target)).toBe('active');
    await expect(restoreCutoverCopy(target, operation, async () => {})).rejects.toThrow('Brak zamkniętej bramki');
    await unlink(join(target, 'fila.json'));
    expect(() => readCutoverMode(target)).toThrow();
  });
  it('preserves every record, authors, timestamps, complete retained revisions, links and contexts through native reads and moves', async () => {
    const { input, plan, todos } = fixture();
    const original = migrationHash(input);
    const result = previewMigration(input, plan);
    expect(result.report.matches).toBe(true);
    expect(result.report.records).toHaveLength(todos.length);
    expect(result.report.warnings).toHaveLength(todos.length);
    expect(result.report.cutoverAllowed).toBe(false);
    const store = createFilaStore({ initial: result.fila.data });
    expect(await resolveLegacyThread(todos[0].id, store)).toBe(plan.records[0].newId);
    const pointed = await resolveFilaContext([
      { kind: 'todo', id: todos[0].id, title: 'stary', text: 'stary opis' },
      { kind: 'todoList', id: 'l-00000001', title: 'lista', text: 'stare wiersze' },
    ], store);
    expect(pointed[0]).toMatchObject({ kind: 'filaThread', id: plan.records[0].newId });
    expect(pointed[1].text).toContain('pole("Dawna lista")');
    const oldGet = await callFilaTool('fila_get', { thread: todos[0].id }, { fila: store, actor: 'codex' });
    expect(oldGet).toMatchObject({ isError: true });
    for (const [i, todo] of todos.entries()) {
      const id = plan.records[i].newId;
      const thread = await store.thread(id);
      expect(thread.migratedTodo?.original).toEqual(todo);
      expect(thread.description).toBe(todo.note);
      expect(thread.closed).toBe(todo.done);
      expect(thread.cezar.links).toEqual(todo.links.filter(l => l.kind !== 'chat'));
      expect(thread.history.slice(1).map(h => [h.at, h.text])).toEqual(todo.history.map(h => [h.at, h.text]));
      expect(await store.spec(id, 11)).toMatchObject({ revision: 11, text: 'stara', by: 'panel', at: 21 });
      expect(await store.spec(id)).toMatchObject({ revision: 13, text: 'nowa', by: 'claude-code' });
      expect((await store.query(`projekt = ${thread.project} AND pole("Dawne ID") = "${todo.id}"`)).threads.map(t => t.id)).toEqual([id]);
    }
    expect(result.report.contexts[0]).toMatchObject({ context: input.contexts[0], target: { thread: 'DESK-1' } });
    expect(result.report.tiles[0]).toMatchObject({ removed: expect.arrayContaining(['t-00000002']), oldSettings: { hideDone: true, showAgent: true } });
    expect(result.report.tiles[0].after).toMatchObject({ c: 0, r: 0, w: 2, h: 1, config: { query: 'projekt = DESK AND otwarte' } });
    await store.apply({ action: 'updateThread', thread: 'DESK-1', project: 'CEZR', module: null }, 'codex');
    expect(await store.idOfUid(plan.records[0].uid)).toBe('CEZR-1');
    expect((await store.query('projekt = CEZR AND pole("Dawne ID") = "t-00000001"')).threads[0].id).toBe('CEZR-1');
    await expect(store.thread('t-00000001')).rejects.toThrow();
    expect(migrationHash(input)).toBe(original);
    expect(previewMigration(input, plan)).toEqual(result);
  });

  it('keeps cockpit register retries, one writer, card outcomes, unknown data and PR linking after restart', async () => {
    const { input, plan } = fixture();
    const result = previewMigration(input, plan);
    const mapping = Object.fromEntries(result.report.records.map(r => [r.oldId, { uid: r.uid, thread: r.thread }]));
    expect(migrateCockpitCopy(result.cockpit, mapping).cockpit).toEqual(result.cockpit);
    expect(result.cockpit.unrelated).toEqual({ keep: true });
    expect(result.cockpit.chats.chat1.dispatches.card).toMatchObject({ todoId: 't-00000002', threadUid: 'f-00000002', prompt: 'keep literally' });
    const root = await mkdtemp(join(tmpdir(), 'fila-cockpit-'));
    const file = join(root, 'cockpit.json');
    await writeFile(file, JSON.stringify(result.cockpit));
    const store = createFilaStore({ initial: result.fila.data });
    const todoAction = () => { throw new Error('Must not write old todos'); };
    const cockpit = createCockpit({ file, cezarUrl: 'http://localhost', sources: { fila: store, todoAction } as unknown as PanelSources });
    expect(cockpit.threadDispatches()).toHaveLength(1);
    expect(cockpit.threadDispatches()[0].taskId).toBe('latest-run');
    await store.apply({ action: 'updateThread', thread: 'DESK-1', project: 'CEZR', module: null }, 'codex');
    await cockpit.linkPrs([{ id: 'latest-run', pullRequestUrl: 'https://github.com/a/b/pull/2' }, { id: 'card-run', pullRequestUrl: 'https://github.com/a/b/pull/3' }]);
    expect((await store.thread('CEZR-1')).cezar.links.some(l => l.id.endsWith('/2'))).toBe(true);
    expect((await store.thread('TABL-2')).cezar.links.some(l => l.id.endsWith('/3'))).toBe(true);
    expect((await store.thread('CEZR-1')).uid).toBe('f-00000001');
  });

  it('refuses stale input, omissions, duplicate ids, unknown source data, spec loss and invalid queries; lists all unresolved references', () => {
    const { input, plan } = fixture();
    const changed = structuredClone(input); changed.contexts.push({ source: 'x', kind: 'todo', id: 't-ffffffff' });
    expect(() => previewMigration(changed, plan)).toThrow(/zmieniły/);
    expect(() => previewMigration(input, { ...plan, records: plan.records.slice(1) })).toThrow(/wszystkie/);
    expect(() => previewMigration(input, { ...plan, records: plan.records.map(r => ({ ...r, uid: 'f-11111111' })) })).toThrow(/Duplikat/);
    expect(() => previewMigration(input, { ...plan, tiles: [{ ...plan.tiles[0], query: 'projekt = BRAK' }] })).toThrow();
    const unknown = structuredClone(input); (unknown.todos as any).lists[0].tasks[0].newUnknown = 'must survive';
    expect(() => previewMigration(unknown, { ...plan, sourceHash: migrationHash(unknown) })).toThrow(/Nieznane/);
    const noSpec = structuredClone(input); (noSpec.todos as any).lists[0].tasks[0].specRevisions.pop();
    expect(() => previewMigration(noSpec, { ...plan, sourceHash: migrationHash(noSpec) })).toThrow(/rewizja/);
    changed.coverage.workspaces = false;
    const report = previewMigration(changed, { ...plan, sourceHash: migrationHash(changed), unresolved: ['decyzja użytkownika'] }).report;
    expect(report.unresolved).toEqual(expect.arrayContaining(['decyzja użytkownika', 'Osierocony kontekst: t-ffffffff', 'Brak pełnego eksportu konfiguracji urządzeń/pulpitów.']));
  });

  it('previews without result writes, repeats without duplicates, restores the baseline, refuses rollback after new writes', async () => {
    const { input, plan } = fixture();
    const root = await mkdtemp(join(tmpdir(), 'fila-migration-'));
    for (const [name, value] of Object.entries({ 'offline.json': { version: 1, kind: 'fila-migration-copy' }, 'input.json': input, 'plan.json': plan })) await writeFile(join(root, name), JSON.stringify(value));
    await runMigration('preview', root);
    await expect(readFile(join(root, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await runMigration('trial', root);
    const result = await readFile(join(root, 'result.json'), 'utf8');
    const stored = JSON.parse(result);
    await writeFile(join(root, 'fila.json'), JSON.stringify(stored.fila));
    const native = createFilaStore({ file: join(root, 'fila.json') });
    expect((await native.spec('DESK-1')).revision).toBe(13);
    expect((await native.thread('DESK-1')).migratedTodo?.original.links[0].kind).toBe('chat');
    await runMigration('trial', root);
    expect(await readFile(join(root, 'result.json'), 'utf8')).toBe(result);
    await runMigration('rollback', root);
    expect(await readFile(join(root, 'result.json'), 'utf8')).toBe(await readFile(join(root, 'before.json'), 'utf8'));
    await runMigration('trial', root);
    await writeFile(join(root, 'result.json'), '{"newWrites":true}');
    await expect(runMigration('rollback', root)).rejects.toThrow(/naprawa w przód/);
    await expect(runMigration('trial', root)).rejects.toThrow(/naprawa w przód/);
    await expect(runMigration('preview', process.cwd())).rejects.toThrow(/poza repo/);
    const unmarked = await mkdtemp(join(tmpdir(), 'fila-unmarked-'));
    await expect(runMigration('trial', unmarked)).rejects.toThrow();
  });
});
