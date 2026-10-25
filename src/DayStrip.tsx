import { Bike, Check } from 'lucide-react';
import type { Detail } from './model';
import { countdown } from './day-ribbon';
import { LevelBars, progressLabel, sportName } from './TrainingCard';
import { trainingLevel, trainingLevelNames, type TrainingActivity } from './training-contract';
import { workoutProgress, type WorkoutProgress } from './training-progress';
import { formatDuration, profileBars } from './training-view';
import { SHORT_DAYS, type WeekItem } from './week';
import { SizeGrip } from './SizeGrip';
import { ctx } from './chat-context';
import { TOP_HEIGHTS, TOP_SIZES, type TopSize } from './zones';

const parts = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`);
  const format = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString('pl-PL', { ...options, timeZone: 'UTC' });
  return { weekday: SHORT_DAYS[day.getUTCDay()], long: format({ weekday: 'long', day: 'numeric', month: 'long' }), month: format({ month: 'short' }).replace('.', '') };
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const relative = (offset: number) => offset === 0 ? 'dziś' : offset === 1 ? 'jutro' : offset === 2 ? 'pojutrze' : null;

function Profile({ item }: { item: WeekItem }) {
  const steps = item.workout?.steps;
  if (!steps) return null;
  const bars = profileBars(steps);
  return <span className="p3-mini" aria-hidden="true">{bars.map((b, i) => <i key={i} className={b.kind} style={{ width: `${b.width}%`, height: `${Math.max(b.height, 18)}%` }} />)}</span>;
}

/** How much of the planned workout was ridden, or the shape of the steps while it is still ahead. */
function TrainingSide({ item, progress }: { item: WeekItem; progress: WorkoutProgress }) {
  const w = item.workout!;
  if (progress.state === 'done' || progress.state === 'partial')
    return <span className="p3-prog">
      <b>{formatDuration(progress.doneSec)}</b>
      <small>{progress.state === 'partial' && w.durationSec ? `z ${formatDuration(w.durationSec)}` : 'zrobione'}</small>
      <i><u style={{ width: `${Math.min(100, Math.round((progress.ratio ?? 1) * 100))}%` }} /></i>
    </span>;
  return <Profile item={item} />;
}

/** The day's workout in full: what, how long, how hard, how it goes and how far it got. */
function TrainingTile({ item, activities, now, timeZone, open }: { item: WeekItem; activities: TrainingActivity[]; now: number; timeZone: string; open: (d: Detail) => void }) {
  const w = item.workout!;
  const progress = workoutProgress(w, activities, now, timeZone);
  const level = trainingLevel(w.phrase);
  const meta = [sportName(w.sport), w.durationSec ? formatDuration(w.durationSec) : null].filter(Boolean).join(' · ');
  const context = ctx('workout', w.id, w.name, [`Trening: ${w.name}`, meta, level ? `Poziom: ${trainingLevelNames[level]}` : '', w.trainingEffect ? `Efekt treningowy: ${w.trainingEffect}` : '', w.keyWorkout ? 'Trening kluczowy' : '', `Stan: ${progressLabel(w, progress)}`].filter(Boolean).join('\n'));
  return <button className={`p3-train ${progress.state}`} {...context} onClick={() => open({ kind: 'workout', id: w.id })} aria-label={`Trening: ${w.name}, ${meta}, ${progressLabel(w, progress)}`}>
    <span className="p3-train-mark">{progress.state === 'done' ? <Check size={22} aria-hidden="true" /> : <Bike size={22} aria-hidden="true" />}</span>
    <span className="p3-train-main">
      <strong>{w.name}{w.keyWorkout && <em>kluczowy</em>}</strong>
      <span>{meta}</span>
      <span className="p3-train-level"><LevelBars phrase={w.phrase} />{level ? trainingLevelNames[level] : ''}{w.trainingEffect ? ` · efekt ${w.trainingEffect.toLocaleString('pl-PL')}` : ''}</span>
    </span>
    <TrainingSide item={item} progress={progress} />
  </button>;
}

/** One chip of the compact strip: a workout or a meeting. */
function Chip({ item, activities, now, timeZone, open }: { item: WeekItem; activities: TrainingActivity[]; now: number; timeZone: string; open: (d: Detail) => void }) {
  const w = item.workout;
  if (w) {
    const progress = workoutProgress(w, activities, now, timeZone);
    const meta = [w.durationSec ? formatDuration(w.durationSec) : null, progress.state === 'partial' || progress.state === 'done' ? progressLabel(w, progress) : null].filter(Boolean).join(' · ');
    return <button className={`p3-chip train ${progress.state}`} {...ctx('workout', w.id, w.name, [`Trening: ${w.name}`, meta].filter(Boolean).join('\n'))} onClick={() => open({ kind: 'workout', id: w.id })} aria-label={`Trening: ${w.name}${meta ? `, ${meta}` : ''}`}>
      {progress.state === 'done' ? <Check size={16} aria-hidden="true" /> : <Bike size={16} aria-hidden="true" />}
      <span className="p3-chip-text"><strong>{w.name}</strong></span>
      <LevelBars phrase={w.phrase} />
    </button>;
  }
  const allDay = item.kind === 'allDay';
  return <button className="p3-chip event" {...ctx('event', item.id, item.title, `${item.title}\n${item.at ? `Godzina: ${item.at}` : 'Cały dzień'}`)} onClick={() => open({ kind: 'event', id: item.id })} aria-label={`${item.title}${item.at ? `, ${item.at}` : ', cały dzień'}`}>
    <i className="p3-dot" aria-hidden="true" />
    <span className="p3-chip-text"><strong>{item.title}</strong></span>
    {!allDay && <small>{item.at}</small>}
  </button>;
}

export interface NextMeeting { id: string; ongoing: boolean; ms: number; /** Starts within 15 minutes, or is on. */ soon: boolean }
export interface DayStripProps {
  date: string; today: string; size: TopSize; now: number; timeZone: string;
  items: WeekItem[]; activities: TrainingActivity[];
  /** Today only: the meeting that is on or the next one, for the countdown. */
  next: NextMeeting | null;
  yesterday: { id: string; label: string; badge: string }[];
  /** A source that is down or stale, said in a few words. */
  notice: string | null;
  known: boolean;
  /** A tap on the grip steps to the next size; a drag settles on the nearest. */
  cycle: () => void; resize: (size: TopSize) => void; preview: (size: TopSize | null) => void; open: (d: Detail) => void; showCalendar: () => void;
}

const MEETING_ROWS = 3;
// The key keeps one grip across the three looks of the strip, so a drag survives the strip changing under it.
const topGrip = (p: DayStripProps) => <SizeGrip key="grip" label="Zmień rozmiar paska dnia" edge="bottom" order={TOP_SIZES} current={p.size} heights={() => TOP_HEIGHTS} cssVar="--p3-top" onChange={p.resize} onPreview={p.preview} onTap={p.cycle} />;

/**
 * The top zone: one day, the selected one, from a tap on the days below. A date tile, the workout in full and the
 * meetings as a list; a line of chips when the strip is shrunk.
 */
export function DayStrip(p: DayStripProps) {
  const offset = daysBetween(p.today, p.date);
  const isToday = offset === 0;
  const { weekday, long, month } = parts(p.date);
  const rel = relative(offset);
  const aria = isToday ? 'Dziś' : long;
  const workouts = p.items.filter(i => i.workout), meetings = p.items.filter(i => !i.workout);
  const grip = topGrip(p);
  const strip = ctx('tile', 'day', `Pasek dnia: ${isToday ? 'dziś' : long}`);
  if (p.size === 'cmp') return <section className="p3-day cmp" aria-label={aria} {...strip}>
    <div className="p3-label"><strong>{long}</strong>{rel && <span>{rel}</span>}</div>
    <div className="p3-items">
      {p.items.map(item => <Chip key={`${item.kind}:${item.id}`} item={item} activities={p.activities} now={p.now} timeZone={p.timeZone} open={p.open} />)}
      {p.notice && <span className="p3-notice">{p.notice}</span>}
      {!p.items.length && <span className="p3-empty">{p.known ? (isToday ? 'Dziś bez treningu i spotkań' : 'Dzień wolny') : '—'}</span>}
    </div>
    {grip}
  </section>;

  const shown = meetings.length > MEETING_ROWS ? meetings.slice(0, MEETING_ROWS - 1) : meetings;
  const hidden = meetings.length - shown.length;
  return <section className="p3-day std" aria-label={aria} {...strip}>
    <div className={`p3-date ${isToday ? '' : 'other'}`}>
      <div className="p3-tile"><small>{weekday}</small><b>{p.date.slice(8).replace(/^0/, '')}</b></div>
      <span>{rel ?? month}</span>
    </div>
    <div className="p3-col train">
      <h3>Trening{workouts.length > 1 ? ` · ${workouts.length}` : ''}</h3>
      {workouts.length ? <TrainingTile item={workouts[0]} activities={p.activities} now={p.now} timeZone={p.timeZone} open={p.open} />
        : <span className="p3-none">{p.known ? 'bez treningu' : '—'}</span>}
      {p.yesterday.map(y => <button key={y.id} className="p3-yday" onClick={() => p.open({ kind: 'workout', id: y.id })}><b>{y.label}</b> {y.badge}</button>)}
    </div>
    <div className="p3-col meet">
      <h3>Spotkania{meetings.length ? ` · ${meetings.length}` : ''}</h3>
      {shown.map(item => <button key={`${item.kind}:${item.id}`} className={`p3-meet ${p.next?.id === item.id && p.next.soon ? 'soon' : ''}`} {...ctx('event', item.id, item.title, `${item.title}\n${item.at ? `Godzina: ${item.at}` : 'Cały dzień'}\nDzień: ${long}`)} onClick={() => p.open({ kind: 'event', id: item.id })}
        aria-label={`${item.title}${item.at ? `, ${item.at}` : ', cały dzień'}`}>
        <span>{item.kind === 'allDay' ? 'cały dzień' : item.at}</span><strong>{item.title}</strong>
      </button>)}
      {hidden > 0 && <button className="p3-meet more" onClick={p.showCalendar}>+{hidden} więcej</button>}
      {!meetings.length && <span className="p3-none">{p.known ? 'bez spotkań' : '—'}</span>}
    </div>
    {p.next && <div className={`p3-count ${p.next.soon ? 'soon' : ''}`}><b>{countdown(p.next.ms)}</b><small>{p.next.ongoing ? 'do końca spotkania' : 'do spotkania'}</small></div>}
    {p.notice && <span className="p3-notice">{p.notice}</span>}
    {grip}
  </section>;
}
