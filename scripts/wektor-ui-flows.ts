import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright';
import type { ChatDetail } from '../src/chat-contract';
import { appointmentViewSchema } from '../src/appointment-contract';

export interface ConversationFixture { title: string; message: string; doctor: string }
export interface FlowContext {
  page: Page;
  url: string;
  latency: number;
  fixtures: ConversationFixture[];
  screenshot(stage: string): Promise<void>;
}
type Rect = { x: number; y: number; width: number; height: number };

/** Wait for geometry and ResizeObserver-driven autosizing, rather than sleeping through an assumed animation time. */
// Compile only this constant browser body outside tsx's transforms, which otherwise inject Node-only __name helpers.
const measureRect = new Function('element', `return new Promise((done, fail) => {
    let previous = '', stable = 0;
    const deadline = performance.now() + 5000;
    const sample = () => {
      const { x, y, width, height } = element.getBoundingClientRect(), value = { x, y, width, height }, key = JSON.stringify(value);
      stable = key === previous ? stable + 1 : 0; previous = key;
      if (stable >= 3 && width > 0 && height > 0) done(value);
      else if (performance.now() > deadline) fail(new Error('Układ nie ustabilizował się w 5 sekund.'));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })`) as (element: HTMLElement | SVGElement) => Promise<Rect>;
async function stableRect(locator: Locator): Promise<Rect> {
  return locator.evaluate(measureRect);
}

function sameRect(before: Rect, after: Rect, label: string) {
  for (const field of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(before[field] - after[field]) <= .5, `${label}: ${field} zmieniło się z ${before[field]} na ${after[field]}`);
}
const inputOf = (page: Page) => page.getByRole('combobox', { name: 'Wiadomość do agenta' });
const picking = (page: Page) => page.locator('body').evaluate(element => element.hasAttribute('data-picking'));
const toggle = (page: Page, altFirst = false) => page.keyboard.press(altFirst ? 'AltLeft+ControlLeft' : 'ControlLeft+AltLeft');

async function openNew(page: Page) {
  await page.getByRole('button', { name: 'Otwórz czat z agentem' }).click();
  await page.getByRole('dialog', { name: 'Czat z agentem' }).waitFor();
  await stableRect(page.locator('.wektor-shell'));
}

async function openConversation(page: Page, id: string) {
  const button = page.getByRole('button', { name: 'Pokaż rozmowy' });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.getByRole('textbox', { name: 'Szukaj rozmów' }).fill(id);
  await page.getByRole('tabpanel').locator('.wektor-history-item').click();
}

async function seedVisits({ page, url, fixtures }: FlowContext) {
  const chats = [];
  for (const fixture of fixtures) {
    const response = await page.request.post(`${url}api/chats`, { headers: { Origin: new URL(url).origin }, data: { text: fixture.message, engine: 'hermes' } });
    assert.equal(response.status(), 201, 'Nie udało się przygotować syntetycznej rozmowy.');
    const { id } = await response.json() as { id: string };
    const deadline = Date.now() + 20_000;
    while (true) {
      const read = await page.request.get(`${url}api/chats/${id}`);
      assert.ok(read.ok(), 'Nie udało się odczytać syntetycznej rozmowy.');
      const chat = await read.json() as ChatDetail;
      assert.equal(chat.engine, 'hermes');
      if (!chat.running && chat.items.some(m => m.parts?.some(p => p.type === 'tool' && p.name.includes('panel_znanylekarz')))) break;
      assert.ok(Date.now() < deadline, 'Atrapa Hermesa nie zakończyła odpowiedzi.');
      await new Promise(done => setTimeout(done, 50));
    }
    const renamed = await page.request.patch(`${url}api/chats/${id}`, { headers: { Origin: new URL(url).origin }, data: { title: fixture.title } });
    assert.ok(renamed.ok(), 'Nie udało się nazwać syntetycznej rozmowy.');
    chats.push({ id, ...fixture });
  }
  return chats;
}

