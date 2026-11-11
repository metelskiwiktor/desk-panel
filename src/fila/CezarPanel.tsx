import { useEffect, useState } from 'react';
import { GitPullRequest, Send } from 'lucide-react';
import { filaDispatchExpected, filaDispatchMatches, getFilaDispatch, type FilaDispatchExpected } from '../fila-dispatch';
import { safeUrl } from '../model';
import { TODO_EXECUTORS, TODO_MODES } from '../todo-contract';
import { announceFilaChange, useFilaActions, useFilaGet, useFilaSpec, type FilaRegistry, type FilaThreadDoc } from './api';

/**
 * „Zablokowane” of a thread (2.3a): its blocks with „Zdejmij” at each and a form for a new reason. The field is the
 * thread's own and only informs; it sits in this panel, with or without the Cezar kit, until its own screen is designed.
 */
function Blockers({ thread }: { thread: FilaThreadDoc }) {
  const { act, error, clear } = useFilaActions();
  const [reason, setReason] = useState('');
  return <div className="fl-blockers">
    {thread.blockers.length > 0 && <ul className="fl-blocked" aria-label="Zablokowane">{thread.blockers.map(blocker => <li key={blocker.id}>
      <span>Zablokowane: {blocker.reason}</span>
      <button type="button" className="fl-text" onClick={() => void act({ action: 'removeBlocker', thread: thread.id, blocker: blocker.id, expectedRevision: thread.revision })}>Zdejmij</button>
    </li>)}</ul>}
    <form className="fl-block-form" onSubmit={event => { event.preventDefault(); if (reason.trim()) void act({ action: 'addBlocker', thread: thread.id, reason: reason.trim(), expectedRevision: thread.revision }).then(result => { if (result) setReason(''); }); }}>
      <input aria-label="Powód blokady" placeholder="Powód blokady" maxLength={300} value={reason} onChange={event => setReason(event.target.value)} />
      <button type="submit" className="fl-text" disabled={!reason.trim()}>Zablokuj</button>
    </form>
    {error && <p className="fl-error" role="alert">{error}<button type="button" className="fl-text" onClick={clear}>Zamknij</button></p>}
  </div>;
}

/**
 * The Cezar kit of a thread (part 4): executor, repo and mode, task and PR as links, readiness with its gaps
 * (C1, the very function the server uses), the exact prompt as a preview, and „Zleć Cezarowi” from the user's click only (D-042).
 * Nothing here dispatches by itself, and any change to the thread voids the consent given by the preview.
 */
