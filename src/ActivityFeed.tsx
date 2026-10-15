import { useRef, useState, type PointerEvent } from 'react';
import { ChevronRight, Sparkles, Trash2, X } from 'lucide-react';
import { Card, Empty } from './components';
import { preciseStamp } from './format';
import type { ActivityEntry } from './activity-log';
import type { Detail } from './model';

function ActivityRow({ entry, open, dismiss }: {
  entry: ActivityEntry; open: (target: Detail) => void; dismiss: (entry: ActivityEntry) => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; axis?: 'x' | 'y' } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (drag.axis === 'x') { suppressClick.current = true; setOffset(dx); }
    else if (drag.axis === 'y') suppressClick.current = true;
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const distance = Math.abs(event.clientX - drag.x);
    const threshold = Math.max(64, Math.min(110, event.currentTarget.clientWidth * 0.25));
    gesture.current = null;
    setOffset(0);
    if (drag.axis === 'x' && distance >= threshold) dismiss(entry);
  };
  return <li className={`activity-swipe ${offset ? 'dragging' : ''}`}>
    <span className="activity-swipe-hint" aria-hidden="true"><Trash2 size={18} /> Usuń</span>
    <div className="activity-row" style={{ transform: `translateX(${offset}px)` }}>
      <button className={`insight row ${entry.tone}`} onPointerDown={start} onPointerMove={move} onPointerUp={end}
        onPointerCancel={() => { gesture.current = null; setOffset(0); }}
        onClick={event => { if (event.detail === 0 || !suppressClick.current) open(entry.target); }}>
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
