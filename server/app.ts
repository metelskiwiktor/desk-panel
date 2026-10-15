import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { jsonRoutes, SourceError, type PanelSources } from './sources';

const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Loopback-only panel API (and built frontend from `root`) over any PanelSources. */
export function createPanelServer(sources: PanelSources, root: string) {
  const routes = jsonRoutes(sources);
  return createServer(async (req, res) => {
    const host = req.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) { res.writeHead(403).end(); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url || '/', `http://${host}`);
    if (req.method === 'POST' && url.pathname === '/api/calendar/connect') {
      if (req.headers.origin !== `http://${host}`) { res.writeHead(403).end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try { res.end(JSON.stringify({ authorizationUrl: await sources.calendarConnect() })); }
      catch { res.writeHead(409).end(JSON.stringify({ error: 'Dodaj plik klienta OAuth Google.' })); }
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const route = routes[url.pathname];
    if (route) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      try { res.end(JSON.stringify(await route())); }
      catch (error) { res.writeHead(error instanceof SourceError ? error.status : 502).end(JSON.stringify({ error: 'Nie udało się pobrać danych źródła.' })); }
      return;
    }
    if (url.pathname === '/api/calendar/callback') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const { ok, message } = await sources.calendarCallback(url.searchParams);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(ok ? 200 : 400).end(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Desk Panel · Google</title><body style="background:#10151f;color:#eee;font:20px system-ui;padding:40px"><h1>Google Calendar</h1><p>${message}</p><a style="color:#8bf" href="/">Wróć do panelu</a></body></html>`);
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
