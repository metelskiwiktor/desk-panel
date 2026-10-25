import { Archive, Check, ChevronRight, X } from 'lucide-react';
import { SourceNote } from './components';
import type { CezarSnapshot } from './cezar-contract';
import { agoOrDate, cleanCommand, formatElapsed, formatModelLabel, formatRunningModel } from './format';
import { formatDuration } from './training-view';
import type { FinishedTask } from './cezar-contract';
import { useSwipe } from './useSwipe';
import { ctx } from './chat-context';
import { MAX_AGE, fresh, orderedTasks, taskLabels, type DashboardData, type Detail, type Task } from './model';

/**
 * What the card shows before it says "i N więcej" (less when mail shares the column); the rest is one tap away on the
 * tasks page. A task that waits for you is a line, a running one is a block with its terminal, so a block counts for more.
 */
export const CEZAR_BUDGET = 8, CEZAR_BUDGET_BESIDE_MAIL = 4;
const WAIT_COST = 2, RUN_COST = 4;
const waits = (t: Task) => t.status === 'needs-input' || t.status === 'review';

/** What the agent is told about a task the user pointed at. */
function taskContext(task: { id: string; title: string; project?: string; status: string; description?: string | null; question?: string | null; lastMessage?: string | null }) {
  const status = (taskLabels as Record<string, string>)[task.status] ?? task.status;
  const text = [`Status: ${status}`, task.project ? `Projekt: ${task.project}` : '', task.description ?? '', task.question ? `Pytanie Cezara: ${task.question}` : '', task.lastMessage ? `Ostatnia wiadomość: ${task.lastMessage}` : ''].filter(Boolean).join('\n');
  return ctx('task', task.id, task.title, text);
}

