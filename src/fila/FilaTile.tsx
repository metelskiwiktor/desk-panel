import { useEffect, useState, type FormEvent } from 'react';
import { ListChecks, Pencil } from 'lucide-react';
import type { TileConfig } from '../tile-grid';
import { checkFilaQuery, useFilaGet, useFilaRegistry, type FilaThreadRow } from './api';
import { ThreadList } from './threads';
import { Menu } from './ui';

/** What one Zadania tile on Fila remembers: the one query it shows, as text (D-063). Without it the tile asks to be configured. */
export const filaQueryOf = (config: TileConfig | undefined) => typeof config?.query === 'string' ? config.query.trim() : '';

function QueryForm({ initial, onSave, onCancel }: { initial: string; onSave: (query: string) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.trim()) { setProblem(null); return; }
    let live = true;
    const timer = setTimeout(() => void checkFilaQuery(draft, false).then(result => { if (live) setProblem(result); }), 250);
    return () => { live = false; clearTimeout(timer); };
  }, [draft]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (draft.trim() && !problem) onSave(draft.trim()); };
  return <form className="fl-tile-config" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape' && onCancel) { event.stopPropagation(); onCancel(); } }}>
    <label>Zapytanie kafelka<textarea aria-label="Zapytanie kafelka" aria-invalid={!!problem} rows={3} spellCheck={false} placeholder='projekt = DESK AND otwarte SORTUJ stan, id' value={draft} onChange={event => setDraft(event.target.value)} autoFocus /></label>
    {problem && <p className="fl-error" role="alert">{problem}</p>}
    <div className="fl-actions">
      {onCancel && <button type="button" className="fl-text" onClick={onCancel}>Anuluj</button>}
      <button type="submit" className="fl-primary small" disabled={!draft.trim() || !!problem}>Zapisz zapytanie</button>
    </div>
  </form>;
}

/**
 * The Zadania tile on threads (1.5): the results of one query written as text in the tile's own configuration. There is no
 * default query. Stan changes from here like on the board; opening a thread waits for the thread page (part 2).
 */
export function FilaTile({ config, setConfig, wide = true }: { config?: TileConfig; setConfig: (patch: Record<string, string | undefined>) => void; wide?: boolean }) {
  const registry = useFilaRegistry();
  const query = filaQueryOf(config);
  const result = useFilaGet<{ query: string; total: number; threads: FilaThreadRow[] }>(query ? `/api/fila/query?q=${encodeURIComponent(query)}` : null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const configure = !query || editing;
  return <section className="p2-card fl-tile" aria-label="Zadania">
    <div className="p2-card-head static fl-tile-head">
      <ListChecks size={18} aria-hidden="true" /><h2>Zadania</h2>
      {result.data && !configure && <span className="p2-meta" title="Wyniki zapytania">{result.data.total}</span>}
      {query && !configure && <Menu label="Kafelek Zadania" entries={[{ label: 'Zmień zapytanie', icon: <Pencil size={15} />, onSelect: () => setEditing(true) }]} />}
    </div>
    {notice && <p className="fl-notice" role="alert">{notice}</p>}
    {configure
      ? <div className="fl-tile-empty">
        {!query && <p className="p2-empty">Kafelek nie ma zapytania. Wpisz je, żeby zobaczyć wątki.</p>}
        <QueryForm initial={query} onSave={text => { setConfig({ query: text }); setEditing(false); }} onCancel={query ? () => setEditing(false) : undefined} />
      </div>
      : result.error ? <p className="p2-note warn" role="alert">{result.error}</p>
        : result.data && registry.data
          ? result.data.threads.length ? <ThreadList threads={result.data.threads} registry={registry.data} compact={!wide} showProject onError={setNotice} /> : <p className="p2-empty">Żaden wątek nie pasuje do zapytania.</p>
          : <p className="p2-empty">Ładowanie wątków…</p>}
  </section>;
}
