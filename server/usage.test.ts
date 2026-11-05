// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UsageSlice } from '../src/usage-contract';
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