/** "1 nieudane", "3 nieudane", "5 nieudanych". */
const plural = (n: number, few: string, many: string) => n === 1 || (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many;

/** "45 s", "12 min", "1 h 05". */
const tookFor = (from: number, to: number) => to - from < 60_000 ? `${Math.max(0, Math.round((to - from) / 1000))} s` : formatDuration((to - from) / 1000);

/**
 * A finished task: done or failed, in two lines (title; project, workflow, model, diff) with the end time and how long it took.
 * One that Cezar has no read receipt for is marked by a bar on the left and a brighter text. A swipe either way archives it.
 */
function FinishedRow({ task, now, open, archive, markRead }: {
  task: FinishedTask; now: number; open: (d: Detail) => void; archive: (t: FinishedTask) => void; markRead: (t: FinishedTask) => void;
}) {
  const { offset, handlers, isTap } = useSwipe(() => archive(task));
  const failed = task.status === 'failed';
  const diff = task.diffStat && (task.diffStat.adds > 0 || task.diffStat.dels > 0) ? task.diffStat : null;
  const model = formatModelLabel(task.runner, task.model);
  const ended = task.completedAt ? agoOrDate(task.completedAt, now) : '';
  const took = task.startedAt && task.completedAt && task.completedAt >= task.startedAt ? tookFor(task.startedAt, task.completedAt) : '';
  return <li className={`activity-swipe ${offset ? 'dragging' : ''}`} {...taskContext(task)}>
    {offset !== 0 && <span className={`activity-swipe-hint p2-arch-hint ${offset > 0 ? 'from-left' : 'from-right'}`} aria-hidden="true"><Archive size={18} /> Archiwizuj</span>}
    <div className="activity-row" style={{ transform: `translateX(${offset}px)` }}>
      <button className={`p2-frow ${failed ? 'failed' : 'done'} ${task.unread ? 'unread' : 'read'}`} {...handlers}
        aria-label={`${failed ? 'Nieudane' : 'Zakończone'}: ${task.title}${task.unread ? ', nieprzeczytane' : ''}`}
        onClick={event => { if (isTap(event)) { markRead(task); open({ kind: 'task', id: task.id }); } }}>
        <span className="p2-fmark" aria-hidden="true">{failed ? <X size={15} /> : <Check size={15} />}</span>
        <span className="p2-frow-body">
          <strong>{task.title}</strong>
          <span className="p2-frow-sub">
            <span>{task.project}</span>
            {task.workflow && <b className="wf">{task.workflow}</b>}
            {model && <i className="md">{model}</i>}
            {diff && <span><em className="plus">+{diff.adds}</em> <em className="minus">−{diff.dels}</em></span>}
          </span>
        </span>
        <span className="p2-frow-side">
          <span>{ended}</span><span>{took}</span>
        </span>
      </button>
      {/* Touch works by swipe only; this stays for keyboard and screen readers, out of sight. */}
      <button className="activity-remove mail-action-hidden" aria-label={`Archiwizuj: ${task.title}`} onClick={() => archive(task)}><Archive size={17} /></button>
    </div>
  </li>;
}

/** "2 w kolejce · 4 do przeglądu": the buckets that are not already shown as running. */
function bucketCounts(snapshot: CezarSnapshot | null) {
  const counts = snapshot?.counts;
  if (!counts) return '';
  return (['queue', 'review', 'needs-input'] as const)
    .filter(s => counts[s])
    .map(s => `${counts[s]} ${taskLabels[s].toLowerCase()}`)
    .join(' · ');
}

/** What a running task is doing right now, in one line. */
function activityLine(task: Task) {
  if (task.activityDetail?.state === 'thinking') return task.activityDetail.message || 'Planuje następny krok';
  const command = cleanCommand(task.activityDetail?.activeToolInput || task.activityDetail?.message || task.activity);
  if (command) return command;
  return task.currentStep?.name ?? 'Pracuje nad zadaniem';
}

/** A running task: where it is and who works on it, then a terminal with the command, the step, the diff and the checks. */
function RunningRow({ task, now, open }: { task: Task; now: number; open: (d: Detail) => void }) {
  const elapsed = formatElapsed(task.startedAt, now);
  const rawId = task.id.split('/')[1] || task.id;
  const shortId = rawId.length > 10 ? rawId.slice(0, 8) : rawId;
  const model = formatRunningModel(task.runner, task.model);
  const thinking = task.activityDetail?.state === 'thinking';
  const command = cleanCommand(task.activityDetail?.activeToolInput || task.activityDetail?.message || task.activity);
  const diff = task.diffStat;
  const hasDiff = !!diff && (diff.adds > 0 || diff.dels > 0);
  const checks = task.checks && task.checks.total > 0 ? task.checks : null;
  const step = task.currentStep?.name;
  return <li {...taskContext(task)}>
    <button className="p2-crow runs full" onClick={() => open({ kind: 'task', id: task.id })}>
      <i className="p2-cdot" aria-hidden="true" />
      <span className="p2-crow-body">
        <span className="p2-run-head">
          <span>{task.project}</span><span className="p2-run-id">#{shortId}</span>
          {task.branch && <span className="p2-chip branch">{task.branch}</span>}
          {elapsed && <b className={`p2-run-time ${elapsed.isLong ? 'long' : ''}`}>{elapsed.text}</b>}
        </span>
        <span className="p2-run-title">
          <strong>{task.title}</strong>
          {task.workflow && <span className="p2-chip workflow">{task.workflow}</span>}
          {model && <span className="p2-chip model">{model}</span>}
        </span>
        <span className={`p2-term ${thinking ? 'thinking' : ''}`}>
          {thinking ? <span className="p2-term-cmd"><i>&gt;</i> {task.activityDetail?.message || 'Planuje następny krok'}</span>
            : <span className="p2-term-cmd"><i>$</i>{task.activityDetail?.activeTool && <b>{task.activityDetail.activeTool}</b>} <code>{command || 'Agent wykonuje zadanie w toku…'}</code></span>}
          {step && <span className="p2-term-step">Krok: {step}{task.currentStep?.status ? ` (${task.currentStep.status})` : ''}</span>}
          <span className="p2-term-foot">
            <span>{hasDiff ? <>Diff: <em className="plus">+{diff!.adds}</em> <em className="minus">−{diff!.dels}</em>{diff!.files > 0 && ` (${diff!.files} pl.)`}</> : 'Diff: brak zmian'}</span>
            {checks && <span className={checks.failed ? 'bad' : 'good'}>Testy {checks.passed}/{checks.total}{checks.failed ? '' : ' OK'}</span>}
          </span>
        </span>
      </span>
    </button>
  </li>;
}

function CezarRow({ task, now, open }: { task: Task; now: number; open: (d: Detail) => void }) {
  const needsYou = waits(task);
  if (!needsYou) return <RunningRow task={task} now={now} open={open} />;
  const elapsed = formatElapsed(task.startedAt, now);
  const rawId = task.id.split('/')[1] || task.id;
  const shortId = rawId.length > 10 ? rawId.slice(0, 8) : rawId;
  return <li {...taskContext(task)}>
    <button className={`p2-crow ${needsYou ? 'waits' : 'runs'}`} onClick={() => open({ kind: 'task', id: task.id })}>
      <i className="p2-cdot" aria-hidden="true" />
      <span className="p2-crow-body">
        <strong>{task.title}</strong>
        <span className="p2-crow-sub">
          <span>{task.project} · #{shortId}</span>
          {needsYou
            ? task.question && <em>„{task.question}”</em>
            : <code>{activityLine(task)}</code>}
        </span>
      </span>
      <span className="p2-crow-side">
        <b>{needsYou ? (task.status === 'needs-input' ? 'Odpowiedz' : 'Przegląd') : elapsed?.text ?? 'w toku'}</b>
        {!needsYou && task.checks && task.checks.total > 0 && <small className={task.checks.failed ? 'bad' : ''}>testy {task.checks.passed}/{task.checks.total}</small>}
        {!needsYou && !(task.checks && task.checks.total > 0) && task.diffStat && (task.diffStat.adds > 0 || task.diffStat.dels > 0) && <small>+{task.diffStat.adds} −{task.diffStat.dels}</small>}
      </span>
    </button>
  </li>;
}

/**
 * Cezar's tasks that wait for you, then those that run. Without any, only the chip in the header speaks
 * for Cezar, so this card is only drawn while there is something to look at.
 */
export function CezarPanel({ data, snapshot, now, open, showAll, beside = false, finished = [], archive, restore, markRead, undo = false, error = '' }: {
  data: DashboardData; snapshot: CezarSnapshot | null; now: number; open: (d: Detail) => void; showAll: () => void; beside?: boolean;
  finished?: FinishedTask[]; archive?: (t: FinishedTask) => void; restore?: () => void; markRead?: (t: FinishedTask) => void; undo?: boolean; error?: string;
}) {
  const active = orderedTasks((data.tasks.data ?? []).filter(t => t.status !== 'done'));
  const rows = [...active.filter(waits), ...active.filter(t => t.status === 'running')];
  // Finished tasks take half the room, so the first of them is in view without scrolling.
  let budget = Math.ceil((beside ? CEZAR_BUDGET_BESIDE_MAIL : CEZAR_BUDGET) / (finished.length ? 2 : 1));
  const shown = rows.filter((task, index) => {
    if (index > 0 && budget <= 0) return false;
    budget -= waits(task) ? WAIT_COST : RUN_COST;
    return index === 0 || budget >= 0;
  });
  const running = rows.filter(t => t.status === 'running').length;
  const alert = rows.some(waits);
  const done = finished.filter(t => t.status === 'done').length, failed = finished.length - done;
  const counts = [bucketCounts(snapshot), done ? `${done} ${plural(done, 'zakończone', 'zakończonych')}` : '', failed ? `${failed} ${plural(failed, 'nieudane', 'nieudanych')}` : ''].filter(Boolean).join(' · ');
  // One task is a single line under a small label; the head with counts and the way to all tasks is for a longer list.
  const single = rows.length === 1 && !counts;
  return <section className={`p2-card p2-cezar ${alert ? 'alert' : ''} ${single ? 'single' : ''}`} aria-labelledby="cezar-title">
    {single ? <h2 id="cezar-title" className="p2-eyebrow">Cezar</h2>
      : <button type="button" className="p2-card-head" onClick={showAll} aria-label="Otwórz zadania Cezara">
        <i className={`p2-cdot ${alert ? 'waits' : 'runs'}`} aria-hidden="true" />
        <h2 id="cezar-title">Cezar</h2>
        {counts && <span className="p2-meta">{counts}</span>}
        {running > 0 && <span className="p2-badge cezar">{running} w toku</span>}
        <ChevronRight size={20} aria-hidden="true" />
      </button>}
    {/* The active tasks and the finished ones scroll together in what the card has left. */}
    <div className="p2-cbody">
      {!rows.length && !finished.length && <p className="p2-empty">{data.tasks.data === null ? (data.tasks.status === 'loading' ? 'Ładowanie zadań…' : 'Cezar jest niedostępny.') : 'Nic nie czeka ani nie trwa.'}</p>}
      <ul className="p2-crows">{shown.map(task => <CezarRow key={task.id} task={task} now={now} open={open} />)}</ul>
      {rows.length > shown.length && <button className="p2-more-link" onClick={showAll}>i {rows.length - shown.length} więcej</button>}
      {finished.length > 0 && archive && markRead && <ul className="activity-list p2-fin" aria-label="Zakończone zadania">
        {finished.map(task => <FinishedRow key={task.id} task={task} now={now} open={open} archive={archive} markRead={markRead} />)}
      </ul>}
    </div>
    {(undo || error) && <div className="p2-undo" role="status">
      {undo && <><span>Zarchiwizowano w Cezarze.</span><button onClick={restore}>Cofnij</button></>}
      {error && <span className="p2-note warn">{error}</span>}
    </div>}
    {!fresh(data.tasks, now, MAX_AGE.tasks) && <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />}
    {snapshot?.partial && <p className="p2-note warn">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
  </section>;
}
