import { useCallback, useEffect, useState } from 'react';
import { Bot, MessageSquare, Pause, Play, Save, Sparkles, X } from 'lucide-react';
import { Card } from './components';
import { ctx } from './chat-context';
import { stamp } from './format';
import { usePollingEnabled } from './polling';
import { openChatConversation } from './useChatPresentation';
import {
  CHANGE_LABELS, changeValue, ACTION_HINTS, ACTION_LABELS, describeTrigger, isCyclic, scheduleLabel, STATUS_LABELS, OUTCOME_LABELS, automationListSchema,
  type Automation, type AutomationRun, type AutomationStatus,
} from './automation-contract';

/**
 * Widok „Automaty”: cykliczne i jednorazowe zadania Wektora. Po lewej lista z kropką stanu, harmonogramem i pięcioma
 * kropkami ostatnich runów; po prawej szczegóły wybranego (oś runów, cel i akcje, notatnik, rozmowa). Przyciski to
 * Origin-checked POST-y.
 */
type Tab = 'runs' | 'goal' | 'notebook' | 'chat';

const RUN_CLASS = { 'not-yet': 'idle', done: 'ok', error: 'bad', skipped: 'skip' } as const;
const STATUS_CLASS: Record<AutomationStatus, string> = { active: 'ok', paused: 'warn', done: 'idle', expired: 'idle', cancelled: 'idle' };
const briefChange = (field: string, value: unknown) => { const text = changeValue(field, value); return text.length > 180 ? `${text.slice(0, 177)}…` : text; };
const when = (at?: number) => at ? stamp(at) : '—';
const latestRun = (a: Automation): AutomationRun | undefined => [...a.runs].sort((x, y) => y.at - x.at)[0];
const runTime = (at: number) => new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
const nextLabel = (at?: number) => {
  if (!at) return 'czeka na wyzwalacz';
  const date = new Date(at);
  const days = Math.round((dayNumber(date) - dayNumber(new Date())) / 86_400_000);
  if (days === 0) return `dziś ${runTime(at)}`;
  if (days === 1) return 'jutro';
  if (days === 2) return 'pojutrze';
  return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')} ${runTime(at)}`;
};
const nextText = (a: Automation) => {
  if (a.status === 'done') return 'zakończony';
  if (a.status === 'paused') return 'wstrzymany';
  if (a.status === 'cancelled') return 'anulowany';
  if (a.status === 'expired') return 'wygasły';
  return a.nextRunAt ? `następny ${nextLabel(a.nextRunAt)}` : 'czeka na wyzwalacz';
};
const runDate = (at: number) => {
  const date = new Date(at);
  const days = Math.round((dayNumber(date) - dayNumber(new Date())) / 86_400_000);
  if (days === 0) return `Dziś ${runTime(at)}`;
  if (days === -1) return `Wczoraj ${runTime(at)}`;
  return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')} ${runTime(at)}`;
};
const runsLabel = (count: number) => count === 1 ? '1 run' : count >= 2 && count <= 4 ? `${count} runy` : `${count} runów`;
const durationLabel = (seconds?: number) => {
  if (seconds === undefined) return null;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
};
const costLabel = (usd?: number) => usd === undefined ? null : `${usd.toFixed(4).replace('.', ',')} USD`;
const totalCost = (a: Automation) => {
  if (!a.runs.some(r => r.costUsd !== undefined)) return null;
  return a.runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
};
const detailLine = (a: Automation) => {
  const cost = totalCost(a);
  const end = a.doneWhen ? `kończy się, gdy ${a.doneWhen.replace(/^./, c => c.toLocaleLowerCase('pl-PL')).replace(/\.$/, '')}` : 'kończy się po wykonaniu celu';
  return `${describeTrigger(a.trigger)} · ${runsLabel(a.runs.length)} · koszt łącznie ${cost === null ? '—' : costLabel(cost)} · ${end}`;
};
const rowText = (a: Automation) => {
  const last = latestRun(a);
  const error = last?.outcome === 'error' ? ' · ostatni run z błędem' : '';
  return `${scheduleLabel(a.trigger)} · ${nextText(a)}${error}`;
};
const askText = (a: Automation) => {
  const runs = [...a.runs].sort((x, y) => y.at - x.at).slice(0, 5);
  return [
    `Przejrzyj ostatnie runy automatu „${a.name}” i powiedz, co z nich wynika.`,
    '',
    ...(runs.length ? runs.map(r => `- ${stamp(r.at)} · ${OUTCOME_LABELS[r.outcome]} · ${r.summary}`) : ['- brak runów']),
  ].join('\n');
};

