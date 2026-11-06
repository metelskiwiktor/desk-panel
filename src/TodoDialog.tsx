import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { TODO_LIMITS, TODO_STATUSES, TODO_EXECUTORS, TODO_MODES, todoActionSchema, type TodoList, type TodoDispatchRecord, type TodoTask } from './todo-contract';
import { getTodoDispatch, todoDispatchExpected, todoDispatchKey, todoDispatchMatches, type TodoDispatchExpected } from './todo-dispatch';
import { taskLabels, safeUrl } from './model';
import type { CezarSnapshot } from './cezar-contract';
import { openChatConversation } from './useChatPresentation';
import type { TodosState } from './useTodos';
import { MarkdownText } from './components/markdown-text';

/**
 * One task opened over the whole panel, so it reads the same in a tile of any size. The current Markdown
 * specification sits in a large read-only area with a separate history tab; the sidebar keeps title, note, state,
 * block, links and spec revision metadata. Saving sends only what changed in title and note; Esc and "Anuluj" drop
 * the edit, and a tap on the dimmed panel closes it only while nothing was typed. Delete asks twice. Enter in the
 * title and Ctrl+Enter in the note save.
 */
/** Old `agent` stays an alias for `wektor`, so its label is "Wektor" too. */
const AUTHOR_LABELS: Record<string, string> = { user: 'Ty', wektor: 'Wektor', agent: 'Wektor', claude: 'Claude', codex: 'Codex', panel: 'panel' };
const formatTime = (at: number) => new Date(at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
/** One history row: comments are plain text; every other kind says what changed. */
function historyText(entry: TodoTask['history'][number]) {
  if (entry.kind === 'comment') return entry.text ?? '';
  if (entry.kind === 'status') return `Stan: ${entry.from ? TODO_STATUSES[entry.from] : '—'} → ${entry.to ? TODO_STATUSES[entry.to] : '—'}`;
  if (entry.kind === 'blocked') return entry.text ? `Blokada: ${entry.text}` : 'Zdjęto blokadę';
  if (entry.kind === 'spec') return `Specyfikacja: ${entry.text ?? ''}`;
  return `Powiązanie: ${entry.text?.replace(/^\+ /, 'Dodano ').replace(/^- /, 'Usunięto ')}`;
}

export function TodoDialog({ list, task, act, close, snapshot, dispatches, error, dispatchCezar }: { snapshot?: CezarSnapshot | null; dispatches?: TodoDispatchRecord[]; error?: string; list: TodoList; task: TodoTask; act: TodosState['act']; dispatchCezar: TodosState['dispatchCezar']; close: () => void }) {
  const [tab, setTab] = useState<'spec' | 'history'>('spec');
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [pr, setPr] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [removing, setRemoving] = useState(false);
  // The preview is a snapshot of the task as the user saw it: the server compares the same fields again.
  const [preview, setPreview] = useState<{ dispatch: ReturnType<typeof getTodoDispatch>; expected: TodoDispatchExpected } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState<{ taskId: string; url: string } | null>(null);
  const [dispatchFailure, setDispatchFailure] = useState('');
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
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const next = title.trim();
  const dirty = next !== task.title || note !== task.note || comment !== '' || reason !== '' || pr !== '';

  useEffect(() => { root.current?.querySelector('input')?.focus(); }, []);

  // C1 owns readiness, the missing list and the exact prompt; this screen only shows them.
  const ready = getTodoDispatch(task);
  const stale = preview !== null && !todoDispatchMatches(task, preview.expected);
  const consent = previewOpen && preview !== null && !stale && ready.missing.length === 0;
  const key = task.mode ? todoDispatchKey(task.id, task.specRevision, task.mode) : null;
  const recorded = key ? dispatches?.find(entry => todoDispatchKey(entry.todoId, entry.specRevision, entry.mode) === key) : undefined;
  const cezarTask = recorded ? [...(snapshot?.tasks ?? []), ...(snapshot?.finished ?? [])].find(entry => entry.id === recorded.taskId) : undefined;
  // Running or finished waits in the register; a failed task or one gone from the snapshot may be dispatched again.
  const blockedByRegister = !!recorded && (!snapshot ? true : !!cezarTask && cezarTask.status !== 'failed');
  const openPreview = () => {
    const dispatch = getTodoDispatch(task);
    // With gaps there is no new prompt: keep the last one visible until readiness returns.
    if (!dispatch.prompt) return;
    setPreview({ dispatch, expected: todoDispatchExpected(task) });
    setPreviewOpen(true);
    setDispatchFailure('');
  };
  const startDispatch = async () => {
    if (!consent || !preview || requesting || blockedByRegister) return;
    setRequesting(true); setDispatchFailure(''); setResult(null);
    try {
      // Drafts go first: the preview used saved data, so a changed title needs a fresh preview.
      if (next !== task.title || note !== task.note) {
        const saved = await act({ action: 'updateTask', task: task.id, ...(next !== task.title ? { title: next } : {}), ...(note !== task.note ? { note } : {}) });
        if (!saved) { setDispatchFailure('Nie udało się zapisać szkicu tytułu lub notatki.'); return; }
        if (next !== task.title) { setDispatchFailure('Tytuł zapisany — dane zmieniły się od podglądu. Odśwież podgląd.'); return; }
      }
      const outcome = await dispatchCezar(task.id, preview.expected);
      if (outcome.ok) { setResult({ taskId: outcome.taskId, url: outcome.url }); return; }
      if (outcome.status === 409) setDispatchFailure(outcome.error || 'Nie można teraz zlecić — dane się zmieniły albo zadanie już zlecono.');
      else setDispatchFailure('Zlecenie mogło nie dojść — sprawdź Cezara.');
    } finally { setRequesting(false); }
  };

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

  // The current revision gives the metadata of what is shown; task.by is the task's creator, not the spec author.
  const currentRevision = task.specRevision > 0 ? task.specRevisions.find(r => r.revision === task.specRevision) : undefined;
  const specAuthor = currentRevision ? (AUTHOR_LABELS[currentRevision.by] ?? currentRevision.by) : '';
  const specTime = currentRevision ? formatTime(currentRevision.at) : '';
  const specEmpty = task.spec === ''; // "empty" is exactly the empty string, without trimming.

  return createPortal(
    <div className="todo-dlg-scrim" data-usage-dim="" onMouseDown={event => { if (event.target === event.currentTarget && !dirty) close(); }}>
      <div className="todo-dlg" role="dialog" aria-modal="true" aria-label="Zadanie" ref={root} onKeyDown={keys}>
        <div className="todo-dlg-head">
          <h2>Zadanie · {list.name}</h2>
          <button type="button" aria-label="Zamknij" onClick={close}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="todo-dlg-body">
          <div className="todo-dlg-main">
            <div className="todo-dlg-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'spec'} onClick={() => setTab('spec')}>Specyfikacja</button>
              <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Historia · {task.history.length}</button>
            </div>
            {tab === 'spec'
              ? <div className="todo-dlg-paper" role="tabpanel" aria-label="Specyfikacja">
                  {currentRevision && <p className="todo-spec-meta">{specAuthor} · <time dateTime={new Date(currentRevision.at).toISOString()}>{specTime}</time></p>}
                  {specEmpty ? <p className="todo-dlg-muted">Brak specyfikacji</p> : <MarkdownText text={task.spec} externalLinks className="todo-spec-markdown" />}
                </div>
              : <div className="todo-dlg-paper" role="tabpanel" aria-label="Historia">
                  {task.history.length ? <ol className="todo-history">{task.history.map((entry, index) => <li key={index}>
                    <small>{AUTHOR_LABELS[entry.by] ?? entry.by} · <time dateTime={new Date(entry.at).toISOString()}>{formatTime(entry.at)}</time></small>
                    <p>{historyText(entry)}</p>
                  </li>)}</ol> : <p className="todo-dlg-muted">Brak historii.</p>}
                  <label className="todo-dlg-label" htmlFor={`${id}-comment`}>Dodaj komentarz</label>
                  <textarea id={`${id}-comment`} className="todo-dlg-note todo-comment" value={comment} maxLength={TODO_LIMITS.comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } }} />
                  <button type="button" disabled={busy || !comment.trim()} onClick={addComment}>Dodaj komentarz</button>
                </div>}
          </div>
          <aside className="todo-dlg-aside">
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
            <section className="todo-dlg-section todo-dispatch" aria-label="Zlecenie Cezarowi">
              <h3>Zleć na Cezarze</h3>
              <label className="todo-dlg-label" htmlFor={`${id}-executor`}>Wykonawca</label>
              <select id={`${id}-executor`} className="todo-dlg-title" value={task.executor ?? ''} disabled={busy || requesting}
                onChange={e => void send({ action: 'updateTask', task: task.id, executor: (e.target.value || null) as TodoTask['executor'] })}>
                <option value="">— brak —</option>
                {Object.entries(TODO_EXECUTORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <label className="todo-dlg-label" htmlFor={`${id}-repo`}>Repozytorium</label>
              <select id={`${id}-repo`} className="todo-dlg-title" value={task.repo ?? ''} disabled={busy || requesting}
                onChange={e => void send({ action: 'updateTask', task: task.id, repo: (e.target.value || null) as TodoTask['repo'] })}>
                <option value="">— brak —</option>
                <option value="desk-panel">desk-panel</option>
              </select>
              <label className="todo-dlg-label" htmlFor={`${id}-mode`}>Tryb</label>
              <select id={`${id}-mode`} className="todo-dlg-title" value={task.mode ?? ''} disabled={busy || requesting}
                onChange={e => void send({ action: 'updateTask', task: task.id, mode: (e.target.value || null) as TodoTask['mode'] })}>
                <option value="">— brak —</option>
                {Object.entries(TODO_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {recorded && <p className="todo-dispatch-record">
                Ostatnie zlecenie: <a href={safeUrl(recorded.url)} target="_blank" rel="noreferrer">{recorded.taskId}</a>
                {blockedByRegister ? ' — w toku albo zakończone; ponowienie zablokowane.' : ' — task nieudany albo nieobecny w odczycie; można zlecić ponownie.'}
              </p>}
              {ready.missing.length > 0 && <ul className="todo-dispatch-missing" aria-label="Braki gotowości">{ready.missing.map((item, index) => <li key={index}>{item}</li>)}</ul>}
              {(ready.missing.length === 0 || previewOpen) && <>
                    {previewOpen && preview
                      ? <div className="todo-dispatch-preview-wrap">
                          <p className="todo-dlg-muted">{preview.dispatch.workflow} · rewizja v{preview.dispatch.specRevision}</p>
                          <pre className="todo-dispatch-prompt" aria-label="Podgląd promptu">{preview.dispatch.prompt}</pre>
                        </div>
                      : <button type="button" disabled={busy || requesting} onClick={openPreview}>Pokaż podgląd</button>}
                    {previewOpen && stale && <p className="todo-dispatch-warn">Dane zadania zmieniły się od podglądu — odśwież go, zanim zlecisz.</p>}
                    {previewOpen && (stale || ready.missing.length > 0) && <button type="button" disabled={busy || requesting} onClick={openPreview}>Odśwież podgląd</button>}
                    <button type="button" className="todo-dispatch-send" disabled={!consent || busy || requesting || blockedByRegister} onClick={() => void startDispatch()}>
                      {requesting ? 'Zlecam…' : 'Zleć na Cezarze'}
                    </button>
                  </>}
              {result && <p className="todo-dispatch-ok" role="status">Zlecono Cezarowi: <a href={safeUrl(result.url)} target="_blank" rel="noreferrer">{result.taskId}</a></p>}
              {dispatchFailure && <p className="todo-blocked" role="alert">{dispatchFailure}</p>}
            </section>
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
            <section className="todo-dlg-section" aria-label="Specyfikacja">
              <h3>Specyfikacja</h3>
              {task.specRevision > 0
                ? <p className="todo-spec-revision">{currentRevision ? `v${task.specRevision} · ${specAuthor}` : `v${task.specRevision}`}</p>
                : <p className="todo-dlg-muted">Brak specyfikacji</p>}
            </section>
          </aside>
        </div>
        {(error || failure) && <p className="todo-blocked todo-dlg-error" role="alert">{error || failure}</p>}
        <div className="todo-dlg-footer">
          {removing
            ? <button type="button" className="danger" onClick={() => { void act({ action: 'deleteTask', task: task.id }); close(); }} onBlur={() => setRemoving(false)} autoFocus>Usunąć?</button>
            : <button type="button" className="danger" aria-label={`Usuń zadanie: ${task.title}`} onClick={() => setRemoving(true)}><Trash2 size={16} aria-hidden="true" /> Usuń</button>}
          <span />
          <p className="todo-dlg-muted">„Zapisz” dotyczy tytułu i notatki.</p>
          <button type="button" onClick={close}>Anuluj</button>
          <button type="button" className="save" disabled={!next} onClick={save}>Zapisz</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
