// Runs the real UI (Vite) against a scenario API, optionally taking Playwright screenshots.
//   npm run scenario -- standard                       → serve until Ctrl+C
//   npm run scenario -- offline --shot                 → output/screenshots/offline-*.png
//   npm run scenario -- standard --shot --query ambient=night   (first screen with a URL query, no page walk)
//   npm run scenario -- path/to/my.json --shot --pages pulpit,ustawienia --device medialove-14 --scale all
//   npm run scenario -- standard --shot --pages pulpit --open chat --hermes down   (the chat when Hermes is not running)
//   npm run scenario -- standard --shot --pages pulpit --open cockpit-approval     (the chat cockpit on its mock: cockpit,
//     cockpit-recon, cockpit-approval, cockpit-watch, cockpit-review; with --hermes down the mock starts without Hermes)
//   npm run scenario -- standard --shot --pages pulpit --open chat-dispatched     (the live chat on the Hermes stand-in:
//     chat-dispatch, chat-dispatched, chat-review; the run and its PR are made up by the scenario)
// The fixed bottom navigation is hidden in screenshots (a full-page shot would pin it over the content); --nav keeps it.
// Screens come from devices.json: --device <id>|all (default: the first one), --scale <factor>|primary|all.
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { createPanelServer } from '../server/app';
import { createCockpit } from '../server/cockpit';
import { createScenarioSources, loadScenario, SCENARIO_PR } from '../server/scenario';
import { createScenarioChat } from '../server/scenario-chat';
import { devices, viewportsOf, type Viewport } from '../src/devices';

const PAGES = { pulpit: 'Pulpit', zadania: 'Zadania', kalendarz: 'Kalendarz', system: 'System', zdarzenia: 'Zdarzenia', ustawienia: 'Ustawienia' } as const;
type PageName = keyof typeof PAGES;

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  shot: { type: 'boolean', default: false },
  pages: { type: 'string', default: Object.keys(PAGES).join(',') },
  device: { type: 'string', default: Object.keys(devices)[0] },
  scale: { type: 'string', default: 'primary' },
  out: { type: 'string', default: 'output/screenshots' },
  nav: { type: 'boolean', default: false },
  query: { type: 'string' },
  open: { type: 'string' },
  file: { type: 'string' },
  hermes: { type: 'string', default: 'up' },
} });
const name = positionals[0] ?? 'standard';
const file = name.endsWith('.json') ? resolve(name) : join(process.cwd(), 'scenarios', `${name}.json`);
const label = name.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
try { loadScenario(file); } catch (error) { console.error((error as Error).message); process.exit(1); }

