import { ChevronRight, Sparkles, Trash2, X } from 'lucide-react';
import { Card, Empty } from './components';
import { preciseStamp } from './format';
import type { ActivityEntry } from './activity-log';
import type { Detail } from './model';
import { useSwipe } from './useSwipe';

function ActivityRow({ entry, open, dismiss }: {
  entry: ActivityEntry; open: (target: Detail) => void; dismiss: (entry: ActivityEntry) => void;
}) {
  const { offset, handlers, isTap } = useSwipe(() => dismiss(entry));
  return <li className={`activity-swipe ${offset ? 'dragging' : ''}`}>
    <span className="activity-swipe-hint" aria-hidden="true"><Trash2 size={18} /> Usuń</span>
    <div className="activity-row" style={{ transform: `translateX(${offset}px)` }}>
      <button className={`insight row ${entry.tone}`} {...handlers} onClick={event => { if (isTap(event)) open(entry.target); }}>
        <span className="insight-dot" />
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

export function ActivityFeed({ entries, open, dismiss, restore, canUndo, storageError }: {
  entries: ActivityEntry[]; open: (target: Detail) => void;
  dismiss: (entry: ActivityEntry) => void; restore: () => void; canUndo: boolean; storageError: boolean;
}) {
  return <Card title="Zdarzenia" eyebrow="OSTATNIO WYKRYTE" icon={<Sparkles size={21} />}>
    <p className="card-intro">Zdarzenia wykryte podczas działania panelu. Przesuń wpis w bok, aby usunąć.</p>
    {entries.length ? <ul className="activity-list" aria-label="Lista zdarzeń">
      {entries.map(entry => <ActivityRow key={entry.id} entry={entry} open={open} dismiss={dismiss} />)}
    </ul> : <Empty>Brak zapisanych zdarzeń.</Empty>}
    <div className="activity-undo" role="status">{canUndo && <><span>Usunięto zdarzenie.</span><button className="button" onClick={restore}>Cofnij</button></>}</div>
    {storageError && <p className="source-note warning">Nie udało się zapisać zdarzeń. Lista działa w tej sesji.</p>}
  </Card>;
}
