import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import type { ZodType } from 'zod';
import { areaSliceSchema, usageSliceSchema, USAGE_TIME_ZONE, type AreaSlice, type UsageSlice } from '../src/usage-contract';

/** Details are kept this many days; the daily summaries (with their hours) are kept for good. */
export const DETAIL_DAYS = 90;
/** A slice may be this old (a tab that was offline) or this far ahead (clock skew); this is also far below DETAIL_DAYS. */
const MAX_AGE_MS = 48 * 3_600_000;
const MAX_AHEAD_MS = 60_000;

/** The numbers that can be added up, for one hour of one thing in one browser. */
interface Sums {
  date: string; hour: number; browser: string;
  /** Time on screen. */
  ms: number;
  /** Times it was entered. */
  entries: number;
  /** Visits that ended with no interaction at all. */
  visitsWithoutInteraction: number;
  /** Part of `ms` before the first interaction of the tab session (of the area, for an area). */
  noInteractionMs: number;
  /** Sum over the rest of the time of (seconds since the last interaction) × (seconds): divide by that rest in seconds for the mean. */
  ageIntegral: number;
  /** The longest time since the last interaction. */
  maxAgeMs: number;
}
/** One hour of one main view in one browser (and desktop). */
export interface UsageRow extends Sums { view: UsageSlice['view']; page?: string; detail?: string; pulpit?: string }
/** One hour of one area in one browser (on one page, desktop, tile). Apart from the rows: areas overlap in time. */
export interface AreaRow extends Sums { area: AreaSlice['area']; page: string; pulpit?: string; kind?: string; tile?: string; source?: string; chat?: string }
interface Day<R> { seen: Set<string>; rows: Map<string, R>; bytes: number }
interface SummaryFile<R> { applied: number; rows: R[] }

const zoned = (at: number) => DateTime.fromMillis(at, { zone: USAGE_TIME_ZONE });

type Slice = { id: string; browser: string; start: number; end: number; entry: boolean; visitEnd: boolean; touched: boolean; noInteractionMs: number; ageIntegral: number; maxAgeMs: number };
/** What a kind of slice is summed by (its identity apart from the hour and the browser). */
interface Kind<S extends Slice, R extends Sums> {
  /** File prefix: `details-` / `summary-` or `areas-details-` / `areas-summary-`. */
  prefix: string;
  schema: ZodType<S>;
  identity: (slice: S) => Omit<R, keyof Sums>;
}
const keyOf = (row: Sums) => JSON.stringify(Object.entries(row).filter(([name]) => !['ms', 'entries', 'visitsWithoutInteraction', 'noInteractionMs', 'ageIntegral', 'maxAgeMs'].includes(name)).sort(([a], [b]) => a.localeCompare(b)));
const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, x]) => x !== undefined)) as T;

const usageKind: Kind<UsageSlice, UsageRow> = {
  prefix: '', schema: usageSliceSchema,
  identity: s => defined({ view: s.view, page: s.page, detail: s.detail, pulpit: s.pulpit }),
};
const areaKind: Kind<AreaSlice, AreaRow> = {
  prefix: 'areas-', schema: areaSliceSchema,
  identity: s => defined({ area: s.area, page: s.page, pulpit: s.pulpit, kind: s.kind, tile: s.tile, source: s.source, chat: s.chat }),
};

function addSlice<S extends Slice, R extends Sums>(kind: Kind<S, R>, rows: Map<string, R>, s: S) {
  const at = zoned(s.start);
  const base = { date: at.toISODate()!, hour: at.hour, browser: s.browser, ...kind.identity(s) } as unknown as R;
  const key = keyOf(base);
  const row = rows.get(key) ?? { ...base, ms: 0, entries: 0, visitsWithoutInteraction: 0, noInteractionMs: 0, ageIntegral: 0, maxAgeMs: 0 };
  row.ms += s.end - s.start;
  row.entries += s.entry ? 1 : 0;
  row.visitsWithoutInteraction += s.visitEnd && !s.touched ? 1 : 0;
  row.noInteractionMs += s.noInteractionMs;
  row.ageIntegral = Math.round((row.ageIntegral + s.ageIntegral) * 1000) / 1000;
  row.maxAgeMs = Math.max(row.maxAgeMs, s.maxAgeMs);
  rows.set(key, row);
}

export interface UsageStore {
  /** Adds new slices (known ids are skipped); throws when the disk refuses, and then nothing is counted twice on a retry. */
  record(input: unknown[], now?: number): Promise<{ accepted: number; duplicates: number; rejected: number }>;
  /** The same for area slices (t-01c8aa59): a separate record kind in the same store, never added to the main views. */
  recordAreas(input: unknown[], now?: number): Promise<{ accepted: number; duplicates: number; rejected: number }>;
  /** Summary rows of the dates from..to (inclusive, YYYY-MM-DD), oldest first. */
  rows(from: string, to: string): Promise<UsageRow[]>;
  /** Area rows of the same dates. */
  areaRows(from: string, to: string): Promise<AreaRow[]>;
  /** Removes details older than DETAIL_DAYS; summaries stay. */
  prune(now?: number): Promise<void>;
}

