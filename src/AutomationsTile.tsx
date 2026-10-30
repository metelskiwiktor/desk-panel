import { Bot, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { automationListSchema, type Automation } from './automation-contract';
import { openPanelPage } from './panel-nav';
import { usePollingEnabled } from './polling';
import { stamp } from './format';

export function AutomationsTile() {
  const polling = usePollingEnabled();
  const [rows, setRows] = useState<Automation[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch('/api/automations', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = automationListSchema.parse(await response.json());
        if (!controller.signal.aborted) { setRows(data.automations.filter(a => a.status === 'active').slice(0, 3)); setError(!!data.error); }
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
  </button></section>;
}
