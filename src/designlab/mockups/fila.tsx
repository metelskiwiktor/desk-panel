import { useState } from 'react';
import { Columns3, ListChecks, MoreHorizontal, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Empty } from '../../components';
import { TODO_STATUSES, type TodoTask } from '../../todo-contract';
import { useTodos } from '../../useTodos';

/** Visual exploration only. All content comes from the isolated fila scenario; no writes. */
export default function Fila() {
  const { source } = useTodos();
  const [search, setSearch] = useState('');
  const [queries, setQueries] = useState({ inbox: false, kanban: false });
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
  const toggleQuery = (key: keyof typeof queries) => setQueries(previous => ({ ...previous, [key]: !previous[key] }));
  const sectionMenu = (key: keyof typeof queries) => <details className="fila-menu fila-section-menu"><summary className="button"><MoreHorizontal size={18} /> Sekcja</summary><div className="fila-menu-pop"><button onClick={() => toggleQuery(key)}><SlidersHorizontal size={16} />{queries[key] ? 'Ukryj zapytanie' : 'Pokaż zapytanie'}</button><button disabled>Zmień nazwę</button><button disabled>Przesuń sekcję w górę</button><button disabled>Przesuń sekcję w dół</button><button disabled>Usuń sekcję</button><p className="p2-note">Zmiana danych — poza makietą.</p></div></details>;
  const pills = (kanban: boolean) => {
    const key = kanban ? 'kanban' : 'inbox';
    return <><div className="fila-pills"><span>Projekt · DeskPanel</span>{kanban ? <><span>Typ · Funkcja</span><span>Bez rodzica</span></> : <span>Stan · Pomysł lub typ inny niż Funkcja</span>}<button className="button fila-query-toggle" aria-label={`Pokaż zapytanie ${kanban ? 'Funkcje' : 'Do przejrzenia'}`} aria-expanded={queries[key]} aria-controls={`fila-query-${key}`} onClick={() => toggleQuery(key)}><SlidersHorizontal size={16} /> Zapytanie</button></div>
      {queries[key] && <div className="fila-notice" id={`fila-query-${key}`}><p className="p2-note">Roboczy zapis zapytania — składnia zostanie ustalona w specyfikacji.</p><code>{kanban ? 'projekt = DeskPanel AND typ = Funkcja AND rodzic IS EMPTY ORDER BY id' : 'projekt = DeskPanel AND otwarte AND (stan = Pomysł OR typ != Funkcja) ORDER BY id'}</code></div>}</>;
  };
  return <div className="fila-lab">
    <header className="fila-header"><div><p className="p2-eyebrow">Fila / Tablice</p><h1>DeskPanel</h1></div><label className="fila-search"><Search size={17} /><input aria-label="Szukaj w widoku" placeholder="Szukaj w widoku…" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="button" disabled><Plus size={17} /> Wątek</button><details className="fila-menu"><summary className="button"><MoreHorizontal size={20} /> Menu tablicy</summary><div className="fila-menu-pop"><button disabled>Zmień nazwę tablicy</button><button disabled>Dodaj widok</button><button disabled>Dodaj sekcję</button><button disabled>Historia aktywności</button><p className="p2-note">Podgląd wyglądu menu. Zmiana danych — poza makietą.</p></div></details></header>
    <div className="fila-viewbar"><button className="button" aria-current="page">Przegląd</button><span className="p2-meta">{threads.length} otwartych wątków</span><span className="fila-lab-note p2-note">DesignLab · etap 1 · propozycja wyglądu</span></div>
    {source.status === 'loading' ? <Empty>Ładowanie wątków…</Empty> : !source.data ? <Empty>Wątki są niedostępne. Uruchom scenariusz fila.</Empty> : <>
      <section className="p2-card fila-section"><header className="fila-section-heading"><ListChecks size={18} /><h2>Do przejrzenia</h2><span className="p2-meta">{inbox.length}</span>{sectionMenu('inbox')}</header>{pills(false)}
        {inbox.length ? <ul className="todo-list">{inbox.map(t => row(t))}</ul> : <Empty>Brak wątków pasujących do zapytania.</Empty>}
      </section>
      <section className="p2-card fila-section"><header className="fila-section-heading"><Columns3 size={18} /><h2>Funkcje</h2><span className="p2-meta">{filtered.filter(t => t.type === 'Funkcja' && columns.includes(t.status)).length}</span>{sectionMenu('kanban')}</header>{pills(true)}
        <div className="fila-kanban">{columns.map(status => { const items = filtered.filter(t => t.type === 'Funkcja' && t.status === status); return <section className="fila-column" key={status}><header><h3><span className={`todo-status ${status}`} />{TODO_STATUSES[status]}</h3><span className="p2-meta">{items.length}</span></header><p className="p2-note fila-column-query">Stan = {TODO_STATUSES[status]}</p><ul className="todo-list">{items.map(t => row(t, true))}</ul>{!items.length && <p className="p2-note fila-column-empty">Brak wątków</p>}</section>; })}</div>
      </section>
    </>}
  </div>;
}
