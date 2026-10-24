import { ChevronRight, Cpu, MemoryStick, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { number } from './format';
import type { SystemSample } from './model';

/** How much history the chart shows; the service keeps about this much. */
export const CHART_WINDOW_MS = 5 * 60_000;
const W = 360, H = 84;

export interface LoadChartData { path: string; area: string; last: { x: number; y: number } | null; avg: number; max: number }

/** Time on x (the window ends at the latest sample), percent on y; samples may start late, so the line starts where they do. */
export function loadChart(samples: SystemSample[], value: (s: SystemSample) => number): LoadChartData {
  const end = samples.at(-1)?.at ?? 0, start = end - CHART_WINDOW_MS;
  const points = samples.filter(s => s.at >= start).map(s => ({ x: ((s.at - start) / CHART_WINDOW_MS) * W, y: H - (Math.min(100, Math.max(0, value(s))) / 100) * H }));
  if (!points.length) return { path: '', area: '', last: null, avg: 0, max: 0 };
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const values = samples.filter(s => s.at >= start).map(value);
  return {
    path, area: `${path} L${points.at(-1)!.x.toFixed(1)} ${H} L${points[0].x.toFixed(1)} ${H} Z`, last: points.at(-1)!,
    avg: values.reduce((sum, v) => sum + v, 0) / values.length, max: Math.max(...values),
  };
}

function LoadChart({ title, icon, value, detail, samples, pick, threshold, id }: {
  title: string; icon: ReactNode; value: number; detail: string; samples: SystemSample[]; pick: (s: SystemSample) => number; threshold: number; id: string;
}) {
  const chart = loadChart(samples, pick);
  const hot = value >= threshold;
  return <section className={`sys-chart ${hot ? 'hot' : ''}`} aria-label={`${title} w ostatnich minutach`}>
    <div className="sys-chart-head">
      <span className="sys-chart-title">{icon}{title}</span>
      <strong>{number(value)}<small>%</small></strong>
    </div>
    <svg className="sys-plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}: teraz ${number(value)}%, średnio ${number(chart.avg)}%, najwyżej ${number(chart.max)}%`}>
      <defs><linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.38" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      {[0, 50, 100].map(level => <line key={level} className="sys-grid" x1="0" x2={W} y1={H - (level / 100) * H} y2={H - (level / 100) * H} />)}
      <line className="sys-threshold" x1="0" x2={W} y1={H - (threshold / 100) * H} y2={H - (threshold / 100) * H} />
      {chart.area && <path d={chart.area} fill={`url(#fill-${id})`} />}
      {chart.path && <path className="sys-line" d={chart.path} />}
      {chart.last && <circle className="sys-dot" cx={chart.last.x} cy={chart.last.y} r="3.5" />}
    </svg>
    <div className="sys-chart-foot"><span>{detail}</span><span>średnio {number(chart.avg)}% · max {number(chart.max)}%</span></div>
  </section>;
}

/** The computer at a glance: CPU and RAM over the last minutes, and the way to the full page. */
export function SystemPopover({ samples, threshold, close, showPage, id = 'sys' }: {
  samples: SystemSample[]; threshold: number; close: () => void; showPage: () => void; id?: string;
}) {
  const latest = samples.at(-1);
  return <section className="sys-panel" role="dialog" aria-label="Komputer">
    <div className="events-head">
      <h2>Komputer</h2>
      <span className="events-total">ostatnie 5 min</span>
      <button className="events-close" aria-label="Zamknij okno komputera" onClick={close}><X size={18} /></button>
    </div>
    {latest ? <>
      <LoadChart id={`${id}-cpu`} title="CPU" icon={<Cpu size={16} aria-hidden="true" />} samples={samples} pick={s => s.cpuPercent} value={latest.cpuPercent} threshold={threshold}
        detail="średnie obciążenie wszystkich rdzeni" />
      <LoadChart id={`${id}-ram`} title="RAM" icon={<MemoryStick size={16} aria-hidden="true" />} samples={samples} pick={s => (s.ramUsedGb / s.ramTotalGb) * 100} threshold={threshold}
        value={(latest.ramUsedGb / latest.ramTotalGb) * 100} detail={`${number(latest.ramUsedGb)} z ${number(latest.ramTotalGb)} GiB`} />
    </> : <p className="events-empty">Brak próbek CPU i RAM.</p>}
    <div className="events-foot">
      <span className="p2-hint">Linia przerywana: próg {threshold}%</span>
      <button className="events-rules" onClick={() => { close(); showPage(); }}>Otwórz zakładkę Komputer <ChevronRight size={16} aria-hidden="true" /></button>
    </div>
  </section>;
}
