import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { launchChromium, startScenario } from './scenario-runtime.ts';

// Machina in Fila (DESK-84) in a real browser on the isolated scenario store: the list of automats is a Fila query over
// threads, and an automat's page is its thread page with the Machina kit. Never the service's data.
const close = { headers: { connection: 'close' } };

describe('automats through Fila', () => {
  vi.setConfig({ testTimeout: 240_000 });
  let fila, browser, page, cache;
  const api = async path => (await fetch(new URL(path, fila.url), close)).json();
  const kit = id => api(`api/fila/threads/${id}/machina`);
  const thread = id => api(`api/fila/threads/${id}`);
  const part = name => page.getByRole('region', { name: 'Zestaw Machiny' }).getByRole('region', { name, exact: true });
  const openMachina = async () => {
    await page.goto(fila.url);
    const button = page.getByRole('button', { name: 'Otwórz Filę' });
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await button.waitFor({ timeout: 30_000 }).then(() => true, () => false)) break;
      await page.reload();
    }
    await button.click();
    await page.getByRole('navigation', { name: 'Nawigacja Fili' }).getByRole('button', { name: 'Machina' }).first().click();
    await page.getByRole('heading', { name: 'Automaty' }).waitFor();
  };

  beforeAll(async () => {
    const seen = [];
    try {
      cache = mkdtempSync(join(tmpdir(), 'machina-fila-ui-vite-'));
      fila = await startScenario(join(process.cwd(), 'scenarios', 'machina-fila.json'), 'up', undefined, undefined, cache);
      browser = await launchChromium();
      page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', e => seen.push(`pageerror ${e.message.slice(0, 300)}`));
      page.on('console', m => { if (m.type() === 'error') seen.push(`console ${m.text().slice(0, 300)}`); });
      page.setDefaultTimeout(60_000);
      await openMachina();
      page.setDefaultTimeout(45_000);
    } catch (error) {
      const body = await page?.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => 'n/a');
      throw new Error(`Machina preview did not start: ${error?.message}\nPage problems: ${seen.join(' | ') || 'none'}\nPage text: ${body}\nURL: ${page?.url()}`);
    }
  }, 360_000);
  afterAll(async () => { await browser?.close(); await fila?.stop(); if (cache) rmSync(cache, { recursive: true, force: true }); }, 60_000);

  it('lists the automats as threads of the Fila query, without the ordinary thread of MACH, each Stan shown and not editable', async () => {
    const listed = (await api(`api/fila/query?q=${encodeURIComponent('projekt = MACH AND typ = automat')}`)).threads;
    expect(listed.map(t => [t.id, t.type.key, t.state])).toEqual([['MACH-1', 'automat', 'Aktywny'], ['MACH-2', 'automat', 'Zakończony'], ['MACH-3', 'automat', 'Czeka na kartę programu'], ['MACH-4', 'automat', 'Wstrzymany']]);
    const section = page.getByRole('region', { name: 'Automaty', exact: true });
    expect(await section.locator('.fl-list > .fl-row > .fl-row-line > .fl-id').allTextContents()).toEqual(['MACH-1', 'MACH-2', 'MACH-3', 'MACH-4']);
    // MACH-5 is a note in the same project: a thread of MACH, not an automat.
    expect((await thread('MACH-5')).type.key).toBe('notatka');
    expect(await section.getByText('Notatka o Machinie').count()).toBe(0);
    // The Stan is there to read; nothing opens a list of choices.
    const state = section.getByLabel('Stan MACH-1: Aktywny (ustawia Machina)');
    await state.waitFor();
    expect(await state.evaluate(node => node.tagName)).toBe('SPAN');
    expect(await section.getByRole('button', { name: /^Stan MACH-/ }).count()).toBe(0);
    await state.click();
    expect(await page.getByRole('listbox').count()).toBe(0);
  });

  it('opens the same thread from its ID, with the program, journal and conversations of that automat read by its ID', async () => {
    const data = await kit('MACH-1');
    await page.getByRole('button', { name: 'Otwórz MACH-1' }).first().click();
    await page.getByRole('heading', { level: 1, name: /Zapisy IRONMAN 70.3 Gdynia/ }).waitFor();
    expect((await thread('MACH-1')).uid).toBe(data.uid);
    const program = part('Program');
    await program.getByText('Wersja 1 z 1').waitFor();
    const current = data.program.content.versions[0];
    for (const block of current.blocks) await program.getByText(block.id, { exact: true }).waitFor();
    await program.getByText(current.blocks[0].url).waitFor();
    await program.getByText(/Zatwierdzony zakres: odczyt z ironman\.com/).waitFor();
    // The journal shows this automat's runs, the newest first, with what each block gave.
    const runs = data.journal.content.runs;
    expect(runs.map(run => run.state)).toEqual(['ok', 'ok', 'error', 'error']);
    expect(await part('Dziennik').locator('.fl-machina-list > li').count()).toBe(runs.length);
    await part('Dziennik').getByText(/Brak wycinka/).first().waitFor();
    await part('Dziennik').getByText(/Zapisy zamknięte/).first().waitFor();
    // A part without content says so.
    await part('Sytuacje').getByText(/^Brak treści:/).waitFor();
    // The conversation link opens the chat window on that conversation and sends nothing.
    const chatId = data.conversations.content.items[0].chatId;
    const before = await api(`api/chats/${chatId}`);
    expect(before.items[0]).toMatchObject({ role: 'user', automation: { source: 'machina', reason: 'projektowanie' } });
    await part('Rozmowy').getByRole('button', { name: 'Otwórz rozmowę: projektowanie' }).click();
    await page.locator('.chat-root:not([hidden]) .wektor-shell').getByText(/Rozmowa automatu MACH-1/).first().waitFor();
    expect((await api(`api/chats/${chatId}`)).items.length).toBe(before.items.length);
    expect(await kit('MACH-1')).toEqual(data);
  });

  it('keeps Moduł, Tagi, the purpose and comments editable, and the kit and the Stan untouched by them', async () => {
    await page.keyboard.press('Escape');
    if (!await page.getByRole('heading', { level: 1, name: /Zapisy IRONMAN/ }).isVisible().catch(() => false)) { await openMachina(); await page.getByRole('button', { name: 'Otwórz MACH-1' }).first().click(); }
    const before = await kit('MACH-1');
    await page.getByLabel('Moduł', { exact: true }).selectOption('Obsługa');
    await page.getByLabel('Dodaj do pola Tagi').fill('triathlon');
    await page.getByLabel('Dodaj do pola Tagi').press('Enter');
    await page.getByRole('button', { name: 'Zmień opis' }).click();
    await page.getByLabel('Opis wątku').fill('Cel: wiedzieć o otwarciu zapisów w ciągu godziny.');
    await page.getByRole('button', { name: 'Zapisz opis' }).click();
    await page.getByLabel('Komentarz').fill('Komentarz nie zmienia programu.');
    await page.getByRole('button', { name: 'Dodaj komentarz' }).click();
    await page.getByText('Komentarz nie zmienia programu.').waitFor();
    // Read again in the same scenario session: the thread changed, the kit and the Stan did not.
    await expect.poll(async () => (await thread('MACH-1')).description).toBe('Cel: wiedzieć o otwarciu zapisów w ciągu godziny.');
    const after = await thread('MACH-1');
    expect([after.module, after.fields.Tagi, after.state]).toEqual(['Obsługa', ['sport', 'triathlon'], 'Aktywny']);
    expect(after.history.at(-1)).toMatchObject({ kind: 'comment', by: 'user', text: 'Komentarz nie zmienia programu.' });
    expect(await kit('MACH-1')).toEqual(before);
    await page.reload();
    await page.getByRole('button', { name: 'Otwórz Filę' }).click();
    await page.getByRole('navigation', { name: 'Nawigacja Fili' }).getByRole('button', { name: 'Machina' }).first().click();
    await page.getByRole('button', { name: 'Otwórz MACH-1' }).first().click();
    await page.getByText('Cel: wiedzieć o otwarciu zapisów w ciągu godziny.').waitFor();
    await page.getByLabel('Stan MACH-1: Aktywny (ustawia Machina)').first().waitFor();
    // The thread's menu offers no move out of MACH, no other workflow and no archive while the automat is open.
    await page.getByRole('button', { name: 'Działania wątku' }).click();
    await page.getByRole('menuitem', { name: 'Zmień rodzica…' }).waitFor();
    for (const name of ['Przenieś do projektu…', 'Zmień workflow…', 'Archiwizuj']) expect(await page.getByRole('menuitem', { name }).count()).toBe(0);
    await page.keyboard.press('Escape');
  });

  it('says plainly that an automat without a program has no content yet, and lets a closed one be archived but a built-in one never deleted', async () => {
    await openMachina();
    await page.getByRole('button', { name: 'Otwórz MACH-3' }).first().click();
    await page.getByRole('heading', { level: 1, name: /Faktury OpenRouter/ }).waitFor();
    expect(await kit('MACH-3')).toMatchObject({ program: { available: false, content: null }, journal: { available: false, content: null } });
    for (const name of ['Program', 'Sytuacje', 'Dziennik', 'Rozmowy']) await part(name).getByText(/^Brak treści:/).waitFor();
    // MACH-2 is closed (Zakończony): it can be archived, and then deleted by the user together with its kit.
    await openMachina();
    await page.getByRole('button', { name: 'Otwórz MACH-2' }).first().click();
    await page.getByRole('button', { name: 'Działania wątku' }).click();
    await page.getByRole('menuitem', { name: 'Archiwizuj' }).click();
    await page.getByText(/Wątek jest zarchiwizowany/).waitFor();
    expect((await thread('MACH-2')).archived).toBe(true);
    await page.getByRole('button', { name: 'Usuń trwale' }).waitFor();
    // MACH-4 is built in: the server refuses to delete it and the page does not offer it.
    expect((await thread('MACH-4')).machina).toMatchObject({ builtIn: true });
    await openMachina();
    await page.getByRole('button', { name: 'Otwórz MACH-4' }).first().click();
    await page.getByText('tylko do odczytu · wbudowany').waitFor();
    await page.getByRole('button', { name: 'Działania wątku' }).click();
    for (const name of ['Archiwizuj', 'Usuń trwale…', 'Przenieś do projektu…']) expect(await page.getByRole('menuitem', { name }).count()).toBe(0);
  });
});
