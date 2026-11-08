import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { readCutoverMode } from './fila-cutover-gate';
import { createFilaStore, defaultFilaData } from './fila';
import { createPanelServer } from './app';
import { createScenarioSources } from './scenario';
import { createRealSources } from './real-sources';

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'fila-gate-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('keeps the gate across reads and refuses malformed markers', () => {
  const dir = temp(), marker = join(dir, 'fila-cutover.json');
  expect(readCutoverMode(dir)).toBe('legacy');
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  writeFileSync(join(dir, 'fila.json'), 'fila');
  writeFileSync(join(dir, 'cockpit.json'), 'cockpit');
  writeFileSync(marker, JSON.stringify({ version: 1, state: 'locked', files: { 'fila.json': hash('fila'), 'cockpit.json': hash('cockpit') } }));
  expect(readCutoverMode(dir)).toBe('locked');
  expect(readCutoverMode(dir)).toBe('locked');
  writeFileSync(join(dir, 'fila.json'), 'partial');
  expect(() => readCutoverMode(dir)).toThrow();
  writeFileSync(marker, JSON.stringify({ version: 1, state: 'installing' }));
  expect(() => readCutoverMode(dir)).toThrow();
  writeFileSync(marker, '{');
  expect(() => readCutoverMode(dir)).toThrow();
});

it('does not expose the old store to internal callers in Fila mode', async () => {
  const sources = createRealSources({ port: 5174, cezarUrl: 'http://127.0.0.1:4321', calendarId: 'test@example.invalid', mailAccounts: [], env: {}, filaActive: true });
  await expect(sources.todos()).rejects.toMatchObject({ status: 404 });
  await expect(sources.todoAction({ action: 'createList', name: 'x' })).rejects.toMatchObject({ status: 404 });
});

it('does not move a damaged Fila store during read-only inspection', async () => {
  const dir = temp(), file = join(dir, 'fila.json');
  writeFileSync(file, '{');
  const fila = createFilaStore({ file, readOnly: true });
  await expect(fila.registries()).rejects.toThrow('Niepoprawny snapshot');
  expect(readFileSync(file, 'utf8')).toBe('{');
});

it('refuses store writes and a missing snapshot during inspection', async () => {
  const dir = temp(), file = join(dir, 'fila.json');
  await expect(createFilaStore({ file, readOnly: true }).registries()).rejects.toThrow('Nie można odczytać');
  const raw = JSON.stringify({ version: 1, data: defaultFilaData() });
  writeFileSync(file, raw);
  const fila = createFilaStore({ file, readOnly: true });
  await fila.registries();
  await expect(fila.apply({ action: 'createProject', key: 'TEST', name: 'Test' }, 'user')).rejects.toMatchObject({ status: 503 });
  await expect(fila.applyBatch([], 'codex')).rejects.toMatchObject({ status: 503 });
  expect(readFileSync(file, 'utf8')).toBe(raw);
});

it('refuses HTTP mutations, MCP and credential callbacks while locked', async () => {
  const sources = createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
  const server = createPanelServer(sources, process.cwd(), undefined, undefined, { cutoverLocked: true, wektorFila: true, mcpToken: 'test-token' }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const base = `http://127.0.0.1:${address.port}`;
    for (const path of ['/api/fila/action', '/api/fila/mcp', '/api/chats', '/api/todos/action']) {
      const response = await fetch(base + path, { method: 'POST', headers: { Origin: base }, body: '{}' });
      expect(response.status, path).toBe(503);
    }
    expect((await fetch(base + '/api/calendar/callback')).status).toBe(503);
    expect((await fetch(base + '/api/todos')).status).toBe(503);
    expect((await fetch(base + '/api/fila')).status).toBe(200);
    const mcp = (method: string) => fetch(base + '/api/mcp', { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) });
    const listing = await mcp('tools/list');
    expect(listing.status).toBe(200);
    const names = (await listing.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('fila_get'); expect(names).not.toContain('panel_todos');
    expect((await mcp('tools/call')).status).toBe(503);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it('retires old HTTP routes only in Fila mode', async () => {
  const sources = createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
  for (const filaMode of [false, true]) {
    const server = createPanelServer(sources, process.cwd(), undefined, undefined, { filaMode }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing address');
      const base = `http://127.0.0.1:${address.port}`;
      expect(await (await fetch(base + '/api/fila-mode')).json()).toEqual({ fila: filaMode, locked: false });
      expect((await fetch(base + '/api/todos')).status).toBe(filaMode ? 404 : 200);
      expect((await fetch(base + '/api/agent/todos')).status).toBe(filaMode ? 404 : 200);
      expect((await fetch(base + '/api/todos/action', { method: 'POST' })).status).toBe(filaMode ? 404 : 403);
      expect((await fetch(base + '/api/fila/threads/t-12345678')).status).toBe(404);
      expect((await fetch(base + '/api/fila/threads/t-12345678/spec')).status).toBe(404);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
});
