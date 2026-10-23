import { Bike, Check } from 'lucide-react';
import { Card, SourceNote } from './components';
import { MAX_AGE, fresh, type Detail } from './model';
import { addDays, localDate, workoutProgress, type WorkoutProgress } from './training-progress';
import { trainingLevel, trainingLevelNames, type TrainingStep, type TrainingWorkout } from './training-contract';
import { formatDuration, nextWorkoutAfter, profileBars, stepLabels } from './training-view';
import type { TrainingState } from './useTraining';

const sports: Record<string, string> = { cycling: 'rower', running: 'bieg', swimming: 'pływanie', strength_training: 'siła', walking: 'spacer', hiking: 'wędrówka' };
export const sportName = (sport: string) => sports[sport] ?? sport.replace(/_/g, ' ');

/** Three bars, as many filled as the workout's level (easy, threshold, hard). */
export function LevelBars({ phrase }: { phrase: string | null }) {
  const level = trainingLevel(phrase);
  if (!level) return null;
  return <span className="p2-level" role="img" aria-label={`Poziom: ${trainingLevelNames[level]}`}>
    {[1, 2, 3].map(i => <b key={i} className={i <= level ? 'on' : ''} />)}
  </span>;
}

/** The steps as one bar: width is time, height is target power. */
export function StepProfile({ steps }: { steps: TrainingStep[] }) {
  const bars = profileBars(steps);
  if (!bars.length) return null;
  return <>
    <div className="p2-profile" aria-hidden="true">
      {bars.map((b, i) => <i key={i} className={b.kind} style={{ width: `${b.width}%`, height: `${b.height}%` }} />)}
    </div>
    <ul className="p2-steps" aria-label="Kroki treningu">
      {stepLabels(steps).map((label, i) => <li key={i}>{label}</li>)}
    </ul>
  </>;
}

const stateLabels: Record<WorkoutProgress['state'], string> = { rest: 'odpoczynek', planned: 'zaplanowany', done: 'wykonany', partial: 'częściowo', missed: 'nie zrobiony' };
export const progressLabel = (w: TrainingWorkout, p: WorkoutProgress) => p.state === 'partial' && w.durationSec
  ? `${formatDuration(p.doneSec)} z ${formatDuration(w.durationSec)}` : stateLabels[p.state];

/** Today's workout: the name, how long and how hard, the shape of its steps, and whether it is done. */
export function TrainingCard({ workout, progress, compact = false, open }: {
  workout: TrainingWorkout; progress: WorkoutProgress; compact?: boolean; open: (d: Detail) => void;
}) {
  const level = trainingLevel(workout.phrase);
  const done = progress.state === 'done';
  const eyebrow = done ? 'Dziś · wykonane' : progress.state === 'partial' ? 'Dziś · w trakcie' : 'Dziś · trening';
  const meta = [sportName(workout.sport), workout.durationSec ? formatDuration(workout.durationSec) : null,
    workout.trainingEffect ? `efekt treningowy ${workout.trainingEffect.toLocaleString('pl-PL')}` : null].filter(Boolean).join(' · ');
  return <div className={`p2-train ${progress.state} ${compact ? 'compact' : ''}`}>
    <button className="p2-train-head" onClick={() => open({ kind: 'workout', id: workout.id })}
      aria-label={`Trening: ${workout.name}, ${meta}, ${progressLabel(workout, progress)}`}>
      <span className="p2-train-mark">{done ? <Check size={compact ? 20 : 28} /> : <Bike size={compact ? 20 : 28} />}</span>
      <span className="p2-train-title">
        {!compact && <span className="p2-eyebrow">{eyebrow}{workout.keyWorkout && !done && <span className="p2-badge">Kluczowy</span>}{done && <span className="p2-badge">Zrobione</span>}</span>}
        <strong>{workout.name}</strong>
        <span className="p2-meta">{compact ? `dziś · ${meta}` : meta}</span>
      </span>
      <span className="p2-train-side">
        {progress.state === 'done' || progress.state === 'partial'
          ? <><strong>{formatDuration(progress.doneSec)}</strong><small>{progress.state === 'partial' ? 'zrobione' : 'zrobione dziś'}</small></>
          : <><LevelBars phrase={workout.phrase} />{level && <small>{trainingLevelNames[level]}</small>}</>}
      </span>
    </button>
    {!compact && !done && workout.steps && <StepProfile steps={workout.steps} />}
  </div>;
}

