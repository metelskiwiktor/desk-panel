import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ListChecks, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useDismiss } from './popover';
import { TODO_LIMITS, type TodoList, type TodoTask } from './todo-contract';
import { TodoDialog } from './TodoDialog';
import type { TileConfig } from './tile-grid';
import { taskContext } from './todo-context';
import { ctx } from './chat-context';
import type { TodosState } from './useTodos';

/** What one Zadania tile remembers (in the saved layout): which list it shows and whether it hides what is done. */
export interface TodoConfig { list?: string }
export const todoConfigOf = (config: TileConfig | undefined): TodoConfig => ({
  list: typeof config?.list === 'string' ? config.list : undefined,
});
const NEW_LIST = '__new__';

function TodoRow({ list, task, notes, hot, act, edit }: { list: TodoList; task: TodoTask; notes: boolean; hot: boolean; act: TodosState['act']; edit: (opener: HTMLElement) => void }) {
  const toggle = () => void act({ action: 'updateTask', task: task.id, done: !task.done }, data => ({
    lists: data.lists.map(l => ({ ...l, tasks: l.tasks.map(t => t.id === task.id ? { ...t, done: !task.done, completedAt: task.done ? null : Date.now() } : t) })),
  }));
  const point = (() => { const c = taskContext(list, task); return ctx('todo', c.id, c.title, c.text); })();
  return <li className={`todo-row${task.done ? ' done' : ''}${hot ? ' hot' : ''}`} {...point}>
    <input type="checkbox" className="todo-check" checked={task.done} aria-label={task.title} onChange={toggle} />
    <button type="button" className="todo-title" aria-label={`Edytuj zadanie: ${task.title}`} onClick={e => edit(e.currentTarget)}>
      <span className="todo-text">{task.title}</span>
      {notes && task.note && <span className="todo-note">{task.note}</span>}
    </button>
    {list.showAgent && task.by === 'agent' && <span className="todo-by" role="img" aria-label="Dodał agent czatu" title="Dodał agent czatu"><Sparkles size={14} aria-hidden="true" /></span>}
  </li>;
}

/**
 * A to-do tile: one list at a time, chosen from a drop-down, with its tasks to tick; a tap on a task opens it in a dialog (edit, delete). Several tiles can
 * stand on the grid, each with its own list. The list's own settings ("Ukryj ukończone") are in the ⋯ menu and are kept on
 * the list, so they follow it to every tile. The + in the head shows the add field floating over the foot of the tile (the
 * tasks scroll under it) until the + is pressed again. What fits follows the tile's cells (`wide`: two or more columns,
 * `tall`: two or more rows): notes show only when there is room both ways, a wide short tile lays tasks in two columns.
 */
