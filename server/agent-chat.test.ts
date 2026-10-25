import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ContextItem } from '../src/chat-contract';
import { agyExecutable, agyModelArgs, agyPermissionArgs, createAgentChat, DEFAULT_AGY_MODEL, preamble, DEFAULT_PANEL_URL, type AgentProcess, type ChatService, type Launcher } from './agent-chat';
import { handleChatRoute } from './chat-routes';

/** Stands in for `agy`: the test says what the agent prints and when it exits. Events below are the shapes agy 1.4.7 prints. */
class FakeAgent implements AgentProcess {
  written: string[] = [];
  killed = false;
  ended = false;
  private line?: (line: string) => void;
  private exit?: (reason: string | null) => void;
  constructor(readonly args: string[]) {}
  get command() { return ['agy.exe', '--model', 'gemini-3.8-flash-medium', ...this.args]; }
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
const step = (index: number, type: string, state: 'ACTIVE' | 'DONE' | 'ERROR', extra: object = {}) =>
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
    expect(agents[0].prompt).toContain(preamble());
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

describe('dziennik diagnostyczny czatu', () => {
  const read = async (name: string) => {
    await service.drain();
    return (await readFile(path.join(dir, 'chat-logs', name), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, any>);
  };
  const toolStep = (index: number, state: 'ACTIVE' | 'DONE', name: string, parameters: object, output?: string) =>
    step(index, 'tool', state, { tool_name: name, tool_info: { name, parameters, ...(output === undefined ? {} : { output }) } });
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

  it('tura bez słowa do użytkownika to błąd „Agent zakończył bez odpowiedzi”, z narzędziami i śladem, dlaczego', async () => {
    const { id } = await service.create({ text: 'Zarchiwizuj stare zadania', context: [mail] });
    const agent = agents[0];
    agent.print(init('c1'));
    agent.print(toolStep(1, 'ACTIVE', 'read_file', { Path: 'cezar.ts', StartLine: 1, EndLine: 100 }));
    agent.print(toolStep(1, 'DONE', 'read_file', { Path: 'cezar.ts' }));
    agent.print(answer('', { usage: { input_tokens: 5000, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 0 } }));
    const message = (await service.get(id)).items.at(-1)!;
    expect(message.status).toBe('error');
    expect(message.error).toBe('Agent zakończył bez odpowiedzi.');
    expect(message.parts?.map(p => p.type)).toEqual(['tool']);
    const [turn] = await read('turns.jsonl');
    expect(turn).toMatchObject({
      chat: id, turn: 1, model: 'gemini-3.8-flash-medium', ask: 'Zarchiwizuj stare zadania', context: ['mail'],
      status: 'error', endedBy: 'result', emptyAnswer: true, answerChars: 0, lastStep: 'tool:read_file:DONE',
      result: { status: 'SUCCESS', responseChars: 0 }, usage: { input: 5000, output: 20, thinking: 5, cached: 0, tools: 1 },
      tools: [{ name: 'read_file', exitCode: null, outputChars: null }],
    });
  });

  it('odmowa uprawnień w trybie bez interakcji (kształt z prawdziwego agy): komunikat z nazwą narzędzia, błąd narzędzia i denied w podsumowaniu', async () => {
    const { id } = await service.create({ text: 'Zarchiwizuj wszystkie starsze niż 6h', context: [] });
    const agent = agents[0];
    agent.print(init('c1'));
    agent.print(toolStep(1, 'ACTIVE', 'read_file', { Path: 'C:/x/cezar-finished.ts', StartLine: 1, EndLine: 100 }));
    agent.print(step(1, 'tool', 'ERROR', { tool_name: 'read_file', tool_info: { name: 'read_file', parameters: {}, error: { type: 'TOOL_ERROR', message: 'permission check failed for read_file "C:/x/cezar-finished.ts"\nDo not attempt to circumvent this denial' } } }));
    agent.print(answer('', { usage: { input_tokens: 100 }, denied_actions: [{ action: 'read_file', display_name: 'ReadFile' }] }));
    const message = (await service.get(id)).items.at(-1)!;
    expect(message.status).toBe('error');
    expect(message.error).toContain('read_file');
    expect(message.error).toContain('zablokowane');
    const tool = message.parts![0] as { state: string; output: string };
    expect(tool.state).toBe('done');
    expect(tool.output).toBe('Błąd: permission check failed for read_file "C:/x/cezar-finished.ts"');
    const [turn] = await read('turns.jsonl');
    expect(turn).toMatchObject({ emptyAnswer: true, denied: ['read_file'], lastStep: 'tool:read_file:ERROR', tools: [{ name: 'read_file', error: 'permission check failed for read_file "C:/x/cezar-finished.ts"' }] });
  });

  it('zwykła tura: podsumowanie z kodem wyjścia i rozmiarem wyniku oraz surowy ślad z poleceniem, wysłanym promptem i zdarzeniami agy', async () => {
    const { id } = await service.create({ text: 'Ile to 17 razy 23?', context: [] });
    const agent = agents[0];
    const output = 'Command exited with code 0.\n\nCommand output:\n391';
    agent.print(init('c1'));
    agent.print(toolStep(1, 'ACTIVE', 'run_command', { CommandLine: 'echo 391' }));
    agent.print(toolStep(1, 'DONE', 'run_command', { CommandLine: 'echo 391' }, output));
    agent.print(step(2, 'agent_response', 'ACTIVE', { text_delta: 'To 391.' }));
    agent.print(step(2, 'agent_response', 'DONE', { text_delta: '\n' }));
    agent.print(answer('To 391.\n', { usage: { input_tokens: 9000, output_tokens: 40, thinking_tokens: 0, cache_read_tokens: 100 } }));
    const [turn] = await read('turns.jsonl');
    expect(turn).toMatchObject({ status: 'done', emptyAnswer: false, endedBy: 'result', answerChars: 8, lastStep: 'agent_response:DONE', tools: [{ name: 'run_command', input: '{"CommandLine":"echo 391"}', exitCode: 0, outputChars: output.length }] });
    const trace = await read(`${id}.jsonl`);
    expect(trace[0]).toMatchObject({ src: 'panel', kind: 'spawn', turn: 0, resumed: false });
    expect(trace[0].command).toContain('--model');
    expect(trace[1]).toMatchObject({ src: 'panel', kind: 'sent', turn: 1, preamble: true, contextItems: 0, ask: 'Ile to 17 razy 23?' });
    expect(trace.filter(line => line.src === 'agy').map(line => line.kind)).toEqual(['init', 'step_update', 'step_update', 'step_update', 'step_update', 'result']);
    expect(trace.find(line => line.kind === 'result')!.event.result.usage.input_tokens).toBe(9000);
    expect(trace.at(-1)).toMatchObject({ src: 'panel', kind: 'finish', status: 'done', emptyAnswer: false, endedBy: 'result' });
    expect(await readFile(path.join(dir, 'chat-logs', 'README.md'), 'utf8')).toContain('turns.jsonl');
  });

  it('proces, który pada w trakcie tury, i zatrzymanie przez użytkownika mają w podsumowaniu, co je zakończyło', async () => {
    const first = await service.create({ text: 'Pierwsze', context: [] });
    agents[0].print(init('c1'));
    agents[0].close('agy zakończył pracę kodem 1.');
    await settle();
    const second = await service.create({ text: 'Drugie', context: [] });
    agents[1].print(init('c2'));
    await service.stop(second.id);
    await settle();
    const turns = await read('turns.jsonl');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ status: 'error', endedBy: 'exit', error: 'agy zakończył pracę kodem 1.', emptyAnswer: false });
    expect(turns[1]).toMatchObject({ status: 'stopped', endedBy: 'stop' });
    expect((await read(`${first.id}.jsonl`)).find(line => line.kind === 'exit')).toMatchObject({ reason: 'agy zakończył pracę kodem 1.', duringTurn: true });
    expect((await read(`${second.id}.jsonl`)).some(line => line.kind === 'stop')).toBe(true);
  });

  it('bardzo długi wynik narzędzia jest w śladzie skrócony, a jego prawdziwy rozmiar zostaje w podsumowaniu', async () => {
    const { id } = await service.create({ text: 'Pokaż wszystko', context: [] });
    const huge = 'x'.repeat(30_000);
    agents[0].print(init('c1'));
    agents[0].print(toolStep(1, 'ACTIVE', 'run_command', { CommandLine: 'dir' }));
    agents[0].print(toolStep(1, 'DONE', 'run_command', { CommandLine: 'dir' }, huge));
    agents[0].print(step(2, 'agent_response', 'ACTIVE', { text_delta: 'Gotowe.' }));
    agents[0].print(answer('Gotowe.'));
    const line = (await read(`${id}.jsonl`)).find(entry => entry.event?.truncated);
    expect(line).toMatchObject({ src: 'agy', kind: 'step_update', event: { event: 'step_update', truncated: true } });
    expect(line!.event.bytes).toBeGreaterThan(30_000);
    expect(line!.event.head.length).toBe(2000);
    const [turn] = await read('turns.jsonl');
    expect(turn.tools[0].outputChars).toBe(30_000);
    const chat = (await service.get(id)).items.at(-1)!;
    expect((chat.parts![0] as { output: string }).output).toHaveLength(4000);
  });

  it('rozmowy zostają lekkie: dziennik leży w osobnym katalogu, a usunięcie rozmowy nie kasuje śladu', async () => {
    const { id } = await service.create({ text: 'Hej', context: [] });
    agents[0].print(init('c1'));
    agents[0].print(step(1, 'agent_response', 'ACTIVE', { text_delta: 'Cześć.' }));
    agents[0].print(answer('Cześć.'));
    await service.drain();
    expect(await readdir(path.join(dir, 'chats'))).toEqual([`${id}.json`]);
    expect(await readFile(path.join(dir, 'chats', `${id}.json`), 'utf8')).not.toContain('step_update');
    await service.remove(id);
    const trace = await read(`${id}.jsonl`);
    expect(trace.some(line => line.kind === 'chat-deleted')).toBe(true);
  });
});

