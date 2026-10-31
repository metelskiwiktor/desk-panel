import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPanelServer } from './app';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAutomations, type Automations } from './automations';
import { createHermesChat } from './hermes-chat';
import { createHermesClient, type HermesClient, type HermesEvent } from './hermes-api';
import { startMockHermes } from './hermes-mock';
import { answerRpc } from './panel-mcp';
import { createScenarioSources } from './scenario';
import type { AutomationPlan } from '../src/automation-contract';

const NOW = Date.parse('2026-10-30T12:00:00+01:00');
const DUE = Date.parse('2026-10-31T07:00:00+01:00');
const plan: AutomationPlan = { name: 'Probe', goal: 'Read', trigger: { kind: 'daily', times: ['7:00'] }, actions: [{ kind: 'message' }], learn: false };
const quiet = { trace() {}, turn() {}, async drain() {} };
const sources = createScenarioSources(join(process.cwd(), 'scenarios/standard.json'));
let dir: string;
let file: string;
let clock: number;
let cleanups: (() => void | Promise<void>)[];
const stored = () => JSON.parse(readFileSync(file, 'utf8'));
const make = (chat: Parameters<typeof createAutomations>[0]['chat'], log: (line: string) => void = () => {}) => {
  const service = createAutomations({ file, chat, now: () => clock, log });
  cleanups.push(() => service.stop());
  return service;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'desk-auto-regression-'));
  file = join(dir, 'automations.json');
  clock = NOW;
  cleanups = [];
});
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

it('recovers the accepted cyclic conversation after a crash before updating pending', async () => {
  const mock = await startMockHermes({ stepMs: 1 });
  cleanups.push(() => mock.close());
  const options = { dir: join(dir, 'chats'), client: createHermesClient({ url: mock.url }), log: quiet };
  const chat = createHermesChat(options);
  cleanups.push(async () => { chat.close(); await chat.drain(); });
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accepted = new Promise<void>(resolve => { reached = resolve; });
  const first = make({ createAutomation: async input => {
    const result = await chat.createAutomation!(input);
    reached();
    await gate;
    return result;
  } });
  await first.createFromPlan('origin', plan);
  clock = DUE;
  const running = first.tick();
  try {
    await accepted;
    const reservation = stored().pending[0];
    expect(reservation).toMatchObject({ sent: false, chatId: expect.any(String), turnId: expect.any(String) });
    first.stop();
    chat.close();
    await chat.drain();
    const recoveredChat = createHermesChat(options);
    cleanups.push(async () => { recoveredChat.close(); await recoveredChat.drain(); });
    const restart = make(recoveredChat);
    await restart.tick();
    expect(stored().pending[0].id).toBe(reservation.id);
    expect((await recoveredChat.list()).map(c => c.id)).toEqual([reservation.chatId]);
    expect(mock.sessions.size).toBe(1);
    expect(mock.runs.size).toBe(1);
    expect(mock.requests.filter(r => r.method === 'POST' && r.path === '/v1/runs')).toHaveLength(1);
  } finally { release(); await running; }
});

it('replays the frozen request and key when Hermes accepted it but its response was lost', async () => {
  const mock = await startMockHermes({ stepMs: 1 });
  cleanups.push(() => mock.close());
  const real = createHermesClient({ url: mock.url });
  let reached!: () => void;
  const accepted = new Promise<void>(resolve => { reached = resolve; });
  const chatDir = join(dir, 'chats');
  // Simulate process death: the API accepted the request, but the caller never receives its response.
  const client: HermesClient = { ...real, async startRun(input) {
    await real.startRun(input);
    reached();
    return new Promise(() => {});
  } };
  const firstChat = createHermesChat({ dir: chatDir, client, log: quiet });
  cleanups.push(async () => { firstChat.close(); await firstChat.drain(); });
  const first = make(firstChat);
  await first.createFromPlan('origin', plan);
  clock = DUE;
  void first.tick();
  await accepted;
  const reservation = stored().pending[0];
  const mapping = JSON.parse(readFileSync(join(chatDir, 'hermes-chats', reservation.chatId + '.json'), 'utf8'));
  expect(mapping.turns[0]).toMatchObject({ run: null, id: reservation.turnId, request: { idempotencyKey: reservation.turnId } });
  first.stop();
  firstChat.close();
  const recoveredChat = createHermesChat({ dir: chatDir, client: real, log: quiet });
  cleanups.push(async () => { recoveredChat.close(); await recoveredChat.drain(); });
  const restart = make(recoveredChat);
  await restart.tick();
  expect(mock.sessions.size).toBe(1);
  expect(mock.runs.size).toBe(1);
  const posts = mock.requests.filter(r => r.method === 'POST' && r.path === '/v1/runs');
  expect(posts).toHaveLength(2); // second POST replays admission; there is only one execution
  expect(posts[1].body).toEqual(posts[0].body);
  expect((await recoveredChat.list()).map(c => c.id)).toEqual([reservation.chatId]);
});

