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
}: {
  snapshot: QuotaSnapshot;
  now: number;
  sourceConnected: boolean;
}) {
  const measuredState = quotaState(snapshot, now);
  const state = !sourceConnected && measuredState === 'fresh' ? 'stale' : measuredState;
  return (
    <div className="quota-window">
      <div className="quota-label">
        <span>Okno {snapshot.window}</span>
        <strong className={state === 'fresh' && snapshot.usedPercent! >= 90 ? 'amber-text' : ''}>
          {state === 'unavailable' ? 'Brak danych' : `${snapshot.usedPercent}%`}
        </strong>
      </div>
      {state !== 'unavailable' && (
        <div
          className={`meter ${snapshot.usedPercent! >= 90 ? 'amber' : ''} ${state === 'stale' ? 'muted-meter' : ''}`}
          role="meter"
          aria-label={`Użycie limitu ${snapshot.window}`}
          aria-valuenow={snapshot.usedPercent!}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${snapshot.usedPercent}%` }} />
        </div>
      )}
      <span className={`meta ${state !== 'fresh' ? 'warning' : ''}`}>
        {state === 'unavailable'
          ? 'Nie zarejestrowano pomiaru'
          : state === 'stale'
            ? 'Nieaktualne · ostatnia obserwacja'
            : 'wykorzystania limitu konta'}
      </span>
      {snapshot.source && snapshot.observedAt !== null && <span className="meta">Obserwacja {stamp(snapshot.observedAt)} · reset {snapshot.resetAt === null ? 'nieznany' : stamp(snapshot.resetAt)}</span>}
    </div>
  );
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
