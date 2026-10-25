import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { TODO_LIMITS, type TodoList, type TodoTask } from './todo-contract';
import type { TodosState } from './useTodos';

/**
 * One task opened for editing: a dialog over the whole panel, so it reads the same in a tile of any size. Saving sends only
 * what changed; Esc and "Anuluj" drop the edit, and a tap on the dimmed panel closes it only while nothing was typed.
 * Delete asks twice. Enter in the title and Ctrl+Enter in the note save.
 */
export function TodoDialog({ list, task, act, close }: { list: TodoList; task: TodoTask; act: TodosState['act']; close: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note);
  const [removing, setRemoving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const next = title.trim();
  const dirty = next !== task.title || note !== task.note;

  useEffect(() => { root.current?.querySelector('input')?.focus(); }, []);

  const save = () => {
    if (!next) return;
    if (dirty) void act({ action: 'updateTask', task: task.id, ...(next !== task.title ? { title: next } : {}), ...(note !== task.note ? { note } : {}) });
    close();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab' || !root.current) return;
    // Focus stays in the dialog: Tab from the last control goes to the first, Shift+Tab the other way.
    const controls = [...root.current.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled)')];
    const [first, last] = [controls[0], controls.at(-1)];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return createPortal(
    <div className="todo-dlg-scrim" onMouseDown={event => { if (event.target === event.currentTarget && !dirty) close(); }}>
      <div className="todo-dlg" role="dialog" aria-modal="true" aria-label="Zadanie" ref={root} onKeyDown={keys}>
        <div className="todo-dlg-head">
          <h2>Zadanie · {list.name}</h2>
          <button type="button" aria-label="Zamknij" onClick={close}><X size={18} aria-hidden="true" /></button>
        </div>
        <label className="todo-dlg-label" htmlFor={`${id}-title`}>Tytuł</label>
        <input id={`${id}-title`} className="todo-dlg-title" value={title} maxLength={TODO_LIMITS.title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
        <label className="todo-dlg-label" htmlFor={`${id}-note`}>Notatka</label>
        <textarea id={`${id}-note`} className="todo-dlg-note" value={note} maxLength={TODO_LIMITS.note} onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }} />
        <div className="todo-dlg-actions">
          {removing
            ? <button type="button" className="danger" onClick={() => { void act({ action: 'deleteTask', task: task.id }); close(); }} onBlur={() => setRemoving(false)} autoFocus>Usunąć?</button>
            : <button type="button" className="danger" aria-label={`Usuń zadanie: ${task.title}`} onClick={() => setRemoving(true)}><Trash2 size={16} aria-hidden="true" /> Usuń</button>}
          <span />
          <button type="button" onClick={close}>Anuluj</button>
          <button type="button" className="save" disabled={!next} onClick={save}>Zapisz</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