async function visitReady(page: Page) {
  await page.waitForFunction(() => {
    const slot = document.querySelector<HTMLButtonElement>('.visit-slot');
    return slot && !slot.disabled && document.querySelector('.wektor-workspace')?.getAttribute('aria-busy') === 'false';
  }, undefined, { timeout: 20_000 });
}

async function commands({ page, screenshot }: FlowContext) {
  await openNew(page);
  const input = inputOf(page);
  await input.fill('/');
  await page.getByRole('listbox', { name: 'Komendy rozmowy' }).waitFor();
  assert.equal(await page.getByRole('option').count(), 7);
  await screenshot('commands');
  await input.fill('/tym');
  assert.equal(await page.getByRole('option').count(), 1);
  await input.press('Escape');
  assert.equal(await page.getByRole('listbox', { name: 'Komendy rozmowy' }).count(), 0);
  await input.fill('/tymczasowa'); await input.press('Enter');
  await page.getByText('Rozmowa tymczasowa', { exact: true }).waitFor();
  await screenshot('temporary');
  await page.getByRole('button', { name: 'Zachowaj rozmowę' }).click();
  await input.fill('/'); await input.press('Enter');
  assert.equal(await input.inputValue(), '/', 'Sam slash wykonał komendę.');
  await input.press('ArrowDown'); await input.press('Enter');
  const tabs = page.locator('.wektor-history-tabs');
  const tabBounds = await tabs.boundingBox(), newBounds = await page.locator('.wektor-new').boundingBox(), searchBounds = await page.locator('.wektor-search').boundingBox();
  assert.ok(tabBounds && newBounds && searchBounds);
  assert.ok(Math.abs(tabBounds.x - newBounds.x) < 1 && Math.abs(tabBounds.x - searchBounds.x) < 1, 'Różne lewe marginesy zakładek.');
  assert.ok(Math.abs(tabBounds.width - newBounds.width) < 1 && Math.abs(tabBounds.width - searchBounds.width) < 1, 'Różne prawe marginesy zakładek.');
  await page.getByRole('tab', { name: 'Rozmowy', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: /^Archiwum/ }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tabpanel').waitFor();
  await screenshot('archive');
  return { filtered: true, temporary: true, keyboard: true };
}

async function composer(context: FlowContext) {
  const { page } = context;
  await openNew(page);
  const input = inputOf(page), shell = page.locator('.wektor-shell'), field = page.locator('[data-slot=aui_composer-shell]');
  const measurements = [];
  for (const mode of ['full', 'compact'] as const) {
    if (mode === 'compact') { await page.getByRole('button', { name: 'Zminimalizuj czat' }).click(); await stableRect(shell); }
    await input.fill(''); const empty = await stableRect(field);
    await input.fill('x'); const typed = await stableRect(field);
    await input.fill(''); const cleared = await stableRect(field);
    sameRect(empty, typed, `${mode}: pierwszy znak`); sameRect(empty, cleared, `${mode}: skasowanie szkicu`);
    await input.fill('@');
    const palette = page.getByRole('listbox', { name: 'Wybór skillów' });
    await palette.waitFor();
    const bounds = await palette.boundingBox(), parent = await shell.boundingBox();
    assert.ok(bounds && parent && bounds.x >= parent.x && bounds.x + bounds.width <= parent.x + parent.width + 1, 'Menu skillów wychodzi poza czat.');
    await context.screenshot(`${mode}-skills`);
    await input.press('Escape'); await input.fill('');
    assert.equal(await shell.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Poziome przepełnienie czatu.');
    measurements.push({ mode, empty, typed, cleared });
  }
  return { measurements };
}

async function keyboard(context: FlowContext) {
  const { page } = context;
  await page.getByRole('heading', { name: 'Najbliższe dni', exact: true }).waitFor();
  await page.keyboard.down('ControlLeft'); await page.waitForTimeout(350);
  assert.equal(await picking(page), false, 'Sam Ctrl włącza wskazywanie.');
  await page.keyboard.press('v'); await page.keyboard.up('ControlLeft');
  assert.equal(await page.locator('.wektor-root:not([hidden])').count(), 0, 'Ctrl+V otworzył Wektora.');
  await toggle(page);
  await page.getByRole('complementary', { name: 'Czat z agentem', exact: true }).waitFor();
  assert.equal(await picking(page), true, 'Ctrl+Alt nie pozostaje włączony po puszczeniu klawiszy.');
  await page.getByRole('heading', { name: 'Najbliższe dni', exact: true }).click();
  await page.getByRole('button', { name: 'Usuń z kontekstu: Najbliższe dni' }).waitFor();
  const before = await stableRect(page.locator('.wektor-shell'));
  await context.screenshot('pointing');
  await toggle(page, true);
  assert.equal(await picking(page), false);
  sameRect(before, await stableRect(page.locator('.wektor-shell')), 'Wyjście ze wskazywania');
  const input = inputOf(page);
  await input.fill('Szkic po wskazaniu');
  await page.keyboard.down('ControlLeft'); await page.waitForTimeout(350); await page.keyboard.press('a'); await page.keyboard.up('ControlLeft');
  assert.equal(await picking(page), false, 'Ctrl+A włączył wskazywanie.');
  assert.equal(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length), true, 'Ctrl+A nie zaznaczył tekstu.');
  await page.keyboard.down('AltRight'); await page.keyboard.press('e'); await page.keyboard.up('AltRight');
  assert.equal(await picking(page), false, 'Prawy Alt włączył wskazywanie.');
  await input.fill('Szkic po wskazaniu');
  await toggle(page); await page.keyboard.press('Escape'); assert.equal(await picking(page), false);
  await page.getByRole('button', { name: 'Wskaż element' }).click(); await toggle(page); assert.equal(await picking(page), false, 'Przycisk i skrót mają różny stan.');
  await toggle(page); await page.getByRole('button', { name: 'Gotowe', exact: true }).click();
  assert.equal(await picking(page), false);
  for (const mode of ['window', 'hidden', 'compact']) {
    await page.keyboard.press('Alt+w');
    await page.waitForFunction(expected => { const root = document.querySelector<HTMLElement>('.wektor-root'); return expected === 'hidden' ? root?.hidden : !root?.hidden && root?.dataset.mode === expected; }, mode);
  }
  assert.equal(await input.inputValue(), 'Szkic po wskazaniu');
  await context.screenshot('compact');
  return { ctrlAltToggle: true, nativePaste: true, nativeSelectAll: true, altGr: true, altW: true, sameGeometry: true };
}

async function history(context: FlowContext) {
  const { page } = context, chats = await seedVisits(context);
  await openNew(page); await openConversation(page, chats[0].id); await visitReady(page);
  const input = inputOf(page);
  await input.fill('@bank'); await input.press('Enter'); await input.fill('Szkic A');
  await openConversation(page, chats[1].id); await visitReady(page);
  assert.equal(await input.inputValue(), '', 'Szkic z A przeszedł do B.');
  await input.fill('Szkic B');
  await openConversation(page, chats[0].id);
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Wiadomość do agenta"]')?.value === 'Szkic A');
  await page.getByRole('button', { name: 'Usuń z kontekstu: Bank' }).waitFor();
  const handle = page.getByRole('separator', { name: 'Szerokość historii' }), sidebar = page.getByRole('complementary', { name: 'Historia rozmów' });
  await handle.hover();
  const grip = await handle.boundingBox(), start = await sidebar.boundingBox();
  assert.ok(grip && start);
  const desired = Math.min(480, page.viewportSize()!.width * .4, start.width + 100);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + desired, grip.y + grip.height / 2, { steps: 8 }); await page.mouse.up();
  assert.ok(Math.abs((await sidebar.boundingBox())!.width - desired) < 1, 'Przeciąganie historii nie zmieniło szerokości.');
  await page.getByRole('button', { name: 'Ukryj historię' }).click(); await page.getByRole('button', { name: 'Pokaż rozmowy' }).click();
  assert.ok(Math.abs((await sidebar.boundingBox())!.width - desired) < 1, 'Szerokość historii nie została zapamiętana.');
  await handle.focus(); await handle.press('Home'); await handle.press('ArrowRight');
  assert.equal(await handle.getAttribute('aria-valuenow'), '210');
  await handle.dblclick(); assert.equal(await handle.getAttribute('aria-valuenow'), '232');
  await context.screenshot('resized');
  return { draftsIsolated: true, contextRestored: true, resizedAndRemembered: true, keyboardResize: true };
}

