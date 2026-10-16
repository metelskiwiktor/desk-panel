import { ChevronDown } from 'lucide-react';
import { Empty, SourceNote, Sparkline, quotaReason } from './components';
import { time } from './format';
import { todayAgenda, upcomingDays } from './agenda';
import { MAX_AGE, fresh, orderedTasks, quotaState, taskLabels, type DashboardData, type Detail, type QuotaSnapshot, type SystemSample, type Task } from './model';
import { quotaPace, quotaPaceLabels, quotaResetIn } from './quota-pace';
import type { CezarSnapshot } from './cezar-contract';
import type { MailState } from './useMail';
import { MailFeed } from './MailFeed';
import type { WidgetId } from './layout';

/** CPU or RAM at or above this share of the machine shows the Komputer card on the dashboard. */
export const SYSTEM_ALERT_PERCENT = 90;
const ramPercent = (s: SystemSample) => (s.ramUsedGb / s.ramTotalGb) * 100;
const pct = (n: number) => `${Math.round(n)}%`;

export function systemAlert(data: DashboardData, now: number) {
  const latest = data.system.data?.at(-1);
  if (!latest || !fresh(data.system, now, MAX_AGE.system)) return null;
  const ram = ramPercent(latest);
  if (ram < SYSTEM_ALERT_PERCENT && latest.cpuPercent < SYSTEM_ALERT_PERCENT) return null;
  return { latest, ram, metric: ram >= SYSTEM_ALERT_PERCENT ? 'RAM' as const : 'CPU' as const };
}

type Tone = 'ok' | 'warn' | 'bad';
/** Header chips: one line of state for the computer, Cezar and Gmail. */
export function StatusChips({ data, mail, now, open, navigate }: {
  data: DashboardData; mail: MailState; now: number; open: (d: Detail) => void; navigate: (page: 'tasks' | 'settings') => void;
}) {
  const latest = data.system.data?.at(-1);
  const alert = systemAlert(data, now);
  const pc: [Tone, string] = alert ? ['bad', `PC · ${alert.metric} ${pct(alert.metric === 'RAM' ? alert.ram : alert.latest.cpuPercent)}`]
    : latest && fresh(data.system, now, MAX_AGE.system) ? ['ok', `PC · CPU ${pct(latest.cpuPercent)} · RAM ${pct(ramPercent(latest))}`]
    : ['warn', 'PC · brak pomiaru'];
  const cezar: Tone = fresh(data.tasks, now, MAX_AGE.tasks) ? 'ok' : 'warn';
  const gmail: Tone = mail.source.status === 'connected' && mail.source.accounts.every(a => a.status === 'connected') ? 'ok' : 'warn';
  return <div className="status-chips">
    <button className={`status-chip ${pc[0]}`} onClick={() => open({ kind: 'system' })}><i />{pc[1]}</button>
    <button className={`status-chip ${cezar}`} onClick={() => navigate('tasks')}><i />Cezar</button>
    <button className={`status-chip ${gmail}`} onClick={() => navigate('settings')}><i />Gmail</button>
  </div>;
}

function SystemAlertCard({ data, now, open }: { data: DashboardData; now: number; open: (d: Detail) => void }) {
  const alert = systemAlert(data, now);
  if (!alert) return null;
  const { latest, ram, metric } = alert;
  const samples = data.system.data ?? [];
  return <button className="pulpit-card system-alert" onClick={() => open({ kind: 'system' })}>
    <span className="system-alert-value">
      <span className="eyebrow alert">KOMPUTER</span>
      <strong>{metric} {pct(metric === 'RAM' ? ram : latest.cpuPercent)}</strong>
      <span className="meta">{latest.ramUsedGb.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} / {latest.ramTotalGb.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} GiB · CPU {pct(latest.cpuPercent)}</span>
    </span>
    <Sparkline tone="red" values={samples.map(s => metric === 'RAM' ? ramPercent(s) : s.cpuPercent)} label={`${metric} w ostatnich minutach, teraz ${pct(metric === 'RAM' ? ram : latest.cpuPercent)}`} />
  </button>;
}

