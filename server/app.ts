import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { cezarActionSchema } from '../src/cezar-contract';
import { mailActionSchema } from '../src/mail-contract';
import { warmupEditFor, warmupProviderSchema, warmupRunInputSchema } from '../src/warmup-contract';
import { jsonRoutes, SourceError, type PanelSources } from './sources';
import type { ChatService } from './agent-chat';
import { handleChatRoute } from './chat-routes';

/** Small JSON request bodies only (actions), validated by the caller's schema. */
async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new SourceError(413); }
  const parsed = schema.safeParse(JSON.parse(body || 'null'));
  if (!parsed.success) throw new SourceError(400);
  return parsed.data;
}
const connectSchema = z.object({ email: z.string() }).strict();
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Loopback-only panel API (and built frontend from `root`) over any PanelSources. */
export function createPanelServer(sources: PanelSources, root: string, allowedHost?: string, chat?: ChatService) {
  const routes = jsonRoutes(sources);
  return createServer(async (req, res) => {
    const host = req.headers.host;
    // `allowedHost` is the one extra name (Tailscale Serve, HTTPS) that reaches this loopback listener through a local proxy.
    const proxied = !!allowedHost && host === allowedHost;
    if (!host || !(proxied || /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))) { res.writeHead(403).end(); return; }
    const ownOrigin = `${proxied ? 'https' : 'http'}://${host}`;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url || '/', `http://${host}`);
    if (url.pathname.startsWith('/api/chats') && await handleChatRoute(req, res, url, ownOrigin, chat)) return;
    if(req.method==='POST' && url.pathname.startsWith('/api/quotas/warmup/')) {
      if(req.headers.origin!==ownOrigin){res.writeHead(403).end();return;}
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
      try{
        const action=url.pathname.slice('/api/quotas/warmup/'.length).split('/');
        const manual=action.length===2 && action[1]==='run';
        const provider=warmupProviderSchema.safeParse(action.length===1 || manual ? action[0] : undefined);
        if(!provider.success)throw new SourceError(400);
        if(manual){
          await readJson(req,warmupRunInputSchema);
          if(!sources.runWarmup)throw new SourceError(503);
          res.end(JSON.stringify(await sources.runWarmup(provider.data)));return;
        }
        const input=await readJson(req,warmupEditFor(provider.data));
        if(!sources.saveWarmup)throw new SourceError(503);
        res.end(JSON.stringify(await sources.saveWarmup(provider.data,input)));
      }catch(error){res.writeHead(error instanceof SourceError ? error.status : error instanceof SyntaxError ? 400 : 502).end(JSON.stringify({error:'Nie udało się wykonać operacji warmupu.'}));}
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/google/connect' || url.pathname === '/api/mail/action' || url.pathname === '/api/cezar/action')) {
      // Actions change state (or Gmail), so only the panel's own page may call them.
      if (req.headers.origin !== ownOrigin) { res.writeHead(403).end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try {
        if (url.pathname === '/api/google/connect') {
          const { email } = await readJson(req, connectSchema);
          res.end(JSON.stringify({ authorizationUrl: await sources.googleConnect(email) }));
        } else if (url.pathname === '/api/cezar/action') {
          const { id, action } = await readJson(req, cezarActionSchema);
          await sources.cezarAction(id, action);
          res.end(JSON.stringify({ ok: true }));
        } else {
          const { account, threadId, action } = await readJson(req, mailActionSchema);
          await sources.mailAction(account, threadId, action);
          res.end(JSON.stringify({ ok: true }));
        }
      } catch (error) {
        const status = error instanceof SourceError ? error.status : error instanceof SyntaxError ? 400 : url.pathname === '/api/google/connect' ? 409 : 502;
        res.writeHead(status).end(JSON.stringify({ error: status === 409 ? 'Dodaj plik klienta OAuth Google.' : 'Nie udało się wykonać akcji.' }));
      }
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const route = routes[url.pathname];
    if (route) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try { res.end(JSON.stringify(await route(url))); }
      catch (error) { res.writeHead(error instanceof SourceError ? error.status : 502).end(JSON.stringify({ error: 'Nie udało się pobrać danych źródła.' })); }
      return;
    }
    if (url.pathname === '/api/calendar/callback') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const { ok, message } = await sources.googleCallback(url.searchParams);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(ok ? 200 : 400).end(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Desk Panel · Google</title><body style="background:#10151f;color:#eee;font:20px system-ui;padding:40px"><h1>Konto Google</h1><p>${message}</p><a style="color:#8bf" href="/">Wróć do panelu</a></body></html>`);
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404).end(); return; }
    try {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + sep) && path !== resolve(root, 'index.html')) { res.writeHead(403).end(); return; }
      const file = await readFile(path);
      res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
      res.end(file);
    } catch { res.writeHead(404).end(); }
  });
}
