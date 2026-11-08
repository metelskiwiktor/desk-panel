import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Folder, History, Layers3, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Empty } from '../components';
import type { FilaAction, FilaSection } from '../fila-contract';
import { sendFilaAction, useFilaActions, useFilaBoard, useFilaRegistry, useFilaView, type FilaBoardDoc, type FilaViewDoc } from './api';
import { ThreadCard, ThreadList } from './threads';
import { ThreadPage } from './ThreadPage';
import { ConfirmDialog, Menu, NameDialog, QueryEditor, stateTone } from './ui';

type Section = FilaViewDoc['sections'][number];
type Dialogs =
  | { kind: 'newBoard' } | { kind: 'renameBoard' } | { kind: 'deleteBoard' }
  | { kind: 'newView' } | { kind: 'renameView'; view: string; name: string } | { kind: 'deleteView'; view: string; name: string }
  | { kind: 'renameSection'; section: string; name: string } | { kind: 'deleteSection'; section: string; name: string }
  | { kind: 'newSection'; sectionKind: 'list' | 'kanban' }
  | { kind: 'newColumn'; section: string } | { kind: 'renameColumn'; column: string; name: string } | { kind: 'deleteColumn'; column: string; name: string };

const when = (at: number) => new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const BY: Record<string, string> = { user: 'Ty', panel: 'Panel', 'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', codex: 'Codex', wektor: 'Wektor' };
const KIND: Record<string, string> = { created: 'utworzył', renamed: 'zmienił nazwę', changed: 'zmienił', moved: 'przesunął', removed: 'usunął' };
const TARGET: Record<string, string> = { board: 'tablicę', view: 'widok', section: 'sekcję', column: 'kolumnę' };
const sentence = (entry: FilaBoardDoc['history'][number]) => {
  const change = entry.changes?.[0];
  const detail = change ? ` (${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'})` : '';
  return `${KIND[entry.kind] ?? entry.kind} ${TARGET[entry.target] ?? entry.target} „${entry.name}”${entry.in ? ` w „${entry.in}”` : ''}${detail}`;
};

