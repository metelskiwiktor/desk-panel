import { Empty } from './components';
import type { UsageProvider, UsageSegment } from './usage-breakdown-contract';
import type { UsageBreakdownState } from './useUsageBreakdown';

const SOURCE_COLORS = ['#378ADD', '#1D9E75', '#85B7EB', '#BA7517', '#7F77DD', '#D4537E'];
const points = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
export const pointsLabel = (n: number) => `${points.format(n)} p.p.`;
const providerNames = { Claude: 'Claude', Codex: 'ChatGPT / Codex', Gemini: 'Gemini (Antigravity)' } as const;
const sum = (segments: UsageSegment[], kinds: UsageSegment['kind'][]) => segments.filter(s => kinds.includes(s.kind)).reduce((n, s) => n + s.percent, 0);

const originNames = { cezar: 'Cezar', 'claude-app': 'Claude (aplikacja)', 'claude-cli': 'Claude Code (terminal)', 'codex-app': 'ChatGPT / Codex (aplikacja)', 'codex-cli': 'Codex (terminal)', 'antigravity-app': 'Antigravity (aplikacja)', 'antigravity-cli': 'Antigravity (terminal)', warmup: 'Warmup', unknown: 'Sesja lokalna' } as const;
export function segmentLabel(segment: UsageSegment) {
  const shared = segment.shared ? ' (równolegle)' : '';
  if (segment.kind === 'task') return `Cezar · ${segment.title ?? 'zadanie'}${shared}`;
  if (segment.kind === 'session' && segment.origin === 'warmup') return 'Automatyczny warmup';
  if (segment.kind === 'session') return segment.origin === 'cezar' ? `Cezar · ${segment.title ?? 'pomocnicze'}${shared}` : `${originNames[segment.origin ?? 'unknown']} · ${segment.title ?? 'bez nazwy'}${shared}`;
  return segment.kind === 'tasks_rest' ? 'Pozostałe źródła' : segment.kind === 'other' ? 'Inne źródła (bez śladu w sesjach)' : 'Sprzed pomiarów';
}
const HATCH = 'repeating-linear-gradient(135deg, #3a4659 0 3px, #263041 3px 6px)';
function colorOf(segment: UsageSegment, taskIndex: number) {
  return segment.kind === 'task' || segment.kind === 'session' ? SOURCE_COLORS[taskIndex % SOURCE_COLORS.length] : segment.kind === 'tasks_rest' ? '#4f6a8f' : segment.kind === 'other' ? '#8593a8' : HATCH;
}

function ProviderRow({ provider }: { provider: UsageProvider }) {
  if (provider.usedPercent === null) return <div className="breakdown-row">
    <div className="breakdown-head"><strong>{providerNames[provider.provider]}</strong><span className="meta">brak aktualnego pomiaru</span></div></div>;
  let taskIndex = 0;
  const coloured = provider.segments.map(s => ({ s, color: colorOf(s, s.kind === 'task' || s.kind === 'session' ? taskIndex++ : 0) }));
  const cezar = sum(provider.segments, ['task']), local = sum(provider.segments, ['session']), other = sum(provider.segments, ['other', 'tasks_rest']), before = sum(provider.segments, ['unobserved']);
  return <div className="breakdown-row">
    <div className="breakdown-summary">
      <span className="breakdown-head"><strong>{providerNames[provider.provider]}</strong><span className="meta">okno 5h · {Math.round(provider.usedPercent)}% zużyte</span></span>
      <span className="breakdown-bar" role="img" aria-label={`${providerNames[provider.provider]}: ${Math.round(provider.usedPercent)}% limitu 5h. Zadania Cezara ${points.format(cezar)}, sesje poza Cezarem ${points.format(local)}, inne źródła ${points.format(other)}, sprzed pomiarów ${points.format(before)} punktów procentowych.`}>
        {coloured.map(({ s, color }, i) => <i key={i} style={{ width: `${s.percent}%`, background: color }} />)}</span>
    </div>
    <ul className="breakdown-legend">{coloured.map(({ s, color }, i) => <li key={i}><i style={{ background: color }} aria-hidden="true" /><span>{segmentLabel(s)}</span><span className="meta">{pointsLabel(s.percent)}</span></li>)}</ul>
  </div>;
}

/** Each bar is the provider's whole 5h limit; coloured parts are what filled it, named in the legend under it. Approximate: rises are matched to what was running. */
export function UsageBreakdownCard({ usage }: { usage: UsageBreakdownState }) {
  const providers = usage.providers.filter(p => p.usedPercent !== null);
  const note = usage.status === 'offline' ? (usage.observedAt ? 'Adapter niedostępny — pokazuję ostatnie dane.' : 'Nie można odczytać podziału z cezar-adapter.')
    : usage.status === 'unavailable' ? 'Cezar nie odpowiada — przypisanie do zadań może być niepełne.' : null;
  return <section className="pulpit-card breakdown-card" aria-labelledby="breakdown-title">
    <div className="pulpit-card-head">
      <h2 id="breakdown-title">Podział zużycia AI</h2>
      <span className="meta">bieżące okno 5h</span>
    </div>
    {usage.status === 'loading' ? <Empty>Ładowanie podziału…</Empty> : !providers.length ? <Empty>Brak aktualnych pomiarów limitów.</Empty> :
      <div className="breakdown-list">{usage.providers.map(p => <ProviderRow key={p.provider} provider={p} />)}</div>}
    {providers.length > 0 && <p className="meta">Przypisanie orientacyjne: wzrost limitu dzieli się między zadania Cezara oraz sesje Claude, Codex i Antigravity (aplikacja, terminal) proporcjonalnie do zużytych tokenów. Źródła bez śladu w transkryptach (np. przeglądarka) trafiają do „inne źródła”.</p>}
    {note && <p className="meta warning">{note}</p>}
  </section>;
}
