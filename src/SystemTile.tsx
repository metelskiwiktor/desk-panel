import { ChevronRight, Cpu, MemoryStick } from 'lucide-react';
import { number } from './format';
import { MAX_AGE, fresh, type DashboardData, type Detail, type SystemSample } from './model';
import { LoadChart } from './SystemPopover';

const ramPercent = (s: SystemSample) => (s.ramUsedGb / s.ramTotalGb) * 100;

function Meter({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  return <span className="p3-lrow lead">
    <span className="p3-lname">{label}</span>
    <span className="p3-lbar" data-tone={value >= threshold ? 'red' : 'green'} aria-hidden="true"><i style={{ width: `${Math.min(100, value)}%` }} /></span>
    <b>{number(value)}%</b>
  </span>;
}

/**
 * The computer as a tile: CPU and RAM as two bars, and, once the tile has room, as the charts of the last five minutes.
 * The head opens the details. Red only past the same threshold as the chip in the top bar.
 */
export function SystemTile({ data, now, open, roomy, threshold }: { data: DashboardData; now: number; open: (d: Detail) => void; roomy: boolean; threshold: number }) {
  const samples = data.system.data ?? [];
  const latest = samples.at(-1);
  const live = !!latest && fresh(data.system, now, MAX_AGE.system);
  return <section className={`p2-card wk-sys ${roomy ? 'roomy' : ''}`} aria-label="Komputer">
    <button type="button" className="p2-card-head" onClick={() => open({ kind: 'system' })} aria-label="Szczegóły komputera">
      <h2>Komputer</h2>
      {latest && !live && <span className="p2-meta">dane nieaktualne</span>}
      <ChevronRight size={20} aria-hidden="true" />
    </button>
    {!latest ? <p className="p2-empty">{data.system.status === 'loading' ? 'Ładowanie próbek…' : 'Brak próbek CPU i RAM.'}</p>
      : roomy ? <div className="wk-charts">
        <LoadChart id="wk-cpu" title="CPU" icon={<Cpu size={16} aria-hidden="true" />} samples={samples} pick={s => s.cpuPercent} value={latest.cpuPercent} threshold={threshold} detail="wszystkie rdzenie" />
        <LoadChart id="wk-ram" title="RAM" icon={<MemoryStick size={16} aria-hidden="true" />} samples={samples} pick={ramPercent} value={ramPercent(latest)} threshold={threshold}
          detail={`${number(latest.ramUsedGb)} z ${number(latest.ramTotalGb)} GiB`} />
      </div>
      : <div className="wk-meters"><Meter label="CPU" value={latest.cpuPercent} threshold={threshold} /><Meter label="RAM" value={ramPercent(latest)} threshold={threshold} /></div>}
  </section>;
}