// The chat answers from a script (no agy, no Hermes, no limit spent), so it can be tried and photographed.
// `--hermes down` shows the chat as it is when Hermes is not running.
const chat = await createScenarioChat({ hermes: values.hermes === 'down' ? 'down' : 'up' });
// The cockpit of the live chat: dispatched runs are made up by the scenario, and GitHub answers from a stand-in.
const sources = createScenarioSources(file);
let checksAsked = 0;
const cockpit = createCockpit({
  sources, file: join(mkdtempSync(join(tmpdir(), 'desk-panel-cockpit-')), 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/',
  gh: async () => JSON.stringify({ number: 42, title: 'Chip statusu taska w kokpicie', state: 'OPEN', headRefName: 'cez/00000000', url: SCENARIO_PR,
    statusCheckRollup: ['test', 'typecheck', 'build'].map((name, i) => ({ name, status: checksAsked++ > 2 + i ? 'COMPLETED' : 'IN_PROGRESS', conclusion: checksAsked > 3 + i ? 'SUCCESS' : '' })) }),
});
const api = createPanelServer(sources, join(process.cwd(), 'dist'), undefined, chat, { cockpit }).listen(0, '127.0.0.1');
await new Promise(done => api.once('listening', done));
// Read by vite.config.ts, so it must be set before Vite loads the config.
process.env.DESK_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
const { createServer } = await import('vite');
const vite = await createServer({ server: { port: 5180 }, logLevel: 'warn' });
await vite.listen();
const url = vite.resolvedUrls!.local[0];
async function stop() { await vite.close(); api.closeAllConnections(); api.close(); chat.dispose(); }

if (!values.shot) {
  console.log(`Scenariusz ${label}: ${url}  (plik czytany przy każdym zapytaniu; Ctrl+C kończy)`);
  process.on('SIGINT', () => void stop().then(() => process.exit(0)));
} else {
  const pages = values.pages.split(',').map(p => p.trim()) as PageName[];
  const unknown = pages.filter(p => !(p in PAGES));
  if (unknown.length) { console.error(`Nieznane strony: ${unknown.join(', ')}. Dostępne: ${Object.keys(PAGES).join(', ')}`); process.exit(1); }
  const targets = selectViewports(values.device, values.scale);
  mkdirSync(values.out, { recursive: true });
  const browser = await launchChromium();
  try {
    for (const target of targets) {
      // Same model as DevTools device mode: CSS viewport × Windows scaling, so images are physical-resolution.
      const page = await browser.newPage({ viewport: { width: target.width, height: target.height }, deviceScaleFactor: target.scale, hasTouch: target.device.touch });
      page.on('pageerror', error => console.error(`Błąd strony: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') console.error(`Konsola: ${message.text()}`); });
      // The cockpit modes run the window's own mock (`?cockpit=mock`), fast, instead of the scenario chat.
      const cockpit = values.open?.startsWith('cockpit') ? `cockpit=mock&cockpitSpeed=0.3${values.hermes === 'down' ? '&hermes=down' : ''}` : null;
      const query = [cockpit, values.query].filter(Boolean).join('&');
      await page.goto(query ? `${url}?${query}` : url);
      await page.waitForTimeout(1500);
      if (values.query && !cockpit) {
        // A query (e.g. ambient=night) changes what the first screen is; there is no navigation to walk through.
        const path = values.file ? resolve(values.file) : join(values.out, `${label}-${values.query.replace(/[^a-z0-9]+/gi, '-')}-${target.label}.png`);
        if (values.file) mkdirSync(dirname(path), { recursive: true });
        await page.screenshot({ path, fullPage: true });
        console.log(path);
        await page.close();
        continue;
      }
      for (const pageName of pages) {
        // The navigation bar is hidden until something in it has focus (the dashboard itself is the navigation).
        const entry = page.getByRole('navigation').getByRole('button', { name: PAGES[pageName] });
        await entry.focus();
        await entry.click();
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(600);
        if (values.open === 'chat' || values.open === 'chat-wide') {
          await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
          await page.waitForTimeout(300);
        } else if (cockpit) {
          // The mock's flow: @Zaimplementuj zadanie → recon → approval card → Cezar watched → PR in review.
          await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
          const input = page.getByLabel('Wiadomość do agenta');
          if (values.open !== 'cockpit' && values.hermes !== 'down') {
            await input.fill('@zaimpl');
            await input.press('Enter');
            await input.fill('Dodaj chip statusu taska w nagłówku kokpitu');
            await input.press('Enter');
            if (values.open === 'cockpit-recon') await page.getByText('Rekonesans…').waitFor();
            else await page.getByRole('button', { name: 'Zleć na Cezarze' }).waitFor();
            if (values.open === 'cockpit-watch' || values.open === 'cockpit-review') {
              await page.getByRole('button', { name: 'Zleć na Cezarze' }).click();
              if (values.open === 'cockpit-watch') await page.getByText('Implementacja').waitFor();
              await page.waitForTimeout(values.open === 'cockpit-watch' ? 1200 : 0);
              if (values.open === 'cockpit-review') await page.getByText('Gotowe do przeglądu', { exact: false }).waitFor({ timeout: 20_000 });
            }
          } else if (values.hermes === 'down') await input.fill('@Zaimplementuj zadanie: chip statusu');
          await page.waitForTimeout(500);
        } else if (values.open === 'chat-dispatch' || values.open === 'chat-dispatched' || values.open === 'chat-review') {
          // The live chat with the Hermes stand-in: recon and dispatch cards, then the made-up Cezar run in the cockpit.
          await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
          const input = page.getByLabel('Wiadomość do agenta');
          await input.fill('@zaimpl');
          await input.press('Enter');
          await input.fill('Dodaj chip statusu taska w nagłówku kokpitu');
          await input.press('Enter');
          await page.getByRole('button', { name: 'Zleć na Cezarze' }).waitFor({ timeout: 20_000 });
          // The card is complete when the answer ends (Hermes streams tools without arguments).
          await page.getByRole('button', { name: 'Zatrzymaj odpowiedź' }).waitFor({ state: 'detached', timeout: 20_000 });
          await page.getByRole('region', { name: 'Zgoda na zlecenie taska' }).getByText('Task: Show the Cezar task status chip', { exact: false }).waitFor({ timeout: 10_000 });
          if (values.open !== 'chat-dispatch') {
            await page.getByRole('button', { name: 'Zleć na Cezarze' }).click();
            await page.getByText('poszedł do Cezara').waitFor();
            if (values.open === 'chat-review') await page.getByText('Task czeka na Twój przegląd.').waitFor({ timeout: 40_000 });
            else await page.waitForTimeout(6000);
          }
          await page.waitForTimeout(500);
        } else if (values.open === 'chat-answer' || values.open === 'chat-approval') {
          // A Hermes turn of the stand-in: an answer with a tool step, or one waiting for the user's approval.
          await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
          await page.getByLabel('Wiadomość do agenta').fill(values.open === 'chat-approval' ? 'Pokaż procesy, potrzebna zgoda na polecenie' : 'Co mam dziś do zrobienia?');
          await page.getByLabel('Wiadomość do agenta').press('Enter');
          if (values.open === 'chat-approval') await page.getByRole('button', { name: 'Zezwól' }).waitFor();
          else {
            await page.getByRole('button', { name: 'Zatrzymaj odpowiedź' }).waitFor();
            await page.getByRole('button', { name: 'Zatrzymaj odpowiedź' }).waitFor({ state: 'detached', timeout: 20_000 });
          }
          await page.waitForTimeout(400);
        } else if (values.open?.startsWith('tile:')) {
          const tileKind = values.open.slice('tile:'.length).trim();
          const tileId = tileKind === 'todo' ? 'todo#1' : tileKind;
          const rightTop = tileKind === 'mail' ? 'quota:Claude' : 'mail';
          const rightBottom = tileKind === 'cezar' ? 'quota:Codex' : 'cezar';
          await page.evaluate(({ id, kind, top, bottom }) => {
            localStorage.setItem('desk-panel.workspace', JSON.stringify({
              version: 1,
              tiles: [
                { id, kind, c: 0, r: 0, w: 2, h: 2 },
                { id: top, kind: top, c: 2, r: 0, w: 2, h: 1 },
                { id: bottom, kind: bottom, c: 2, r: 1, w: 2, h: 1 },
              ],
            }));
          }, { id: tileId, kind: tileKind, top: rightTop, bottom: rightBottom });
          await page.reload();
          await page.waitForTimeout(800);
          const rendered = await page.locator(`.wk-cell[data-kind="${tileKind}"]`).count();
          if (rendered === 0) {
            await page.evaluate(() => localStorage.removeItem('desk-panel.workspace'));
            await page.reload();
            await page.waitForTimeout(800);
          }
        } else if (values.open === 'mail') {
          await page.locator('.p2-mrow').first().click();
          await page.waitForTimeout(300);
        } else if (values.open === 'task' || values.open === 'cezar') {
          await page.locator('[data-ctx-kind="task"] button, .p2-trow').first().click();
          await page.waitForTimeout(300);
        } else if (values.open === 'event' || values.open === 'calendar') {
          await page.locator('[data-ctx-kind="event"] button, .p2-erow').first().click();
          await page.waitForTimeout(300);
        } else if (values.open === 'bank') {
          await page.locator('[data-ctx-kind="bank-tx"] button, .bank-tx-row button').first().click();
          await page.waitForTimeout(300);
        } else if (values.open) {
          await page.locator(values.open).first().click();
          await page.waitForTimeout(300);
        }
        const path = values.file ? resolve(values.file) : join(values.out, `${label}-${pageName}${cockpit ? `-${values.open}` : ''}-${target.label}.png`);
        if (values.file) mkdirSync(dirname(path), { recursive: true });
        const hidden = values.nav ? null : await page.addStyleTag({ content: 'nav { visibility: hidden !important; }' });
        await page.screenshot({ path, fullPage: true });
        await hidden?.evaluate(node => (node as Element).remove());
        console.log(path);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await stop();
  }
}

function selectViewports(device: string, scale: string): Viewport[] {
  const all = (device === 'all' ? Object.keys(devices) : [device]).flatMap(viewportsOf);
  if (scale === 'all') return all;
  if (scale === 'primary') return all.filter(v => v.primary);
  const chosen = all.filter(v => v.scale === Number(scale));
  if (!chosen.length) throw new Error(`Skalowanie ${scale} nie jest skonfigurowane dla ${device} w devices.json.`);
  return chosen;
}

/** Playwright's own Chromium, or a preinstalled one (DESK_CHROMIUM, cloud sandboxes). */
async function launchChromium(): Promise<Browser> {
  try { return await chromium.launch(); } catch (error) {
    const fallback = [process.env.DESK_CHROMIUM, '/opt/pw-browsers/chromium'].find(p => p && existsSync(p));
    if (!fallback) throw new Error(`Brak przeglądarki dla Playwrighta. Uruchom: npx playwright install chromium\n${(error as Error).message}`);
    return chromium.launch({ executablePath: fallback });
  }
}
