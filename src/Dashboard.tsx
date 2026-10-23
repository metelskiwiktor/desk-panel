import { SourceNote, Sparkline } from './components';
import { CezarPanel } from './CezarCard';
import { dayRibbon } from './day-ribbon';
import { DayRibbonView, MeetingFocus } from './DayRibbon';
import { MAX_AGE, fresh, type DashboardData, type Detail, type SystemSample } from './model';
import type { CezarSnapshot } from './cezar-contract';
import type { MailState } from './useMail';
import { MailFeed } from './MailFeed';
import type { WidgetId } from './layout';
import { QuotaRings } from './QuotaRings';
import { TrainingPanel } from './TrainingCard';
import { WeekStrip } from './WeekStrip';
import { weekDays, withoutPlanDuplicates } from './week';
import type { TrainingState } from './useTraining';

export { splitFor } from './quota-cards';

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
/** What the Cezar chip says: whether anything waits for you, runs, or the source is not there. */
export function cezarChip(data: DashboardData, now: number): [Tone, string] {
  const tasks = data.tasks.data;
  if (tasks === null) return data.tasks.status === 'loading' ? ['warn', 'Cezar · ładowanie…'] : ['bad', 'Cezar niedostępny'];
  const waiting = tasks.filter(t => t.status === 'needs-input' || t.status === 'review').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const tone: Tone = fresh(data.tasks, now, MAX_AGE.tasks) ? 'ok' : 'warn';
  if (waiting) return ['warn', `Cezar · ${waiting} czeka na Ciebie`];
  if (running) return [tone, `Cezar · ${running} w toku`];
  return [tone, 'Cezar · nic nie czeka'];
}

/** Header chips: one line of state for the computer, Cezar and Gmail. */
export function StatusChips({ data, mail, now, open, navigate }: {
  data: DashboardData; mail: MailState; now: number; open: (d: Detail) => void; navigate: (page: 'tasks' | 'settings') => void;
}) {
  const latest = data.system.data?.at(-1);
  const alert = systemAlert(data, now);
  const pc: [Tone, string] = alert ? ['bad', `PC · ${alert.metric} ${pct(alert.metric === 'RAM' ? alert.ram : alert.latest.cpuPercent)}`]
    : latest && fresh(data.system, now, MAX_AGE.system) ? ['ok', `PC · CPU ${pct(latest.cpuPercent)} · RAM ${pct(ramPercent(latest))}`]
    : ['warn', 'PC · brak pomiaru'];
  const cezar = cezarChip(data, now);
  const gmail: Tone = mail.source.status === 'connected' && mail.source.accounts.every(a => a.status === 'connected') ? 'ok' : 'warn';
  return <div className="status-chips">
    <button className={`status-chip ${pc[0]}`} onClick={() => open({ kind: 'system' })}><i />{pc[1]}</button>
    <button className={`status-chip ${cezar[0]}`} onClick={() => navigate('tasks')}><i />{cezar[1]}</button>
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

/**
 * The dashboard's frame: today on the left (the meeting that is about to start, today's workout, the day as a ribbon),
 * the AI limits on the right, the next days underneath. Cezar, mail and a computer alarm appear on the right only
 * while they have something to say; the limits then fold into a row to make room for them.
 */
export function Dashboard({ data, training, snapshot, mail, now, open, showTasks, showCalendar, showBreakdown, visible }: {
  data: DashboardData; training: TrainingState; snapshot: CezarSnapshot | null; mail: MailState; now: number;
  open: (d: Detail) => void; showTasks: () => void; showCalendar: () => void; showBreakdown: () => void; visible: (id: WidgetId) => boolean;
}) {
  const calendarOn = visible('calendar'), trainingOn = visible('training');
  const events = withoutPlanDuplicates(data.calendar.data ?? [], training.data?.workouts ?? []);
  const ribbon = dayRibbon(events, now);
  const zone = training.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const week = weekDays({ now, timeZone: zone, events: calendarOn ? events : [], workouts: trainingOn ? training.data?.workouts ?? [] : [], activities: training.data?.activities ?? [] });
  // No card for a known-empty inbox. It stays for threads, an unreachable or unconsented account, and
  // while the undo bar or an error needs it (also right after the last thread was handled).
  const mailProblem = mail.source.accounts.some(a => a.status !== 'connected' && a.status !== 'loading');
  const mailShown = visible('mail') && !!(mail.threads ? mail.threads.length || mailProblem : mail.source.status !== 'loading') || !!(visible('mail') && (mail.undo || mail.error));
  const cezarBusy = visible('cezar') && (data.tasks.data ?? []).some(t => t.status === 'needs-input' || t.status === 'review' || t.status === 'running');
  const alert = visible('system') && systemAlert(data, now) !== null;
  const side = cezarBusy || mailShown || alert;
  const quotasOn = visible('quotas');
  const todayOn = calendarOn || trainingOn;
  const focus = calendarOn && ribbon.focus !== null;
  const summary = data.calendar.data ? ribbon.summary : data.calendar.status === 'loading' ? 'ładowanie…' : 'kalendarz niedostępny';
  return <div className="p2-frame" data-side={side} data-focus={focus}>
    <div className={`p2-main ${todayOn && (quotasOn || side) ? '' : 'single'}`}>
      {todayOn && <div className="p2-today">
        {calendarOn && <MeetingFocus ribbon={ribbon} now={now} open={open} />}
        {trainingOn && <TrainingPanel training={training} now={now} compact={focus} open={open} />}
        {calendarOn && <DayRibbonView ribbon={ribbon} summary={summary} known={data.calendar.data !== null} now={now} open={open} showCalendar={showCalendar} />}
        {calendarOn && !fresh(data.calendar, now, MAX_AGE.calendar) && <SourceNote source={data.calendar} now={now} maxAge={MAX_AGE.calendar} refreshEveryMs={60000} />}
      </div>}
      {(quotasOn || side) && <aside className="p2-side">
        {quotasOn && <QuotaRings data={data} now={now} open={open} compact={side} showBreakdown={visible('breakdown') ? showBreakdown : undefined} />}
        {alert && <SystemAlertCard data={data} now={now} open={open} />}
        {cezarBusy && <CezarPanel data={data} snapshot={snapshot} now={now} open={open} showAll={showTasks} beside={mailShown} />}
        {mailShown && <MailFeed mail={mail} now={now} open={open} />}
      </aside>}
    </div>
    {todayOn && <WeekStrip days={week} known={(calendarOn && data.calendar.data !== null) || (trainingOn && training.data !== null)} open={open} />}
  </div>;
}
