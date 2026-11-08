import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, FileText, FolderInput, GitBranch, Pencil, Plus, Send, Workflow, X } from 'lucide-react';
import { MarkdownText } from '../components/markdown-text';
import type { FilaAction } from '../fila-contract';
import {
  useFilaActions, useFilaAncestors, useFilaGet, useFilaSpec, useFilaThread,
  type FilaFieldValue, type FilaRegistry, type FilaThreadDoc, type FilaThreadRow,
} from './api';
import { ThreadList } from './threads';
import { Dialog, Menu, StatePicker, TypeIcon } from './ui';

const when = (at: number) => new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const BY: Record<string, string> = { user: 'Ty', panel: 'Panel', 'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', codex: 'Codex', wektor: 'Wektor' };
const ACTION: Record<string, string> = { created: 'utworzył wątek', archived: 'zarchiwizował wątek', restored: 'przywrócił wątek', moved: 'przeniósł wątek' };
const KINDS = { text: 'tekst', number: 'liczba', date: 'data', bool: 'tak/nie', multi: 'wiele wartości' } as const;
type Kind = keyof typeof KINDS;
const showValue = (value: FilaFieldValue) => Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'tak' : 'nie') : String(value);

/** One field of the thread, edited in place by its kind (D-047). Press Enter or leave the field to save, Escape to give up. */
function FieldValue({ label, kind, value, onSave }: { label: string; kind: Kind; value: FilaFieldValue; onSave: (value: FilaFieldValue) => void }) {
  const [draft, setDraft] = useState(Array.isArray(value) ? '' : showValue(value));
  useEffect(() => { if (!Array.isArray(value)) setDraft(showValue(value)); }, [value]);
  if (kind === 'bool') return <select className="fl-select" aria-label={label} value={value === true ? 'tak' : 'nie'} onChange={event => onSave(event.target.value === 'tak')}><option>tak</option><option>nie</option></select>;
  if (kind === 'multi') {
    const items = Array.isArray(value) ? value : [];
    return <span className="fl-chips">
      {items.map(item => <span key={item} className="fl-chip">{item}<button type="button" aria-label={`Usuń ${item} z pola ${label}`} onClick={() => onSave(items.filter(other => other !== item))}><X size={12} aria-hidden="true" /></button></span>)}
      <input className="fl-inline" aria-label={`Dodaj do pola ${label}`} placeholder="+" size={6} value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const item = draft.trim().replace(/^#/, ''); if (item && !items.includes(item)) onSave([...items, item]); setDraft(''); } }} />
    </span>;
  }
  const commit = () => {
    const text = draft.trim();
    if (kind === 'number') { const n = Number(text.replace(',', '.')); if (text && Number.isFinite(n) && n !== value) onSave(n); else setDraft(showValue(value)); }
    else if (text !== value) onSave(text);
  };
  return <input className="fl-inline wide" aria-label={label} type={kind === 'date' ? 'date' : 'text'} inputMode={kind === 'number' ? 'decimal' : undefined} value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.stopPropagation(); setDraft(showValue(value)); event.currentTarget.blur(); } }} />;
}

type Reassign = { project?: string; workflow?: string; state?: string; module?: string | null };

/**
 * Moves the thread to another project and/or assigns another workflow. A Stan or Moduł that does not fit the target is
 * never kept or dropped quietly: the dialog asks for an explicit Stan, or a new Moduł / none, before it can save (1.1a).
 */
