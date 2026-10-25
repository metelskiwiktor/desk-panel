import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  titleFrom, withContext,
  type ChatDetail, type ChatEvent, type ChatMessage, type ChatPart, type ChatSend, type ChatSummary,
} from '../src/chat-contract';

/** A failure the HTTP layer answers with this status. */
export class ChatError extends Error {
  constructor(readonly status: number, message = `chat failed with ${status}`) { super(message); }
}

/** What the agent is told once, when a conversation starts. The dashboard elements the user points at come with each message. */
export const PREAMBLE = [
  'Jesteś agentem wbudowanym w Desk Panel: osobisty pulpit użytkownika z pocztą Gmail, kalendarzem Google, zadaniami Cezara, treningami Garmin, limitami AI i stanem komputera.',
  'Odpowiadasz po polsku, zwięźle i konkretnie.',
  'Użytkownik może wskazać elementy pulpitu. Dostajesz je w bloku [Kontekst] przed wiadomością: to wszystko, co widzisz z pulpitu. Nie zgaduj brakujących danych, powiedz, czego brakuje.',
  'Panel nie ma jeszcze własnych narzędzi (zadania dnia, notatki). Gdy użytkownik o nie prosi, powiedz to wprost i zaproponuj, co zapisać jako pomysł na później.',
  'Katalog roboczy jest pusty i służy tylko tej rozmowie. Nie uruchamiaj poleceń w systemie i nie zmieniaj plików, jeśli użytkownik nie poprosi o to wprost.',
].join('\n');

/** One running `agy` for one conversation. A test replaces it with a script of events. */
export interface AgentProcess {
  write(line: string): void;
  /** Close stdin: the agent finishes the turn it is on and exits. */
  end(): void;
  /** Stop it now, with everything it started. */
  kill(): void;
  onLine(callback: (line: string) => void): void;
  onExit(callback: (reason: string | null) => void): void;
}
export type Launcher = (args: string[], cwd: string) => AgentProcess;

export function agyExecutable(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.DESK_AGY_BIN) return env.DESK_AGY_BIN;
  const bin = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = [
    path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'agy', 'bin', bin),
    path.join(home, '.agy', 'bin', bin),
    path.join(home, '.local', 'bin', bin),
  ];
  return candidates.find(existsSync) ?? bin;
}

/** Shell-free, as the adapter does it; the whole process tree goes with the kill. */
export function agyLauncher(env: NodeJS.ProcessEnv = process.env): Launcher {
  return (args, cwd) => {
    const child = spawn(agyExecutable(env), args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let exited = false, stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdin.on('error', () => { /* the exit handler tells what happened */ });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-600); });
    return {
      write: line => { child.stdin.write(line); },
      end: () => { child.stdin.end(); },
      kill: () => {
        if (exited || !child.pid) return;
        if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
        else child.kill('SIGKILL');
      },
      onLine: callback => {
        let buffer = '';
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (line) callback(line); }
        });
      },
      onExit: callback => {
        const done = (reason: string | null) => { if (!exited) { exited = true; callback(reason); } };
        child.on('error', (e: NodeJS.ErrnoException) => done(e.code === 'ENOENT' ? 'Nie znaleziono agy. Ustaw DESK_AGY_BIN albo zainstaluj Antigravity CLI.' : 'Nie udało się uruchomić agy.'));
        child.on('close', code => done(code === 0 ? null : stderr.trim().split('\n').pop() || `agy zakończył pracę kodem ${code}.`));
      },
    };
  };
}

interface Stored { id: string; title: string; createdAt: number; updatedAt: number; agy: string | null; items: ChatMessage[] }
interface Session { proc: AgentProcess; agent: ChatMessage | null; steps: Map<number, number>; stopping: boolean; idle?: ReturnType<typeof setTimeout> }

