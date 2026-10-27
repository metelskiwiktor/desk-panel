import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { cezarActionSchema } from '../src/cezar-contract';
import { todoActionSchema } from '../src/todo-contract';
import { AgentViewError, DEFAULT_ZONE, type AgentView } from './agent-views';
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
  run(args: Record<string, any>, ctx: { views: Record<string, AgentView>; sources: PanelSources; now: number }): Promise<string>;
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
    description: 'Zadania Cezara (aktywne i zakończone, niezarchiwizowane); zakończone mają id projekt/uuid do panel_cezar_action.',
    input: z.object({}).strict(), schema: schema(), run: view('cezar', () => ({})),
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

export async function answerRpc(message: Rpc, ctx: { views: Record<string, AgentView>; sources: PanelSources; now: () => number }): Promise<unknown | null> {
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
        instructions: 'Dane Desk Panelu użytkownika: krótki tekst po polsku z czasem lokalnym. Tylko odczyt, poza panel_todo_action i panel_cezar_action.',
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
        const out = await tool.run(args.data, { views: ctx.views, sources: ctx.sources, now: ctx.now() });
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
export async function handleMcpRoute(req: IncomingMessage, res: ServerResponse, ctx: { views: Record<string, AgentView>; sources: PanelSources; token?: string; loopback: boolean; now?: () => number }): Promise<void> {
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
  const run = { views: ctx.views, sources: ctx.sources, now: ctx.now ?? Date.now };
  const batch = Array.isArray(parsed);
  const answers = (await Promise.all((batch ? parsed as Rpc[] : [parsed as Rpc]).map(m => answerRpc(m, run)))).filter(a => a !== null);
  if (!answers.length) { res.writeHead(202).end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(batch ? answers : answers[0]));
}
