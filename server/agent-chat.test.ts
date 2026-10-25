import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ContextItem } from '../src/chat-contract';
import { agyExecutable, createAgentChat, PREAMBLE, type AgentProcess, type ChatService, type Launcher } from './agent-chat';
import { handleChatRoute } from './chat-routes';

/** Stands in for `agy`: the test says what the agent prints and when it exits. Events below are the shapes agy 1.4.7 prints. */
class FakeAgent implements AgentProcess {
  written: string[] = [];
  killed = false;
  ended = false;
  private line?: (line: string) => void;
  private exit?: (reason: string | null) => void;
  constructor(readonly args: string[]) {}
  write(line: string) { this.written.push(line); }
  end() { this.ended = true; queueMicrotask(() => this.close(null)); }
  kill() { this.killed = true; queueMicrotask(() => this.close('killed')); }
  onLine(callback: (line: string) => void) { this.line = callback; }
  onExit(callback: (reason: string | null) => void) { this.exit = callback; }
  print(event: unknown) { this.line?.(JSON.stringify(event)); }
  close(reason: string | null) { this.exit?.(reason); }
  /** What the user's last message looked like to the agent. */
  get prompt(): string { return JSON.parse(this.written.at(-1)!).message.content; }
}
const init = (id: string) => ({ event: 'init', conversation_id: id, init: { cwd: 'C:\\agent', tools: ['run_command'], permission_mode: 'request-review' } });
const step = (index: number, type: string, state: 'ACTIVE' | 'DONE', extra: object = {}) =>
  ({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: index, state, step_type: type, ...extra } });
const answer = (response: string, extra: object = {}) => ({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response, duration_seconds: 2, num_turns: 1, ...extra } });

let dir: string;
let agents: FakeAgent[];
let service: ChatService;
const launch: Launcher = args => { const agent = new FakeAgent(args); agents.push(agent); return agent; };
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'desk-chat-'));
  agents = [];
  service = createAgentChat({ dir, launch, idleMs: 60_000 });
});
afterEach(async () => {
  service.close();
  await new Promise(resolve => setTimeout(resolve, 0)); // the killed agents report their exit
  await service.drain();
  await rm(dir, { recursive: true, force: true });
});

const mail: ContextItem = { kind: 'mail', id: 'm1', title: 'Anna Nowak: Spotkanie w czwartek', text: 'Od: Anna Nowak\nTemat: Spotkanie w czwartek' };
/** The agent's whole answer to a plain question, as agy prints it. */
function simpleTurn(agent: FakeAgent, id = 'c1') {
  agent.print(init(id));
  agent.print(step(0, 'user_input', 'DONE'));
  agent.print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'Wynik mnożenia ' }));
  agent.print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'to 391.' }));
  agent.print(step(1, 'agent_response', 'DONE', { text_delta: '\n', usage: { total_tokens: 7796 } }));
  agent.print(answer('Wynik mnożenia to 391.\n'));
}

