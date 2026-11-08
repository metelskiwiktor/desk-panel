import { useState, type FormEvent } from 'react';
import { Archive, Check, Layers3, Plus, Trash2 } from 'lucide-react';
import type { FilaAction } from '../fila-contract';
import { useFilaActions, useFilaGet, type FilaRegistry, type FilaThreadRow } from './api';
import { ThreadId } from './threads';
import { ConfirmDialog, Dialog, TypeIcon, stateTone } from './ui';

const KIND_LABEL = { text: 'tekst', number: 'liczba', date: 'data', bool: 'tak/nie', multi: 'wiele wartości' } as const;

/** A new project: a name and a four-letter key that never changes and starts every thread ID (D-044 to D-046). */
export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { act, error, clear } = useFilaActions();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const valid = name.trim() !== '' && /^[A-Z]{4}$/.test(key);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (valid && await act({ action: 'createProject', key, name: name.trim() })) onCreated(key);
  };
  return <Dialog title="Nowy projekt" onClose={() => { clear(); onClose(); }}>
    <form onSubmit={event => void send(event)}>
      <div className="fl-dialog-row">
        <label>Nazwa<input value={name} maxLength={80} placeholder="np. Prywatne" onChange={event => setName(event.target.value)} /></label>
        <label>Klucz<input className="fl-key-input" aria-label="Klucz projektu" value={key} maxLength={4} placeholder="PRYW" onChange={event => setKey(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} /></label>
      </div>
      <p className="fl-muted">Klucz ma 4 litery, jest unikalny i nie da się go później zmienić; z niego powstają ID wątków, np. {key.length === 4 ? key : 'PRYW'}-1. Projekt dostaje od razu tablicę ze wszystkimi swoimi wątkami.</p>
      {error && <p className="fl-error" role="alert">{error}</p>}
      <div className="fl-actions"><button type="button" className="fl-text" onClick={() => { clear(); onClose(); }}>Anuluj</button><button type="submit" className="fl-primary" disabled={!valid}>Załóż projekt</button></div>
    </form>
  </Dialog>;
}

