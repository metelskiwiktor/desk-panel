import { useCallback, useEffect, useState } from 'react';
import { Bot, MessageSquare, Pause, Play, Save, X } from 'lucide-react';
import { Card } from './components';
import { ctx } from './chat-context';
import { stamp } from './format';
import { usePollingEnabled } from './polling';
import { openChatConversation } from './useChatPresentation';
import {
  describeTrigger, isCyclic, scheduleLabel, STATUS_LABELS, OUTCOME_LABELS, automationListSchema, type Automation, type AutomationRun,
} from './automation-contract';

/**
 * Widok „Automaty”: cykliczne i jednorazowe zadania Wektora. Po lewej lista z kropką stanu i pięcioma kropkami ostatnich
 * runów; po prawej szczegóły wybranego (runy, cel i akcje, notatnik, rozmowa). Przyciski to Origin-checked POST-y.
 */
type Tab = 'runs' | 'goal' | 'notebook' | 'chat';

const RUN_CLASS = { 'not-yet': 'wait', done: 'ok', error: 'bad', skipped: 'skip' } as const;
const STATUS_CLASS: Record<Automation['status'], string> = { active: 'ok', paused: 'wait', done: 'ok', expired: 'skip', cancelled: 'bad' };
const when = (at?: number) => at ? stamp(at) : '—';
const nextText = (a: Automation) => {
  if (a.status === 'done') return 'zakończony';
  if (a.status === 'paused') return 'wstrzymany';
  if (a.status === 'cancelled') return 'anulowany';
  if (a.status === 'expired') return 'wygasły';
  return a.nextRunAt ? `następny ${when(a.nextRunAt)}` : 'czeka na wyzwalacz';
};

function Dots({ runs }: { runs: AutomationRun[] }) {
  const last = runs.slice(-5);
  return <span className="automation-dots" aria-label={`Ostatnie runy: ${last.map(r => OUTCOME_LABELS[r.outcome]).join(', ') || 'brak'}`}>
    {Array.from({ length: 5 }, (_, i) => {
      const run = last[i];
      return <i key={i} className={`automation-dot ${run ? RUN_CLASS[run.outcome] : 'none'}`} title={run ? `${when(run.at)} · ${OUTCOME_LABELS[run.outcome]}` : 'brak runu'} />;
    })}
  </span>;
}

