import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentChat } from './agent-chat';
import { createPanelServer } from './app';
import { createChatHub } from './chat-hub';
import { createHermesClient } from './hermes-api';
import { createHermesChat } from './hermes-chat';
import { startMockHermes, type MockHermes } from './hermes-mock';
import { mcpToken, PANEL_TOOLS, unknownNames } from './panel-mcp';
import { createScenarioSources } from './scenario';

const TOKEN = 'a'.repeat(64);
/** An Executor Prompt in the skill's shape, every section present. */
const shaped = (task: string, criteria = '- [ ] x') => [
  `Task: ${task}`, 'Type: UI', 'Scenario for screenshots: standard', 'Relevant files (from recon):', '- src/App.tsx',
  'Live data (from panel tools):', '- none: the task shows no panel data', 'Acceptance criteria:', criteria, 'Notes for executor:', '- strictly',
].join('\n');
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
  // A chat log may still be flushing a line after the hub closes: retry instead of failing on ENOTEMPTY under load.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
    expect(await call('panel_cezar', { krok: 'verify' })).toMatchObject({ isError: true });
    expect(await call('panel_cezar', { id: 'desk-panel/x', krok: '../verify' })).toMatchObject({ isError: true });
    expect(await call('panel_todo_action', { action: { action: 'dropDatabase' } })).toMatchObject({ isError: true });
    const unknown = await (await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'bank_labels', arguments: {} } })).json() as any;
    expect(unknown.error.code).toBe(-32602);
  });

  it('has card tools that show things to the user and dispatch nothing themselves', async () => {
    const recon = await call('panel_recon_report', { files: [{ path: 'src/App.tsx', note: 'okno' }], kind: 'UI', scenario: 'standard', prompt: shaped('x') });
    expect(recon.isError).toBeUndefined();
    const id = /recon: (r-[0-9a-f]{12})/.exec(recon.content[0].text)![1];
    expect(await call('panel_recon_report', { files: [], kind: 'maybe', prompt: 'x' })).toMatchObject({ isError: true });
    const propose = await call('panel_cezar_propose', { title: 'Paski', prompt: shaped('x'), recon: id });
    expect(propose.content[0].text).toContain('zleca panel');
    const analysisRecon = await call('panel_recon_report', { files: [], kind: 'non-UI', prompt: shaped('analiza') });
    const proposeAnalysis = await call('panel_cezar_propose', { title: 'Analiza pasków', prompt: shaped('analiza'), workflow: 'analysis', recon: /recon: (r-[0-9a-f]{12})/.exec(analysisRecon.content[0].text)![1] });
    expect(proposeAnalysis.isError).toBeUndefined();
    // Only the two workflows the skill knows; anything else never reaches a card, let alone Cezar.
    expect(await call('panel_cezar_propose', { title: 'Paski', prompt: shaped('x'), recon: id, workflow: 'rm-rf' })).toMatchObject({ isError: true });
    expect(await call('panel_cezar_propose', { title: 'Paski', prompt: shaped('x'), recon: id, todoId: 'zadanie' })).toMatchObject({ isError: true });
    const watch = await call('panel_cezar_watch', { id: 'tabnote-poc-rn/7c1d9a02-aaaa-4bbb-8ccc-000000000001' });
    expect(JSON.parse(watch.content[0].text).task).toMatchObject({ id: 'tabnote-poc-rn/7c1d9a02-aaaa-4bbb-8ccc-000000000001', status: expect.any(String) });
    expect(await call('panel_cezar_watch', { id: 'desk-panel/00000000-0000-0000-0000-00000000dead' })).toMatchObject({ isError: true });
    expect(await call('panel_cezar_watch', { id: '../etc' })).toMatchObject({ isError: true });
    expect((await call('panel_cockpit_clear', {})).content[0].text).toContain('nie obserwuje');
    const listed = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).json() as any;
    // The cockpit tools describe themselves by the contract: what, when, and what follows.
    for (const name of ['panel_recon_report', 'panel_cezar_propose', 'panel_cezar_watch', 'panel_cockpit_clear']) {
      expect(listed.result.tools.find((t: { name: string }) => t.name === name).description).toMatch(/Kiedy: .* Skutek: /);
    }
  });

  it('takes a proposal only after its recon answered, and a recon only of files the repository has', async () => {
    // Sent in the same answer as the searches (gemini flash did, 21 calls at once): no recon id yet.
    const blind = await call('panel_cezar_propose', { title: 'Widget', prompt: shaped('w'), recon: 'r-000000000000' });
    expect(blind).toMatchObject({ isError: true });
    expect(blind.content[0].text).toContain('Najpierw wywołaj panel_recon_report');
    expect(await call('panel_cezar_propose', { title: 'Widget', prompt: shaped('w') })).toMatchObject({ isError: true });

    const guessed = await call('panel_recon_report', { files: [{ path: 'src/nonexistent-types.ts' }, { path: 'src/App.tsx' }], kind: 'UI', prompt: shaped('w') });
    expect(guessed).toMatchObject({ isError: true });
    expect(guessed.content[0].text).toContain('src/nonexistent-types.ts');
    expect(await call('panel_recon_report', { files: [{ path: '../secrets.txt', new: true }], kind: 'UI', prompt: shaped('w') })).toMatchObject({ isError: true });

    const recon = await call('panel_recon_report', { files: [{ path: 'src/App.tsx' }, { path: 'src/tiles/GitHubPrTile.tsx', new: true }], kind: 'UI', prompt: shaped('w') });
    expect(recon.isError).toBeUndefined();
    const id = /recon: (r-[0-9a-f]{12})/.exec(recon.content[0].text)![1];
    expect(await call('panel_cezar_propose', { title: 'Widget', prompt: shaped('inny'), recon: id })).toMatchObject({ isError: true });
    expect((await call('panel_cezar_propose', { title: 'Widget', prompt: shaped('w'), recon: id })).isError).toBeUndefined();
  });

  it('takes a recon only of names in backticks the repository has, or whose source the dispatcher gives', async () => {
    // Built here, so that no file of the repository (this one included) holds the made-up names.
    const madeUp = ['qz', 'nowhere', '5h'].join('-'), live = ['qz', 'live', 'weekly'].join('-');
    const prompt = shaped('w', `- [ ] \`splitFor()\` in \`src/quota-cards.ts\` reads \`${live}\` and \`${madeUp}\`.`);
    const refused = await call('panel_recon_report', { files: [{ path: 'src/quota-cards.ts' }], kind: 'UI', prompt });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.content[0].text).toContain(`\`${live}\`, \`${madeUp}\``);
    expect(refused.content[0].text).not.toMatch(/splitFor|quota-cards/);
    const declared = await call('panel_recon_report', { files: [{ path: 'src/quota-cards.ts' }], kind: 'UI', prompt, outside: [{ name: live, source: 'panel_quotas' }, { name: madeUp, source: 'nowa' }] });
    expect(declared.isError).toBeUndefined();
    // Without "Live data" (what the source has and lacks) an ask the source cannot meet became "when available".
    const bare = await call('panel_recon_report', { files: [], kind: 'UI', prompt: shaped('w').replace(/Live data[^]*?(?=Acceptance criteria:)/, '') });
    expect(bare).toMatchObject({ isError: true });
    expect(bare.content[0].text).toContain('brakuje sekcji: Live data');
    expect(unknownNames('`a` `x1` `5h` `Gemini Claude&GPT` `open: tile:quota`', 'Gemini Claude GPT open tile quota')).toEqual([]);
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
    // The turn is still answering: let it end, or its chat log writes into the directory the teardown removes.
    await vi.waitFor(async () => expect(((await (await fetch(`${base}/api/chats/${created.id}`)).json()) as any).running).toBe(false), { timeout: 5000, interval: 20 });
  });

  it('says why a message did not go when Hermes is down', async () => {
    mock.setDown(true);
    const response = await fetch(`${base}/api/chats`, { method: 'POST', headers: origin(), body: JSON.stringify({ text: 'Cześć', engine: 'hermes' }) });
    expect(response.status).toBe(503);
    expect(((await response.json()) as any).error).toMatch(/Hermes jest niedostępny/);
  });
});
