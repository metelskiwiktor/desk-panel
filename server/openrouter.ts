import type { OpenRouterUsage } from '../src/openrouter-contract';
import { SourceError } from './sources';

export interface OpenRouterClientOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface OpenRouterClient {
  read(): Promise<OpenRouterUsage>;
}

const KEY_URL = 'https://openrouter.ai/api/v1/key';
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_FRESH_MS = 60_000;

type JsonObject = Record<string, unknown>;

function badFormat(): SourceError {
  return new SourceError(502, 'unexpected OpenRouter payload');
}

function nonNegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw badFormat();
  return value;
}

function nullableNonNegative(value: unknown): number | null {
  if (value === null) return null;
  return nonNegative(value);
}

function nullableFinite(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badFormat();
  return value;
}

async function fetchJson(fetchFn: typeof fetch, url: string, apiKey: string): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } catch {
      throw new SourceError(502);
    }
    if (response.status === 401 || response.status === 403) throw new SourceError(503);
    if (!response.ok) throw new SourceError(502);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw badFormat();
    }
    if (!body || typeof body !== 'object') throw badFormat();
    return body as JsonObject;
  } finally {
    clearTimeout(timer);
  }
}

function dataOf(body: JsonObject): JsonObject {
  const data = body.data;
  if (!data || typeof data !== 'object') throw badFormat();
  return data as JsonObject;
}

/**
 * Official counters of the current key: today, week, month, all time, and its limit. The tile shows them next to the
 * account balance, so the two scopes stay visibly apart.
 */
export function createOpenRouterClient(options: OpenRouterClientOptions = {}): OpenRouterClient {
  const fetchFn = options.fetchFn ?? fetch;
  const nowFn = options.now ?? Date.now;
  let cached: OpenRouterUsage | null = null;
  let cachedAt = 0;

  return {
    async read(): Promise<OpenRouterUsage> {
      const apiKey = options.apiKey?.trim();
      if (!apiKey) throw new SourceError(503);

      const requestedAt = nowFn();
      if (cached && requestedAt - cachedAt < CACHE_FRESH_MS) return cached;

      const [keyBody, creditsBody] = await Promise.all([
        fetchJson(fetchFn, KEY_URL, apiKey),
        fetchJson(fetchFn, CREDITS_URL, apiKey),
      ]);

      const key = dataOf(keyBody);
      const credits = dataOf(creditsBody);
      const totalCredits = nonNegative(credits.total_credits);
      const totalUsage = nonNegative(credits.total_usage);

      const usage: OpenRouterUsage = {
        dailyUsd: nonNegative(key.usage_daily),
        weeklyUsd: nonNegative(key.usage_weekly),
        monthlyUsd: nonNegative(key.usage_monthly),
        allTimeUsd: nonNegative(key.usage),
        balanceUsd: totalCredits - totalUsage,
        limitUsd: nullableNonNegative(key.limit),
        limitRemainingUsd: nullableFinite(key.limit_remaining),
        observedAt: nowFn(),
      };

      cached = usage;
      cachedAt = usage.observedAt;
      return usage;
    },
  };
}
