import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { cezarActionSchema } from '../src/cezar-contract';
import { CEZAR_WORKFLOWS, cezarRunId, cockpitToolDescription } from '../src/cockpit-contract';
import { todoActionSchema } from '../src/todo-contract';
import { AgentViewError, DEFAULT_ZONE, type AgentView } from './agent-views';
import { cezarTaskView } from './cockpit';
import { SourceError, type PanelSources } from './sources';
import { TodoError } from './todos';

/**
 * The panel's data as MCP tools for Hermes (`POST /api/mcp`, Streamable HTTP, JSON answers only). Each tool is a narrow
 * adapter over an agent view (`/api/agent/*`, the same short text the agy chat reads) or one of the two writes the chat
 * agent may make. Arguments are checked here before anything runs; nothing else of the panel is reachable through it.
 * Only a local caller with the token gets in (Hermes, configured by `just hermes-setup`): a browser cannot, because a
 * request with an Origin is refused, and the Tailscale name cannot, because only loopback hosts are served.
 */
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const MAX_BODY = 64 * 1024;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const flag = z.boolean().optional();
const text = (max: number) => z.string().trim().min(1).max(max);

interface Tool {
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  /** JSON Schema of the arguments as MCP lists it. */
  schema: Record<string, unknown>;
  run(args: Record<string, any>, ctx: { views: Record<string, AgentView>; sources: PanelSources; now: number; cezarUrl: string }): Promise<string>;
}

const view = (name: string, params: (args: Record<string, any>) => Record<string, string | undefined>) =>
  async (args: Record<string, any>, ctx: { views: Record<string, AgentView>; now: number }) => {
    const url = new URL(`http://panel/api/agent/${name}`);
    for (const [key, value] of Object.entries(params(args))) if (value !== undefined) url.searchParams.set(key, value);
    return ctx.views[name](url, ctx.now);
  };
const range = { from: { type: 'string', description: 'Pierwszy dzień RRRR-MM-DD (domyślnie dziś)' }, to: { type: 'string', description: 'Ostatni dzień RRRR-MM-DD, włącznie (domyślnie from + 6 dni, najwyżej 42 dni)' } };
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

