import { Bike, Check } from 'lucide-react';
import type { Detail } from './model';
import { LevelBars } from './TrainingCard';
import { formatClock } from './training-view';
import type { WeekDay, WeekItem } from './week';

const MAX_ITEMS = 3;
const stateTitle: Partial<Record<NonNullable<WeekItem['state']>, string>> = { done: 'wykonany', partial: 'częściowo', missed: 'nie zrobiony' };

function Item({ item, open }: { item: WeekItem; open: (d: Detail) => void }) {
  const w = item.workout;
  const label = `${item.title}${item.at ? `, ${item.at}` : ''}${item.state && stateTitle[item.state] ? `, ${stateTitle[item.state]}` : ''}`;
  return <button className={`p2-item ${item.kind} ${item.state ?? ''}`} aria-label={label} onClick={() => open(w ? { kind: 'workout', id: item.id } : { kind: 'event', id: item.id })}>
    <span className="p2-item-line">
      <i className="p2-mark" />
      <span className="p2-item-title">{item.title}</span>
      {item.state === 'done' ? <Check size={15} className="p2-item-check" />
        : <span className="p2-item-time">{item.at ?? (w?.durationSec ? formatClock(w.durationSec) : '')}</span>}
    </span>
    {w && <span className="p2-item-sub"><Bike size={13} /><LevelBars phrase={w.phrase} /></span>}
  </button>;
}

/** Seven days from today: what is planned each day, training and calendar together. */
export function WeekStrip({ days, known, open }: { days: WeekDay[]; known: boolean; open: (d: Detail) => void }) {
  return <section className="p2-week" aria-label="Najbliższe dni">
    <ol>
      {days.map(day => {
        const shown = day.items.slice(0, MAX_ITEMS - (day.items.length > MAX_ITEMS ? 1 : 0));
        const hidden = day.items.length - shown.length;
        return <li key={day.date} className={`p2-weekday ${day.today ? 'today' : ''}`}>
          <div className="p2-weekday-head"><b>{day.label}</b><span>{day.dayOfMonth}{day.today ? ' · dziś' : ''}</span></div>
          {shown.map(item => <Item key={`${item.kind}:${item.id}`} item={item} open={open} />)}
          {hidden > 0 && <span className="p2-more">+{hidden} więcej</span>}
          {!day.items.length && <span className="p2-free">{known ? 'wolne' : '—'}</span>}
        </li>;
      })}
    </ol>
  </section>;
}