/** The Fila page (part 1): navigation of boards and projects, a board's views as tabs, its sections, and the board's history. */
export function FilaApp({ onHome, thread: firstThread }: { onHome?: () => void; /** A thread to open first (from the Zadania tile). */ thread?: string }) {
  const registry = useFilaRegistry();
  const [boardId, setBoardId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(firstThread ?? null);
  const [notice, setNotice] = useState('');
  const { act, error, clear } = useFilaActions();
  const data = registry.data;
  const board = data?.boards.find(b => b.id === boardId) ?? data?.boards[0];
  const boardDoc = useFilaBoard(board?.id ?? null);
  const view = board?.views.find(v => v.id === viewId) ?? board?.views[0];
  const viewDoc = useFilaView(board?.id ?? null, view?.id ?? null);
  // A refusal belongs to the dialog that sent it; without one it goes to the banner.
  useEffect(() => { if (error && !dialog) { setNotice(error); clear(); } }, [error, dialog, clear]);

  if (!data) return <div className="fl-app"><div className="fl-workspace"><Empty>{registry.error || 'Ładowanie Fili…'}</Empty></div></div>;
  const project = data.projects.find(p => p.board === board?.id)?.key ?? boardDoc.data?.project ?? data.projects[0]?.key ?? '';
  const sections = boardDoc.data?.views.find(v => v.id === view?.id)?.sections ?? [];
  const send = async (action: FilaAction, then?: (result: Awaited<ReturnType<typeof act>>) => void) => {
    const result = await act(action);
    if (result) { setDialog(null); then?.(result); }
    return result;
  };
  const starter = (name: string, kind: 'list' | 'kanban') => ({
    name, kind, query: `projekt = ${project}`,
    ...(kind === 'kanban' ? { columns: (data.workflows[0]?.states ?? []).filter(s => !s.closing).slice(0, 4).map(s => ({ name: s.name, query: `stan = "${s.name}"` })) } : {}),
  });

  const dialogView = () => {
    if (!dialog) return null;
    const close = () => { setDialog(null); clear(); };
    switch (dialog.kind) {
      case 'newBoard': return <NameDialog title="Nowa tablica" label="Nazwa" submit="Utwórz" error={error} onClose={close}
        onSubmit={name => void send({ action: 'createBoard', name, section: starter('Wszystkie wątki', 'list') }, result => { if (result?.board) { setBoardId(result.board); setViewId(null); } })} />;
      case 'renameBoard': return <NameDialog title="Zmień nazwę tablicy" label="Nazwa" initial={board?.name} error={error} onClose={close} onSubmit={name => void send({ action: 'renameBoard', board: board!.id, name })} />;
      case 'deleteBoard': return <ConfirmDialog title={`Usunąć tablicę „${board?.name}”?`} text="Znikają jej widoki i sekcje. Wątki zostają." confirm="Usuń tablicę" error={error} onClose={close}
        onConfirm={() => void send({ action: 'deleteBoard', board: board!.id }, () => { setBoardId(null); setViewId(null); })} />;
      case 'newView': return <NameDialog title="Nowy widok" label="Nazwa" submit="Utwórz" error={error} onClose={close}
        onSubmit={name => void send({ action: 'createView', board: board!.id, name, section: starter('Wszystkie wątki', 'list') }, result => { if (result?.view) setViewId(result.view); })} />;
      case 'renameView': return <NameDialog title="Zmień nazwę widoku" label="Nazwa" initial={dialog.name} error={error} onClose={close} onSubmit={name => void send({ action: 'renameView', view: dialog.view, name })} />;
      case 'deleteView': return <ConfirmDialog title={`Usunąć widok „${dialog.name}”?`} text="Znikają jego sekcje. Wątki zostają." confirm="Usuń widok" error={error} onClose={close}
        onConfirm={() => void send({ action: 'deleteView', view: dialog.view }, () => setViewId(null))} />;
      case 'renameSection': return <NameDialog title="Zmień nazwę sekcji" label="Nazwa" initial={dialog.name} error={error} onClose={close} onSubmit={name => void send({ action: 'updateSection', section: dialog.section, name })} />;
      case 'deleteSection': return <ConfirmDialog title={`Usunąć sekcję „${dialog.name}”?`} text="Wątki zostają, znika tylko sekcja." confirm="Usuń sekcję" error={error} onClose={close} onConfirm={() => void send({ action: 'deleteSection', section: dialog.section })} />;
      case 'newSection': return <NameDialog title={dialog.sectionKind === 'kanban' ? 'Nowa sekcja kanban' : 'Nowa sekcja listy'} label="Nazwa" submit="Dodaj" error={error} onClose={close}
        onSubmit={name => void send({ action: 'createSection', view: view!.id, section: starter(name, dialog.sectionKind) })} />;
      case 'newColumn': return <NameDialog title="Nowa kolumna" label="Nazwa" submit="Dodaj" error={error} onClose={close} onSubmit={name => void send({ action: 'createColumn', section: dialog.section, name, query: 'otwarte' })} />;
      case 'renameColumn': return <NameDialog title="Zmień nazwę kolumny" label="Nazwa" initial={dialog.name} error={error} onClose={close} onSubmit={name => void send({ action: 'updateColumn', column: dialog.column, name })} />;
      case 'deleteColumn': return <ConfirmDialog title={`Usunąć kolumnę „${dialog.name}”?`} text="Wątki zostają, znika tylko kolumna." confirm="Usuń kolumnę" error={error} onClose={close} onConfirm={() => void send({ action: 'deleteColumn', column: dialog.column })} />;
    }
  };

  const sectionView = (section: Section, index: number, all: Section[]) => {
    const def = sections.find(s => s.id === section.id) ?? (section as unknown as FilaSection);
    const place = (position: number): FilaAction => ({ action: 'moveSection', section: section.id, position });
    const count = section.kind === 'kanban' ? section.columns.reduce((sum, c) => sum + c.total, 0) : section.total;
    return <section key={section.id} className={`fl-section ${section.kind}`} aria-label={section.name}>
      <header className="fl-section-head">
        <h2>{section.name}</h2><span className="fl-count">{count}</span>
        <Menu label={`Sekcja ${section.name}`} entries={[
          { label: 'Zmień nazwę', icon: <Pencil size={15} />, onSelect: () => setDialog({ kind: 'renameSection', section: section.id, name: section.name }) },
          { label: 'Przesuń wyżej', icon: <ArrowUp size={15} />, disabled: index === 0, onSelect: () => void send(place(index - 1)) },
          { label: 'Przesuń niżej', icon: <ArrowDown size={15} />, disabled: index === all.length - 1, onSelect: () => void send(place(index + 1)) },
          ...(section.kind === 'kanban' ? [{ label: 'Dodaj kolumnę', icon: <Plus size={15} />, onSelect: () => setDialog({ kind: 'newColumn', section: section.id }) }] : []),
          { label: 'Usuń sekcję', icon: <Trash2 size={15} />, danger: true, onSelect: () => setDialog({ kind: 'deleteSection', section: section.id, name: section.name }) },
        ]} />
      </header>
      <QueryEditor id={section.id} text={def.query} onSave={text => saveSection(section.id, text)} />
      {section.error && <p className="fl-error" role="alert">{section.error}</p>}
      {section.kind === 'list'
        ? section.threads.length ? <ThreadList threads={section.threads} registry={data} showProject={data.projects.length > 1 && !def.query.includes(`projekt = ${project}`)} onError={setNotice} onOpen={setThreadId} /> : <p className="fl-empty">Żaden wątek nie pasuje do zapytania.</p>
        : <div className="fl-kanban" style={{ '--fl-columns': Math.max(1, section.columns.length) } as React.CSSProperties}>
          {section.columns.map((column, at) => <section key={column.id} className="fl-column" aria-label={`Kolumna ${column.name}`}>
            <header><i className={`fl-dot fl-st-${stateTone(column.name, data.workflows.some(w => w.states.some(s => s.name === column.name && s.closing)))}`} aria-hidden="true" /><h3>{column.name}</h3><span className="fl-count">{column.total}</span>
              <Menu label={`Kolumna ${column.name}`} entries={[
                { label: 'Zmień nazwę', icon: <Pencil size={15} />, onSelect: () => setDialog({ kind: 'renameColumn', column: column.id, name: column.name }) },
                { label: 'Zapytanie kolumny', icon: <SlidersHorizontal size={15} />, onSelect: () => setEditingColumn(column.id) },
                { label: 'Przesuń w lewo', icon: <ArrowLeft size={15} />, disabled: at === 0, onSelect: () => void send({ action: 'moveColumn', column: column.id, position: at - 1 }) },
                { label: 'Przesuń w prawo', icon: <ArrowRight size={15} />, disabled: at === section.columns.length - 1, onSelect: () => void send({ action: 'moveColumn', column: column.id, position: at + 1 }) },
                { label: 'Usuń kolumnę', icon: <Trash2 size={15} />, danger: true, onSelect: () => setDialog({ kind: 'deleteColumn', column: column.id, name: column.name }) },
              ]} />
            </header>
            <QueryEditor id={column.id} column compact control={{ open: editingColumn === column.id, setOpen: open => setEditingColumn(open ? column.id : null) }} text={def.columns.find(c => c.id === column.id)?.query ?? column.query} onSave={text => saveColumn(column.id, text)} />
            {column.threads.length ? <ul className="fl-cards">{column.threads.map(thread => <ThreadCard key={thread.id} thread={thread} registry={data} onError={setNotice} onOpen={setThreadId} />)}</ul> : <p className="fl-empty">Brak wątków</p>}
          </section>)}
          {section.columns.length === 0 && <p className="fl-empty">Kanban nie ma jeszcze kolumn.</p>}
        </div>}
    </section>;
  };
  const saveSection = async (section: string, query: string) => saveQuery({ action: 'updateSection', section, query });
  const saveColumn = async (column: string, query: string) => saveQuery({ action: 'updateColumn', column, query });
  const saveQuery = async (action: FilaAction): Promise<string | null> => {
    try { await sendFilaAction(action); return null; }
    catch (failure) { return (failure as Error).message; }
  };

  return <div className="fl-app">
    <aside className="fl-sidebar">
      <div className="fl-brand"><Layers3 size={21} aria-hidden="true" /> Fila</div>
      <div role="navigation" aria-label="Nawigacja Fili">
        <div className="fl-nav-head"><h2>Tablice</h2><button type="button" className="fl-icon small" aria-label="Nowa tablica" onClick={() => setDialog({ kind: 'newBoard' })}><Plus size={15} aria-hidden="true" /></button></div>
        {data.boards.map(item => <button key={item.id} type="button" className={`fl-nav-item${item.id === board?.id ? ' active' : ''}`} aria-current={item.id === board?.id ? 'page' : undefined} onClick={() => { setBoardId(item.id); setViewId(null); setDrawer(false); setThreadId(null); }}>
          <Layers3 size={16} aria-hidden="true" /><span>{item.name}</span></button>)}
        <div className="fl-nav-head"><h2>Projekty</h2></div>
        {data.projects.map(item => <button key={item.key} type="button" className="fl-nav-item" disabled={!item.board} onClick={() => { if (item.board) { setBoardId(item.board); setViewId(null); setThreadId(null); } }}>
          <Folder size={16} aria-hidden="true" /><span>{item.name}</span><em>{item.counts.open}</em></button>)}
      </div>
      {onHome && <button type="button" className="fl-text back" onClick={onHome}><ArrowLeft size={15} aria-hidden="true" /> Pulpit</button>}
    </aside>
    <div className="fl-workspace">
      {notice && <p className="fl-notice" role="alert">{notice}<button type="button" aria-label="Zamknij komunikat" onClick={() => setNotice('')}><X size={13} aria-hidden="true" /></button></p>}
      {threadId ? <ThreadPage key={threadId} id={threadId} registry={data} boardName={board?.name ?? 'Tablica'} onOpen={setThreadId} onBack={() => setThreadId(null)} />
        : !board ? <Empty>Nie ma jeszcze żadnej tablicy. Dodaj ją plusem w nawigacji.</Empty> : <>
        <header className="fl-head">
          <div><p className="fl-eyebrow">Tablica</p><h1>{board.name}</h1></div>
          <div className="fl-head-actions">
            <button type="button" className="fl-icon" aria-label="Historia tablicy" aria-pressed={drawer} onClick={() => setDrawer(!drawer)}><History size={19} aria-hidden="true" /></button>
            <Menu label="Tablica" entries={[
              { label: 'Zmień nazwę tablicy', icon: <Pencil size={15} />, onSelect: () => setDialog({ kind: 'renameBoard' }) },
              { label: 'Usuń tablicę', icon: <Trash2 size={15} />, danger: true, onSelect: () => setDialog({ kind: 'deleteBoard' }) },
            ]} />
          </div>
        </header>
        <div className="fl-views" role="tablist" aria-label="Widoki tablicy">
          {board.views.map((item, index) => <div key={item.id} className={`fl-view${item.id === view?.id ? ' active' : ''}`}>
            <button type="button" role="tab" aria-selected={item.id === view?.id} onClick={() => setViewId(item.id)}>{item.name}</button>
            {item.id === view?.id && <Menu label={`Widok ${item.name}`} entries={[
              { label: 'Zmień nazwę', icon: <Pencil size={15} />, onSelect: () => setDialog({ kind: 'renameView', view: item.id, name: item.name }) },
              { label: 'Przesuń w lewo', icon: <ArrowLeft size={15} />, disabled: index === 0, onSelect: () => void send({ action: 'moveView', view: item.id, position: index - 1 }) },
              { label: 'Przesuń w prawo', icon: <ArrowRight size={15} />, disabled: index === board.views.length - 1, onSelect: () => void send({ action: 'moveView', view: item.id, position: index + 1 }) },
              { label: 'Usuń widok', icon: <Trash2 size={15} />, danger: true, disabled: board.views.length === 1, onSelect: () => setDialog({ kind: 'deleteView', view: item.id, name: item.name }) },
            ]} />}
          </div>)}
          <button type="button" className="fl-icon small" aria-label="Nowy widok" onClick={() => setDialog({ kind: 'newView' })}><Plus size={15} aria-hidden="true" /></button>
        </div>
        <div className={`fl-board${drawer ? ' with-drawer' : ''}`}>
          <div className="fl-sections">
            {viewDoc.data?.sections.map(sectionView)}
            {!viewDoc.data && <Empty>{viewDoc.error || 'Ładowanie widoku…'}</Empty>}
            {view && <div className="fl-add-section"><Menu label="Dodaj sekcję" align="left" trigger={<><Plus size={16} aria-hidden="true" /> Dodaj sekcję</>} entries={[
              { label: 'Lista', onSelect: () => setDialog({ kind: 'newSection', sectionKind: 'list' }) }, { label: 'Kanban', onSelect: () => setDialog({ kind: 'newSection', sectionKind: 'kanban' }) },
            ]} /></div>}
          </div>
          {drawer && <aside className="fl-drawer" aria-label="Historia tablicy">
            <header><h2>Historia tablicy</h2><button type="button" className="fl-icon" aria-label="Zamknij historię" onClick={() => setDrawer(false)}><X size={17} aria-hidden="true" /></button></header>
            <ul className="fl-timeline">{[...(boardDoc.data?.history ?? [])].reverse().map((entry, index) => <li key={index}><b>{BY[entry.by] ?? entry.by}</b> {sentence(entry)}<time>{when(entry.at)}</time></li>)}</ul>
          </aside>}
        </div>
      </>}
    </div>
    {dialogView()}
  </div>;
}
