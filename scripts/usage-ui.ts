// A real-browser run of the area measurement (t-01c8aa59, docs/uzycie.md) against a store of its own in a temporary directory.
// It never touches the service port or ~/.desk-panel; the scenario server gets this store only here.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { createUsageStore } from '../server/usage';
import { usageReport } from '../server/usage';
import { devices, viewportsOf } from '../src/devices';
import { launchChromium, startScenario } from './scenario-runtime';

const dir = mkdtempSync(join(tmpdir(), 'desk-panel-usage-ui-'));
const store = createUsageStore(dir);
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const screen = viewportsOf(Object.keys(devices)[0]).find(v => v.primary)!;

type Totals = Record<string, number>;
/** Milliseconds of every area (and of the main views) stored so far, by a readable name. */
async function totals(): Promise<{ areas: Totals; main: Totals; touched: Record<string, number>; untouchedMs: Totals }> {
  const report = usageReport(await store.rows('2000-01-01', '2100-01-01'), '2000-01-01', '2100-01-01', await store.areaRows('2000-01-01', '2100-01-01'));
  const areas: Totals = {}, main: Totals = {}, touched: Record<string, number> = {}, untouchedMs: Totals = {};
  for (const r of report.areaRows) {
    const name = [r.area, r.kind, r.chat, r.page].filter(Boolean).join('/');
    areas[name] = (areas[name] ?? 0) + r.ms;
    untouchedMs[name] = (untouchedMs[name] ?? 0) + r.noInteractionMs;
    touched[name] = (touched[name] ?? 0) + (r.maxAgeMs > 0 || r.noInteractionMs < r.ms ? 1 : 0);
  }
  for (const [name, t] of Object.entries(report.byView)) main[name] = t.ms;
  return { areas, main, touched, untouchedMs };
}
const diff = (after: Totals, before: Totals): Totals => Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => (v as number) !== 0));
const sum = (t: Totals, match: (name: string) => boolean) => Object.entries(t).filter(([k]) => match(k)).reduce((n, [, v]) => n + v, 0);

