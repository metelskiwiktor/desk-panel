import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { usageSliceSchema, USAGE_TIME_ZONE, type UsageSlice } from '../src/usage-contract';

/** Details are kept this many days; the daily summaries (with their hours) are kept for good. */
export const DETAIL_DAYS = 90;
/** A slice may be this old (a tab that was offline) or this far ahead (clock skew); this is also far below DETAIL_DAYS. */
const MAX_AGE_MS = 48 * 3_600_000;
const MAX_AHEAD_MS = 60_000;

/** One hour of one view in one browser (and desktop): the numbers that can be added up. */
export interface UsageRow {
  date: string; hour: number; browser: string; view: UsageSlice['view']; page?: string; detail?: string; pulpit?: string;
  /** Time on screen. */
  ms: number;
  /** Times the view was entered. */
  entries: number;
  /** Visits that ended with no interaction at all. */
  visitsWithoutInteraction: number;
  /** Part of `ms` before the first interaction of the tab session. */
  noInteractionMs: number;
  /** Sum over the rest of the time of (seconds since the last interaction) × (seconds): divide by that rest in seconds for the mean. */
  ageIntegral: number;
  /** The longest time since the last interaction. */
  maxAgeMs: number;
}
interface Day { seen: Set<string>; rows: Map<string, UsageRow>; bytes: number }
interface SummaryFile { applied: number; rows: UsageRow[] }

const zoned = (at: number) => DateTime.fromMillis(at, { zone: USAGE_TIME_ZONE });
const rowKey = (r: Pick<UsageRow, 'date' | 'hour' | 'browser' | 'view' | 'page' | 'detail' | 'pulpit'>) =>
  [r.date, r.hour, r.browser, r.view, r.page ?? '', r.detail ?? '', r.pulpit ?? ''].join('|');

function addSlice(rows: Map<string, UsageRow>, s: UsageSlice) {
  const at = zoned(s.start);
  const base = { date: at.toISODate()!, hour: at.hour, browser: s.browser, view: s.view, ...(s.page ? { page: s.page } : {}), ...(s.detail ? { detail: s.detail } : {}), ...(s.pulpit ? { pulpit: s.pulpit } : {}) };
  const key = rowKey(base);
  const row = rows.get(key) ?? { ...base, ms: 0, entries: 0, visitsWithoutInteraction: 0, noInteractionMs: 0, ageIntegral: 0, maxAgeMs: 0 };
  row.ms += s.end - s.start;
  row.entries += s.entry ? 1 : 0;
  row.visitsWithoutInteraction += s.visitEnd && !s.touched ? 1 : 0;
  row.noInteractionMs += s.noInteractionMs;
  row.ageIntegral = Math.round((row.ageIntegral + s.ageIntegral) * 1000) / 1000;
  row.maxAgeMs = Math.max(row.maxAgeMs, s.maxAgeMs);
  rows.set(key, row);
}
const dayOf = (s: UsageSlice) => zoned(s.start).toISODate()!;

export interface UsageStore {
  /** Adds new slices (known ids are skipped); throws when the disk refuses, and then nothing is counted twice on a retry. */
  record(input: unknown[], now?: number): Promise<{ accepted: number; duplicates: number; rejected: number }>;
  /** Summary rows of the dates from..to (inclusive, YYYY-MM-DD), oldest first. */
  rows(from: string, to: string): Promise<UsageRow[]>;
  /** Removes details older than DETAIL_DAYS; summaries stay. */
  prune(now?: number): Promise<void>;
}

/**
 * Where the numbers live (`dir`, outside Git): `details-DATE.ndjson` is the log of accepted slices, `summary-DATE.json`
 * the hourly sums of that day and how many bytes of the log they include. A summary behind its log (a crash between the
 * two writes) is rebuilt from the log; a summary whose log was pruned is kept as it is. The date is the one in Europe/Warsaw.
 */
