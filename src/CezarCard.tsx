import { ChevronRight } from 'lucide-react';
import { SourceNote } from './components';
import type { CezarSnapshot } from './cezar-contract';
import { cleanCommand, formatElapsed } from './format';
import { MAX_AGE, fresh, orderedTasks, taskLabels, type DashboardData, type Detail, type Task } from './model';

/** Rows the card shows before it says "i N więcej" (fewer when mail shares the column); the rest is one tap away on the tasks page. */
export const CEZAR_ROWS = 4, CEZAR_ROWS_BESIDE_MAIL = 2;
const waits = (t: Task) => t.status === 'needs-input' || t.status === 'review';

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

function CezarRow({ task, now, open }: { task: Task; now: number; open: (d: Detail) => void }) {
  const needsYou = waits(task);
  const elapsed = formatElapsed(task.startedAt, now);
  const rawId = task.id.split('/')[1] || task.id;
  const shortId = rawId.length > 10 ? rawId.slice(0, 8) : rawId;
  return <li>
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
export function CezarPanel({ data, snapshot, now, open, showAll, beside = false }: {
  data: DashboardData; snapshot: CezarSnapshot | null; now: number; open: (d: Detail) => void; showAll: () => void; beside?: boolean;
}) {
  const active = orderedTasks((data.tasks.data ?? []).filter(t => t.status !== 'done'));
  const rows = [...active.filter(waits), ...active.filter(t => t.status === 'running')];
  const shown = rows.slice(0, beside ? CEZAR_ROWS_BESIDE_MAIL : CEZAR_ROWS);
  const running = rows.filter(t => t.status === 'running').length;
  const alert = rows.some(waits);
  const counts = bucketCounts(snapshot);
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
    <ul className="p2-crows">{shown.map(task => <CezarRow key={task.id} task={task} now={now} open={open} />)}</ul>
    {rows.length > shown.length && <button className="p2-more-link" onClick={showAll}>i {rows.length - shown.length} więcej</button>}
    {!fresh(data.tasks, now, MAX_AGE.tasks) && <SourceNote source={data.tasks} now={now} maxAge={MAX_AGE.tasks} refreshEveryMs={5000} />}
    {snapshot?.partial && <p className="p2-note warn">Lista częściowa — nie wszystkie zadania są dostępne.</p>}
  </section>;
}
