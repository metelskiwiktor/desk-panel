import { useEffect, useRef, useState } from 'react';
import type { CezarState } from './useCezar';
import { CezarPanel } from './CezarCard';
import { FOCUS_WITHIN_MS, dayRibbon } from './day-ribbon';
import { DayStrip } from './DayStrip';
import { DaysZone } from './DaysZone';
import { MAX_AGE, fresh, type DashboardData, type Detail, type SystemSample } from './model';
import type { CezarSnapshot } from './cezar-contract';
import type { MailState } from './useMail';
import { MailFeed } from './MailFeed';
import type { WidgetId } from './layout';
import { useDismiss } from './popover';
import { QuotaBars } from './QuotaBars';
import { SystemPopover } from './SystemPopover';
import { addDays, localDate, workoutProgress } from './training-progress';
import { formatDuration } from './training-view';
import { dayOf, monthDays, weekDays, withoutPlanDuplicates } from './week';
import type { TrainingState } from './useTraining';
import { BOTTOM_SIZES, TOP_CYCLE, cycleSize, useZones } from './zones';

export { splitFor } from './quota-cards';

/** CPU or RAM at or above this share of the machine shows the Komputer card on the dashboard. */
export const SYSTEM_ALERT_PERCENT = 90;
const ramPercent = (s: SystemSample) => (s.ramUsedGb / s.ramTotalGb) * 100;
const pct = (n: number) => `${Math.round(n)}%`;

/** The chip turns red only when the load has lasted this long; a spike of a few seconds is not news. */
export const SYSTEM_ALERT_HOLD_MS = 20_000;

