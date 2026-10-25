import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_TEXT } from './chat-context';
import { listContext, taskContext } from './todo-context';
import type { TodoList, TodoTask } from './todo-contract';

const task = (n: number, extra: Partial<TodoTask> = {}): TodoTask => ({ id: `t-${String(n).padStart(8, '0')}`, title: `Zadanie ${n}`, note: '', done: false, createdAt: 1, completedAt: null, by: 'user', ...extra });
const list = (tasks: TodoTask[]): TodoList => ({ id: 'l-1a2b3c4d', name: 'Do poprawy - Chat Agy', createdAt: 1, hideDone: false, tasks });

describe('what the agent is told about a pointed list', () => {
  it('names the list with its id, counts, and lists the open tasks with their ids and notes; done ones are only counted', () => {
    const c = listContext(list([task(1, { note: 'z\nnotatką' }), task(2, { done: true, completedAt: 5 }), task(3)]));
    expect(c.id).toBe('l-1a2b3c4d');
    expect(c.title).toBe('Do poprawy - Chat Agy');
    expect(c.text.split('\n')).toEqual([
      'Lista zadań: Do poprawy - Chat Agy', 'id listy: l-1a2b3c4d', 'Do zrobienia: 2, ukończonych: 1',
      't-00000001 Zadanie 1 — z notatką', 't-00000003 Zadanie 3',
    ]);
  });
  it('stops before the limit with a pointer to the full list when there are many tasks', () => {
    const c = listContext(list(Array.from({ length: 80 }, (_, i) => task(i + 1, { title: `Zadanie numer ${i + 1} z dość długim opisem, który zajmuje miejsce` }))));
    expect(c.text.length).toBeLessThanOrEqual(MAX_CONTEXT_TEXT);
    const lines = c.text.split('\n');
    expect(lines.at(-1)).toMatch(/^… i \d+ kolejnych do zrobienia \(pełna lista: \/api\/agent\/todos\?list=l-1a2b3c4d\)$/);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.length).toBeLessThan(40);
  });
  it('says so for a list without open tasks', () => {
    expect(listContext(list([task(1, { done: true })])).text).toBe('Lista zadań: Do poprawy - Chat Agy\nid listy: l-1a2b3c4d\nDo zrobienia: 0, ukończonych: 1');
  });
});

describe('what the agent is told about a pointed task', () => {
  it('has the ids of the task and its list, the state, the note and who added it', () => {
    const open = taskContext(list([]), task(7, { note: 'Dodać limity', by: 'agent' }));
    expect(open).toEqual({ id: 't-00000007', title: 'Zadanie 7', text: [
      'Zadanie z listy „Do poprawy - Chat Agy” (id listy: l-1a2b3c4d)', 'id zadania: t-00000007', 'Tytuł: Zadanie 7', 'Stan: do zrobienia', 'Notatka: Dodać limity', 'Dodał: agent',
    ].join('\n') });
    expect(taskContext(list([]), task(8, { done: true, completedAt: 3 })).text).toContain('Stan: ukończone');
    expect(taskContext(list([]), task(8)).text).not.toContain('Notatka');
  });
});
