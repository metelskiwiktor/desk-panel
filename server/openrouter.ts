import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OpenRouterDayUsage, OpenRouterModelUsage, OpenRouterUsage } from '../src/openrouter-contract';
import { SourceError } from './sources';

export interface ParsedLogCall {
  id: string;
  model: string;
  day: string;
}

/** The local calendar day (YYYY-MM-DD) of a moment: Hermes logs local time and the chart counts local days. */
export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseLogLine(line: string, now: number = Date.now()): ParsedLogCall | null {
  if (!/\bprovider=openrouter\b/.test(line)) return null;
  const idMatch = /\bid=(gen-[A-Za-z0-9_-]+)/.exec(line);
  if (!idMatch) return null;
  const modelMatch = /\bmodel=([^\s,]+)/.exec(line);
  if (!modelMatch) return null;

  // A line without its own date (a continuation) belongs to today in local time, not in UTC: near midnight they differ.
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(line);
  const day = dateMatch ? dateMatch[1] : localDay(now);

  return {
    id: idMatch[1],
    model: modelMatch[1],
    day,
  };
}

export function scanLog(
  logPath: string,
  currentOffset: number,
  now: number = Date.now(),
): { calls: ParsedLogCall[]; newOffset: number } {
  if (!existsSync(logPath)) {
    return { calls: [], newOffset: 0 };
  }
  try {
    const stat = statSync(logPath);
    let offset = currentOffset;
    if (stat.size < offset) {
      // File was rotated or truncated
      offset = 0;
    }
    if (stat.size === offset) {
      return { calls: [], newOffset: offset };
    }

    const fd = openSync(logPath, 'r');
    try {
      const bytesToRead = stat.size - offset;
      const buffer = Buffer.alloc(bytesToRead);
      readSync(fd, buffer, 0, bytesToRead, offset);
      const text = buffer.toString('utf8');
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline === -1) {
        return { calls: [], newOffset: offset };
      }

      const completeChunk = text.slice(0, lastNewline);
      const lines = completeChunk.split(/\r?\n/);
      const calls: ParsedLogCall[] = [];
      for (const line of lines) {
        const call = parseLogLine(line, now);
        if (call) calls.push(call);
      }

      const advancedBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8');
      return { calls, newOffset: offset + advancedBytes };
    } finally {
      closeSync(fd);
    }
  } catch {
    return { calls: [], newOffset: currentOffset };
  }
}

/**
 * `pending`: generations whose cost is still to be read, oldest first; `attempts` counts failed lookups. `failed`:
 * generations set aside for good (OpenRouter answered 404, or the lookup failed MAX_LOOKUP_ATTEMPTS times), so they
 * can never hold up the ones behind them.
 */
export interface PendingCall extends ParsedLogCall { attempts?: number }
export interface OpenRouterCache {
  logOffset: number;
  generations: Record<string, { day: string; model: string; costUsd: number }>;
  pending: PendingCall[];
  failed: ParsedLogCall[];
}
export const MAX_LOOKUP_ATTEMPTS = 5;
const FAILED_KEPT = 1000;

export function readCache(file: string): OpenRouterCache {
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      return {
        logOffset: typeof raw.logOffset === 'number' ? raw.logOffset : 0,
        generations: raw.generations && typeof raw.generations === 'object' ? raw.generations : {},
        pending: Array.isArray(raw.pending) ? raw.pending : [],
        failed: Array.isArray(raw.failed) ? raw.failed : [],
      };
    }
  } catch {
    // corrupted or unreadable cache defaults cleanly
  }
  return { logOffset: 0, generations: {}, pending: [], failed: [] };
}

export function writeCache(file: string, cache: OpenRouterCache): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  renameSync(tmp, file);
}