it('rejects a stale real runId through MCP even when its conversation is active', async () => {
  const automations = make({ sendAutomation: async () => {} });
  await automations.createFromPlan('origin', { ...plan, trigger: { kind: 'once', at: clock + 60_000 } });
  clock += 60_000;
  await automations.tick();
  const runId = stored().pending[0].id;
  const result: any = await answerRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'panel_automation_report', arguments: { runId, outcome: 'done', summary: 'ordinary user turn' },
  } }, { views: {}, sources, now: () => clock, automations, activeChats: () => ['other-conversation'] });
  expect(result.result.isError).toBe(true);
  expect((await automations.list())[0].runs).toHaveLength(0);
});

async function liveRun(twoDue = false) {
  let emit!: (event: HermesEvent, id: string | null) => void;
  const client: HermesClient = {
    url: 'http://127.0.0.1:1', health: async () => {}, startRun: vi.fn().mockResolvedValueOnce({ run: 'hermes-run' }).mockResolvedValue({ run: 'later-user-run' }),
    status: async () => ({ state: 'running' }), history: async () => [], approve: async () => {}, cancel: async () => {},
    events: async (_run, onEvent, { signal }) => { emit = onEvent; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); },
  };
  let automations: Automations;
  const chat = createHermesChat({ dir, client, onAutomationTurn: turn => automations.turnChanged(turn) });
  cleanups.push(async () => { chat.close(); await chat.drain(); });
  const serverLog: string[] = [];
  automations = make(chat, line => serverLog.push(line));
  await automations.createFromPlan('origin', plan);
  if (twoDue) await automations.createFromPlan('origin-2', { ...plan, name: 'Second' });
  clock = DUE;
  await automations.tick();
  const pending = stored().pending[0];
  const ctx = { views: {}, sources, now: () => clock, automations, activeChats: () => chat.activeTurns!() };
  const report = (over = {}) => answerRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'panel_automation_report', arguments: { runId: pending.id, token: pending.token, outcome: 'done', summary: 'Done', ...over },
  } }, ctx) as Promise<any>;
  return { chat, client, automations, pending, ctx, report, serverLog, emit: (event: HermesEvent) => emit(event, null) };
}

it('accepts only the open own turn, preserves its Hermes run identity and closes it after reporting', async () => {
  const { automations, pending, report } = await liveRun();
  expect(pending.hermesRunId).toBe('hermes-run');
  expect(pending.token).toMatch(/^[0-9a-f]{32}$/);
  expect((await report({ token: '0'.repeat(32) })).result.isError).toBe(true);
  expect((await report({ token: undefined })).result.isError).toBe(true);
  expect((await report({ runId: 'run-000000000000' })).result.isError).toBe(true);
  expect((await report()).result.isError).toBeUndefined();
  expect((await report()).result.isError).toBe(true);
  expect((await automations.list())[0].runs[0]).toMatchObject({ outcome: 'done', hermesRunId: 'hermes-run', turnId: pending.turnId });
});

it.each([
  { kind: 'completed', output: 'Finished without report' },
  { kind: 'failed', error: 'Provider failed' },
  { kind: 'cancelled' },
] as HermesEvent[])('closes an unreported run immediately on $kind and rejects it during a later user turn', async event => {
  const { chat, automations, pending, report, emit } = await liveRun();
  emit(event);
  expect(stored().pending).toHaveLength(0);
  expect((await automations.list())[0].runs[0]).toMatchObject({ outcome: 'error', summary: 'Tura zakończona bez raportu.' });
  expect(chat.automationTurn?.('hermes-run')).toBeUndefined();
  await vi.waitFor(async () => expect((await chat.get(pending.chatId)).running).toBe(false));
  await chat.send(pending.chatId, { text: 'Ordinary user turn' });
  expect(chat.activeTurns?.()).toContain(pending.chatId);
  expect((await report()).result.isError).toBe(true);
  expect((await automations.list())[0].runs).toHaveLength(1);
});

it('runs due automations sequentially even after an early report and keeps queued identity across restart', async () => {
  const { chat, client, automations, pending, report, emit } = await liveRun(true);
  const second = (await automations.list())[1];
  await automations.tick();
  const queued = stored().pending[1];
  expect(queued).toMatchObject({ automationId: second.id, sent: false, token: expect.any(String) });
  expect(client.startRun).toHaveBeenCalledTimes(1);
  await report({ outcome: 'not-yet' }); // saves the report but Hermes still has work to finish
  await automations.tick();
  expect(client.startRun).toHaveBeenCalledTimes(1);
  expect(stored().execution.id).toBe(pending.id);
  const restart = make(chat);
  await restart.tick();
  expect(client.startRun).toHaveBeenCalledTimes(1);
  emit({ kind: 'completed', output: 'Done' });
  await vi.waitFor(async () => expect((await chat.get(pending.chatId)).running).toBe(false));
  await restart.tick();
  expect(client.startRun).toHaveBeenCalledTimes(2);
  expect(stored().pending[0]).toMatchObject({ id: queued.id, token: queued.token, sent: true });
});

