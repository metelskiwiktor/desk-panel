import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { filaDispatchExpected, filaDispatchKey, filaDispatchMatches, getFilaDispatch } from '../src/fila-dispatch';
import { TODO_LIMITS, TODO_STATUSES, todoExecutorSchema, todoModeSchema, todoRepoSchema } from '../src/todo-contract';
import { FILA_LIMITS } from '../src/fila-contract';
import type { Cockpit } from './cockpit';
import { FilaError } from './fila-error';
import type { PanelSources } from './sources';
import { SourceError } from './sources';

/** What the preview showed; the request carries nothing else (no prompt, model, workflow or runner). */
const requestSchema = z.object({
  expected: z.object({
    specRevision: z.number().int().nonnegative(),
    title: z.string().max(FILA_LIMITS.title),
    executor: todoExecutorSchema.nullable(), repo: todoRepoSchema.nullable(), mode: todoModeSchema.nullable(),
    state: z.string().max(FILA_LIMITS.state),
    blocked: z.string().max(TODO_LIMITS.blocked).nullable(),
  }).strict(),
}).strict();

const THREAD = /^\/api\/fila\/threads\/([A-Za-z]{4}-[1-9][0-9]*)\/cezar-dispatch(?:\/(register))?$/;
const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body)); };

/** Keys being dispatched right now: a second request for the same revision and mode meets 409 instead of a second run. */
const inFlight = new Set<string>();

/**
 * Cezar on a Fila thread (docs/fila.md), the same path as the to-do dialog's „Zleć na Cezarze”:
 * `POST /api/fila/threads/ID/cezar-dispatch` is the user's click only (the panel's own Origin, never a client token); it
 * re-reads the thread, compares `expected` with the preview, computes C1 itself and sends the prompt it composed.
 * `GET …/cezar-dispatch/register` reads the kept dispatches of the thread (the projection the screen shows).
 * Handled before `handleFilaRoute`, which would answer an unknown POST with 404.
 */
export async function handleFilaDispatchRoute(req: IncomingMessage, res: ServerResponse, url: URL, ctx: { ownOrigin: string; sources: PanelSources; cockpit?: Cockpit }): Promise<boolean> {
  const match = THREAD.exec(url.pathname);
  if (!match) return false;
  const { sources, cockpit } = ctx;
  try {
    if (!sources.fila) throw new FilaError(503, 'Fila jest niedostępna.');
    const fila = sources.fila;
    if (req.method === 'GET' && match[2] === 'register') {
      const thread = await fila.thread(match[1]!);
      json(res, 200, { thread: thread.id, dispatches: (cockpit?.threadDispatches() ?? []).filter(d => d.uid === thread.uid).map(({ uid: _uid, ...rest }) => rest) });
      return true;
    }
    if (req.method !== 'POST' || match[2]) { res.writeHead(405).end(); return true; }
    // A token never makes the user: this path takes the panel's own page only.
    if (req.headers.authorization !== undefined || req.headers.origin !== ctx.ownOrigin) { res.writeHead(403).end(); return true; }
    if (!cockpit) throw new FilaError(503, 'Kokpit jest niedostępny.');
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) { body += chunk; if (body.length > 16 * 1024) throw new SourceError(413); }
    let value: unknown;
    try { value = JSON.parse(body || 'null'); } catch { throw new FilaError(400, 'Niepoprawne żądanie zlecenia.'); }
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) throw new FilaError(400, 'Niepoprawne żądanie zlecenia.');
    const { expected } = parsed.data;

    const thread = await fila.thread(match[1]!);
    const spec = thread.spec.enabled ? (await fila.spec(thread.id)).text : null;
    // The preview is the only consent: nothing new may have happened to the thread since the user saw it.
    if (!filaDispatchMatches(thread, expected)) throw new FilaError(409, 'Dane wątku zmieniły się od podglądu — odśwież podgląd i zleć ponownie.');
    const dispatch = getFilaDispatch(thread, spec);
    if (!dispatch.prompt || !dispatch.workflow) throw new FilaError(409, dispatch.missing.join(' '));
    const mode = thread.cezar.mode!;
    const key = filaDispatchKey(thread.uid, thread.spec.revision, mode);
    if (inFlight.has(key)) throw new FilaError(409, 'To zlecenie jest właśnie wysyłane.');
    inFlight.add(key);
    try {
      const last = cockpit.threadDispatches().find(entry => filaDispatchKey(entry.uid, entry.specRevision, entry.mode) === key);
      if (last) {
        const snapshot = await sources.cezar();
        const known = [...snapshot.tasks, ...snapshot.finished].find(item => item.id === last.taskId);
        // Still running or finished well: no second dispatch. Failed/cancelled (mapped to FAILED) or gone may retry.
        if (known && known.status !== 'failed') throw new FilaError(409, `Wątek ma już zlecenie (task ${last.taskId}): ${last.url}`);
      }
      if (!sources.cezarCreateRun) throw new SourceError(503);
      const created = await sources.cezarCreateRun({ task: dispatch.prompt, title: thread.title, project: dispatch.project, workflow: dispatch.workflow });
      cockpit.recordThreadDispatch({ uid: thread.uid, thread: thread.id, specRevision: thread.spec.revision, mode, taskId: created.id, url: created.url, at: Date.now() });
      const comment = `Zlecono Cezarowi: rewizja v${thread.spec.revision}, task ${created.id}.${last ? ` Ponowienie po nieudanym tasku ${last.taskId}.` : ''}`;
      try {
        await fila.apply({ action: 'linkCezar', thread: thread.id, kind: 'cezar', id: created.id, title: thread.title }, 'panel');
        await fila.apply({ action: 'comment', thread: thread.id, text: comment }, 'panel');
        await fila.apply({ action: 'updateThread', thread: thread.id, state: TODO_STATUSES.realizacja }, 'panel');
      } catch {
        // The run already started: a link that could not be written must not undo it.
        console.warn(`fila: nie udało się opisać zlecenia ${created.id} na ${thread.id}.`);
      }
      json(res, 200, { ok: true, taskId: created.id, url: created.url });
    } finally { inFlight.delete(key); }
  } catch (error) {
    const status = error instanceof SourceError ? error.status : error instanceof SyntaxError ? 400 : 502;
    const reason = error instanceof FilaError ? error.message : status === 413 ? 'Żądanie jest za duże.' : 'Nie udało się zlecić — sprawdź Cezara.';
    json(res, status, { error: reason });
  }
  return true;
}