export function CezarPanel({ thread, readyStates }: { thread: FilaThreadDoc; readyStates: FilaRegistry['cezarSettings']['readyStates'] }) {
  const { act, error, clear } = useFilaActions();
  const spec = useFilaSpec(thread.spec.enabled && thread.spec.revision > 0 ? thread.id : null);
  const register = useFilaGet<{ dispatches: { specRevision: number; mode: string; taskId: string; url: string }[] }>(thread.cezar.enabled ? `/api/fila/threads/${thread.id}/cezar-dispatch/register` : null);
  const [preview, setPreview] = useState<{ prompt: string; workflow: string | null; specRevision: number; expected: FilaDispatchExpected } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [failure, setFailure] = useState('');
  const [done, setDone] = useState<{ taskId: string; url: string } | null>(null);
  useEffect(() => { setPreview(null); setFailure(''); setDone(null); }, [thread.id]);

  const cezar = thread.cezar;
  const specText = spec.data?.text ?? null;
  const ready = getFilaDispatch(thread, specText, readyStates);
  // Whatever changed since the preview (a field of the kit, the Stan, the title, a new Specyfikacja revision) voids it; a block does not.
  const stale = preview !== null && !filaDispatchMatches(thread, preview.expected);
  const consent = preview !== null && !stale && ready.missing.length === 0;
  const send = (change: Record<string, unknown>) => act({ action: 'setCezar', thread: thread.id, expectedRevision: thread.revision, ...change } as never);

  const openPreview = () => {
    if (!ready.prompt) return;
    setPreview({ prompt: ready.prompt, workflow: ready.workflow, specRevision: ready.specRevision, expected: filaDispatchExpected(thread) });
    setFailure(''); setDone(null);
  };
  const dispatch = async () => {
    if (!consent || !preview || requesting) return;
    setRequesting(true); setFailure(''); setDone(null);
    try {
      const response = await fetch(`/api/fila/threads/${thread.id}/cezar-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: preview.expected }), signal: AbortSignal.timeout(20000) });
      const body = await response.json().catch(() => ({})) as { taskId?: unknown; url?: unknown; error?: unknown };
      if (response.ok && typeof body.taskId === 'string' && typeof body.url === 'string') { setDone({ taskId: body.taskId, url: body.url }); setPreview(null); }
      else if (response.status === 409) setFailure(typeof body.error === 'string' && body.error ? body.error : 'Nie można teraz zlecić — dane się zmieniły albo wątek już zlecono.');
      else setFailure('Zlecenie mogło nie dojść — sprawdź Cezara. Nic nie zostało ponowione.');
    } catch { setFailure('Zlecenie mogło nie dojść — sprawdź Cezara. Nic nie zostało ponowione.'); }
    finally { setRequesting(false); announceFilaChange(); }
  };

  if (!cezar.enabled) return <section className="fl-cezar" aria-label="Cezar">
    <h2>Cezar</h2>
    <p className="fl-muted">Wątek nie ma zestawu pól Cezara.</p>
    <button type="button" className="fl-text" onClick={() => void act({ action: 'addCezarKit', thread: thread.id })}>Dodaj zestaw Cezara</button>
    <Blockers thread={thread} />
    {error && <p className="fl-error" role="alert">{error}</p>}
  </section>;

  const last = register.data?.dispatches.find(entry => entry.specRevision === thread.spec.revision && entry.mode === cezar.mode);
  const select = (label: string, value: string | null, options: Record<string, string>, field: 'executor' | 'repo' | 'mode') =>
    <select className="fl-select" aria-label={label} value={value ?? ''} onChange={event => void send({ [field]: event.target.value || null })}>
      <option value="">—</option>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>;
  return <section className="fl-cezar" aria-label="Cezar">
    <h2>Cezar</h2>
    <dl>
      <dt>Wykonawca</dt><dd>{select('Wykonawca', cezar.executor, TODO_EXECUTORS, 'executor')}</dd>
      <dt>Repo</dt><dd>{select('Repo', cezar.repo, { 'desk-panel': 'desk-panel' }, 'repo')}</dd>
      <dt>Tryb</dt><dd>{select('Tryb', cezar.mode, TODO_MODES, 'mode')}</dd>
    </dl>
    <Blockers thread={thread} />
    {cezar.links.length > 0 && <ul className="fl-links" aria-label="Powiązania">{cezar.links.map(link => {
      const url = link.kind === 'pr' ? safeUrl(link.id) : last && last.taskId === link.id ? safeUrl(last.url) : undefined;
      const text = link.kind === 'pr' ? `PR ${link.id.split('/').slice(-3).join('/')}` : `Task ${link.id.split('/').pop()?.slice(-8) ?? link.id}`;
      return <li key={`${link.kind}:${link.id}`}>{link.kind === 'pr' ? <GitPullRequest size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
        {url ? <a className="fl-link" href={url} target="_blank" rel="noreferrer">{text}</a> : <span title={link.id}>{text}</span>}</li>;
    })}</ul>}

    {ready.missing.length > 0
      ? <ul className="fl-missing" aria-label="Braki gotowości">{ready.missing.map((item, index) => <li key={index}>{item}</li>)}</ul>
      : <p className="fl-ready ok">Gotowe do zlecenia · rewizja {ready.specRevision}</p>}
    {ready.missing.length === 0 && (preview
      ? <div className="fl-preview">
        <p className="fl-muted">{preview.workflow} · rewizja v{preview.specRevision}</p>
        <pre aria-label="Podgląd promptu">{preview.prompt}</pre>
      </div>
      : <button type="button" className="fl-text" onClick={openPreview}>Pokaż podgląd</button>)}
    {preview && stale && <p className="fl-warn" role="status">Dane wątku zmieniły się od podglądu — odśwież go, zanim zlecisz.</p>}
    {preview && (stale || ready.missing.length > 0) && ready.prompt && <button type="button" className="fl-text" onClick={openPreview}>Odśwież podgląd</button>}
    {ready.missing.length === 0 && <button type="button" className="fl-primary wide" disabled={!consent || requesting} onClick={() => void dispatch()}><Send size={15} aria-hidden="true" /> {requesting ? 'Zlecam…' : 'Zleć Cezarowi'}</button>}
    {last && !done && <p className="fl-muted">Ostatnie zlecenie tej rewizji: <a className="fl-link" href={safeUrl(last.url)} target="_blank" rel="noreferrer">{last.taskId.split('/').pop()?.slice(-8)}</a>. Ponowienie blokuje serwer, dopóki task trwa albo się udał.</p>}
    {done && <p className="fl-ready ok" role="status">Zlecono Cezarowi: <a className="fl-link" href={safeUrl(done.url)} target="_blank" rel="noreferrer">{done.taskId.split('/').pop()?.slice(-8)}</a></p>}
    {failure && <p className="fl-error" role="alert">{failure}</p>}
    {error && <p className="fl-error" role="alert">{error}<button type="button" className="fl-text" onClick={clear}>Zamknij</button></p>}
    <button type="button" className="fl-text danger" onClick={() => void act({ action: 'removeCezarKit', thread: thread.id })}>Zdejmij zestaw Cezara</button>
  </section>;
}
