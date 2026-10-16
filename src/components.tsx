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
import { quotaPace, quotaPaceLabels, quotaResetIn, sortSnapshots, QUOTA_PACE_TOLERANCE, QUOTA_PACE_WARNING } from './quota-pace';

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
      className={`source-note ${!sourceLabel(source, now, maxAge).startsWith('Połączono') ? 'warning' : ''}`}
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
        <span>{snapshot.model ? `${snapshot.model} · ${snapshot.label || snapshot.window}` : `Okno ${snapshot.window}`}</span>
        <strong>
          {snapshot.state === 'auth_required' ? 'Wymaga logowania' : state === 'unavailable' ? (snapshot.reason === 'window_inactive' ? 'Okno nieaktywne' : 'Brak danych') : `${Number(snapshot.usedPercent!.toFixed(1))}%`}
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
          aria-valuetext={pace ? `Zużyto ${snapshot.usedPercent}%, czas okna ${elapsed}%. ${quotaPaceLabels[pace.tone]}. Reset za ${quotaResetIn(snapshot.resetAt!, now)}.` : state === 'fresh' ? `Zużyto ${snapshot.usedPercent}%. Termin resetu ${snapshot.resetAt ? stamp(snapshot.resetAt) : 'nieznany'}.` : `${snapshot.usedPercent}% · nieaktualna obserwacja`}
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
            : pace ? `Czas okna: ${elapsed}% · reset za ${quotaResetIn(snapshot.resetAt!, now)}` : snapshot.resetAt ? `Reset za ${quotaResetIn(snapshot.resetAt, now)}` : 'Termin resetu nieznany'}
      </span>
      {showPaceDetails && pace && <div className="quota-pace-details">
        <span className="meta">{pace.tone === 'green' ? 'Zielony' : pace.tone === 'yellow' ? 'Żółty' : 'Czerwony'} · zużycie {pp(Math.abs(excess))} p.p. {excess < 0 ? 'poniżej' : 'powyżej'} upływu czasu</span>
        {pace.tone === 'green' ? <span className="meta">Do progu żółtego: {pp(QUOTA_PACE_TOLERANCE - excess)} p.p.</span>
          : pace.tone === 'yellow' ? <>
            <span className="meta">Ponad próg żółtego: {pp(excess - QUOTA_PACE_TOLERANCE)} p.p.</span>
            <span className="meta">Do progu czerwonego: {pp(QUOTA_PACE_WARNING - excess)} p.p.</span>
          </> : <span className="meta">Ponad próg czerwonego: {pp(excess - QUOTA_PACE_WARNING)} p.p.</span>}
      </div>}
      {snapshot.reason && <span className="meta" title={snapshot.reason}>{quotaReason(snapshot.reason)}</span>}
      {snapshot.attemptedAt && <span className="meta">Próba {stamp(snapshot.attemptedAt)}</span>}
      {snapshot.state && state === 'fresh' && snapshot.observedAt !== null && <span className="meta">Odczyt {stamp(snapshot.observedAt)}</span>}
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
          {account.provider === 'Claude' ? '✳' : account.provider === 'AGY' ? '✦' : '⌘'}
        </span>
        <strong>{account.provider}</strong>
        <ChevronRight size={17} />
      </span>
      {account.snapshots.length ? (
        sortSnapshots(account.snapshots).map((s) => (
          <QuotaWindow key={`${s.model || ""}:${s.window}`} snapshot={s} now={now} sourceConnected={sourceConnected} />
        ))
      ) : (
        <span className="meta">{account.reason ? quotaReason(account.reason) : "Brak snapshotów"}</span>
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

export function quotaReason(reason: string) {
  const labels: Record<string,string> = {field_unsupported:'Dostawca nie udostępnił tego pola',window_inactive:'Brak aktywnego okna',window_not_reported:'Dostawca nie zgłosił okna',
    agy_auth_required:'Zaloguj się w AGY CLI',parse_error:'Nierozpoznany format pomiaru',agy_schema_unsupported:'Nieobsługiwany format AGY',http_401:'Sesja wygasła — zaloguj się w CLI',
    claude_login_expired:'Sesja wygasła — wymagane logowanie w Claude CLI',claude_login_unavailable:'Brak sesji Claude CLI',http_403:'Dostawca odmówił dostępu',
    http_429:'Dostawca ograniczył odczyty — ponowienie przy następnym odświeżeniu',http_5xx:'Przejściowy błąd dostawcy',
    network_error:'Błąd sieci',request_timeout:'Przekroczony czas odczytu',cli_not_installed:'CLI nie jest zainstalowane',
    cli_execution_failed:'CLI odrzuciło odczyt',account_changed:'Zmieniono konto — oczekiwanie na nowy odczyt',
    reset_elapsed:'Okno minęło — oczekiwanie na nowy pomiar'};
  return labels[reason] || 'Odczyt chwilowo niedostępny';
}
