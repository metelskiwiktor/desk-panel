import { Bike } from 'lucide-react';
import { Card, SourceNote } from './components';
import { MAX_AGE } from './model';
import { workoutProgress, type WorkoutProgress } from './training-progress';
import { trainingLevel, trainingLevelNames, type TrainingStep, type TrainingWorkout } from './training-contract';
import { formatDuration, profileBars, stepLabels } from './training-view';
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