function ReassignDialog({ mode, thread, registry, onClose, onSave, error }: {
  mode: 'project' | 'workflow'; thread: FilaThreadDoc; registry: FilaRegistry; onClose: () => void; error: string;
  onSave: (change: Reassign) => void;
}) {
  const [project, setProject] = useState(thread.project);
  const [workflow, setWorkflow] = useState(thread.workflow.id);
  const [state, setState] = useState('');
  const [module, setModule] = useState<string | null | undefined>(undefined);
  const target = registry.workflows.find(w => w.id === workflow)!;
  const targetProject = registry.projects.find(p => p.key === project)!;
  const stateFits = target.states.some(s => s.name === thread.state);
  const moduleFits = !thread.module || targetProject.modules.includes(thread.module);
  const changed = project !== thread.project || workflow !== thread.workflow.id;
  const ready = changed && (stateFits || !!state) && (moduleFits || module !== undefined);
  const send = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      ...(project !== thread.project ? { project } : {}), ...(workflow !== thread.workflow.id ? { workflow } : {}),
      ...(!stateFits ? { state } : {}), ...(!moduleFits ? { module: module ?? null } : {}),
    });
  };
  return <Dialog title={mode === 'project' ? `Przenieś ${thread.id} do projektu` : `Workflow wątku ${thread.id}`} onClose={onClose}>
    <form onSubmit={send}>
      {mode === 'project'
        ? <label>Projekt<select value={project} onChange={event => { setProject(event.target.value); setModule(undefined); }}>{registry.projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}</select></label>
        : <label>Workflow<select value={workflow} onChange={event => { setWorkflow(event.target.value); setState(''); }}>{registry.workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
      {changed && !stateFits && <label>Stan „{thread.state}” nie istnieje w workflow „{target.name}”. Wybierz nowy Stan.
        <select value={state} onChange={event => setState(event.target.value)}><option value="">Wybierz Stan…</option>{target.states.map(s => <option key={s.name}>{s.name}</option>)}</select></label>}
      {changed && !moduleFits && <label>Moduł „{thread.module}” nie jest w projekcie {targetProject.name}. Wybierz moduł albo zostaw wątek bez modułu.
        <select value={module === undefined ? '' : module ?? '__none__'} onChange={event => setModule(event.target.value === '' ? undefined : event.target.value === '__none__' ? null : event.target.value)}>
          <option value="">Wybierz moduł…</option><option value="__none__">Bez modułu</option>{targetProject.modules.map(m => <option key={m}>{m}</option>)}</select></label>}
      {changed && stateFits && moduleFits && <p className="fl-muted">Stan „{thread.state}”{thread.module ? ` i moduł „${thread.module}”` : ''} pasują i zostają.{project !== thread.project ? ' Wątek dostanie nowe ID, stare trafi do pola „Dawne ID”.' : ''}</p>}
      {error && <p className="fl-error" role="alert">{error}</p>}
      <div className="fl-actions"><button type="button" className="fl-text" onClick={onClose}>Anuluj</button><button type="submit" className="fl-primary" disabled={!ready}>Zapisz</button></div>
    </form>
  </Dialog>;
}

function ParentDialog({ thread, onClose, onSave, error }: { thread: FilaThreadDoc; onClose: () => void; onSave: (parent: string | null) => void; error: string }) {
  const [value, setValue] = useState(thread.parent ?? '');
  return <Dialog title={`Rodzic wątku ${thread.id}`} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (value.trim()) onSave(value.trim().toUpperCase()); }}>
      <label>ID wątku-rodzica<input value={value} placeholder={`np. ${thread.project}-1`} onChange={event => setValue(event.target.value)} /></label>
      <p className="fl-muted">Rodzic może być w innym projekcie. Cykl serwer odrzuci.</p>
      {error && <p className="fl-error" role="alert">{error}</p>}
      <div className="fl-actions">
        {thread.parent && <button type="button" className="fl-text" onClick={() => onSave(null)}>Usuń rodzica</button>}
        <button type="button" className="fl-text" onClick={onClose}>Anuluj</button><button type="submit" className="fl-primary" disabled={!value.trim() || value.trim().toUpperCase() === thread.parent}>Zapisz</button>
      </div>
    </form>
  </Dialog>;
}

