/**
 * The panel's only door to Hermes Agent: its long-running API server (loopback HTTP, bearer key), never the CLI.
 * Everything Hermes-specific about the wire (paths, field and event names) is in this file, so a change of the API is a
 * change here and in its test, not in the chat service. Shapes follow Hermes v0.21 (`/v1/runs`, run events over SSE,
 * approvals, cancel, session history); fields are read leniently because the event payloads grew between versions.
 */

/** Paths of the Hermes API server. */
export const HERMES_ROUTES = {
  health: '/health',
  runs: '/v1/runs',
  run: (run: string) => `/v1/runs/${encodeURIComponent(run)}`,
  events: (run: string) => `/v1/runs/${encodeURIComponent(run)}/events`,
  approval: (run: string) => `/v1/runs/${encodeURIComponent(run)}/approval`,
  cancel: (run: string) => `/v1/runs/${encodeURIComponent(run)}/cancel`,
  /** Older servers stop a run here instead. */
  stop: (run: string) => `/v1/runs/${encodeURIComponent(run)}/stop`,
  /** A session's history, a page of at most 500 messages (`offset` counts from the newest, each page oldest first). */
  sessionMessages: (session: string, offset = 0) => `/api/sessions/${encodeURIComponent(session)}/messages?limit=${HISTORY_PAGE}&offset=${offset}`,
  /** Servers before 0.21 kept the history here, whole. */
  legacySessionMessages: (session: string) => `/v1/sessions/${encodeURIComponent(session)}/messages`,
} as const;

export const DEFAULT_HERMES_URL = 'http://127.0.0.1:8642';
export const HISTORY_PAGE = 500;
/** A conversation is read up to this many pages back (10 000 messages). */
const HISTORY_PAGES = 20;

/** Ids that go into a path or a body: what Hermes hands out, nothing a path could be built from. */
export const HERMES_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export class HermesError extends Error {
  /** `status` 0: Hermes could not be reached (refused, timed out). */
  constructor(readonly status: number, message: string) { super(message); }
  get unreachable() { return this.status === 0; }
}

export type RunState = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export interface RunStatus { state: RunState; output?: string; error?: string; session?: string }

/** One event of a run, in the panel's own words. */
export type HermesEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: string }
  | { kind: 'tool-end'; id: string; name: string; output?: string; error?: string }
  | { kind: 'progress'; text: string }
  | { kind: 'approval'; id: string; tool: string; detail: string }
  | { kind: 'approval-resolved'; id: string; approved: boolean | null }
  | { kind: 'completed'; output?: string; session?: string; usage?: Record<string, unknown> }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' }
  | { kind: 'ignored'; name: string };

/** A message of a session's history, as Hermes stores it (OpenAI chat shape). */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: { id: string; name: string; arguments: string }[];
  toolCallId?: string;
}

export interface HermesClient {
  readonly url: string;
  health(): Promise<void>;
  startRun(input: { input: string; session: string; instructions?: string }): Promise<{ run: string; session?: string }>;
  status(run: string): Promise<RunStatus>;
  /** Reads the run's events until the stream ends or `signal` aborts. Resumes after `lastEventId` when given. */
  events(run: string, onEvent: (event: HermesEvent, id: string | null) => void, options: { signal: AbortSignal; lastEventId?: string | null }): Promise<void>;
  approve(run: string, approval: string, approve: boolean): Promise<void>;
  cancel(run: string): Promise<void>;
  history(session: string): Promise<HistoryMessage[]>;
}

