import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { launchChromium, startScenario } from './scenario-runtime.ts';

// Without it the kept-alive test sockets hold the stop of the preview.
const close = { headers: { connection: 'close' } };

describe('DesignLab preview', () => {
  let preview, browser;
  afterAll(async () => { await browser?.close(); await preview?.stop(); }, 60_000);
  it('is switched on by the scenario preview and reads scenario sources', async () => {
    preview = await startScenario(join(process.cwd(), 'scenarios', 'standard.json'), 'down');
    const env = await (await fetch(new URL('@vite/env', preview.url), close)).text();
    expect(env).toMatch(/__DESIGNLAB__["']?\s*[:=]\s*true/);
    const cezar = await (await fetch(new URL('api/cezar', preview.url), close)).json();
    expect(cezar.tasks.length).toBeGreaterThan(0);
    const mockup = await fetch(new URL('src/designlab/mockups/demo.tsx', preview.url), close);
    expect(mockup.status).toBe(200);
  }, 120_000);

  it('moves between the Fila views without reloading the document', async () => {
    const fila = await startScenario(join(process.cwd(), 'scenarios', 'fila.json'), 'down');
    try {
      browser = await launchChromium();
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      // A cold Vite (module transforms, dependency optimization) needs ~12 s alone but 30 s and more while just check types,
      // scans and builds beside it (measured: page.goto and later clicks hit Playwright's 30 s default). A hang is still caught.
      page.setDefaultTimeout(90_000);
      // Rarely (about 1 in 12 runs) the board never appeared within 90 s; the cause was not caught, so a repeat names it.
      const seen = [], pending = new Set();
      page.on('pageerror', error => seen.push(`pageerror ${error.message.slice(0, 200)}`));
      page.on('response', response => { if (response.status() >= 400) seen.push(`http ${response.status()} ${response.url()}`); });
      page.on('request', request => pending.add(request.url()));
      page.on('requestfinished', request => pending.delete(request.url()));
      page.on('requestfailed', request => { pending.delete(request.url()); seen.push(`failed ${request.url()}`); });
      await page.goto(new URL('?designlab=fila', fila.url).href);
      await page.getByRole('heading', { name: 'Do przejrzenia' }).waitFor().catch(error => {
        throw new Error(`${error.message}\nBoard missing. Page problems: ${seen.join(' | ') || 'none'}. Requests still pending: ${[...pending].join(' | ') || 'none'}.`);
      });
      await page.evaluate(() => { window.__survives = true; });
      const alive = () => page.evaluate(() => window.__survives === true);
      const sections = () => page.locator('section.fila-section').evaluateAll(list => list.map(s => s.getAttribute('aria-label')));

      await page.getByLabel('Sekcja Do przejrzenia').click();
      await page.getByRole('menuitem', { name: 'Przesuń niżej' }).click();
      expect(await sections()).toEqual(['Funkcje', 'Do przejrzenia', 'Pilne']);

      await page.getByRole('link', { name: /Wektor gubi kontekst/ }).click();
      await page.waitForURL(/thread=DESK-32/);
      await page.getByLabel('Stan wątku: Pomysł').click();
      await page.getByRole('option', { name: 'Zakończone' }).click();
      await page.getByLabel('Stan wątku: Zakończone').waitFor();

      await page.getByRole('link', { name: /Tablica DeskPanel/ }).click();
      await page.waitForURL(url => !url.search.includes('thread'));
      expect(await sections()).toEqual(['Funkcje', 'Do przejrzenia', 'Pilne']);
      // Closed now, so the section query no longer picks it (in memory only).
      expect(await page.getByRole('region', { name: 'Do przejrzenia' }).getByText('Wektor gubi kontekst').count()).toBe(0);

      await page.getByRole('tab', { name: 'Wszystko' }).click();
      await page.waitForURL(/widok=wszystko/);
      await page.goBack();
      await page.getByRole('heading', { name: 'Do przejrzenia' }).waitFor();
      await page.getByRole('navigation').getByRole('link', { name: 'DeskPanel' }).last().click();
      await page.waitForURL(/project=DESK/);
      await page.getByRole('button', { name: 'Nowy wątek' }).click();
      await page.getByLabel('Tytuł').fill('Wymienić baterię w pilocie');
      await page.getByRole('button', { name: 'Utwórz' }).click();
      await page.waitForURL(/thread=DESK-54/);
      await page.getByRole('heading', { name: /Wymienić baterię w pilocie/ }).waitFor();
      expect(await alive()).toBe(true);

      const direct = await browser.newPage();
      await direct.goto(new URL('?designlab=fila&thread=DESK-32', fila.url).href);
      await direct.getByRole('heading', { name: /Wektor gubi kontekst wskazanego wątku/ }).waitFor();
    } finally { await fila.stop(); }
  }, 240_000);
});
