import { ChartPie } from 'lucide-react';
import { SourceNote, quotaReason } from './components';
import { time } from './format';
import { MAX_AGE, fresh, quotaState, type DashboardData, type Detail, type QuotaSnapshot } from './model';
import { normalizeQuotaWindow, quotaPace, quotaPaceLabels, quotaResetIn } from './quota-pace';
import type { QuotaCardItem } from './quota-cards';

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

/** A bar for one window: the use as a fill coloured by the pace, a white tick where the window's time has got to. */
function WindowRow({ name, arc, lead }: { name: string; arc: Arc; lead: boolean }) {
  return <span className={`p3-lrow ${lead ? 'lead' : 'thin'}`}>
    <span className="p3-lname">{name}</span>
    <span className="p3-lbar" data-tone={arc.tone} aria-hidden="true">
      {arc.used !== null && arc.used > 0 && <i style={{ width: `${Math.min(100, arc.used)}%` }} />}
      {arc.elapsed !== null && <u style={{ left: `${Math.min(100, arc.elapsed)}%` }} />}
    </span>
    <b>{arc.used === null ? '—' : percent(arc.used)}</b>
  </span>;
}

export function LimitCard({ card, now, connected, open }: { card: QuotaCardItem; now: number; connected: boolean; open: (d: Detail) => void }) {
  const five = card.snapshots.find(s => normalizeQuotaWindow(s.window) === '5h');
  const seven = card.snapshots.find(s => normalizeQuotaWindow(s.window) === '7d');
  const other = card.snapshots.filter(s => s !== five && s !== seven);
  const lead = card.snapshots.find(s => s === (five ?? seven ?? other[0]));
  const leadArc = arcOf(five ?? seven, now, connected);
  const windows = [five && ['5h', arcOf(five, now, connected)], seven && ['7d', arcOf(seven, now, connected)], ...other.map(s => [s.label || s.window, arcOf(s, now, connected)])]
    .filter(Boolean) as [string, Arc][];
  const detail = !card.snapshots.length ? (card.reason ? quotaReason(card.reason) : 'brak pomiaru')
    : lead?.state === 'auth_required' ? 'wymaga logowania'
    : leadArc?.state === 'stale' && lead?.reason === 'http_429' ? `limit zapytań dostawcy${lead.retryAt ? ` · kolejna próba ${time(lead.retryAt)}` : ''} · ostatnia obserwacja`
    : leadArc?.state === 'fresh' && lead?.resetAt ? `reset za ${quotaResetIn(lead.resetAt, now)}`
    : leadArc?.state === 'unavailable' ? (lead?.reason ? quotaReason(lead.reason) : 'brak pomiaru')
    : `nieaktualne${lead?.observedAt ? ` · odczyt ${time(lead.observedAt)}` : ''}`;
  const summary = windows.map(([name, arc]) => `${name} ${arc.used === null ? '—' : percent(arc.used)}`).join(' · ');
  return <button className="p3-limit" onClick={() => open({ kind: 'quota', provider: card.provider })} aria-label={`${card.title}: ${summary || 'brak pomiaru'}, ${detail}`}>
    <span className="p3-limit-head">
      <strong>{card.title}{card.badge && <span className="p2-badge">{card.badge}</span>}</strong>
      <span className="p2-meta">{detail}</span>
    </span>
    <span className="p3-lrows">
      {windows.map(([name, arc], index) => <WindowRow key={name} name={name} arc={arc} lead={index === 0} />)}
    </span>
  </button>;
}

/**
 * One AI limit as a tile of the work area: the 5h window as a thick bar, the 7d window (and any other) as thin ones; a
 * white tick shows how far each window's time has got, and the colour says only whether use is ahead of it. The button
 * in the corner opens the usage breakdown.
 */
export function QuotaTile({ card, data, now, open, showBreakdown, roomy }: {
  card: QuotaCardItem; data: DashboardData; now: number; open: (d: Detail) => void; showBreakdown?: () => void; roomy: boolean;
}) {
  const connected = fresh(data.quotas, now, MAX_AGE.quotas);
  return <section className={`p2-card wk-limit ${roomy ? 'roomy' : ''}`} aria-label={card.title}>
    <LimitCard card={card} now={now} connected={connected} open={open} />
    {showBreakdown && <button className="wk-split" aria-label="Podział zużycia" title="Podział zużycia" onClick={showBreakdown}><ChartPie size={18} aria-hidden="true" /></button>}
    {!connected && <SourceNote source={data.quotas} now={now} maxAge={MAX_AGE.quotas} refreshEveryMs={60000} />}
  </section>;
}

/** A limit tile whose limit is not in the data: still loading, or the account does not report it (any more). */
export function MissingLimit({ title, loading }: { title: string; loading: boolean }) {
  return <section className="p2-card wk-limit" aria-label={title}>
    <h2 className="p2-eyebrow">{title}</h2>
    <p className="p2-note">{loading ? 'Ładowanie limitu…' : 'Brak pomiaru tego limitu.'}</p>
  </section>;
}