export interface HermesClientOptions {
  url?: string;
  /** `API_SERVER_KEY` of Hermes, sent as a bearer token. Never logged or shown. */
  key?: string;
  /** Per request (the event stream excepted); a request that hangs must not hold a turn. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Only a local Hermes: the key and the user's data never leave this computer through this client. */
export function hermesUrl(value: string | undefined): string {
  const url = new URL(value?.trim() || DEFAULT_HERMES_URL);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('DESK_HERMES_URL must be a local HTTP address without credentials');
  }
  return url.href.replace(/\/$/, '');
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const first = (o: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = o[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
const text = (value: unknown, max = 4000): string => {
  if (value === undefined || value === null) return '';
  return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, max);
};
const errorText = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return str(rec(value).message) ?? JSON.stringify(value).slice(0, 300);
};
const safeId = (value: unknown): string | null => { const id = typeof value === 'number' ? String(value) : str(value); return id && HERMES_ID.test(id) ? id : null; };

const STATES: Record<string, RunState> = {
  queued: 'running', pending: 'running', started: 'running', running: 'running', in_progress: 'running', streaming: 'running',
  waiting: 'waiting', waiting_approval: 'waiting', awaiting_approval: 'waiting', requires_action: 'waiting',
  completed: 'completed', complete: 'completed', succeeded: 'completed', success: 'completed', done: 'completed', finished: 'completed',
  failed: 'failed', error: 'failed', errored: 'failed', expired: 'failed', timeout: 'failed', timed_out: 'failed',
  cancelled: 'cancelled', canceled: 'cancelled', stopped: 'cancelled', interrupted: 'cancelled',
};
export function runStatusOf(body: unknown): RunStatus {
  const o = rec(body), run = rec(o.run);
  const raw = String(first(o, 'status', 'state') ?? first(run, 'status', 'state') ?? '').toLowerCase();
  const output = first(o, 'output', 'final_response', 'response', 'result') ?? first(run, 'output', 'final_response', 'response');
  return {
    state: STATES[raw] ?? 'unknown',
    output: typeof output === 'string' ? output : str(rec(output).text) ?? str(rec(output).content),
    error: errorText(first(o, 'error', 'last_error') ?? first(run, 'error')),
    session: safeId(first(o, 'session_id', 'session') ?? first(run, 'session_id')) ?? undefined,
  };
}

/** One SSE event (its `event:` name, if any, and `data:` JSON) in the panel's words. */
export function hermesEventOf(name: string | null, data: unknown): HermesEvent {
  const o = rec(data);
  const type = String(name && name !== 'message' ? name : first(o, 'event', 'type') ?? '').toLowerCase();
  const payload = { ...o, ...rec(o.data) };
  const tool = rec(payload.tool);
  const toolName = String(first(payload, 'tool_name', 'name') ?? str(payload.tool) ?? first(tool, 'name') ?? 'narzędzie').slice(0, 120);
  const toolId = safeId(first(payload, 'tool_call_id', 'call_id', 'id') ?? first(tool, 'id')) ?? `${toolName}`;
  switch (type) {
    case 'message.delta': case 'response.output_text.delta': case 'text.delta': case 'delta': case 'content.delta':
      return { kind: 'delta', text: String(first(payload, 'delta', 'text', 'content') ?? '') };
    case 'tool.started': case 'tool.start': case 'tool_call.started': case 'tool.call':
      return { kind: 'tool-start', id: toolId, name: toolName, input: text(first(payload, 'arguments', 'args', 'input', 'preview', 'command') ?? first(tool, 'arguments', 'args'), 600) };
    case 'tool.completed': case 'tool.finished': case 'tool.result': case 'tool_call.completed': case 'tool.failed':
      return { kind: 'tool-end', id: toolId, name: toolName, output: text(first(payload, 'output', 'result', 'preview', 'content')) || undefined, error: errorText(payload.error) ?? (type === 'tool.failed' ? 'Narzędzie zakończyło się błędem.' : undefined) };
    case 'approval.requested': case 'approval.required': case 'approval.request': case 'run.requires_action':
      return {
        kind: 'approval',
        id: safeId(first(payload, 'approval_id', 'request_id', 'id')) ?? '',
        tool: String(first(payload, 'tool_name', 'tool', 'pattern_key', 'kind') ?? 'narzędzie').slice(0, 120),
        detail: text(first(payload, 'command', 'description', 'detail', 'preview', 'arguments') ?? '', 1200),
      };
    case 'approval.resolved': case 'approval.responded': case 'approval.granted': case 'approval.denied': case 'approval.expired': {
      const choice = String(first(payload, 'choice', 'decision', 'result') ?? '').toLowerCase();
      const approved = type === 'approval.granted' || payload.approved === true || ['once', 'session', 'always', 'approve', 'approved', 'allow'].includes(choice) ? true
        : type === 'approval.denied' || payload.approved === false || ['deny', 'denied', 'reject'].includes(choice) ? false : null;
      return { kind: 'approval-resolved', id: safeId(first(payload, 'approval_id', 'request_id', 'id')) ?? '', approved };
    }
    case 'reasoning.available': case 'reasoning.delta': case 'thinking': case 'run.status': case 'status': case 'progress': case 'run.progress':
      return { kind: 'progress', text: String(first(payload, 'message', 'status', 'text') ?? (type.startsWith('reasoning') || type === 'thinking' ? 'Myśli…' : '')).slice(0, 200) };
    case 'run.completed': case 'response.completed': case 'completed': case 'done': {
      const output = first(payload, 'output', 'final_response', 'response', 'text');
      return { kind: 'completed', output: typeof output === 'string' ? output : str(rec(output).text), session: safeId(first(payload, 'session_id')) ?? undefined, usage: rec(payload.usage) };
    }
    case 'run.failed': case 'run.error': case 'error': case 'response.failed':
      return { kind: 'failed', error: errorText(first(payload, 'error', 'message')) ?? 'Hermes nie dokończył odpowiedzi.' };
    case 'run.cancelled': case 'run.canceled': case 'run.stopped': case 'cancelled':
      return { kind: 'cancelled' };
    default:
      return { kind: 'ignored', name: type || 'event' };
  }
}

/** Splits an SSE byte stream into events: `id`, `event`, `data` (multi-line joined). */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (id: string | null, name: string | null, data: string) => void, signal: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', id: string | null = null, name: string | null = null, data: string[] = [];
  const dispatch = () => { if (data.length) onEvent(id, name, data.join('\n')); name = null; data = []; };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + (buffer[at] === '\r' ? 2 : 1));
        if (!line) { dispatch(); continue; }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const val = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') data.push(val);
        else if (field === 'event') name = val;
        else if (field === 'id') id = val || null;
      }
    }
    if (!signal.aborted) dispatch();
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function historyOf(body: unknown): HistoryMessage[] {
  const list = Array.isArray(body) ? body : (rec(body).messages ?? rec(body).data ?? rec(rec(body).session).messages);
  if (!Array.isArray(list)) throw new HermesError(502, 'Hermes zwrócił historię w nieznanym kształcie.');
  const out: HistoryMessage[] = [];
  for (const raw of list) {
    const m = rec(raw);
    const role = String(m.role ?? '');
    if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') continue;
    const content = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map(c => str(rec(c).text) ?? '').join('') : '';
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls.map(c => {
      const call = rec(c), fn = rec(call.function);
      const name = String(fn.name ?? call.name ?? 'narzędzie').slice(0, 120);
      // The panel's own tools keep their arguments whole (a dispatch card carries the executor prompt, up to 32 000), also
      // inside `tool_call`, through which Hermes calls MCP tools.
      return { id: safeId(call.id) ?? '', name, arguments: text(fn.arguments ?? call.arguments, /desk[-_]panel/i.test(name) || name === 'tool_call' ? 32_000 : 600) };
    }) : undefined;
    out.push({ role, content, ...(calls?.length ? { toolCalls: calls } : {}), ...(safeId(m.tool_call_id) ? { toolCallId: safeId(m.tool_call_id)! } : {}) });
  }
  return out;
}