/**
 * One kind of record on disk (`dir`, outside Git): `<prefix>details-DATE.ndjson` is the log of accepted slices,
 * `<prefix>summary-DATE.json` the hourly sums of that day and how many bytes of the log they include. A summary behind its
 * log (a crash between the two writes) is rebuilt from the log; a summary whose log was pruned is kept as it is.
 * The date is the one in Europe/Warsaw.
 */
function createLedger<S extends Slice, R extends Sums>(dir: string, kind: Kind<S, R>) {
  const days = new Map<string, Day<R>>();
  const detailsName = new RegExp('^' + kind.prefix + String.raw`details-(\d{4}-\d{2}-\d{2})\.ndjson$`);
  const anyName = new RegExp('^' + kind.prefix + String.raw`(?:details|summary)-(\d{4}-\d{2}-\d{2})\.(?:ndjson|json)$`);
  const detailsPath = (date: string) => join(dir, `${kind.prefix}details-${date}.ndjson`);
  const summaryPath = (date: string) => join(dir, `${kind.prefix}summary-${date}.json`);
  const dayOf = (s: S) => zoned(s.start).toISODate()!;

  async function writeSummary(date: string, day: Day<R>) {
    const file: SummaryFile<R> = { applied: day.bytes, rows: [...day.rows.values()] };
    const temp = summaryPath(date) + '.tmp';
    await writeFile(temp, JSON.stringify(file));
    await rename(temp, summaryPath(date));
  }
  async function load(date: string): Promise<Day<R>> {
    const cached = days.get(date);
    if (cached) return cached;
    let log = '';
    let bytes = 0;
    try { const raw = await readFile(detailsPath(date)); bytes = raw.length; log = raw.toString('utf8'); } catch { /* no log: pruned or a day without data */ }
    let summary: SummaryFile<R> | null = null;
    try { summary = JSON.parse(await readFile(summaryPath(date), 'utf8')) as SummaryFile<R>; } catch { /* none yet */ }
    const day: Day<R> = { seen: new Set(), rows: new Map(), bytes };
    if (bytes === 0 && summary) { day.bytes = summary.applied; for (const r of summary.rows) day.rows.set(keyOf(r), r); }
    else {
      for (const line of log.split(/\n/)) {
        if (!line) continue;
        let slice: S;
        try { slice = kind.schema.parse(JSON.parse(line)); } catch { continue; } // a line cut by a crash
        day.seen.add(slice.id);
        addSlice(kind, day.rows, slice);
      }
      if (summary?.applied !== bytes && bytes > 0) await writeSummary(date, day).catch(() => undefined);
    }
    days.set(date, day);
    return day;
  }

  return {
    async record(input: unknown[], now: number) {
      let rejected = 0, duplicates = 0;
      const fresh = new Map<string, S[]>();
      for (const item of input) {
        const parsed = kind.schema.safeParse(item);
        if (!parsed.success || parsed.data.start < now - MAX_AGE_MS || parsed.data.end > now + MAX_AHEAD_MS) { rejected++; continue; }
        const date = dayOf(parsed.data);
        const list = fresh.get(date) ?? [];
        list.push(parsed.data);
        fresh.set(date, list);
      }
      await mkdir(dir, { recursive: true });
      let accepted = 0;
      for (const [date, slices] of fresh) {
        const day = await load(date);
        const added: S[] = [];
        for (const slice of slices) {
          if (day.seen.has(slice.id) || added.some(a => a.id === slice.id)) duplicates++; else added.push(slice);
        }
        if (!added.length) continue;
        const text = added.map(s => JSON.stringify(s)).join(String.fromCharCode(10)) + String.fromCharCode(10);
        try {
          await appendFile(detailsPath(date), text);
          for (const s of added) { day.seen.add(s.id); addSlice(kind, day.rows, s); }
          day.bytes += Buffer.byteLength(text);
          await writeSummary(date, day);
          accepted += added.length;
        } catch (error) {
          days.delete(date); // the next call re-reads the disk and finds out what really got written
          throw error;
        }
      }
      return { accepted, duplicates, rejected };
    },
    async rows(from: string, to: string): Promise<R[]> {
      const dates = new Set<string>();
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const match = anyName.exec(name);
        if (match && match[1] >= from && match[1] <= to) dates.add(match[1]);
      }
      const rows: R[] = [];
      for (const date of [...dates].sort()) rows.push(...(await load(date)).rows.values());
      return rows.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour || keyOf(a).localeCompare(keyOf(b)));
    },
    async prune(now: number) {
      const limit = zoned(now).minus({ days: DETAIL_DAYS }).toISODate()!;
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const match = detailsName.exec(name);
        if (!match || match[1] >= limit) continue;
        const day = await load(match[1]).catch(() => null);
        // The summary must be on disk before its log goes.
        if (day && !(await stat(summaryPath(match[1])).then(s => s.size > 0, () => false))) await writeSummary(match[1], day);
        await rm(join(dir, name), { force: true });
        days.delete(match[1]);
      }
    },
  };
}