export function buildDailyAggregation(
  generations: Record<string, { day: string; model: string; costUsd: number }>,
  now: number,
): { days: OpenRouterDayUsage[]; windowUsd: number } {
  const dayList: string[] = [];
  const date = new Date(now);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    dayList.push(localDay(d.getTime()));
  }
  const daySet = new Set(dayList);

  const dayMap = new Map<string, Map<string, number>>();
  for (const d of dayList) {
    dayMap.set(d, new Map());
  }

  for (const gen of Object.values(generations)) {
    if (daySet.has(gen.day)) {
      const m = dayMap.get(gen.day)!;
      m.set(gen.model, (m.get(gen.model) ?? 0) + gen.costUsd);
    }
  }

  let windowUsd = 0;
  const days: OpenRouterDayUsage[] = dayList.map(dayStr => {
    const m = dayMap.get(dayStr)!;
    let totalUsd = 0;
    const models: OpenRouterModelUsage[] = [];
    for (const [id, usd] of m.entries()) {
      const rounded = Math.round(usd * 10000) / 10000;
      totalUsd += rounded;
      models.push({
        id,
        label: id.includes('/') ? id.split('/')[1] : id,
        usd: rounded,
      });
    }
    totalUsd = Math.round(totalUsd * 10000) / 10000;
    windowUsd += totalUsd;
    models.sort((a, b) => b.usd - a.usd);
    return {
      day: dayStr,
      totalUsd,
      models,
    };
  });

  windowUsd = Math.round(windowUsd * 10000) / 10000;
  return { days, windowUsd };
}

export interface OpenRouterClientOptions {
  apiKey?: string;
  logPath?: string;
  cacheFile?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  maxLookupsPerRead?: number;
  /** Tests only: each read looks up one batch before it answers, as before the lookups moved to the background. */
  waitForLookups?: boolean;
}

export function defaultHermesLogPath(): string {
  if (process.env.HERMES_LOG_PATH) return process.env.HERMES_LOG_PATH;
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'hermes', 'logs', 'agent.log');
  return join(homedir(), '.hermes', 'logs', 'agent.log');
}

export function defaultOpenRouterCachePath(): string {
  return join(homedir(), '.desk-panel', 'openrouter-cache.json');
}

export interface OpenRouterClient {
  read(): Promise<OpenRouterUsage>;
  /** Resolves when the background work started by reads (cost lookups, a totals refresh) is done. */
  settled(): Promise<void>;
}

type Totals = { at: number; allTimeUsd: number; credits: { totalUsd: number | null; usedUsd: number | null; remainingUsd: number | null } };
const TOTALS_FRESH_MS = 60_000;

/**
 * A read answers at once from what the panel already knows. The cost lookups run in the background, batch after batch
 * while they get answers: waiting for 25 of them in the request took about 6 s per read (28.10.2026), on every switch of
 * desktop. The cache lives in memory (loaded once, written after each change), so the background and the requests never
 * overwrite each other's file. Totals older than a minute are refreshed in the background too; only the first read waits.
 */