export function createUsageStore(dir: string): UsageStore {
  const days = new Map<string, Day>();
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = chain.then(work, work); chain = next.catch(() => undefined); return next; };
  const detailsPath = (date: string) => join(dir, `details-${date}.ndjson`);
  const summaryPath = (date: string) => join(dir, `summary-${date}.json`);

  async function writeSummary(date: string, day: Day) {
    const file: SummaryFile = { applied: day.bytes, rows: [...day.rows.values()] };
    const temp = summaryPath(date) + '.tmp';
    await writeFile(temp, JSON.stringify(file));
    await rename(temp, summaryPath(date));
  }
  async function load(date: string): Promise<Day> {
    const cached = days.get(date);
    if (cached) return cached;
    let log = '';
    let bytes = 0;
    try { const raw = await readFile(detailsPath(date)); bytes = raw.length; log = raw.toString('utf8'); } catch { /* no log: pruned or a day without data */ }
    let summary: SummaryFile | null = null;
    try { summary = JSON.parse(await readFile(summaryPath(date), 'utf8')) as SummaryFile; } catch { /* none yet */ }
    const day: Day = { seen: new Set(), rows: new Map(), bytes };
    if (bytes === 0 && summary) { day.bytes = summary.applied; for (const r of summary.rows) day.rows.set(rowKey(r), r); }
    else {
      for (const line of log.split('\n')) {
        if (!line) continue;
        let slice: UsageSlice;
        try { slice = usageSliceSchema.parse(JSON.parse(line)); } catch { continue; } // a line cut by a crash
        day.seen.add(slice.id);
        addSlice(day.rows, slice);
      }
      if (summary?.applied !== bytes && bytes > 0) await writeSummary(date, day).catch(() => undefined);
    }
    days.set(date, day);
    return day;
  }

  return {
    record: (input, now = Date.now()) => serial(async () => {
      let rejected = 0, duplicates = 0;
      const fresh = new Map<string, UsageSlice[]>();
      for (const item of input) {
        const parsed = usageSliceSchema.safeParse(item);
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
        const added: UsageSlice[] = [];
        for (const slice of slices) {
          if (day.seen.has(slice.id) || added.some(a => a.id === slice.id)) duplicates++; else added.push(slice);
        }
        if (!added.length) continue;
        const text = added.map(s => JSON.stringify(s)).join('\n') + '\n';
        try {
          await appendFile(detailsPath(date), text);
          for (const s of added) { day.seen.add(s.id); addSlice(day.rows, s); }
          day.bytes += Buffer.byteLength(text);
          await writeSummary(date, day);
          accepted += added.length;
        } catch (error) {
          days.delete(date); // the next call re-reads the disk and finds out what really got written
          throw error;
        }
      }
      return { accepted, duplicates, rejected };
    }),
    rows: (from, to) => serial(async () => {
      const dates = new Set<string>();
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const match = /^(?:details|summary)-(\d{4}-\d{2}-\d{2})\.(?:ndjson|json)$/.exec(name);
        if (match && match[1] >= from && match[1] <= to) dates.add(match[1]);
      }
      const rows: UsageRow[] = [];
      for (const date of [...dates].sort()) rows.push(...(await load(date)).rows.values());
      return rows.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour || rowKey(a).localeCompare(rowKey(b)));
    }),
    prune: (now = Date.now()) => serial(async () => {
      const limit = zoned(now).minus({ days: DETAIL_DAYS }).toISODate()!;
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const match = /^details-(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(name);
        if (!match || match[1] >= limit) continue;
        const day = await load(match[1]).catch(() => null);
        // The summary must be on disk before its log goes.
        if (day && !(await stat(summaryPath(match[1])).then(s => s.size > 0, () => false))) await writeSummary(match[1], day);
        await rm(join(dir, name), { force: true });
        days.delete(match[1]);
      }
    }),
  };
}

/** The comparison the export gives: hours, views/pages and desktops side by side, with the derived means. */
export function usageReport(rows: UsageRow[], from: string, to: string) {
  type Total = { ms: number; entries: number; visitsWithoutInteraction: number; noInteractionMs: number; maxAgeMs: number; meanAgeS: number | null };
  const sums = new Map<string, { ms: number; entries: number; visitsWithoutInteraction: number; noInteractionMs: number; maxAgeMs: number; ageIntegral: number }>();
  const group = (kind: string, name: string, r: UsageRow) => {
    const key = `${kind}\t${name}`;
    const t = sums.get(key) ?? { ms: 0, entries: 0, visitsWithoutInteraction: 0, noInteractionMs: 0, maxAgeMs: 0, ageIntegral: 0 };
    t.ms += r.ms; t.entries += r.entries; t.visitsWithoutInteraction += r.visitsWithoutInteraction; t.noInteractionMs += r.noInteractionMs;
    t.ageIntegral += r.ageIntegral; t.maxAgeMs = Math.max(t.maxAgeMs, r.maxAgeMs);
    sums.set(key, t);
  };
  for (const r of rows) {
    group('byView', r.view === 'page' ? `page:${r.page}` : r.view === 'detail' ? `detail:${r.detail}` : r.view, r);
    group('byHour', String(r.hour).padStart(2, '0'), r);
    if (r.view === 'page' && r.page === 'home') group('byPulpit', `${r.browser}/${r.pulpit ?? '?'}`, r);
  }
  const out: Record<'byView' | 'byHour' | 'byPulpit', Record<string, Total>> = { byView: {}, byHour: {}, byPulpit: {} };
  for (const [key, t] of sums) {
    const [kind, name] = key.split('\t') as [keyof typeof out, string];
    const rest = (t.ms - t.noInteractionMs) / 1000;
    out[kind][name] = { ms: t.ms, entries: t.entries, visitsWithoutInteraction: t.visitsWithoutInteraction, noInteractionMs: t.noInteractionMs, maxAgeMs: t.maxAgeMs, meanAgeS: rest > 0 ? Math.round(t.ageIntegral / rest * 10) / 10 : null };
  }
  return { timeZone: USAGE_TIME_ZONE, from, to, rows, ...out };
}