function TodayColumn({ data, now, open }: { data: DashboardData; now: number; open: (d: Detail) => void }) {
  const events = data.calendar.data ?? [];
  const today = todayAgenda(events, now);
  const upcoming = upcomingDays(events, now);
  const ok = fresh(data.calendar, now, MAX_AGE.calendar);
  // Only a day with meetings needs the full height; otherwise the card is as tall as its list.
  return <section className={`pulpit-card today-card ${today.blocks.length ? 'fill' : ''}`} aria-labelledby="today-title">
    <div className="pulpit-card-head">
      <h2 id="today-title">Dziś</h2>
      <span className="meta">{data.calendar.data ? today.summary : data.calendar.status === 'loading' ? 'ładowanie…' : 'kalendarz niedostępny'}</span>
    </div>
    {today.allDay.map(e => <button key={e.id} className="all-day" onClick={() => open({ kind: 'event', id: e.id })}>Cały dzień · {e.title}</button>)}
    {today.blocks.length > 0 && <div className="day-axis">
      {today.hours.map(h => <span key={h.label} className="day-hour" style={{ top: `${h.top}%` }}><span>{h.label}</span></span>)}
      {today.blocks.map(b => <button key={b.event.id} className={`day-block ${b.ongoing ? 'ongoing' : ''} ${b === today.blocks.find(x => !x.ongoing) ? 'next' : ''}`}
        style={{ top: `${b.top}%`, height: `${b.height}%`, left: `calc(46px + (100% - 46px) * ${b.lane / b.lanes})`, width: `calc((100% - 46px) / ${b.lanes} - 4px)` }}
        onClick={() => open({ kind: 'event', id: b.event.id })}>
        <strong>{b.event.title}</strong>
        <span>{time(b.event.startAt)}–{time(b.event.endAt)} · {b.rel}</span>
      </button>)}
      <span className="day-now" style={{ top: `${today.nowTop}%` }}><span>{time(now)}</span></span>
    </div>}
    {data.calendar.data && <div className="upcoming">
      <span className="eyebrow">KOLEJNE DNI</span>
      {upcoming.map(d => <div key={d.label} className={`upcoming-day ${d.kind}`}>
        <div className="upcoming-head"><strong>{d.label}</strong><span>{d.rel}</span></div>
        {d.kind === 'day' && d.items.map(i => <button key={i.event.id} className="upcoming-item" onClick={() => open({ kind: 'event', id: i.event.id })}>
          <span className="upcoming-time">{i.time}</span><span className="upcoming-title">{i.event.title}</span><span className="meta">{i.duration}</span>
        </button>)}
      </div>)}
    </div>}
    {!ok && <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={60000} />}
  </section>;
}

