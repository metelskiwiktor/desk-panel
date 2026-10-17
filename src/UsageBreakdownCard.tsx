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
// One colour per source kind, the same in every provider: blue Claude, violet Codex, amber Antigravity, green Cezar.
const GROUP_COLORS: Record<string, string> = { cezar: '#1D9E75', 'claude-app': '#378ADD', 'claude-cli': '#85B7EB', 'codex-app': '#7F77DD', 'codex-cli': '#AFA9EC', 'antigravity-app': '#BA7517', 'antigravity-cli': '#E0A04A',
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
  return <details className="breakdown-lanes">
    <summary>Oś czasu okna 5h</summary>
    {groups.map(g => <div key={g.id} className="breakdown-lane">
      <span className="meta">{g.id === 'unobserved' ? 'Sprzed pomiarów' : groupName(g.id)}</span>
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
  </details>;
}

const TICK_SPACING = 5;
/** Clock times under the bar where parts begin, plus the reading time at the end of the used part. The bar is scaled by usage, not by time, so the times are uneven. */
function ticksOf(provider: UsageProvider, windowStart: number | null) {
  const used = provider.usedPercent ?? 0, ticks: { left: number; text: string; now?: boolean }[] = [];
  let at = 0, lastLeft = -Infinity;
  for (const piece of provider.timeline ?? []) {
    const time = piece.key === 'unobserved' && windowStart !== null ? windowStart : piece.from;
    if (time !== undefined && at - lastLeft >= TICK_SPACING && used - at >= TICK_SPACING) { ticks.push({ left: at, text: clock(time) }); lastLeft = at; }
    at += piece.percent;
  }
  if (provider.observedAt !== null && used > 0) {
    if (ticks.length && used - ticks[ticks.length - 1].left < TICK_SPACING) ticks.pop();
    ticks.push({ left: Math.min(100, used), text: clock(provider.observedAt), now: true });
  }
  return ticks;
}

function ProviderRow({ provider }: { provider: UsageProvider }) {
  if (provider.usedPercent === null) return <div className="breakdown-row">
    <div className="breakdown-head"><strong>{providerNames[provider.provider]}</strong><span className="meta">brak aktualnego pomiaru</span></div></div>;
  const groups = groupsOf(provider.segments);
  // The window runs 5 hours up to the provider's reset; show it as clock times so "bieżące okno" has a place on the day.
  const windowLabel = provider.resetAt ? `${clock(provider.resetAt - WINDOW_MS)}–${clock(provider.resetAt)}` : '5h';
  const segmentByKey = new Map(provider.segments.map(s => [keyOf(s), s] as const));
  const ticks = ticksOf(provider, provider.resetAt ? provider.resetAt - WINDOW_MS : null);
  // Where the reading falls in the window, as on the quota bars: the bar is usage, so a bar that ends before this line is using less than the time passed.
  const elapsed = provider.resetAt && provider.observedAt !== null ? Math.max(0, Math.min(100, (provider.observedAt - (provider.resetAt - WINDOW_MS)) / WINDOW_MS * 100)) : null;
  const sumOf = (...ids: string[]) => groups.filter(g => ids.includes(g.id)).reduce((n, g) => n + g.total, 0);
  const cezar = sumOf('cezar'), other = sumOf('other'), before = sumOf('unobserved');
  const sessions = provider.segments.length ? sumOf(...groups.map(g => g.id).filter(id => !['cezar', 'other', 'unobserved'].includes(id))) : 0;
  // In time order when the adapter sent it, so a source that worked all along shows around the short ones, not in front of them.
  const pieces = (provider.timeline?.length ? provider.timeline : provider.segments.map(s => ({ key: keyOf(s), percent: s.percent }))).map(p => {
    const s = segmentByKey.get(p.key);
    return { percent: p.percent, color: GROUP_COLORS[s ? groupOf(s) : 'other'], label: s ? `${segmentLabel(s)} · ${pointsLabel(p.percent)}` : pointsLabel(p.percent) };
  });
  return <div className="breakdown-row">
    <div className="breakdown-summary">
      <span className="breakdown-head"><strong>{providerNames[provider.provider]}</strong><span className="meta">okno {windowLabel} · {Math.round(provider.usedPercent)}% zużyte{elapsed !== null ? ` · czas ${Math.round(elapsed)}%` : ''}</span></span>
      <span className="breakdown-barwrap"><span className="breakdown-bar" role="img" aria-label={`${providerNames[provider.provider]}: ${Math.round(provider.usedPercent)}% limitu 5h. Zadania Cezara ${points.format(cezar)}, inne sesje ${points.format(sessions)}, inne źródła ${points.format(other)}, sprzed pomiarów ${points.format(before)} punktów procentowych.${elapsed !== null ? ` Upłynęło ${Math.round(elapsed)}% czasu okna.` : ''}`}>
        {pieces.map((piece, i) => <i key={i} title={piece.label} style={{ flex: `${piece.percent} 1 0`, background: piece.color }} />)}
        <i className="breakdown-free" style={{ flex: `${Math.max(0, 100 - provider.usedPercent)} 1 0` }} />
      </span>
      {elapsed !== null && <i className="quota-tick breakdown-pace" style={{ left: `${elapsed}%` }} title={`Upłynęło ${Math.round(elapsed)}% czasu okna`} aria-hidden="true" />}
      </span>
      {ticks.length > 0 && <span className="breakdown-ticks" aria-hidden="true">{ticks.map((t, i) => <span key={i} className={`${i === 0 ? 'first' : ''} ${t.now ? 'now' : ''}`} style={{ left: `${t.left}%` }}>{t.text}</span>)}</span>}
    </div>
    <Legend groups={groups} />
    <Lanes provider={provider} groups={groups} />
  </div>;
}

/** Each bar is the provider's whole 5h limit; coloured parts are what filled it (every part at least a few pixels wide), named in the legend under it. Approximate: rises are matched to what was running. */
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
    {providers.length > 0 && <p className="meta">Przypisanie orientacyjne: wzrost limitu dzieli się między zadania Cezara oraz sesje Claude, Codex i Antigravity (aplikacja, terminal) proporcjonalnie do zużytych tokenów. Źródła bez śladu w transkryptach (np. przeglądarka) trafiają do „inne źródła”. Najmniejsze kawałki paska są powiększone, żeby były widoczne.</p>}
    {note && <p className="meta warning">{note}</p>}
  </section>;
}
