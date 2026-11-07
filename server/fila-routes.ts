import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { FILA_CLIENTS, type FilaActor } from '../src/fila-contract';
import { FilaError, type FilaStore } from './fila';

/** One token per client of D-057, in `<dir>/fila-tokens.json` (outside Git, made on first start, never logged or sent to a browser). */
export type FilaTokens = Partial<Record<(typeof FILA_CLIENTS)[number], string>>;
export function filaTokens(dir = path.join(homedir(), '.desk-panel')): FilaTokens {
  const file = path.join(dir, 'fila-tokens.json');
  let saved: Record<string, unknown> = {};
  try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')); } catch { saved = {}; }
  const tokens: FilaTokens = {};
  let changed = false;
  for (const client of FILA_CLIENTS) {
    const token = saved[client];
    if (typeof token === 'string' && token.length >= 32) tokens[client] = token;
    else { tokens[client] = randomBytes(32).toString('hex'); changed = true; }
  }
  if (changed) { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 }); }
  return tokens;
}

const same = (given: string, expected: string) => {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const clientOf = (given: string, tokens: FilaTokens) => FILA_CLIENTS.find(client => { const token = tokens[client]; return !!token && same(given, token); });

const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
const MAX_BODY = 512 * 1024;

/**
 * `/api/fila…`. Reads are open like the other panel views. A write is the user's when it comes from the panel's own page
 * (Origin) with no token, and a client's when it carries that client's token; a token never gives the user's role, with or
 * without an Origin, and an invalid token is refused even on a read. Tokens are not accepted through the Tailscale name.
 */
export async function handleFilaRoute(req: IncomingMessage, res: ServerResponse, url: URL, ctx: { ownOrigin: string; proxied: boolean; fila?: FilaStore; tokens?: FilaTokens }): Promise<boolean> {
  if (url.pathname !== '/api/fila' && !url.pathname.startsWith('/api/fila/')) return false;
  res.setHeader('Cache-Control', 'no-store');
  const header = req.headers.authorization;
  let client: FilaActor | undefined;
  if (header !== undefined) {
    const given = /^Bearer (.+)$/.exec(String(header))?.[1] ?? '';
    if (ctx.proxied) { res.writeHead(403).end(); return true; }
    client = clientOf(given, ctx.tokens ?? {});
    if (!client) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(); return true; }
  }
  if (!ctx.fila) { json(res, 503, { error: 'Fila jest niedostępna.' }); return true; }
  try {
    if (req.method === 'GET' && url.pathname === '/api/fila') { json(res, 200, { ...await ctx.fila.registries(), notice: await ctx.fila.notice() }); return true; }
    const thread = /^\/api\/fila\/threads\/([A-Za-z]{4}-[1-9][0-9]*)$/.exec(url.pathname);
    if (req.method === 'GET' && thread) { json(res, 200, await ctx.fila.thread(thread[1]!)); return true; }
    const spec = /^\/api\/fila\/threads\/([A-Za-z]{4}-[1-9][0-9]*)\/spec(?:\/([^/]+))?$/.exec(url.pathname);
    if (req.method === 'GET' && spec) {
      const number = spec[2] === undefined ? undefined : /^\d+$/.test(spec[2]) ? Number(spec[2]) : Number.NaN;
      json(res, 200, await ctx.fila.spec(spec[1]!, number));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/fila/query') {
      const number = (name: string) => { const raw = url.searchParams.get(name); return raw === null ? undefined : Number(raw); };
      json(res, 200, await ctx.fila.query(url.searchParams.get('q') ?? '', { limit: number('limit'), offset: number('offset') }));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/fila/query/check') {
      const checked = await ctx.fila.check(url.searchParams.get('q') ?? '', url.searchParams.get('kind') === 'column' ? 'column' : 'section');
      json(res, 200, { ok: true, ...checked });
      return true;
    }
    const board = /^\/api\/fila\/boards\/(b-[0-9a-f]{8})(?:\/views\/(v-[0-9a-f]{8}))?$/.exec(url.pathname);
    if (req.method === 'GET' && board) {
      const limit = url.searchParams.get('limit');
      json(res, 200, board[2] ? await ctx.fila.boardView(board[1]!, board[2], limit === null ? undefined : Number(limit)) : await ctx.fila.board(board[1]!));
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/fila/action') {
      // The caller decides the author, never the body: a token means that client, the panel's own Origin means the user.
      const actor = client ?? (req.headers.origin === ctx.ownOrigin ? 'user' : undefined);
      if (!actor) { res.writeHead(403).end(); return true; }
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body, 'utf8') > MAX_BODY) throw new FilaError(413, 'Akcja jest za duża.'); }
      let value: unknown;
      try { value = JSON.parse(body || 'null'); } catch { throw new FilaError(400, 'Niepoprawny JSON.'); }
      json(res, 200, await ctx.fila.apply(value as never, actor));
      return true;
    }
    res.writeHead(req.method === 'GET' || req.method === 'POST' ? 404 : 405).end();
  } catch (error) {
    const status = error instanceof FilaError ? error.status : 500;
    json(res, status, { error: error instanceof FilaError ? error.message : 'Nie udało się wykonać operacji Fili.' });
  }
  return true;
}
