// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AreaSlice, UsageSlice } from '../src/usage-contract';
import { createUsageStore, usageReport } from './usage';

const H = 3_600_000;
/** 2026-11-05 11:00 in Warsaw (CET, UTC+1) = 10:00 UTC. */
const HOUR = Date.UTC(2026, 10, 5, 10);
const NOW = HOUR + 30 * 60_000;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'usage-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const slice = (over: Partial<UsageSlice> = {}): UsageSlice => ({
  id: 'abcdefgh1:1', browser: 'browser01', session: 'abcdefgh1', start: HOUR + 60_000, end: HOUR + 360_000, view: 'page', page: 'home', pulpit: 'main',
  width: 1850, height: 1000, entry: true, visitEnd: true, touched: false, noInteractionMs: 300_000, ageIntegral: 0, maxAgeMs: 0, ...over,
});

describe('usage store', () => {
  it('adds slices up by Warsaw hour, and sending the same slice again changes nothing', async () => {
    const store = createUsageStore(dir);
    const second = slice({ id: 'abcdefgh1:2', start: HOUR + 400_000, end: HOUR + 500_000, entry: false, noInteractionMs: 0, touched: true, ageIntegral: 50, maxAgeMs: 10_000 });
    expect(await store.record([slice(), second], NOW)).toEqual({ accepted: 2, duplicates: 0, rejected: 0 });
    expect(await store.record([slice()], NOW)).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    expect(await store.rows('2026-11-05', '2026-11-05')).toEqual([{ date: '2026-11-05', hour: 11, browser: 'browser01', view: 'page', page: 'home', pulpit: 'main', ms: 400_000, entries: 1, visitsWithoutInteraction: 1, noInteractionMs: 300_000, ageIntegral: 50, maxAgeMs: 10_000 }]);
  });

  it('survives a restart and re-sending after it, with sums unchanged', async () => {
    await createUsageStore(dir).record([slice()], NOW);
    const again = createUsageStore(dir);
    expect(await again.record([slice()], NOW)).toMatchObject({ accepted: 0, duplicates: 1 });
    expect((await again.rows('2026-11-05', '2026-11-05'))[0].ms).toBe(300_000);
  });

  it('rebuilds a summary that fell behind its log (crash between the two writes)', async () => {
    await createUsageStore(dir).record([slice()], NOW);
    const log = join(dir, 'details-2026-11-05.ndjson');
    writeFileSync(log, readFileSync(log, 'utf8') + JSON.stringify(slice({ id: 'abcdefgh1:2', start: HOUR + 400_000, end: HOUR + 460_000, noInteractionMs: 0 })) + '\n{"cut by a cra');
    const rows = await createUsageStore(dir).rows('2026-11-05', '2026-11-05');
    expect(rows[0].ms).toBe(360_000);
  });

  it('drops details after 90 days and keeps the daily summaries with their hours', async () => {
    const old = HOUR - 100 * 24 * H;
    const store = createUsageStore(dir);
    await store.record([slice({ start: old, end: old + 60_000, noInteractionMs: 0, id: 'abcdefgh1:9' })], old + H);
    await store.record([slice()], NOW);
    expect(readdirSync(dir).filter(n => n.startsWith('details-'))).toHaveLength(2);
    await store.prune(NOW);
    expect(readdirSync(dir).filter(n => n.startsWith('details-'))).toEqual(['details-2026-11-05.ndjson']);
    const rows = await createUsageStore(dir).rows('2000-01-01', '2100-01-01');
    expect(rows.map(r => r.ms)).toEqual([60_000, 300_000]);
  });

  it('refuses anything but anonymous numbers and fixed names, and slices out of the accepted time', async () => {
    const store = createUsageStore(dir);
    const bad = [
      { ...slice(), title: 'Temat maila' }, // an extra field
      slice({ pulpit: 'Moja praca' }), // a desktop name instead of an id
      slice({ view: 'ambient', page: 'home' }), slice({ page: 'tasks' }),
      slice({ start: HOUR - 1000, end: HOUR + 1000 }), // crosses the hour
      slice({ start: NOW - 49 * H, end: NOW - 49 * H + 1000, noInteractionMs: 0 }), slice({ start: NOW + 5 * 60_000, end: NOW + 6 * 60_000 }),
    ];
    expect(await store.record(bad, NOW)).toEqual({ accepted: 0, duplicates: 0, rejected: bad.length });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports a failing disk and counts nothing twice when it is back', async () => {
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'x');
    await expect(createUsageStore(file).record([slice()], NOW)).rejects.toThrow();
    expect(await createUsageStore(dir).record([slice()], NOW)).toMatchObject({ accepted: 1 });
  });

  it('compares hours, views and desktops in the report', async () => {
    const store = createUsageStore(dir);
    await store.record([
      slice(), slice({ id: 'abcdefgh1:2', start: HOUR + H, end: HOUR + H + 120_000, pulpit: 'p1', noInteractionMs: 0, touched: true, ageIntegral: 200, maxAgeMs: 20_000 }),
      slice({ id: 'abcdefgh1:3', start: HOUR + 2 * H, end: HOUR + 2 * H + 60_000, view: 'ambient', page: undefined, pulpit: undefined, noInteractionMs: 60_000 }),
    ], HOUR + 3 * H);
    const report = usageReport(await store.rows('2026-11-05', '2026-11-05'), '2026-11-05', '2026-11-05');
    expect(report.byHour['11'].ms).toBe(300_000);
    expect(report.byHour['12'].ms).toBe(120_000);
    expect(report.byView['ambient'].ms).toBe(60_000);
    expect(report.byPulpit['browser01/p1']).toMatchObject({ ms: 120_000, meanAgeS: 1.7 });
    expect(report.byPulpit['browser01/main'].ms).toBe(300_000);
  });
});

