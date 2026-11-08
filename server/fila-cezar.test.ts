// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FilaAction, FilaBoardActor } from '../src/fila-contract';
import { createFilaStore, FilaError, type FilaStore } from './fila';

const act = (store: FilaStore, action: FilaAction, actor: FilaBoardActor = 'claude-code') => store.apply(action, actor);
const refused = async (promise: Promise<unknown>, status: number, text?: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(FilaError);
  expect(error.status).toBe(status);
  if (text) expect(error.message).toMatch(text);
};
async function seeded() {
  const store = createFilaStore();
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  await act(store, { action: 'createProject', key: 'CEZA', name: 'Cezar' });
  await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Wątek' });
  return store;
}
const PR = 'https://github.com/metelskiwiktor/desk-panel/pull/12';

describe('the Cezar kit of a thread', () => {
  it('is added to any type, holds executor, repo and mode with the vocabulary of the lists, and is empty until added', async () => {
    const store = await seeded();
    expect((await store.thread('DESK-1')).cezar).toEqual({ enabled: false, executor: null, repo: null, mode: null, blocked: null, links: [] });
    await refused(act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'cezar' }), 409, /addCezarKit/);
    await act(store, { action: 'addCezarKit', thread: 'DESK-1' }, 'user');
    await act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' }, 'user');
    expect((await store.thread('DESK-1')).cezar).toMatchObject({ enabled: true, executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    await refused(act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'inny' as never }), 400);
    await refused(act(store, { action: 'setCezar', thread: 'DESK-1', repo: 'inne' as never }), 400);
    await refused(act(store, { action: 'setCezar', thread: 'DESK-1' } as never), 400);
    await act(store, { action: 'setCezar', thread: 'DESK-1', mode: null });
    expect((await store.thread('DESK-1')).cezar.mode).toBeNull();
  });

  it('writes history and a revision for a real change only, and honours expectedRevision', async () => {
    const store = await seeded();
    await act(store, { action: 'addCezarKit', thread: 'DESK-1' });
    const revision = (await store.thread('DESK-1')).revision;
    await act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'cezar' });
    const after = await store.thread('DESK-1');
    expect(after.revision).toBe(revision + 1);
    expect(after.history.at(-1)).toMatchObject({ kind: 'changed', changes: [{ field: 'Wykonawca', from: null, to: 'cezar' }] });
    await act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'cezar' });
    expect((await store.thread('DESK-1')).revision).toBe(revision + 1);
    await refused(act(store, { action: 'setCezar', thread: 'DESK-1', mode: 'analiza', expectedRevision: revision }), 409);
    expect((await store.thread('DESK-1')).cezar.mode).toBeNull();
    await act(store, { action: 'setCezar', thread: 'DESK-1', blocked: 'Czekam na decyzję' });
    await act(store, { action: 'setCezar', thread: 'DESK-1', blocked: '  ' });
    expect((await store.thread('DESK-1')).cezar.blocked).toBeNull();
  });

  it('keeps task and PR links unique by kind and id, limited to 20, validates the PR URL, and a repeat changes nothing', async () => {
    const store = await seeded();
    await refused(act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: 'desk-panel/run-1' }), 409, /addCezarKit/);
    await act(store, { action: 'addCezarKit', thread: 'DESK-1' });
    await act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: 'desk-panel/run-1', title: 'Wątek' });
    const once = await store.thread('DESK-1');
    await act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: 'desk-panel/run-1' });
    expect(await store.thread('DESK-1')).toEqual(once);
    await refused(act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'pr', id: 'https://example.com/x' }), 400);
    await act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'pr', id: PR });
    for (let i = 0; i < 18; i++) await act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: `desk-panel/r-${i}` });
    await refused(act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: 'desk-panel/extra' }), 409, /20/);
    await act(store, { action: 'unlinkCezar', thread: 'DESK-1', kind: 'pr', id: PR });
    expect((await store.thread('DESK-1')).cezar.links.some(l => l.kind === 'pr')).toBe(false);
  });

  it('survives a move (new ID, same uid), outlives removing the kit and is found again by uid', async () => {
    const store = await seeded();
    await act(store, { action: 'addCezarKit', thread: 'DESK-1' });
    await act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    await act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: 'desk-panel/run-1' });
    const { uid } = await store.thread('DESK-1');
    expect(await act(store, { action: 'updateThread', thread: 'DESK-1', project: 'CEZA' })).toMatchObject({ thread: { id: 'CEZA-1', previousId: 'DESK-1' } });
    expect(await store.idOfUid(uid)).toBe('CEZA-1');
    expect((await store.thread('CEZA-1')).cezar).toMatchObject({ executor: 'cezar', links: [{ kind: 'cezar', id: 'desk-panel/run-1' }] });
    await act(store, { action: 'removeCezarKit', thread: 'CEZA-1' });
    expect((await store.thread('CEZA-1')).cezar).toMatchObject({ enabled: false, executor: 'cezar' });
    await act(store, { action: 'addCezarKit', thread: 'CEZA-1' });
    expect((await store.thread('CEZA-1')).cezar.links).toHaveLength(1);
    expect(await store.idOfUid('f-00000000')).toBeNull();
  });

  it('lets the panel only bookkeep a dispatch, and the history shows it as the author', async () => {
    const store = await seeded();
    await act(store, { action: 'addCezarKit', thread: 'DESK-1' });
    await act(store, { action: 'linkCezar', thread: 'DESK-1', kind: 'cezar', id: 'desk-panel/run-1' }, 'panel');
    await act(store, { action: 'comment', thread: 'DESK-1', text: 'Zlecono' }, 'panel');
    await act(store, { action: 'updateThread', thread: 'DESK-1', state: 'W realizacji' }, 'panel');
    const thread = await store.thread('DESK-1');
    expect(thread.history.slice(-3).map(h => h.by)).toEqual(['panel', 'panel', 'panel']);
    await refused(act(store, { action: 'setCezar', thread: 'DESK-1', executor: 'cezar' }, 'panel'), 403);
    await refused(act(store, { action: 'setSpec', thread: 'DESK-1', text: 'x', baseRevision: 0 }, 'panel'), 403);
    await refused(act(store, { action: 'archiveThread', thread: 'DESK-1' }, 'panel'), 403);
  });
});