function CezarPanel({ data, snapshot, now, open, showAll }: {
  data: DashboardData; snapshot: CezarSnapshot | null; now: number; open: (d: Detail) => void; showAll: () => void;
}) {
  const tasks = orderedTasks((data.tasks.data ?? []).filter(t => t.status !== 'done'));
  const waiting = tasks.filter(t => t.status === 'needs-input' || t.status === 'review');
  const counts = snapshot?.counts;
  const ok = fresh(data.tasks, now, MAX_AGE.tasks);
  if (data.tasks.data === null) return <section className={`pulpit-card pulpit-line ${data.tasks.status === 'loading' ? '' : 'warn'}`} aria-label="Cezar">
    <i className="line-dot" /><span><strong>{data.tasks.status === 'loading' ? 'Cezar · ładowanie…' : 'Cezar niedostępny'}</strong>
      {data.tasks.status !== 'loading' && <span className="meta">Ponawiam co 5 s</span>}</span>
  </section>;
  if (!waiting.length) {
    const running = tasks.filter(t => t.status === 'running');
    return <section className="pulpit-card pulpit-line" aria-label="Cezar">
      <i className="line-dot ok" />
      <span><strong>Cezar · nic nie czeka na Ciebie</strong>
        <span className="meta">{running.length ? `${running.length} w toku: ${running.map(t => t.title).join(', ')}` : tasks.length ? `${tasks.length} w kolejce` : 'Brak zadań'}</span></span>
      <button className="icon-button" aria-label="Wszystkie zadania" onClick={showAll}><ChevronDown size={18} /></button>
      {!ok && <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />}
    </section>;
  }
  const shown = tasks.slice(0, 3);
  return <section className="pulpit-card cezar-panel" aria-labelledby="cezar-title">
    <div className="pulpit-card-head">
      <h2 id="cezar-title">Cezar</h2>
      <span className="meta">{counts ? (['running', 'queue', 'review', 'needs-input'] as const).filter(s => counts[s]).map(s => `${counts[s]} ${taskLabels[s].toLowerCase()}`).join(' · ') : ''}</span>
    </div>
    {shown.map((task: Task) => <button key={task.id} className={`cezar-task ${task.status}`} onClick={() => open({ kind: 'task', id: task.id })}>
      <span><strong>{task.title}</strong><span className="meta">{[task.project, task.runner].filter(Boolean).join(' · ')}</span></span>
      <span className={`badge ${task.status}`}>{task.status === 'needs-input' ? 'Czeka na Ciebie' : taskLabels[task.status]}</span>
    </button>)}
    {tasks.length > shown.length && <button className="link-button" onClick={showAll}>i {tasks.length - shown.length} więcej</button>}
    {!ok && <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />}
    {snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
  </section>;
}

function QuotaBar({ snapshot, now, connected }: { snapshot: QuotaSnapshot; now: number; connected: boolean }) {
  const measured = quotaState(snapshot, now);
  const state = !connected && measured === 'fresh' ? 'stale' : measured;
  const pace = state === 'fresh' ? quotaPace(snapshot, now) : null;
  return <div className={`quota-bar ${snapshot.model ? 'quota-dynamic' : ''} ${pace ? `quota-pace-${pace.tone}` : 'quota-muted'}`}>
    <span className="quota-window-label">{snapshot.model ? `${snapshot.model} · ${snapshot.label || snapshot.window}` : snapshot.window}</span>
    <span className="quota-track" role="meter" aria-label={`Użycie limitu ${snapshot.window}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.usedPercent ?? undefined}
      aria-valuetext={pace ? `Zużyto ${snapshot.usedPercent}%, czas okna ${Math.round(pace.elapsedPercent)}%. ${quotaPaceLabels[pace.tone]}.` : 'Brak aktualnego pomiaru'}>
      {state !== 'unavailable' && <span className="quota-fill" style={{ width: `${snapshot.usedPercent}%` }} />}
      {pace && <i className="quota-tick" style={{ left: `${pace.elapsedPercent}%` }} aria-hidden="true" />}
    </span>
    <strong className="quota-value">{state === 'unavailable' ? '—' : `${Number(snapshot.usedPercent!.toFixed(1))}%`}</strong>
    <span className="quota-sub">{snapshot.state === 'auth_required' ? 'wymaga logowania' : pace ? `czas ${Math.round(pace.elapsedPercent)}% · reset za ${quotaResetIn(snapshot.resetAt!, now)}` : state === 'unavailable' ? snapshot.reason ? quotaReason(snapshot.reason) : 'brak pomiaru' : state === 'fresh' ? snapshot.resetAt ? `reset za ${quotaResetIn(snapshot.resetAt, now)}` : 'reset nieznany' : 'nieaktualne · ostatnia obserwacja'}{snapshot.state && snapshot.observedAt !== null && ` · odczyt ${time(snapshot.observedAt)}`}</span>
  </div>;
}

function QuotaStrip({ data, now, open }: { data: DashboardData; now: number; open: (d: Detail) => void }) {
  const accounts = data.quotas.data;
  const connected = fresh(data.quotas, now, MAX_AGE.quotas);
  return <section className="pulpit-card quota-strip" aria-label="Limity AI">
    {accounts?.length ? accounts.map(a => <button key={a.provider} className="quota-provider" onClick={() => open({ kind: 'quota', provider: a.provider })}>
      <strong>{a.provider}</strong>
      {!a.snapshots.length && <span className="quota-sub">{a.reason ? quotaReason(a.reason) : "Brak pomiaru"}</span>}
      {a.snapshots.map(s => <QuotaBar key={`${s.model || ""}:${s.window}`} snapshot={s} now={now} connected={connected} />)}
    </button>) : <Empty>{data.quotas.status === 'loading' ? 'Ładowanie limitów…' : 'Brak limitów AI.'}</Empty>}
    {!connected && <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={60000} />}
  </section>;
}

/**
 * The dashboard sizes itself to its content and the screen: the Komputer card only appears on a
 * problem, Cezar folds to one line when nothing waits for you, and long mail lists scroll locally.
 */
export function Dashboard({ data, snapshot, mail, now, open, showTasks, visible }: {
  data: DashboardData; snapshot: CezarSnapshot | null; mail: MailState; now: number;
  open: (d: Detail) => void; showTasks: () => void; visible: (id: WidgetId) => boolean;
}) {
  const side = visible('cezar') || visible('mail');
  return <div className="pulpit">
    {visible('system') && <SystemAlertCard data={data} now={now} open={open} />}
    <div className={`pulpit-grid ${visible('calendar') && side ? '' : 'single'}`}>
      {visible('calendar') && <TodayColumn data={data} now={now} open={open} />}
      {side && <div className={`pulpit-side ${visible('mail') && mail.threads?.length ? 'fill' : ''}`}>
        {visible('cezar') && <CezarPanel data={data} snapshot={snapshot} now={now} open={open} showAll={showTasks} />}
        {visible('mail') && <MailFeed mail={mail} now={now} open={open} />}
      </div>}
    </div>
    {visible('quotas') && <QuotaStrip data={data} now={now} open={open} />}
  </div>;
}
