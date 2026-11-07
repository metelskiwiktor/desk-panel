// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

type Who = { origin?: string; token?: string };
const post = (base: string, body: unknown, who: Who) => fetch(`${base}/api/fila/action`, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(who.origin ? { Origin: who.origin } : {}), ...(who.token ? { Authorization: `Bearer ${who.token}` } : {}) },
});
const get = (base: string, path: string) => fetch(`${base}${path}`);

it('writes and reads the specification revisions over HTTP on a separate store: current, earlier, and the told-apart errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fila-spec-http-')); dirs.push(dir);
  const tokens = filaTokens(join(dir, 'home'));
  const file = join(dir, 'fila.json');
  const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), fila: createFilaStore({ file }) };
  const server = createPanelServer(sources, process.cwd(), undefined, undefined, { filaTokens: tokens }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const user: Who = { origin: base }, ai: Who = { token: tokens.codex };
  await post(base, { action: 'createProject', key: 'DESK', name: 'x' }, user);
  await post(base, { action: 'createThread', project: 'DESK', type: 'funkcja', title: 'F' }, user);
  await post(base, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'S' }, user);
  const setSpec = (thread: string, text: string, baseRevision: number, who: Who, extra: object = {}) => post(base, { action: 'setSpec', thread, text, baseRevision, ...extra }, who);
  expect((await setSpec('DESK-1', 'x', 0, user)).status).toBe(403);
  expect((await setSpec('DESK-1', 'x', 0, ai, { by: 'user' })).status).toBe(400);
  expect(await (await setSpec('DESK-1', 'pierwsza', 0, ai)).json()).toMatchObject({ ok: true, specRevision: 1 });
  expect(await (await setSpec('DESK-1', 'druga', 1, { token: tokens.wektor })).json()).toMatchObject({ specRevision: 2 });
  expect((await setSpec('DESK-1', 'trzecia', 1, ai)).status).toBe(409);
  expect(await (await get(base, '/api/fila/threads/DESK-1/spec')).json()).toMatchObject({ revision: 2, text: 'druga', by: 'wektor', latest: 2 });
  expect(await (await get(base, '/api/fila/threads/DESK-1/spec/1')).json()).toMatchObject({ revision: 1, text: 'pierwsza', by: 'codex', enabled: true });
  expect((await get(base, '/api/fila/threads/DESK-1/spec/3')).status).toBe(404);
  expect((await get(base, '/api/fila/threads/DESK-1/spec/0')).status).toBe(400);
  expect((await get(base, '/api/fila/threads/DESK-1/spec/abc')).status).toBe(400);
  expect((await get(base, '/api/fila/threads/DESK-2/spec')).status).toBe(404);
  expect((await get(base, '/api/fila/threads/DESK-9/spec')).status).toBe(404);
  expect(await (await get(base, '/api/fila/threads/DESK-1')).json()).toMatchObject({ spec: { enabled: true, revision: 2 } });
  // Remove and add back: the earlier revision stays readable, the current one returns.
  await post(base, { action: 'removeSpecField', thread: 'DESK-1' }, ai);
  expect((await get(base, '/api/fila/threads/DESK-1/spec')).status).toBe(404);
  expect((await get(base, '/api/fila/threads/DESK-1/spec/1').then(r => r.json())).text).toBe('pierwsza');
  await post(base, { action: 'addSpecField', thread: 'DESK-1' }, ai);
  expect((await get(base, '/api/fila/threads/DESK-1/spec').then(r => r.json())).text).toBe('druga');
  // The largest text fits in the body even when JSON escapes every character to six bytes.
  expect((await setSpec('DESK-1', '\u0001'.repeat(50_000), 2, ai)).status).toBe(200);
  expect((await setSpec('DESK-1', 'x'.repeat(50_001), 3, ai)).status).toBe(400);
  expect(JSON.parse(readFileSync(file, 'utf8')).data.threads[0].spec.revisions).toHaveLength(3);
});