export interface ChatService {
  list(): Promise<ChatSummary[]>;
  get(id: string): Promise<ChatDetail>;
  create(input: ChatSend): Promise<{ id: string }>;
  send(id: string, input: ChatSend): Promise<void>;
  stop(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Sends the whole chat at once, then every message that changes. Returns the way to stop listening. */
  subscribe(id: string, listener: (event: ChatEvent) => void): Promise<() => void>;
  close(): void;
  /** Resolves once everything that was to be saved is on disk. */
  drain(): Promise<void>;
}

export interface ChatOptions {
  /** Where chats and the agent's working directory live; `~/.desk-panel` by default. */
  dir?: string;
  launch?: Launcher;
  now?: () => number;
  /** How long an idle agent process is kept before it is closed. The next message resumes the conversation. */
  idleMs?: number;
}

const ID = /^[0-9a-f-]{36}$/;
const asRecord = (value: unknown): Record<string, any> => (value && typeof value === 'object' ? value as Record<string, any> : {});

export function createAgentChat(options: ChatOptions = {}): ChatService {
  const dir = options.dir ?? path.join(homedir(), '.desk-panel');
  const launch = options.launch ?? agyLauncher();
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? 10 * 60_000;
  const chatsDir = path.join(dir, 'chats'), agentDir = path.join(dir, 'agent');
  const chats = new Map<string, Stored>();
  const sessions = new Map<string, Session>();
  const listeners = new Map<string, Set<(event: ChatEvent) => void>>();
  const flushes = new Map<string, { timer: ReturnType<typeof setTimeout>; messages: Set<ChatMessage> }>();
  let loading: Promise<void> | undefined;

  const file = (id: string) => path.join(chatsDir, `${id}.json`);
  const persist = async (chat: Stored) => {
    await mkdir(chatsDir, { recursive: true });
    const temp = `${file(chat.id)}.tmp`;
    await writeFile(temp, JSON.stringify(chat), 'utf8');
    await rename(temp, file(chat.id));
  };
  // Writes of one chat go one after another, each with the chat as it is when its turn comes; a chat deleted in the
  // meantime is not written back by a process that is still finishing.
  const writes = new Map<string, Promise<void>>();
  const save = (chat: Stored) => {
    const turn = (writes.get(chat.id) ?? Promise.resolve())
      .then(() => (chats.get(chat.id) === chat ? persist(chat) : undefined))
      .catch(() => { /* the chat lives on in memory; the next save tries again */ });
    writes.set(chat.id, turn);
    void turn.then(() => { if (writes.get(chat.id) === turn) writes.delete(chat.id); });
  };

  const load = () => loading ??= (async () => {
    await mkdir(chatsDir, { recursive: true });
    for (const name of await readdir(chatsDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(await readFile(path.join(chatsDir, name), 'utf8')) as Stored;
        if (typeof value.id !== 'string' || !ID.test(value.id) || !Array.isArray(value.items)) continue;
        // A turn that was running when the panel stopped cannot go on: say so instead of showing it as alive.
        for (const message of value.items) if (message.status === 'streaming') { message.status = 'error'; message.error = 'Przerwano: panel został uruchomiony ponownie.'; }
        chats.set(value.id, value);
      } catch { /* a damaged file is not a chat */ }
    }
  })();
  const need = async (id: string) => {
    await load();
    const chat = ID.test(id) ? chats.get(id) : undefined;
    if (!chat) throw new ChatError(404);
    return chat;
  };

  const summary = (chat: Stored): ChatSummary => ({
    id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.items.length,
    running: !!sessions.get(chat.id)?.agent,
  });
  const detail = (chat: Stored): ChatDetail => ({ ...summary(chat), items: chat.items });
  const emit = (id: string, event: ChatEvent) => { for (const listener of listeners.get(id) ?? []) listener(event); };
  /** Text arrives in many small pieces; the screen gets the message a few times a second, not on every piece. */
  const touch = (chat: Stored, message: ChatMessage, immediate = false) => {
    let pending = flushes.get(chat.id);
    if (!pending) {
      pending = { messages: new Set(), timer: setTimeout(() => flush(chat), 40) };
      flushes.set(chat.id, pending);
    }
    pending.messages.add(message);
    if (immediate) flush(chat);
  };
  const flush = (chat: Stored) => {
    const pending = flushes.get(chat.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    flushes.delete(chat.id);
    for (const message of pending.messages) emit(chat.id, { type: 'update', chat: summary(chat), message });
  };

  const armIdle = (chat: Stored, session: Session) => {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => { if (!session.agent) session.proc.end(); }, idleMs);
    session.idle.unref?.();
  };

  const finish = (chat: Stored, session: Session, status: ChatMessage['status'], error?: string, response?: string) => {
    const agent = session.agent;
    if (!agent) return;
    const parts = agent.parts ?? [];
    // Text the agent only gave as the final result (no streamed steps) still belongs in the answer.
    if (response?.trim() && !parts.some(p => p.type === 'text' && p.text.trim())) parts.push({ type: 'text', text: response });
    agent.parts = parts.filter(p => p.type !== 'text' || p.text.trim());
    for (const part of agent.parts) if (part.type === 'tool' && part.state === 'running') part.state = 'done';
    agent.status = status;
    if (error) agent.error = error;
    session.agent = null;
    chat.updatedAt = now();
    save(chat);
    touch(chat, agent, true);
    if (sessions.get(chat.id) === session) armIdle(chat, session);
  };

  const onEvent = (chat: Stored, session: Session, event: unknown) => {
    const ev = asRecord(event);
    if (ev.event === 'init') {
      const id = asRecord(ev).conversation_id;
      if (typeof id === 'string' && id && chat.agy !== id) { chat.agy = id; save(chat); }
      return;
    }
    const agent = session.agent;
    if (!agent) return;
    if (ev.event === 'step_update') {
      const step = asRecord(ev.step_update);
      const parts = (agent.parts ??= []);
      const index = Number(step.step_index);
      if (step.step_type === 'agent_response') {
        let at = session.steps.get(index);
        if (at === undefined) { parts.push({ type: 'text', text: '' }); at = parts.length - 1; session.steps.set(index, at); }
        const part = parts[at] as Extract<ChatPart, { type: 'text' }>;
        if (typeof step.text_delta === 'string') part.text += step.text_delta;
      } else if (step.step_type === 'tool') {
        const info = asRecord(step.tool_info), id = String(index);
        let part = parts.find((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool' && p.id === id);
        if (!part) {
          part = { type: 'tool', id, name: String(step.tool_name ?? info.name ?? 'narzędzie'), input: JSON.stringify(info.parameters ?? {}).slice(0, 600), state: 'running' };
          parts.push(part);
        }
        if (step.state === 'DONE') { part.state = 'done'; if (typeof info.output === 'string') part.output = info.output.slice(0, 4000); }
      } else return;
      touch(chat, agent);
    } else if (ev.event === 'result') {
      const result = asRecord(ev.result);
      if (result.status === 'SUCCESS') finish(chat, session, 'done', undefined, typeof result.response === 'string' ? result.response : undefined);
      else finish(chat, session, 'error', typeof result.error === 'string' && result.error ? result.error : 'Agent nie dokończył odpowiedzi.');
    }
  };

  const open = (chat: Stored): Session => {
    const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', ...(chat.agy ? ['--conversation', chat.agy] : []), '-p', ''];
    const proc = launch(args, agentDir);
    const session: Session = { proc, agent: null, steps: new Map(), stopping: false };
    sessions.set(chat.id, session);
    proc.onLine(line => { try { onEvent(chat, session, JSON.parse(line)); } catch { /* not an event: ignore */ } });
    proc.onExit(reason => {
      clearTimeout(session.idle);
      if (sessions.get(chat.id) === session) sessions.delete(chat.id);
      if (session.agent) finish(chat, session, session.stopping ? 'stopped' : 'error', session.stopping ? undefined : reason ?? 'Agent zakończył pracę przed odpowiedzią.');
    });
    return session;
  };

  const service: ChatService = {
    async list() { await load(); return [...chats.values()].map(summary).sort((a, b) => b.updatedAt - a.updatedAt); },
    async get(id) { return detail(await need(id)); },
    async create(input) {
      await load();
      const at = now();
      const chat: Stored = { id: randomUUID(), title: titleFrom(input.text), createdAt: at, updatedAt: at, agy: null, items: [] };
      chats.set(chat.id, chat);
      await service.send(chat.id, input);
      return { id: chat.id };
    },
    async send(id, input) {
      const chat = await need(id);
      if (sessions.get(id)?.agent) throw new ChatError(409, 'Agent jeszcze odpowiada.');
      const at = now();
      const context = input.context ?? [];
      const user: ChatMessage = { id: randomUUID(), role: 'user', at, text: input.text, ...(context.length ? { context } : {}) };
      const agent: ChatMessage = { id: randomUUID(), role: 'agent', at, parts: [], status: 'streaming' };
      chat.items.push(user, agent);
      chat.updatedAt = at;
      await mkdir(agentDir, { recursive: true });
      const session = sessions.get(id) ?? open(chat);
      clearTimeout(session.idle);
      session.agent = agent;
      session.stopping = false;
      session.steps.clear();
      save(chat);
      touch(chat, user);
      touch(chat, agent, true);
      const prompt = withContext(input.text, context);
      session.proc.write(`${JSON.stringify({ event: 'user', message: { content: chat.agy ? prompt : `${PREAMBLE}\n\n${prompt}` } })}\n`);
    },
    async stop(id) {
      await need(id);
      const session = sessions.get(id);
      if (!session?.agent) return;
      session.stopping = true;
      session.proc.kill();
    },
    async rename(id, title) {
      const chat = await need(id);
      chat.title = title;
      save(chat);
      const last = chat.items.at(-1);
      if (last) emit(id, { type: 'update', chat: summary(chat), message: last });
    },
    async remove(id) {
      const chat = await need(id);
      const session = sessions.get(id);
      if (session) { session.stopping = true; session.proc.kill(); }
      chats.delete(chat.id);
      await writes.get(chat.id);
      await rm(file(chat.id), { force: true });
    },
    async drain() { while (writes.size) await Promise.all([...writes.values()]); },
    async subscribe(id, listener) {
      const chat = await need(id);
      let set = listeners.get(id);
      if (!set) listeners.set(id, set = new Set());
      set.add(listener);
      listener({ type: 'state', chat: detail(chat) });
      return () => { set.delete(listener); if (!set.size) listeners.delete(id); };
    },
    close() {
      for (const pending of flushes.values()) clearTimeout(pending.timer);
      flushes.clear();
      for (const session of sessions.values()) { clearTimeout(session.idle); session.stopping = true; session.proc.kill(); }
    },
  };
  return service;
}
