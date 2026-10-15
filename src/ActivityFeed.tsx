import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, ChevronUp, Trash2, X } from 'lucide-react';
import { preciseStamp } from './format';
import type { ActivityEntry } from './activity-log';
import type { Detail } from './model';
import { useSwipe } from './useSwipe';

/** Every panel event names the source it comes from, so it never reads as an e-mail. */
const sources: Record<ActivityEntry['target']['kind'], string> = { event: 'Kalendarz', task: 'Cezar', quota: 'Limity AI', system: 'Komputer' };
export const sourceOf = (entry: ActivityEntry) => sources[entry.target.kind];
const SourceTag = ({ entry }: { entry: ActivityEntry }) => <span className={`source-tag source-${entry.target.kind}`}>{sourceOf(entry)}</span>;
/** A new event opens the list for this long, then it folds back to the pill. */
export const EVENTS_AUTO_COLLAPSE_MS = 10_000;
/** Events found by the first reads after opening the panel are not news: they stay folded. */
export const EVENTS_SETTLE_MS = 5_000;

function ActivityRow({ entry, open, dismiss }: {
  entry: ActivityEntry; open: (target: Detail) => void; dismiss: (entry: ActivityEntry) => void;
}) {
  const { offset, handlers, isTap } = useSwipe(() => dismiss(entry));
  return <li className={`activity-swipe ${offset ? 'dragging' : ''}`}>
    <span className="activity-swipe-hint" aria-hidden="true"><Trash2 size={18} /> Usuń</span>
    <div className="activity-row" style={{ transform: `translateX(${offset}px)` }}>
      <button className={`insight row ${entry.tone}`} {...handlers} aria-label={`${sourceOf(entry)}: ${entry.title}`} onClick={event => { if (isTap(event)) open(entry.target); }}>
        <SourceTag entry={entry} />
        <span className="row-body">
          <span className="row-title">{entry.title}</span>
          <span className="meta">{entry.context}</span>
          <span className="meta activity-time">Wykryto {preciseStamp(entry.detectedAt)}</span>
        </span>
        <ChevronRight size={16} />
      </button>
      <button className="activity-remove" aria-label={`Usuń zdarzenie: ${entry.title}`} onClick={() => dismiss(entry)}><X size={17} /></button>
    </div>
  </li>;
}

/** Panel events float over the dashboard: a pill with the newest one, or the whole list when opened. */
export function ActivityFeed({ entries, open, dismiss, restore, canUndo, storageError }: {
  entries: ActivityEntry[]; open: (target: Detail) => void;
  dismiss: (entry: ActivityEntry) => void; restore: () => void; canUndo: boolean; storageError: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = entries[0]?.id;
  const seen = useRef(latest);
  const mountedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!latest || latest === seen.current) return;
    seen.current = latest;
    if (Date.now() - mountedAt.current < EVENTS_SETTLE_MS) return;
    setExpanded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setExpanded(false), EVENTS_AUTO_COLLAPSE_MS);
  }, [latest]);
  const toggle = (next: boolean) => { clearTimeout(timer.current); setExpanded(next); };
  if (!entries.length && !canUndo && !storageError) return null;
  const top = entries[0];
  if (!expanded && top) return <button className="events-pill" aria-expanded="false" aria-label={`Zdarzenia panelu: ${entries.length}, najnowsze: ${top.title}`} onClick={() => toggle(true)}>
    <span className="events-bell"><Bell size={16} /><span className="events-count">{entries.length}</span></span>
    <SourceTag entry={top} />
    <span className="events-pill-title">{top.title}</span>
    <ChevronDown size={16} />
  </button>;
  return <section className="events-panel" aria-labelledby="events-title">
    <div className="events-head">
      <h2 id="events-title"><Bell size={16} /> Zdarzenia panelu</h2>
      {top && <button className="icon-button" aria-label="Zwiń zdarzenia panelu" aria-expanded="true" onClick={() => toggle(false)}><ChevronUp size={18} /></button>}
    </div>
    {entries.length > 0 && <ul className="activity-list events-list" aria-label="Lista zdarzeń">
      {entries.map(entry => <ActivityRow key={entry.id} entry={entry} open={open} dismiss={dismiss} />)}
    </ul>}
    <div className="activity-undo" role="status">{canUndo
      ? <><span>Usunięto zdarzenie.</span><button className="button" onClick={restore}>Cofnij</button></>
      : <span className="meta">Przesuń wpis w bok, aby usunąć.</span>}</div>
    {storageError && <p className="source-note warning">Nie udało się zapisać zdarzeń. Lista działa w tej sesji.</p>}
  </section>;
}
