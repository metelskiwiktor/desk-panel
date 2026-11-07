import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft, Archive, Bug, CalendarDays, Check, ChevronDown, ChevronRight, CircleDot, Ellipsis, FileText, Folder,
  FolderInput, GitPullRequest, History, Layers3, Lightbulb, Pencil, Plus, Send, SlidersHorizontal, StickyNote, Trash2, X,
} from 'lucide-react';
import { Empty } from '../../components';
import { MarkdownText } from '../../components/markdown-text';
import { TODO_STATUSES, todoIsDone } from '../../todo-contract';
import { Link, useSearch } from '../nav';
import {
  BOARD_HISTORY, PROJECTS, THREADS, TYPES, VIEWS, WORKFLOW_PRACA,
  type Author, type Project, type Cezar, type CustomField, type Entry, type Section, type Status, type Thread, type ThreadType, type View,
} from './fila-data';

/** Visual exploration of Fila stage 1 (docs/designlab.md): mockup data and in-memory changes only. */

const TYPE_ICON: Record<ThreadType, (size: number) => ReactNode> = {
  'Błąd': size => <Bug size={size} />, 'Funkcja': size => <Lightbulb size={size} />, 'Sprawa': size => <CircleDot size={size} />,
  'Spotkanie': size => <CalendarDays size={size} />, 'Notatka': size => <StickyNote size={size} />,
};
const TYPE_TONE: Record<ThreadType, string> = { 'Błąd': 'blad', 'Funkcja': 'funkcja', 'Sprawa': 'sprawa', 'Spotkanie': 'spotkanie', 'Notatka': 'notatka' };
const typeClass = (thread: Thread) => `tone-${TYPE_TONE[thread.type]}`;
const closed = (thread: Thread) => todoIsDone(thread.status);
const when = (at: number) => new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const now = () => new Date('2026-11-07T11:20:00').getTime() + (performance.now() % 60_000);