export function systemAlert(data: DashboardData, now: number) {
  const latest = data.system.data?.at(-1);
  if (!latest || !fresh(data.system, now, MAX_AGE.system)) return null;
  const recent = (data.system.data ?? []).filter(s => latest.at - s.at <= SYSTEM_ALERT_HOLD_MS);
  const span = latest.at - recent[0].at;
  // Not enough history yet counts as no alarm; the load must cover the hold with no sample below the threshold.
  const held = (high: (s: SystemSample) => boolean) => span >= SYSTEM_ALERT_HOLD_MS * 0.75 && recent.every(high);
  const ramHigh = held(s => ramPercent(s) >= SYSTEM_ALERT_PERCENT), cpuHigh = held(s => s.cpuPercent >= SYSTEM_ALERT_PERCENT);
  if (!ramHigh && !cpuHigh) return null;
  return { latest, ram: ramPercent(latest), metric: ramHigh ? 'RAM' as const : 'CPU' as const };
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
export function StatusChips({ data, mail, now, open, navigate, showPc = true }: {
  data: DashboardData; mail: MailState; now: number; open: (d: Detail) => void; navigate: (page: 'tasks' | 'settings' | 'system') => void; showPc?: boolean;
}) {
  const [pcOpen, setPcOpen] = useState(false);
  const pcRoot = useRef<HTMLDivElement>(null);
  useDismiss(pcOpen, () => setPcOpen(false), pcRoot);
  const latest = data.system.data?.at(-1);
  const alert = systemAlert(data, now);
  const pc: [Tone, string] = alert ? ['bad', `PC · ${alert.metric} ${pct(alert.metric === 'RAM' ? alert.ram : alert.latest.cpuPercent)}`]
    : latest && fresh(data.system, now, MAX_AGE.system) ? ['ok', `PC · CPU ${pct(latest.cpuPercent)} · RAM ${pct(ramPercent(latest))}`]
    : ['warn', 'PC · brak pomiaru'];
  const cezar = cezarChip(data, now);
  const gmail: Tone = mail.source.status === 'connected' && mail.source.accounts.every(a => a.status === 'connected') ? 'ok' : 'warn';
  return <div className="status-chips">
    {showPc && <div className="sys-root" ref={pcRoot}>
      <button className={`status-chip ${pc[0]}`} aria-expanded={pcOpen} aria-haspopup="dialog" onClick={() => setPcOpen(!pcOpen)}><i />{pc[1]}</button>
      {pcOpen && <SystemPopover samples={data.system.data ?? []} threshold={SYSTEM_ALERT_PERCENT} close={() => setPcOpen(false)} showPage={() => navigate('system')} />}
    </div>}
    <button className={`status-chip ${cezar[0]}`} onClick={() => navigate('tasks')}><i />{cezar[1]}</button>
    <button className={`status-chip ${gmail}`} onClick={() => navigate('settings')}><i />Gmail</button>
  </div>;
}

/**
 * Three zones one above the other. Top: the selected day (today at first) as training, meetings and what is about to
 * start. Middle: the work area (limits, Cezar, mail), which takes what the other two leave and shows only what has
 * something to say. Bottom: the days ahead as chips, cards or a month. A tap on a day selects it; the sizes of the
 * top and bottom zones are one step each way and are remembered.
 */
export function Dashboard({ data, training, snapshot, cezar, mail, now, open, showTasks, showCalendar, showBreakdown, visible, resetSignal = false }: {
  /** Finished tasks and the actions on them; without it only the active tasks show. */
  cezar?: CezarState;
  data: DashboardData; training: TrainingState; snapshot: CezarSnapshot | null; mail: MailState; now: number;
  open: (d: Detail) => void; showTasks: () => void; showCalendar: () => void; showBreakdown: () => void; visible: (id: WidgetId) => boolean;
  /** True while the panel idles: sizes and the selected day go back to the default. */
  resetSignal?: boolean;
}) {
  const calendarOn = visible('calendar'), trainingOn = visible('training');
  const { zones, view, setTop, setBottom, previewTop, previewBottom } = useZones(resetSignal);
  const events = withoutPlanDuplicates(data.calendar.data ?? [], training.data?.workouts ?? []);
  const zone = training.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDate(now, zone);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { if (resetSignal) setPicked(null); }, [resetSignal]);
  const selected = picked && picked >= today ? picked : today;
  const sources = { now, timeZone: zone, events: calendarOn ? events : [], workouts: trainingOn ? training.data?.workouts ?? [] : [], activities: training.data?.activities ?? [] };
  const week = weekDays(sources);
  const month = view.bottom === 'month' ? monthDays(sources) : [];
  const day = dayOf(selected, sources);
  const known = (calendarOn && data.calendar.data !== null) || (trainingOn && training.data !== null);
  const select = (date: string) => setPicked(date);

  const ribbon = dayRibbon(events, now);
  const isToday = selected === today;
  // The meeting that is on, or else the next one today; it gets the countdown, and a highlight when it is close.
  const upcoming = isToday && calendarOn ? ribbon.blocks.find(b => b.ongoing) ?? ribbon.blocks.find(b => !b.past) : undefined;
  const next = upcoming ? { id: upcoming.event.id, ongoing: upcoming.ongoing, ms: upcoming.ongoing ? upcoming.event.endAt - now : upcoming.event.startAt - now,
    soon: upcoming.ongoing || upcoming.event.startAt - now <= FOCUS_WITHIN_MS } : null;
  const yesterday = isToday && trainingOn && training.data
    ? training.data.workouts.filter(w => w.date === addDays(today, -1) && !w.restDay)
      .map(w => ({ w, p: workoutProgress(w, training.data!.activities, now, zone) })).filter(({ p }) => p.state === 'partial' || p.state === 'missed')
      .map(({ w, p }) => ({ id: w.id, label: `Wczoraj · ${w.name}`, badge: p.state === 'partial' ? `${formatDuration(p.doneSec)} z ${formatDuration(w.durationSec ?? 0)}` : 'nie zrobiony' }))
    : [];
  const notice = trainingOn && !training.data && training.status !== 'loading' ? (training.status === 'unavailable' ? training.message ?? 'Garmin Connect niedostępny.' : 'Garmin Connect · brak połączenia, ponawiam.')
    : trainingOn && training.data && !fresh(training, now, MAX_AGE.training) ? 'Garmin: dane nieaktualne'
    : calendarOn && data.calendar.data && !fresh(data.calendar, now, MAX_AGE.calendar) ? 'Kalendarz: dane nieaktualne' : null;

  // No card for a known-empty inbox. It stays for threads, an unreachable or unconsented account, and
  // while the undo bar or an error needs it (also right after the last thread was handled).
  const mailProblem = mail.source.accounts.some(a => a.status !== 'connected' && a.status !== 'loading');
  const mailShown = visible('mail') && !!(mail.threads ? mail.threads.length || mailProblem : mail.source.status !== 'loading') || !!(visible('mail') && (mail.undo || mail.error));
  const cezarBusy = visible('cezar') && ((data.tasks.data ?? []).some(t => t.status === 'needs-input' || t.status === 'review' || t.status === 'running') || !!cezar && (cezar.finished.length > 0 || cezar.undo || !!cezar.error));
  const quotasOn = visible('quotas');
  const cards = [quotasOn, cezarBusy, mailShown].filter(Boolean).length;
  const work = cards > 0;
  // In the month the work area folds away to nothing instead of leaving: the zones glide, and the cards are still there.
  const folded = view.bottom === 'month';
  return <div className="p3-frame" data-top={view.top} data-bottom={view.bottom} data-work={work} data-days={calendarOn || trainingOn}>
    {(calendarOn || trainingOn) && <DayStrip date={selected} today={today} size={view.top} now={now} timeZone={zone} items={day.items} activities={sources.activities}
      next={next} yesterday={yesterday} notice={notice} known={known}
      cycle={() => setTop(cycleSize(TOP_CYCLE, zones.top))} resize={setTop} preview={previewTop} open={open} showCalendar={showCalendar} />}
    {work && <div className="p3-work" aria-hidden={folded || undefined} inert={folded}>
      {quotasOn && <QuotaBars data={data} now={now} open={open} showBreakdown={visible('breakdown') ? showBreakdown : undefined} />}
      {cezarBusy && <CezarPanel data={data} snapshot={snapshot} now={now} open={open} showAll={showTasks} beside={cards > 1}
        finished={cezar?.finished} archive={cezar?.archive} restore={cezar?.restore} markRead={cezar?.markRead} undo={cezar?.undo} error={cezar?.error} />}
      {mailShown && <MailFeed mail={mail} now={now} open={open} />}
    </div>}
    {(calendarOn || trainingOn) && <DaysZone week={week} month={month} size={view.bottom} known={known} selected={selected} select={select} open={open}
      cycle={() => setBottom(cycleSize(BOTTOM_SIZES, zones.bottom))} resize={setBottom} preview={previewBottom} showCalendar={showCalendar} />}
  </div>;
}