async function switching(context: FlowContext) {
  const { page, latency } = context, chats = await seedVisits(context);
  let delay = 0;
  // Both responses come from the scenario. Only a fixture label changes, making cross-chat mixups observable.
  await page.route(/\/api\/chats\/[^/]+\/appointment\?/, async route => {
    try {
      const id = new URL(route.request().url()).pathname.split('/')[3], fixture = chats.find(chat => chat.id === id);
      assert.ok(fixture, 'Odczyt karty spoza rozmów tego przypadku.');
      const response = await route.fetch(), data = appointmentViewSchema.parse(await response.json());
      if (delay) await new Promise(done => setTimeout(done, delay));
      await route.fulfill({ response, json: { ...data, preview: { ...data.preview, doctor: fixture.doctor } } });
    } catch (error) { if (!route.request().failure()) throw error; }
  });
  await page.route(/\/api\/(?:chats\/[^/]+\/(?:events|cockpit)|calendar)(?:\?|$)/, async route => {
    if (delay) await new Promise(done => setTimeout(done, delay));
    try { await route.continue(); } catch (error) { if (!route.request().failure()) throw error; }
  });
  await openNew(page);
  for (const chat of chats) { await openConversation(page, chat.id); await visitReady(page); }
  delay = latency;
  type Frame = { mode?: string | null; visit?: string | null; width: number; title: string; text: string };
  const recording = await page.evaluateHandle<{ running: boolean; frames: Frame[] }>(`(() => {
    const state = { running: true, frames: [] };
    const sample = () => {
      const root = document.querySelector('.wektor-workspace');
      state.frames.push({ mode: root?.getAttribute('data-inspector'), visit: root?.getAttribute('data-visit'), width: document.querySelector('.wektor-conversation').getBoundingClientRect().width, title: document.querySelector('.wektor-heading h1')?.textContent ?? '', text: document.querySelector('.wektor-inspector')?.textContent ?? '' });
      if (state.running) requestAnimationFrame(sample);
    }; requestAnimationFrame(sample); return state;
  })()`);
  try {
    for (let i = 0; i < 6; i++) {
      const chat = chats[i % 2];
      await openConversation(page, chat.id);
      await page.getByRole('region', { name: 'Terminy na tle kalendarza' }).waitFor();
      assert.ok((await page.locator('.wektor-inspector').innerText()).includes(chat.doctor), 'Kokpit pokazuje inną rozmowę.');
      if (latency >= 100) assert.equal(await page.locator('.visit-slot').first().isDisabled(), true, 'Podgląd ze snapshotu pozwala na działanie przed świeżym odczytem.');
      await visitReady(page);
    }
    const frames = await recording.evaluate(state => { state.running = false; return state.frames; }) as Frame[];
    assert.ok(frames.length > 0);
    const widths = frames.map(frame => frame.width);
    for (const frame of frames) {
      assert.equal(frame.mode, 'full', 'Kokpit zwinął się podczas przełączenia.'); assert.equal(frame.visit, 'true');
      const other = chats.find(chat => chat.title !== frame.title);
      assert.ok(!other || !frame.text.includes(other.doctor), 'Klatka kokpitu zawiera dane poprzedniej rozmowy.');
    }
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, 'Zmieniła się szerokość rozmowy.');
    await context.screenshot('warm-cache');
    return { switches: 6, apiLatencyMs: latency, frames: frames.length, conversationWidth: [Math.min(...widths), Math.max(...widths)], staleActionsChecked: latency >= 100 };
  } finally { await recording.evaluate(state => { state.running = false; }).catch(() => {}); await recording.dispose(); }
}

export const wektorFlows = { commands, composer, keyboard, history, switching };
