import { Bike, CalendarDays, Check, Clock } from 'lucide-react';
import type { Detail } from './model';
import { LevelBars } from './TrainingCard';
import { formatDuration } from './training-view';
import type { WeekDay, WeekItem } from './week';
import { dayText, dayTitle } from './week';
import { ctx } from './chat-context';

const MAX_ITEMS = 3;
const stateTitle: Partial<Record<NonNullable<WeekItem['state']>, string>> = { done: 'wykonany', partial: 'częściowo', missed: 'nie zrobiony' };

/** What the agent is told when a day is pointed at: its date and what is planned in it. */
function dayContext(day: WeekDay) {
  return ctx('tile', `day:${day.date}`, `Dzień: ${dayTitle(day)}`, dayText(day));
}
/** A workout or a meeting inside a day: pointed at on its own, it wins over the day. */
function itemContext(item: WeekItem) {
  return item.workout
    ? ctx('workout', item.id, item.title, [`Trening: ${item.title}`, item.workout.durationSec ? `Czas: ${formatDuration(item.workout.durationSec)}` : ''].filter(Boolean).join('\n'))
    : ctx('event', item.id, item.title, `${item.title}\n${item.at ? `Godzina: ${item.at}` : 'Cały dzień'}`);
}

function Item({ item, open }: { item: WeekItem; open: (d: Detail) => void }) {
  const w = item.workout;
  const label = `${item.title}${item.at ? `, ${item.at}` : ''}${item.state && stateTitle[item.state] ? `, ${stateTitle[item.state]}` : ''}`;
  return <button className={`p2-item ${item.kind} ${item.state ?? ''}`} aria-label={label} {...itemContext(item)} onClick={() => open(w ? { kind: 'workout', id: item.id } : { kind: 'event', id: item.id })}>
    <span className="p2-item-meta">
      {w ? <>
        {item.state === 'done' ? <Check size={14} /> : <Bike size={14} />}
        {w.durationSec ? <span>{formatDuration(w.durationSec)}</span> : null}
        <LevelBars phrase={w.phrase} />
      </> : item.at ? <><Clock size={14} /><span>{item.at}</span></> : <><CalendarDays size={14} /><span>cały dzień</span></>}
    </span>
    <span className="p2-item-title">{item.title}</span>
  </button>;
}

interface Zone { days: WeekDay[]; known: boolean; selected: string; select: (date: string) => void; open: (d: Detail) => void }

/** Seven days from today: what is planned each day, training and calendar together. The head of a day selects it; a day with nothing planned shrinks to its head so the others get its room. */
export function WeekStrip({ days, known, selected, select, open }: Zone) {
  const columns = days.map(day => known && !day.items.length ? '48px' : 'minmax(0, 1fr)').join(' ');
  return <ol className="p2-week-list" style={{ gridTemplateColumns: columns }}>
    {days.map(day => {
      const shown = day.items.slice(0, MAX_ITEMS - (day.items.length > MAX_ITEMS ? 1 : 0));
      const hidden = day.items.length - shown.length;
      return <li key={day.date} {...dayContext(day)} className={`p2-weekday ${day.today ? 'today' : ''} ${day.date === selected ? 'selected' : ''} ${known && !day.items.length ? 'free' : ''} ${day.items.length >= MAX_ITEMS ? 'crowded' : ''}`}>
        <button className="p2-weekday-head" aria-label={`Pokaż dzień: ${dayTitle(day)}`} aria-pressed={day.date === selected} onClick={() => select(day.date)}>
          <b>{day.label}</b><span>{day.dayOfMonth}{day.today && day.items.length ? ' · dziś' : ''}</span>
        </button>
        {shown.map(item => <Item key={`${item.kind}:${item.id}`} item={item} open={open} />)}
        {hidden > 0 && <span className="p2-more">+{hidden} więcej</span>}
        {!day.items.length && !known && <span className="p2-free">—</span>}
      </li>;
    })}
  </ol>;
}

/** The shortest week: a label and a dot per workout or meeting; a tap selects the day. */
export function WeekChips({ days, known, selected, select }: Zone) {
  return <ol className="p2-week-list chips">
    {days.map(day => {
      const trainings = day.items.filter(i => i.workout).length;
      const events = day.items.length - trainings;
      return <li key={day.date} {...dayContext(day)} className={`${day.today ? 'today' : ''} ${day.date === selected ? 'selected' : ''}`}>
        <button className="p3-daychip" aria-label={`Pokaż dzień: ${dayTitle(day)}${day.items.length ? `, ${day.items.length} pozycji` : ''}`} aria-pressed={day.date === selected} onClick={() => select(day.date)}>
          <b>{day.label}</b><span>{day.dayOfMonth}</span>
          <span className="p3-dots" aria-hidden="true">
            {Array.from({ length: Math.min(trainings, 3) }, (_, i) => <i key={`t${i}`} className="train" />)}
            {Array.from({ length: Math.min(events, 3) }, (_, i) => <i key={`e${i}`} className="event" />)}
            {!day.items.length && <em>{known ? '' : '—'}</em>}
          </span>
        </button>
      </li>;
    })}
  </ol>;
}

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];

/** Five weeks from this week's Monday; every cell selects its day. */
export function MonthGrid({ days, known, selected, select }: Zone) {
  return <div className="p3-month">
    <div className="p3-month-head" aria-hidden="true">{WEEKDAYS.map(d => <span key={d}>{d}</span>)}</div>
    <ol className="p3-month-grid">
      {days.map(day => {
        const shown = day.items.slice(0, 2), hidden = day.items.length - shown.length;
        return <li key={day.date} {...dayContext(day)} className={`${day.today ? 'today' : ''} ${day.past ? 'past' : ''} ${day.date === selected ? 'selected' : ''}`}>
          <button aria-label={`Pokaż dzień: ${dayTitle(day)}${day.items.length ? `, ${day.items.length} pozycji` : ''}`} aria-pressed={day.date === selected} onClick={() => select(day.date)}>
            <b>{day.dayOfMonth}</b>
            {shown.map(item => <span key={`${item.kind}:${item.id}`} className={`p3-cell-item ${item.workout ? 'train' : 'event'}`}><i />{item.title}</span>)}
            {hidden > 0 && <span className="p3-cell-more">+{hidden}</span>}
            {!day.items.length && !day.past && !known && <span className="p3-cell-more">—</span>}
          </button>
        </li>;
      })}
    </ol>
  </div>;
}
