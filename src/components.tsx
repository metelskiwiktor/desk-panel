import type { ReactNode } from 'react';
import { ChevronRight, CircleHelp, ExternalLink, ListTodo } from 'lucide-react';
import {
  quotaState,
  safeUrl,
  sourceLabel,
  taskLabels,
  type CalendarEvent,
  type Detail,
  type QuotaAccount,
  type QuotaSnapshot,
  type Source,
  type Task,
} from './model';
import { time, stamp, date, allDayDate, preciseStamp } from './format';
import { quotaPace, quotaPaceLabels, quotaResetIn, QUOTA_PACE_TOLERANCE, QUOTA_PACE_WARNING } from './quota-pace';

export function SourceNote<T>({
  source,
  now,
  maxAge,
  refreshEveryMs,
}: {
  source: Source<T>;
  now: number;
  maxAge: number;
  refreshEveryMs?: number;
}) {
  return (
    <><p
      className={`source-note ${!sourceLabel(source, now, maxAge).startsWith('Połączono') && sourceLabel(source, now, maxAge) !== 'Zapis DEMO' ? 'warning' : ''}`}
    >
      <span className="dot" />
      {sourceLabel(source, now, maxAge)}
      {source.observedAt !== null && <> · Dane z {preciseStamp(source.observedAt)}</>}
      {source.message && <> · {source.message}</>}
    </p>
    {refreshEveryMs && <p className="source-note refresh-note">
      Odświeżanie: co {refreshEveryMs >= 60000 ? `${refreshEveryMs / 60000} min` : `${refreshEveryMs / 1000} s`}
      {' · '}Ostatnie pobranie: {source.loadedAt == null ? 'jeszcze nie pobrano' : preciseStamp(source.loadedAt)}
    </p>}</>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <CircleHelp size={22} />
      <p>{children}</p>
    </div>
  );
}
export function Card({
  title,
  eyebrow,
  icon,
  action,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-heading">
        <div className="title-group">
          <span className="card-icon">{icon}</span>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function TaskRow({ task, open }: { task: Task; open: (detail: Detail) => void }) {
  return (
    <button
      className={`task-row row ${task.status === 'needs-input' ? 'attention' : ''}`}
      onClick={() => open({ kind: 'task', id: task.id })}
    >
      <span className={`task-mark ${task.status}`}>
        <ListTodo size={19} />
      </span>
      <span className="row-body">
        <span className="row-title">{task.title}</span>
        <span className="meta">
          {task.project}
          {task.runner && ` · ${task.runner}`}
        </span>
        <span className="meta">Stan sprawdzony {stamp(task.checkedAt)}</span>
        {task.activity === 'monitoring' && <span className="meta">Monitoruje wyniki</span>}
      </span>
      <span className="row-end">
        <span className={`badge ${task.status}`}>{taskLabels[task.status]}</span>
        <ChevronRight size={17} />
      </span>
    </button>
  );
}
export function EventRow({
  event,
  first,
  open,
}: {
  event: CalendarEvent;
  first?: boolean;
  open: (detail: Detail) => void;
}) {
  return (
    <button
      className={`event-row row ${first ? 'next-event' : ''}`}
      onClick={() => open({ kind: 'event', id: event.id })}
    >
      <span className="row-body">
        {first && <span className="eyebrow blue-text">NAJBLIŻSZE</span>}
        <span className="event-time">
          {event.allDay ? 'Cały dzień' : <>{time(event.startAt)} <span>— {time(event.endAt)}</span></>}
        </span>
        <span className="row-title">{event.title}</span>
        <span className="meta">{event.allDay && event.startDate && event.endDate ? allDayDate(event.startDate, event.endDate) : date(event.startAt)}</span>
      </span>
      <ChevronRight size={17} />
    </button>
  );
}
export function Sparkline({
  values,
  label,
  tone = 'blue',
}: {
  values: number[];
  label: string;
  tone?: string;
}) {
  const points = values
    .map(
      (value, i) =>
        `${(i * 240) / Math.max(1, values.length - 1)},${48 - Math.max(0, Math.min(100, value)) * 0.42}`,
    )
    .join(' ');
  return (
    <svg viewBox="0 0 240 52" className={`sparkline ${tone}`} role="img" aria-label={label}>
      <path d="M0 48H240" className="chart-baseline" />
      <polyline points={points} />
    </svg>
  );
}
export function QuotaWindow({
  snapshot,
  now,
  sourceConnected,
  showPaceDetails = false,
}: {
  snapshot: QuotaSnapshot;
  now: number;
  sourceConnected: boolean;
  showPaceDetails?: boolean;
}) {
  const measuredState = quotaState(snapshot, now);
  const state = !sourceConnected && measuredState === 'fresh' ? 'stale' : measuredState;
  const pace = state === 'fresh' ? quotaPace(snapshot, now) : null;
  const elapsed = pace ? Math.round(pace.elapsedPercent) : null;
  const excess = pace ? snapshot.usedPercent! - pace.elapsedPercent : 0;
  const pp = (value: number) => Math.max(0, value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="quota-window">
      <div className="quota-label">
        <span>Okno {snapshot.window}</span>
        <strong>
          {state === 'unavailable' ? 'Brak danych' : `${snapshot.usedPercent}%`}
        </strong>
      </div>
      {state !== 'unavailable' && (
        <div
          className={`meter quota-meter ${pace ? `quota-pace-${pace.tone}` : 'muted-meter'}`}
          role="meter"
          aria-label={`Użycie limitu ${snapshot.window}`}
          aria-valuenow={snapshot.usedPercent!}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={pace ? `Zużyto ${snapshot.usedPercent}%, czas okna ${elapsed}%. ${quotaPaceLabels[pace.tone]}. Reset za ${quotaResetIn(snapshot.resetAt!, now)}.` : `${snapshot.usedPercent}% · nieaktualna obserwacja`}
        >
          <span style={{ width: `${snapshot.usedPercent}%` }} />
          {pace && <i className="quota-time-marker" style={{ left: `${pace.elapsedPercent}%` }} aria-hidden="true" />}
        </div>
      )}
      <span className={`meta ${state !== 'fresh' ? 'warning' : ''}`}>
        {state === 'unavailable'
          ? 'Nie zarejestrowano pomiaru'
          : state === 'stale'
            ? 'Nieaktualne · ostatnia obserwacja'
            : `Czas okna: ${elapsed}% · reset za ${quotaResetIn(snapshot.resetAt!, now)}`}
      </span>
      {showPaceDetails && pace && <div className="quota-pace-details">
        <span className="meta">{pace.tone === 'green' ? 'Zielony' : pace.tone === 'yellow' ? 'Żółty' : 'Czerwony'} · zużycie {pp(Math.abs(excess))} p.p. {excess < 0 ? 'poniżej' : 'powyżej'} upływu czasu</span>
        {pace.tone === 'green' ? <span className="meta">Do progu żółtego: {pp(QUOTA_PACE_TOLERANCE - excess)} p.p.</span>
          : pace.tone === 'yellow' ? <>
            <span className="meta">Ponad próg żółtego: {pp(excess - QUOTA_PACE_TOLERANCE)} p.p.</span>
            <span className="meta">Do progu czerwonego: {pp(QUOTA_PACE_WARNING - excess)} p.p.</span>
          </> : <span className="meta">Ponad próg czerwonego: {pp(excess - QUOTA_PACE_WARNING)} p.p.</span>}
      </div>}
      {state !== 'fresh' && snapshot.source && snapshot.observedAt !== null && <span className="meta">Obserwacja {stamp(snapshot.observedAt)} · reset {snapshot.resetAt === null ? 'nieznany' : stamp(snapshot.resetAt)}</span>}
    </div>
  );
}
export function QuotaLegend() {
  return <section className="quota-legend" aria-label="Legenda wykresu limitów">
    <h3>Jak czytać wykres</h3>
    <p className="meta">Wypełnienie pokazuje wykorzystany limit. Jasna kreska ze strzałką oznacza upływ czasu w oknie 5h lub 7d, obliczony z terminu resetu. Po godzinie okna 5h wskazuje 20%.</p>
    <ul>
      <li><span className="quota-legend-swatch quota-pace-green" aria-hidden="true" /><span>Zielony — zużycie poniżej kreski lub do {QUOTA_PACE_TOLERANCE} punktów procentowych ponad nią.</span></li>
      <li><span className="quota-legend-swatch quota-pace-yellow" aria-hidden="true" /><span>Żółty — zużycie wyprzedza czas o ponad {QUOTA_PACE_TOLERANCE} do {QUOTA_PACE_WARNING} punktów procentowych.</span></li>
      <li><span className="quota-legend-swatch quota-pace-red" aria-hidden="true" /><span>Czerwony — zużycie wyprzedza czas o ponad {QUOTA_PACE_WARNING} punktów procentowych.</span></li>
    </ul>
    <p className="meta">Kolor porównuje zużycie z równomiernym tempem do resetu. Zielony nie gwarantuje dostępności limitu. Nieaktualny odczyt jest szary, bez kreski czasu. Po resecie czekamy na nowy pomiar.</p>
  </section>;
}
export function QuotaCard({
  account,
  now,
  open,
  sourceConnected,
}: {
  account: QuotaAccount;
  now: number;
  open: (detail: Detail) => void;
  sourceConnected: boolean;
}) {
  return (
    <button
      className="quota-account"
      onClick={() => open({ kind: 'quota', provider: account.provider })}
    >
      <span className="provider">
        <span className={`provider-logo ${account.provider.toLowerCase()}`}>
          {account.provider === 'Claude' ? '✳' : '⌘'}
        </span>
        <strong>{account.provider}</strong>
        <ChevronRight size={17} />
      </span>
      {account.snapshots.length ? (
        account.snapshots.map((s) => (
          <QuotaWindow key={s.window} snapshot={s} now={now} sourceConnected={sourceConnected} />
        ))
      ) : (
        <span className="meta">Brak snapshotów</span>
      )}
    </button>
  );
}
export function SourceLink({ url }: { url?: string }) {
  const href = safeUrl(url);
  return href ? (
    <a className="button" href={href} target="_blank" rel="noopener noreferrer">
      Otwórz źródło <ExternalLink size={18} />
    </a>
  ) : (
    <p className="meta">Link źródłowy nie jest dostępny.</p>
  );
}
