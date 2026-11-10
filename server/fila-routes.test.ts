// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPanelServer } from './app';
import { createFilaStore } from './fila';
import { filaTokens } from './fila-routes';
import { createScenarioSources } from './scenario';

const dirs: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => { for (const c of closers.splice(0)) c(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function serve(options: { allowedHost?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fila-http-')); dirs.push(dir);
  const tokens = filaTokens(join(dir, 'home'));
  const file = join(dir, 'fila.json');
  // The real store on its own file, over the scenario's other sources: nothing here touches the service's data.
  const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), fila: createFilaStore({ file }) };
  const server = createPanelServer(sources, process.cwd(), options.allowedHost, undefined, { filaTokens: tokens }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, tokens, file, dir };
}
type Who = { origin?: string; token?: string };
const post = (base: string, body: unknown, who: Who) => fetch(`${base}/api/fila/action`, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(who.origin ? { Origin: who.origin } : {}), ...(who.token ? { Authorization: `Bearer ${who.token}` } : {}) },
});
const get = (base: string, path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

it('walks project, thread, field and comment over HTTP on a separate store, with the author taken from the caller', async () => {
  const { base, tokens, file } = await serve();
  const user: Who = { origin: base }, ai: Who = { token: tokens['claude-code'] };
  expect((await post(base, { action: 'createProject', key: 'DESK', name: 'DeskPanel' }, user)).status).toBe(200);
  expect((await post(base, { action: 'setModules', project: 'DESK', modules: ['Wektor'] }, ai)).status).toBe(200);
  const made = await post(base, { action: 'createThread', project: 'DESK', type: 'blad', title: 'Wektor gubi kontekst', module: 'Wektor' }, ai);
  expect(await made.json()).toEqual({ ok: true, thread: { id: 'DESK-1', revision: 1 } });
  expect((await post(base, { action: 'setField', thread: 'DESK-1', field: 'Koszt', value: 3, kind: 'number' }, user)).status).toBe(200);
  expect((await post(base, { action: 'comment', thread: 'DESK-1', text: 'Reprodukowane' }, { origin: base, token: tokens.codex })).status).toBe(200);
  const thread = await (await get(base, '/api/fila/threads/DESK-1')).json();
  expect(thread).toMatchObject({ id: 'DESK-1', state: 'Pomysł', fields: { Tagi: [], Koszt: 3 }, createdBy: 'claude-code' });
  // Even with the panel's Origin, a token is the client: the author is never the user.
  expect(thread.history.map((h: { by: string; kind: string }) => `${h.by}:${h.kind}`)).toEqual(['claude-code:created', 'user:changed', 'codex:comment']);
  const registries = await (await get(base, '/api/fila')).json();
  expect(registries.projects[0]).toMatchObject({ key: 'DESK', modules: ['Wektor'], counts: { open: 1, closed: 0, archived: 0 } });
  // The data are in the file outside Git, readable only by the account; the existing lists still answer.
  expect(JSON.parse(readFileSync(file, 'utf8')).data.threads).toHaveLength(1);
  expect((await get(base, '/api/todos')).status).toBe(200);
  expect(statSync(file).isFile()).toBe(true);
});

it('refuses writes without the panel Origin or a valid token, and a bad token even on a read, without writing anything', async () => {
  const { base, tokens, file } = await serve();
  const body = { action: 'createProject', key: 'DESK', name: 'x' };
  expect((await post(base, body, {})).status).toBe(403);
  expect((await post(base, body, { origin: 'http://evil.example' })).status).toBe(403);
  expect((await post(base, body, { origin: base, token: 'zly' })).status).toBe(401);
  expect((await post(base, body, { token: `${tokens.wektor}x` })).status).toBe(401);
  expect((await get(base, '/api/fila', 'zly')).status).toBe(401);
  expect((await get(base, '/api/fila')).status).toBe(200);
  expect((await (await get(base, '/api/fila')).json()).projects).toEqual([]);
  expect(() => readFileSync(file)).toThrow();
});

it('enforces the roles: the AI neither deletes nor, as the user, edits definitions; the body cannot name an author', async () => {
  const { base, tokens } = await serve();
  const user: Who = { origin: base }, ai: Who = { token: tokens['claude-desktop'] };
  await post(base, { action: 'createProject', key: 'DESK', name: 'x' }, user);
  await post(base, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'S' }, user);
  const blocked = async (who: Who, body: unknown, status: number) => {
    const res = await post(base, body, who);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toEqual(expect.any(String));
  };
  await blocked(user, { action: 'setModules', project: 'DESK', modules: ['A'] }, 403);
  await blocked(user, { action: 'createWorkflow', name: 'N', states: [{ name: 'A', closing: false }] }, 403);
  await blocked(user, { action: 'updateWorkflow', workflow: 'w-praca', name: 'Inna' }, 403);
  await post(base, { action: 'archiveThread', thread: 'DESK-1' }, ai);
  await blocked(ai, { action: 'deleteThread', thread: 'DESK-1' }, 403);
  await blocked(ai, { action: 'comment', thread: 'DESK-1', text: 'x', by: 'user' }, 400);
  await blocked(user, { action: 'updateThread', thread: 'DESK-9', title: 'x' }, 404);
  expect((await get(base, '/api/fila/threads/DESK-1').then(r => r.json())).archived).toBe(true);
  expect((await post(base, { action: 'deleteThread', thread: 'DESK-1' }, user)).status).toBe(200);
  expect((await get(base, '/api/fila/threads/DESK-1')).status).toBe(404);
});