it('omits tokens from HTTP automation views, MCP run history and actual chat logs', async () => {
  const { chat, automations, pending, ctx, report, serverLog, emit } = await liveRun();
  const fixtureSources = createScenarioSources(join(process.cwd(), 'scenarios/standard.json'));
  fixtureSources.automations = async () => ({ automations: await automations.list() });
  const server = createPanelServer(fixtureSources, dir, undefined, chat, { automations });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/automations`;
    const before = await fetch(url);
    expect(before.status).toBe(200);
    expect(await before.text()).not.toContain(pending.token);
    emit({ kind: 'tool-start', id: 'report', name: 'panel_automation_report', input: JSON.stringify({ runId: pending.id, token: pending.token, summary: 'Done' }) });
    expect((await report()).result.isError).toBeUndefined();
    emit({ kind: 'tool-end', id: 'report', name: 'panel_automation_report', output: 'Raport zapisany' });
    emit({ kind: 'completed', output: `Done ${pending.token}` }); // even an accidental echo is redacted in diagnostics
    await vi.waitFor(async () => expect((await chat.get(pending.chatId)).running).toBe(false));
    await chat.drain();
    const after = await (await fetch(url)).text();
    expect(after).toContain('hermes-run');
    expect(after).not.toContain(pending.token);
    expect(after).not.toContain('"token"');
    const mcp = await answerRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'panel_automations', arguments: {} } }, ctx);
    expect(JSON.stringify(mcp)).not.toContain(pending.token);
    const logs = readdirSync(join(dir, 'chat-logs')).filter(n => n.endsWith('.jsonl')).map(n => readFileSync(join(dir, 'chat-logs', n), 'utf8')).join('\n');
    expect(logs).toContain('[redacted]');
    expect(logs).not.toContain(pending.token);
    expect(serverLog.length).toBeGreaterThan(0);
    expect(serverLog.join('\n')).not.toContain(pending.token);
    expect(stored().automations[0].runs[0].token).toBe(pending.token); // private durable run only
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it('never resurrects cancelled observers after corruption, including a second restart', async () => {
  const observersFile = join(dir, 'observers.json');
  const legacy = JSON.stringify({ version: 1, observers: [{
    id: 'o-aaaaaaaaaaaa', chatId: 'origin', kind: 'time', target: 'later', instruction: 'remind',
    createdAt: NOW, expiresAt: NOW + 3_600_000, status: 'active', snapshot: { at: NOW + 60_000 },
  }] });
  writeFileSync(observersFile, legacy);
  const send = vi.fn(async () => {});
  const load = () => {
    const a = createAutomations({ file, observersFile, now: () => clock, log: () => {}, chat: { sendAutomation: send } });
    cleanups.push(() => a.stop());
    return a;
  };
  const first = load();
  const original = (await first.list())[0];
  expect(existsSync(observersFile + '.migrated')).toBe(true);
  expect(stored().migratedFrom).toBe('observers.json');
  await first.update({ id: original.id, action: 'cancel' });
  first.stop();
  writeFileSync(file, '{broken');
  // A stale backup may have been copied back, even after successful migration.
  writeFileSync(observersFile, legacy);
  for (let i = 0; i < 2; i++) {
    const restart = load();
    expect(await restart.list()).toEqual([]);
    expect(restart.error()).toMatch(/uszkodzony/);
    await expect(restart.createFromPlan('origin', plan)).rejects.toMatchObject({ status: 503 });
    clock = DUE;
    await restart.tick();
    expect(send).not.toHaveBeenCalled();
    restart.stop();
  }
});

it('does not replay a legacy reservation whose original dispatch identity is unknown', async () => {
  const chat = { createAutomation: vi.fn(async () => ({ id: 'new-chat' })) };
  const first = make(chat);
  await first.createFromPlan('origin', plan);
  const data = stored();
  data.pending.push({ id: 'run-aaaaaaaaaaaa', automationId: data.automations[0].id, startedAt: 0, sent: false, detail: 'legacy', reason: 'legacy' });
  writeFileSync(file, JSON.stringify(data));
  const restart = make(chat);
  await restart.tick();
  expect(chat.createAutomation).not.toHaveBeenCalled();
  expect((await restart.list())[0].runs[0]).toMatchObject({ outcome: 'error' });
});
