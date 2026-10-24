import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPanelServer } from './app';
import { createRealSources } from './real-sources';

const port = Number(process.env.DESK_PORT || 5174);
const cezar = new URL(process.env.DESK_CEZAR_URL || 'http://127.0.0.1:4321');
if (cezar.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(cezar.hostname) || cezar.username || cezar.password) {
  throw new Error('DESK_CEZAR_URL must be a local HTTP address without credentials');
}
const allowedHost = process.env.DESK_ALLOWED_HOST?.trim().toLowerCase() || undefined;
if (allowedHost && !/^[a-z0-9.-]+\.ts\.net$/.test(allowedHost)) throw new Error('DESK_ALLOWED_HOST must be a Tailscale name ending in .ts.net');
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const calendarId = process.env.DESK_CALENDAR_ID || 'metelski.wiktor@gmail.com';
// Gmail accounts shown in the mail list; the calendar account by default.
const mailAccounts = (process.env.DESK_MAIL_ACCOUNTS || calendarId).split(',').map(e => e.trim()).filter(Boolean);
const sources = createRealSources({ port, cezarUrl: cezar.href, calendarId, mailAccounts, env: process.env });
createPanelServer(sources, root, allowedHost).listen(port, '127.0.0.1', () => console.log(`Desk Panel: http://127.0.0.1:${port}`));