/** The Garmin card of the dashboard: today's workouts, a word on yesterday's, or what the source says when it has nothing. */
export function TrainingPanel({ training, now, compact, open }: { training: TrainingState; now: number; compact: boolean; open: (d: Detail) => void }) {
  const data = training.data;
  if (!data) {
    if (training.status === 'loading') return null;
    return <p className="p2-note">{training.status === 'unavailable' ? training.message ?? 'Garmin Connect niedostępny.' : 'Garmin Connect · brak połączenia, ponawiam.'}</p>;
  }
  const zone = training.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDate(now, zone);
  const todays = data.workouts.filter(w => w.date === today && !w.restDay);
  const yesterday = data.workouts.filter(w => w.date === addDays(today, -1) && !w.restDay)
    .map(w => ({ w, p: workoutProgress(w, data.activities, now, zone) })).filter(({ p }) => p.state === 'partial' || p.state === 'missed');
  const next = nextWorkoutAfter(data.workouts, today);
  const ok = fresh(training, now, MAX_AGE.training);
  return <div className={`p2-training ${todays.length ? '' : 'rest'}`}>
    {todays.slice(0, 2).map((w, i) => <TrainingCard key={w.id} workout={w} progress={workoutProgress(w, data.activities, now, zone)} compact={compact || i > 0} open={open} />)}
    {!todays.length && <p className="p2-rest">Dziś bez treningu{next ? <> · następny: <b>{next.name}</b> {next.date === addDays(today, 1) ? 'jutro' : next.date.slice(8) + '.' + next.date.slice(5, 7)}{next.durationSec ? ` · ${formatDuration(next.durationSec)}` : ''}</> : ''}</p>}
    {yesterday.map(({ w, p }) => <button key={w.id} className="p2-yesterday" onClick={() => open({ kind: 'workout', id: w.id })}>
      <span className="p2-dot" /><b>Wczoraj · {w.name}</b>
      <span className="p2-meta">{p.state === 'partial' ? `zaplanowane ${formatDuration(w.durationSec ?? 0)} · zrobione ${formatDuration(p.doneSec)}` : 'nie zrobiony'}</span>
      <span className="p2-badge warn">{p.state === 'partial' ? 'Częściowo' : 'Pominięty'}</span>
    </button>)}
    {!ok && <SourceNote source={training} now={now} maxAge={MAX_AGE.training} refreshEveryMs={15 * 60_000} />}
    {data && training.partial && <p className="p2-note">Lista częściowa — nie wszystkie kroki treningów są dostępne.</p>}
  </div>;
}

const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** One planned workout in full: when, how long, how hard, whether it is done, and every step. */
export function WorkoutDetail({ workout, training, now }: { workout: TrainingWorkout; training: TrainingState; now: number }) {
  const zone = training.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const progress = workoutProgress(workout, training.data?.activities ?? [], now, zone);
  const level = trainingLevel(workout.phrase);
  return <Card title={workout.name} icon={<Bike />}>
    <p className="event-detail-time">{dayName(workout.date)}</p>
    <p className="p2-detail-line">
      <span>{sportName(workout.sport)}</span>
      {workout.durationSec && <span>{formatDuration(workout.durationSec)}</span>}
      {level && <span className="p2-detail-level"><LevelBars phrase={workout.phrase} /> {trainingLevelNames[level]}</span>}
      {workout.trainingEffect && <span>efekt treningowy {workout.trainingEffect.toLocaleString('pl-PL')}{workout.trainingEffectLabel ? ` · ${workout.trainingEffectLabel.toLowerCase().replace(/_/g, ' ')}` : ''}</span>}
      {workout.keyWorkout && <span className="p2-badge">Kluczowy</span>}
    </p>
    <p className="detail-copy">Status: {progressLabel(workout, progress)}</p>
    {workout.steps
      ? <StepProfile steps={workout.steps} />
      : <p className="meta">Kroki treningu nie są dostępne: Garmin podaje je tylko dla najbliższego tygodnia.</p>}
    <SourceNote source={training} now={now} maxAge={MAX_AGE.training} refreshEveryMs={15 * 60_000} />
  </Card>;
}
