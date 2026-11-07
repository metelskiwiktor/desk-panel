import { useState } from 'react';
import { Columns3, ListChecks, MoreHorizontal, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Empty } from '../../components';
import { TODO_STATUSES, type TodoTask } from '../../todo-contract';
import { useTodos } from '../../useTodos';

/** Visual exploration only. All content comes from the isolated fila scenario; no writes. */
export default function Fila() {
  const { source } = useTodos();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const lists = source.data?.lists ?? [];
  const threads = lists.flatMap(list => list.tasks.map(task => ({ ...task, type: list.name.split(' · ')[0], module: list.name.split(' · ')[1] })));
  const filtered = threads.filter(t => t.title.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')));
  const inbox = filtered.filter(t => t.status === 'pomysl' || t.type !== 'Funkcja');
  const columns: TodoTask['status'][] = ['przygotowanie', 'gotowe', 'realizacja', 'sprawdzenie'];
  const id = (task: TodoTask) => `DESK-${parseInt(task.id.slice(2), 16)}`;
  const row = (task: typeof threads[number], kanban = false) => <li key={task.id} className={`todo-row fila-row${kanban ? ' fila-ticket' : ''}`}>
    <input type="checkbox" className="todo-check" checked={task.done} readOnly aria-label={`Zamknij ${id(task)} (podgląd)`} disabled />
    <div className="todo-title"><span className="fila-row-meta"><span>{id(task)}</span><span>{task.type}</span>{kanban && <span>{task.module}</span>}</span><span className="todo-text">{task.title}</span>{kanban && task.note && <span className="todo-note">{task.note}</span>}</div>
    {!kanban && <><span className="p2-meta fila-module">{task.module}</span><span className={`todo-status ${task.status}`}>{TODO_STATUSES[task.status]}</span></>}
  </li>;
  const pills = (kanban: boolean) => <div className="fila-pills"><span>Projekt · DeskPanel</span>{kanban ? <><span>Typ · Funkcja</span><span>Bez rodzica</span></> : <span>Stan · Pomysł lub typ inny niż Funkcja</span>}<button className="todo-more" aria-label={`Pokaż zapytanie ${kanban ? 'Funkcje' : 'Do przejrzenia'}`} onClick={() => setQuery(query ? null : kanban ? 'projekt = DeskPanel AND typ = Funkcja AND rodzic IS EMPTY ORDER BY id' : 'projekt = DeskPanel AND otwarte AND (stan = Pomysł OR typ != Funkcja) ORDER BY id')}><SlidersHorizontal size={16} /></button></div>;
  return <div className="fila-lab">
    <header className="fila-header"><div><p className="p2-eyebrow">Fila / Tablice</p><h1>DeskPanel</h1></div><label className="fila-search"><Search size={17} /><input aria-label="Szukaj w widoku" placeholder="Szukaj w widoku…" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="button" disabled><Plus size={17} /> Wątek</button><button className="todo-more" aria-label="Informacje o makiecie" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={22} /></button></header>
    <div className="fila-viewbar"><button className="button" aria-current="page">Przegląd</button><span className="p2-meta">{threads.length} otwartych wątków</span><span className="fila-lab-note p2-note">DesignLab · etap 1 · propozycja wyglądu</span></div>
    {menu && <p className="p2-note fila-notice">Podgląd wyglądu. Wyszukiwanie i pigułki zapytań działają lokalnie; tworzenie i zmiana danych czekają na implementację.</p>}
    {query && <div className="fila-notice"><p className="p2-note">Roboczy zapis zapytania — składnia zostanie ustalona w specyfikacji.</p><code>{query}</code></div>}
    {source.status === 'loading' ? <Empty>Ładowanie wątków…</Empty> : !source.data ? <Empty>Wątki są niedostępne. Uruchom scenariusz fila.</Empty> : <>
      <section className="p2-card fila-section"><header className="fila-section-heading"><ListChecks size={18} /><h2>Do przejrzenia</h2><span className="p2-meta">{inbox.length}</span></header>{pills(false)}
        {inbox.length ? <ul className="todo-list">{inbox.map(t => row(t))}</ul> : <Empty>Brak wątków pasujących do zapytania.</Empty>}
      </section>
      <section className="p2-card fila-section"><header className="fila-section-heading"><Columns3 size={18} /><h2>Funkcje</h2><span className="p2-meta">{filtered.filter(t => t.type === 'Funkcja' && columns.includes(t.status)).length}</span></header>{pills(true)}
        <div className="fila-kanban">{columns.map(status => { const items = filtered.filter(t => t.type === 'Funkcja' && t.status === status); return <section className="fila-column" key={status}><header><h3><span className={`todo-status ${status}`} />{TODO_STATUSES[status]}</h3><span className="p2-meta">{items.length}</span></header><p className="p2-note fila-column-query">Stan = {TODO_STATUSES[status]}</p><ul className="todo-list">{items.map(t => row(t, true))}</ul>{!items.length && <p className="p2-note fila-column-empty">Brak wątków</p>}</section>; })}</div>
      </section>
    </>}
  </div>;
}
