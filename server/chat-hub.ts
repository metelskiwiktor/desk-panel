import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ChatError, type ChatService } from './agent-chat';
import { chatEngines, DEFAULT_ENGINE, type ChatAutomationInput, type ChatEngine, type EngineStatus } from '../src/chat-contract';

/** A chat service of one engine, which can say whether it can take a message now. */
export type EngineService = ChatService & { status?(): Promise<{ available: boolean; error?: string }> };

export interface ChatHubOptions {
  engines: Partial<Record<ChatEngine, EngineService>>;
  /** Where the preferred engine is kept (`<dir>/chat-settings.json`); `~/.desk-panel` by default. */
  dir?: string;
  now?: () => number;
}

/**
 * The chat the API serves: conversations of both engines in one list, each handled by the service of its own engine
 * (Hermes or agy; they never share a session or a message). A new conversation starts on the engine the request names,
 * or on the preferred one (Hermes until the user picks agy); there is no silent fallback: an engine that is down says so.
 */
export function createChatHub(options: ChatHubOptions): ChatService {
  const dir = options.dir ?? path.join(homedir(), '.desk-panel');
  const now = options.now ?? Date.now;
  const settingsFile = path.join(dir, 'chat-settings.json');
  const services = Object.entries(options.engines).filter((e): e is [ChatEngine, EngineService] => !!e[1]);
  const owner = new Map<string, ChatEngine>();
  /** A retried request (same nonce) gets the answer of the first one instead of a second turn. */
  const nonces = new Map<string, { at: number; result: Promise<unknown> }>();
  let preference: ChatEngine | undefined;

  const readPreference = (): ChatEngine => {
    if (preference) return preference;
    try {
      const saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as { engine?: unknown };
      if ((chatEngines as readonly unknown[]).includes(saved.engine)) return preference = saved.engine as ChatEngine;
    } catch { /* no choice yet */ }
    return preference = DEFAULT_ENGINE;
  };
  const serviceOf = (engine: ChatEngine) => {
    const service = options.engines[engine];
    if (!service) throw new ChatError(503, `Silnik ${engine} nie jest włączony na tym serwerze.`);
    return service;
  };
  const find = async (id: string): Promise<EngineService> => {
    const known = owner.get(id);
    if (known) return serviceOf(known);
    for (const [engine, service] of services) {
      try { await service.get(id); owner.set(id, engine); return service; }
      catch (error) { if (!(error instanceof ChatError && error.status === 404)) throw error; }
    }
    throw new ChatError(404);
  };
  const once = <T>(nonce: string | undefined, work: () => Promise<T>): Promise<T> => {
    for (const [key, entry] of nonces) if (now() - entry.at > 10 * 60_000) nonces.delete(key);
    if (!nonce) return work();
    const seen = nonces.get(nonce);
    if (seen) return seen.result as Promise<T>;
    const result = work();
    nonces.set(nonce, { at: now(), result });
    result.catch(() => nonces.delete(nonce)); // a failed attempt may be retried
    return result;
  };

  return {
    async list() {
      const lists = await Promise.all(services.map(async ([engine, service]) => {
        const chats = await service.list();
        for (const chat of chats) owner.set(chat.id, engine);
        return chats;
      }));
      return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) { return (await find(id)).get(id); },
    create(input) {
      return once(input.nonce, async () => {
        // New chats start on Hermes (AGENTS.md); agy only when the request names it. A preference stored before Hermes
        // ({"engine":"agy"}) sent API-created chats to agy and broke an automation run on 31.10.2026.
        const engine = input.engine ?? DEFAULT_ENGINE;
        if (input.temporary && engine !== 'hermes') throw new ChatError(409, 'Rozmowy tymczasowe obsługuje tylko Hermes.');
        if (input.files?.length && engine !== 'hermes') throw new ChatError(400, 'Załączniki obsługuje tylko Hermes.');
        const created = await serviceOf(engine).create(input);
        owner.set(created.id, engine);
        return created;
      });
    },
    async send(id, input) {
      const service = await find(id);
      if (input.files?.length && owner.get(id) !== 'hermes') throw new ChatError(400, 'Załączniki obsługuje tylko Hermes.');
      return once(input.nonce, () => service.send(id, input));
    },
    async file(id, fileId) {
      const service = await find(id);
      return service.file?.(id, fileId);
    },
    async sendAutomation(id: string, input: ChatAutomationInput) {
      const service = await find(id);
      if (!service.sendAutomation) throw new ChatError(503, `Silnik ${owner.get(id) ?? 'rozmowy'} nie przyjmuje tur automatyki.`);
      return service.sendAutomation(id, input);
    },
    async createAutomation(input: ChatAutomationInput) {
      // Automation runs are Wektor conversations, and the window talks only to Hermes: an old stored preference for agy
      // (chat-settings.json from before Hermes) must not send them elsewhere — on 31.10.2026 it silently failed a run.
      const engine: ChatEngine = 'hermes';
      const service = serviceOf(engine);
      if (!service.createAutomation) throw new ChatError(503, `Silnik ${engine} nie zaczyna rozmów automatyki.`);
      const created = await service.createAutomation(input);
      owner.set(created.id, engine);
      return created;
    },
    automationTurn(runId) { return services.map(([, service]) => service.automationTurn?.(runId)).find(Boolean); },
    activeTurns() { return services.flatMap(([, service]) => service.activeTurns?.() ?? []); },
    async stop(id) { return (await find(id)).stop(id); },
    async rename(id, title) { return (await find(id)).rename(id, title); },
    async update(id, changes) { const service = await find(id); if (!service.update) throw new ChatError(409, 'Ten silnik nie obsługuje archiwum.'); await service.update(id, changes); },
    async remove(id, options) {
      try {
        const service = await find(id);
        if (options?.temporary && (await service.get(id)).engine !== 'hermes') return;
        await service.remove(id, options);
        if (!options?.temporary) owner.delete(id);
      } catch (error) {
        if (!(options?.temporary && error instanceof ChatError && error.status === 404)) throw error;
      }
    },
    async approve(id, approval) {
      const service = await find(id);
      if (!service.approve) throw new ChatError(409, 'Ten silnik nie pyta o zgodę.');
      return service.approve(id, approval);
    },
    async subscribe(id, listener) { return (await find(id)).subscribe(id, listener); },
    async engines(): Promise<EngineStatus[]> {
      return Promise.all(chatEngines.map(async engine => {
        const service = options.engines[engine];
        if (!service) return { engine, available: false, error: 'Nie jest włączony na tym serwerze.' };
        const status = service.status ? await service.status() : { available: true };
        return { engine, ...status };
      }));
    },
    async preferred() { return readPreference(); },
    async prefer(engine) {
      preference = engine;
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(settingsFile, JSON.stringify({ engine }), 'utf8');
      } catch { /* kept for this run of the panel */ }
    },
    close() { for (const [, service] of services) service.close(); },
    async drain() { await Promise.all(services.map(([, service]) => service.drain())); },
  };
}
