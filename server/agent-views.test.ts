import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { CalendarSource } from '../src/calendar-contract';
import { agentViews, serveAgentView } from './agent-views';
import { createPanelServer } from './app';
import { createScenarioSources } from './scenario';
import { SourceError, type PanelSources } from './sources';

const at = (iso: string) => Date.parse(iso);
// 2026-10-25 is the day Poland leaves summer time: it has 25 hours and its midnight is 2026-10-24T22:00Z.
const NOW = at('2026-10-25T10:00:00Z');

const calendar = (data: CalendarSource['data'], extra: Partial<CalendarSource> = {}): CalendarSource =>
  ({ live: true, name: 'Google Calendar', status: 'connected', observedAt: NOW, data, calendarId: 'a@b.c', timeZone: 'Europe/Warsaw', ...extra });
const event = (id: string, title: string, start: string, end: string, extra: object = {}) =>
  ({ id, title, startAt: at(start), endAt: at(end), allDay: false, description: `Opis ${title}`, ...extra });
const sourcesWith = (value: CalendarSource) => ({ calendar: async () => value }) as unknown as PanelSources;
const ask = (sources: PanelSources, name: string, query = '', now = NOW) => agentViews(sources)[name](new URL(`http://x/api/agent/${name}${query}`), now);

describe('widoki dla agenta: kalendarz', () => {
  const sources = sourcesWith(calendar([
    event('1', 'Po północy', '2026-10-24T22:30:00Z', '2026-10-24T23:00:00Z'),
    event('2', 'Wizyta', '2026-10-28T16:30:00Z', '2026-10-28T17:20:00Z', { location: 'Fabryczna 15, Leszno' }),
    event('3', 'Urlop', '2026-10-25T23:00:00Z', '2026-10-27T23:00:00Z', { allDay: true, startDate: '2026-10-26', endDate: '2026-10-28' }),
    event('4', 'Poza zakresem', '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z'),
  ]));

  it('podaje czas lokalny zamiast milisekund, w kolejności, ze zwykłym i całodniowym zapisem', async () => {
    const text = await ask(sources, 'calendar');
    expect(text.split('\n')[0]).toContain('2026-10-25 – 2026-10-31 (Europe/Warsaw)');
    expect(text).toContain('2026-10-25 00:30–01:00  Po północy');
    expect(text).toContain('2026-10-28 17:30–18:20  Wizyta [Fabryczna 15, Leszno]');
    expect(text).toContain('2026-10-26 – 2026-10-27 cały dzień  Urlop');
    expect(text).not.toContain('Poza zakresem');
    expect(text.indexOf('Po północy')).toBeLessThan(text.indexOf('Urlop'));
    expect(text).not.toMatch(/\d{12,}/);
  });

  it('zakres from/to liczy dni w strefie źródła, także dzień ze zmianą czasu', async () => {
    expect(await ask(sources, 'calendar', '?from=2026-10-25&to=2026-10-25')).toContain('Po północy');
    expect(await ask(sources, 'calendar', '?from=2026-10-24&to=2026-10-24')).not.toContain('Po północy');
    expect(await ask(sources, 'calendar', '?from=2026-10-28&to=2026-10-28')).not.toContain('Urlop');
    expect(await ask(sources, 'calendar', '?from=2026-11-20&to=2026-11-20')).toContain('Poza zakresem');
    expect(await ask(sources, 'calendar', '?from=2026-12-01&to=2026-12-02')).toContain('Brak wydarzeń');
  });

  it('opisy dochodzą tylko na prośbę', async () => {
    expect(await ask(sources, 'calendar')).not.toContain('Opis Wizyta');
    expect(await ask(sources, 'calendar', '?opisy=1')).toContain('— Opis Wizyta');
  });

  it('źródło bez danych mówi to wprost zamiast udawać pustą agendę', async () => {
    const text = await ask(sourcesWith(calendar(null, { status: 'offline', message: 'Brak połączenia z Google' })), 'calendar');
    expect(text).toContain('brak danych (status: offline, Brak połączenia z Google)');
    expect(text).not.toContain('Brak wydarzeń');
  });

  it('błędny zakres to 400, nieznany widok to null, błąd źródła zachowuje status', async () => {
    const views = agentViews(sources);
    const get = (query: string) => serveAgentView(views, new URL(`http://x/api/agent/calendar${query}`), NOW);
    expect((await get('?from=jutro'))!.status).toBe(400);
    expect((await get('?from=2026-10-30&to=2026-10-25'))!.status).toBe(400);
    expect((await get('?from=2026-01-01&to=2026-12-31'))!.status).toBe(400);
    expect(await serveAgentView(views, new URL('http://x/api/agent/nic'), NOW)).toBeNull();
    expect(await serveAgentView(views, new URL('http://x/api/agent/constructor'), NOW)).toBeNull();
    const failing = { calendar: async () => { throw new SourceError(503); } } as unknown as PanelSources;
    expect((await serveAgentView(agentViews(failing), new URL('http://x/api/agent/calendar'), NOW))!.status).toBe(503);
  });
});

