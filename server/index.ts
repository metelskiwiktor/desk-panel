import { createAgyNamer } from './chat-title';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentChat } from './agent-chat';
import { createPanelServer } from './app';
import { automationsEnabled, createChatAutomation } from './chat-automation';
import { createChatHub } from './chat-hub';
import { createCockpit } from './cockpit';
import { createPrReader } from './github';
import { createHermesClient, hermesUrl } from './hermes-api';
import { createHermesChat } from './hermes-chat';
import { createObservers, type Observers } from './observers';
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
let cockpit: ReturnType<typeof createCockpit> | undefined;
let automation: ReturnType<typeof createChatAutomation> | undefined;
let observers: Observers | undefined;
const sources = createRealSources({ port, cezarUrl: cezar.href, calendarId, mailAccounts, env: process.env,
  // The same reads that feed the dashboard also feed the automations: an active task waiting for the user, a finished one.
  onActive: tasks => { automation?.active(tasks); void observers?.active(tasks); },
  // The PR of a finished task dispatched from a to-do is linked there from the kept dispatch; no chat has to be open.
  onFinished: tasks => { cockpit?.linkPrs(tasks); automation?.finished(tasks); void observers?.finished(tasks); },
  // The settings card reads the active observers; its cancel button is the only other way one goes away.
  observers: async () => ({ observers: await observers?.list() ?? [] }),
  observerCancel: async id => ({ observers: await observers?.cancel(id) ?? [] }) });
// Both chat engines: Hermes (default for new chats, its own long-running API on loopback) and agy (one process per chat).
// The Hermes key stays here: it is never sent to the browser or written to a log.
const namer = createAgyNamer();
const hermes = createHermesChat({
  namer,
  client: createHermesClient({ url: hermesUrl(process.env.DESK_HERMES_URL), key: process.env.DESK_HERMES_KEY?.trim() || undefined }),
  turnTimeoutMs: Number(process.env.DESK_HERMES_TURN_TIMEOUT_MS) || undefined,
  silenceMs: Number(process.env.DESK_HERMES_SILENCE_MS) || undefined,
});
const chat = createChatHub({ engines: { hermes, agy: createAgentChat({ namer, panelUrl: `http://127.0.0.1:${port}` }) } });
// The chat cockpit: the Cezar task a conversation watches, its PR and subtasks; the dispatches it made (ids only).
// One cached PR reader is injected into the cockpit and the observers: GitHub is asked gently, never once per reader.
const prReader = createPrReader();
cockpit = createCockpit({ sources, file: join(homedir(), '.desk-panel', 'cockpit.json'), cezarUrl: cezar.href, reader: prReader });
// The first automation: a task dispatched from a chat reports its waiting/finished state back to that chat, once.
// `DESK_AUTOMATIONS=0` turns every automation off; the scenario mode does not create this observer at all.
if (automationsEnabled(process.env)) automation = createChatAutomation({ chat, cockpit, sources });
// The chat's one-shot observers: created card-free by `panel_observe`, listed and cancelled in the settings. They are
// kept (and listed) even with automations off; only creating and firing stop then.
observers = createObservers({
  file: join(homedir(), '.desk-panel', 'observers.json'), chat,
  readTask: id => sources.cezarRun ? sources.cezarRun(id) : Promise.resolve(null),
  readPr: url => prReader.read(url),
  enabled: automationsEnabled(process.env),
});
observers.start();
const server = createPanelServer(sources, root, allowedHost, chat, { mcpToken: mcpToken(), cockpit, cezarUrl: cezar.href, observers }).listen(port, '127.0.0.1', () => console.log(`Desk Panel: http://127.0.0.1:${port}`));
// The service stops with its agents: no `agy` is left running behind it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { chat.close(); server.close(); process.exit(0); });