/** The store of the service: main views and areas side by side, written one thing at a time. */
export function createUsageStore(dir: string): UsageStore {
  const main = createLedger(dir, usageKind), areas = createLedger(dir, areaKind);
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = chain.then(work, work); chain = next.catch(() => undefined); return next; };
  return {
    record: (input, now = Date.now()) => serial(() => main.record(input, now)),
    recordAreas: (input, now = Date.now()) => serial(() => areas.record(input, now)),
    rows: (from, to) => serial(() => main.rows(from, to)),
    areaRows: (from, to) => serial(() => areas.rows(from, to)),
    prune: (now = Date.now()) => serial(async () => { await main.prune(now); await areas.prune(now); }),
  };
}

type Total = { ms: number; entries: number; visitsWithoutInteraction: number; noInteractionMs: number; maxAgeMs: number; meanAgeS: number | null };
type Acc = { ms: number; entries: number; visitsWithoutInteraction: number; noInteractionMs: number; maxAgeMs: number; ageIntegral: number };
/** Adds rows up by a name; the mean time since the last interaction is derived at the end. */
function totals<R extends Sums>(rows: R[], names: (row: R) => Record<string, string | null>): Record<string, Record<string, Total>> {
  const sums = new Map<string, Acc>();
  for (const r of rows) for (const [kind, name] of Object.entries(names(r))) {
    if (name === null) continue;
    const key = `${kind}|${name}`;
    const t = sums.get(key) ?? { ms: 0, entries: 0, visitsWithoutInteraction: 0, noInteractionMs: 0, maxAgeMs: 0, ageIntegral: 0 };
    t.ms += r.ms; t.entries += r.entries; t.visitsWithoutInteraction += r.visitsWithoutInteraction; t.noInteractionMs += r.noInteractionMs;
    t.ageIntegral += r.ageIntegral; t.maxAgeMs = Math.max(t.maxAgeMs, r.maxAgeMs);
    sums.set(key, t);
  }
  const out: Record<string, Record<string, Total>> = {};
  for (const [key, t] of sums) {
    const cut = key.indexOf('|'), kind = key.slice(0, cut), name = key.slice(cut + 1);
    const rest = (t.ms - t.noInteractionMs) / 1000;
    (out[kind] ??= {})[name] = { ms: t.ms, entries: t.entries, visitsWithoutInteraction: t.visitsWithoutInteraction, noInteractionMs: t.noInteractionMs, maxAgeMs: t.maxAgeMs, meanAgeS: rest > 0 ? Math.round(t.ageIntegral / rest * 10) / 10 : null };
  }
  return out;
}

/**
 * The comparison the export gives: hours, views/pages and desktops side by side, with the derived means. The areas
 * (`areaRows`, `byArea`, `byAreaTile`) are a separate set: they are parallel in time, so they are never added to the sums above.
 */
export function usageReport(rows: UsageRow[], from: string, to: string, areaRows: AreaRow[] = []) {
  const main = totals(rows, r => ({
    byView: r.view === 'page' ? `page:${r.page}` : r.view === 'detail' ? `detail:${r.detail}` : r.view,
    byHour: String(r.hour).padStart(2, '0'),
    byPulpit: r.view === 'page' && r.page === 'home' ? `${r.browser}/${r.pulpit ?? '?'}` : null,
  }));
  const shown = totals(areaRows, r => ({
    byArea: r.area === 'tile' ? `tile:${r.kind}` : r.area,
    byAreaHour: `${String(r.hour).padStart(2, '0')}/${r.area === 'tile' ? `tile:${r.kind}` : r.area}`,
    byAreaTile: r.area === 'tile' ? `${r.browser}/${r.pulpit}/${r.tile}` : null,
  }));
  return { timeZone: USAGE_TIME_ZONE, from, to, rows, byView: main.byView ?? {}, byHour: main.byHour ?? {}, byPulpit: main.byPulpit ?? {},
    areaRows, byArea: shown.byArea ?? {}, byAreaHour: shown.byAreaHour ?? {}, byAreaTile: shown.byAreaTile ?? {} };
}
