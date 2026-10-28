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

export function parseLogLine(line: string): ParsedLogCall | null {
  if (!/\bprovider=openrouter\b/.test(line)) return null;
  const idMatch = /\bid=(gen-[A-Za-z0-9_-]+)/.exec(line);
  if (!idMatch) return null;
  const modelMatch = /\bmodel=([^\s,]+)/.exec(line);
  if (!modelMatch) return null;

  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(line);
  const day = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

  return {
    id: idMatch[1],
    model: modelMatch[1],
    day,
  };
}

export function scanLog(
  logPath: string,
  currentOffset: number,
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
        const call = parseLogLine(line);
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

export interface OpenRouterCache {
  logOffset: number;
  generations: Record<string, { day: string; model: string; costUsd: number }>;
  pending: Array<{ id: string; model: string; day: string }>;
}

export function readCache(file: string): OpenRouterCache {
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      return {
        logOffset: typeof raw.logOffset === 'number' ? raw.logOffset : 0,
        generations: raw.generations && typeof raw.generations === 'object' ? raw.generations : {},
        pending: Array.isArray(raw.pending) ? raw.pending : [],
      };
    }
  } catch {
    // corrupted or unreadable cache defaults cleanly
  }
  return { logOffset: 0, generations: {}, pending: [] };
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
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dayList.push(str);
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
}

export function createOpenRouterClient(options: OpenRouterClientOptions = {}): OpenRouterClient {
  const fetchFn = options.fetchFn ?? fetch;
  const nowFn = options.now ?? Date.now;
  const logPath = options.logPath ?? defaultHermesLogPath();
  const cacheFile = options.cacheFile ?? defaultOpenRouterCachePath();
  const maxLookups = options.maxLookupsPerRead ?? 25;

  let cachedTotals: {
    at: number;
    allTimeUsd: number;
    credits: { totalUsd: number | null; usedUsd: number | null; remainingUsd: number | null };
  } | null = null;

  return {
    async read(): Promise<OpenRouterUsage> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        throw new SourceError(503);
      }

      const now = nowFn();

      // 1. Fetch totals from OpenRouter (cached in-memory for 60s)
      if (!cachedTotals || now - cachedTotals.at > 60_000) {
        let keyRes: Response;
        let creditsRes: Response;
        try {
          [keyRes, creditsRes] = await Promise.all([
            fetchFn('https://openrouter.ai/api/v1/key', {
              headers: { Authorization: `Bearer ${apiKey}` },
            }),
            fetchFn('https://openrouter.ai/api/v1/credits', {
              headers: { Authorization: `Bearer ${apiKey}` },
            }),
          ]);
        } catch {
          throw new SourceError(502);
        }

        if (!keyRes.ok || !creditsRes.ok) {
          throw new SourceError(502);
        }

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

        cachedTotals = {
          at: now,
          allTimeUsd: Math.round(allTimeUsd * 100) / 100,
          credits: {
            totalUsd: totalCredits !== null ? Math.round(totalCredits * 100) / 100 : null,
            usedUsd: totalUsage !== null ? Math.round(totalUsage * 100) / 100 : null,
            remainingUsd: remainingUsd !== null ? Math.round(remainingUsd * 100) / 100 : null,
          },
        };
      }

      // 2. Scan Hermes log
      const cache = readCache(cacheFile);
      const { calls, newOffset } = scanLog(logPath, cache.logOffset);
      cache.logOffset = newOffset;

      for (const call of calls) {
        if (!cache.generations[call.id] && !cache.pending.some(p => p.id === call.id)) {
          cache.pending.push(call);
        }
      }

      // 3. Resolve pending lookups (capped)
      if (cache.pending.length > 0) {
        const batch = cache.pending.slice(0, maxLookups);
        const resolvedIds = new Set<string>();

        for (const item of batch) {
          try {
            const res = await fetchFn(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(item.id)}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.ok) {
              const data = await res.json() as any;
              const costUsd = Number(data?.data?.total_cost ?? data?.data?.usage ?? 0);
              const model = String(data?.data?.model || item.model);
              const day = item.day;
              cache.generations[item.id] = {
                day,
                model,
                costUsd: isNaN(costUsd) ? 0 : costUsd,
              };
              resolvedIds.add(item.id);
            }
          } catch {
            // keep pending for next read
          }
        }

        if (resolvedIds.size > 0) {
          cache.pending = cache.pending.filter(p => !resolvedIds.has(p.id));
        }
      }

      writeCache(cacheFile, cache);

      // 4. Build 30-day aggregation
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
  };
}
