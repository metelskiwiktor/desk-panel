import { SourceNote, Sparkline } from './components';
import { cleanCommand, formatElapsed, formatModelLabel } from './format';
import { dayRibbon } from './day-ribbon';
import { DayRibbonView, MeetingFocus } from './DayRibbon';
import { MAX_AGE, fresh, orderedTasks, taskLabels, type DashboardData, type Detail, type SystemSample, type Task } from './model';
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

/** Cezar's tasks that wait for you or run. Without any, only the chip in the header speaks for Cezar. */
function CezarPanel({ data, snapshot, now, open, showAll }: {
  data: DashboardData; snapshot: CezarSnapshot | null; now: number; open: (d: Detail) => void; showAll: () => void;
}) {
  const allTasks = orderedTasks((data.tasks.data ?? []).filter(t => t.status !== 'done'));
  const waiting = allTasks.filter(t => t.status === 'needs-input' || t.status === 'review');
  const running = allTasks.filter(t => t.status === 'running');
  const counts = snapshot?.counts;
  const ok = fresh(data.tasks, now, MAX_AGE.tasks);

  // Do NOT duplicate running count in countsLabel: only show other non-running buckets (queue, review, needs-input)
  const nonRunningCounts = counts
    ? (['queue', 'review', 'needs-input'] as const)
        .filter(s => counts[s] && counts[s]! > 0)
        .map(s => `${counts[s]} ${taskLabels[s].toLowerCase()}`)
        .join(' · ')
    : '';

  const isLive = running.length > 0;
  const hasAlert = waiting.length > 0;

  const shownWaiting = waiting.slice(0, 3);
  const shownRunning = running.slice(0, 3);
  const shownCount = shownWaiting.length + shownRunning.length;

  return (
    <section className="pulpit-card cezar-hud" aria-labelledby="cezar-title">
      <button
        type="button"
        className="hud-header"
        onClick={showAll}
        aria-label="Otwórz zadania Cezara"
      >
        <div className="hud-header-title">
          <i className={`hud-dot ${hasAlert ? 'alert' : isLive ? 'live' : 'idle'}`} />
          <h2 id="cezar-title">Cezar</h2>
          {nonRunningCounts && <span className="meta hud-counts">{nonRunningCounts}</span>}
        </div>
        <div className="hud-header-right">
          <span className={`hud-badge-status ${isLive ? 'live' : hasAlert ? 'alert' : 'idle'}`}>
            {isLive
              ? `${running.length} ${running.length === 1 ? 'PROCES AKTYWNY' : 'PROCESY AKTYWNE'}`
              : hasAlert
              ? 'WYMAGA UWAGI'
              : 'GOTOWY'}
          </span>
          <span className="hud-header-arrow">→</span>
        </div>
      </button>

      {/* Attention rows for tasks needing input or review */}
      {shownWaiting.map((task: Task) => (
        <button
          key={task.id}
          className={`hud-alert-row ${task.status}`}
          onClick={() => open({ kind: 'task', id: task.id })}
        >
          <div className="hud-alert-badge">
            <span className="hud-tag-project">{task.project}</span>
            <span className="hud-tag-id">#{task.id.split('/')[1] || task.id}</span>
            <span className="hud-tag-status">
              {task.status === 'needs-input' ? 'Wymaga odpowiedzi' : taskLabels[task.status]}
            </span>
          </div>
          <div className="hud-alert-content">
            <strong className="hud-alert-title">{task.title}</strong>
            {task.question && <p className="hud-alert-question">„{task.question}”</p>}
          </div>
        </button>
      ))}

      {/* Running active processes */}
      {shownRunning.length > 0 && (
        <div className="hud-processes">
          {shownRunning.map((task: Task) => {
            const rawId = task.id.split('/')[1] || task.id;
            const shortId = rawId.slice(0, 8);
            const tool = task.activityDetail?.activeTool || (task.activity ? 'BASH' : undefined);
            const rawCmd = task.activityDetail?.activeToolInput || task.activityDetail?.message || task.activity;
            const cleanedCmd = cleanCommand(rawCmd);
            const diff = task.diffStat;
            const hasDiff = diff && (diff.adds > 0 || diff.dels > 0);
            const modelLabel = formatModelLabel(task.runner, task.model);
            const elapsedInfo = formatElapsed(task.startedAt, now);
            const isThinking = task.activityDetail?.state === 'thinking';
            const isTool = !!cleanedCmd && !isThinking;

            return (
              <button
                key={task.id}
                className="hud-process-block"
                onClick={() => open({ kind: 'task', id: task.id })}
              >
                <div className="hud-process-head">
                  <div className="hud-process-id-line">
                    <span className="hud-chip-project">{task.project}</span>
                    <span className="hud-chip-id">#{shortId}</span>
                    {task.branch && <span className="hud-chip-branch">({task.branch})</span>}
                    <span className="hud-process-title">{task.title}</span>
                  </div>
                  <div className="hud-process-meta-right">
                    {task.workflow && <span className="hud-chip-workflow">{task.workflow}</span>}
                    {modelLabel && <span className="hud-chip-runner">{modelLabel}</span>}
                    {elapsedInfo && (
                      <span
                        className={`hud-chip-time ${elapsedInfo.isLong ? 'long-running' : 'normal'}`}
                        title={`Czas trwania: ${elapsedInfo.text}`}
                      >
                        <span className="hud-time-icon">{elapsedInfo.isLong ? '⏳' : '⏱️'}</span>
                        <span className="hud-time-val">{elapsedInfo.text}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Terminal gutter box with left border */}
                <div className={`hud-process-terminal ${isThinking ? 'thinking' : isTool ? 'tool' : 'idle'}`}>
                  {isThinking ? (
                    <div className="hud-term-cmd thinking">
                      <span className="hud-prompt-symbol">&gt;</span>{' '}
                      <span className="hud-term-text">{task.activityDetail?.message || 'Analiza i planowanie kolejnego kroku...'}</span>
                    </div>
                  ) : cleanedCmd ? (
                    <div className="hud-term-cmd tool">
                      <span className="hud-prompt-symbol">$</span>{' '}
                      <span className="hud-tool-tag">{tool || 'BASH'}</span>{' '}
                      <code className="hud-cmd-code">{cleanedCmd}</code>
                    </div>
                  ) : (
                    <div className="hud-term-cmd idle">
                      <span className="hud-prompt-symbol">$</span>{' '}
                      <span className="hud-term-text">Agent wykonuje zadanie w toku...</span>
                    </div>
                  )}

                  {task.currentStep?.name && (
                    <div className="hud-term-step">
                      <span className="hud-step-label">Krok:</span> {task.currentStep.name}
                      {task.currentStep.status && <span className="hud-step-status"> ({task.currentStep.status})</span>}
                    </div>
                  )}

                  <div className="hud-term-footer">
                    <div className="hud-term-meta-left">
                      <span className="hud-diff-tag">
                        Diff:{' '}
                        {hasDiff ? (
                          <>
                            <span className="diff-plus">+{diff.adds}</span>{' '}
                            <span className="diff-minus">-{diff.dels}</span>
                            {diff.files > 0 && <span className="diff-files"> ({diff.files} pl.)</span>}
                          </>
                        ) : (
                          <span className="diff-none">brak zmian</span>
                        )}
                      </span>
                    </div>
                    {task.checks && task.checks.total > 0 && (
                      <span className={`hud-checks-tag ${task.checks.failed > 0 ? 'failed' : 'passed'}`}>
                        Checks: {task.checks.passed}/{task.checks.total} OK
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );

          })}
        </div>
      )}

      {allTasks.length > shownCount && (
        <button className="link-button hud-more-button" onClick={showAll}>
          i {allTasks.length - shownCount} więcej
        </button>
      )}

      {!ok && <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />}
      {snapshot?.partial && <p className="warning">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
    </section>
  );
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
        {cezarBusy && <CezarPanel data={data} snapshot={snapshot} now={now} open={open} showAll={showTasks} />}
        {mailShown && <MailFeed mail={mail} now={now} open={open} />}
      </aside>}
    </div>
    {todayOn && <WeekStrip days={week} known={(calendarOn && data.calendar.data !== null) || (trainingOn && training.data !== null)} open={open} />}
  </div>;
}