describe('widoki dla agenta: reszta źródeł (scenariusz standardowy)', () => {
  const sources = createScenarioSources(path.join(process.cwd(), 'scenarios/standard.json'));
  const now = Date.now();
  const view = (name: string, query = '') => agentViews(sources)[name](new URL(`http://x/api/agent/${name}${query}`), now);

  it('każdy widok to krótki tekst bez epoki i bez JSON-a', async () => {
    for (const name of ['calendar', 'training', 'cezar', 'mail', 'quotas', 'system']) {
      const text = await view(name);
      // Task ids (` id=…`) may hold long digit runs; everything else must be readable time, not epoch milliseconds.
      expect(text.replace(/ id=\S+/g, ''), name).not.toMatch(/\d{12,}|^[{[]/);
      expect(text.length, name).toBeLessThan(6000);
    }
  });

  it('poczta: limit i nieprzeczytane; limity: godziny lokalne i bez etykiety „remaining”', async () => {
    const mail = await view('mail', '?limit=2');
    expect(mail).toContain('tylko nieprzeczytane');
    expect(mail.split('\n').length).toBe(3);
    const quotas = await view('quotas');
    expect(quotas).toMatch(/Claude \/ 5h: \d+% zużyte, reset \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(quotas).not.toContain('Remaining');
  });

  it('cezar: każde zakończone zadanie ma id w postaci projekt/uuid (do akcji archive), a nadmiar jest tylko policzony', async () => {
    const text = await view('cezar');
    const finished = text.split('Zakończone, niezarchiwizowane:')[1].trim().split('\n').filter(line => line.includes(' id='));
    expect(finished.length).toBeGreaterThan(0);
    for (const line of finished) expect(line).toMatch(/ id=[^\s/]+\/[0-9A-Za-z-]+( |$)/);
    const many = { cezar: async () => ({ observedAt: now, tasks: [], counts: { running: 0, queue: 0, 'needs-input': 0, review: 0 }, partial: false, scheduled: 0,
      finished: Array.from({ length: 45 }, (_, i) => ({ id: `p/${i}`, title: `Zadanie ${i}`, project: 'p', status: 'done', checkedAt: now, completedAt: now - i * 3600_000, description: '', sourceUrl: 'http://x/' })) }) } as unknown as PanelSources;
    const text45 = await agentViews(many).cezar(new URL('http://x/api/agent/cezar'), now);
    expect(text45).toContain(' id=p/39');
    expect(text45).not.toContain(' id=p/40');
    expect(text45).toContain('… i 5 starszych zakończonych (nie pokazano).');
  });

  it('trening: kroki dopiero na prośbę', async () => {
    const wide = '?from=2026-10-01&to=2026-11-10';
    const plain = await view('training', wide);
    const steps = await view('training', `${wide}&kroki=1`);
    expect(plain).not.toContain('kroki:');
    expect(steps.length).toBeGreaterThan(plain.length);
  });
});

describe('trasa /api/agent/*', () => {
  let server: Server | undefined;
  let dir: string | undefined;
  afterEach(async () => { server?.close(); if (dir) await rm(dir, { recursive: true, force: true }); server = dir = undefined; });

  it('odpowiada tekstem UTF-8 bez cache; nieznany widok to 404; tylko GET', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'desk-agent-'));
    const sources = createScenarioSources(path.join(process.cwd(), 'scenarios/standard.json'));
    server = createPanelServer(sources, dir).listen(0, '127.0.0.1');
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const ok = await fetch(`${base}/api/agent/calendar`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.text()).toContain('Kalendarz Google');
    expect((await fetch(`${base}/api/agent/calendar?from=zle`)).status).toBe(400);
    expect((await fetch(`${base}/api/agent/nic`)).status).toBe(404);
    expect((await fetch(`${base}/api/agent/calendar`, { method: 'POST' })).status).toBe(405);
  });
});
