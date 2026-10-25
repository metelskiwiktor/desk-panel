import { MAX_CONTEXT_TEXT } from './chat-context';
import type { TodoList, TodoTask } from './todo-contract';

/**
 * What the chat agent is told about a to-do list or task the user points at. The ids are there so it can write at
 * once ("dodaj tu zadanie", "odhacz to") without reading the lists again.
 */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

export function listContext(list: TodoList): { id: string; title: string; text: string } {
  const open = list.tasks.filter(t => !t.done), done = list.tasks.length - open.length;
  const lines = [`Lista zadań: ${list.name}`, `id listy: ${list.id}`, `Do zrobienia: ${open.length}, ukończonych: ${done}`];
  // The tasks that fit in what the agent may be given at once; the rest is only counted.
  let used = lines.join('\n').length;
  let shown = 0;
  for (const task of open) {
    const line = `${task.id} ${clip(flat(task.title), 120)}${task.note ? ` — ${clip(flat(task.note), 80)}` : ''}`;
    if (used + line.length + 80 > MAX_CONTEXT_TEXT) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  if (shown < open.length) lines.push(`… i ${open.length - shown} kolejnych do zrobienia (pełna lista: /api/agent/todos?list=${list.id})`);
  return { id: list.id, title: list.name, text: lines.join('\n') };
}

export function taskContext(list: TodoList, task: TodoTask): { id: string; title: string; text: string } {
  const text = [
    `Zadanie z listy „${list.name}” (id listy: ${list.id})`,
    `id zadania: ${task.id}`,
    `Tytuł: ${flat(task.title)}`,
    `Stan: ${task.done ? 'ukończone' : 'do zrobienia'}`,
    ...(task.note ? [`Notatka: ${clip(task.note, 600)}`] : []),
    `Dodał: ${task.by === 'agent' ? 'agent' : 'użytkownik'}`,
  ].join('\n');
  return { id: task.id, title: flat(task.title), text };
}