const area = (over: Partial<AreaSlice> = {}): AreaSlice => ({
  id: 'abcdefgh1:1', browser: 'browser01', session: 'abcdefgh1', start: HOUR + 60_000, end: HOUR + 120_000, area: 'tile', page: 'home', pulpit: 'main', kind: 'mail', tile: 'mail',
  width: 1850, height: 1000, entry: true, visitEnd: false, touched: true, noInteractionMs: 10_000, ageIntegral: 300, maxAgeMs: 50_000, ...over,
});

describe('area records (t-01c8aa59)', () => {
  it('keeps areas apart from the main views: separate files, rows and sums, and old history reads as before', async () => {
    // History written before areas existed: only the old files.
    await createUsageStore(dir).record([slice()], NOW);
    const before = readdirSync(dir).sort();
    expect(before).toEqual(['details-2026-11-05.ndjson', 'summary-2026-11-05.json']);
    const store = createUsageStore(dir);
    expect(await store.recordAreas([area(), area({ id: 'abcdefgh1:2', pulpit: 'p1', tile: 'mail' }), area({ id: 'abcdefgh1:3', area: 'clock', kind: undefined, tile: undefined })], NOW)).toEqual({ accepted: 3, duplicates: 0, rejected: 0 });
    expect(await store.recordAreas([area()], NOW)).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    expect(readdirSync(dir).sort()).toEqual(['areas-details-2026-11-05.ndjson', 'areas-summary-2026-11-05.json', ...before]);
    expect((await store.rows('2026-11-05', '2026-11-05')).map(r => r.ms)).toEqual([300_000]);
    expect((await createUsageStore(dir).areaRows('2026-11-05', '2026-11-05')).map(r => [r.area, r.pulpit ?? null, r.ms])).toEqual(
      [['clock', 'main', 60_000], ['tile', 'main', 60_000], ['tile', 'p1', 60_000]]);
  });

  it('exports the areas next to the views without adding them to the totals of the views or hours', async () => {
    const store = createUsageStore(dir);
    await store.record([slice()], NOW);
    await store.recordAreas([
      area(), area({ id: 'abcdefgh1:2', pulpit: 'p1', tile: 'mail' }), area({ id: 'abcdefgh1:3', kind: 'todo', tile: 'todo#2' }),
      area({ id: 'abcdefgh1:4', kind: 'todo', tile: 'todo#3', start: HOUR + 200_000, end: HOUR + 260_000 }),
      area({ id: 'abcdefgh1:5', area: 'detail-mail', kind: undefined, tile: undefined, source: 'mail', pulpit: undefined, page: 'tasks' }),
      area({ id: 'abcdefgh1:6', area: 'wektor', kind: undefined, tile: undefined, chat: 'compact', pulpit: undefined, page: 'calendar' }),
    ], NOW);
    const report = usageReport(await store.rows('2026-11-05', '2026-11-05'), '2026-11-05', '2026-11-05', await store.areaRows('2026-11-05', '2026-11-05'));
    expect(report.byHour['11'].ms).toBe(300_000); // as without areas
    expect(report.byView['page:home'].ms).toBe(300_000);
    expect(report.byArea['tile:mail'].ms).toBe(120_000);
    expect(report.byArea['tile:todo'].ms).toBe(120_000);
    expect(report.byAreaTile['browser01/main/todo#2'].ms).toBe(60_000);
    expect(report.byAreaTile['browser01/main/todo#3'].ms).toBe(60_000); // two tiles of one kind stay apart
    expect(report.byAreaTile['browser01/p1/mail'].ms).toBe(60_000); // and one kind on two desktops
    expect(report.areaRows.find(r => r.area === 'detail-mail')).toMatchObject({ source: 'mail', page: 'tasks' });
    expect(report.areaRows.find(r => r.area === 'wektor')).toMatchObject({ chat: 'compact', page: 'calendar' });
    expect(report.byAreaHour['11/tile:mail'].ms).toBe(120_000);
    expect(report.byArea['tile:mail'].meanAgeS).toBe(6); // 600 s·s over the 100 s after the first touch (120 s less 20 s before it)
  });

  it('refuses text and ids it does not know, and a main slice sent as an area', async () => {
    const store = createUsageStore(dir);
    const bad = [{ ...area(), title: 'Wizyta u lekarza' }, area({ kind: 'Konto Jana' }), area({ tile: undefined }), area({ source: 'mail' }), slice() as unknown];
    expect(await store.recordAreas(bad, NOW)).toEqual({ accepted: 0, duplicates: 0, rejected: bad.length });
    expect(readdirSync(dir)).toEqual([]);
  });
});
