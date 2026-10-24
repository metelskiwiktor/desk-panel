import { useCallback, useEffect, useRef, useState } from 'react';
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
export const EVENTS_SEEN_KEY = 'desk-panel.events-seen';
/** "1 nowe", "3 nowe", "5 nowych". */
export const nowe = (n: number) => n === 1 || (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'nowe' : 'nowych';

/**
 * When the list was last open, kept in the browser: what was detected after that is new. A first run starts from now,
 * so what is already in the list is not news.
 */
function useSeenAt() {
  const [seenAt, setSeenAt] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(EVENTS_SEEN_KEY));
      if (Number.isFinite(stored) && stored > 0) return stored;
      const start = Date.now();
      localStorage.setItem(EVENTS_SEEN_KEY, String(start));
      return start;
    } catch { return Date.now(); }
  });
  const markSeen = useCallback((upTo: number) => {
    const at = Math.max(Date.now(), upTo);
    setSeenAt(at);
    try { localStorage.setItem(EVENTS_SEEN_KEY, String(at)); } catch { /* the mark then lasts until reload */ }
  }, []);
  return { seenAt, markSeen };
}

function ActivityRow({ entry, fresh, open, dismiss }: {
  entry: ActivityEntry; fresh: boolean; open: (target: Detail) => void; dismiss: (entry: ActivityEntry) => void;
}) {
  const { offset, handlers, isTap } = useSwipe(() => dismiss(entry));
  return <li className={`activity-swipe ${offset ? 'dragging' : ''}`}>
    <span className="activity-swipe-hint" aria-hidden="true"><Trash2 size={18} /> Usuń</span>
    <div className="activity-row" style={{ transform: `translateX(${offset}px)` }}>
      <button className={`p2-erow ${entry.tone} ${fresh ? 'new' : ''}`} {...handlers} aria-label={`${sourceOf(entry)}: ${entry.title}`} onClick={event => { if (isTap(event)) open(entry.target); }}>
        <i className="p2-edot" aria-hidden="true" />
        <span className="p2-erow-body">
          <span className="p2-erow-top"><SourceTag entry={entry} />{fresh && <span className="p2-erow-new">nowe</span>}<span className="p2-erow-time">{preciseStamp(entry.detectedAt)}</span></span>
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
 * Panel events: a bell with the total that is always in the top bar (a zero is a calm answer, not a missing icon).
 * What was detected since the list was last open is announced on the bell: a "+N" badge and a small hop now and then.
 * The list opens only when asked, under the bell, with the new entries marked; an empty one says so.
 */
export function ActivityFeed({ entries, open, dismiss, restore, canUndo, storageError, showRules }: {
  entries: ActivityEntry[]; open: (target: Detail) => void; showRules: () => void;
  dismiss: (entry: ActivityEntry) => void; restore: () => void; canUndo: boolean; storageError: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { seenAt, markSeen } = useSeenAt();
  // What counted as new when the list was opened stays marked in it until it is closed.
  const [baseline, setBaseline] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const top = entries[0];
  // Open, everything in the list is being seen, including what arrives meanwhile.
  useEffect(() => { if (expanded) markSeen(top?.detectedAt ?? 0); }, [expanded, top?.id, top?.detectedAt, markSeen]);
  const toggle = (next: boolean) => { setBaseline(next ? seenAt : null); setExpanded(next); };
  useDismiss(expanded, () => toggle(false), root);
  const fresh = expanded ? 0 : entries.filter(e => e.detectedAt > seenAt).length;
  const label = `Zdarzenia panelu: ${entries.length}${fresh ? `, ${nowe(fresh)}: ${fresh}` : ''}${top ? `, najnowsze: ${top.title}` : ''}`;
  return <div className="events-root" ref={root}>
    <button className={`events-icon ${fresh ? 'fresh' : ''}`} aria-expanded={expanded} aria-label={label} onClick={() => toggle(!expanded)}>
      {entries.length ? <Bell size={20} /> : <BellOff size={20} />}
      <span className="events-count">{entries.length}</span>
      {fresh > 0 && <span className="events-new" aria-hidden="true" title={`${fresh} ${nowe(fresh)}`}>+{fresh}</span>}
    </button>
    {expanded && <section className="events-panel" aria-labelledby="events-title">
      <div className="events-head">
        <h2 id="events-title">Zdarzenia panelu</h2>
        {baseline !== null && entries.some(e => e.detectedAt > baseline) && <span className="events-total fresh">{entries.filter(e => e.detectedAt > baseline).length} {nowe(entries.filter(e => e.detectedAt > baseline).length)}</span>}
        <span className="events-total">{entries.length} łącznie</span>
        <button className="events-close" aria-label="Zwiń zdarzenia panelu" aria-expanded="true" onClick={() => toggle(false)}><X size={18} /></button>
      </div>
      {entries.length > 0
        ? <ul className="activity-list events-list" aria-label="Lista zdarzeń">
          {entries.map(entry => <ActivityRow key={entry.id} entry={entry} fresh={baseline !== null && entry.detectedAt > baseline} open={open} dismiss={dismiss} />)}
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
