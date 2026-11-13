import { createAgyNamer } from './chat-title';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAgentChat } from './agent-chat';
import { createPanelServer } from './app';
import { automationsEnabled, createChatAutomation } from './chat-automation';
import { createChatHub } from './chat-hub';
import { createCockpit } from './cockpit';
import { createPrReader } from './github';
import { createHermesClient, hermesUrl } from './hermes-api';
import { createHermesChat } from './hermes-chat';
import { createAutomationExecutor } from './automation-actions';
import { createAutomations, type Automations } from './automations';
import { createMachina, type Machina } from './machina';
import { mcpToken } from './panel-mcp';
import { filaTokens } from './fila-routes';
import { createUsageStore } from './usage';
import { createRealSources } from './real-sources';
import { readCutoverKiosk, readCutoverMode } from './fila-cutover-gate';
import { resolveFilaContext } from './fila-context';
import { inspectLockedAutomations, inspectLockedChats } from './fila-cutover-inspect';

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
const panelDir = join(homedir(), '.desk-panel');
const cutoverMode = readCutoverMode(panelDir);
const cutoverLocked = cutoverMode === 'locked';
const cutoverKiosk = cutoverLocked ? readCutoverKiosk(panelDir) : undefined;
let cockpit: ReturnType<typeof createCockpit> | undefined;
let automation: ReturnType<typeof createChatAutomation> | undefined;
let automations: Automations | undefined;
let machina: Machina | undefined;
const sources = createRealSources({ port, cezarUrl: cezar.href, calendarId, mailAccounts, env: process.env, cutoverLocked, filaActive: cutoverMode !== 'legacy',
  // The same reads that feed the dashboard also feed the automations: an active task waiting for the user, a finished one.
  onActive: tasks => { if (!cutoverLocked) { automation?.active(tasks); void automations?.active(tasks); } },
  // The PR of a finished task dispatched from a to-do is linked there from the kept dispatch; no chat has to be open.
  onFinished: (tasks, complete) => { if (!cutoverLocked) { void cockpit?.linkPrs(tasks); void cockpit?.blockersFromFinished(tasks, complete); automation?.finished(tasks); void automations?.finished(tasks); } },
  // The Automaty view reads the active automations; its buttons are the only other way one changes.
  automations: async () => ({ automations: await automations?.list() ?? [], ...(automations?.error() ? { error: automations.error() } : {}), ...(machina ? { machina: await machina.effects() } : {}) }),
  machinaAction: async input => { if (!machina) throw new Error('Machina nie jest dostępna.'); return machina.action(input); },
  automationAction: async input => { if (!automations) throw new Error('Automaty nie są dostępne.'); return automations.update(input); } });
