import { Empty } from './components';
import type { UsageProvider, UsageSegment } from './usage-breakdown-contract';
import type { UsageBreakdownState } from './useUsageBreakdown';

const WINDOW_MS = 5 * 3_600_000;
const SLICE_MS = 10 * 60_000;
const points = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
export const pointsLabel = (n: number) => `${points.format(n)} p.p.`;
const providerNames = { Claude: 'Claude', Codex: 'ChatGPT / Codex', Gemini: 'Gemini (Antigravity)' } as const;
const originNames = { cezar: 'Cezar', 'claude-app': 'Claude (aplikacja)', 'claude-cli': 'Claude Code (terminal)', 'codex-app': 'ChatGPT / Codex (aplikacja)', 'codex-cli': 'Codex (terminal)', 'antigravity-app': 'Antigravity (aplikacja)', 'antigravity-cli': 'Antigravity (terminal)', warmup: 'Warmup', unknown: 'Sesja lokalna' } as const;
const HATCH = 'repeating-linear-gradient(135deg, #3a4659 0 3px, #263041 3px 6px)';
// One colour per kind of source, the same in every provider: green Cezar, blue apps, amber terminals.
const APP = '#378ADD', TERMINAL = '#E0A04A';
const GROUP_COLORS: Record<string, string> = { cezar: '#1D9E75', 'claude-app': APP, 'codex-app': APP, 'antigravity-app': APP, 'claude-cli': TERMINAL, 'codex-cli': TERMINAL, 'antigravity-cli': TERMINAL,
  warmup: '#D4537E', unknown: '#5f9ea0', other: '#8593a8', unobserved: HATCH };

const keyOf = (s: UsageSegment) => s.id ?? s.kind;
/** The group a segment belongs to: what colours it and what it is listed under. */
function groupOf(s: UsageSegment): string {
  if (s.kind === 'task') return 'cezar';
  if (s.kind === 'session') return s.origin ?? 'unknown';
  return s.kind === 'unobserved' ? 'unobserved' : 'other';
}
const groupName = (group: string) => group === 'unobserved' ? 'Sprzed pomiarów' : group === 'other' ? 'Inne źródła' : originNames[group as keyof typeof originNames] ?? 'Sesja lokalna';

/** Full label of one source, used when it stands alone in its group. */
export function segmentLabel(segment: UsageSegment) {
  const shared = segment.shared ? ' (równolegle)' : '';
  if (segment.kind === 'task') return `Cezar · ${segment.title ?? 'zadanie'}${shared}`;
  if (segment.kind === 'session' && segment.origin === 'warmup') return 'Automatyczny warmup';
  if (segment.kind === 'session') return segment.origin === 'cezar' ? `Cezar · ${segment.title ?? 'pomocnicze'}${shared}` : `${originNames[segment.origin ?? 'unknown']} · ${segment.title ?? 'bez nazwy'}${shared}`;
  return segment.kind === 'tasks_rest' ? 'Pozostałe źródła' : segment.kind === 'other' ? 'Inne źródła (bez śladu w sesjach)' : 'Sprzed pomiarów';
}
/** Short label of a member listed under its group header. */
const memberLabel = (s: UsageSegment) => `${s.title ?? (s.kind === 'tasks_rest' ? 'pozostałe źródła' : s.kind === 'other' ? 'bez śladu w sesjach' : 'zadanie')}${s.shared ? ' (równolegle)' : ''}`;

interface Group { id: string; members: UsageSegment[]; total: number }
function groupsOf(segments: UsageSegment[]): Group[] {
  const groups = new Map<string, Group>();
  for (const s of segments) {
    const id = groupOf(s), group = groups.get(id) ?? { id, members: [], total: 0 };
    group.members.push(s); group.total += s.percent; groups.set(id, group);
  }
  return [...groups.values()];
}

function Legend({ groups }: { groups: Group[] }) {
  return <ul className="breakdown-legend">{groups.map(g => {
    const alone = g.members.length === 1 && g.id !== 'cezar';
    const swatch = <i style={{ background: GROUP_COLORS[g.id] }} aria-hidden="true" />;
    if (alone) return <li key={g.id}>{swatch}<span>{segmentLabel(g.members[0])}</span><span className="meta">{pointsLabel(g.total)}</span></li>;
    return <li key={g.id} className="breakdown-group">
      <div className="breakdown-group-head">{swatch}<span>{groupName(g.id)}</span><span className="meta">{pointsLabel(g.total)}</span></div>
      <ul>{g.members.map((m, i) => <li key={i}><span>{memberLabel(m)}</span><span className="meta">{pointsLabel(m.percent)}</span></li>)}</ul>
    </li>;
  })}</ul>;
}

