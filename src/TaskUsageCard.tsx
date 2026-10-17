import { useState } from 'react';
import { Empty } from './components';
import type { TaskUsageEntry } from './task-usage-contract';
import type { TaskUsageState } from './useTaskUsage';

type Mode = 'limit5' | 'limit7' | 'tokens' | 'cost';
const providerLabels: Record<string, string> = { claude: 'Claude', codex: 'Codex', agy: 'Gemini' };
const providerName = (provider: string | null) => provider ? providerLabels[provider] ?? provider : 'nieznany';
const compact = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
const points = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
export const tokensLabel = (n: number) => `${compact.format(n)} tok.`;
export const costLabel = (n: number | null) => n === null ? '—' : `$${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pointsLabel = (n: number | null) => n === null ? '—' : `${points.format(n)} p.p.`;
const noteLabels = { overlap: 'Równolegle działało inne zadanie lub sesja na tym koncie — wynik orientacyjny.',
  window_reset: 'Okno limitu zresetowało się w trakcie zadania — nie da się policzyć zużycia.',
  no_samples: 'Brak pomiarów limitu z tego czasu (zapisujemy je od niedawna).', unsupported: 'Dla tego narzędzia nie mierzymy limitu.' } as const;
const limitOf = (task: TaskUsageEntry, mode: Mode) => mode === 'limit5' ? task.quota.fiveHour : task.quota.sevenDay;
const valueOf = (task: TaskUsageEntry, mode: Mode) => mode === 'tokens' ? task.tokensUsed : mode === 'cost' ? task.costUsd ?? 0 : limitOf(task, mode) ?? 0;
const label = (task: TaskUsageEntry, mode: Mode) => mode === 'tokens' ? tokensLabel(task.tokensUsed) : mode === 'cost' ? costLabel(task.costUsd) : pointsLabel(limitOf(task, mode));
const dateLabel = (at: number | null) => at === null ? 'w toku' : new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const modeNames: Record<Mode, string> = { limit5: 'Limit 5h', limit7: 'Limit 7d', tokens: 'Tokeny', cost: 'Koszt' };

/** Bars are scaled to the largest task shown. Limit mode is how far the account's limit moved, in percentage points. */
export function TaskUsageCard({ usage }: { usage: TaskUsageState }) {
  const [mode, setMode] = useState<Mode>('limit5');
  const tasks = usage.tasks.slice(0, 10);
  const max = Math.max(mode.startsWith('limit') ? 1 : 1e-9, ...tasks.map(t => valueOf(t, mode)));
  const total = tasks.reduce((sum, t) => sum + valueOf(t, mode), 0);
  const enabled = (m: Mode) => m === 'tokens' || (m === 'cost' ? tasks.some(t => t.costUsd !== null) : tasks.some(t => limitOf(t, m) !== null));
  const totalLabel = mode === 'tokens' ? tokensLabel(total) : mode === 'cost' ? costLabel(total) : pointsLabel(total);
  const note = usage.status === 'offline' ? (usage.observedAt ? 'Adapter niedostępny — pokazuję ostatnie dane.' : 'Nie można odczytać zużycia z cezar-adapter.')
    : usage.status === 'unavailable' ? 'Cezar nie odpowiada — dane mogą być nieaktualne.' : null;
  return <section className="pulpit-card usage-card" aria-labelledby="usage-title">
    <div className="pulpit-card-head">
      <h2 id="usage-title">Zużycie AI na zadanie</h2>
      <span className="meta">{tasks.length ? `${tasks.length} ostatnich · razem ${totalLabel}` : ''}</span>
    </div>
    <div className="usage-mode" role="group" aria-label="Miara zużycia">
      {(Object.keys(modeNames) as Mode[]).map(m => <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} disabled={!enabled(m)} onClick={() => setMode(m)}>{modeNames[m]}</button>)}
    </div>
    {mode.startsWith('limit') && <p className="meta">O ile punktów procentowych limitu spadło w trakcie zadania (zmiana na koncie, nie koszt w tokenach).</p>}
    {usage.status === 'loading' ? <Empty>Ładowanie zużycia…</Empty> : !tasks.length ? <Empty>Brak zadań ze zużyciem.</Empty> :
      <div className="usage-list">{tasks.map(task => <details key={task.id} className="usage-row">
        <summary>
          <span className="usage-title"><strong>{task.title}</strong><span className="meta">{providerName(task.provider)} · {dateLabel(task.finishedAt ?? task.startedAt)}{task.quota.note === 'overlap' ? ' · równolegle' : ''}</span></span>
          <span className={`usage-bar ${task.provider ?? 'unknown'}`} role="img" aria-label={`${task.title}: ${label(task, mode)}`}>
            <span style={{ width: `${valueOf(task, mode) > 0 ? Math.max(2, valueOf(task, mode) / max * 100) : 0}%` }} /></span>
          <span className="usage-value">{label(task, mode)}</span>
        </summary>
        <dl>
          <dt>Limit 5h / 7d</dt><dd>{pointsLabel(task.quota.fiveHour)} / {pointsLabel(task.quota.sevenDay)}</dd>
          {task.quota.note && <><dt>Uwaga</dt><dd>{noteLabels[task.quota.note]}</dd></>}
          <dt>Status</dt><dd>{task.status}</dd>
          <dt>Wejście / wyjście</dt><dd>{task.inputTokens.toLocaleString('pl-PL')} / {task.outputTokens.toLocaleString('pl-PL')} tok.</dd>
          <dt>Ważone (z cache)</dt><dd>{task.tokensUsed.toLocaleString('pl-PL')} tok. · {costLabel(task.costUsd)}</dd>
          {task.steps.map((step, i) => <div key={i} className="usage-step"><dt>{step.name}</dt><dd>{providerName(step.provider)} · {tokensLabel(step.tokensUsed)} · {costLabel(step.costUsd)}</dd></div>)}
        </dl>
      </details>)}</div>}
    {note && <p className="meta warning">{note}</p>}
  </section>;
}