describe('czat z agentem', () => {
  it('nowa rozmowa: zaczyna od instrukcji, kontekstu i pytania, a odpowiedź składa ze strumienia', async () => {
    const { id } = await service.create({ text: 'Zrób z tego zadanie', context: [mail] });
    expect(agents).toHaveLength(1);
    expect(agents[0].args).toEqual(['--output-format', 'stream-json', '--input-format', 'stream-json', '-p', '']);
    expect(agents[0].prompt).toContain(PREAMBLE);
    expect(agents[0].prompt).toContain('1. Mail: Anna Nowak: Spotkanie w czwartek');
    expect(agents[0].prompt).toContain('[Wiadomość]\nZrób z tego zadanie');
    expect((await service.get(id)).running).toBe(true);

    simpleTurn(agents[0]);
    const chat = await service.get(id);
    expect(chat.running).toBe(false);
    expect(chat.title).toBe('Zrób z tego zadanie');
    expect(chat.items.map(m => m.role)).toEqual(['user', 'agent']);
    expect(chat.items[0]).toMatchObject({ text: 'Zrób z tego zadanie', context: [mail] });
    expect(chat.items[1]).toMatchObject({ status: 'done', parts: [{ type: 'text', text: 'Wynik mnożenia to 391.\n' }] });
  });

  it('kroki narzędzi trafiają do odpowiedzi w kolejności, a puste kroki myślenia znikają', async () => {
    const { id } = await service.create({ text: 'Co jest w katalogu?' });
    const agent = agents[0];
    agent.print(init('c1'));
    agent.print(step(0, 'user_input', 'DONE'));
    agent.print(step(1, 'agent_response', 'DONE', { duration_seconds: 4.6 })); // thinking only
    agent.print(step(2, 'tool', 'ACTIVE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'Get-ChildItem -Name' } } }));
    expect((await service.get(id)).items[1].parts).toEqual([
      { type: 'text', text: '' },
      { type: 'tool', id: '2', name: 'run_command', input: '{"CommandLine":"Get-ChildItem -Name"}', state: 'running' },
    ]);
    agent.print(step(2, 'tool', 'DONE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'Get-ChildItem -Name' }, output: 'help.err\nrun.mjs' } }));
    agent.print(step(3, 'agent_response', 'ACTIVE', { text_delta: 'Są dwa pliki.' }));
    agent.print(answer('Są dwa pliki.'));
    const [message] = (await service.get(id)).items.slice(1);
    expect(message.parts).toEqual([
      { type: 'tool', id: '2', name: 'run_command', input: '{"CommandLine":"Get-ChildItem -Name"}', output: 'help.err\nrun.mjs', state: 'done' },
      { type: 'text', text: 'Są dwa pliki.' },
    ]);
  });

  it('kolejna wiadomość idzie do tego samego procesu i bez instrukcji', async () => {
    const { id } = await service.create({ text: 'Pierwsze' });
    simpleTurn(agents[0]);
    await service.send(id, { text: 'Drugie', context: [] });
    expect(agents).toHaveLength(1);
    expect(agents[0].prompt).toBe('Drugie');
    expect(agents[0].written).toHaveLength(2);
  });

  it('nie przyjmuje wiadomości, gdy agent jeszcze odpowiada', async () => {
    const { id } = await service.create({ text: 'Pierwsze' });
    await expect(service.send(id, { text: 'Drugie', context: [] })).rejects.toMatchObject({ status: 409 });
    expect(agents[0].written).toHaveLength(1);
  });

  it('po bezczynności zamyka proces, a następna wiadomość wznawia rozmowę po ID z agy', async () => {
    service.close();
    service = createAgentChat({ dir, launch, idleMs: 5 });
    const { id } = await service.create({ text: 'Pierwsze' });
    simpleTurn(agents[0], 'conv-42');
    await vi.waitFor(() => expect(agents[0].ended).toBe(true));
    await service.send(id, { text: 'Drugie', context: [] });
    expect(agents).toHaveLength(2);
    expect(agents[1].args).toEqual(['--output-format', 'stream-json', '--input-format', 'stream-json', '--conversation', 'conv-42', '-p', '']);
    expect(agents[1].prompt).toBe('Drugie');
  });

  it('stop zabija proces, a odpowiedź zostaje oznaczona jako zatrzymana', async () => {
    const { id } = await service.create({ text: 'Długie zadanie' });
    agents[0].print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'Zaczynam…' }));
    await service.stop(id);
    await vi.waitFor(async () => expect((await service.get(id)).running).toBe(false));
    expect(agents[0].killed).toBe(true);
    expect((await service.get(id)).items[1]).toMatchObject({ status: 'stopped', parts: [{ type: 'text', text: 'Zaczynam…' }] });
  });

  it('nagłe zakończenie agy to błąd z powodem, nie wieczne „pisze”', async () => {
    const { id } = await service.create({ text: 'Pytanie' });
    agents[0].close('Error: not signed in');
    expect((await service.get(id)).items[1]).toMatchObject({ status: 'error', error: 'Error: not signed in' });
  });

  it('wynik z błędem agy pokazuje jego treść', async () => {
    const { id } = await service.create({ text: 'Pytanie' });
    agents[0].print({ event: 'result', result: { conversation_id: 'c1', status: 'ERROR', response: '', error: 'quota exhausted' } });
    expect((await service.get(id)).items[1]).toMatchObject({ status: 'error', error: 'quota exhausted' });
  });

  it('lista i historia przeżywają restart; przerwana odpowiedź jest oznaczona jako błąd', async () => {
    const { id } = await service.create({ text: 'Zapamiętaj to' });
    simpleTurn(agents[0], 'conv-7');
    await service.send(id, { text: 'Druga tura', context: [] }); // never answered: the panel dies here, without a goodbye
    await vi.waitFor(async () => expect(JSON.parse(await readFile(path.join(dir, 'chats', `${id}.json`), 'utf8')).items).toHaveLength(4));

    const again = createAgentChat({ dir, launch });
    const [listed] = await again.list();
    expect(listed).toMatchObject({ id, title: 'Zapamiętaj to', messages: 4, running: false });
    const chat = await again.get(id);
    expect(chat.items[3]).toMatchObject({ status: 'error', error: expect.stringContaining('uruchomiony ponownie') });
    await again.send(id, { text: 'Wróciłem', context: [] });
    expect(agents.at(-1)!.args).toContain('conv-7');
    again.close();
    await new Promise(resolve => setTimeout(resolve, 0));
    await again.drain();
  });

  it('zmienia nazwę i usuwa rozmowę razem z plikiem, nie wskrzeszając go po zakończeniu agenta', async () => {
    const { id } = await service.create({ text: 'Do usunięcia' });
    await service.rename(id, 'Inna nazwa');
    expect((await service.list())[0].title).toBe('Inna nazwa');
    await service.remove(id);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(await service.list()).toEqual([]);
    expect(await readdir(path.join(dir, 'chats'))).toEqual([]);
    await expect(service.get(id)).rejects.toMatchObject({ status: 404 });
  });

  it('subskrypcja dostaje najpierw całą rozmowę, potem zmieniane wiadomości', async () => {
    const { id } = await service.create({ text: 'Pytanie' });
    const events: ChatEvent[] = [];
    const stop = await service.subscribe(id, event => events.push(event));
    expect(events[0]).toMatchObject({ type: 'state', chat: { id, running: true } });
    agents[0].print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'Odp' }));
    agents[0].print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'owiedź' }));
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(1));
    expect(events).toHaveLength(2); // the two pieces arrive as one update
    expect(events[1]).toMatchObject({ type: 'update', message: { role: 'agent', parts: [{ type: 'text', text: 'Odpowiedź' }] } });
    stop();
    agents[0].print(answer('Odpowiedź'));
    expect(events).toHaveLength(2);
  });
});