export function createHermesClient(options: HermesClientOptions = {}): HermesClient {
  const base = hermesUrl(options.url);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const doFetch = options.fetch ?? fetch;
  const headers = (extra: Record<string, string> = {}) => ({ ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}), ...extra });

  const request = async (path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> => {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: headers(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new HermesError(0, timedOut ? `Hermes nie odpowiedział w ${Math.round((init.timeoutMs ?? timeoutMs) / 1000)} s.` : `Hermes jest niedostępny pod ${base}.`);
    }
    const body = await response.text();
    if (!response.ok) {
      let reason = '';
      try { reason = errorText(rec(JSON.parse(body)).error) ?? ''; } catch { /* not JSON */ }
      throw new HermesError(response.status, response.status === 401 || response.status === 403
        ? 'Hermes odrzucił klucz API (sprawdź DESK_HERMES_KEY i API_SERVER_KEY).'
        : `Hermes odpowiedział ${response.status}${reason ? `: ${reason.slice(0, 200)}` : ''}.`);
    }
    try { return body ? JSON.parse(body) : {}; } catch { throw new HermesError(502, 'Hermes odpowiedział czymś, co nie jest JSON-em.'); }
  };

  return {
    url: base,
    async health() { await request(HERMES_ROUTES.health, { timeoutMs: 3000 }); },
    async startRun({ input, session, instructions }) {
      const body = rec(await request(HERMES_ROUTES.runs, { method: 'POST', body: { input, session_id: session, ...(instructions ? { instructions } : {}) } }));
      const run = safeId(first(body, 'run_id', 'id') ?? rec(body.run).id);
      if (!run) throw new HermesError(502, 'Hermes nie podał identyfikatora przebiegu.');
      return { run, session: safeId(first(body, 'session_id')) ?? undefined };
    },
    async status(run) { return runStatusOf(await request(HERMES_ROUTES.run(run))); },
    async events(run, onEvent, { signal, lastEventId }) {
      let response: Response;
      // Only the connection has a deadline; an open stream lasts as long as the run (the service watches for silence).
      // (The fetch signal also governs reading the body, so the deadline is a timer cleared once the headers are in.)
      const stream = new AbortController();
      const follow = () => stream.abort();
      signal.addEventListener('abort', follow, { once: true });
      const deadline = setTimeout(() => stream.abort(), timeoutMs);
      try {
        response = await doFetch(`${base}${HERMES_ROUTES.events(run)}`, {
          headers: headers({ Accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) }),
          signal: stream.signal,
        });
      } catch (error) {
        signal.removeEventListener('abort', follow);
        if (signal.aborted) return;
        throw new HermesError(0, `Strumień Hermesa jest niedostępny (${error instanceof Error ? error.name : 'błąd'}).`);
      } finally { clearTimeout(deadline); }
      try {
        if (!response.ok || !response.body) throw new HermesError(response.status || 502, `Strumień Hermesa odpowiedział ${response.status}.`);
        await readSse(response.body, (id, name, data) => {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { parsed = { delta: data }; }
          onEvent(hermesEventOf(name, parsed), id);
        }, stream.signal);
      } finally { signal.removeEventListener('abort', follow); }
    },
    async approve(run, approval, approve) {
      await request(HERMES_ROUTES.approval(run), { method: 'POST', body: { approval_id: approval, choice: approve ? 'once' : 'deny', approved: approve } });
    },
    async cancel(run) {
      try { await request(HERMES_ROUTES.cancel(run), { method: 'POST', body: {} }); }
      catch (error) {
        if (!(error instanceof HermesError) || (error.status !== 404 && error.status !== 405)) throw error;
        await request(HERMES_ROUTES.stop(run), { method: 'POST', body: {} });
      }
    },
    async history(session) {
      const pages: HistoryMessage[][] = [];
      for (let n = 0; n < HISTORY_PAGES; n++) {
        let body: unknown;
        try { body = await request(HERMES_ROUTES.sessionMessages(session, n * HISTORY_PAGE)); }
        catch (error) {
          // An older Hermes has no /api/sessions: its history is all in one answer at the old path.
          if (n === 0 && error instanceof HermesError && error.status === 404) return historyOf(await request(HERMES_ROUTES.legacySessionMessages(session)));
          throw error;
        }
        pages.unshift(historyOf(body));
        const returned = rec(rec(body).pagination).returned;
        const count = typeof returned === 'number' ? returned : Array.isArray(rec(body).data) ? (rec(body).data as unknown[]).length : 0;
        if (count < HISTORY_PAGE) break;
      }
      return pages.flat();
    },
  };
}
