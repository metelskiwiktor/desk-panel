import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, ChevronRight, Trash2, X } from 'lucide-react';
import { preciseStamp } from './format';
import type { ActivityEntry } from './activity-log';
import type { Detail } from './model';
import { useSwipe } from './useSwipe';
import { useDismiss } from './popover';

/** Every panel event names the source it comes from, so it never reads as an e-mail. */
const sources: Record<ActivityEntry['target']['kind'], string> = { event: 'Kalendarz', task: 'Cezar', quota: 'Limity AI', system: 'Komputer' };
export const sourceOf = (entry: ActivityEntry) => sources[entry.target.kind];
const SourceTag = ({ entry }: { entry: ActivityEntry }) => <span className={`source-tag source-${entry.target.kind}`}>{sourceOf(entry)}</span>;
/** A new event opens the list for this long, then it folds back to the bell. */
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
      <button className={`p2-erow ${entry.tone}`} {...handlers} aria-label={`${sourceOf(entry)}: ${entry.title}`} onClick={event => { if (isTap(event)) open(entry.target); }}>
        <i className="p2-edot" aria-hidden="true" />
        <span className="p2-erow-body">
          <span className="p2-erow-top"><SourceTag entry={entry} /><span className="p2-erow-time">{preciseStamp(entry.detectedAt)}</span></span>
          <strong>{entry.title}</strong>
          <span className="p2-erow-context">{entry.context}</span>
        </span>
      </button>
      {/* Touch works by swipe only; this stays for keyboard and screen readers, out of sight. */}
      <button className="activity-remove mail-action-hidden" aria-label={`Usuń zdarzenie: ${entry.title}`} onClick={() => dismiss(entry)}><X size={17} /></button>
    </div>
  </li>;
}

/**
 * Panel events: a bell with the count that is always in the top bar (a zero is a calm answer, not a missing icon).
 * It opens a list under itself, or an empty note; a new event opens it on its own for a few seconds.
 */
export function ActivityFeed({ entries, open, dismiss, restore, canUndo, storageError, showRules }: {
  entries: ActivityEntry[]; open: (target: Detail) => void; showRules: () => void;
  dismiss: (entry: ActivityEntry) => void; restore: () => void; canUndo: boolean; storageError: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = entries[0]?.id;
  const seen = useRef(latest);
  const mountedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
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
  useDismiss(expanded, () => toggle(false), root);
  const top = entries[0];
  const label = `Zdarzenia panelu: ${entries.length}${top ? `, najnowsze: ${top.title}` : ''}`;
  return <div className="events-root" ref={root}>
    <button className={`events-icon ${entries.length ? 'has' : ''}`} aria-expanded={expanded} aria-label={label} onClick={() => toggle(!expanded)}>
      {entries.length ? <Bell size={20} /> : <BellOff size={20} />}
      <span className="events-count">{entries.length}</span>
    </button>
    {expanded && <section className="events-panel" aria-labelledby="events-title">
      <div className="events-head">
        <h2 id="events-title">Zdarzenia panelu</h2>
        <span className="events-total">{entries.length}</span>
        <button className="events-close" aria-label="Zwiń zdarzenia panelu" aria-expanded="true" onClick={() => toggle(false)}><X size={18} /></button>
      </div>
      {entries.length > 0
        ? <ul className="activity-list events-list" aria-label="Lista zdarzeń">
          {entries.map(entry => <ActivityRow key={entry.id} entry={entry} open={open} dismiss={dismiss} />)}
        </ul>
        : <div className="events-empty"><BellOff size={28} aria-hidden="true" /><strong>Brak zdarzeń</strong><span>Panel nie wykrył niczego nowego.</span></div>}
      <div className="events-foot" role="status">
        {canUndo
          ? <><span>Usunięto zdarzenie.</span><button onClick={restore}>Cofnij</button></>
          : entries.length > 0 ? <span className="p2-hint">Przesuń wpis w bok, aby usunąć.</span> : <span />}
        <button className="events-rules" onClick={() => { toggle(false); showRules(); }}>Zasady zdarzeń <ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      {storageError && <p className="p2-note warn">Nie udało się zapisać zdarzeń. Lista działa w tej sesji.</p>}
    </section>}
  </div>;
}