/** Closes a popover on an outside press or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', press); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

function StatusPicker({ status, onPick, compact = false, label = 'Stan' }: { status: Status; onPick: (status: Status) => void; compact?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const pick = (value: Status) => { setOpen(false); if (value !== status) onPick(value); };
  const item = (value: Status) => <li key={value}>
    <button role="option" aria-selected={value === status} onClick={() => pick(value)}>
      <span className={`fila-dot st-${value}`} />{TODO_STATUSES[value]}{value === status && <Check size={14} />}
    </button>
  </li>;
  return <div className="fila-popover-anchor" ref={ref}>
    <button className={`fila-status st-${status}${compact ? ' compact' : ''}`} aria-haspopup="listbox" aria-expanded={open}
      aria-label={`${label}: ${TODO_STATUSES[status]}`} onClick={() => setOpen(!open)}>
      <span className="fila-dot" />{!compact && <span className="fila-status-name">{TODO_STATUSES[status]}</span>}
      {todoIsDone(status) && !compact && <Check size={13} />}<ChevronDown size={13} className="fila-chevron" />
    </button>
    {open && <ul className="fila-popover" role="listbox" aria-label="Workflow Praca">
      {WORKFLOW_PRACA.filter(value => !todoIsDone(value)).map(item)}
      <li className="fila-popover-label" role="presentation">Zamyka wątek</li>
      {WORKFLOW_PRACA.filter(todoIsDone).map(item)}
    </ul>}
  </div>;
}

type MenuItem = { label: string; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; danger?: boolean };
function Menu({ label, items, icon = <Ellipsis size={18} /> }: { label: string; items: MenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return <div className="fila-popover-anchor" ref={ref}>
    <button className="fila-icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{icon}</button>
    {open && <ul className="fila-popover" role="menu" aria-label={label}>
      {items.map(entry => <li key={entry.label}>
        <button role="menuitem" disabled={entry.disabled} className={entry.danger ? 'danger' : undefined} onClick={() => { setOpen(false); entry.onSelect?.(); }}>
          {entry.icon}{entry.label}
        </button>
      </li>)}
    </ul>}
  </div>;
}

/** Query pills of a section or a kanban column; a click opens the editable query text right below them (D-060, D-067). */
function QueryText({ id, pills, text, onSave, compact = false }: { id: string; pills: string[]; text: string; onSave: (text: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return <>
    <button className={`fila-pills${compact ? ' compact' : ''}`} aria-expanded={open} aria-controls={`fila-query-${id}`} aria-label={`Zapytanie: ${pills.join(', ')}`} onClick={() => setOpen(!open)}>
      {pills.map((pill, index) => <span key={index} className="fila-pill">{pill}</span>)}
      <SlidersHorizontal size={13} />
    </button>
    {open && <form className="fila-query" id={`fila-query-${id}`} onSubmit={event => { event.preventDefault(); onSave(draft); setOpen(false); }}>
      <textarea aria-label="Tekst zapytania" value={draft} spellCheck={false} rows={Math.max(2, draft.split('\n').length)} onChange={event => setDraft(event.target.value)} />
      <div className="fila-form-actions">
        <button type="button" className="fila-text-button" onClick={() => { setDraft(text); setOpen(false); }}>Anuluj</button>
        <button type="submit" className="fila-primary small" disabled={draft === text}>Zapisz zapytanie</button>
      </div>
    </form>}
  </>;
}

export default function Fila() {
  const params = new URLSearchParams(useSearch());
  const href = (extra: Record<string, string> = {}) => `?${new URLSearchParams({ designlab: 'fila', ...extra })}`;
  const [threads, setThreads] = useState<Thread[]>(THREADS);
  const [views, setViews] = useState<View[]>(VIEWS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'DESK-36': true });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [dialog, setDialog] = useState<'thread' | 'project' | null>(null);
  const shownProject = projects.find(item => item.key === params.get('project'));
  const view = views.find(item => item.id === params.get('widok')) ?? views[0];
  const opened = threads.find(thread => thread.id === params.get('thread'));
  // The DeskPanel board's sections all ask for project = DESK (D-019, D-026).
  const live = threads.filter(thread => !thread.archived && thread.project === 'DESK');

  const update = (id: string, change: (thread: Thread) => Partial<Thread>, note?: string, by: Author = 'Ty') =>
    setThreads(previous => previous.map(thread => thread.id !== id ? thread : { ...thread, ...change(thread), activity: note ? [...thread.activity, { at: now(), by, text: note }] : thread.activity }));
  const setStatus = (thread: Thread, status: Status) => update(thread.id, () => ({ status }), `Stan: ${TODO_STATUSES[thread.status]} → ${TODO_STATUSES[status]}`);
  const editSections = (change: (sections: Section[]) => Section[]) => setViews(previous => previous.map(item => item.id === view.id ? { ...item, sections: change(item.sections) } : item));
  const children = (thread: Thread) => threads.filter(child => child.parent === thread.id && !child.archived);
  const toggle = (id: string) => setExpanded(previous => ({ ...previous, [id]: !previous[id] }));

  const progress = (thread: Thread) => {
    const kids = children(thread);
    if (!kids.length) return null;
    return <button className="fila-progress" aria-expanded={!!expanded[thread.id]} aria-label={`Podwątki ${thread.id}: ${kids.filter(closed).length} z ${kids.length} zamkniętych`} onClick={() => toggle(thread.id)}>
      {expanded[thread.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{kids.filter(closed).length}/{kids.length}
    </button>;
  };
  const tags = (thread: Thread) => thread.tags.map(tag => <span key={tag} className="fila-tag">#{tag}</span>);

  const row = (thread: Thread, nested = false): ReactNode => <li key={thread.id} className={`fila-row ${typeClass(thread)}${closed(thread) ? ' closed' : ''}${nested ? ' nested' : ''}`}>
    <div className="fila-row-line">
      <span className="fila-type-icon" title={thread.type} aria-label={thread.type}>{TYPE_ICON[thread.type](16)}</span>
      <span className="fila-id">{thread.id}</span>
      <div className="fila-row-main">
        <Link className="fila-title" href={href({ ...(view.id !== views[0].id ? { widok: view.id } : {}), thread: thread.id })}>{thread.title}</Link>
        {progress(thread)}{tags(thread)}
      </div>
      <span className="fila-module">{thread.module}</span>
      <StatusPicker status={thread.status} onPick={status => setStatus(thread, status)} label={`Stan ${thread.id}`} />
    </div>
    {!nested && expanded[thread.id] && children(thread).length > 0 && <ul className="fila-subrows">{children(thread).map(child => row(child, true))}</ul>}
  </li>;

  const card = (thread: Thread) => <li key={thread.id} className={`fila-card ${typeClass(thread)}`}>
    <div className="fila-card-top">
      <span className="fila-type-icon" title={thread.type} aria-label={thread.type}>{TYPE_ICON[thread.type](15)}</span>
      <span className="fila-id">{thread.id}</span><span className="fila-module">{thread.module}</span>
      <StatusPicker compact status={thread.status} onPick={status => setStatus(thread, status)} label={`Stan ${thread.id}`} />
    </div>
    <Link className="fila-title" href={href({ ...(view.id !== views[0].id ? { widok: view.id } : {}), thread: thread.id })}>{thread.title}</Link>
    {(thread.tags.length > 0 || children(thread).length > 0) && <div className="fila-card-meta">{progress(thread)}{tags(thread)}</div>}
    {expanded[thread.id] && children(thread).length > 0 && <ul className="fila-card-subs">{children(thread).map(child => <li key={child.id} className={closed(child) ? 'closed' : undefined}>
      <span className={`fila-dot st-${child.status}`} title={TODO_STATUSES[child.status]} /><Link href={href({ thread: child.id })}><span className="fila-id">{child.id}</span> {child.title}</Link>
    </li>)}</ul>}
  </li>;

  const sectionView = (section: Section, index: number, all: Section[]) => {
    const matching = live.filter(section.query.match);
    // One level of subthreads (D-051): a child whose parent is also in the section shows under its parent.
    const top = matching.filter(thread => !thread.parent || !matching.some(parent => parent.id === thread.parent));
    const move = (by: number) => editSections(sections => { const next = [...sections]; const [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next; });
    const count = section.kind === 'kanban' ? section.columns.reduce((sum, columnItem) => sum + matching.filter(columnItem.query.match).length, 0) : matching.length;
    return <section key={section.id} className={`fila-section kind-${section.kind}`} aria-label={section.name}>
      <header className="fila-section-head">
        {renaming === section.id
          ? <form className="fila-rename" onSubmit={event => { event.preventDefault(); const name = new FormData(event.currentTarget).get('name')?.toString().trim(); if (name) editSections(sections => sections.map(item => item.id === section.id ? { ...item, name } : item)); setRenaming(null); }}>
            <input name="name" aria-label="Nazwa sekcji" defaultValue={section.name} autoFocus onBlur={event => event.currentTarget.form?.requestSubmit()} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} />
          </form>
          : <h2>{section.name}</h2>}
        <span className="fila-count">{count}</span>
        <Menu label={`Sekcja ${section.name}`} items={[
          { label: 'Zmień nazwę', icon: <Pencil size={15} />, onSelect: () => setRenaming(section.id) },
          { label: 'Przesuń wyżej', icon: <ChevronDown size={15} style={{ transform: 'rotate(180deg)' }} />, disabled: index === 0, onSelect: () => move(-1) },
          { label: 'Przesuń niżej', icon: <ChevronDown size={15} />, disabled: index === all.length - 1, onSelect: () => move(1) },
          { label: 'Usuń sekcję', icon: <Trash2 size={15} />, danger: true, onSelect: () => editSections(sections => sections.filter(item => item.id !== section.id)) },
        ]} />
      </header>
      <QueryText id={section.id} pills={section.query.pills} text={section.query.text}
        onSave={text => editSections(sections => sections.map(item => item.id === section.id ? { ...item, query: { ...item.query, text } } : item))} />
      {section.kind === 'lista'
        ? top.length ? <ul className="fila-list">{top.map(thread => row(thread))}</ul> : <Empty>Żaden wątek nie pasuje do zapytania.</Empty>
        : <div className="fila-kanban" style={{ '--fila-columns': section.columns.length } as CSSProperties}>
          {section.columns.map((columnItem, columnIndex) => {
            const items = matching.filter(columnItem.query.match);
            return <section key={columnItem.status} className={`fila-column st-${columnItem.status}`} aria-label={`Kolumna ${TODO_STATUSES[columnItem.status]}`}>
              <header><span className="fila-dot" /><h3>{TODO_STATUSES[columnItem.status]}</h3><span className="fila-count">{items.length}</span></header>
              <QueryText compact id={`${section.id}-${columnIndex}`} pills={columnItem.query.pills} text={columnItem.query.text}
                onSave={text => editSections(sections => sections.map(item => item.id === section.id && item.kind === 'kanban' ? { ...item, columns: item.columns.map((c, i) => i === columnIndex ? { ...c, query: { ...c.query, text } } : c) } : item))} />
              {items.length ? <ul className="fila-cards">{items.map(card)}</ul> : <p className="fila-column-empty">Brak wątków</p>}
            </section>;
          })}
        </div>}
    </section>;
  };

  const addSection = (kind: Section['kind']) => {
    const id = `nowa-${Date.now()}`;
    const query = { pills: ['DeskPanel', 'otwarte'], text: 'projekt = DESK AND otwarte', match: (thread: Thread) => !closed(thread) };
    const statuses: Status[] = ['pomysl', 'przygotowanie', 'realizacja', 'sprawdzenie'];
    editSections(sections => [...sections, kind === 'lista' ? { id, kind, name: 'Nowa sekcja', query }
      : { id, kind, name: 'Nowa sekcja', query, columns: statuses.map(status => ({ status, query: { pills: [`Stan = ${TODO_STATUSES[status]}`], text: `Stan = "${TODO_STATUSES[status]}"`, match: (thread: Thread) => thread.status === status } })) }]);
    setRenaming(id);
  };

  const navItem = (label: string, icon: ReactNode, tone: string, target?: string, active = false) => target
    ? <Link key={label + target} href={target} className={`fila-nav-item ${tone}${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>{icon}<span>{label}</span></Link>
    : <button key={label} type="button" className={`fila-nav-item ${tone}`}>{icon}<span>{label}</span></button>;

  const go = (search: string) => { window.history.pushState(null, '', search); window.scrollTo(0, 0); window.dispatchEvent(new Event('designlab-navigate')); };
  const createThread = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = form.get('title')?.toString().trim();
    if (!title || !shownProject) return;
    const numbers = threads.filter(thread => thread.project === shownProject.key).map(thread => Number(thread.id.split('-')[1]));
    const id = `${shownProject.key}-${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
    setThreads(previous => [...previous, { id, type: form.get('type') as ThreadType, title, description: '', status: 'pomysl', module: '', project: shownProject.key, tags: [], custom: [], spec: [], activity: [{ at: now(), by: 'Ty', text: 'utworzył wątek' }] }]);
    setDialog(null);
    go(href({ thread: id }));
  };
  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get('name')?.toString().trim();
    const key = form.get('key')?.toString().trim().toUpperCase() ?? '';
    if (!name || !/^[A-Z]{4}$/.test(key) || projects.some(item => item.key === key)) return;
    setProjects(previous => [...previous, { key, name, tone: 'amber', modules: [] }]);
    setDialog(null);
    go(href({ project: key }));
  };

  return <div className="fila-lab">
    <aside className="fila-sidebar">
      <Link className="fila-brand" href={href()}><Layers3 size={22} /> Fila</Link>
      <nav aria-label="Nawigacja Fili">
        <h2>Tablice</h2>
        {projects.map(item => navItem(item.name, <Layers3 size={16} />, item.tone, item.key === 'DESK' ? href() : undefined, item.key === 'DESK' && !opened && !shownProject))}
        <div className="fila-nav-head"><h2>Projekty</h2><button className="fila-icon-button small" aria-label="Nowy projekt" onClick={() => setDialog('project')}><Plus size={15} /></button></div>
        {projects.map(item => navItem(item.name, <Folder size={16} />, item.tone, href({ project: item.key }), shownProject?.key === item.key && !opened))}
      </nav>
    </aside>
    <div className="fila-workspace">
      {!opened && shownProject
        ? <ProjectPage project={shownProject} threads={threads.filter(thread => thread.project === shownProject.key)} href={href} update={update}
          onNewThread={() => setDialog('thread')} onDelete={id => setThreads(previous => previous.filter(thread => thread.id !== id))} />
        : opened
        ? <ThreadPage key={opened.id} thread={opened} threads={threads} href={href} boardHref={href(view.id !== views[0].id ? { widok: view.id } : {})} update={update} setStatus={setStatus} subthreads={children(opened)} />
        : <>
          <header className="fila-board-head">
            <div><p className="fila-eyebrow">Tablica</p><h1>DeskPanel</h1></div>
            <div className="fila-head-actions">
              <button className="fila-icon-button" aria-label="Historia tablicy" aria-pressed={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={19} /></button>
            </div>
          </header>
          <div className="fila-views" role="tablist" aria-label="Widoki tablicy">
            {views.map(item => <Link key={item.id} role="tab" aria-selected={item.id === view.id} className={`fila-view${item.id === view.id ? ' active' : ''}`} href={href(item.id === views[0].id ? {} : { widok: item.id })}>{item.name}</Link>)}
            <span className="fila-views-note">{live.filter(thread => !closed(thread)).length} otwartych · {live.filter(closed).length} zamkniętych</span>
          </div>
          <div className={`fila-board${historyOpen ? ' with-drawer' : ''}`}>
            <div className="fila-sections">
              {view.sections.map(sectionView)}
              <div className="fila-add-section">
                <Menu label="Dodaj sekcję" icon={<><Plus size={16} /> Dodaj sekcję</>} items={[
                  { label: 'Lista', onSelect: () => addSection('lista') }, { label: 'Kanban', onSelect: () => addSection('kanban') },
                ]} />
              </div>
            </div>
            {historyOpen && <aside className="fila-drawer" aria-label="Historia tablicy">
              <header><h2>Historia tablicy</h2><button className="fila-icon-button" aria-label="Zamknij historię" onClick={() => setHistoryOpen(false)}><X size={17} /></button></header>
              <ul className="fila-timeline">{BOARD_HISTORY.map((entry, index) => <li key={index}><span className="fila-author">{entry.by}</span> {entry.text}<time>{when(entry.at)}</time></li>)}</ul>
            </aside>}
          </div>
        </>}
    </div>
    {dialog && <div className="fila-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setDialog(null); }}>
      {dialog === 'thread' && shownProject
        ? <form className="fila-dialog" role="dialog" aria-label="Nowy wątek" onSubmit={createThread} onKeyDown={event => { if (event.key === 'Escape') setDialog(null); }}>
          <h2>Nowy wątek w {shownProject.name}</h2>
          <label>Tytuł<input name="title" autoFocus required maxLength={200} placeholder="Co trzeba zrobić albo zapamiętać" /></label>
          <label>Typ<select name="type" defaultValue="Sprawa">{TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
          <div className="fila-form-actions"><button type="button" className="fila-text-button" onClick={() => setDialog(null)}>Anuluj</button><button type="submit" className="fila-primary">Utwórz</button></div>
        </form>
        : <form className="fila-dialog" role="dialog" aria-label="Nowy projekt" onSubmit={createProject} onKeyDown={event => { if (event.key === 'Escape') setDialog(null); }}>
          <h2>Nowy projekt</h2>
          <div className="fila-dialog-row">
            <label>Nazwa<input name="name" autoFocus required maxLength={80} placeholder="np. Prywatne" /></label>
            <label>Klucz<input name="key" required pattern="[A-Za-z]{4}" maxLength={4} placeholder="PRYW" className="fila-key-input" /></label>
          </div>
          <p className="fila-muted">Klucz ma 4 litery i nie da się go później zmienić; z niego powstają ID wątków, np. PRYW-1. Projekt dostaje od razu tablicę ze wszystkimi swoimi wątkami.</p>
          <div className="fila-form-actions"><button type="button" className="fila-text-button" onClick={() => setDialog(null)}>Anuluj</button><button type="submit" className="fila-primary">Załóż projekt</button></div>
        </form>}
    </div>}
  </div>;
}

type ProjectProps = {
  project: Project; threads: Thread[]; href: (extra?: Record<string, string>) => string;
  update: (id: string, change: (thread: Thread) => Partial<Thread>, note?: string) => void;
  onNewThread: () => void; onDelete: (id: string) => void;
};

function ProjectPage({ project, threads, href, update, onNewThread, onDelete }: ProjectProps) {
  const tab = new URLSearchParams(useSearch()).get('zakladka') === 'pola' ? 'pola' : 'archiwum';
  const [confirming, setConfirming] = useState<string | null>(null);
  const archived = threads.filter(thread => thread.archived);
  const live = threads.filter(thread => !thread.archived);
  const custom = [...new Map(threads.flatMap(thread => thread.custom).map(field => [field.name, field])).values()];
  const archivedAt = (thread: Thread) => [...thread.activity].reverse().find(entry => entry.text.startsWith('zarchiwizował'));
  return <div className="fila-project">
    <header className="fila-board-head">
      <div><p className="fila-eyebrow">Projekt</p><h1>{project.name} <span className="fila-key">{project.key}</span></h1></div>
      <div className="fila-head-actions">
        {project.key === 'DESK' && <Link className="fila-text-button" href={href()}><Layers3 size={16} /> Tablica {project.name}</Link>}
        <button className="fila-primary" onClick={onNewThread}><Plus size={17} /> Nowy wątek</button>
      </div>
    </header>
    <dl className="fila-stats">
      <div><dt>Otwarte</dt><dd>{live.filter(thread => !closed(thread)).length}</dd></div>
      <div><dt>Zamknięte</dt><dd>{live.filter(closed).length}</dd></div>
      <div><dt>W archiwum</dt><dd>{archived.length}</dd></div>
    </dl>
    <div className="fila-views" role="tablist" aria-label="Zakładki projektu">
      <Link role="tab" aria-selected={tab === 'archiwum'} className={`fila-view${tab === 'archiwum' ? ' active' : ''}`} href={href({ project: project.key })}>Archiwum</Link>
      <Link role="tab" aria-selected={tab === 'pola'} className={`fila-view${tab === 'pola' ? ' active' : ''}`} href={href({ project: project.key, zakladka: 'pola' })}>Pola i workflow</Link>
    </div>
    {tab === 'archiwum'
      ? archived.length
        ? <ul className="fila-list fila-archive">{archived.map(thread => <li key={thread.id} className={`fila-row ${typeClass(thread)}`}><div className="fila-row-line">
          <span className="fila-type-icon" aria-label={thread.type}>{TYPE_ICON[thread.type](16)}</span>
          <span className="fila-id">{thread.id}</span>
          <div className="fila-row-main">
            <Link className="fila-title" href={href({ thread: thread.id })}>{thread.title}</Link>
            <span className="fila-archived-by">{TODO_STATUSES[thread.status]} · zarchiwizował {archivedAt(thread)?.by ?? '—'}{archivedAt(thread) ? `, ${when(archivedAt(thread)!.at)}` : ''}</span>
          </div>
          {confirming === thread.id
            ? <div className="fila-confirm"><span>Usunąć {thread.id} na zawsze?</span><button className="fila-text-button" onClick={() => setConfirming(null)}>Anuluj</button><button className="fila-text-button danger" onClick={() => { onDelete(thread.id); setConfirming(null); }}>Usuń</button></div>
            : <div className="fila-row-actions">
              <button className="fila-text-button" onClick={() => update(thread.id, () => ({ archived: false }), 'przywrócił wątek z archiwum')}><Archive size={15} /> Przywróć</button>
              <button className="fila-icon-button" aria-label={`Usuń trwale ${thread.id}`} onClick={() => setConfirming(thread.id)}><Trash2 size={15} /></button>
            </div>}
        </div></li>)}</ul>
        : <Empty>Archiwum jest puste.</Empty>
      : <div className="fila-settings">
        <section className="fila-setting">
          <h2>Klucz</h2>
          <p><span className="fila-key">{project.key}</span> <span className="fila-muted">ID wątków: {project.key}-1, {project.key}-2…</span></p>
        </section>
        <section className="fila-setting">
          <h2>Moduł <span className="fila-muted">pole wyboru projektu</span></h2>
          {project.modules.length ? <p className="fila-chips">{project.modules.map(module => <span key={module} className="fila-chip">{module}</span>)}</p> : <p className="fila-muted">Projekt nie używa pola Moduł.</p>}
        </section>
        <section className="fila-setting">
          <h2>Workflow <span className="fila-muted">używane przez wątki projektu</span></h2>
          <div className="fila-workflow"><h3>Praca</h3><ol>{WORKFLOW_PRACA.map(status => <li key={status} className={`st-${status}${todoIsDone(status) ? ' closing' : ''}`}><span className="fila-dot" />{TODO_STATUSES[status]}{todoIsDone(status) && <Check size={13} />}</li>)}</ol></div>
        </section>
        <section className="fila-setting">
          <h2>Pola własne <span className="fila-muted">w wątkach projektu</span></h2>
          {custom.length ? <dl className="fila-custom-list">{custom.map(field => <div key={field.name}><dt>{field.name}</dt><dd>{field.kind}</dd></div>)}</dl> : <p className="fila-muted">Wątki projektu nie mają pól własnych.</p>}
        </section>
        <p className="fila-muted fila-settings-note">Moduł i workflow zmienia AI, np. w Claude Desktop.</p>
      </div>}
  </div>;
}

type PageProps = {
  thread: Thread; threads: Thread[]; subthreads: Thread[]; href: (extra?: Record<string, string>) => string; boardHref: string;
  update: (id: string, change: (thread: Thread) => Partial<Thread>, note?: string, by?: Author) => void;
  setStatus: (thread: Thread, status: Status) => void;
};

function ThreadPage({ thread, threads, subthreads: children, href, boardHref, update, setStatus }: PageProps) {
  const [revision, setRevision] = useState(thread.spec.at(-1)?.n ?? 0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [comment, setComment] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const parent = threads.find(item => item.id === thread.parent);
  const spec = thread.spec.find(item => item.n === revision);
  const project = PROJECTS.find(item => item.key === thread.project);
  const cezar: Cezar = thread.cezar ?? { executor: null, repo: null, mode: null };
  const missing = [
    !thread.spec.length && 'specyfikacji', thread.status !== 'gotowe' && 'Stanu „Gotowe do realizacji”',
    cezar.executor !== 'Cezar' && 'wykonawcy Cezar', !cezar.repo && 'repo', !cezar.mode && 'trybu',
  ].filter(Boolean) as string[];
  const setCezar = (change: Partial<Cezar>, note: string) => update(thread.id, () => ({ cezar: { ...cezar, ...change } }), note);

  const saveTitle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = new FormData(event.currentTarget).get('title')?.toString().trim();
    if (title && title !== thread.title) update(thread.id, () => ({ title }), `Tytuł: „${thread.title}” → „${title}”`);
    setEditingTitle(false);
  };
  const saveDescription = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const description = new FormData(event.currentTarget).get('description')?.toString() ?? '';
    if (description !== thread.description) update(thread.id, () => ({ description }), 'zmienił opis');
    setEditingDescription(false);
  };
  const addField = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get('name')?.toString().trim();
    if (!name) return;
    const field: CustomField = { name, kind: form.get('kind') as CustomField['kind'], value: form.get('value')?.toString() ?? '' };
    update(thread.id, item => ({ custom: [...item.custom, field] }), `dodał pole ${name}`);
    setAddingField(false);
  };

  return <div className={`fila-thread ${typeClass(thread)}${closed(thread) ? ' closed' : ''}`}>
    <Link className="fila-back" href={boardHref}><ArrowLeft size={16} /> Tablica DeskPanel</Link>
    {thread.archived && <div className="fila-banner" role="status">
      <Archive size={17} /><span>Wątek jest zarchiwizowany i nie pokazuje się w sekcjach.</span>
      <button className="fila-text-button" onClick={() => update(thread.id, () => ({ archived: false }), 'przywrócił wątek z archiwum')}>Przywróć</button>
      <button className="fila-text-button danger">Usuń trwale</button>
    </div>}
    <header className="fila-thread-head">
      <div className="fila-kicker">
        <span className="fila-type-badge">{TYPE_ICON[thread.type](15)}{thread.type}</span>
        <span className="fila-id">{thread.id}</span>
        {parent && <span className="fila-parent">podwątek <Link href={href({ thread: parent.id })}>{parent.id} · {parent.title}</Link></span>}
        <span className="fila-head-menu"><Menu label="Działania wątku" items={[
          { label: 'Przenieś do projektu…', icon: <FolderInput size={15} /> },
          thread.archived
            ? { label: 'Przywróć z archiwum', icon: <Archive size={15} />, onSelect: () => update(thread.id, () => ({ archived: false }), 'przywrócił wątek z archiwum') }
            : { label: 'Archiwizuj', icon: <Archive size={15} />, onSelect: () => update(thread.id, () => ({ archived: true }), 'zarchiwizował wątek') },
          ...(thread.archived ? [{ label: 'Usuń trwale', icon: <Trash2 size={15} />, danger: true }] : []),
        ]} /></span>
      </div>
      {editingTitle
        ? <form className="fila-title-form" onSubmit={saveTitle}>
          <textarea name="title" aria-label="Tytuł wątku" defaultValue={thread.title} autoFocus rows={2} maxLength={200}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } if (event.key === 'Escape') setEditingTitle(false); }} />
          <div className="fila-form-actions"><button type="button" className="fila-text-button" onClick={() => setEditingTitle(false)}>Anuluj</button><button className="fila-primary small">Zapisz</button></div>
        </form>
        : <h1><button className="fila-editable" onClick={() => setEditingTitle(true)} aria-label={`Zmień tytuł: ${thread.title}`}>{thread.title}<Pencil size={16} className="fila-edit-hint" /></button></h1>}
    </header>

    <div className="fila-thread-grid">
      <article className="fila-thread-main">
        <section className="fila-block" aria-label="Opis">
          {editingDescription
            ? <form onSubmit={saveDescription} className="fila-description-form">
              <textarea name="description" aria-label="Opis wątku" defaultValue={thread.description} autoFocus rows={Math.max(4, thread.description.split('\n').length + 2)} placeholder="Opis w Markdownie" />
              <div className="fila-form-actions"><button type="button" className="fila-text-button" onClick={() => setEditingDescription(false)}>Anuluj</button><button className="fila-primary small">Zapisz opis</button></div>
            </form>
            : thread.description
              ? <div className="fila-description"><MarkdownText text={thread.description} className="todo-spec-markdown" externalLinks /><button className="fila-icon-button fila-description-edit" aria-label="Zmień opis" onClick={() => setEditingDescription(true)}><Pencil size={15} /></button></div>
              : <button className="fila-add-description" onClick={() => setEditingDescription(true)}><Plus size={15} /> Dodaj opis</button>}
        </section>

        {children.length > 0 && <section className="fila-block" aria-label="Podwątki">
          <header className="fila-block-head"><h2>Podwątki</h2><span className="fila-count">{children.filter(closed).length}/{children.length} zamknięte</span></header>
          <div className="fila-meter" aria-hidden><span style={{ width: `${100 * children.filter(closed).length / children.length}%` }} /></div>
          <ul className="fila-list">{children.map(child => <li key={child.id} className={`fila-row nested ${typeClass(child)}${closed(child) ? ' closed' : ''}`}><div className="fila-row-line">
            <span className="fila-type-icon" aria-label={child.type}>{TYPE_ICON[child.type](15)}</span><span className="fila-id">{child.id}</span>
            <div className="fila-row-main"><Link className="fila-title" href={href({ thread: child.id })}>{child.title}</Link></div>
            <StatusPicker status={child.status} onPick={status => setStatus(child, status)} label={`Stan ${child.id}`} />
          </div></li>)}</ul>
        </section>}

        <section className="fila-block" aria-label="Specyfikacja">
          <header className="fila-block-head">
            <FileText size={16} /><h2>Specyfikacja</h2>
            {thread.spec.length > 0 && <label className="fila-revision">
              <select aria-label="Rewizja specyfikacji" value={revision} onChange={event => setRevision(Number(event.target.value))}>
                {[...thread.spec].reverse().map(item => <option key={item.n} value={item.n}>Rewizja {item.n}{item.n === thread.spec.at(-1)?.n ? ' · aktualna' : ''}</option>)}
              </select><ChevronDown size={13} />
            </label>}
          </header>
          {spec
            ? <><p className="fila-byline">{spec.by} · {when(spec.at)}</p><MarkdownText text={spec.text} className="todo-spec-markdown fila-spec" externalLinks /></>
            : <p className="fila-muted">Specyfikacji jeszcze nie ma.</p>}
        </section>

        <section className="fila-block" aria-label="Aktywność">
          <header className="fila-block-head"><h2>Aktywność</h2></header>
          <ul className="fila-timeline">{thread.activity.map((entry: Entry, index) => entry.comment
            ? <li key={index} className="comment"><div className="fila-comment-head"><span className="fila-author">{entry.by}</span><time>{when(entry.at)}</time></div><p>{entry.text}</p></li>
            : <li key={index}><span className="fila-author">{entry.by}</span> {entry.text}<time>{when(entry.at)}</time></li>)}</ul>
          <form className="fila-composer" onSubmit={event => { event.preventDefault(); const text = comment.trim(); if (!text) return; update(thread.id, item => ({ activity: [...item.activity, { at: now(), by: 'Ty', text, comment: true }] })); setComment(''); }}>
            <textarea aria-label="Komentarz" placeholder="Dodaj komentarz…" rows={2} value={comment} onChange={event => setComment(event.target.value)} />
            <button className="fila-primary small" disabled={!comment.trim()}><Send size={14} /> Dodaj</button>
          </form>
        </section>
      </article>

      <aside className="fila-props" aria-label="Pola wątku">
        <dl>
          <dt>Stan</dt><dd><StatusPicker status={thread.status} onPick={status => setStatus(thread, status)} label="Stan wątku" /></dd>
          <dt>Moduł</dt><dd><select className="fila-select" aria-label="Moduł" value={thread.module} onChange={event => update(thread.id, () => ({ module: event.target.value }), `Moduł: ${thread.module || '—'} → ${event.target.value}`)}>
            {!thread.module && <option value="">—</option>}{(project?.modules ?? []).map(module => <option key={module}>{module}</option>)}
          </select></dd>
          <dt>Typ</dt><dd className="fila-type-value">{TYPE_ICON[thread.type](15)}{thread.type}</dd>
          <dt>Projekt</dt><dd><Link className="fila-link" href={href({ project: thread.project })}>{project?.name}</Link> <span className="fila-muted">{project?.key}</span></dd>
          <dt>Workflow</dt><dd className="fila-muted-value">Praca</dd>
          <dt>Tagi</dt><dd className="fila-tag-list">
            {thread.tags.map(tag => <span key={tag} className="fila-tag removable">#{tag}<button aria-label={`Usuń tag ${tag}`} onClick={() => update(thread.id, item => ({ tags: item.tags.filter(t => t !== tag) }), `usunął tag ${tag}`)}><X size={12} /></button></span>)}
            {addingTag
              ? <form onSubmit={event => { event.preventDefault(); const tag = new FormData(event.currentTarget).get('tag')?.toString().trim().replace(/^#/, ''); if (tag && !thread.tags.includes(tag)) update(thread.id, item => ({ tags: [...item.tags, tag] }), `dodał tag ${tag}`); setAddingTag(false); }}>
                <input name="tag" className="fila-inline-input" aria-label="Nowy tag" autoFocus onBlur={event => event.currentTarget.form?.requestSubmit()} onKeyDown={event => { if (event.key === 'Escape') setAddingTag(false); }} />
              </form>
              : <button className="fila-add-chip" aria-label="Dodaj tag" onClick={() => setAddingTag(true)}><Plus size={13} /></button>}
          </dd>
          {thread.custom.map(field => <div key={field.name} className="fila-field"><dt>{field.name}</dt><dd>{field.value}<button className="fila-remove" aria-label={`Usuń pole ${field.name}`} onClick={() => update(thread.id, item => ({ custom: item.custom.filter(f => f.name !== field.name) }), `usunął pole ${field.name}`)}><X size={13} /></button></dd></div>)}
        </dl>
        {addingField
          ? <form className="fila-field-form" onSubmit={addField}>
            <input name="name" aria-label="Nazwa pola" placeholder="Nazwa pola" autoFocus required />
            <select name="kind" aria-label="Rodzaj pola" defaultValue="tekst">{['tekst', 'liczba', 'data', 'tak/nie', 'wiele wartości'].map(kind => <option key={kind}>{kind}</option>)}</select>
            <input name="value" aria-label="Wartość" placeholder="Wartość" />
            <div className="fila-form-actions"><button type="button" className="fila-text-button" onClick={() => setAddingField(false)}>Anuluj</button><button className="fila-primary small">Dodaj pole</button></div>
          </form>
          : <button className="fila-text-button fila-add-field" onClick={() => setAddingField(true)}><Plus size={14} /> Pole</button>}

        <div className="fila-cezar" aria-label="Cezar">
          <h2>Cezar</h2>
          <dl>
            <dt>Wykonawca</dt><dd><select className="fila-select" aria-label="Wykonawca" value={cezar.executor ?? ''} onChange={event => setCezar({ executor: (event.target.value || null) as Cezar['executor'] }, `Wykonawca: ${event.target.value || '—'}`)}><option value="">—</option><option>Cezar</option><option>Lokalnie</option><option>Rozmowa</option></select></dd>
            <dt>Repo</dt><dd><select className="fila-select" aria-label="Repo" value={cezar.repo ?? ''} onChange={event => setCezar({ repo: (event.target.value || null) as Cezar['repo'] }, `Repo: ${event.target.value || '—'}`)}><option value="">—</option><option>desk-panel</option></select></dd>
            <dt>Tryb</dt><dd><select className="fila-select" aria-label="Tryb" value={cezar.mode ?? ''} onChange={event => setCezar({ mode: (event.target.value || null) as Cezar['mode'] }, `Tryb: ${event.target.value || '—'}`)}><option value="">—</option><option>Analiza</option><option>Implementacja</option></select></dd>
            {cezar.task && <><dt>Task</dt><dd><a className="fila-link" href="#" onClick={event => event.preventDefault()}>{cezar.task}</a></dd></>}
            {cezar.pr && <><dt>PR</dt><dd><a className="fila-link" href="#" onClick={event => event.preventDefault()}><GitPullRequest size={14} /> {cezar.pr}</a></dd></>}
          </dl>
          {cezar.task
            ? <p className="fila-ready running">Zlecone · {cezar.mode}</p>
            : missing.length
              ? <p className="fila-ready">Do zlecenia brakuje: {missing.join(', ')}.</p>
              : <p className="fila-ready ok"><Check size={14} /> Gotowe do zlecenia · rewizja {thread.spec.at(-1)?.n}</p>}
          {!cezar.task && <button className="fila-primary wide" disabled={missing.length > 0}
            onClick={() => setCezar({ task: `cz-${1200 + Number(thread.id.split('-')[1])}` }, `zlecił Cezarowi (${cezar.mode}), rewizja ${thread.spec.at(-1)?.n}`)}><Send size={15} /> Zleć Cezarowi</button>}
        </div>
      </aside>
    </div>
  </div>;
}
