import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { launchChromium, startScenario } from './scenario-runtime.ts';

// Fila 1.5, part 1 (board, views, sections, tile) in a real browser on the isolated scenario store: never the service's data.
const close = { headers: { connection: 'close' } };

describe('Fila board and Zadania tile', () => {
  // Each step drives a real browser against a cold Vite; the 5 s default is for unit tests.
  vi.setConfig({ testTimeout: 240_000 });
  let fila, browser, page, cache;
  const api = async path => (await fetch(new URL(path, fila.url), close)).json();
  const section = name => page.getByRole('region', { name, exact: true });
  const idsIn = async locator => locator.locator('.fl-id').allTextContents();
  const queryIds = async q => (await api(`api/fila/query?q=${encodeURIComponent(q)}`)).threads.map(t => t.id);
  // The preview has a dependency cache of its own (a temporary directory): beside the other browser tests a shared one is
  // re-bundled under each of them (504 "Outdated Optimize Dep", two copies of React). A reload still covers the first bundling.
  const openFila = async () => {
    await page.goto(fila.url);
    const button = page.getByRole('button', { name: 'Otwórz Filę' });
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await button.waitFor({ timeout: 30_000 }).then(() => true, () => false)) break;
      await page.reload();
    }
    await button.click();
    await page.getByRole('heading', { name: 'Do przejrzenia' }).waitFor();
  };

  beforeAll(async () => {
    // A failing hook shows no detail in the check report, so say where it stopped.
    const seen = [];
    try {
      cache = mkdtempSync(join(tmpdir(), 'fila-ui-vite-'));
      fila = await startScenario(join(process.cwd(), 'scenarios', 'fila.json'), 'down', undefined, undefined, cache);
      browser = await launchChromium();
      page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      // A cold Vite needs ~12 s alone and far more beside just check (see designlab.test.mjs); a hang is still caught.
      page.on('pageerror', e => seen.push(`pageerror ${e.message.slice(0, 300)}`));
      page.on('console', m => { if (m.type() === 'error') seen.push(`console ${m.text().slice(0, 300)}`); });
      page.on('response', r => { if (r.status() >= 400) seen.push(`http ${r.status()} ${r.url()}`); });
      page.setDefaultTimeout(60_000); // beside just check (tests, types, build) a cold Vite needs minutes
      await openFila();
      page.setDefaultTimeout(45_000); // cold start is over: a step that waits longer is a failure
    } catch (error) {
      const body = await page?.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => 'n/a');
      throw new Error(`Fila preview did not start: ${error?.message}
Page problems: ${seen.join(' | ') || 'none'}
Page text: ${body}
URL: ${page?.url()}`);
    }
  }, 360_000);
  afterAll(async () => { await browser?.close(); await fila?.stop(); if (cache) rmSync(cache, { recursive: true, force: true }); }, 60_000);

  it('shows the API results in the API order, a thread in every section that selects it', async () => {
    const review = await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND otwarte AND rodzic brak SORTUJ stan, id'));
    expect(await idsIn(section('Do przejrzenia'))).toEqual(review.threads.map(t => t.id));
    expect(await idsIn(section('Pilne'))).toEqual(await queryIds('projekt = DESK AND otwarte AND tag = "pilne"'));
    // DESK-6 is a Funkcja without a parent, tagged pilne: the list, the kanban column and Pilne all show it.
    expect(await page.getByLabel('Stan DESK-6: Do przygotowania').count()).toBe(3);
    expect(await idsIn(page.getByRole('region', { name: 'Kolumna Do przygotowania' }))).toEqual(await queryIds('projekt = DESK AND typ = funkcja AND rodzic brak AND stan = "Do przygotowania"'));
  });

  it('changes a Stan from a list and refreshes every occurrence, with no checkbox', async () => {
    expect(await page.getByRole('checkbox').count()).toBe(0);
    await section('Pilne').getByLabel('Stan DESK-6: Do przygotowania').click();
    await page.getByRole('option', { name: 'W realizacji' }).click();
    await page.getByLabel('Stan DESK-6: W realizacji').first().waitFor();
    expect(await page.getByLabel('Stan DESK-6: W realizacji').count()).toBe(3);
    expect((await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND stan = "W realizacji"'))).threads.map(t => t.id)).toContain('DESK-6');
    expect(await idsIn(page.getByRole('region', { name: 'Kolumna W realizacji' }))).toContain('DESK-6');
    // A kanban card changes it too, and closing is the same choice (D-070).
    await page.getByRole('region', { name: 'Kolumna W realizacji' }).getByLabel('Stan DESK-6: W realizacji').click();
    await page.getByRole('option', { name: 'Zakończone' }).click();
    // Closed, it leaves every open section (the kanban has no closing column); it is not deleted.
    await page.getByLabel(/^Stan DESK-6:/).first().waitFor({ state: 'detached' });
    expect((await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND zamknięte'))).threads.find(t => t.id === 'DESK-6').state).toBe('Zakończone');
    // The page's own origin makes the action the user's (D-006): reopen it so the next steps see the data they expect.
    const reopened = await fetch(new URL('api/fila/action', fila.url), { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(fila.url).origin, connection: 'close' }, body: JSON.stringify({ action: 'updateThread', thread: 'DESK-6', state: 'Pomysł' }) });
    expect(reopened.status).toBe(200);
    await page.getByLabel('Stan DESK-6: Pomysł').first().waitFor({ timeout: 30_000 });
  });

  it('works from the keyboard: arrows and Enter choose, Escape closes and gives focus back', async () => {
    const trigger = section('Pilne').getByLabel('Stan DESK-11: Pomysł');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('listbox').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('listbox').waitFor({ state: 'detached' });
    expect(await trigger.evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByLabel('Stan DESK-11: Do przygotowania').first().waitFor();
    await page.getByLabel('Stan DESK-11: Do przygotowania').first().click();
    await page.getByRole('option', { name: 'Pomysł' }).click();
    await page.getByLabel('Stan DESK-11: Pomysł').first().waitFor();
  });

  it('shows the validator error for a section query and keeps a saved one after reopening', async () => {
    const pills = section('Pilne').getByRole('button', { name: /^Zapytanie:/ });
    await pills.click();
    const text = section('Pilne').getByLabel('Tekst zapytania');
    await text.fill('projekt = DESK AND xyz');
    await section('Pilne').getByRole('alert').getByText(/Nieznany filtr/).waitFor();
    expect(await section('Pilne').getByRole('button', { name: 'Zapisz zapytanie' }).isDisabled()).toBe(true);
    await text.fill('projekt = DESK AND otwarte AND tag = "pilne" SORTUJ id malejąco');
    await section('Pilne').getByRole('alert').waitFor({ state: 'detached' });
    await section('Pilne').getByRole('button', { name: 'Zapisz zapytanie' }).click();
    await page.getByRole('region', { name: 'Pilne' }).getByText('sortuj id malejąco').waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Otwórz Filę' }).click();
    await page.getByRole('heading', { name: 'Pilne' }).waitFor();
    expect(await idsIn(section('Pilne'))).toEqual(await queryIds('projekt = DESK AND otwarte AND tag = "pilne" SORTUJ id malejąco'));
    // A column query is checked like a section query.
    const column = page.getByRole('region', { name: 'Kolumna W realizacji' });
    await column.getByLabel('Kolumna W realizacji', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Zapytanie kolumny' }).click();
    await column.getByLabel('Tekst zapytania').fill('stan = ');
    await column.getByRole('alert').waitFor();
    await page.keyboard.press('Escape');
  });

  it('creates, renames, moves and deletes views and sections; the board history lists them', async () => {
    await page.getByRole('button', { name: 'Nowy widok' }).click();
    await page.getByLabel('Nazwa').fill('Probny');
    await page.getByRole('button', { name: 'Utwórz' }).click();
    await page.getByRole('tab', { name: 'Probny', selected: true }).waitFor();
    await page.getByLabel('Widok Probny').click();
    await page.getByRole('menuitem', { name: 'Zmień nazwę' }).click();
    await page.getByLabel('Nazwa').fill('Probny 2');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByRole('tab', { name: 'Probny 2' }).waitFor();
    // Escape closes a dialog and gives focus back to what opened it.
    await page.getByRole('button', { name: 'Dodaj sekcję' }).click();
    await page.getByRole('menuitem', { name: 'Kanban' }).click();
    await page.getByLabel('Nazwa').fill('Kanban probny');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await section('Kanban probny').waitFor();
    await page.getByLabel('Sekcja Kanban probny').click();
    await page.getByRole('menuitem', { name: 'Przesuń wyżej' }).click();
    await page.waitForFunction(() => document.querySelector('.fl-section')?.getAttribute('aria-label') === 'Kanban probny');
    await page.getByLabel('Sekcja Kanban probny').click();
    await page.getByRole('menuitem', { name: 'Dodaj kolumnę' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Sekcja Kanban probny');
    await page.getByLabel('Historia tablicy').click();
    await page.getByRole('complementary', { name: 'Historia tablicy' }).getByText(/utworzył sekcję „Kanban probny”/).waitFor();
    await page.getByLabel('Sekcja Kanban probny').click();
    await page.getByRole('menuitem', { name: 'Usuń sekcję' }).click();
    await page.getByRole('button', { name: 'Usuń sekcję' }).click();
    await section('Kanban probny').waitFor({ state: 'detached' });
    await page.getByLabel('Widok Probny 2').click();
    await page.getByRole('menuitem', { name: 'Usuń widok' }).click();
    await page.getByRole('button', { name: 'Usuń widok' }).click();
    await page.getByRole('tab', { name: 'Probny 2' }).waitFor({ state: 'detached' });
    // The last section of a view cannot go: the server refuses and the page says so.
    await page.getByRole('tab', { name: 'Wszystko' }).click();
    await page.getByLabel('Sekcja DeskPanel').click();
    await page.getByRole('menuitem', { name: 'Usuń sekcję' }).click();
    await page.getByRole('button', { name: 'Usuń sekcję' }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    await page.keyboard.press('Escape');
  });

  it('creates, renames and deletes a board', async () => {
    await page.getByRole('button', { name: 'Nowa tablica' }).click();
    await page.getByLabel('Nazwa').fill('Probna tablica');
    await page.getByRole('button', { name: 'Utwórz' }).click();
    await page.getByRole('heading', { name: 'Probna tablica' }).waitFor();
    await page.getByLabel('Tablica', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Zmień nazwę tablicy' }).click();
    await page.getByLabel('Nazwa').fill('Probna 2');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByRole('heading', { name: 'Probna 2' }).waitFor();
    await page.getByLabel('Tablica', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Usuń tablicę' }).click();
    await page.getByRole('button', { name: 'Usuń tablicę' }).click();
    await page.getByRole('heading', { name: 'Probna 2', level: 1 }).waitFor({ state: 'detached' });
    expect((await api('api/fila')).boards.map(b => b.name)).not.toContain('Probna 2');
  });

  it('shows one level of subthreads under the parent with its closed count', async () => {
    await page.getByRole('tab', { name: 'Wszystko' }).click();
    const all = section('DeskPanel');
    await all.getByRole('button', { name: /Podwątki DESK-1: 1 z 4/ }).waitFor();
    expect(await all.locator('.fl-subrows').count()).toBe(0);
    await all.getByRole('button', { name: /Podwątki DESK-1/ }).click();
    // In the order of the section's query (this view sorts by ID, descending).
    const kids = (await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND rodzic = DESK-1 SORTUJ id malejąco'))).threads.map(t => t.id);
    expect(await idsIn(all.locator('.fl-subrows'))).toEqual(kids);
    expect(kids).toHaveLength(4);
  });

  it('the Zadania tile asks for a query, keeps it after reopening and changes Stan like the board', async () => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    tab.setDefaultTimeout(90_000);
    await tab.addInitScript(() => { if (localStorage.getItem('desk-panel.workspace') === null) localStorage.setItem('desk-panel.workspace', JSON.stringify({ version: 1, tiles: [{ id: 'todo#1', kind: 'todo', c: 0, r: 0, w: 2, h: 2 }] })); });
    await tab.goto(fila.url);
    const tile = tab.getByRole('region', { name: 'Zadania' });
    await tile.getByText('Kafelek nie ma zapytania').waitFor();
    const field = tile.getByLabel('Zapytanie kafelka');
    await field.fill('projekt = DESK AND xyz');
    await tile.getByRole('alert').getByText(/Nieznany filtr/).waitFor();
    expect(await tile.getByRole('button', { name: 'Zapisz zapytanie' }).isDisabled()).toBe(true);
    const query = 'projekt = DESK AND otwarte AND typ IN (funkcja, blad) SORTUJ stan, id';
    await field.fill(query);
    await tile.getByRole('alert').waitFor({ state: 'detached' });
    await tile.getByRole('button', { name: 'Zapisz zapytanie' }).click();
    await tile.getByLabel(/^Stan DESK-/).first().waitFor();
    const expected = (await queryIds(query));
    expect(await idsIn(tile)).toEqual(expected);
    await tab.reload();
    await tab.getByRole('region', { name: 'Zadania' }).locator('.fl-id').first().waitFor();
    expect(await idsIn(tab.getByRole('region', { name: 'Zadania' }).locator('.fl-list'))).toEqual(expected);
    // No thread opens from here before the thread page (part 2).
    expect(await tab.getByRole('region', { name: 'Zadania' }).getByRole('link').count()).toBe(0);
    await tab.getByRole('region', { name: 'Zadania' }).getByLabel('Stan DESK-8: Pomysł').click();
    await tab.getByRole('option', { name: 'Do sprawdzenia' }).click();
    await tab.getByLabel('Stan DESK-8: Do sprawdzenia').waitFor();
    await tab.close();
    expect((await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND stan = "Do sprawdzenia"'))).threads.map(t => t.id)).toContain('DESK-8');
  });
});
