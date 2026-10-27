import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the Hermes API server, over real HTTP and SSE, with the shapes `hermes-api.ts` reads. The tests drive
 * it (dropped streams, a restart that forgets runs, a provider that sends no text deltas, approvals) and the scenario
 * mode answers from it, so the Hermes chat can be tried and photographed without Hermes and without spending a limit.
 *
 * A run answers from a script: a `panel_todos` tool step, then the answer word by word. A message with „zgod” in it
 * asks for approval first (`terminal`), and the answer says what was decided.
 */
export interface MockHermesOptions {
  key?: string;
  /** Pause between two events of a run. */
  stepMs?: number;
  /** False: the provider gives no text deltas (the bug of the agy provider without its patch); only the final output. */
  deltas?: boolean;
  /** False: events carry no `id:` lines, so a stream cannot resume after an id. */
  eventIds?: boolean;
}

interface MockRun {
  id: string;
  session: string;
  input: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  output?: string;
  events: { id: number; name: string; data: Record<string, unknown> }[];
  streams: Set<ServerResponse>;
  approval?: { id: string; resolve: (approved: boolean) => void };
  timers: Set<ReturnType<typeof setTimeout>>;
}

export interface MockHermes {
  url: string;
  key?: string;
  runs: Map<string, MockRun>;
  sessions: Map<string, { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[]>;
  requests: { method: string; path: string; body?: unknown; auth?: string }[];
  /** Ends every open event stream without the end of its run (a dropped connection). */
  dropStreams(): void;
  /** Hermes restarted: runs are forgotten (sessions stay, they are on disk), open streams end. */
  forgetRuns(): void;
  /** True: every request is refused as if Hermes were not running. */
  setDown(down: boolean): void;
  /** Changes what runs started from now on do. */
  configure(options: Partial<MockHermesOptions>): void;
  close(): Promise<void>;
}

/** What the user typed: the end of the input, after the preamble and the [Kontekst] block. */
const messageOf = (input: string) => input.includes('[Wiadomość]\n') ? input.slice(input.lastIndexOf('[Wiadomość]\n') + '[Wiadomość]\n'.length) : input.split('\n\n').at(-1) ?? input;
const answerFor = (input: string) => {
  const message = messageOf(input);
  const picked = [...input.matchAll(/^\d+\. ([^:\n]+): (.+)$/gm)].map(m => `${m[1]}: „${m[2]}”`);
  return picked.length
    ? `Widzę ${picked.length === 1 ? 'jeden wskazany element' : `${picked.length} wskazane elementy`}:\n\n${picked.map(p => `- ${p}`).join('\n')}\n\nTo **Hermes w trybie scenariusza**: odpowiadam z gotowego skryptu.`
    : `To **Hermes w trybie scenariusza**: odpowiadam z gotowego skryptu na „${message.trim().slice(0, 80)}”. Wskaż element na pulpicie, a pokażę, co do mnie dotarło.`;
};

/** The first run a scenario dispatches (server/scenario.ts numbers them). */
export const MOCK_DISPATCHED = 'desk-panel/00000000-0000-4000-8000-000000000001';
const MOCK_PROMPT = [
  'Task: Show the Cezar task status chip in the chat cockpit header.',
  'Type: UI',
  'Scenario for screenshots: standard (page: pulpit, open: cockpit)',
  'Relevant files (from recon):',
  '- src/ChatWindow.tsx',
  '- src/cockpit/Cockpit.tsx',
  'Acceptance criteria:',
  '- [ ] The header shows RUNNING / REVIEW / DONE of the watched task',
  '- [ ] Colours from the panel palette',
  '- [ ] Screenshots before/after on the standard scenario',
].join('\n');
type MockTool = { name: string; args: Record<string, unknown>; output: string };
/** The panel tools a message makes the stand-in call, like Hermes with the two skills, and the answer after them. */
function scriptFor(input: string): { tools: MockTool[]; answer?: string } {
  // A skill picked with @ comes as a context item; the typed text counts too (the preamble names both skills, so not it).
  const message = messageOf(input);
  const skill = (name: string) => new RegExp(`^\\d+\\. Skill: ${name}`, 'mi').test(input);
  if (skill('Zaimplementuj zadanie') || /zaimplementuj/i.test(message)) return {
    tools: [
      { name: 'mcp_desk-panel_panel_recon_report', output: 'Karta rekonesansu jest u użytkownika.', args: {
        files: [{ path: 'src/ChatWindow.tsx', note: 'nagłówek okna' }, { path: 'src/cockpit/Cockpit.tsx', note: 'kokpit taska' }, { path: 'scenarios/standard.json', note: 'dane do zrzutów' }],
        kind: 'UI', scenario: 'standard', prompt: MOCK_PROMPT,
      } },
      { name: 'mcp_desk-panel_panel_cezar_propose', output: 'Karta „Zlecić na Cezarze?” jest u użytkownika.', args: { title: 'Chip statusu taska w kokpicie', prompt: MOCK_PROMPT } },
    ],
    answer: '**Plan**\n\n- chip statusu obok tytułu kokpitu,\n- kolory z palety panelu,\n- zrzuty przed i po na scenariuszu `standard`.\n\nDecyzja w karcie poniżej.',
  };
  if (skill('Nasłuchuj Cezara') || /nasłuchuj|nasluchuj/i.test(message)) return {
    tools: [{ name: 'mcp_desk-panel_panel_cezar_watch', args: { id: MOCK_DISPATCHED }, output: JSON.stringify({ task: { id: MOCK_DISPATCHED, title: 'Chip statusu taska w kokpicie', status: 'RUNNING', progress: 0.33, steps: [] } }) }],
    answer: `Nasłuchuję Cezara: **${MOCK_DISPATCHED}**. Postęp widać w karcie i w kokpicie obok.`,
  };
  return { tools: [{ name: 'mcp_desk-panel_panel_todos', args: { list: 'Zadania' }, output: 'Lista „Zadania” (l-1): 2 do zrobienia.' }] };
}

export async function startMockHermes(initial: MockHermesOptions = {}): Promise<MockHermes> {
  let options: MockHermesOptions = { stepMs: 40, deltas: true, eventIds: true, ...initial };
  const runs = new Map<string, MockRun>();
  const sessions: MockHermes['sessions'] = new Map();
  const requests: MockHermes['requests'] = [];
  let down = false;
  const sockets = new Set<import('node:net').Socket>();

  const write = (res: ServerResponse, event: MockRun['events'][number]) => {
    res.write(`${options.eventIds ? `id: ${event.id}\n` : ''}event: ${event.name}\ndata: ${JSON.stringify({ event: event.name, ...event.data })}\n\n`);
  };
  const push = (run: MockRun, name: string, data: Record<string, unknown> = {}) => {
    const event = { id: run.events.length + 1, name, data: { run_id: run.id, ...data } };
    run.events.push(event);
    for (const res of run.streams) write(res, event);
    if (['run.completed', 'run.failed', 'run.cancelled'].includes(name)) { for (const res of run.streams) res.end(); run.streams.clear(); }
  };
  const later = (run: MockRun, ms: number) => new Promise<void>(resolve => { const t = setTimeout(() => { run.timers.delete(t); resolve(); }, ms); run.timers.add(t); });
  const over = (run: MockRun) => run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';

  const play = async (run: MockRun) => {
    const step = options.stepMs ?? 40;
    const history = sessions.get(run.session)!;
    const call = `call_${run.events.length}_${randomUUID().slice(0, 8)}`;
    let prefix = '';
    if (/zgod/i.test(messageOf(run.input))) {
      const approval = `ap_${randomUUID().slice(0, 8)}`;
      run.status = 'waiting';
      const approved = await new Promise<boolean>(resolve => {
        run.approval = { id: approval, resolve };
        push(run, 'approval.requested', { approval_id: approval, tool_name: 'terminal', command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 5', description: 'Polecenie powłoki' });
      });
      if (over(run)) return;
      run.status = 'running';
      push(run, 'approval.resolved', { approval_id: approval, choice: approved ? 'once' : 'deny' });
      prefix = approved ? 'Zgoda przyjęta: polecenie wykonane. ' : 'Bez zgody nie uruchomiłem polecenia. ';
    }
    const script = scriptFor(run.input);
    const calls = script.tools.map((tool, i) => ({ ...tool, id: i ? `${call}_${i}` : call }));
    for (const tool of calls) {
      await later(run, step);
      if (over(run)) return;
      push(run, 'tool.started', { tool_call_id: tool.id, tool_name: tool.name, arguments: tool.args });
      await later(run, step * 3);
      if (over(run)) return;
      push(run, 'tool.completed', { tool_call_id: tool.id, tool_name: tool.name, output: tool.output });
    }
    const output = `${prefix}${script.answer ?? answerFor(run.input)}`;
    if (options.deltas) {
      for (const word of output.match(/\S+\s*/g) ?? []) {
        await later(run, step);
        if (over(run)) return;
        push(run, 'message.delta', { delta: word });
      }
    }
    await later(run, step);
    if (over(run)) return;
    run.status = 'completed';
    run.output = output;
    history.push({ role: 'assistant', content: '', tool_calls: calls.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) });
    for (const t of calls) history.push({ role: 'tool', tool_call_id: t.id, content: t.output });
    history.push({ role: 'assistant', content: output });
    push(run, 'run.completed', { output, session_id: run.session, usage: { input_tokens: 1200, output_tokens: 80 } });
  };

  const json = (res: ServerResponse, status: number, value: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  const readBody = async (req: IncomingMessage) => { let body = ''; for await (const chunk of req) body += chunk; return body ? JSON.parse(body) : {}; };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const body = req.method === 'POST' ? await readBody(req).catch(() => null) : undefined;
    requests.push({ method: req.method ?? 'GET', path: url.pathname, body, auth: req.headers.authorization });
    if (down) { req.socket.destroy(); return; }
    if (url.pathname === '/health') return json(res, 200, { status: 'ok', platform: 'hermes-agent' });
    if (options.key && req.headers.authorization !== `Bearer ${options.key}`) return json(res, 401, { error: { message: 'Invalid API key' } });
    if (url.pathname === '/v1/runs' && req.method === 'POST') {
      if (!body || typeof body.input !== 'string') return json(res, 400, { error: 'input required' });
      const session = typeof body.session_id === 'string' ? body.session_id : `sess_${randomUUID()}`;
      const run: MockRun = { id: `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`, session, input: body.input, status: 'running', events: [], streams: new Set(), timers: new Set() };
      runs.set(run.id, run);
      if (!sessions.has(session)) sessions.set(session, []);
      sessions.get(session)!.push({ role: 'user', content: body.input });
      void play(run);
      return json(res, 202, { run_id: run.id, status: 'started', session_id: session });
    }
    const runMatch = /^\/v1\/runs\/([^/]+)(?:\/(events|approval|cancel))?$/.exec(url.pathname);
    if (runMatch) {
      const run = runs.get(decodeURIComponent(runMatch[1]));
      if (!run) return json(res, 404, { error: { message: 'Run not found' } });
      const action = runMatch[2];
      if (!action) return json(res, 200, { run_id: run.id, status: run.status, session_id: run.session, ...(run.output ? { output: run.output } : {}) });
      if (action === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(': hermes mock\n\n');
        const after = Number(req.headers['last-event-id'] ?? 0) || 0;
        for (const event of run.events) if (event.id > after) write(res, event);
        if (over(run)) { res.end(); return; }
        run.streams.add(res);
        req.on('close', () => run.streams.delete(res));
        return;
      }
      if (action === 'approval' && req.method === 'POST') {
        if (!run.approval || (body?.approval_id && body.approval_id !== run.approval.id)) return json(res, 409, { error: { message: 'No pending approval' } });
        const pending = run.approval;
        run.approval = undefined;
        pending.resolve(body?.choice !== 'deny');
        return json(res, 200, { ok: true });
      }
      if (action === 'cancel' && req.method === 'POST') {
        if (!over(run)) {
          run.status = 'cancelled';
          for (const t of run.timers) clearTimeout(t);
          run.approval?.resolve(false);
          push(run, 'run.cancelled', {});
        }
        return json(res, 200, { ok: true, status: run.status });
      }
    }
    const sessionMatch = /^\/v1\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
    if (sessionMatch) {
      const messages = sessions.get(decodeURIComponent(sessionMatch[1]));
      if (!messages) return json(res, 404, { error: { message: 'Session not found' } });
      return json(res, 200, { session_id: sessionMatch[1], messages });
    }
    json(res, 404, { error: { message: 'Not found' } });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url, key: initial.key, runs, sessions, requests,
    dropStreams() { for (const run of runs.values()) { for (const res of run.streams) res.destroy(); run.streams.clear(); } },
    forgetRuns() { for (const run of runs.values()) { for (const t of run.timers) clearTimeout(t); for (const res of run.streams) res.destroy(); run.status = 'failed'; } runs.clear(); },
    setDown(value) { down = value; if (value) for (const socket of sockets) socket.destroy(); },
    configure(next) { options = { ...options, ...next }; },
    async close() {
      for (const run of runs.values()) { for (const t of run.timers) clearTimeout(t); run.approval?.resolve(false); }
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