async function main() {
  const runtime = await startScenario(resolve('scenarios/standard.json'), 'up', store);
  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    const context: BrowserContext = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, timezoneId: 'Europe/Warsaw' });
    await context.addInitScript("try { if (!localStorage.getItem('desk-panel.zones')) localStorage.setItem('desk-panel.zones', JSON.stringify({ top: 'std', bottom: 'short' })); } catch (e) {}");
    const phase = async (name: string, work: (page: Page) => Promise<void>) => {
      const before = await totals();
      const page = await context.newPage();
      await page.goto(runtime.url);
      await page.locator('.wk-cell').first().waitFor();
      await sleep(1500);
      await work(page);
      await page.goto('about:blank'); // pagehide: the page sends what it has
      await page.close();
      await sleep(600);
      const after = await totals();
      const result = { areas: diff(after.areas, before.areas), main: diff(after.main, before.main), after };
      console.log(`\n${name}\n  areas: ${JSON.stringify(result.areas)}\n  main:  ${JSON.stringify(result.main)}`);
      return result;
    };

    // 1. Everything on the home page is exposed at once; the areas add up to far more than the page, which stays its own.
    const home = await phase('home, 7 s', async () => { await sleep(7000); });
    assert.ok(sum(home.areas, k => k.startsWith('tile/')) > 2 * home.main['page:home'], 'tiles measured in parallel');
    for (const area of ['clock/home', 'days/home', 'day-date/home']) assert.ok((home.areas[area] ?? 0) >= 4000, `${area} is exposed (${home.areas[area]})`);
    assert.ok(home.main['page:home'] >= 6000 && home.main['page:home'] <= 10_000, `main view time (${home.main['page:home']})`);

    // 2. A user's wheel turn over one tile is an interaction of that tile only.
    const touch = await phase('wheel over one tile', async page => {
      const tile = page.locator('[data-usage-area="tile"]').first();
      const box = (await tile.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(2500);
      await page.mouse.wheel(0, 5);
      await sleep(4000);
    });
    const touchedTiles = Object.keys(touch.areas).filter(k => k.startsWith('tile/') && touch.after.untouchedMs[k] < touch.after.areas[k]);
    assert.ok(touchedTiles.length >= 1, 'one tile has an interaction');
    const all = Object.keys(touch.areas).filter(k => k.startsWith('tile/'));
    assert.ok(touchedTiles.length < all.length, 'the other tiles have none');

    // 3. A full chat covers the page: the tiles stop, the chat runs; closing it resumes them.
    const full = await phase('full chat, 3 s then 6 s', async page => {
      await sleep(1500);
      await page.locator('.chat-toggle-fab').click();
      await page.locator('.wektor-root[data-mode="window"] .wektor-shell').waitFor();
      await sleep(6000);
    });
    const tilesWithChat = sum(full.areas, k => k.startsWith('tile/')) / Math.max(1, Object.keys(full.areas).filter(k => k.startsWith('tile/')).length);
    assert.ok((full.areas['wektor/full/home'] ?? 0) >= 4500, `the chat is measured (${full.areas['wektor/full/home']})`);
    assert.ok(tilesWithChat <= 5500, `tiles paused under a full chat (${tilesWithChat} each over ~9 s)`);
    assert.equal(full.main['chat'] >= 4500, true, 'the main view is the chat');

    // 4. A compact chat covers only its side: the chat runs and the tiles outside it go on.
    const compact = await phase('compact chat, 7 s', async page => {
      await page.locator('.chat-toggle-fab').click();
      await page.getByRole('button', { name: 'Zminimalizuj czat' }).click();
      await page.locator('.wektor-root[data-mode="compact"] .wektor-shell').waitFor();
      await sleep(6000);
    });
    assert.ok((compact.areas['wektor/compact/home'] ?? 0) >= 4500, 'compact chat is measured');
    assert.ok(Object.entries(compact.areas).some(([k, v]) => k.startsWith('tile/') && v >= 5500), 'a tile outside the compact chat goes on');

    // 5. A hidden tab measures nothing at all.
    const hidden = await phase('hidden tab, 5 s of 8', async page => {
      await sleep(1500);
      await page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))");
      await sleep(5000);
      await page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))");
      await sleep(1500);
    });
    assert.ok((hidden.areas['clock/home'] ?? 0) <= 6000, `no time while hidden (${hidden.areas['clock/home']})`);

    // 6. A month folds the work area away: its tiles stop, the calendar zone grows.
    const month = await phase('month, 7 s', async page => {
      await page.evaluate("localStorage.setItem('desk-panel.zones', JSON.stringify({ top: 'std', bottom: 'month' }))");
      await page.reload();
      await sleep(7000);
      await page.evaluate("localStorage.setItem('desk-panel.zones', JSON.stringify({ top: 'std', bottom: 'short' }))");
    });
    const tileMax = Math.max(...Object.entries(month.areas).filter(([k]) => k.startsWith('tile/')).map(([, v]) => v));
    assert.ok(tileMax <= 2500, `tiles folded away (${tileMax} of ~8500)`);
    assert.ok((month.areas['days/home'] ?? 0) >= 5000, 'the month zone is measured');

    // 7. A page that leaves the home screen: its content and the settings sections are areas; the tiles are gone.
    const settings = await phase('settings and tasks pages', async page => {
      await page.getByRole('button', { name: 'Otwórz ustawienia' }).click();
      await sleep(4000);
      await page.locator('.status-chip', { hasText: 'Cezar' }).click();
      await sleep(4000);
    });
    assert.ok(sum(settings.areas, k => k.startsWith('settings-') && k.endsWith('/settings')) >= 3000, 'settings sections are measured');
    assert.ok((settings.areas['page-tasks/tasks'] ?? 0) >= 3000, 'the tasks page content is measured');

    // 8. The vertical preview: only the part of the frame the host's scroll box shows is measured. Here the box has scrolled the
    //    top bar out of sight, so the top bar stops until the box is scrolled back; the host page under the preview is paused.
    const preview = await phase('vertical preview, 4 s scrolled, 4 s at the top', async page => {
      await page.getByRole('button', { name: 'Otwórz ustawienia' }).click();
      await sleep(1000);
      await page.getByRole('button', { name: 'Otwórz podgląd pionowy' }).click();
      await page.locator('iframe[title="Pionowy podgląd panelu"]').waitFor();
      await sleep(1500);
      await page.evaluate("document.querySelector('.device-preview-window').scrollTop = 120");
      await sleep(4000);
      await page.evaluate("document.querySelector('.device-preview-window').scrollTop = 0");
      await sleep(4000);
    });
    const middle = preview.areas['tile/mail/home'] ?? 0, days = preview.areas['days/home'] ?? 0, bar = preview.areas['clock/home'] ?? 0;
    // Scrolled by 120 px, the frame's top bar is above the box and its calendar strip is below it; the tiles in the middle stay in view.
    assert.ok(middle >= 9000, `tiles in view all the time (${middle})`);
    assert.ok(bar >= 3500 && bar <= middle - 2500, `the top bar is measured only while it is in the scroll box (${bar} of ${middle})`);
    assert.ok(days >= 3500 && days <= middle - 2500, `the lower strip is measured only while it is in the scroll box (${days} of ${middle})`);
    assert.ok((preview.areas['clock/settings'] ?? 0) <= 3500, 'the host page under the preview is paused');


    console.log('\nUsage UI run: all checks passed.');
  } finally {
    await browser?.close();
    await runtime.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
await main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