export function TodoTile({ todos, config, setConfig, wide = true, tall = true }: {
  todos: TodosState; config?: TileConfig; setConfig: (patch: Record<string, string | boolean | undefined>) => void; wide?: boolean; tall?: boolean;
}) {
  const { source, error, clearError, act } = todos;
  const lists = source.data?.lists ?? null;
  const { list: wanted } = todoConfigOf(config);
  const list: TodoList | null = lists?.find(l => l.id === wanted) ?? lists?.[0] ?? null;
  // The add field floats over the foot of the tile; it opens and closes with the + in the head and stays open while tasks are added.
  const [adding, setAdding] = useState(false);
  // The task open in the dialog (its id; the dialog is closed if the task is gone) and the button that opened it, to give focus back.
  const [editing, setEditing] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<'view' | 'new' | 'rename'>('view');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const settled = useRef(false); // Enter and Escape already decided; the blur that follows must not decide again
  const closeMenu = () => { setMenu(false); setRemoving(false); };
  useDismiss(menu, closeMenu, menuRoot);
  // The menu is fixed to the screen at its button, so a small tile (which clips what is inside it) cannot cut it off.
  const moreButton = useRef<HTMLButtonElement>(null);
  const [popAt, setPopAt] = useState<{ top: number; right: number } | null>(null);
  const toggleMenu = () => {
    if (menu) { closeMenu(); return; }
    const box = moreButton.current?.getBoundingClientRect();
    setPopAt(box ? { top: box.bottom + 4, right: Math.max(8, window.innerWidth - box.right) } : null);
    setMenu(true);
  };
  useEffect(() => {
    if (!menu) return;
    const fold = () => { setMenu(false); setRemoving(false); };
    window.addEventListener('resize', fold);
    window.addEventListener('scroll', fold, true);
    return () => { window.removeEventListener('resize', fold); window.removeEventListener('scroll', fold, true); };
  }, [menu]);

  const startNaming = (next: 'new' | 'rename') => { closeMenu(); settled.current = false; setName(next === 'rename' && list ? list.name : ''); setMode(next); };
  const finishNaming = async (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const value = name.trim();
    const was = mode;
    setMode('view');
    if (!save || !value) return;
    if (was === 'new') { const result = await act({ action: 'createList', name: value }); if (result?.list) setConfig({ list: result.list.id }); }
    else if (list && value !== list.name) void act({ action: 'renameList', list: list.id, name: value });
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title || !list) return;
    setDraft('');
    void act({ action: 'addTask', list: list.id, title });
  };

  const hideDone = list?.hideDone ?? false;
  const editTask = list?.tasks.find(t => t.id === editing);
  const closeEditor = () => { setEditing(null); opener.current?.focus(); };
  const open = list?.tasks.filter(t => !t.done) ?? [], done = list?.tasks.filter(t => t.done) ?? [];
  const shown = hideDone ? open : [...open, ...done];
  const naming = mode !== 'view';
  const nameInput = <input className="todo-name" aria-label={mode === 'new' ? 'Nazwa nowej listy' : 'Nazwa listy'} value={name} maxLength={TODO_LIMITS.name} autoFocus
    placeholder={mode === 'new' ? 'Nazwa listy' : undefined} onChange={e => setName(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); void finishNaming(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void finishNaming(false); }
    }}
    onBlur={() => void finishNaming(true)} />;

  return <section className={`p2-card todo${wide ? ' wide' : ''}${tall ? ' tall' : ''}${adding ? ' adding' : ''}`} aria-label="Zadania">
    <div className="p2-card-head static todo-head">
      <ListChecks size={18} aria-hidden="true" />
      {naming ? nameInput
        : list && lists ? <select className="todo-select" aria-label="Lista zadań" value={list.id}
          onChange={e => { if (e.target.value === NEW_LIST) startNaming('new'); else setConfig({ list: e.target.value }); }}>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value={NEW_LIST}>＋ Nowa lista…</option>
        </select>
        : <h2>Zadania</h2>}
      {list && !naming && <span className="p2-meta todo-count" title="Ukończone z wszystkich">{done.length}/{list.tasks.length}</span>}
      {list && !naming && <button type="button" className="todo-more todo-plus" aria-label="Dodawanie zadań" aria-pressed={adding} onClick={() => setAdding(a => !a)}><Plus size={18} aria-hidden="true" /></button>}
      {list && !naming && <div className="todo-menu" ref={menuRoot}>
        <button type="button" className="todo-more" aria-label="Zarządzaj listą" aria-haspopup="menu" aria-expanded={menu} ref={moreButton} onClick={toggleMenu}><MoreHorizontal size={18} aria-hidden="true" /></button>
        {menu && <div className="todo-pop" role="menu" aria-label="Lista zadań" style={popAt ?? undefined}>
          <button type="button" role="menuitemcheckbox" aria-checked={hideDone} onClick={() => {
            closeMenu();
            void act({ action: 'setListOptions', list: list.id, hideDone: !hideDone }, data => ({ lists: data.lists.map(l => l.id === list.id ? { ...l, hideDone: !hideDone } : l) }));
          }}><span className="todo-tick" aria-hidden="true">{hideDone && <Check size={15} />}</span> Ukryj ukończone</button>
          <button type="button" role="menuitemcheckbox" aria-checked={list.showAgent} onClick={() => {
            closeMenu();
            void act({ action: 'setListOptions', list: list.id, showAgent: !list.showAgent }, data => ({ lists: data.lists.map(l => l.id === list.id ? { ...l, showAgent: !list.showAgent } : l) }));
          }}><span className="todo-tick" aria-hidden="true">{list.showAgent && <Check size={15} />}</span> Pokaż, co dodał agent</button>
          <button type="button" role="menuitem" onClick={() => startNaming('new')}><Plus size={15} aria-hidden="true" /> Nowa lista</button>
          <button type="button" role="menuitem" onClick={() => startNaming('rename')}><Pencil size={15} aria-hidden="true" /> Zmień nazwę</button>
          <button type="button" role="menuitem" disabled={!done.length} onClick={() => { closeMenu(); void act({ action: 'clearDone', list: list.id }); }}><Check size={15} aria-hidden="true" /> Wyczyść ukończone ({done.length})</button>
          {removing
            ? <button type="button" role="menuitem" className="danger" onClick={() => { closeMenu(); void act({ action: 'deleteList', list: list.id }); }}>Usunąć listę z {list.tasks.length} zad.?</button>
            : <button type="button" role="menuitem" className="danger" onClick={() => setRemoving(true)}><Trash2 size={15} aria-hidden="true" /> Usuń listę</button>}
        </div>}
      </div>}
    </div>
    {error && <p className="p2-note warn todo-error" role="alert">{error}<button type="button" aria-label="Zamknij komunikat" onClick={clearError}><X size={13} aria-hidden="true" /></button></p>}
    {list ? <>
      {shown.length
        ? <ul className="todo-list" aria-label={`Zadania: ${list.name}`}>{shown.map(task => <TodoRow key={task.id} list={list} task={task} notes={wide && tall} hot={task.id === editing} act={act}
          edit={el => { opener.current = el; setEditing(task.id); }} />)}</ul>
        : <p className="p2-empty">{list.tasks.length && hideDone ? 'Wszystkie zadania są ukończone.' : 'Brak zadań na tej liście.'}</p>}
      {adding && <form className="todo-add" onSubmit={add}>
        <input aria-label="Nowe zadanie" placeholder="Dodaj zadanie…" maxLength={TODO_LIMITS.title} value={draft} autoFocus onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }} />
        <button type="submit" aria-label="Dodaj zadanie" disabled={!draft.trim()}><Plus size={17} aria-hidden="true" /></button>
      </form>}
    </> : lists ? <div className="todo-none">
      <p className="p2-empty">Nie ma jeszcze żadnej listy.</p>
      {!naming && <button type="button" className="todo-create" onClick={() => startNaming('new')}><Plus size={16} aria-hidden="true" /> Utwórz listę</button>}
    </div> : <p className="p2-empty">{source.status === 'loading' ? 'Ładowanie zadań…' : source.message || 'Zadania są niedostępne.'}</p>}
    {list && editTask && <TodoDialog key={editTask.id} list={list} task={editTask} act={act} close={closeEditor} />}
  </section>;
}
