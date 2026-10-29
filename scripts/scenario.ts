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
import { PANEL_TOOLS } from '../server/panel-mcp';
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
// The cockpit of the live chat: dispatched runs are made up by the scenario, and GitHub answers from a stand-in.
const sources = createScenarioSources(file);
const chat = await createScenarioChat({ hermes: values.hermes === 'down' ? 'down' : 'up', toolScript: async message => {
  const fixture = loadScenario(file).appointment;
  if (!/wizyt|znanylekarz/i.test(message) || !('query' in fixture)) return;
  const args = fixture.query;
  const output = await PANEL_TOOLS.panel_znanylekarz.run(args, { sources, views: {}, now: Date.now(), cezarUrl: 'http://127.0.0.1:4321/' });
  return { tools: [{ name: 'mcp_desk-panel_panel_znanylekarz', args, output }], answer: 'Wybierz dzień i godzinę na karcie. To dane scenariusza; niczego nie rezerwujesz.' };
} });
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
        } else if (values.open === 'chat-appointment' || values.open === 'chat-appointment-selected' || values.open === 'chat-appointment-saved' || values.open === 'chat-appointment-axis') {
          await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
          try { await page.getByLabel('Wiadomość do agenta').fill('Pokaż terminy wizyty online', { timeout: 10_000 }); }
          catch (error) { await page.screenshot({ path: join(values.out, 'wizyty-failure.png'), fullPage: true, timeout: 5000 }); throw error; }
          await page.getByLabel('Wiadomość do agenta').press('Enter');
          const visit = page.getByRole('region', { name: 'Umów wizytę', exact: true });
          try { await visit.getByRole('button', { name: 'Wybieram termin', exact: true }).waitFor({ timeout: 20_000 }); }
          catch (error) { await page.screenshot({ path: join(values.out, 'wizyty-failure.png'), fullPage: true }); throw error; }
          await page.getByRole('button', { name: 'Zatrzymaj odpowiedź' }).waitFor({ state: 'detached', timeout: 20_000 });
          if (values.open === 'chat-appointment-axis') {
            const timeline = page.getByRole('region', { name: 'Terminy na tle kalendarza' });
            await timeline.getByRole('button', { name: '13:20 — kolizja', exact: true }).click();
            await timeline.getByText('Kolizja: Omówienie projektu', { exact: true }).waitFor();
            if (await visit.getByRole('button', { name: 'Wybieram 13:20', exact: true }).isDisabled()) throw new Error('Kolizja nie może zabraniać wyboru.');
            await timeline.getByRole('navigation', { name: 'Dzień wizyty' }).getByRole('button').nth(1).click();
            if (!await visit.getByRole('button', { name: 'Wybieram termin', exact: true }).isDisabled()) throw new Error('Zmiana dnia musi czyścić podgląd.');
            const tabs = page.getByRole('navigation', { name: 'Zawartość kokpitu' });
            await tabs.getByRole('button', { name: 'Cezar', exact: true }).click();
            await page.getByRole('region', { name: 'Aktywny task Cezara' }).waitFor();
            await tabs.getByRole('button').first().click();
            await timeline.getByRole('navigation', { name: 'Dzień wizyty' }).getByRole('button').first().click();
            await timeline.getByRole('button', { name: '13:20 — kolizja', exact: true }).click();
            await visit.scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(values.out, 'wizyty-axis-wide.png'), fullPage: true });
            // Resize the app's own window on a configured target screen, not a second invented device size.
            const dialog = page.getByRole('dialog', { name: 'Czat z agentem' });
            const box = await dialog.boundingBox(), grip = await page.getByTestId('chat-resize-handle').boundingBox();
            if (!box || !grip) throw new Error('Brak uchwytu zmiany rozmiaru.');
            await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
            await page.mouse.down();
            await page.mouse.move(grip.x + grip.width / 2 - (box.width - 480), grip.y + grip.height / 2, { steps: 12 });
            await page.mouse.up();
            await page.getByRole('tab', { name: 'Czat', exact: true }).waitFor();
            if ((await dialog.boundingBox())!.width > 550) throw new Error('Okno nie zostało zmniejszone do wąskiego układu.');
            await visit.getByRole('button', { name: 'Pokaż terminy i kalendarz', exact: true }).click();
            await timeline.getByRole('button', { name: '08:00', exact: true }).click();
            await page.screenshot({ path: join(values.out, 'wizyty-axis-narrow-calendar.png'), fullPage: true });
            await timeline.getByRole('button', { name: 'Przejdź do podsumowania', exact: true }).click();
            await visit.getByRole('button', { name: 'Wybieram 08:00', exact: true }).waitFor();
            const overflow = await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1);
            if (overflow) throw new Error('Wąskie okno ma poziome przepełnienie.');
          } else if (values.open !== 'chat-appointment') {
            await page.getByRole('region', { name: 'Terminy na tle kalendarza' }).getByRole('button', { name: '08:00', exact: true }).click();
            await visit.getByRole('button', { name: 'Wybieram 08:00', exact: true }).click();
            await visit.getByRole('link', { name: 'Otwórz ZnanyLekarz' }).waitFor();
            if (await visit.getByLabel('Godzina zakończenia').inputValue() !== '08:30') throw new Error('Czas wizyty nie został uzupełniony.');
            if (values.open === 'chat-appointment-saved') {
              await visit.getByRole('button', { name: 'Zarezerwowałem ten termin — zapisz', exact: true }).click();
              await visit.getByText('Zapisano w Google Calendar', { exact: true }).waitFor();
            }
          }
          await visit.scrollIntoViewIfNeeded();
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
          const layout = (tiles: { id: string; kind: string; c: number; r: number; w: number; h: number }[]) =>
            page.evaluate(value => localStorage.setItem('desk-panel.workspace', JSON.stringify({ version: 1, tiles: value })), tiles);
          const right = [
            { id: rightTop, kind: rightTop, c: 2, r: 0, w: 2, h: 1 },
            { id: rightBottom, kind: rightBottom, c: 2, r: 1, w: 2, h: 1 },
          ];
          // What the user can do first: the left half empty, its cells offer what can be placed.
          await layout(right);
          await page.reload();
          await page.waitForTimeout(800);
          const offered = await page.locator(`.wk-pick[data-pick="${tileKind}"]`).count() > 0;
          await layout([{ id: tileId, kind: tileKind, c: 0, r: 0, w: 2, h: 2 }, ...right]);
          await page.reload();
          await page.waitForTimeout(800);
          const rendered = await page.locator(`.wk-cell[data-kind="${tileKind}"]`).count();
          // A tile that shows but that no empty cell offers is one the user can never place (PR #36: github-pr was missing
          // from pickable() in src/workspace-kinds.ts). A tile that does not exist yet (before.png) falls back below.
          if (rendered > 0 && !offered) throw new Error(`--open tile:${tileKind}: the tile renders, but no empty cell offers it. Add "${tileKind}" to pickable() in src/workspace-kinds.ts.`);
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
