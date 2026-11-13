import { Bot, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { automationListSchema, type Automation } from './automation-contract';
import { openPanelPage } from './panel-nav';
import { usePollingEnabled } from './polling';
import { stamp } from './format';
import { FILA_OPEN } from './fila/events';

export function AutomationsTile() {
  const polling = usePollingEnabled();
  const [rows, setRows] = useState<Automation[] | null>(null);
  const [error, setError] = useState(false);
  const [machina, setMachina] = useState<NonNullable<ReturnType<typeof automationListSchema.parse>['machinaAutomats']>>([]);
  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch('/api/automations', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = automationListSchema.parse(await response.json());
        if (!controller.signal.aborted) { setRows(data.automations.filter(a => a.status === 'active' && !a.movedTo).slice(0, 3)); setMachina((data.machinaAutomats ?? []).slice(0, 3)); setError(!!data.error); }
      } catch { if (!controller.signal.aborted) setError(true); }
    };
    void read(); const timer = setInterval(() => void read(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [polling]);
  return <section className="p2-card automations-tile-card" aria-label="Automaty"><div className="p2-card-head static"><span className="p2-card-title"><Bot size={16} /> Automaty</span><ChevronRight size={16} /></div><button className="automations-tile" onClick={() => openPanelPage('automations')} aria-label="Otwórz Automaty">
    {error ? <span>Nie udało się odczytać automatów.</span> : !rows ? <span>Odczytuję…</span> : rows.length === 0 ? <span>Brak aktywnych automatów</span> : rows.map(a => <span className="automations-tile-row" key={a.id}>
      <span><i className="automation-dot ok" /> <strong>{a.name}</strong></span>
      <small>{a.nextRunAt ? `Następny: ${stamp(a.nextRunAt)}` : 'Czeka na wyzwalacz'}</small>
      <span className="automation-dots" aria-label="Ostatnie runy">{Array.from({ length: 5 }, (_, i) => { const r = a.runs.slice(-5)[i]; return <i key={i} className={`automation-dot ${r ? ({ done: 'ok', error: 'bad', 'not-yet': 'idle', skipped: 'skip' } as const)[r.outcome] : 'none'}`} />; })}</span>
    </span>)}
  </button>
  {/* Time automations are Machina's (DESK-87): each one opens its thread in Fila. */}
  {machina.length > 0 && <div className="automations-tile-machina" aria-label="Automaty Machiny">{machina.map(a => <button key={a.thread} type="button" className="automations-tile-row" onClick={() => window.dispatchEvent(new CustomEvent(FILA_OPEN, { detail: a.thread }))} aria-label={`Otwórz wątek ${a.thread}`}>
    <span><strong>{a.title}</strong> <small>{a.thread} · {a.state}</small></span>
    <small>{a.nextRunAt ? `Następny: ${stamp(a.nextRunAt)}` : a.version === null ? 'Czeka na kartę programu' : 'Nic nie jest zaplanowane'}</small>
  </button>)}</div>}
  </section>;
}