// Both chat engines: Hermes (default for new chats, its own long-running API on loopback) and agy (one process per chat).
// The Hermes key stays here: it is never sent to the browser or written to a log.
// Wektor on Fila instead of the to-do lists (1.3a, off until the switch in 1.6; the server and the preamble agree through this one flag).
const wektorFila = cutoverMode !== 'legacy' || ['1', 'true'].includes(process.env.DESK_WEKTOR_FILA?.trim().toLowerCase() ?? '');
// Do not even construct chat engines while locked: hydration can resume an unfinished turn.
const chat = cutoverLocked ? undefined : (() => {
  const namer = createAgyNamer();
  const hermes = createHermesChat({
    fila: wektorFila,
    resolveContext: cutoverMode === 'active' && sources.fila ? context => resolveFilaContext(context, sources.fila!) : undefined,
    namer,
    onAutomationTurn: turn => { automations?.turnChanged(turn); machina?.turnChanged(turn); },
    client: createHermesClient({ url: hermesUrl(process.env.DESK_HERMES_URL), key: process.env.DESK_HERMES_KEY?.trim() || undefined }),
    turnTimeoutMs: Number(process.env.DESK_HERMES_TURN_TIMEOUT_MS) || undefined,
    silenceMs: Number(process.env.DESK_HERMES_SILENCE_MS) || undefined,
  });
  return createChatHub({ engines: { hermes, agy: createAgentChat({ namer, panelUrl: `http://127.0.0.1:${port}`, fila: cutoverMode === 'active',
    resolveContext: cutoverMode === 'active' && sources.fila ? context => resolveFilaContext(context, sources.fila!) : undefined }) } });
})();
// The chat cockpit: the Cezar task a conversation watches, its PR and subtasks; the dispatches it made (ids only).
// One cached PR reader is injected into the cockpit and the observers: GitHub is asked gently, never once per reader.
const prReader = createPrReader();
cockpit = createCockpit({ sources, file: join(homedir(), '.desk-panel', 'cockpit.json'), cezarUrl: cezar.href, reader: prReader, filaActive: cutoverMode !== 'legacy' });
// The first automation: a task dispatched from a chat reports its waiting/finished state back to that chat, once.
// `DESK_AUTOMATIONS=0` turns every automation off; the scenario mode does not create this observer at all.
if (chat && automationsEnabled(process.env)) automation = createChatAutomation({ chat, cockpit, sources });
// Wektor's automations: cyclic and one-shot; the old observers.json is migrated on first load. They are kept (and listed)
// even with automations off; only creating and firing stop then.
if (chat) automations = createAutomations({
  file: join(panelDir, 'automations.json'), observersFile: join(panelDir, 'observers.json'), chat,
  readTask: id => sources.cezarRun ? sources.cezarRun(id) : Promise.resolve(null),
  readPr: url => prReader.read(url),
  executeAction: createAutomationExecutor({ writeCalendar: sources.automationCalendarWrite, ntfyUrl: process.env.DESK_NTFY_URL }),
  enabled: automationsEnabled(process.env),
  blockedBy: () => machina?.running() ?? false,
});
automations?.start();
// Machina (docs/automaty.md): programs the panel runs itself, kept in the automat threads of Fila. It needs the active,
// unlocked Fila and shares the one run slot and the action executor with the automations above.
if (chat && sources.fila && cutoverMode === 'active') machina = createMachina({
  fila: sources.fila, chat, enabled: automationsEnabled(process.env), busy: () => automations?.busy() ?? false,
  executeAction: createAutomationExecutor({ writeCalendar: sources.automationCalendarWrite, ntfyUrl: process.env.DESK_NTFY_URL }),
});
machina?.start();
// Usage measurement (docs/uzycie.md): only the service writes this history; scenarios and previews never get a store.
const usage = cutoverLocked ? undefined : createUsageStore(join(panelDir, 'usage'));
if (usage) {
  void usage.prune().catch(() => undefined);
  setInterval(() => void usage.prune().catch(() => undefined), 6 * 3_600_000).unref();
}
const lockedMcpToken = () => {
  const configured = process.env.DESK_MCP_TOKEN?.trim();
  if (configured) return configured;
  try { const token = readFileSync(join(panelDir, 'mcp-token'), 'utf8').trim(); return token.length >= 32 ? token : undefined; } catch { return undefined; }
};
const server = createPanelServer(sources, root, allowedHost, chat, { mcpToken: cutoverLocked ? lockedMcpToken() : mcpToken(), filaTokens: cutoverLocked ? undefined : filaTokens(), cockpit, cezarUrl: cezar.href, automations, usage, wektorFila, cutoverLocked, filaMode: cutoverMode !== 'legacy', cutoverKiosk,
  inspectLockedChats: cutoverLocked ? () => inspectLockedChats(panelDir) : undefined,
  inspectLockedAutomations: cutoverLocked ? () => inspectLockedAutomations(panelDir) : undefined }).listen(port, '127.0.0.1', () => console.log(`Desk Panel: http://127.0.0.1:${port}`));
// The service stops with its agents: no `agy` is left running behind it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { chat?.close(); server.close(); process.exit(0); });
