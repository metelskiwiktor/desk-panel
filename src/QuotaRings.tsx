import { SourceNote, quotaReason } from './components';
import { time } from './format';
import { MAX_AGE, fresh, quotaState, type DashboardData, type Detail, type QuotaSnapshot } from './model';
import { normalizeQuotaWindow, quotaPace, quotaPaceLabels, quotaResetIn } from './quota-pace';
import { getQuotaCards, type QuotaCardItem } from './quota-cards';

const CENTRE = 56, OUTER = 48, INNER = 33, STROKE = 10;
const percent = (n: number) => `${Number(n.toFixed(1))}%`;

interface Arc { used: number | null; state: 'fresh' | 'stale' | 'unavailable'; tone: keyof typeof quotaPaceLabels | 'muted'; elapsed: number | null }
/** One window of a limit: how much is used, how far the window has run, and the pace colour (only while the reading is current). */
function arcOf(snapshot: QuotaSnapshot | undefined, now: number, connected: boolean): Arc | null {
  if (!snapshot) return null;
  const measured = quotaState(snapshot, now);
  const state = !connected && measured === 'fresh' ? 'stale' : measured;
  const pace = state === 'fresh' ? quotaPace(snapshot, now) : null;
  return { used: state === 'unavailable' ? null : snapshot.usedPercent, state, tone: pace?.tone ?? 'muted', elapsed: pace?.elapsedPercent ?? null };
}

function Circle({ radius, arc }: { radius: number; arc: Arc }) {
  const length = 2 * Math.PI * radius;
  const angle = arc.elapsed === null ? null : (arc.elapsed / 100) * 2 * Math.PI - Math.PI / 2;
  const inner = radius - STROKE / 2 - 2, outer = radius + STROKE / 2 + 2;
  return <>
    <circle className="p2-track" cx={CENTRE} cy={CENTRE} r={radius} strokeWidth={STROKE} />
    {arc.used !== null && arc.used > 0 && <circle className="p2-arc" data-tone={arc.tone} cx={CENTRE} cy={CENTRE} r={radius} strokeWidth={STROKE}
      strokeDasharray={`${Math.max((arc.used / 100) * length, 0.1)} ${length}`} transform={`rotate(-90 ${CENTRE} ${CENTRE})`} />}
    {angle !== null && <line className="p2-tick" x1={CENTRE + inner * Math.cos(angle)} y1={CENTRE + inner * Math.sin(angle)} x2={CENTRE + outer * Math.cos(angle)} y2={CENTRE + outer * Math.sin(angle)} />}
  </>;
}

function RingCard({ card, now, connected, open }: { card: QuotaCardItem; now: number; connected: boolean; open: (d: Detail) => void }) {
  const five = card.snapshots.find(s => normalizeQuotaWindow(s.window) === '5h');
  const seven = card.snapshots.find(s => normalizeQuotaWindow(s.window) === '7d');
  const other = card.snapshots.filter(s => s !== five && s !== seven);
  const outer = arcOf(five ?? seven, now, connected), inner = five ? arcOf(seven, now, connected) : null;
  const lead = card.snapshots.find(s => s === (five ?? seven ?? other[0]));
  const windows = [five && ['5h', arcOf(five, now, connected)], seven && ['7d', arcOf(seven, now, connected)], ...other.map(s => [s.label || s.window, arcOf(s, now, connected)])]
    .filter(Boolean) as [string, Arc][];
  const detail = !card.snapshots.length ? (card.reason ? quotaReason(card.reason) : 'brak pomiaru')
    : lead?.state === 'auth_required' ? 'wymaga logowania'
    : outer?.state === 'stale' && lead?.reason === 'http_429' ? `limit zapytań dostawcy${lead.retryAt ? ` · kolejna próba ${time(lead.retryAt)}` : ''} · ostatnia obserwacja`
    : outer?.state === 'fresh' && lead?.resetAt ? `reset za ${quotaResetIn(lead.resetAt, now)}`
    : outer?.state === 'unavailable' ? (lead?.reason ? quotaReason(lead.reason) : 'brak pomiaru')
    : `nieaktualne${lead?.observedAt ? ` · odczyt ${time(lead.observedAt)}` : ''}`;
  const summary = windows.map(([name, arc]) => `${name} ${arc.used === null ? '—' : percent(arc.used)}`).join(' · ');
  return <button className="p2-ring-card" onClick={() => open({ kind: 'quota', provider: card.provider })} aria-label={`${card.title}: ${summary || 'brak pomiaru'}, ${detail}`}>
    <svg className="p2-ring" viewBox="0 0 112 112" aria-hidden="true">
      {outer && <Circle radius={OUTER} arc={outer} />}
      {inner && <Circle radius={INNER} arc={inner} />}
      <text x="56" y="62" textAnchor="middle">{outer?.used == null ? '—' : Math.round(outer.used)}</text>
    </svg>
    <span className="p2-ring-text">
      <strong>{card.title}{card.badge && <span className="p2-badge">{card.badge}</span>}</strong>
      <span className="p2-meta">{summary}</span>
      <span className="p2-meta">{detail}</span>
    </span>
  </button>;
}

/** AI limits as rings: outer 5h, inner 7d, a white tick where the window's time has got to; colour says only whether use is ahead of time. */
export function QuotaRings({ data, now, open, compact, showBreakdown }: {
  data: DashboardData; now: number; open: (d: Detail) => void; compact: boolean; showBreakdown?: () => void;
}) {
  const cards = getQuotaCards(data.quotas.data);
  const connected = fresh(data.quotas, now, MAX_AGE.quotas);
  // Four or more limits (Antigravity adds groups) do not fit as full rows: they shrink instead of being cut.
  return <section className={`p2-quotas ${compact ? 'compact' : ''} ${cards.length > 3 ? 'dense' : ''}`} aria-label="Limity AI">
    <div className="p2-quotas-head">
      <h2 className="p2-eyebrow">Limity AI</h2>
      {showBreakdown && cards.length > 0 && <button className="p2-link" onClick={showBreakdown}>Podział zużycia</button>}
    </div>
    <div className="p2-rings">
      {cards.length ? cards.map(card => <RingCard key={card.id} card={card} now={now} connected={connected} open={open} />)
        : <p className="p2-note">{data.quotas.status === 'loading' ? 'Ładowanie limitów…' : 'Brak limitów AI.'}</p>}
    </div>
    {!connected && <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={60000} />}
  </section>;
}
