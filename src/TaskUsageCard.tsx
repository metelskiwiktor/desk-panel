import { useState } from 'react';
import { Empty } from './components';
import type { TaskUsageEntry } from './task-usage-contract';
import type { TaskUsageState } from './useTaskUsage';

type Mode = 'tokens' | 'cost';
const providerLabels: Record<string, string> = { claude: 'Claude', codex: 'Codex', agy: 'Gemini' };
const providerName = (provider: string | null) => provider ? providerLabels[provider] ?? provider : 'nieznany';
const compact = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
export const tokensLabel = (n: number) => `${compact.format(n)} tok.`;
export const costLabel = (n: number | null) => n === null ? '—' : `$${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const valueOf = (task: Pick<TaskUsageEntry, 'tokensUsed' | 'costUsd'>, mode: Mode) => mode === 'tokens' ? task.tokensUsed : task.costUsd ?? 0;
const dateLabel = (at: number | null) => at === null ? 'w toku' : new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Bars are scaled to the largest task shown, so they compare tasks with each other, not with a limit. */
export function TaskUsageCard({ usage }: { usage: TaskUsageState }) {
  const [mode, setMode] = useState<Mode>('tokens');
  const tasks = usage.tasks.slice(0, 10);
  const max = Math.max(1, ...tasks.map(t => valueOf(t, mode)));
  const total = tasks.reduce((sum, t) => sum + valueOf(t, mode), 0);
  const costKnown = tasks.some(t => t.costUsd !== null);
  const note = usage.status === 'offline' ? (usage.observedAt ? 'Adapter niedostępny — pokazuję ostatnie dane.' : 'Nie można odczytać zużycia z cezar-adapter.')
    : usage.status === 'unavailable' ? 'Cezar nie odpowiada — dane mogą być nieaktualne.' : null;
  return <section className="pulpit-card usage-card" aria-labelledby="usage-title">
    <div className="pulpit-card-head">
      <h2 id="usage-title">Zużycie AI na zadanie</h2>
      <span className="meta">{tasks.length ? `${tasks.length} ostatnich · razem ${mode === 'tokens' ? tokensLabel(total) : costLabel(total)}` : ''}</span>
    </div>
    <div className="usage-mode" role="group" aria-label="Miara zużycia">
      <button className={mode === 'tokens' ? 'active' : ''} aria-pressed={mode === 'tokens'} onClick={() => setMode('tokens')}>Tokeny</button>
      <button className={mode === 'cost' ? 'active' : ''} aria-pressed={mode === 'cost'} disabled={!costKnown} onClick={() => setMode('cost')}>Koszt</button>
    </div>
    {usage.status === 'loading' ? <Empty>Ładowanie zużycia…</Empty> : !tasks.length ? <Empty>Brak zadań ze zużyciem.</Empty> :
      <div className="usage-list">{tasks.map(task => <details key={task.id} className="usage-row">
        <summary>
          <span className="usage-title"><strong>{task.title}</strong><span className="meta">{providerName(task.provider)} · {dateLabel(task.finishedAt ?? task.startedAt)}</span></span>
          <span className={`usage-bar ${task.provider ?? 'unknown'}`} role="img" aria-label={`${task.title}: ${mode === 'tokens' ? tokensLabel(task.tokensUsed) : costLabel(task.costUsd)}`}>
            <span style={{ width: `${Math.max(2, valueOf(task, mode) / max * 100)}%` }} /></span>
          <span className="usage-value">{mode === 'tokens' ? tokensLabel(task.tokensUsed) : costLabel(task.costUsd)}</span>
        </summary>
        <dl>
          <dt>Status</dt><dd>{task.status}</dd>
          <dt>Wejście / wyjście</dt><dd>{task.inputTokens.toLocaleString('pl-PL')} / {task.outputTokens.toLocaleString('pl-PL')} tok.</dd>
          <dt>Ważone (z cache)</dt><dd>{task.tokensUsed.toLocaleString('pl-PL')} tok. · {costLabel(task.costUsd)}</dd>
          {task.steps.map((step, i) => <div key={i} className="usage-step"><dt>{step.name}</dt><dd>{providerName(step.provider)} · {tokensLabel(step.tokensUsed)} · {costLabel(step.costUsd)}</dd></div>)}
        </dl>
      </details>)}</div>}
    {note && <p className="meta warning">{note}</p>}
  </section>;
}
