import { describe, expect, it } from 'vitest';
import { emptyFilaCezar, FILA_DEFAULT_WORKFLOW } from './fila-contract';
import { filaDispatchExpected, filaDispatchKey, filaDispatchMatches, getFilaDispatch, type FilaDispatchThread } from './fila-dispatch';
import { TODO_STATUSES, type TodoTask } from './todo-contract';
import { getTodoDispatch } from './todo-dispatch';

const SPEC = ['CEL:', 'Cel.', '', 'ZAKRES:', '- Zmiana.', '', 'POZA ZAKRESEM:', '- Nic.', '', 'WARUNKI ODBIORU:', '1. Test.'].join('\n');

/** A to-do and a thread that say the same thing; `status` is the to-do's key, the thread gets the label of the workflow Praca. */
function pair(over: { status?: keyof typeof TODO_STATUSES; blocked?: string | null; executor?: TodoTask['executor']; repo?: TodoTask['repo']; mode?: TodoTask['mode']; spec?: string; revision?: number } = {}) {
  const { status = 'gotowe', blocked = null, executor = 'cezar', repo = 'desk-panel', mode = 'implementacja', spec = SPEC, revision = 2 } = over;
  const todo = { id: 't-00000001', title: 'Zadanie', status, blocked, executor, repo, mode, spec, specRevision: revision } as TodoTask;
  const thread: FilaDispatchThread = {
    id: 'DESK-7', uid: 'f-00000007', title: 'Zadanie', state: TODO_STATUSES[status], workflow: { id: FILA_DEFAULT_WORKFLOW },
    spec: { enabled: true, revision }, cezar: { ...emptyFilaCezar(), enabled: true, executor, repo, mode, blocked },
  };
  return { todo, thread, spec };
}

describe('C1 on a thread equals C1 on a to-do', () => {
  const cases: [string, Parameters<typeof pair>[0]][] = [
    ['gotowe', {}], ['analiza', { mode: 'analiza' }], ['stan Pomysł', { status: 'pomysl' }], ['blokada', { blocked: 'Czekam' }],
    ['executor lokalnie', { executor: 'lokalnie' }], ['brak executora, repo, trybu', { executor: null, repo: null, mode: null }],
    ['pusta specyfikacja', { spec: '' }], ['brak sekcji', { spec: 'CEL:\nx' }], ['powtórzona sekcja', { spec: `${SPEC}\n\nCEL:\nDrugi` }],
  ];
  it.each(cases)('%s: te same braki, workflow i rewizja, prompt różni się tylko ID', (_name, over) => {
    const { todo, thread, spec } = pair(over);
    const a = getTodoDispatch(todo), b = getFilaDispatch(thread, spec);
    expect(b.missing).toEqual(a.missing);
    expect(b.workflow).toBe(a.workflow);
    expect(b.specRevision).toBe(a.specRevision);
    expect(b.project).toBe(a.project);
    expect(b.prompt).toBe(a.prompt === null ? null : a.prompt.replace('Zadanie: t-00000001', 'Zadanie: DESK-7'));
  });

  it('executor=lokalnie nie staje się Cezarem: dokładnie ten sam komunikat o wykonawcy', () => {
    const { thread, spec } = pair({ executor: 'lokalnie' });
    expect(getFilaDispatch(thread, spec).missing).toEqual(['Wykonawca (executor) to „lokalnie”, a gotowość wymaga „cezar”.']);
  });

  it('inne workflow niż Praca nie jest gotowe, nawet ze Stanem o tej nazwie; wątek bez pola Specyfikacja nie ma specyfikacji', () => {
    const { thread, spec } = pair();
    expect(getFilaDispatch({ ...thread, workflow: { id: 'w-inne' } }, spec).missing[0]).toContain('Zadanie musi mieć stan „Gotowe do realizacji (gotowe)”, a ma „Gotowe do realizacji”');
    expect(getFilaDispatch({ ...thread, spec: { enabled: false, revision: 2 } }, spec).missing).toContain('Brak specyfikacji.');
  });
});

describe('the preview state of a thread', () => {
  it('any change of what the preview showed breaks the match; the key follows the uid, not the display ID', () => {
    const { thread } = pair();
    const expected = filaDispatchExpected(thread);
    expect(filaDispatchMatches(thread, expected)).toBe(true);
    for (const changed of [
      { ...thread, title: 'Inny' }, { ...thread, state: 'Pomysł' }, { ...thread, spec: { enabled: true, revision: 3 } },
      { ...thread, cezar: { ...thread.cezar, mode: 'analiza' as const } }, { ...thread, cezar: { ...thread.cezar, blocked: 'x' } },
      { ...thread, cezar: { ...thread.cezar, executor: 'lokalnie' as const } },
    ]) expect(filaDispatchMatches(changed, expected)).toBe(false);
    expect(filaDispatchMatches({ ...thread, id: 'CEZA-1' }, expected)).toBe(true);
    expect(filaDispatchKey('f-00000007', 2, 'implementacja')).toBe('f-00000007|2|implementacja');
  });
});