/** The thread page (part 2): editable title and description, fields and Stan, subthreads, the read-only Specyfikacja, comments and history. */
export function ThreadPage({ id, registry, onOpen, onBack, boardName }: { id: string; registry: FilaRegistry; onOpen: (id: string) => void; onBack: () => void; boardName: string }) {
  const doc = useFilaThread(id);
  const thread = doc.data;
  const { act, error, clear } = useFilaActions();
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [dialog, setDialog] = useState<'project' | 'workflow' | 'parent' | null>(null);
  const [comment, setComment] = useState('');
  const [addingField, setAddingField] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const branch = useFilaAncestors(thread);
  const children = useFilaGet<{ threads: FilaThreadRow[] }>(thread && thread.children.length ? `/api/fila/query?q=${encodeURIComponent(`projekt = ${thread.project} AND rodzic = ${thread.id}`)}` : null);
  const shown = revision ?? thread?.spec.revision ?? 0;
  const spec = useFilaSpec(thread && (thread.spec.enabled || shown > 0) && shown > 0 ? thread.id : null, shown || undefined);
  useEffect(() => { setRevision(null); }, [id]);
  useEffect(() => { if (error && !dialog) { setNotice(error); clear(); } }, [error, dialog, clear]);

  if (!thread) return <div className="fl-thread"><button type="button" className="fl-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {boardName}</button>{doc.error ? <p className="fl-error" role="alert">{doc.error}</p> : <p className="fl-muted">Ładowanie wątku…</p>}</div>;

  const project = registry.projects.find(p => p.key === thread.project);
  const send = (action: FilaAction) => act(action);
  const update = async (change: Record<string, unknown>) => send({ action: 'updateThread', thread: thread.id, expectedRevision: thread.revision, ...change } as FilaAction);
  const setField = (field: string, value: FilaFieldValue, kind?: Kind) => send({ action: 'setField', thread: thread.id, field, value, ...(kind ? { kind } : {}), expectedRevision: thread.revision } as FilaAction);
  const defs = new Map(registry.fieldDefs.map(d => [d.name.toLowerCase(), d.kind]));
  const fieldNames = Object.keys(thread.fields).sort((a, b) => (a === 'Tagi' ? -1 : b === 'Tagi' ? 1 : a.localeCompare(b, 'pl')));
  const asRow = thread as unknown as FilaThreadRow;
  const closeDialog = () => { setDialog(null); clear(); };
  const reassign = async (change: Reassign) => {
    const result = await update(change);
    if (result) { setDialog(null); if (result.thread && result.thread.id !== thread.id) onOpen(result.thread.id); }
  };

  const saveTitle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = new FormData(event.currentTarget).get('title')?.toString().trim();
    if (title && title !== thread.title) { if (await update({ title })) setEditing(null); } else setEditing(null);
  };
  const saveDescription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const description = new FormData(event.currentTarget).get('description')?.toString() ?? '';
    if (description !== thread.description) { if (await update({ description })) setEditing(null); } else setEditing(null);
  };
  const addField = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get('name')?.toString().trim() ?? '';
    const known = defs.get(name.toLowerCase());
    const kind = known ?? (form.get('kind')?.toString() as Kind);
    const raw = form.get('value')?.toString().trim() ?? '';
    if (!name) return;
    const value: FilaFieldValue = kind === 'number' ? Number(raw.replace(',', '.')) : kind === 'bool' ? raw === 'tak' : kind === 'multi' ? raw.split(',').map(item => item.trim()).filter(Boolean) : raw;
    if (await setField(name, value, known ? undefined : kind)) setAddingField(false);
  };
  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    const text = comment.trim();
    if (text && await send({ action: 'comment', thread: thread.id, text })) setComment('');
  };

  const kids = children.data?.threads ?? [];
  const closedKids = kids.filter(kid => kid.closed).length;

  return <div className={`fl-thread tone-${thread.type.key}${thread.closed ? ' closed' : ''}`}>
    <button type="button" className="fl-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {boardName}</button>
    {branch.length > 0 && <div className="fl-branch" role="navigation" aria-label="Gałąź wątku">
      {branch.map(item => <span key={item.id} className="fl-branch-item"><button type="button" aria-label={`Rodzic ${item.id}: ${item.title}`} title={item.title} onClick={() => onOpen(item.id)}><b>{item.id}</b> {item.title}</button><ChevronRight size={13} aria-hidden="true" /></span>)}
      <span className="fl-branch-here" aria-current="page">{thread.id}</span>
    </div>}
    {notice && <p className="fl-notice" role="alert">{notice}<button type="button" aria-label="Zamknij komunikat" onClick={() => setNotice('')}><X size={13} aria-hidden="true" /></button></p>}
    {thread.archived && <p className="fl-banner" role="status">Wątek jest zarchiwizowany i nie pokazuje się w sekcjach.</p>}
    <header className="fl-thread-head">
      <div className="fl-kicker">
        <span className="fl-badge"><TypeIcon type={thread.type} size={15} />{thread.type.label}</span>
        <span className="fl-id">{thread.id}</span>
        <span className="fl-head-menu"><Menu label="Działania wątku" entries={[
          { label: 'Przenieś do projektu…', icon: <FolderInput size={15} />, onSelect: () => setDialog('project') },
          { label: 'Zmień workflow…', icon: <Workflow size={15} />, onSelect: () => setDialog('workflow') },
          { label: 'Zmień rodzica…', icon: <GitBranch size={15} />, onSelect: () => setDialog('parent') },
        ]} /></span>
      </div>
      {editing === 'title'
        ? <form className="fl-edit" onSubmit={event => void saveTitle(event)}>
          <textarea name="title" aria-label="Tytuł wątku" defaultValue={thread.title} autoFocus rows={2} maxLength={200}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }} />
          <div className="fl-actions"><button type="button" className="fl-text" onClick={() => setEditing(null)}>Anuluj</button><button type="submit" className="fl-primary small">Zapisz</button></div>
        </form>
        : <h1><button type="button" className="fl-editable" aria-label={`Zmień tytuł: ${thread.title}`} onClick={() => setEditing('title')}>{thread.title}<Pencil size={16} aria-hidden="true" /></button></h1>}
    </header>

    <div className="fl-thread-grid">
      <article className="fl-thread-main">
        <section className="fl-block" aria-label="Opis">
          {editing === 'description'
            ? <form className="fl-edit" onSubmit={event => void saveDescription(event)}>
              <textarea name="description" aria-label="Opis wątku" defaultValue={thread.description} autoFocus rows={Math.max(5, thread.description.split('\n').length + 2)} placeholder="Opis w Markdownie"
                onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }} />
              <div className="fl-actions"><button type="button" className="fl-text" onClick={() => setEditing(null)}>Anuluj</button><button type="submit" className="fl-primary small">Zapisz opis</button></div>
            </form>
            : thread.description
              ? <div className="fl-description"><MarkdownText text={thread.description} className="todo-spec-markdown" externalLinks /><button type="button" className="fl-icon" aria-label="Zmień opis" onClick={() => setEditing('description')}><Pencil size={15} aria-hidden="true" /></button></div>
              : <button type="button" className="fl-text" onClick={() => setEditing('description')}><Plus size={15} aria-hidden="true" /> Dodaj opis</button>}
        </section>

        {kids.length > 0 && <section className="fl-block" aria-label="Podwątki">
          <header className="fl-block-head"><h2>Podwątki</h2><span className="fl-count">{closedKids}/{kids.length} zamknięte</span></header>
          <ThreadList threads={kids} registry={registry} onError={setNotice} onOpen={onOpen} flat />
        </section>}

        <section className="fl-block" aria-label="Specyfikacja">
          <header className="fl-block-head">
            <FileText size={16} aria-hidden="true" /><h2>Specyfikacja</h2>
            {thread.spec.revision > 0 && <label className="fl-revision">
              <select aria-label="Rewizja specyfikacji" value={shown} onChange={event => setRevision(Number(event.target.value))}>
                {Array.from({ length: thread.spec.revision }, (_, index) => thread.spec.revision - index).map(n => <option key={n} value={n}>Rewizja {n}{n === thread.spec.revision ? ' · aktualna' : ''}</option>)}
              </select><ChevronDown size={13} aria-hidden="true" />
            </label>}
          </header>
          {spec.data?.text != null
            ? <><p className="fl-byline">{BY[spec.data.by ?? ''] ?? spec.data.by} · {spec.data.at ? when(spec.data.at) : ''} · tylko do odczytu</p><MarkdownText text={spec.data.text} className="todo-spec-markdown" externalLinks /></>
            : <p className="fl-muted">{thread.spec.enabled ? 'Specyfikacji jeszcze nie ma.' : 'Ten wątek nie ma pola Specyfikacja.'}</p>}
        </section>

        <section className="fl-block" aria-label="Aktywność">
          <header className="fl-block-head"><h2>Aktywność</h2></header>
          <ul className="fl-timeline">{thread.history.map((entry, index) => entry.kind === 'comment'
            ? <li key={index} className="comment"><div className="fl-comment-head"><b>{BY[entry.by] ?? entry.by}</b><time>{when(entry.at)}</time></div><p>{entry.text}</p></li>
            : <li key={index}><b>{BY[entry.by] ?? entry.by}</b> {entry.changes?.length ? entry.changes.map(change => change.field === 'Opis' ? 'zmienił opis' : `${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`).join('; ') : ACTION[entry.kind] ?? entry.kind}<time>{when(entry.at)}</time></li>)}</ul>
          <form className="fl-composer" onSubmit={event => void submitComment(event)}>
            <textarea aria-label="Komentarz" placeholder="Dodaj komentarz…" rows={2} value={comment} onChange={event => setComment(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <button type="submit" className="fl-primary small" disabled={!comment.trim()}><Send size={14} aria-hidden="true" /> Dodaj komentarz</button>
          </form>
        </section>
      </article>

      <aside className="fl-props" aria-label="Pola wątku">
        <dl>
          <dt>Stan</dt><dd><StatePicker thread={asRow} registry={registry} onError={setNotice} /></dd>
          <dt>Moduł</dt><dd>
            <select className="fl-select" aria-label="Moduł" value={thread.module ?? ''} onChange={event => void update({ module: event.target.value || null })}>
              <option value="">—</option>{(project?.modules ?? []).map(m => <option key={m}>{m}</option>)}
            </select>
          </dd>
          <dt>Typ</dt><dd className="fl-type-value"><TypeIcon type={thread.type} size={15} />{thread.type.label}</dd>
          <dt>Projekt</dt><dd>{project?.name ?? thread.project} <span className="fl-muted">{thread.project}</span></dd>
          <dt>Workflow</dt><dd>{thread.workflow.name}</dd>
          <dt>Rodzic</dt><dd>{thread.parent ? <button type="button" className="fl-linkish" onClick={() => onOpen(thread.parent!)}>{thread.parent}</button> : <span className="fl-muted">brak</span>}</dd>
          {fieldNames.map(name => {
            const kind = (defs.get(name.toLowerCase()) ?? 'text') as Kind;
            return <div key={name} className="fl-field"><dt>{name}</dt><dd>
              <FieldValue label={name} kind={kind} value={thread.fields[name]} onSave={value => void setField(name, value)} />
              {name !== 'Tagi' && <button type="button" className="fl-remove" aria-label={`Usuń pole ${name}`} onClick={() => void send({ action: 'removeField', thread: thread.id, field: name, expectedRevision: thread.revision })}><X size={13} aria-hidden="true" /></button>}
            </dd></div>;
          })}
        </dl>
        {addingField
          ? <form className="fl-field-form" onSubmit={event => void addField(event)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setAddingField(false); } }}>
            <input name="name" aria-label="Nazwa pola" placeholder="Nazwa pola" list="fl-field-defs" autoFocus required />
            <datalist id="fl-field-defs">{registry.fieldDefs.filter(d => !(d.name in thread.fields)).map(d => <option key={d.name} value={d.name} />)}</datalist>
            <select name="kind" aria-label="Rodzaj pola" defaultValue="text">{(Object.keys(KINDS) as Kind[]).map(kind => <option key={kind} value={kind}>{KINDS[kind]}</option>)}</select>
            <input name="value" aria-label="Wartość" placeholder="Wartość (wiele wartości po przecinku)" />
            <p className="fl-muted">Nazwa, która już istnieje, ma swój rodzaj w całej Fili.</p>
            <div className="fl-actions"><button type="button" className="fl-text" onClick={() => setAddingField(false)}>Anuluj</button><button type="submit" className="fl-primary small">Dodaj pole</button></div>
          </form>
          : <button type="button" className="fl-text" onClick={() => setAddingField(true)}><Plus size={14} aria-hidden="true" /> Pole</button>}
        <p className="fl-muted fl-props-note">Workflow, jego Stany i listę modułów zmienia AI.</p>
      </aside>
    </div>

    {(dialog === 'project' || dialog === 'workflow') && <ReassignDialog mode={dialog} thread={thread} registry={registry} error={error} onClose={closeDialog} onSave={change => void reassign(change)} />}
    {dialog === 'parent' && <ParentDialog thread={thread} error={error} onClose={closeDialog} onSave={async parent => { if (await update({ parent })) setDialog(null); }} />}
  </div>;
}
