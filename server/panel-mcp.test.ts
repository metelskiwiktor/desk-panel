import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentChat } from './agent-chat';
import { createPanelServer } from './app';
import { createChatHub } from './chat-hub';
import { createHermesClient } from './hermes-api';
import { createHermesChat } from './hermes-chat';
import { startMockHermes, type MockHermes } from './hermes-mock';
import { mcpToken, PANEL_TOOLS } from './panel-mcp';
import { createScenarioSources } from './scenario';

const TOKEN = 'a'.repeat(64);
let server: Server, base: string, dir: string, mock: MockHermes;
let close: () => void;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'desk-mcp-'));
  mock = await startMockHermes({ stepMs: 5 });
  const hermes = createHermesChat({ dir, client: createHermesClient({ url: mock.url }) });
  const agy = createAgentChat({ dir });
  const chat = createChatHub({ dir, engines: { hermes, agy } });
  close = () => chat.close();
  server = createPanelServer(createScenarioSources(path.join(process.cwd(), 'scenarios', 'standard.json')), dir, 'desk.tail0.ts.net', chat, { mcpToken: TOKEN });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

const rpc = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) =>
  fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const call = async (name: string, args: unknown) => {
  const response = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
  return (await response.json() as { result: { isError?: boolean; content: { text: string }[] } }).result;
};

describe('panel MCP for Hermes', () => {
  it('lets in only a local caller with the token, never a browser or the Tailscale name', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, {})).status).toBe(401);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${TOKEN}`, Origin: base })).status).toBe(403);
    // fetch cannot set Host: a plain request does, as Tailscale Serve's proxy would.
    const viaTailscale = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/api/mcp`, { method: 'POST', headers: { Host: 'desk.tail0.ts.net', Authorization: `Bearer ${TOKEN}` } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    });
    expect(viaTailscale).toBe(403);
    expect((await fetch(`${base}/api/mcp`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(405);
  });

  it('speaks MCP: initialize, notifications, tools/list', async () => {
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'hermes' } } })).json() as any;
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'desk-panel' } });
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json() as any;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(Object.keys(PANEL_TOOLS));
    for (const tool of list.result.tools) expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(((await (await rpc({ jsonrpc: '2.0', id: 3, method: 'nope' })).json()) as any).error.code).toBe(-32601);
  });

  it('answers with the same short views the agy chat reads', async () => {
    const calendar = await call('panel_calendar', { from: '2026-10-26', to: '2026-10-27' });
    expect(calendar.isError).toBeUndefined();
    expect(calendar.content[0].text).toMatch(/^Kalendarz Google, 2026-10-26 – 2026-10-27/);
    expect((await call('panel_time', {})).content[0].text).toMatch(/Europe\/Warsaw/);
    const bank = await call('panel_bank', {});
    expect(bank.content[0].text).not.toMatch(/\d{9,}/); // no full account or phone numbers
    const cezarTasks = await call('panel_cezar', {});
    expect(cezarTasks.content[0].text).toContain('Cezar');
    const cezarDetail = await call('panel_cezar', { id: 'desk-panel/cb2f59e7-55fa-41fc-8e3a-d7d7f1e9d0a3' });
    expect(cezarDetail.isError).toBeUndefined();
  });

  it('checks arguments before anything runs', async () => {
    expect(await call('panel_calendar', { from: '26.10.2026' })).toMatchObject({ isError: true });
    expect(await call('panel_mail', { limit: 500 })).toMatchObject({ isError: true });
    expect(await call('panel_system', { extra: 1 })).toMatchObject({ isError: true });
    expect(await call('panel_cezar_action', { id: '../x', action: 'archive' })).toMatchObject({ isError: true });
    expect(await call('panel_todo_action', { action: { action: 'dropDatabase' } })).toMatchObject({ isError: true });
    const unknown = await (await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'bank_labels', arguments: {} } })).json() as any;
    expect(unknown.error.code).toBe(-32602);
  });

  it('makes the to-do changes the chat agent may make', async () => {
    const made = await call('panel_todo_action', { action: { action: 'createList', name: 'Z Hermesa' } });
    expect(made.isError).toBeUndefined();
    expect(JSON.parse(made.content[0].text)).toMatchObject({ ok: true });
    expect((await call('panel_todos', { list: 'Z Hermesa' })).content[0].text).toContain('Z Hermesa');
  });

  it('makes and keeps its token outside the repository', async () => {
    const token = mcpToken({}, dir);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(mcpToken({}, dir)).toBe(token);
    expect((await readFile(path.join(dir, 'mcp-token'), 'utf8')).trim()).toBe(token);
    expect(mcpToken({ DESK_MCP_TOKEN: 'b'.repeat(40) }, dir)).toBe('b'.repeat(40));
  });
});

describe('chat API with engines', () => {
  const origin = () => ({ Origin: base, 'Content-Type': 'application/json' });

  it('lists conversations with the engines and the preferred one', async () => {
    const list = await (await fetch(`${base}/api/chats`)).json() as any;
    expect(list).toEqual({ chats: [], engines: [{ engine: 'hermes', available: true }, { engine: 'agy', available: true }], engine: 'hermes' });
  });

  it('remembers the engine only for the panel’s own page', async () => {
    expect((await fetch(`${base}/api/chats/engine`, { method: 'PUT', body: '{"engine":"agy"}' })).status).toBe(403);
    expect((await fetch(`${base}/api/chats/engine`, { method: 'PUT', headers: origin(), body: '{"engine":"gpt"}' })).status).toBe(400);
    expect((await fetch(`${base}/api/chats/engine`, { method: 'PUT', headers: origin(), body: '{"engine":"agy"}' })).status).toBe(200);
    expect(((await (await fetch(`${base}/api/chats`)).json()) as any).engine).toBe('agy');
  });

  it('checks an approval before it reaches Hermes', async () => {
    const created = await (await fetch(`${base}/api/chats`, { method: 'POST', headers: origin(), body: JSON.stringify({ text: 'Cześć', engine: 'hermes' }) })).json() as { id: string };
    const url = `${base}/api/chats/${created.id}/approval`;
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: origin(), body: JSON.stringify({ approvalId: '../x', decision: 'approve' }) })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: origin(), body: JSON.stringify({ approvalId: 'ap_1', decision: 'maybe' }) })).status).toBe(400);
    const stale = await fetch(url, { method: 'POST', headers: origin(), body: JSON.stringify({ approvalId: 'ap_1', decision: 'approve' }) });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as any).error).toMatch(/zgod/);
    expect(mock.requests.some(r => r.path.endsWith('/approval'))).toBe(false);
  });

  it('says why a message did not go when Hermes is down', async () => {
    mock.setDown(true);
    const response = await fetch(`${base}/api/chats`, { method: 'POST', headers: origin(), body: JSON.stringify({ text: 'Cześć', engine: 'hermes' }) });
    expect(response.status).toBe(503);
    expect(((await response.json()) as any).error).toMatch(/Hermes jest niedostępny/);
  });
});