/** A new thread: title, project and type, and optionally a parent (D-031). Only here: a board never creates threads (D-072). */
function NewThreadDialog({ registry, project, onClose, onCreated }: { registry: FilaRegistry; project: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { act, error, clear } = useFilaActions();
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState(project);
  const [type, setType] = useState('sprawa');
  const [parent, setParent] = useState('');
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const action = { action: 'createThread', project: chosen, type, title: title.trim(), ...(parent.trim() ? { parent: parent.trim().toUpperCase() } : {}) } as FilaAction;
    const result = await act(action);
    if (result?.thread) onCreated(result.thread.id);
  };
  return <Dialog title="Nowy wątek" onClose={() => { clear(); onClose(); }}>
    <form onSubmit={event => void send(event)}>
      <label>Tytuł<input value={title} maxLength={200} placeholder="Co trzeba zrobić albo zapamiętać" onChange={event => setTitle(event.target.value)} /></label>
      <div className="fl-dialog-row even">
        <label>Projekt<select aria-label="Projekt" value={chosen} onChange={event => setChosen(event.target.value)}>{registry.projects.map(item => <option key={item.key} value={item.key}>{item.name} ({item.key})</option>)}</select></label>
        <label>Typ<select aria-label="Typ" value={type} onChange={event => setType(event.target.value)}>{registry.types.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      </div>
      <label>Rodzic (opcjonalnie)<input aria-label="Rodzic" value={parent} placeholder={`ID wątku, np. ${chosen}-1`} onChange={event => setParent(event.target.value)} /></label>
      {error && <p className="fl-error" role="alert">{error}</p>}
      <div className="fl-actions"><button type="button" className="fl-text" onClick={() => { clear(); onClose(); }}>Anuluj</button><button type="submit" className="fl-primary" disabled={!title.trim()}>Utwórz</button></div>
    </form>
  </Dialog>;
}

/**
 * The project screen (part 3): its key and counts, a new thread, the way to its board, and two tabs: Pola i workflow
 * (read-only, D-033, opens first, D-077) and Archiwum (restore, delete for good only from here, D-037, D-038).
 */
export function ProjectPage({ registry, projectKey, tab, onTab, onOpen, onBoard }: {
  registry: FilaRegistry; projectKey: string; tab: 'pola' | 'archiwum'; onTab: (tab: 'pola' | 'archiwum') => void;
  onOpen: (id: string) => void; onBoard: (board: string) => void;
}) {
  const project = registry.projects.find(item => item.key === projectKey);
  const archived = useFilaGet<{ threads: FilaThreadRow[] }>(`/api/fila/query?q=${encodeURIComponent(`projekt = ${projectKey} AND archiwum = tylko SORTUJ id malejąco`)}`);
  const { act, error, clear } = useFilaActions();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FilaThreadRow | null>(null);
  if (!project) return <p className="fl-muted">Nie ma takiego projektu.</p>;
  const workflows = registry.workflows;
  const closeDelete = () => { setDeleting(null); clear(); };
  return <div className="fl-project">
    <header className="fl-head">
      <div><p className="fl-eyebrow">Projekt</p><h1>{project.name} <span className="fl-key">{project.key}</span></h1></div>
      <div className="fl-head-actions">
        {project.board && <button type="button" className="fl-text" onClick={() => onBoard(project.board!)}><Layers3 size={16} aria-hidden="true" /> Tablica {project.name}</button>}
        <button type="button" className="fl-primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true" /> Nowy wątek</button>
      </div>
    </header>
    <dl className="fl-stats">
      <div><dt>Otwarte</dt><dd>{project.counts.open}</dd></div>
      <div><dt>Zamknięte</dt><dd>{project.counts.closed}</dd></div>
      <div><dt>W archiwum</dt><dd>{project.counts.archived}</dd></div>
    </dl>
    <div className="fl-views" role="tablist" aria-label="Zakładki projektu">
      <div className={`fl-view${tab === 'pola' ? ' active' : ''}`}><button type="button" role="tab" aria-selected={tab === 'pola'} onClick={() => onTab('pola')}>Pola i workflow</button></div>
      <div className={`fl-view${tab === 'archiwum' ? ' active' : ''}`}><button type="button" role="tab" aria-selected={tab === 'archiwum'} onClick={() => onTab('archiwum')}>Archiwum</button></div>
    </div>

    {tab === 'archiwum'
      ? <div role="tabpanel" aria-label="Archiwum">
        {error && !deleting && <p className="fl-error" role="alert">{error}</p>}
        {archived.data
          ? archived.data.threads.length
            ? <ul className="fl-list fl-archive">{archived.data.threads.map(thread => <li key={thread.id} className="fl-row">
              <div className="fl-row-line">
                <TypeIcon type={thread.type} /><ThreadId id={thread.id} onOpen={onOpen} />
                <div className="fl-row-main"><span className="fl-title">{thread.title}</span><span className="fl-archived-by">Stan zostaje: {thread.state}</span></div>
                <div className="fl-row-actions">
                  <button type="button" className="fl-text" aria-label={`Przywróć ${thread.id}`} onClick={() => void act({ action: 'restoreThread', thread: thread.id })}><Archive size={15} aria-hidden="true" /> Przywróć</button>
                  <button type="button" className="fl-icon" aria-label={`Usuń trwale ${thread.id}`} onClick={() => setDeleting(thread)}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              </div>
            </li>)}</ul>
            : <p className="fl-empty">Archiwum jest puste.</p>
          : <p className="fl-muted">{archived.error || 'Ładowanie archiwum…'}</p>}
        <p className="fl-muted fl-settings-note">Zarchiwizowany wątek znika z sekcji, a jego Stan się nie zmienia. Trwale usunąć można go tylko stąd.</p>
      </div>
      : <div className="fl-settings" role="tabpanel" aria-label="Pola i workflow">
        <section className="fl-setting"><h2>Klucz</h2><p><span className="fl-key">{project.key}</span> <span className="fl-muted">ID wątków: {project.key}-1, {project.key}-2…</span></p></section>
        <section className="fl-setting">
          <h2>Moduł <span className="fl-muted">pole wyboru projektu</span></h2>
          {project.modules.length ? <p className="fl-chips">{project.modules.map(module => <span key={module} className="fl-chip static">{module}</span>)}</p> : <p className="fl-muted">Projekt nie używa pola Moduł.</p>}
        </section>
        <section className="fl-setting">
          <h2>Workflow <span className="fl-muted">dostępne dla wątków</span></h2>
          {workflows.map(workflow => <div key={workflow.id} className="fl-workflow"><h3>{workflow.name}</h3>
            <ol>{workflow.states.map(state => <li key={state.name} className={`fl-st-${stateTone(state.name, state.closing)}${state.closing ? ' closing' : ''}`}><i className="fl-dot" />{state.name}{state.closing && <Check size={13} aria-label="zamyka wątek" />}</li>)}</ol>
          </div>)}
        </section>
        <section className="fl-setting">
          <h2>Pola własne <span className="fl-muted">wspólne w całej Fili</span></h2>
          {registry.fieldDefs.length ? <dl className="fl-custom-list">{registry.fieldDefs.map(field => <div key={field.name}><dt>{field.name}</dt><dd>{KIND_LABEL[field.kind]}</dd></div>)}</dl> : <p className="fl-muted">Nie ma jeszcze pól własnych.</p>}
        </section>
        <p className="fl-muted fl-settings-note">Moduł i workflow zmienia AI, np. w Claude Desktop.</p>
      </div>}

    {creating && <NewThreadDialog registry={registry} project={projectKey} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); onOpen(id); }} />}
    {deleting && <ConfirmDialog title={`Usunąć ${deleting.id} na zawsze?`} text={`„${deleting.title}” zniknie razem z historią i rewizjami. Tego nie da się cofnąć.`} confirm="Usuń na zawsze" error={error} onClose={closeDelete}
      onConfirm={() => void act({ action: 'deleteThread', thread: deleting.id }).then(result => { if (result) setDeleting(null); })} />}
  </div>;
}
