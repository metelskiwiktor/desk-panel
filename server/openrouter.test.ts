import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDailyAggregation,
  createOpenRouterClient,
  localDay,
  MAX_LOOKUP_ATTEMPTS,
  parseLogLine,
  readCache,
  scanLog,
  writeCache,
} from './openrouter';
import { SourceError } from './sources';

describe('openrouter log-line parsing', () => {
  it('parses valid Hermes API call line with provider=openrouter and id=gen-...', () => {
    const line = '2026-10-28 16:55:41,139 INFO [desk-panel-123] agent.conversation_loop: API call #1: model=deepseek/deepseek-v4.1-flash-1017 provider=openrouter in=17514 out=68 total=17582 latency=2.5s cache=2048/17514 (12%) id=gen-1793202940-I2y6V33UXxPavx5wGt6H upstream=InferenceNet';
    const parsed = parseLogLine(line);
    expect(parsed).toEqual({
      id: 'gen-1793202940-I2y6V33UXxPavx5wGt6H',
      model: 'deepseek/deepseek-v4.1-flash-1017',
      day: '2026-10-28',
    });
  });

  it('ignores lines from other providers even if they have an id', () => {
    const line = '2026-10-28 16:55:41,139 INFO agent: API call #1: model=claude-3-5-sonnet provider=anthropic id=gen-12345';
    expect(parseLogLine(line)).toBeNull();
  });

  it('ignores openrouter lines without generation id', () => {
    const line = '2026-10-28 16:55:37,757 INFO run_agent: OpenAI client created provider=openrouter model=deepseek/deepseek-v4.1-flash-1017';
    expect(parseLogLine(line)).toBeNull();
  });

  it('tolerates missing or rotated log files without crashing', () => {
    const missing = scanLog('C:/non-existent-hermes.log', 0);
    expect(missing).toEqual({ calls: [], newOffset: 0 });
  });
});

