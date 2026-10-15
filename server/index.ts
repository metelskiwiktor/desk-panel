import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCezar } from './cezar';
import { createCalendarReader } from './calendar';
import { createCalendarOAuth, CalendarAuthError } from './calendar-oauth';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSystemReader } from './system';
import { createQuotaReader } from './quotas';

const port = Number(process.env.DESK_PORT || 5174);
const cezar = new URL(process.env.DESK_CEZAR_URL || 'http://127.0.0.1:4321');
if (cezar.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(cezar.hostname) || cezar.username || cezar.password) {
  throw new Error('DESK_CEZAR_URL must be a local HTTP address without credentials');
}
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const calendarId = process.env.DESK_CALENDAR_ID || 'metelski.wiktor@gmail.com';
const oauth = createCalendarOAuth({ email: calendarId,
  clientFile: process.env.DESK_GOOGLE_OAUTH_CLIENT_FILE || join(homedir(), '.desk-panel', 'google-oauth-client.json'),
  tokenFile: join(homedir(), '.desk-panel', 'calendar-token.dpapi'),
  redirectUri: `http://127.0.0.1:${port}/api/calendar/callback`,
});
const readCalendar = createCalendarReader(calendarId, oauth.request);
const readSystem = createSystemReader();
const readQuotas = createQuotaReader(process.env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
let pending: ReturnType<typeof readCezar> | undefined;
let cache: Awaited<ReturnType<typeof readCezar>> | undefined;
let fetchedAt = 0;
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer(async (req, res) => {
  const host = req.headers.host;
  if (!host || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) { res.writeHead(403).end(); return; }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url || '/', `http://${host}`);
  if (req.method === 'POST' && url.pathname === '/api/calendar/connect') {
    if (req.headers.origin !== `http://${host}`) { res.writeHead(403).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    try { res.end(JSON.stringify({ authorizationUrl: await oauth.begin() })); }
    catch { res.writeHead(409).end(JSON.stringify({ error: 'Dodaj plik klienta OAuth Google.' })); }
    return;
  }
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (url.pathname === '/api/quotas') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(await readQuotas()));
    return;
  }
  if (url.pathname === '/api/system') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(readSystem()));
    return;
  }
  if (url.pathname === '/api/calendar/callback') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let message = 'Nie udało się połączyć. Wróć do panelu i rozpocznij logowanie ponownie.';
    let success = false;
    try { await oauth.finish(url.searchParams); success = true; message = 'Kalendarz połączony. Możesz wrócić do Desk Panelu.'; }
    catch (error) {
      if (error instanceof CalendarAuthError && error.reason === 'wrong_account') message = `Wybrano inne konto. Zaloguj się na ${calendarId.replace(/[<>&"']/g, '')}.`;
      if (error instanceof CalendarAuthError && error.reason === 'storage_failed') message = 'Nie udało się bezpiecznie zapisać połączenia na tym komputerze.';
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(success ? 200 : 400).end(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Desk Panel · Google</title><body style="background:#10151f;color:#eee;font:20px system-ui;padding:40px"><h1>Google Calendar</h1><p>${message}</p><a style="color:#8bf" href="/">Wróć do panelu</a></body></html>`);
    return;
  }
  if (url.pathname === '/api/calendar/connection') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(await oauth.status()));
    return;
  }
  if (url.pathname === '/api/calendar') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(await readCalendar()));
    return;
  }
  if (url.pathname === '/api/cezar') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    try {
      if (!cache || Date.now() - fetchedAt >= 4000) {
        pending ??= readCezar(cezar.href).then(value => { cache = value; fetchedAt = Date.now(); return value; }).finally(() => { pending = undefined; });
        await pending;
      }
      res.end(JSON.stringify(cache));
    } catch { res.writeHead(502).end(JSON.stringify({ error: 'Nie udało się pobrać danych Cezara.' })); }
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
}).listen(port, '127.0.0.1', () => console.log(`Desk Panel: http://127.0.0.1:${port}`));