function Dots({ runs }: { runs: AutomationRun[] }) {
  const last = [...runs].sort((a, b) => a.at - b.at).slice(-5);
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
  const [error, setError] = useState<string | false>(false);
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
        setError(value.error ?? false);
        setSelected(current => current && value.automations.some(a => a.id === current) ? current : value.automations[0]?.id ?? null);
      }
    } catch { if (!signal?.aborted) setError('Nie udało się odczytać automatów ani wykonać akcji.'); }
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
    } catch { setError('Nie udało się odczytać automatów ani wykonać akcji.'); }
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
    } catch { setError('Nie udało się odczytać automatów ani wykonać akcji.'); }
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
              {...ctx('automation', a.id, a.name, `${a.name}\nStan: ${STATUS_LABELS[a.status]}\nHarmonogram: ${describeTrigger(a.trigger)}\nCel: ${a.goal}\nOstatnie runy:\n${[...a.runs].sort((x, y) => y.at - x.at).slice(0, 5).map(r => `- ${stamp(r.at)} · ${OUTCOME_LABELS[r.outcome]} · ${r.summary}`).join('\n') || '- brak'}`)}>
              <i className={`automation-dot ${STATUS_CLASS[a.status]}`} aria-label={`stan: ${STATUS_LABELS[a.status]}`} />
              <span className="automation-row-main">
                <span className="automation-name">{a.name}</span>
                <span className="meta">{rowText(a)}</span>
              </span>
              <Dots runs={a.runs} />
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );

  const orderedRuns = chosen ? [...chosen.runs].sort((a, b) => b.at - a.at) : [];

  return (
    <div className="automation-view">
      <Card title="Automaty" icon={<Bot />} className="automation-card">
        {error && <p className="warning" role="status">{error}</p>}
        {!rows ? <p className="meta">Odczytuję automaty…</p> : rows.length === 0 ? (
          <div className="automation-empty">
            <Bot size={26} aria-hidden="true" />
            <p>Brak automatów. Automat tworzy się w rozmowie z Wektorem — poproś go, żeby coś sprawdzał cyklicznie.</p>
          </div>
        ) : (
          <div className="automation-layout">
            <div className="automation-side" role="navigation" aria-label="Lista automatów">
              {group('Cykliczne', cyclic)}
              {group('Jednorazowe', oneShot)}
            </div>
            {chosen && <section className="automation-detail" aria-label={`Automat ${chosen.name}`}>
              <header className="automation-head">
                <div className="automation-head-main">
                  <h2>{chosen.name}</h2>
                  <p className="meta">{detailLine(chosen)}</p>
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
                {orderedRuns.length === 0 ? <p className="meta">Brak runów.</p> : <div className="automation-runs-layout">
                  <ol className="automation-runs automation-axis">
                    {orderedRuns.map((r, i) => <li key={r.id} className={i === 0 ? 'newest' : ''}>
                      <div className="automation-axis-rail" aria-hidden="true">
                        <i className={`automation-dot ${RUN_CLASS[r.outcome]}`} />
                        {i < orderedRuns.length - 1 && <span className="automation-axis-line" />}
                      </div>
                      {i === 0 ? <div className="automation-run-card">
                        <div className="automation-run-head">
                          <span className="automation-run-when">{runDate(r.at)}</span>
                          {durationLabel(r.seconds) && <span className="meta">{durationLabel(r.seconds)}</span>}
                          {costLabel(r.costUsd) && <span className="meta">{costLabel(r.costUsd)}</span>}
                          <span className="automation-run-outcome">{OUTCOME_LABELS[r.outcome]}</span>
                        </div>
                        <p className="automation-run-summary">{r.summary}</p>
                        <p className="automation-run-meta">{r.notebookChanged ? 'notatnik zmieniony' : 'notatnik bez zmian'}</p>
                        <button className="link-button" onClick={() => openChatConversation(r.chatId)}><MessageSquare size={14} /> Otwórz rozmowę runu</button>
                      </div> : <p className="automation-axis-older"><span className="automation-run-when">{runDate(r.at)}</span> — {r.summary}</p>}
                    </li>)}
                  </ol>
                  <aside className="automation-run-aside" aria-label="Pomoc do runów">
                    <div className="automation-aside-card wektor">
                      <h3><Sparkles size={15} aria-hidden="true" /> Wektor o tych runach</h3>
                      <p>Otwórz rozmowę automatu z gotowym pytaniem o historię runów. Nic nie wyśle się samo — treść czeka w polu wiadomości.</p>
                      <button className="link-button" onClick={() => openChatConversation(chosen.chatId, askText(chosen))}>Zapytaj Wektora o te runy</button>
                    </div>
                    <div className="automation-aside-card">
                      <h3>Gdy cel zostanie osiągnięty</h3>
                      <p>{chosen.doneWhen ?? 'Automat nie ma dodatkowego warunku celu.'}</p>
                      <ul>
                        {chosen.actions.length ? chosen.actions.map((a, i) => <li key={i}>{ACTION_LABELS[a.kind]}</li>) : <li className="meta">Brak akcji — automat tylko sprawdza.</li>}
                      </ul>
                    </div>
                  </aside>
                </div>}
              </div>}
              {tab === 'goal' && <div className="automation-tab" role="tabpanel" aria-label="Cel i akcje">
                <h3>Historia zmian</h3>
                {chosen.changes.length === 0 ? <p className="meta">Brak zmian.</p> : <ul>
                  {[...chosen.changes].reverse().map((change, i) => <li key={i}>
                    <span className="meta">{when(change.at)} · {change.by === 'user' ? 'użytkownik' : 'Wektor'}</span>
                    {Object.entries(change.fields).map(([field, value]) => <p key={field} className="automation-goal" title={`${changeValue(field, value.before)} → ${changeValue(field, value.after)}`}>{CHANGE_LABELS[field] ?? field}: {briefChange(field, value.before)} → {briefChange(field, value.after)}</p>)}
                  </li>)}
                </ul>}
                <h3>Cel</h3>
                <p className="automation-goal">{chosen.goal}</p>
                {chosen.doneWhen && <><h3>Cel osiągnięty, gdy</h3><p>{chosen.doneWhen}</p></>}
                <h3>Zatwierdzone akcje</h3>
                <div className="automation-chips">{chosen.actions.length ? chosen.actions.map((a, i) => <span key={i} className="automation-chip">{ACTION_LABELS[a.kind]}</span>) : <span className="meta">brak</span>}</div>
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
