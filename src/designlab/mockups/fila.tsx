import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpToLine, Bug, Check, ChevronDown, Circle, FileText, Folder, GripVertical, Layers3, Lightbulb, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { Empty } from '../../components';
import { MarkdownText } from '../../components/markdown-text';
import { TODO_STATUSES, todoIsDone, type TodoTask } from '../../todo-contract';
import { useTodos } from '../../useTodos';

type SectionKey = 'inbox' | 'kanban';
const threadId = (task: TodoTask) => `DESK-${parseInt(task.id.slice(2), 16)}`;
const accents = { 'Błąd': 'var(--quota-red)', 'Funkcja': 'var(--p2-cal)', 'Sprawa': 'var(--amber)' };
const typeStyle = (type: string) => ({ '--fila-accent': accents[type as keyof typeof accents] ?? 'var(--p2-muted)' }) as CSSProperties;
const typeIcon = (type: string) => type === 'Błąd' ? <Bug size={17} /> : type === 'Funkcja' ? <Lightbulb size={17} /> : <Circle size={17} />;
const threadHref = (task: TodoTask) => `?designlab=fila&thread=${threadId(task)}`;

/** Visual exploration: scenario data and in-memory interactions only; no writes. */
export default function Fila() {
  const { source } = useTodos();
  const [search, setSearch] = useState('');
  const [queries, setQueries] = useState({ inbox: false, kanban: false });
  const [order, setOrder] = useState<SectionKey[]>(['inbox', 'kanban']);
  const [moving, setMoving] = useState<SectionKey | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, TodoTask['status']>>({});
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { clearHold(); setMoving(null); } };
    window.addEventListener('keydown', cancel);
    return () => { clearHold(); window.removeEventListener('keydown', cancel); };
  }, []);
  const params = new URLSearchParams(window.location.search);
  const project = params.get('project');
  const threads = (source.data?.lists ?? []).flatMap(list => list.tasks.map(task => ({ ...task, status: localStatuses[task.id] ?? task.status, type: list.name.split(' · ')[0], module: list.name.split(' · ')[1] })));
  const opened = threads.find(task => threadId(task) === params.get('thread'));
  const [revision, setRevision] = useState<number | null>(null);
  const filtered = threads.filter(task => `${threadId(task)} ${task.title}`.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')));
  const inbox = filtered.filter(task => !todoIsDone(task.status) && (task.status === 'pomysl' || task.type !== 'Funkcja'));
  const columns: TodoTask['status'][] = ['przygotowanie', 'gotowe', 'realizacja', 'sprawdzenie'];
  const toggleQuery = (key: SectionKey) => setQueries(previous => ({ ...previous, [key]: !previous[key] }));
  const relocate = (target: SectionKey, after: boolean) => {
    if (!moving) return;
    const next = order.filter(key => key !== moving);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, moving);
    setOrder(next); setMoving(null);
  };
  const row = (task: typeof threads[number], kanban = false) => <li key={task.id} style={typeStyle(task.type)} className={`fila-item${kanban ? ' fila-ticket' : ''}`}>
    <a href={threadHref(task)} className="fila-thread-link"><span className="fila-type-icon" title={task.type}>{typeIcon(task.type)}</span><span className="fila-thread-copy"><span className="fila-row-meta"><span>{threadId(task)}</span><span className="fila-type-name">{task.type}</span>{kanban && <span>{task.module}</span>}</span><span className="fila-thread-title">{task.title}</span>{kanban && task.note && <span className="todo-note">{task.note}</span>}</span></a>
    {!kanban && <><span className="p2-meta fila-module">{task.module}</span><span className={`todo-status ${task.status}`}>{TODO_STATUSES[task.status]}</span></>}
  </li>;
  const pills = (key: SectionKey) => <><button className="fila-pills" aria-label={`Zapytanie sekcji ${key === 'kanban' ? 'Funkcje' : 'Do przejrzenia'}`} aria-expanded={queries[key]} aria-controls={`fila-query-${key}`} onClick={() => toggleQuery(key)}><span>DeskPanel</span><span className="fila-query-separator">/</span>{key === 'kanban' ? <><span>Funkcja</span><span className="fila-query-separator">/</span><span>Bez rodzica</span></> : <span>Pomysł lub typ ≠ Funkcja</span>}<SlidersHorizontal size={14} /></button>
    {queries[key] && <div className="fila-query" id={`fila-query-${key}`}><code>{key === 'kanban' ? 'projekt = DeskPanel AND typ = Funkcja AND rodzic IS EMPTY ORDER BY id' : 'projekt = DeskPanel AND otwarte AND (stan = Pomysł OR typ != Funkcja) ORDER BY id'}</code><small className="p2-note">Robocza składnia makiety</small></div>}</>;
  const section = (key: SectionKey) => <section key={key} className={`fila-section${moving === key ? ' fila-moving' : ''}`} aria-label={key === 'inbox' ? 'Do przejrzenia' : 'Funkcje'}>
    {moving && moving !== key && <button className="fila-drop" aria-label="Umieść przenoszoną sekcję przed tą sekcją" title="Umieść przed" onClick={() => relocate(key, false)}><ArrowUpToLine size={18} /></button>}
    <header className="fila-section-heading" onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; clearHold(); hold.current = setTimeout(() => setMoving(key), 550); }} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold} onContextMenu={event => { event.preventDefault(); setMoving(key); }}>
      <h2>{key === 'inbox' ? 'Do przejrzenia' : 'Funkcje'}</h2><span className="p2-meta">{key === 'inbox' ? inbox.length : filtered.filter(task => task.type === 'Funkcja' && columns.includes(task.status)).length}</span>
      <button className="fila-icon-action fila-grip" aria-label={`Przenieś sekcję ${key === 'inbox' ? 'Do przejrzenia' : 'Funkcje'}`} title="Przytrzymaj nagłówek, aby przenieść sekcję" aria-pressed={moving === key} onClick={() => setMoving(moving === key ? null : key)}>{moving === key ? <X size={17} /> : <GripVertical size={17} />}</button>
    </header>{pills(key)}
    {key === 'inbox' ? inbox.length ? <ul className="fila-list">{inbox.map(task => row(task))}</ul> : <Empty>Brak wątków pasujących do zapytania.</Empty>
      : <div className="fila-kanban">{columns.map(status => { const items = filtered.filter(task => task.type === 'Funkcja' && task.status === status); return <section className={`fila-column ${status}`} key={status}><header><h3><span className={`todo-status ${status}`} />{TODO_STATUSES[status]}</h3><span className="p2-meta">{items.length}</span></header><ul className="fila-list">{items.map(task => row(task, true))}</ul>{!items.length && <p className="p2-note fila-column-empty">Brak wątków</p>}</section>; })}</div>}
    {moving && moving !== key && <button className="fila-drop" aria-label="Umieść przenoszoną sekcję za tą sekcją" title="Umieść za" onClick={() => relocate(key, true)}><ArrowDownToLine size={18} /></button>}
  </section>;
  const navItem = (label: string, icon: ReactNode, tone: string, href?: string, active = false) => href ? <a href={href} className={`fila-nav-item ${tone}${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>{icon}<span>{label}</span></a> : <span className={`fila-nav-item ${tone} fila-nav-preview`}>{icon}<span>{label}</span></span>;
  const spec = opened?.specRevisions.find(item => item.revision === (revision ?? opened.specRevision));
  return <div className="fila-lab">
    <aside className="fila-sidebar"><a className="fila-brand" href="?designlab=fila"><Layers3 size={24} /> Fila</a><nav aria-label="Nawigacja Fili"><h2>Tablice</h2>{navItem('DeskPanel', <Layers3 size={16} />, 'blue', '?designlab=fila', !project && !opened)}{navItem('Cezar', <Layers3 size={16} />, 'violet')}{navItem('Tabularium', <Layers3 size={16} />, 'green')}
      <h2>Projekty</h2>{navItem('DeskPanel', <Folder size={16} />, 'blue', '?designlab=fila&project=DeskPanel', !!project)}{navItem('Cezar', <Folder size={16} />, 'violet')}{navItem('Tabularium', <Folder size={16} />, 'green')}</nav><p className="fila-sidebar-foot p2-note">DesignLab · etap 1<br />Propozycja wyglądu</p></aside>
    <div className="fila-workspace">
      <header className="fila-header"><div><p className="p2-eyebrow">{opened ? `DeskPanel / ${threadId(opened)}` : project ? 'Projekt' : 'Tablica'}</p>{!opened && <h1>DeskPanel</h1>}</div>{!opened && <label className="fila-search"><Search size={17} /><input aria-label="Szukaj w widoku" placeholder="Szukaj po tytule lub ID…" value={search} onChange={event => setSearch(event.target.value)} /></label>}{project && <button className="fila-icon-action" disabled aria-label="Nowy wątek w projekcie DeskPanel" title="Tworzenie wątku w projekcie — podgląd"><Plus size={21} /></button>}</header>
      {source.status === 'loading' ? <Empty>Ładowanie wątków…</Empty> : !source.data ? <Empty>Wątki są niedostępne. Uruchom scenariusz fila.</Empty> : opened ? <>
        <a className="fila-back" href="?designlab=fila"><ArrowLeft size={16} /> Tablica DeskPanel</a>
        <div className="fila-thread-page" style={typeStyle(opened.type)}><article><div className="fila-thread-type">{typeIcon(opened.type)} {opened.type}<span>{threadId(opened)}</span></div><h1>{opened.title}</h1><p className="fila-description">{opened.note || 'Brak opisu.'}</p>
          <section className="fila-detail-section"><header><FileText size={17} /><h3>Specyfikacja</h3>{opened.specRevision > 0 && <label className="fila-revision"><select aria-label="Rewizja specyfikacji" value={revision ?? opened.specRevision} onChange={event => setRevision(Number(event.target.value))}>{[...opened.specRevisions].reverse().map(item => <option key={item.revision} value={item.revision}>Rewizja {item.revision}{item.revision === opened.specRevision ? ' · aktualna' : ''}</option>)}</select><ChevronDown size={13} /></label>}</header>{opened.spec ? <><p className="fila-spec-author p2-note">{spec?.by === 'claude' ? 'Claude Desktop' : spec?.by === 'codex' ? 'Codex' : spec?.by ?? '—'}{spec && ` · ${new Date(spec.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}`}</p><MarkdownText text={spec?.spec ?? opened.spec} className="todo-spec-markdown" externalLinks /></> : <p className="p2-note">Nie ma jeszcze specyfikacji.</p>}</section>
          <section className="fila-detail-section"><header><h3>Aktywność</h3></header>{opened.history.length ? <ul className="todo-history">{opened.history.map((entry, index) => <li key={index}><small>{entry.by === 'claude' ? 'Claude Desktop' : entry.by === 'codex' ? 'Codex' : entry.by === 'user' ? 'Ty' : entry.by} · {new Date(entry.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</small><p>{entry.text ?? (entry.to ? `Stan: ${TODO_STATUSES[entry.to]}` : '')}</p></li>)}</ul> : <p className="p2-note">Brak aktywności w tym przykładzie.</p>}</section>
        </article><aside className="fila-properties"><dl><dt>Stan</dt><dd><select aria-label="Stan wątku (tylko makieta)" value={opened.status} onChange={event => setLocalStatuses(previous => ({ ...previous, [opened.id]: event.target.value as TodoTask['status'] }))}>{Object.entries(TODO_STATUSES).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>{todoIsDone(opened.status) && <Check size={16} />}</dd><dt>Projekt</dt><dd><a href="?designlab=fila&project=DeskPanel">DeskPanel</a></dd><dt>Typ</dt><dd className="fila-thread-type">{typeIcon(opened.type)}{opened.type}</dd><dt>Workflow</dt><dd>Praca</dd><dt>Moduł</dt><dd>{opened.module}</dd></dl><p className="p2-note">Zmiana Stanu działa tylko w tym podglądzie.</p></aside></div>
      </> : project ? <><p className="fila-project-note p2-note">Robocze wejście do projektu — docelowy ekran pozostaje do zaprojektowania.</p><ul className="fila-list">{filtered.map(task => row(task))}</ul></> : <><div className="fila-viewbar"><span className="fila-view-active">Przegląd</span><span className="p2-note">{threads.filter(task => !todoIsDone(task.status)).length} otwartych wątków</span></div>{order.map(section)}</>}
    </div>
  </div>;
}
