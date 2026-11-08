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
  // The IDs of the threads a section/column selects, top level only (subthreads nest under their parent).
  const idsIn = async locator => locator.locator('.fl-list > .fl-row > .fl-row-line > .fl-id, .fl-card-top > .fl-id').allTextContents();
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
    await all.locator('.fl-subrows').waitFor();
    // Subthreads come in ID order under their parent, whatever the section sorts by.
    const kids = (await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND rodzic = DESK-1'))).threads.map(t => t.id);
    expect(await all.locator('.fl-subrows .fl-id').allTextContents()).toEqual(kids);
    expect(kids).toHaveLength(4);
  });

  // Part 2: the thread page. The window event is what the tile uses to ask Fila to open a thread.
  const openThread = async id => {
    await page.evaluate(thread => window.dispatchEvent(new CustomEvent('fila-open-thread', { detail: thread })), id);
    await page.getByLabel(new RegExp(`^Stan ${id}: `)).first().waitFor();
  };
  const thread = id => api(`api/fila/threads/${id}`);

  it('opens a thread by its ID, not its title; the browser Back and Forward walk through Fila', async () => {
    await page.getByRole('tab', { name: 'Przegląd' }).click();
    expect(await page.getByRole('button', { name: 'Wektor gubi kontekst po restarcie Hermesa' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Otwórz DESK-11' }).first().click();
    await page.getByRole('heading', { level: 1, name: /Wektor gubi kontekst/ }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Do przejrzenia' }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { level: 1, name: /Wektor gubi kontekst/ }).waitFor();
    await page.getByRole('button', { name: 'DeskPanel', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Do przejrzenia' }).waitFor();
  });

  it('shows the subthreads of a thread on the board, in lists and on kanban cards, and a branch back to the parent', async () => {
    await page.getByRole('tab', { name: 'Przegląd' }).click();
    // DESK-1 is selected by a query that asks for threads without a parent: its subthreads still show under it.
    const row = page.getByRole('region', { name: 'Do przejrzenia' }).locator('.fl-row', { has: page.getByRole('button', { name: 'Otwórz DESK-1', exact: true }) });
    await expect.poll(() => row.locator('.fl-subrows .fl-id').allTextContents()).toEqual(['DESK-2', 'DESK-3', 'DESK-4', 'DESK-5']);
    const card = page.getByRole('region', { name: 'Kolumna W realizacji' }).locator('.fl-card', { has: page.getByRole('button', { name: 'Otwórz DESK-1', exact: true }) });
    await expect.poll(() => card.locator('.fl-card-subs .fl-id').allTextContents()).toEqual(['DESK-2', 'DESK-3', 'DESK-4', 'DESK-5']);
    // Subthreads fold under the count, and their Stan changes there like anywhere.
    await row.getByRole('button', { name: /Podwątki DESK-1/ }).click();
    expect(await row.locator('.fl-subrows').count()).toBe(0);
    await row.getByRole('button', { name: /Podwątki DESK-1/ }).click();
    await row.locator('.fl-subrows').waitFor();
    // From a subthread the branch leads back to the parent.
    await row.getByRole('button', { name: 'Otwórz DESK-2' }).click();
    const branch = page.getByRole('navigation', { name: 'Gałąź wątku' });
    await branch.getByRole('button', { name: /^Rodzic DESK-1:/ }).click();
    await page.getByRole('heading', { level: 1, name: /Fila: tablice/ }).waitFor();
    expect(await page.getByRole('navigation', { name: 'Gałąź wątku' }).count()).toBe(0);
    await page.getByRole('button', { name: 'DeskPanel', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Do przejrzenia' }).waitFor();
  });

  it('edits title and description with the keyboard and keeps them in the history', async () => {
    await openThread('DESK-1');
    const editTitle = page.getByRole('button', { name: /^Zmień tytuł:/ });
    await editTitle.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Tytuł wątku').fill('Fila: tablice, wątek i kafelek Zadania');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Zmień tytuł: Fila: tablice, wątek/ }).waitFor();
    expect((await thread('DESK-1')).title).toBe('Fila: tablice, wątek i kafelek Zadania');
    await page.getByLabel('Zmień opis').click();
    await page.getByLabel('Opis wątku').fill('Nowy opis **pogrubiony**.');
    await page.getByRole('button', { name: 'Zapisz opis' }).click();
    await page.getByRole('region', { name: 'Opis' }).locator('strong').waitFor();
    expect((await thread('DESK-1')).description).toBe('Nowy opis **pogrubiony**.');
    await page.getByRole('region', { name: 'Aktywność' }).getByText(/Tytuł: Fila: tablice, sekcje i kafelek Zadania → Fila: tablice, wątek/).waitFor();
    // Escape gives the edit up and changes nothing.
    await page.getByRole('button', { name: /^Zmień tytuł:/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Tytuł wątku').fill('Nie zapisuj');
    await page.keyboard.press('Escape');
    expect((await thread('DESK-1')).title).toBe('Fila: tablice, wątek i kafelek Zadania');
  });

  it('changes Stan and Moduł, edits, adds and removes fields', async () => {
    await openThread('DESK-1');
    await page.getByLabel('Stan DESK-1: W realizacji').click();
    await page.getByRole('option', { name: 'Do sprawdzenia' }).click();
    await page.getByLabel('Stan DESK-1: Do sprawdzenia').first().waitFor();
    // Each edit waits for its result: an action sent at once would carry the old thread revision and be refused (409).
    await page.getByLabel('Moduł', { exact: true }).selectOption('Bank');
    await page.getByLabel('Moduł', { exact: true }).evaluate(el => el.value === 'Bank');
    await page.waitForFunction(async () => (await (await fetch('/api/fila/threads/DESK-1')).json()).module === 'Bank');
    await page.getByLabel('Koszt', { exact: true }).fill('5');
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => (await (await fetch('/api/fila/threads/DESK-1')).json()).fields.Koszt === 5);
    await page.getByLabel('Dodaj do pola Tagi').fill('#nowy');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Usuń nowy z pola Tagi' }).waitFor();
    await page.getByRole('button', { name: 'Usuń pole Kontakt' }).click();
    await page.getByRole('button', { name: 'Usuń pole Kontakt' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Pole', exact: true }).click();
    await page.getByLabel('Nazwa pola').fill('Priorytet');
    await page.getByLabel('Wartość', { exact: true }).fill('wysoki');
    await page.getByRole('button', { name: 'Dodaj pole' }).click();
    await page.getByLabel('Priorytet', { exact: true }).waitFor();
    await page.waitForFunction(async () => (await (await fetch('/api/fila/threads/DESK-1')).json()).fields.Koszt === 5);
    const { state, module, fields } = await thread('DESK-1');
    expect([state, module, fields.Koszt, fields.Priorytet, 'Kontakt' in fields, fields.Tagi]).toEqual(['Do sprawdzenia', 'Bank', 5, 'wysoki', false, ['etap-1', 'nowy']]);
    // A name that exists keeps its kind everywhere: Koszt is a number, so text is refused by the server and the page says so.
    await page.getByRole('button', { name: 'Pole', exact: true }).click();
    await page.getByLabel('Nazwa pola').fill('Koszt');
    await page.getByLabel('Wartość', { exact: true }).fill('abc');
    await page.getByRole('button', { name: 'Dodaj pole' }).click();
    await page.getByRole('alert').first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('Moduł', { exact: true }).selectOption('Fila');
    await page.getByLabel('Stan DESK-1: Do sprawdzenia').click();
    await page.getByRole('option', { name: 'W realizacji' }).click();
    await page.getByLabel('Stan DESK-1: W realizacji').first().waitFor();
  });

  it('sets and clears a parent; one level of subthreads is listed', async () => {
    await openThread('DESK-1');
    const subthreads = page.getByRole('region', { name: 'Podwątki' });
    await expect.poll(() => idsIn(subthreads)).toHaveLength(4);
    await openThread('DESK-7');
    await page.getByLabel('Działania wątku').click();
    await page.getByRole('menuitem', { name: 'Zmień rodzica…' }).click();
    await page.getByLabel('ID wątku-rodzica').fill('DESK-7');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    expect((await thread('DESK-7')).parent).toBe(null);
    await page.getByLabel('ID wątku-rodzica').fill('DESK-1');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByRole('button', { name: 'DESK-1', exact: true }).first().waitFor();
    expect((await thread('DESK-7')).parent).toBe('DESK-1');
    await openThread('DESK-1');
    await expect.poll(() => idsIn(subthreads)).toHaveLength(5);
    await openThread('DESK-7');
    await page.getByLabel('Działania wątku').click();
    await page.getByRole('menuitem', { name: 'Zmień rodzica…' }).click();
    await page.getByRole('button', { name: 'Usuń rodzica' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    expect((await thread('DESK-7')).parent).toBe(null);
  });

  it('moves a thread: a fitting Stan and Moduł stay, a Moduł that does not fit needs an explicit choice', async () => {
    // DESK-14 is a Notatka with no Moduł: nothing to choose.
    await openThread('DESK-14');
    await page.getByLabel('Działania wątku').click();
    await page.getByRole('menuitem', { name: 'Przenieś do projektu…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption('CEZA');
    await dialog.getByText(/pasują i zostają/).waitFor();
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByLabel(/^Stan CEZA-3: Pomysł/).first().waitFor();
    expect((await thread('CEZA-3')).fields['Dawne ID']).toEqual(['DESK-14']);
    expect((await fetch(new URL('api/fila/threads/DESK-14', fila.url), close)).status).toBe(404);
    // DESK-17 has the Moduł Fila, which TABU does not have: the dialog cannot save until a choice is made.
    await openThread('DESK-17');
    await page.getByLabel('Działania wątku').click();
    await page.getByRole('menuitem', { name: 'Przenieś do projektu…' }).click();
    await dialog.locator('select').first().selectOption('TABU');
    await dialog.getByText(/Moduł „Fila” nie jest w projekcie/).waitFor();
    expect(await dialog.getByRole('button', { name: 'Zapisz' }).isDisabled()).toBe(true);
    await dialog.locator('select').nth(1).selectOption('__none__');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByLabel(/^Stan TABU-3: /).first().waitFor();
    const moved = await thread('TABU-3');
    expect([moved.module, moved.fields['Dawne ID']]).toEqual([null, ['DESK-17']]);
    // Escape closes the dialog and gives focus back to the menu button that opened it.
    await page.getByLabel('Działania wątku').click();
    await page.getByRole('menuitem', { name: 'Zmień rodzica…' }).click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Działania wątku');
  });

  it('assigns another existing workflow, asking for a Stan when it does not fit', async () => {
    await openThread('CEZA-3');
    await page.getByLabel('Działania wątku').click();
    await page.getByRole('menuitem', { name: 'Zmień workflow…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption({ label: 'Czytanie' });
    await dialog.getByText(/Stan „Pomysł” nie istnieje w workflow „Czytanie”/).waitFor();
    expect(await dialog.getByRole('button', { name: 'Zapisz' }).isDisabled()).toBe(true);
    await dialog.locator('select').nth(1).selectOption('Do przeczytania');
    await dialog.getByRole('button', { name: 'Zapisz' }).click();
    await page.getByLabel('Stan CEZA-3: Do przeczytania').first().waitFor();
    const changed = await thread('CEZA-3');
    expect([changed.workflow.name, changed.state]).toEqual(['Czytanie', 'Do przeczytania']);
    // Definitions are the AI's: the page has no control to edit a workflow, its Stany or the Moduł list.
    expect(await page.getByRole('button', { name: /edytuj workflow|dodaj stan|dodaj moduł/i }).count()).toBe(0);
  });

  it('adds a comment, shows the history, and reads the Specyfikacja by revision without editing it', async () => {
    await openThread('DESK-1');
    await page.getByLabel('Komentarz', { exact: true }).fill('Strona wątku działa.');
    await page.getByRole('button', { name: 'Dodaj komentarz' }).click();
    await page.getByRole('region', { name: 'Aktywność' }).getByText('Strona wątku działa.').waitFor();
    expect((await thread('DESK-1')).history.at(-1)).toMatchObject({ kind: 'comment', text: 'Strona wątku działa.', by: 'user' });
    const spec = page.getByRole('region', { name: 'Specyfikacja' });
    await spec.getByText('Test przeglądarkowy każdej części.').waitFor();
    await spec.getByLabel('Rewizja specyfikacji').selectOption('1');
    await spec.getByText(/Tablice i kafelek./).waitFor();
    expect(await spec.locator('textarea, input').count()).toBe(0);
    expect(await spec.getByText(/tylko do odczytu/).isVisible()).toBe(true);
  });

  // Part 3: the project screen, new project and thread, the archive.
  const projectNav = name => page.getByRole('navigation', { name: 'Nawigacja Fili' }).getByRole('button', { name: new RegExp(`^${name} \\d+$`) });

  it('a board creates no thread; the project screen does, and opens on Pola i workflow with the archive beside it', async () => {
    await page.getByRole('button', { name: 'Tablica', exact: true }).waitFor().catch(() => {});
    await projectNav('DeskPanel').click();
    await page.getByRole('heading', { level: 1, name: /DeskPanel\s*DESK/ }).waitFor();
    // The first tab is Pola i workflow (D-077), read-only.
    expect(await page.getByRole('tab', { name: 'Pola i workflow' }).getAttribute('aria-selected')).toBe('true');
    const panel = page.getByRole('tabpanel', { name: 'Pola i workflow' });
    await panel.getByText('Praca', { exact: true }).waitFor();
    await panel.getByText('Czytanie', { exact: true }).waitFor();
    await panel.getByText('Koszt', { exact: true }).waitFor();
    for (const module of ['Wektor', 'Bank', 'Fila']) await panel.getByText(module, { exact: true }).waitFor();
    expect(await panel.locator('input, textarea, select, button').count()).toBe(0);
    const counts = (await api('api/fila')).projects.find(p => p.key === 'DESK').counts;
    const stats = await page.locator('.fl-stats dd').allTextContents();
    expect(stats.map(Number)).toEqual([counts.open, counts.closed, counts.archived]);
    // The board of the project has sections but no way to make a thread (D-072).
    await page.getByRole('button', { name: /^Tablica DeskPanel$/ }).click();
    await page.getByRole('heading', { name: 'DeskPanel', level: 1 }).waitFor();
    expect(await page.getByRole('button', { name: /Nowy wątek/ }).count()).toBe(0);
    await projectNav('DeskPanel').click();
    await page.getByRole('tab', { name: 'Archiwum' }).click();
    const archive = page.getByRole('tabpanel', { name: 'Archiwum' });
    await archive.getByText('Duplikat: zadania na pulpicie').waitFor();
    await archive.getByText('Stan zostaje: Pomysł').waitFor();
  });

  it('creates a project with a unique four-letter key and a thread with a type and a parent', async () => {
    await page.getByRole('button', { name: 'Nowy projekt' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nazwa', { exact: true }).fill('Prywatne');
    await dialog.getByLabel('Klucz projektu').fill('pry');
    expect(await dialog.getByLabel('Klucz projektu').inputValue()).toBe('PRY');
    expect(await dialog.getByRole('button', { name: 'Załóż projekt' }).isDisabled()).toBe(true);
    await dialog.getByLabel('Klucz projektu').fill('DESK');
    await dialog.getByRole('button', { name: 'Załóż projekt' }).click();
    await dialog.getByRole('alert').getByText(/DESK/).waitFor();
    await dialog.getByLabel('Klucz projektu').fill('PRYW');
    await dialog.getByRole('button', { name: 'Załóż projekt' }).click();
    await page.getByRole('heading', { level: 1, name: /Prywatne\s*PRYW/ }).waitFor();
    const created = (await api('api/fila')).projects.find(p => p.key === 'PRYW');
    expect([created.name, created.board !== null, created.counts]).toEqual(['Prywatne', true, { open: 0, closed: 0, archived: 0 }]);
    await projectNav('Prywatne').waitFor();

    await page.getByRole('button', { name: 'Nowy wątek' }).click();
    await dialog.getByLabel('Tytuł').fill('Wymienić filtr');
    await dialog.getByLabel('Typ', { exact: true }).selectOption('blad');
    await dialog.getByRole('button', { name: 'Utwórz' }).click();
    await page.getByLabel(/^Stan PRYW-1: /).first().waitFor();
    expect((await thread('PRYW-1')).type.key).toBe('blad');
    // A second one, a subthread of the first, made from the project screen of another project.
    await projectNav('Prywatne').click();
    await page.getByRole('button', { name: 'Nowy wątek' }).click();
    await dialog.getByLabel('Tytuł').fill('Kupić filtr');
    await dialog.getByLabel('Rodzic', { exact: true }).fill('PRYW-1');
    await dialog.getByRole('button', { name: 'Utwórz' }).click();
    await page.getByLabel(/^Stan PRYW-2: /).first().waitFor();
    expect((await thread('PRYW-2')).parent).toBe('PRYW-1');
    // A thread can be made for another project than the screen's; a refused parent keeps the dialog open.
    await projectNav('Prywatne').click();
    await page.getByRole('button', { name: 'Nowy wątek' }).click();
    await dialog.getByLabel('Tytuł').fill('Z projektu prywatnego do DeskPanelu');
    await dialog.getByLabel('Projekt', { exact: true }).selectOption('DESK');
    await dialog.getByLabel('Rodzic', { exact: true }).fill('DESK-999');
    await dialog.getByRole('button', { name: 'Utwórz' }).click();
    await dialog.getByRole('alert').waitFor();
    await dialog.getByLabel('Rodzic', { exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Utwórz' }).click();
    await page.getByLabel(/^Stan DESK-\d+: /).first().waitFor();
    const made = (await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK SORTUJ id malejąco'))).threads[0];
    expect([made.title, made.project]).toEqual(['Z projektu prywatnego do DeskPanelu', 'DESK']);
  });

  it('archives a thread without changing its Stan, restores it, and deletes for good only from the archive', async () => {
    await openThread('DESK-12');
    await page.getByLabel('Działania wątku').click();
    expect(await page.getByRole('menuitem', { name: /Usuń trwale/ }).count()).toBe(0);
    await page.getByRole('menuitem', { name: 'Archiwizuj' }).click();
    await page.getByRole('status').getByText(/zarchiwizowany/).waitFor();
    const archived = await thread('DESK-12');
    expect([archived.archived, archived.state]).toEqual([true, 'W realizacji']);
    expect((await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK'))).threads.map(t => t.id)).not.toContain('DESK-12');
    // It left the sections but sits in the archive of its project, with its Stan.
    await page.getByRole('button', { name: 'DeskPanel', exact: true }).first().click();
    await projectNav('DeskPanel').click();
    await page.getByRole('tab', { name: 'Archiwum' }).click();
    const archive = page.getByRole('tabpanel', { name: 'Archiwum' });
    await archive.getByText('Kafelek Zadania nie odświeża się po zmianie listy').waitFor();
    await archive.getByRole('button', { name: 'Przywróć DESK-12' }).click();
    await archive.getByText('Kafelek Zadania nie odświeża się po zmianie listy').waitFor({ state: 'detached' });
    const restored = await thread('DESK-12');
    expect([restored.archived, restored.state]).toEqual([false, 'W realizacji']);

    // Permanent deletion: from the archive of a project (with a confirmation) and from the page of an archived thread.
    for (const id of ['PRYW-1', 'PRYW-2']) { await openThread(id); await page.getByLabel('Działania wątku').click(); await page.getByRole('menuitem', { name: 'Archiwizuj' }).click(); await page.getByRole('status').waitFor(); }
    await projectNav('Prywatne').click();
    await page.getByRole('tab', { name: 'Archiwum' }).click();
    const own = page.getByRole('tabpanel', { name: 'Archiwum' });
    await own.getByRole('button', { name: 'Usuń trwale PRYW-1' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
    expect((await fetch(new URL('api/fila/threads/PRYW-1', fila.url), close)).status).toBe(200);
    await own.getByRole('button', { name: 'Usuń trwale PRYW-1' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń na zawsze' }).click();
    await own.getByText('PRYW-1', { exact: true }).waitFor({ state: 'detached' });
    expect((await fetch(new URL('api/fila/threads/PRYW-1', fila.url), close)).status).toBe(404);
    await own.getByRole('button', { name: 'Otwórz PRYW-2' }).click();
    await page.getByLabel(/^Stan PRYW-2: /).first().waitFor();
    await page.getByRole('status').getByRole('button', { name: 'Usuń trwale' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń na zawsze' }).click();
    await page.getByRole('heading', { level: 1, name: /Prywatne\s*PRYW/ }).waitFor();
    expect((await fetch(new URL('api/fila/threads/PRYW-2', fila.url), close)).status).toBe(404);
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
    expect(await idsIn(tab.getByRole('region', { name: 'Zadania' }))).toEqual(expected);
    await tab.getByRole('region', { name: 'Zadania' }).getByLabel('Stan DESK-8: Pomysł').click();
    await tab.getByRole('option', { name: 'Do sprawdzenia' }).click();
    await tab.getByLabel('Stan DESK-8: Do sprawdzenia').waitFor();
    // A title opens the thread page in Fila.
    await tab.getByRole('region', { name: 'Zadania' }).getByRole('button', { name: 'Otwórz DESK-8' }).click();
    await tab.getByRole('heading', { level: 1, name: 'Widget pogody' }).waitFor();
    await tab.close();
    expect((await api('api/fila/query?q=' + encodeURIComponent('projekt = DESK AND stan = "Do sprawdzenia"'))).threads.map(t => t.id)).toContain('DESK-8');
  });
});
