import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentChat } from './agent-chat';
import { createPanelServer } from './app';
import { createChatHub } from './chat-hub';
import { createCockpit } from './cockpit';
import { createHermesClient, hermesUrl } from './hermes-api';
import { createHermesChat } from './hermes-chat';
import { mcpToken } from './panel-mcp';
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
// Both chat engines: Hermes (default for new chats, its own long-running API on loopback) and agy (one process per chat).
// The Hermes key stays here: it is never sent to the browser or written to a log.
const hermes = createHermesChat({
  client: createHermesClient({ url: hermesUrl(process.env.DESK_HERMES_URL), key: process.env.DESK_HERMES_KEY?.trim() || undefined }),
  turnTimeoutMs: Number(process.env.DESK_HERMES_TURN_TIMEOUT_MS) || undefined,
});
const chat = createChatHub({ engines: { hermes, agy: createAgentChat({ panelUrl: `http://127.0.0.1:${port}` }) } });
// The chat cockpit: the Cezar task a conversation watches, its PR and subtasks; the dispatches it made (ids only).
const cockpit = createCockpit({ sources, file: join(homedir(), '.desk-panel', 'cockpit.json'), cezarUrl: cezar.href });
const server = createPanelServer(sources, root, allowedHost, chat, { mcpToken: mcpToken(), cockpit, cezarUrl: cezar.href }).listen(port, '127.0.0.1', () => console.log(`Desk Panel: http://127.0.0.1:${port}`));
// The service stops with its agents: no `agy` is left running behind it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { chat.close(); server.close(); process.exit(0); });