describe('openrouter cache and lookups', () => {
  let tmpDir: string;
  let logFile: string;
  let cacheFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openrouter-test-'));
    logFile = join(tmpDir, 'agent.log');
    cacheFile = join(tmpDir, 'openrouter-cache.json');
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('reads new lines incrementally and advances log offset', () => {
    const line1 = '2026-10-28 10:00:00,000 INFO agent: API call #1: model=deepseek/chat provider=openrouter id=gen-111\n';
    writeFileSync(logFile, line1, 'utf8');

    const first = scanLog(logFile, 0);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0].id).toBe('gen-111');
    expect(first.newOffset).toBeGreaterThan(0);

    // Repeated scan with same offset yields no duplicates
    const repeated = scanLog(logFile, first.newOffset);
    expect(repeated.calls).toHaveLength(0);
    expect(repeated.newOffset).toBe(first.newOffset);

    // Appending a second line only returns the new call
    const line2 = '2026-10-28 11:00:00,000 INFO agent: API call #2: model=openai/gpt-4o provider=openrouter id=gen-222\n';
    writeFileSync(logFile, line1 + line2, 'utf8');

    const second = scanLog(logFile, first.newOffset);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].id).toBe('gen-222');
    expect(second.newOffset).toBeGreaterThan(first.newOffset);
  });

  it('reuses cache and never looks up the same id twice', async () => {
    const line = '2026-10-28 12:00:00,000 INFO agent: API call #1: model=deepseek/chat provider=openrouter id=gen-abc\n';
    writeFileSync(logFile, line, 'utf8');

    const generationFetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/generation?id=gen-abc')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            id: 'gen-abc',
            model: 'deepseek/chat',
            total_cost: 0.05,
            created_at: '2026-10-28T12:00:00Z',
          },
        }), { status: 200 }));
      }
      if (url.includes('/api/v1/key')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: { usage: 10.5, limit: null, limit_remaining: null },
        }), { status: 200 }));
      }
      if (url.includes('/api/v1/credits')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: { total_credits: 50, total_usage: 10.5 },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const client = createOpenRouterClient({
      apiKey: 'test-key',
      logPath: logFile,
      cacheFile,
      fetchFn: generationFetchSpy as any,
      now: () => new Date('2026-10-28T12:00:00Z').getTime(),
    });

    const result1 = await client.read();
    expect(result1.totals.allTimeUsd).toBe(10.5);
    expect(result1.credits.remainingUsd).toBe(39.5);
    const dayData1 = result1.days.find(d => d.day === '2026-10-28');
    expect(dayData1?.totalUsd).toBe(0.05);

    // Verify written cache
    const cached = readCache(cacheFile);
    expect(cached.generations['gen-abc']).toEqual({
      day: '2026-10-28',
      model: 'deepseek/chat',
      costUsd: 0.05,
    });
    expect(cached.pending).toHaveLength(0);

    const callCountAfterFirstRead = generationFetchSpy.mock.calls.filter(c => c[0].includes('/generation')).length;
    expect(callCountAfterFirstRead).toBe(1);

    // Second read: should reuse cached generation and NOT call /generation again
    const result2 = await client.read();
    const dayData2 = result2.days.find(d => d.day === '2026-10-28');
    expect(dayData2?.totalUsd).toBe(0.05);

    const callCountAfterSecondRead = generationFetchSpy.mock.calls.filter(c => c[0].includes('/generation')).length;
    expect(callCountAfterSecondRead).toBe(1); // Still 1! Never looked up twice!
  });

  it('leaves failed generation lookups pending for next read', async () => {
    const line = '2026-10-28 12:00:00,000 INFO agent: API call #1: model=deepseek/chat provider=openrouter id=gen-fail\n';
    writeFileSync(logFile, line, 'utf8');

    let failGeneration = true;
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/generation?id=gen-fail')) {
        if (failGeneration) {
          return Promise.resolve(new Response('rate limit', { status: 429 }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            id: 'gen-fail',
            model: 'deepseek/chat',
            total_cost: 0.08,
            created_at: '2026-10-28T12:00:00Z',
          },
        }), { status: 200 }));
      }
      if (url.includes('/api/v1/key')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { usage: 1 } }), { status: 200 }));
      }
      if (url.includes('/api/v1/credits')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 1 } }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const client = createOpenRouterClient({
      apiKey: 'test-key',
      logPath: logFile,
      cacheFile,
      fetchFn: fetchSpy as any,
      now: () => new Date('2026-10-28T12:00:00Z').getTime(),
    });

    // First read: fails to resolve generation
    const res1 = await client.read();
    expect(res1.totals.windowUsd).toBe(0);
    const cached1 = readCache(cacheFile);
    expect(cached1.pending).toHaveLength(1);
    expect(cached1.pending[0].id).toBe('gen-fail');
    expect(cached1.generations['gen-fail']).toBeUndefined();

    // Now generation endpoint succeeds on next read
    failGeneration = false;
    const res2 = await client.read();
    expect(res2.totals.windowUsd).toBe(0.08);
    const cached2 = readCache(cacheFile);
    expect(cached2.pending).toHaveLength(0);
    expect(cached2.generations['gen-fail']).toEqual({
      day: '2026-10-28',
      model: 'deepseek/chat',
      costUsd: 0.08,
    });
  });

  it('never lets lookups that keep failing hold up the generations behind them', async () => {
    // More dead ids than one read looks up (3), ahead of a good one: a 404 and a 500 that never recovers.
    const ids = ['gen-gone1', 'gen-gone2', 'gen-broken1', 'gen-broken2', 'gen-ok'];
    writeFileSync(logFile, ids.map(id => `2026-10-28 12:00:00,000 INFO agent: API call #1: model=deepseek/chat provider=openrouter id=${id}\n`).join(''), 'utf8');
    const lookups: string[] = [];
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/key')) return Promise.resolve(new Response(JSON.stringify({ data: { usage: 1 } }), { status: 200 }));
      if (url.includes('/api/v1/credits')) return Promise.resolve(new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 1 } }), { status: 200 }));
      const id = new URL(url).searchParams.get('id')!;
      lookups.push(id);
      if (id.startsWith('gen-gone')) return Promise.resolve(new Response('not found', { status: 404 }));
      if (id.startsWith('gen-broken')) return Promise.resolve(new Response('error', { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify({ data: { model: 'deepseek/chat', total_cost: 0.02 } }), { status: 200 }));
    });
    const client = createOpenRouterClient({ apiKey: 'test-key', logPath: logFile, cacheFile, fetchFn: fetchSpy as any, maxLookupsPerRead: 3, now: () => new Date('2026-10-28T12:00:00Z').getTime() });

    await client.read();
    // Read 1 took the first three: the 404s are set aside at once, the 500 goes to the back.
    expect(readCache(cacheFile).failed.map(f => f.id)).toEqual(['gen-gone1', 'gen-gone2']);
    expect(readCache(cacheFile).pending.map(p => p.id)).toEqual(['gen-broken2', 'gen-ok', 'gen-broken1']);
    const second = await client.read();
    expect(second.totals.windowUsd).toBe(0.02);
    expect(readCache(cacheFile).generations['gen-ok']).toMatchObject({ costUsd: 0.02 });
    // The 500s are retried until MAX_LOOKUP_ATTEMPTS, then set aside too; nothing is looked up after that.
    for (let i = 0; i < MAX_LOOKUP_ATTEMPTS; i++) await client.read();
    expect(readCache(cacheFile)).toMatchObject({ pending: [] });
    expect(readCache(cacheFile).failed.map(f => f.id).sort()).toEqual(['gen-broken1', 'gen-broken2', 'gen-gone1', 'gen-gone2']);
    const before = lookups.length;
    await client.read();
    expect(lookups.length).toBe(before);
    expect(lookups.filter(id => id === 'gen-broken1')).toHaveLength(MAX_LOOKUP_ATTEMPTS);
  });

  it('puts a line without its own date on the local day, as the chart counts days', () => {
    const at = new Date(2026, 9, 29, 0, 30).getTime(); // 00:30 local: in Warsaw still the 28th in UTC
    expect(parseLogLine('API call #1: model=deepseek/chat provider=openrouter id=gen-x', at)?.day).toBe('2026-10-29');
    expect(localDay(at)).toBe('2026-10-29');
  });
});