describe('uruchamianie agy', () => {
  it('wskazuje plik z DESK_AGY_BIN, a bez niego szuka agy w katalogu użytkownika', () => {
    expect(agyExecutable({ DESK_AGY_BIN: 'C:\\narzedzia\\agy.exe' }, 'C:\\Users\\x')).toBe('C:\\narzedzia\\agy.exe');
    expect(agyExecutable({ LOCALAPPDATA: path.join(dir, 'brak') }, path.join(dir, 'dom'))).toMatch(/agy(\.exe)?$/);
  });
});

describe('trasy /api/chats', () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!(await handleChatRoute(req, res, url, base, service))) res.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const post = (url: string, body: unknown, origin: string | null = base) => fetch(base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
  });

  it('zapisy są tylko ze strony panelu: bez własnego Origin odpowiada 403 i nic nie uruchamia', async () => {
    expect((await post('/api/chats', { text: 'hej' }, 'http://evil.example')).status).toBe(403);
    expect((await post('/api/chats', { text: 'hej' }, null)).status).toBe(403);
    expect(agents).toHaveLength(0);
  });

  it('odrzuca nieprawidłowe ciało i nadmiar kontekstu', async () => {
    expect((await post('/api/chats', { text: '   ' })).status).toBe(400);
    expect((await post('/api/chats', { text: 'a', extra: 1 })).status).toBe(400);
    expect((await post('/api/chats', { text: 'a', context: Array.from({ length: 11 }, () => mail) })).status).toBe(400);
    expect(agents).toHaveLength(0);
  });

  it('tworzy rozmowę, wysyła wiadomości, zmienia nazwę i usuwa', async () => {
    const created = await post('/api/chats', { text: 'Hej', context: [mail] });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    simpleTurn(agents[0]);
    expect(await (await fetch(`${base}/api/chats`)).json()).toMatchObject({ chats: [{ id, title: 'Hej', messages: 2 }] });
    expect((await post(`/api/chats/${id}/messages`, { text: 'Jeszcze raz' })).status).toBe(202);
    expect((await post(`/api/chats/${id}/messages`, { text: 'Za szybko' })).status).toBe(409);
    expect((await post(`/api/chats/${id}/stop`, {})).status).toBe(200);
    const renamed = await fetch(`${base}/api/chats/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ title: 'Nowa nazwa' }) });
    expect(renamed.status).toBe(200);
    expect((await (await fetch(`${base}/api/chats/${id}`)).json() as { title: string }).title).toBe('Nowa nazwa');
    expect((await fetch(`${base}/api/chats/${id}`, { method: 'DELETE', headers: { Origin: base } })).status).toBe(200);
    expect((await fetch(`${base}/api/chats/${id}`)).status).toBe(404);
  });

  it('strumień zdarzeń zaczyna się od stanu rozmowy i niesie zmiany', async () => {
    const { id } = await service.create({ text: 'Strumień' });
    const response = await fetch(`${base}/api/chats/${id}/events`);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const read = async (until: RegExp) => { while (!until.test(text)) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value); } };
    await read(/"type":"state"/);
    agents[0].print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'Cześć' }));
    await read(/"type":"update"[\s\S]*Cześć/);
    expect(text).toContain('retry: 3000');
    await reader.cancel();
  });

  it('bez usługi czatu odpowiada 503 i nie zgłasza się do innych tras', async () => {
    const { url } = await new Promise<{ url: string }>(resolve => {
      const bare = createServer(async (req, res) => { if (!(await handleChatRoute(req, res, new URL(req.url!, 'http://x'), 'http://x'))) res.writeHead(404).end(); });
      bare.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(bare.address() as AddressInfo).port}` }));
      server.once('close', () => bare.close());
    });
    expect((await fetch(`${url}/api/chats`)).status).toBe(503);
    expect((await fetch(`${url}/api/mail`)).status).toBe(404);
  });
});