export const PANEL_TOOLS: Record<string, Tool> = {
  panel_calendar: {
    description: 'Wydarzenia kalendarza Google użytkownika w zakresie dni (czas lokalny Europe/Warsaw).',
    input: z.object({ from: date.optional(), to: date.optional(), opisy: flag }).strict(),
    schema: schema({ ...range, opisy: { type: 'boolean', description: 'Dołącz opisy wydarzeń' } }),
    run: view('calendar', a => ({ from: a.from, to: a.to, opisy: a.opisy ? '1' : undefined })),
  },
  panel_training: {
    description: 'Plan treningowy Garmin, zaplanowane treningi i zapisane aktywności w zakresie dni.',
    input: z.object({ from: date.optional(), to: date.optional(), kroki: flag }).strict(),
    schema: schema({ ...range, kroki: { type: 'boolean', description: 'Dołącz kroki treningów' } }),
    run: view('training', a => ({ from: a.from, to: a.to, kroki: a.kroki ? '1' : undefined })),
  },
  panel_cezar: {
    description: 'Zadania Cezara (aktywne i zakończone, niezarchiwizowane). Z parametrem id (projekt/uuid): szczegóły, kroki i błędy wskazanego zadania. Z id i krok: wycinek wyniku tego kroku (błędy testów i typów, podsumowanie agenta); używaj tego zamiast czytania plików .ai/cezar/runs.',
    input: z.object({ id: text(200).optional(), krok: z.string().trim().regex(/^[\w-]{1,60}$/).optional() }).strict()
      .refine(a => !a.krok || a.id, { message: 'krok wymaga id' }),
    schema: schema({
      id: { type: 'string', description: 'Id zadania projekt/uuid (np. desk-panel/cb2f59e7-...)' },
      krok: { type: 'string', description: 'Id kroku z listy kroków, np. verify, implement, fix (wymaga id)' },
    }),
    run: view('cezar', a => ({ id: a.id, krok: a.krok })),
  },
  panel_mail: {
    description: 'Nieprzeczytane wątki Gmail z 30 dni: nadawca, temat, początek (bez treści).',
    input: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    schema: schema({ limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Ile wątków (domyślnie 10)' } }),
    run: view('mail', a => ({ limit: a.limit === undefined ? undefined : String(a.limit) })),
  },
  panel_quotas: { description: 'Limity AI użytkownika z resetami w czasie lokalnym.', input: z.object({}).strict(), schema: schema(), run: view('quotas', () => ({})) },
  panel_system: { description: 'CPU i RAM komputera użytkownika.', input: z.object({}).strict(), schema: schema(), run: view('system', () => ({})) },
  panel_todos: {
    description: 'Listy zadań użytkownika z id list (l-…) i zadań (t-…).',
    input: z.object({ list: text(200).optional(), ukonczone: flag }).strict(),
    schema: schema({ list: { type: 'string', description: 'Id listy albo fragment nazwy' }, ukonczone: { type: 'boolean', description: 'Pokaż też ukończone' } }),
    run: view('todos', a => ({ list: a.list, ukonczone: a.ukonczone ? '1' : undefined })),
  },
  panel_bank: {
    description: 'Konto PKO BP tylko do odczytu: saldo, operacje z zakresu (domyślnie 30 dni, najwyżej 400) z oznaczeniami użytkownika. Numery rachunków i telefonów są zamaskowane.',
    input: z.object({
      from: date.optional(), to: date.optional(),
      ruch: z.enum(['wydatek', 'przychód', 'rozliczenie', 'przełożenie']).optional(),
      kategoria: text(100).optional(), etykieta: text(100).optional(), strona: text(100).optional(), nieprzypisane: flag,
    }).strict(),
    schema: schema({
      ...range,
      ruch: { type: 'string', enum: ['wydatek', 'przychód', 'rozliczenie', 'przełożenie'] },
      kategoria: { type: 'string', description: 'Fragment nazwy kategorii albo źródła' },
      etykieta: { type: 'string' }, strona: { type: 'string', description: 'Fragment nazwy drugiej strony' },
      nieprzypisane: { type: 'boolean', description: 'Tylko operacje do przypisania' },
    }),
    run: view('bank', a => ({ from: a.from, to: a.to, ruch: a.ruch, kategoria: a.kategoria, etykieta: a.etykieta, strona: a.strona, nieprzypisane: a.nieprzypisane ? '1' : undefined })),
  },
  panel_time: {
    description: 'Bieżąca data i godzina użytkownika (Europe/Warsaw).',
    input: z.object({}).strict(), schema: schema(),
    async run(_args, { now }) {
      const format = new Intl.DateTimeFormat('pl-PL', { timeZone: DEFAULT_ZONE, dateStyle: 'full', timeStyle: 'short' });
      return `Teraz: ${format.format(now)} (${DEFAULT_ZONE}).`;
    },
  },
  panel_todo_action: {
    description: 'Zmiana list zadań użytkownika: createList, addTask (zawsze z "by":"agent"), updateTask, moveTask, renameList, deleteTask, clearDone, deleteList. Usuwaj tylko na wyraźną prośbę.',
    input: z.object({ action: z.record(z.string(), z.unknown()) }).strict(),
    schema: schema({ action: { type: 'object', description: 'Np. {"action":"addTask","list":"l-…","title":"…","by":"agent"}' } }, ['action']),
    async run(args, { sources }) {
      const parsed = todoActionSchema.safeParse(args.action);
      if (!parsed.success) throw new AgentViewError(400, 'Niepoprawna akcja: sprawdź nazwę akcji i pola; lista i zadanie to identyfikatory w postaci l-… i t-….');
      return JSON.stringify(await sources.todoAction(parsed.data));
    },
  },
  // ── Cards of the chat cockpit: what these tools get is shown to the user as a card, by the tool's name. ──
  panel_recon_report: {
    description: cockpitToolDescription('panel_recon_report'),
    input: z.object({
      files: z.array(z.object({ path: text(300), note: z.string().max(200).optional() }).strict()).max(30),
      kind: z.enum(['UI', 'non-UI']),
      scenario: text(80).optional(),
      prompt: text(32_000),
    }).strict(),
    schema: schema({
      files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string', description: 'Ścieżka względem repo, np. src/App.tsx' }, note: { type: 'string', description: 'Po co ten plik' } }, required: ['path'], additionalProperties: false } },
      kind: { type: 'string', enum: ['UI', 'non-UI'] },
      scenario: { type: 'string', description: 'Scenariusz zrzutów, np. standard (dla UI)' },
      prompt: { type: 'string', description: 'Pełny Executor Prompt po angielsku' },
    }, ['files', 'kind', 'prompt']),
    async run() { return 'Karta rekonesansu jest u użytkownika. Teraz wywołaj panel_cezar_propose z tytułem i tym samym promptem.'; },
  },
  panel_cezar_propose: {
    description: cockpitToolDescription('panel_cezar_propose'),
    input: z.object({
      title: text(120),
      prompt: text(32_000),
      workflow: z.enum(CEZAR_WORKFLOWS).optional(),
      todoId: z.string().regex(/^t-[0-9a-f]{8}$/).optional(),
    }).strict(),
    schema: schema({
      title: { type: 'string', description: 'Krótki tytuł taska po polsku' },
      prompt: { type: 'string', description: 'Pełny Executor Prompt (ten sam co w panel_recon_report)' },
      workflow: { type: 'string', enum: [...CEZAR_WORKFLOWS], description: 'Workflow na Cezarze: "analysis" (analiza) lub "desk-panel-task" (implementacja, domyślnie)' },
      todoId: { type: 'string', description: 'Id zadania z list (t-…), gdy task je realizuje' },
    }, ['title', 'prompt']),
    async run() { return 'Karta „Zlecić na Cezarze?” jest u użytkownika: decyzja należy do niego, a zleca panel. Nie wysyłaj niczego do Cezara. Zakończ odpowiedź jednym zdaniem.'; },
  },
  panel_cezar_watch: {
    description: cockpitToolDescription('panel_cezar_watch'),
    input: z.object({ id: cezarRunId }).strict(),
    schema: schema({ id: { type: 'string', description: 'Id taska projekt/uuid (z panel_cezar)' } }, ['id']),
    async run(args, { sources, cezarUrl }) {
      const raw = sources.cezarRun ? await sources.cezarRun(args.id) : null;
      if (!raw) throw new AgentViewError(404, `Cezar nie zna taska ${args.id}.`);
      const task = cezarTaskView(args.id, raw, cezarUrl);
      return JSON.stringify({ task: { id: task.id, title: task.title, status: task.status, progress: Math.round(task.progress * 100) / 100, tokens: task.tokens, steps: task.steps, pr: task.prUrl ?? null, url: task.url } });
    },
  },
  panel_cockpit_clear: {
    description: cockpitToolDescription('panel_cockpit_clear'),
    input: z.object({}).strict(), schema: schema(),
    // What it does follows from the call itself: the cockpit reads the conversation (src/cockpit-contract.ts).
    async run() { return 'Kokpit tej rozmowy nie obserwuje już taska.'; },
  },
  panel_cezar_action: {
    description: 'Na prośbę użytkownika: archive, unarchive, read albo unread jednego zakończonego zadania Cezara (id projekt/uuid z panel_cezar).',
    input: z.object({ id: text(200), action: z.enum(['archive', 'unarchive', 'read', 'unread']) }).strict(),
    schema: schema({ id: { type: 'string' }, action: { type: 'string', enum: ['archive', 'unarchive', 'read', 'unread'] } }, ['id', 'action']),
    async run(args, { sources }) {
      const parsed = cezarActionSchema.safeParse(args);
      if (!parsed.success) throw new AgentViewError(400, 'Niepoprawne id albo akcja.');
      await sources.cezarAction(parsed.data.id, parsed.data.action);
      return '{"ok":true}';
    },
  },
};

/** The token Hermes sends: `DESK_MCP_TOKEN`, or a random one kept in `<dir>/mcp-token` (outside Git), made on first start. */
export function mcpToken(env: NodeJS.ProcessEnv = process.env, dir = path.join(homedir(), '.desk-panel')): string {
  const fromEnv = env.DESK_MCP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dir, 'mcp-token');
  if (existsSync(file)) { const saved = readFileSync(file, 'utf8').trim(); if (saved.length >= 32) return saved; }
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown };
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function answerRpc(message: Rpc, ctx: { views: Record<string, AgentView>; sources: PanelSources; now: () => number; cezarUrl?: string }): Promise<unknown | null> {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Invalid Request');
  const notification = message.id === undefined;
  if (notification) return null;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, any>;
  switch (message.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      return { jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: (MCP_PROTOCOLS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'desk-panel', version: '1.0.0' },
        instructions: 'Dane Desk Panelu użytkownika: krótki tekst po polsku z czasem lokalnym. Tylko odczyt, poza panel_todo_action i panel_cezar_action. Narzędzia kokpitu (panel_recon_report, panel_cezar_propose, panel_cezar_watch, panel_cockpit_clear) mówią w opisie, kiedy ich używać i co się po nich dzieje.',
      } };
    }
    case 'ping': return { jsonrpc: '2.0', id: message.id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: message.id, result: { tools: Object.entries(PANEL_TOOLS).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.schema })) } };
    case 'tools/call': {
      const name = String(params.name ?? '');
      const tool = Object.hasOwn(PANEL_TOOLS, name) ? PANEL_TOOLS[name] : undefined;
      if (!tool) return rpcError(message.id, -32602, `Unknown tool: ${name.slice(0, 60)}`);
      const args = tool.input.safeParse(params.arguments ?? {});
      if (!args.success) return { jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: `Niepoprawne argumenty: ${args.error.issues.map(i => `${i.path.join('.') || 'argumenty'}: ${i.message}`).join(', ')}` }] } };
      try {
        const out = await tool.run(args.data, { views: ctx.views, sources: ctx.sources, now: ctx.now(), cezarUrl: ctx.cezarUrl ?? 'http://127.0.0.1:4321/' });
        return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: out }] } };
      } catch (error) {
        const reason = error instanceof AgentViewError || error instanceof TodoError ? error.message
          : error instanceof SourceError ? `Nie udało się pobrać danych źródła (${error.status}).` : 'Nie udało się wykonać narzędzia.';
        return { jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: reason }] } };
      }
    }
    default: return rpcError(message.id, -32601, 'Method not found');
  }
}

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** `/api/mcp`. `loopback` is false for a request that came through the Tailscale name: refused. */
export async function handleMcpRoute(req: IncomingMessage, res: ServerResponse, ctx: { views: Record<string, AgentView>; sources: PanelSources; token?: string; loopback: boolean; now?: () => number; cezarUrl?: string }): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (!ctx.loopback || req.headers.origin) { res.writeHead(403).end(); return; }
  if (!ctx.token) { res.writeHead(503).end(); return; }
  const auth = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
  if (!sameToken(auth, ctx.token)) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) { res.writeHead(413).end(); return; } }
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(rpcError(null, -32700, 'Parse error'))); return; }
  const run = { views: ctx.views, sources: ctx.sources, now: ctx.now ?? Date.now, cezarUrl: ctx.cezarUrl };
  const batch = Array.isArray(parsed);
  const answers = (await Promise.all((batch ? parsed as Rpc[] : [parsed as Rpc]).map(m => answerRpc(m, run)))).filter(a => a !== null);
  if (!answers.length) { res.writeHead(202).end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(batch ? answers : answers[0]));
}
