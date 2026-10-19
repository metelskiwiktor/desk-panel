import { ChevronDown } from 'lucide-react';
import { Empty, SourceNote, Sparkline, quotaReason } from './components';
import { time, elapsed, formatElapsed, cleanCommand, formatModelLabel } from './format';
import { todayAgenda, upcomingDays } from './agenda';
import { MAX_AGE, fresh, orderedTasks, quotaState, taskLabels, type DashboardData, type Detail, type Provider, type QuotaAccount, type QuotaSnapshot, type SystemSample, type Task } from './model';
import { normalizeQuotaWindow, quotaPace, quotaPaceLabels, quotaResetIn, sortSnapshots } from './quota-pace';
import type { CezarSnapshot } from './cezar-contract';
import type { MailState } from './useMail';
import { MailFeed } from './MailFeed';
import type { WidgetId } from './layout';
import { UsageBreakdownCard, breakdownPieces } from './UsageBreakdownCard';
import type { UsageBreakdownState } from './useUsageBreakdown';

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
  const allTasks = orderedTasks((data.tasks.data ?? []).filter(t => t.status !== 'done'));
  const waiting = allTasks.filter(t => t.status === 'needs-input' || t.status === 'review');
  const running = allTasks.filter(t => t.status === 'running');
  const queue = allTasks.filter(t => t.status === 'queue');
  const counts = snapshot?.counts;
  const ok = fresh(data.tasks, now, MAX_AGE.tasks);

  if (data.tasks.data === null) {
    const isLoading = data.tasks.status === 'loading';
    return (
      <section className="pulpit-card cezar-hud cezar-hud-compact" aria-label="Cezar">
        <div className="hud-idle-button">
          <div className="hud-idle-left">
            <i className={`hud-dot ${isLoading ? 'idle' : 'alert'}`} />
            <div className="hud-idle-texts">
              <strong className="hud-idle-title">{isLoading ? 'Cezar · ładowanie…' : 'Cezar niedostępny'}</strong>
              <span className="hud-idle-meta">{isLoading ? 'Pobieranie stanu zadań...' : 'Ponawiam co 5 s'}</span>
            </div>
          </div>
          <div className="hud-idle-right">
            <span className={`hud-badge-status ${isLoading ? 'idle' : 'alert'}`}>
              {isLoading ? 'ŁADOWANIE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </section>
    );
  }

  if (!waiting.length && !running.length) {
    return (
      <section className="pulpit-card cezar-hud cezar-hud-compact" aria-label="Cezar">
        <button
          type="button"
          className="hud-idle-button"
          onClick={showAll}
          aria-label="Otwórz zadania Cezara"
        >
          <div className="hud-idle-left">
            <i className="hud-dot live" />
            <div className="hud-idle-texts">
              <strong className="hud-idle-title">Cezar · nic nie czeka na Ciebie</strong>
              <span className="hud-idle-meta">
                {queue.length ? `${queue.length} w kolejce` : 'Brak zadań w toku · system gotowy'}
              </span>
            </div>
          </div>
          <div className="hud-idle-right">
            <span className="hud-badge-status idle">GOTOWY</span>
            <span className="hud-header-arrow">→</span>
          </div>
        </button>
        {!ok && <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />}
      </section>
    );
  }

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
          <span className="hud-alert-action">Otwórz →</span>
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

const BREAKDOWN_RESET_SLACK_MS = 10 * 60_000;
/** The 5h bar is drawn in source colours when the breakdown describes the same window; otherwise it stays one colour. */
export function splitFor(snapshot: QuotaSnapshot, card: QuotaCardItem, usage: UsageBreakdownState) {
  const name = card.provider === 'AGY' ? (card.title === 'Gemini' ? 'Gemini' : null) : card.provider;
  const provider = usage.status === 'offline' ? undefined : usage.providers.find(p => p.provider === name);
  if (!provider || provider.usedPercent === null || normalizeQuotaWindow(snapshot.window) !== '5h' || !provider.segments.length) return undefined;
  if (snapshot.resetAt && provider.resetAt && Math.abs(snapshot.resetAt - provider.resetAt) > BREAKDOWN_RESET_SLACK_MS) return undefined;
  return breakdownPieces(provider);
}

function QuotaBar({ snapshot, now, connected, split }: { snapshot: QuotaSnapshot; now: number; connected: boolean; split?: ReturnType<typeof breakdownPieces> }) {
  const measured = quotaState(snapshot, now);
  const state = !connected && measured === 'fresh' ? 'stale' : measured;
  const pace = state === 'fresh' ? quotaPace(snapshot, now) : null;
  const windowLabel = normalizeQuotaWindow(snapshot.window) || snapshot.window;
  return <div className={`quota-bar ${pace ? `quota-pace-${pace.tone}` : 'quota-muted'}`}>
    <span className="quota-window-label">{windowLabel}</span>
    <span className="quota-track" role="meter" aria-label={`Użycie limitu ${windowLabel}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.usedPercent ?? undefined}
      aria-valuetext={pace ? `Zużyto ${snapshot.usedPercent}%, czas okna ${Math.round(pace.elapsedPercent)}%. ${quotaPaceLabels[pace.tone]}.` : 'Brak aktualnego pomiaru'}>
      {state !== 'unavailable' && (split && state === 'fresh'
        ? <span className="quota-fill quota-split" style={{ width: `${snapshot.usedPercent}%` }}>{split.map((p, i) => <i key={i} title={p.label} style={{ flex: `${p.percent} 1 0`, background: p.color }} />)}</span>
        : <span className="quota-fill" style={{ width: `${snapshot.usedPercent}%` }} />)}
      {pace && <i className="quota-tick" style={{ left: `${pace.elapsedPercent}%` }} aria-hidden="true" />}
    </span>
    <strong className="quota-value">{state === 'unavailable' ? '—' : `${Number(snapshot.usedPercent!.toFixed(1))}%`}</strong>
    <span className="quota-sub">{snapshot.state === 'auth_required' ? 'wymaga logowania' : pace ? `czas ${Math.round(pace.elapsedPercent)}% · reset za ${quotaResetIn(snapshot.resetAt!, now)}` : state === 'unavailable' ? snapshot.reason ? quotaReason(snapshot.reason) : 'brak pomiaru' : state === 'fresh' ? snapshot.resetAt ? `reset za ${quotaResetIn(snapshot.resetAt, now)}` : 'reset nieznany' : snapshot.reason === 'http_429' ? `limit zapytań dostawcy${snapshot.retryAt ? ` · kolejna próba ${time(snapshot.retryAt)}` : ''} · ostatnia obserwacja` : 'nieaktualne · ostatnia obserwacja'}{snapshot.state && snapshot.observedAt !== null && ` · odczyt ${time(snapshot.observedAt)}`}</span>
  </div>;
}

interface QuotaCardItem {
  id: string;
  provider: Provider;
  title: string;
  badge?: string;
  snapshots: QuotaSnapshot[];
  reason?: string | null;
}


function getQuotaCards(accounts: QuotaAccount[] | null): QuotaCardItem[] {
  if (!accounts) return [];
  const cards: QuotaCardItem[] = [];

  for (const account of accounts) {
    if (account.provider !== 'AGY') {
      cards.push({
        id: account.provider,
        provider: account.provider,
        title: account.provider,
        snapshots: sortSnapshots(account.snapshots),
        reason: account.reason,
      });
      continue;
    }

    const groups = new Map<string, QuotaSnapshot[]>();
    for (const s of account.snapshots) {
      const groupName = s.model || 'Gemini Models';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(s);
    }

    if (groups.size === 0) {
      cards.push({
        id: 'agy-empty',
        provider: 'AGY',
        title: 'Gemini',
        snapshots: [],
        reason: account.reason,
      });
      continue;
    }

    for (const [model, snapshots] of groups.entries()) {
      let title = model;
      let badge: string | undefined;

      if (model === 'Gemini Models' || model === 'Gemini') {
        title = 'Gemini';
      } else if (model === 'Claude and GPT models' || model === 'Claude & GPT') {
        title = 'Agy: Claude & GPT';
      } else if (model.includes('Argon')) {
        title = 'Gemini 4 Argon';
        badge = 'frontier';
      }

      cards.push({
        id: `agy:${model}`,
        provider: 'AGY',
        title,
        badge,
        snapshots: sortSnapshots(snapshots),
      });
    }
  }

  return cards;
}

function QuotaStrip({ data, now, open, usage }: { data: DashboardData; now: number; open: (d: Detail) => void; usage: UsageBreakdownState }) {
  const cards = getQuotaCards(data.quotas.data);
  const connected = fresh(data.quotas, now, MAX_AGE.quotas);
  return <section className="pulpit-card quota-strip" aria-label="Limity AI">
    {cards.length ? cards.map(c => <button key={c.id} className="quota-provider" onClick={() => open({ kind: 'quota', provider: c.provider })}>
      <div className="quota-provider-header">
        <strong>{c.title}</strong>
        {c.badge && <span className="quota-badge">{c.badge}</span>}
      </div>
      {!c.snapshots.length && <span className="quota-sub">{c.reason ? quotaReason(c.reason) : "Brak pomiaru"}</span>}
      {c.snapshots.map(s => <QuotaBar key={`${s.model || ""}:${s.window}`} snapshot={s} now={now} connected={connected} split={splitFor(s, c, usage)} />)}
    </button>) : <Empty>{data.quotas.status === 'loading' ? 'Ładowanie limitów…' : 'Brak limitów AI.'}</Empty>}
    {!connected && <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={60000} />}
  </section>;
}

/**
 * The dashboard sizes itself to its content and the screen: the Komputer card only appears on a
 * problem, Cezar folds to one line when nothing waits for you, and long mail lists scroll locally.
 */
export function Dashboard({ data, snapshot, mail, usageBreakdown, now, open, showTasks, visible }: {
  data: DashboardData; usageBreakdown: UsageBreakdownState; snapshot: CezarSnapshot | null; mail: MailState; now: number;
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
    {visible('quotas') && <QuotaStrip data={data} now={now} open={open} usage={usageBreakdown} />}
    {visible('breakdown') && <UsageBreakdownCard usage={usageBreakdown} />}
  </div>;
}
