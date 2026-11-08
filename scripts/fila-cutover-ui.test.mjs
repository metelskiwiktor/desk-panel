import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPanelServer } from '../server/app.ts';
import { createScenarioSources } from '../server/scenario.ts';
import { createHermesChat } from '../server/hermes-chat.ts';
import { createHermesClient } from '../server/hermes-api.ts';
import { startMockHermes } from '../server/hermes-mock.ts';
import { resolveFilaContext } from '../server/fila-context.ts';
import { launchChromium } from './scenario-runtime.ts';

describe('production Fila cutover in an isolated browser', () => {
  vi.setConfig({ testTimeout: 240_000 });
  let directory, server, browser, page, base, options, chat, mock, oldId;
  const key = 'desk-panel.workspace';
  const pulpits = JSON.stringify({ version: 1, items: [{ id: 'main', name: 'Główny' }], active: 'main' });
  const raw = JSON.stringify({ version: 1, tiles: [
    { id: 'todo#1', kind: 'todo', c: 0, r: 0, w: 2, h: 2, config: { list: 'l-00000001' } },
    { id: 'todo#2', kind: 'todo', c: 2, r: 0, w: 2, h: 2, config: { list: 'l-00000002' } },
  ] });
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'fila-production-ui-'));
    execFileSync(process.execPath, [join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', '--outDir', directory, '--emptyOutDir'], { cwd: process.cwd(), stdio: 'ignore', timeout: 180_000 });
    const sources = createScenarioSources(join(process.cwd(), 'scenarios/fila.json'));
    mock = await startMockHermes({ key: 'isolated-key', stepMs: 5 });
    const client = createHermesClient({ url: mock.url, key: 'isolated-key' });
    const old = createHermesChat({ dir: directory, client, retryMs: 20 });
    oldId = (await old.create({ text: 'Rozmowa przed przełączeniem' })).id;
    const deadline = Date.now() + 10_000;
    while ((await old.get(oldId)).running) {
      if (Date.now() > deadline) throw new Error('Dawna tura nie zakończyła się w atrapie.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await old.rename(oldId, 'Dawna rozmowa');
    await old.drain(); old.close();
    chat = createHermesChat({ dir: directory, client, fila: true, retryMs: 20, resolveContext: context => resolveFilaContext(context, sources.fila) });
    options = { filaMode: false, cutoverLocked: false };
    server = createPanelServer(sources, directory, undefined, chat, options).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(30_000);
    await page.addInitScript(({ key, pulpits, raw }) => {
      if (!localStorage.getItem('desk-panel.pulpits')) localStorage.setItem('desk-panel.pulpits', pulpits);
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
    }, { key, pulpits, raw });
  }, 240_000);
  afterAll(async () => { await browser?.close(); chat?.close(); await chat?.drain(); if (server) await new Promise(resolve => server.close(resolve)); await mock?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); }, 60_000);

  it('keeps lists in legacy, applies and restores two planned tiles during the lock, and retires the API when active', async () => {
    await page.goto(base);
    await expect.poll(async () => (await page.request.get(`${base}/api/todos`)).status()).toBe(200);
    await expect.poll(() => page.getByRole('button', { name: 'Otwórz Filę' }).count()).toBe(0);
    const snapshot = { version: 1, kind: 'desk-panel-pulpits', origin: base, pulpits, workspaces: [{ key, raw }], missingWorkspaces: [] };
    const rows = [
      { source: `kiosk / ${base} / ${key}`, tile: 'todo#1', query: 'projekt = DESK AND otwarte', settings: { showAgent: false } },
      { source: `kiosk / ${base} / ${key}`, tile: 'todo#2', query: 'projekt = DESK AND zamknięte', settings: { showAgent: false } },
    ];
    options.filaMode = true; options.cutoverLocked = true; options.cutoverKiosk = { snapshot, rows };
    await page.reload();
    await page.getByRole('button', { name: 'Otwórz ustawienia' }).click();
    await page.getByRole('button', { name: 'Zastosuj plan kiosku' }).click();
    await page.getByText('Zastosowano plan.', { exact: false }).waitFor();
    let layout = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    expect(layout.tiles.map(tile => tile.config.query)).toEqual(rows.map(row => row.query));
    await page.getByRole('button', { name: 'Odtwórz układ kiosku' }).click();
    await page.getByText('Odtworzono układ', { exact: false }).waitFor();
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
    await page.getByRole('button', { name: 'Zastosuj plan kiosku' }).click();
    await page.getByText('Zastosowano plan.', { exact: false }).waitFor();
    options.cutoverLocked = false;
    await page.goto(base);
    await page.getByRole('button', { name: 'Otwórz Filę' }).waitFor();
    await expect.poll(() => page.locator('.fl-tile').count()).toBe(2);
    layout = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    expect(layout.tiles.map(tile => tile.config.query)).toEqual(rows.map(row => row.query));
    expect((await page.request.get(`${base}/api/todos`)).status()).toBe(404);
    expect((await page.request.get(`${base}/api/agent/todos`)).status()).toBe(404);
    await page.getByRole('button', { name: 'Otwórz Filę' }).click();
    await page.locator('.fl-app').waitFor();
    await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
    const history = page.getByRole('button', { name: 'Pokaż rozmowy' });
    if (await history.getAttribute('aria-expanded') !== 'true') await history.click();
    await page.getByText('Dawna rozmowa', { exact: true }).click();
    await page.getByLabel('Wiadomość').fill('Dalszy ciąg');
    await page.getByRole('button', { name: 'Wyślij', exact: true }).click();
    await expect.poll(() => mock.requests.filter(request => request.method === 'POST' && request.path === '/v1/runs').length).toBe(2);
    const sent = mock.requests.filter(request => request.method === 'POST' && request.path === '/v1/runs').at(-1).body.input;
    expect(sent).toContain('fila_search');
    expect(sent).not.toContain('panel_todos');
  });
});