const clock = (at: number) => new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
/** One lane per source group over the 5h window: where on the time axis it worked, taller where it used more. */
function Lanes({ provider, groups }: { provider: UsageProvider; groups: Group[] }) {
  const slices = (provider.timeline ?? []).filter(t => t.from !== undefined && t.to !== undefined);
  if (!slices.length) return null;
  const start = provider.resetAt ? provider.resetAt - WINDOW_MS : Math.min(...slices.map(t => t.from!));
  const segmentByKey = new Map(groups.flatMap(g => g.members.map(m => [keyOf(m), m] as const)));
  const intensity = (t: (typeof slices)[number]) => t.percent / Math.max(1, (t.to! - t.from!) / SLICE_MS);
  const peak = Math.max(...slices.map(intensity));
  const left = (at: number) => Math.min(100, Math.max(0, (at - start) / WINDOW_MS * 100));
  const now = provider.observedAt;
  return <div className="breakdown-lanes">
    {groups.map(g => <div key={g.id} className="breakdown-lane">
      <span className="breakdown-lane-label"><i style={{ background: GROUP_COLORS[g.id] }} aria-hidden="true" /><span>{groupName(g.id)}</span><span className="meta">{pointsLabel(g.total)}</span></span>
      <span className="breakdown-track" role="img" aria-label={`${groupName(g.id)}: ${pointsLabel(g.total)} w oknie 5h`}>
        {slices.filter(t => { const s = segmentByKey.get(t.key); return s ? groupOf(s) === g.id : g.id === 'other'; }).map((t, i) => {
          const height = g.id === 'unobserved' ? 100 : 35 + 65 * intensity(t) / peak;
          const s = segmentByKey.get(t.key);
          return <i key={i} title={`${s ? segmentLabel(s) : 'Inne źródła'} · ${pointsLabel(t.percent)} · ${clock(t.from!)}–${clock(t.to!)}`}
            style={{ left: `${left(t.from!)}%`, width: `max(3px, ${left(t.to!) - left(t.from!)}%)`, height: `${height}%`, background: GROUP_COLORS[g.id] }} />;
        })}
        {now !== null && <b className="breakdown-now" style={{ left: `${left(now)}%` }} />}
      </span>
    </div>)}
    <div className="breakdown-axis"><span />
      <div>{[0, 1, 2, 3, 4, 5].map(h => <span key={h}>{clock(start + h * 3_600_000)}</span>)}</div></div>
  </div>;
}

/** The parts that filled a provider's limit, in time order when the adapter sent it, each in its source group's colour; the bar on the quota strip is drawn from these. */
export function breakdownPieces(provider: UsageProvider) {
  const segmentByKey = new Map(provider.segments.map(s => [keyOf(s), s] as const));
  return (provider.timeline?.length ? provider.timeline : provider.segments.map(s => ({ key: keyOf(s), percent: s.percent }))).map(p => {
    const s = segmentByKey.get(p.key);
    return { percent: p.percent, color: GROUP_COLORS[s ? groupOf(s) : 'other'], label: s ? `${segmentLabel(s)} · ${pointsLabel(p.percent)}` : pointsLabel(p.percent) };
  });
}

function ProviderRow({ provider }: { provider: UsageProvider }) {
  if (provider.usedPercent === null) return <div className="breakdown-row">
    <div className="breakdown-head"><strong>{providerNames[provider.provider]}</strong><span className="meta">brak aktualnego pomiaru</span></div></div>;
  const groups = groupsOf(provider.segments);
  // The window runs 5 hours up to the provider's reset; show it as clock times so "bieżące okno" has a place on the day.
  const windowLabel = provider.resetAt ? `${clock(provider.resetAt - WINDOW_MS)}–${clock(provider.resetAt)}` : '5h';
  const timed = (provider.timeline ?? []).some(t => t.from !== undefined && t.to !== undefined);
  return <div className="breakdown-row">
    <div className="breakdown-head"><strong>{providerNames[provider.provider]}</strong><span className="meta">okno {windowLabel} · {points.format(provider.usedPercent)}% zużyte</span></div>
    {timed ? <Lanes provider={provider} groups={groups} /> : <Legend groups={groups} />}
  </div>;
}

/** One lane per source group on the provider's 5h window, showing when each worked. The split of the limit itself is drawn on the quota bars. Approximate: rises are matched to what was running. */
export function UsageBreakdownCard({ usage }: { usage: UsageBreakdownState }) {
  const providers = usage.providers.filter(p => p.usedPercent !== null);
  const note = usage.status === 'offline' ? (usage.observedAt ? 'Adapter niedostępny — pokazuję ostatnie dane.' : 'Nie można odczytać podziału z cezar-adapter.')
    : usage.status === 'unavailable' ? 'Cezar nie odpowiada — przypisanie do zadań może być niepełne.' : null;
  return <section className="pulpit-card breakdown-card" aria-labelledby="breakdown-title">
    <div className="pulpit-card-head">
      <h2 id="breakdown-title">Podział zużycia AI</h2>
      <span className="meta">bieżące okno 5h{usage.observedAt ? ` · pomiar ${clock(usage.observedAt)}` : ''}</span>
    </div>
    {usage.status === 'loading' ? <Empty>Ładowanie podziału…</Empty> : !providers.length ? <Empty>Brak aktualnych pomiarów limitów.</Empty> :
      <div className="breakdown-list">{usage.providers.map(p => <ProviderRow key={p.provider} provider={p} />)}</div>}
    {providers.length > 0 && <p className="meta">Przypisanie orientacyjne: wzrost limitu dzieli się między zadania Cezara oraz sesje Claude, Codex i Antigravity (aplikacja, terminal) proporcjonalnie do zużytych tokenów. Źródła bez śladu w transkryptach (np. przeglądarka) trafiają do „inne źródła”. Wysokość słupka rośnie ze zużyciem.</p>}
    {note && <p className="meta warning">{note}</p>}
  </section>;
}