export function AutomationsView() {
  const polling = usePollingEnabled();
  const [rows, setRows] = useState<Automation[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('runs');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const read = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/automations', { signal });
      if (!response.ok) throw new Error('offline');
      const value = automationListSchema.parse(await response.json());
      if (!signal?.aborted) {
        setRows(value.automations);
        setError(false);
        setSelected(current => current && value.automations.some(a => a.id === current) ? current : value.automations[0]?.id ?? null);
      }
    } catch { if (!signal?.aborted) setError(true); }
  }, []);

  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const loop = async () => {
      controller = new AbortController();
      await read(controller.signal);
      if (!stopped) timer = setTimeout(loop, 15000);
    };
    void loop();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [polling, read]);

  const chosen = rows?.find(a => a.id === selected) ?? null;
  useEffect(() => { setNote(chosen?.notebook ?? ''); }, [chosen?.id, chosen?.notebook]);

  const act = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'runNow') => {
    setBusy(`${id}:${action}`);
    try {
      const response = await fetch('/api/automations/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error('refused');
      await read();
    } catch { setError(true); }
    finally { setBusy(null); }
  };
  const saveNote = async () => {
    if (!chosen) return;
    setBusy(`${chosen.id}:notebook`);
    try {
      const response = await fetch('/api/automations/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chosen.id, notebook: note }),
      });
      if (!response.ok) throw new Error('refused');
      await read();
    } catch { setError(true); }
    finally { setBusy(null); }
  };

  const cyclic = rows?.filter(a => isCyclic(a.trigger)) ?? [];
  const oneShot = rows?.filter(a => !isCyclic(a.trigger)) ?? [];
  const group = (title: string, list: Automation[]) => (
    <div className="automation-group">
      <h3>{title}</h3>
      {list.length === 0 ? <p className="meta">Brak.</p> : <ul className="automation-list">
        {list.map(a => (
          <li key={a.id}>
            <button type="button" className={`automation-row ${a.id === selected ? 'active' : ''}`} aria-current={a.id === selected ? 'true' : undefined} onClick={() => { setSelected(a.id); setTab('runs'); }}
              {...ctx('automation', a.id, a.name, `${a.name}\nStan: ${STATUS_LABELS[a.status]}\nHarmonogram: ${describeTrigger(a.trigger)}\nCel: ${a.goal}\nOstatnie runy:\n${a.runs.slice(-5).map(r => `- ${stamp(r.at)} · ${OUTCOME_LABELS[r.outcome]} · ${r.summary}`).join('\n') || '- brak'}`)}>
              <i className={`automation-dot ${STATUS_CLASS[a.status]}`} aria-label={`stan: ${STATUS_LABELS[a.status]}`} />
              <span className="automation-row-main">
                <span className="automation-name">{a.name}</span>
                <span className="meta">{scheduleLabel(a.trigger)} · {nextText(a)}</span>
              </span>
              <Dots runs={a.runs} />
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );

  return (
    <div className="automation-view">
      <Card title="Automaty" icon={<Bot />}>
        <p className="card-intro">
          Cykliczne i jednorazowe zadania Wektora. Run cykliczny to nowa rozmowa automatu, a wynik wraca do rozmowy, w której
          automat powstał. Wszystkie wyłącza <code>DESK_AUTOMATIONS=0</code>.
        </p>
        {error && <p className="warning" role="status">Nie udało się odczytać automatów ani wykonać akcji.</p>}
        {!rows ? <p className="meta">Odczytuję automaty…</p> : rows.length === 0 ? (
          <p className="meta">Brak automatów. Poproś Wektora w rozmowie, żeby coś sprawdzał cyklicznie.</p>
        ) : (
          <div className="automation-layout">
            <nav className="automation-side" aria-label="Lista automatów">
              {group('Cykliczne', cyclic)}
              {group('Jednorazowe', oneShot)}
            </nav>
            {chosen && <section className="automation-detail" aria-label={`Automat ${chosen.name}`}>
              <header className="automation-head">
                <div>
                  <h2>{chosen.name}</h2>
                  <p className="meta">{describeTrigger(chosen.trigger)} · {nextText(chosen)} · ostatni run {when(chosen.lastRunAt)}</p>
                </div>
                <div className="automation-actions">
                  {(chosen.status === 'active' || chosen.status === 'paused') && <>
                    <button className="button" disabled={busy === `${chosen.id}:runNow`} onClick={() => void act(chosen.id, 'runNow')}><Play size={15} /> Uruchom teraz</button>
                    <button className="button" disabled={busy === `${chosen.id}:${chosen.status === 'paused' ? 'resume' : 'pause'}`} onClick={() => void act(chosen.id, chosen.status === 'paused' ? 'resume' : 'pause')}>
                      {chosen.status === 'paused' ? <><Play size={15} /> Wznów</> : <><Pause size={15} /> Wstrzymaj</>}
                    </button>
                  </>}
                  {chosen.status !== 'cancelled' && <button className="button" disabled={busy === `${chosen.id}:cancel`} onClick={() => void act(chosen.id, 'cancel')}><X size={15} /> Anuluj</button>}
                </div>
              </header>
              <div className="automation-tabs" role="tablist" aria-label="Szczegóły automatu">
                {([['runs', 'Runy'], ['goal', 'Cel i akcje'], ['notebook', 'Notatnik'], ['chat', 'Rozmowa']] as const).map(([id, label]) =>
                  <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
              </div>
              {tab === 'runs' && <div className="automation-tab" role="tabpanel" aria-label="Runy">
                {chosen.runs.length === 0 ? <p className="meta">Brak runów.</p> : <ol className="automation-runs">
                  {[...chosen.runs].reverse().map((r, i) => <li key={r.id} className={i === 0 ? 'newest' : ''}>
                    <div className="automation-run-head">
                      <i className={`automation-dot ${RUN_CLASS[r.outcome]}`} aria-hidden="true" />
                      <span className="automation-run-when">{stamp(r.at)}</span>
                      <span className="automation-run-outcome">{OUTCOME_LABELS[r.outcome]}</span>
                      {r.costUsd !== undefined && <span className="meta">{r.costUsd.toFixed(3)} USD</span>}
                      {r.seconds !== undefined && <span className="meta">{r.seconds.toFixed(1)} s</span>}
                      <span className="meta">notatnik zmieniony: {r.notebookChanged ? 'tak' : 'nie'}</span>
                    </div>
                    {i === 0 ? <p className="automation-run-summary">{r.summary}</p> : <p className="meta automation-run-summary">{r.summary}</p>}
                    <button className="link-button" onClick={() => openChatConversation(r.chatId)}><MessageSquare size={14} /> Otwórz rozmowę runu</button>
                  </li>)}
                </ol>}
              </div>}
              {tab === 'goal' && <div className="automation-tab" role="tabpanel" aria-label="Cel i akcje">
                <h3>Cel</h3>
                <p className="automation-goal">{chosen.goal}</p>
                {chosen.doneWhen && <><h3>Cel osiągnięty, gdy</h3><p>{chosen.doneWhen}</p></>}
                <h3>Zatwierdzone akcje</h3>
                <div className="automation-chips">{chosen.actions.length ? chosen.actions.map((a, i) => <span key={i} className="automation-chip">{a.kind}</span>) : <span className="meta">brak</span>}</div>
                <p className="meta">Uczy się między runami: {chosen.learn ? 'tak' : 'nie'}.</p>
              </div>}
              {tab === 'notebook' && <div className="automation-tab" role="tabpanel" aria-label="Notatnik">
                <p className="meta">Notatnik automatu (Markdown, do 4000 znaków). {chosen.learn ? 'Run może go zmieniać; poprzednia wersja zostaje w runie.' : 'Automat się nie uczy; możesz go zmienić ręcznie.'}</p>
                <textarea aria-label="Notatnik automatu" value={note} maxLength={4000} rows={12} onChange={e => setNote(e.target.value)} />
                <button className="button" disabled={busy === `${chosen.id}:notebook` || note === chosen.notebook} onClick={() => void saveNote()}><Save size={15} /> Zapisz notatnik</button>
              </div>}
              {tab === 'chat' && <div className="automation-tab" role="tabpanel" aria-label="Rozmowa">
                <p className="meta">Rozmowa, w której automat powstał i do której wracają wyniki runów.</p>
                <button className="button" onClick={() => openChatConversation(chosen.chatId)}><MessageSquare size={15} /> Otwórz rozmowę automatu</button>
              </div>}
            </section>}
          </div>
        )}
      </Card>
    </div>
  );
}