describe('openrouter aggregation and error handling', () => {
  it('aggregates daily spend per model over 30 days', () => {
    const now = new Date('2026-10-28T12:00:00Z').getTime();
    const generations = {
      'gen-1': { day: '2026-10-28', model: 'anthropic/claude-3.5-sonnet', costUsd: 0.12 },
      'gen-2': { day: '2026-10-28', model: 'openai/gpt-4o', costUsd: 0.08 },
      'gen-3': { day: '2026-10-27', model: 'deepseek/deepseek-chat', costUsd: 0.02 },
      'gen-old': { day: '2026-08-01', model: 'deepseek/deepseek-chat', costUsd: 1.50 }, // outside 30 days
    };

    const { days, windowUsd } = buildDailyAggregation(generations, now);
    expect(days).toHaveLength(30);
    expect(days[29].day).toBe('2026-10-28');
    expect(days[29].totalUsd).toBe(0.2);
    expect(days[29].models).toHaveLength(2);
    expect(days[29].models[0]).toEqual({
      id: 'anthropic/claude-3.5-sonnet',
      label: 'claude-3.5-sonnet',
      usd: 0.12,
    });
    expect(days[28].day).toBe('2026-10-27');
    expect(days[28].totalUsd).toBe(0.02);

    expect(windowUsd).toBe(0.22); // excludes gen-old
  });

  it('throws 503 SourceError when apiKey is missing or empty', async () => {
    const client = createOpenRouterClient({ apiKey: '' });
    await expect(client.read()).rejects.toThrow(SourceError);
    await expect(client.read()).rejects.toMatchObject({ status: 503 });
  });

  it('throws 502 SourceError when OpenRouter upstream fails', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const client = createOpenRouterClient({
      apiKey: 'test-key',
      fetchFn: failingFetch as any,
    });

    await expect(client.read()).rejects.toThrow(SourceError);
    await expect(client.read()).rejects.toMatchObject({ status: 502 });
  });
});
