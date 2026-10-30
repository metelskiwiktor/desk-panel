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
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { devices } from '../src/devices';
import { launchChromium, selectViewports, startScenario } from './scenario-runtime';
import { screenshotPath, validateSingleScreenshot, withPageErrors } from './browser-checks';

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
const pages = values.pages.split(',').map(p => p.trim()) as PageName[];
const targets = selectViewports(values.device, values.scale);
const cockpitMock = values.open?.startsWith('cockpit');
if (values.shot) {
  const unknown = pages.filter(p => !(p in PAGES));
  if (unknown.length) throw new Error(`Nieznane strony: ${unknown.join(', ')}. Dostępne: ${Object.keys(PAGES).join(', ')}`);
  validateSingleScreenshot(values.file, targets.length, values.query && !cockpitMock ? 1 : pages.length);
}
const { url, stop } = await startScenario(file, values.hermes === 'down' ? 'down' : 'up');

if (!values.shot) {
  console.log(`Scenariusz ${label}: ${url}  (plik czytany przy każdym zapytaniu; Ctrl+C kończy)`);
  process.on('SIGINT', () => void stop().then(() => process.exit(0)));
  process.on('SIGTERM', () => void stop().then(() => process.exit(0)));
} else {
  mkdirSync(values.out, { recursive: true });
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    browser = await launchChromium();
    for (const target of targets) {
      // Same model as DevTools device mode: CSS viewport × Windows scaling, so images are physical-resolution.
      const page = await browser.newPage({ viewport: { width: target.width, height: target.height }, deviceScaleFactor: target.scale, hasTouch: target.device.touch });
      page.on('console', message => { if (message.type() === 'error') console.error(`Konsola: ${message.text()}`); });
      const shot = (pageName: string, stage?: string) => screenshotPath({ out: values.out, file: values.file, label, page: pageName, target: target.label, open: values.open, query: values.query, hermes: values.hermes, stage });
      try {
        await withPageErrors(page, async () => {
          // The cockpit modes run the window's own mock (`?cockpit=mock`), fast, instead of the scenario chat.
          const cockpit = values.open?.startsWith('cockpit') ? `cockpit=mock&cockpitSpeed=0.3${values.hermes === 'down' ? '&hermes=down' : ''}` : null;
          const query = [cockpit, values.query].filter(Boolean).join('&');
          await page.goto(query ? `${url}?${query}` : url);
          await page.waitForTimeout(1500);
          if (values.query && !cockpit) {
            // A query (e.g. ambient=night) changes what the first screen is; there is no navigation to walk through.
            const path = shot('pulpit');
            if (values.file) mkdirSync(dirname(path), { recursive: true });
            await page.screenshot({ path, fullPage: true });
            console.log(path);
            return;
          }
          for (const pageName of pages) {
            // The navigation bar is hidden until something in it has focus (the dashboard itself is the navigation).
            const entry = page.getByRole('navigation').getByRole('button', { name: PAGES[pageName] });
            await entry.focus();
            await entry.click();
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.waitForTimeout(600);
            if (values.open === 'chat' || values.open === 'chat-wide' || values.open === 'chat-compact' || values.open === 'chat-skills') {
              await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
              if (values.open === 'chat-compact') await page.getByRole('button', { name: 'Zminimalizuj czat' }).click();
              if (values.open === 'chat-skills') await page.getByLabel('Wiadomość do agenta').fill('@');
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
              catch (error) { await page.screenshot({ path: shot(pageName, 'failure'), fullPage: true, timeout: 5000 }); throw error; }
              await page.getByLabel('Wiadomość do agenta').press('Enter');
              const visit = page.getByRole('region', { name: 'Umów wizytę', exact: true });
              try { await visit.getByRole('button', { name: 'Wybieram termin', exact: true }).waitFor({ timeout: 20_000 }); }
              catch (error) { await page.screenshot({ path: shot(pageName, 'failure'), fullPage: true }); throw error; }
              await page.getByRole('button', { name: 'Zatrzymaj odpowiedź' }).waitFor({ state: 'detached', timeout: 20_000 });
              if (values.open === 'chat-appointment-axis') {
                const timeline = page.getByRole('region', { name: 'Terminy na tle kalendarza' });
                await timeline.getByRole('button', { name: '13:20 — kolizja', exact: true }).click();
                await timeline.getByText('Kolizja: Omówienie projektu', { exact: true }).waitFor();
                await timeline.getByRole('button', { name: 'Przejdź do podsumowania', exact: true }).click();
                await page.waitForFunction(() => document.activeElement?.hasAttribute('data-visit-summary-action'));
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
                await page.screenshot({ path: shot(pageName, 'axis-wide'), fullPage: true });
                // The compact view uses the same conversation and appointment workspace.
                await page.getByRole('button', { name: 'Zminimalizuj czat' }).click();
                const compact = page.getByRole('complementary', { name: 'Czat z agentem', exact: true });
                await page.getByRole('tab', { name: 'Czat', exact: true }).waitFor();
                await page.waitForFunction(() => document.querySelector('.wektor-shell')!.getBoundingClientRect().width <= 480);
                await visit.getByRole('button', { name: 'Pokaż terminy i kalendarz', exact: true }).click();
                await timeline.getByRole('button', { name: '08:00', exact: true }).click();
                await page.screenshot({ path: shot(pageName, 'axis-narrow-calendar'), fullPage: true });
                await timeline.getByRole('button', { name: 'Przejdź do podsumowania', exact: true }).click();
                await page.waitForFunction(() => document.activeElement?.hasAttribute('data-visit-summary-action'));
                await visit.getByRole('button', { name: 'Wybieram 08:00', exact: true }).waitFor();
                const overflow = await compact.evaluate(el => el.scrollWidth > el.clientWidth + 1);
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
            } else if ((values.open?.startsWith('tile:') || values.open === 'todo-dialog')) {
              const tileKind = values.open === 'todo-dialog' ? 'todo' : values.open!.slice('tile:'.length).trim();
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
              if (values.open === 'todo-dialog') {
                await page.locator('.todo-title').first().click();
                await page.getByRole('dialog', { name: 'Zadanie' }).waitFor();
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
            const path = shot(pageName);
            if (values.file) mkdirSync(dirname(path), { recursive: true });
            const hidden = values.nav ? null : await page.addStyleTag({ content: 'nav { visibility: hidden !important; }' });
            await page.screenshot({ path, fullPage: true });
            console.log(path);
            if (values.open === 'todo-dialog') {
              await page.getByRole('button', { name: 'Zapisz', exact: true }).scrollIntoViewIfNeeded();
              const historyPath = shot(pageName, 'history');
              await page.screenshot({ path: historyPath, fullPage: true });
              console.log(historyPath);
            }
            await hidden?.evaluate(node => (node as Element).remove());
          }
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    try { await browser?.close(); } finally { await stop(); }
  }
}