export function createOpenRouterClient(options: OpenRouterClientOptions = {}): OpenRouterClient {
  const fetchFn = options.fetchFn ?? fetch;
  const nowFn = options.now ?? Date.now;
  const logPath = options.logPath ?? defaultHermesLogPath();
  const cacheFile = options.cacheFile ?? defaultOpenRouterCachePath();
  const maxLookups = options.maxLookupsPerRead ?? 25;

  let cachedTotals: Totals | null = null;
  let cache: OpenRouterCache | null = null;
  let draining: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  const save = () => { try { if (cache) writeCache(cacheFile, cache); } catch { /* kept in memory; the next change writes it */ } };

  async function fetchTotals(apiKey: string, now: number): Promise<Totals> {
    let keyRes: Response;
    let creditsRes: Response;
    try {
      [keyRes, creditsRes] = await Promise.all([
        fetchFn('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${apiKey}` } }),
        fetchFn('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${apiKey}` } }),
      ]);
    } catch {
      throw new SourceError(502);
    }
    if (!keyRes.ok || !creditsRes.ok) throw new SourceError(502);

    let keyData: any;
    let creditsData: any;
    try {
      keyData = await keyRes.json();
      creditsData = await creditsRes.json();
    } catch {
      throw new SourceError(502);
    }

    const allTimeUsd = Number(keyData?.data?.usage ?? creditsData?.data?.total_usage ?? 0);
    const limit = typeof keyData?.data?.limit === 'number' ? keyData.data.limit : null;
    const limitRemaining = typeof keyData?.data?.limit_remaining === 'number' ? keyData.data.limit_remaining : null;
    const totalCredits = typeof creditsData?.data?.total_credits === 'number' ? creditsData.data.total_credits : null;
    const totalUsage = typeof creditsData?.data?.total_usage === 'number' ? creditsData.data.total_usage : null;

    let remainingUsd: number | null = null;
    if (limit !== null && limitRemaining !== null) {
      remainingUsd = limitRemaining;
    } else if (totalCredits !== null && totalUsage !== null) {
      remainingUsd = totalCredits - totalUsage;
    }

    return {
      at: now,
      allTimeUsd: Math.round(allTimeUsd * 100) / 100,
      credits: {
        totalUsd: totalCredits !== null ? Math.round(totalCredits * 100) / 100 : null,
        usedUsd: totalUsage !== null ? Math.round(totalUsage * 100) / 100 : null,
        remainingUsd: remainingUsd !== null ? Math.round(remainingUsd * 100) / 100 : null,
      },
    };
  }

  /**
   * One batch of cost lookups from the head of the queue; true when one of them got an answer. A failed lookup goes to
   * the back with an attempt count, so ids that keep failing cannot take the whole batch every time and stop the chart
   * from growing; after a 404 or MAX_LOOKUP_ATTEMPTS failures it is set aside.
   */
  async function lookupBatch(apiKey: string): Promise<boolean> {
    const queue = cache!;
    if (queue.pending.length === 0) return false;
    const batch = queue.pending.slice(0, maxLookups);
    const retry: PendingCall[] = [];
    let answered = false;

    for (const item of batch) {
      let status = 0;
      try {
        const res = await fetchFn(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(item.id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        status = res.status;
        if (res.ok) {
          const data = await res.json() as any;
          const costUsd = Number(data?.data?.total_cost ?? data?.data?.usage ?? 0);
          const model = String(data?.data?.model || item.model);
          queue.generations[item.id] = {
            day: item.day,
            model,
            costUsd: isNaN(costUsd) ? 0 : costUsd,
          };
          answered = true;
          continue;
        }
      } catch {
        // a network error counts as one failed attempt
      }
      const attempts = (item.attempts ?? 0) + 1;
      if (status === 404 || attempts >= MAX_LOOKUP_ATTEMPTS) queue.failed.push({ id: item.id, model: item.model, day: item.day });
      else retry.push({ ...item, attempts });
    }

    // Ids the log added while the batch ran stay behind the ones still queued, ahead of the retries.
    const done = new Set(batch.map(item => item.id));
    queue.pending = [...queue.pending.filter(item => !done.has(item.id)), ...retry];
    if (queue.failed.length > FAILED_KEPT) queue.failed = queue.failed.slice(-FAILED_KEPT);
    save();
    return answered;
  }

  /** Batch after batch while lookups get answers; a batch where all failed waits for the next read. */
  function drain(apiKey: string): void {
    if (draining) return;
    draining = (async () => {
      while (await lookupBatch(apiKey)) { /* next batch */ }
    })().catch(() => { /* the queue stays for the next read */ }).finally(() => { draining = null; });
  }

  return {
    async read(): Promise<OpenRouterUsage> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        throw new SourceError(503);
      }

      const now = nowFn();

      // 1. Totals: the first read waits for them; later ones show the last and refresh in the background.
      if (!cachedTotals) {
        cachedTotals = await fetchTotals(apiKey, now);
      } else if (now - cachedTotals.at > TOTALS_FRESH_MS && !refreshing) {
        refreshing = fetchTotals(apiKey, now)
          .then(totals => { cachedTotals = totals; })
          .catch(() => { /* the last totals stay until the next try */ })
          .finally(() => { refreshing = null; });
      }

      // 2. New calls from Hermes's log join the queue.
      cache ??= readCache(cacheFile);
      const { calls, newOffset } = scanLog(logPath, cache.logOffset, now);
      cache.logOffset = newOffset;
      const known = new Set([...Object.keys(cache.generations), ...cache.pending.map(p => p.id), ...cache.failed.map(f => f.id)]);
      for (const call of calls) {
        if (!known.has(call.id)) { cache.pending.push(call); known.add(call.id); }
      }
      save();

      // 3. Their costs: in the background, or one batch now (tests).
      if (options.waitForLookups) await lookupBatch(apiKey);
      else drain(apiKey);

      // 4. Build 30-day aggregation from what is known now.
      const { days, windowUsd } = buildDailyAggregation(cache.generations, now);

      return {
        days,
        totals: {
          windowUsd,
          allTimeUsd: cachedTotals.allTimeUsd,
        },
        credits: cachedTotals.credits,
        observedAt: now,
      };
    },

    async settled(): Promise<void> {
      while (draining || refreshing) await Promise.all([draining, refreshing]);
    },
  };
}