describe('uruchamianie agy', () => {
  it('wskazuje plik z DESK_AGY_BIN, a bez niego szuka agy w katalogu użytkownika', () => {
    expect(agyExecutable({ DESK_AGY_BIN: 'C:\\narzedzia\\agy.exe' }, 'C:\\Users\\x')).toBe('C:\\narzedzia\\agy.exe');
    expect(agyExecutable({ LOCALAPPDATA: path.join(dir, 'brak') }, path.join(dir, 'dom'))).toMatch(/agy(\.exe)?$/);
  });

  it('instrukcja pozwala agentowi czytać widoki panelu (tylko GET), pod adresem usługi, i oszczędzać kontekst', () => {
    const text = preamble();
    for (const view of ['calendar', 'training', 'cezar', 'mail', 'quotas', 'system']) expect(text).toContain(`/api/agent/${view}`);
    expect(text).toContain(`curl.exe -s "${DEFAULT_PANEL_URL}/api/agent/calendar?from=`);
    expect(text).toMatch(/tylko zapytania GET/);
    expect(text).toContain(`POST ${DEFAULT_PANEL_URL}/api/cezar/action`);
    expect(text).toContain(`Origin równym ${DEFAULT_PANEL_URL}`);
    expect(text).toContain('{"id":"projekt/uuid","action":"archive"}');
    expect(text).toMatch(/archive, unarchive, read albo unread/);
    // To-do lists: a bare "zadanie" is a list item, never Cezar; the agent knows the view, the action and the one rule for adding.
    expect(text).toContain('/api/agent/todos');
    expect(text).toContain(`POST ${DEFAULT_PANEL_URL}/api/todos/action`);
    for (const action of ['createList', 'addTask', 'updateTask', 'moveTask', 'renameList', 'deleteTask', 'clearDone', 'deleteList']) expect(text).toContain(`"action":"${action}"`);
    expect(text).toContain('"by":"agent"');
    expect(text).toContain('charset=utf-8');
    expect(text).toMatch(/nie przez zagnieżdżone `powershell -Command/);
    expect(text).toMatch(/bez dopowiedzenia oznacza zadanie z list zadań użytkownika, nie zadanie Cezara/);
    expect(text).toMatch(/Usuwaj \(deleteTask, clearDone, deleteList\)/);
    expect(text).toMatch(/id w postaci `projekt\/uuid`/);
    expect(text).toContain('Europe/Warsaw');
    expect(text).toMatch(/nie przeliczaj ich/);
    expect(text).toMatch(/Oszczędzaj kontekst/);
    expect(text).not.toMatch(/Nie uruchamiaj poleceń/);
    expect(preamble('http://127.0.0.1:6000')).toContain('"http://127.0.0.1:6000/api/agent/calendar?from=');
  });

  it('zapisuje zużycie tury z wyniku agy: tokeny, wywołania modelu i polecenia', async () => {
    const { id } = await service.create({ text: 'Co mam w przyszłym tygodniu?', context: [] });
    const agent = agents[0];
    agent.print(init('c1'));
    agent.print(step(1, 'agent_response', 'DONE', { usage: { input_tokens: 8401 } }));
    agent.print(step(2, 'tool', 'ACTIVE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'curl.exe -s x' } } }));
    agent.print(step(2, 'tool', 'DONE', { tool_name: 'run_command', tool_info: { name: 'run_command', parameters: {}, output: '[]' } }));
    agent.print(step(3, 'agent_response', 'ACTIVE', { text_delta: 'Nic.' }));
    agent.print(step(3, 'agent_response', 'DONE', { text_delta: '\n' }));
    agent.print(answer('Nic.\n', { usage: { input_tokens: 11200, output_tokens: 300, thinking_tokens: 120, cache_read_tokens: 4000, total_tokens: 11500 } }));
    await vi.waitFor(async () => expect((await service.get(id)).running).toBe(false));
    const stored = (await service.get(id)).items.at(-1)!;
    expect(stored.usage).toEqual({ input: 11200, output: 300, thinking: 120, cached: 4000, calls: 2, tools: 1 });
  });

  it('bez usage w wyniku nie zmyśla zużycia', async () => {
    const { id } = await service.create({ text: 'Ile to 17 razy 23?', context: [] });
    simpleTurn(agents[0]);
    await vi.waitFor(async () => expect((await service.get(id)).running).toBe(false));
    expect((await service.get(id)).items.at(-1)!.usage).toBeUndefined();
  });

  it('rozmowa dostaje instrukcję z adresem panelu z opcji', async () => {
    const custom = createAgentChat({ dir, launch, idleMs: 60_000, panelUrl: 'http://127.0.0.1:6000' });
    try {
      await custom.create({ text: 'Co mam jutro?', context: [] });
      expect(agents.at(-1)!.prompt).toContain('curl.exe -s "http://127.0.0.1:6000/api/agent/calendar');
    } finally {
      custom.close();
      await new Promise(resolve => setTimeout(resolve, 0));
      await custom.drain();
    }
  });

  it('agy dostaje zgodę na narzędzia, bo tryb bez interakcji nie może o nią pytać; DESK_AGY_SKIP_PERMISSIONS=0 to wyłącza', () => {
    expect(agyPermissionArgs({})).toEqual(['--dangerously-skip-permissions']);
    expect(agyPermissionArgs({ DESK_AGY_SKIP_PERMISSIONS: '1' })).toEqual(['--dangerously-skip-permissions']);
    expect(agyPermissionArgs({ DESK_AGY_SKIP_PERMISSIONS: '' })).toEqual(['--dangerously-skip-permissions']);
    for (const off of ['0', 'false', 'No', ' off ']) expect(agyPermissionArgs({ DESK_AGY_SKIP_PERMISSIONS: off }), off).toEqual([]);
  });

  it('domyślnie używa Gemini 3.8 Flash (Medium) i nie podaje --effort', () => {
    expect(DEFAULT_AGY_MODEL).toBe('gemini-3.8-flash-medium');
    expect(agyModelArgs({})).toEqual(['--model', 'gemini-3.8-flash-medium']);
    expect(agyModelArgs({ DESK_AGY_MODEL: '  ', DESK_AGY_EFFORT: '' })).toEqual(['--model', 'gemini-3.8-flash-medium']);
  });

  it('bierze model z DESK_AGY_MODEL, a --effort dodaje tylko z DESK_AGY_EFFORT', () => {
    expect(agyModelArgs({ DESK_AGY_MODEL: 'claude-sonnet-5-5-high' })).toEqual(['--model', 'claude-sonnet-5-5-high']);
    expect(agyModelArgs({ DESK_AGY_MODEL: ' gemini-4-argon-low ', DESK_AGY_EFFORT: ' high ' })).toEqual(['--model', 'gemini-4-argon-low', '--effort', 'high']);
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
