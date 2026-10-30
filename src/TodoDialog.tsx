import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { TODO_LIMITS, TODO_STATUSES, todoActionSchema, type TodoList, type TodoTask } from './todo-contract';
import { taskLabels, safeUrl } from './model';
import type { CezarSnapshot } from './cezar-contract';
import { openChatConversation } from './useChatPresentation';
import type { TodosState } from './useTodos';

/**
 * One task opened for editing: a dialog over the whole panel, so it reads the same in a tile of any size. Saving sends only
 * what changed; Esc and "Anuluj" drop the edit, and a tap on the dimmed panel closes it only while nothing was typed.
 * Delete asks twice. Enter in the title and Ctrl+Enter in the note save.
 */
export function TodoDialog({ list, task, act, close, snapshot, error }: { snapshot?: CezarSnapshot | null; error?: string; list: TodoList; task: TodoTask; act: TodosState['act']; close: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [pr, setPr] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const send = async (action: Parameters<TodosState['act']>[0], clear?: () => void) => {
    if (busy) return;
    setBusy(true); setFailure('');
    try { if (await act(action)) clear?.(); else setFailure('Nie udało się zapisać zmiany.'); }
    finally { setBusy(false); }
  };
  const addComment = () => {
    const text = comment.trim();
    if (text) void send({ action: 'addComment', task: task.id, text }, () => setComment(current => current === comment ? '' : current));
  };
  const linkPr = () => {
    const action = todoActionSchema.safeParse({ action: 'link', task: task.id, kind: 'pr', id: pr.trim() });
    if (!action.success) { setFailure('Podaj adres PR-a: https://github.com/owner/repo/pull/123 (bez parametrów i fragmentu).'); return; }
    void send(action.data, () => setPr(current => current === pr ? '' : current));
  };
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
    const controls = [...root.current.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], button:not(:disabled)')];
    const [first, last] = [controls[0], controls.at(-1)];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return createPortal(
    <div className="todo-dlg-scrim" onMouseDown={event => { if (event.target === event.currentTarget && !dirty && !comment && !reason && !pr) close(); }}>
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
        <label className="todo-dlg-label" htmlFor={`${id}-status`}>Stan</label>
        <select id={`${id}-status`} className="todo-dlg-title" value={task.status} disabled={busy}
          onChange={e => void send({ action: 'setStatus', task: task.id, status: e.target.value as TodoTask['status'] })}>
          {Object.entries(TODO_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <section className="todo-dlg-section" aria-label="Blokada">
          <h3>Blokada</h3>
          {task.blocked ? <div className="todo-dlg-inline"><p className="todo-blocked">{task.blocked}</p><button type="button" disabled={busy} onClick={() => void send({ action: 'setBlocked', task: task.id, reason: null })}>Zdejmij blokadę</button></div>
            : <div className="todo-dlg-inline"><input className="todo-dlg-title" aria-label="Powód blokady" placeholder="Powód blokady" value={reason} maxLength={TODO_LIMITS.blocked} onChange={e => setReason(e.target.value)} /><button type="button" disabled={busy || !reason.trim()} onClick={() => void send({ action: 'setBlocked', task: task.id, reason: reason.trim() }, () => setReason(''))}>Zablokuj</button></div>}
        </section>
        <section className="todo-dlg-section" aria-label="Powiązania">
          <h3>Powiązania</h3>
          {task.links.length ? <ul className="todo-links">{task.links.map(link => {
            const cezar = link.kind === 'cezar' ? [...(snapshot?.tasks ?? []), ...(snapshot?.finished ?? [])].find(t => t.id === link.id) : undefined;
            const label = cezar?.title ?? link.title ?? link.id;
            const url = safeUrl(link.kind === 'pr' ? link.id : cezar?.sourceUrl);
            const pullRequest = safeUrl(cezar?.pullRequestUrl);
            return <li key={`${link.kind}:${link.id}`}><div>
              <small>{link.kind === 'chat' ? 'Rozmowa Wektora' : link.kind === 'cezar' ? 'Task Cezara' : 'Pull request'}</small>
              {link.kind === 'chat' ? <button type="button" onClick={() => { close(); openChatConversation(link.id); }}>{label}</button>
                : url ? <a href={url} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>}
              {link.kind === 'cezar' && <small>{cezar ? taskLabels[cezar.status] : 'Brak w bieżącym odczycie Cezara'}{pullRequest && <> · <a href={pullRequest} target="_blank" rel="noreferrer">PR</a></>}</small>}
            </div><button type="button" disabled={busy} aria-label={`Usuń powiązanie: ${label}`} onClick={() => void send({ action: 'unlink', task: task.id, kind: link.kind, id: link.id })}><X size={15} aria-hidden="true" /></button></li>;
          })}</ul> : <p className="todo-dlg-muted">Brak powiązań.</p>}
          <div className="todo-dlg-inline"><input className="todo-dlg-title" aria-label="URL pull requesta" placeholder="https://github.com/owner/repo/pull/123" maxLength={500} value={pr} onChange={e => setPr(e.target.value)} /><button type="button" disabled={busy || !pr.trim() || task.links.length >= TODO_LIMITS.links} onClick={linkPr}>Dodaj PR</button></div>
        </section>
        <section className="todo-dlg-section" aria-label="Historia">
          <h3>Historia</h3>
          {task.history.length ? <ol className="todo-history">{task.history.map((entry, index) => <li key={index}>
            <small>{{ user: 'Ty', agent: 'Wektor', panel: 'panel' }[entry.by]} · <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</time></small>
            <p>{entry.kind === 'comment' ? entry.text : entry.kind === 'status' ? `Stan: ${entry.from ? TODO_STATUSES[entry.from] : '—'} → ${entry.to ? TODO_STATUSES[entry.to] : '—'}` : entry.kind === 'blocked' ? entry.text ? `Blokada: ${entry.text}` : 'Zdjęto blokadę' : `Powiązanie: ${entry.text?.replace(/^\+ /, 'Dodano ').replace(/^- /, 'Usunięto ')}`}</p>
          </li>)}</ol> : <p className="todo-dlg-muted">Brak historii.</p>}
          <label className="todo-dlg-label" htmlFor={`${id}-comment`}>Dodaj komentarz</label>
          <textarea id={`${id}-comment`} className="todo-dlg-note todo-comment" value={comment} maxLength={TODO_LIMITS.comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } }} />
          <button type="button" disabled={busy || !comment.trim()} onClick={addComment}>Dodaj komentarz</button>
        </section>
        {(error || failure) && <p className="todo-blocked" role="alert">{error || failure}</p>}
        <p className="todo-dlg-muted">Stan, blokada, powiązania i komentarze zapisują się od razu. „Zapisz” dotyczy tytułu i notatki.</p>
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