it('does not accept a token through the Tailscale name, and keeps the token file private and apart from every response', async () => {
  const { base, port, tokens, dir } = await serve({ allowedHost: 'panel.tail1.ts.net' });
  const through = (path: string, headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: 'panel.tail1.ts.net', ...headers } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject).end();
  });
  expect(await through('/api/fila', { Authorization: `Bearer ${tokens.codex}` })).toBe(403);
  expect(await through('/api/fila', {})).toBe(200);
  const everything = JSON.stringify([await (await get(base, '/api/fila')).json(), await (await post(base, { action: 'createProject', key: 'DESK', name: 'x' }, { token: tokens.codex })).json()]);
  for (const token of Object.values(tokens)) expect(everything).not.toContain(token);
  expect(Object.keys(tokens).sort()).toEqual(['antigravity', 'claude-code', 'claude-desktop', 'codex', 'wektor']);
  expect(new Set(Object.values(tokens)).size).toBe(5);
  expect(filaTokens(join(dir, 'home'))).toEqual(tokens); // stable across restarts
});

it('serves a scenario seed in memory only: the same contract, actions remembered for the session, no file written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fila-scn-')); dirs.push(dir);
  const file = join(dir, 'scenario.json');
  const seed = JSON.parse(readFileSync(join(process.cwd(), 'scenarios/standard.json'), 'utf8'));
  writeFileSync(file, JSON.stringify({ ...seed, fila: { projects: [{ key: 'DESK', name: 'DeskPanel', createdAt: 1, modules: ['Wektor'], nextNumber: 2 }], workflows: [{ id: 'w-praca', name: 'Praca', states: [{ name: 'Pomysł', closing: false }, { name: 'Zakończone', closing: true }] }], fieldDefs: [{ name: 'Tagi', kind: 'multi' }], threads: [{ uid: 'f-00000001', project: 'DESK', number: 1, type: 'sprawa', workflow: 'w-praca', state: 'Pomysł', title: 'Z scenariusza', description: '', parent: null, module: null, fields: {}, archived: false, revision: 1, createdAt: 1, updatedAt: 1, history: [] }] } }));
  const server = createPanelServer(createScenarioSources(file), process.cwd()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect((await (await get(base, '/api/fila/threads/DESK-1')).json()).title).toBe('Z scenariusza');
  expect((await post(base, { action: 'updateThread', thread: 'DESK-1', state: 'Zakończone' }, { origin: base })).status).toBe(200);
  expect((await (await get(base, '/api/fila/threads/DESK-1')).json()).closed).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('Pomysł');
});
