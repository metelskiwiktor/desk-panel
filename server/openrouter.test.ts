import { describe, expect, it, vi } from 'vitest';
import { createOpenRouterClient } from './openrouter';
import { SourceError } from './sources';

const KEY_URL = 'https://openrouter.ai/api/v1/key';
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function keyBody(data: Record<string, unknown> = {}): unknown {
  return {
    data: {
      usage_daily: 0,
      usage_weekly: 0,
      usage_monthly: 0,
      usage: 0,
      limit: null,
      limit_remaining: null,
      ...data,
    },
  };
}

function creditsBody(data: Record<string, unknown> = {}): unknown {
  return { data: { total_credits: 0, total_usage: 0, ...data } };
}

function fetchPair(key: unknown, credits: unknown) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === KEY_URL) return Promise.resolve(response(key));
    if (url === CREDITS_URL) return Promise.resolve(response(credits));
    return Promise.resolve(new Response('', { status: 404 }));
  });
}

describe('openrouter official key and account reading', () => {
  it('reads exactly GET /key and GET /credits with the same key, starting both before either resolves', async () => {
    const calls: string[] = [];
    const authorization: string[] = [];
    let resolveKey!: (value: Response) => void;
    let resolveCredits!: (value: Response) => void;
    const fetchFn = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push(url);
      authorization.push(String(new Headers(init?.headers).get('Authorization')));
      return new Promise<Response>(resolve => {
        if (url === KEY_URL) resolveKey = resolve;
        else resolveCredits = resolve;
      });
    });

    const client = createOpenRouterClient({ apiKey: 'shared-key', fetchFn: fetchFn as any, now: () => 1_000 });
    let settled = false;
    const reading = client.read().then(value => { settled = true; return value; });
    await Promise.resolve();

    expect(calls).toEqual([KEY_URL, CREDITS_URL]);
    expect(authorization).toEqual(['Bearer shared-key', 'Bearer shared-key']);
    expect(settled).toBe(false);

    resolveKey(response(keyBody()));
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveCredits(response(creditsBody()));
    await reading;
    expect(calls).toEqual([KEY_URL, CREDITS_URL]);
  });

  it('maps the four key counters 1:1 and the balance as total_credits minus total_usage', async () => {
    const fetchFn = fetchPair(
      keyBody({ usage_daily: 0.0123, usage_weekly: 1.5, usage_monthly: 9.75, usage: 42.5, limit: null, limit_remaining: null }),
      creditsBody({ total_credits: 100, total_usage: 60 }),
    );
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => 1_000 });

    await expect(client.read()).resolves.toEqual({
      dailyUsd: 0.0123,
      weeklyUsd: 1.5,
      monthlyUsd: 9.75,
      allTimeUsd: 42.5,
      balanceUsd: 40,
      limitUsd: null,
      limitRemainingUsd: null,
      observedAt: 1_000,
    });
  });

  it('keeps zero counters and a zero balance; the key usage never adds to the account balance', async () => {
    const fetchFn = fetchPair(
      keyBody({ usage_daily: 0, usage_weekly: 0, usage_monthly: 0, usage: 5, limit: 10, limit_remaining: 10 }),
      creditsBody({ total_credits: 7, total_usage: 7 }),
    );
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => 1_000 });

    const usage = await client.read();
    expect(usage.dailyUsd).toBe(0);
    expect(usage.weeklyUsd).toBe(0);
    expect(usage.monthlyUsd).toBe(0);
    expect(usage.balanceUsd).toBe(0);
    expect(usage.limitUsd).toBe(10);
    expect(usage.limitRemainingUsd).toBe(10);
  });

  it('allows a negative account balance and a numeric limit with a null remainder', async () => {
    const fetchFn = fetchPair(
      keyBody({ usage_daily: 0.0001, limit: 20, limit_remaining: null }),
      creditsBody({ total_credits: 3, total_usage: 8.5 }),
    );
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => 1_000 });

    const usage = await client.read();
    expect(usage.dailyUsd).toBe(0.0001);
    expect(usage.balanceUsd).toBe(-5.5);
    expect(usage.limitUsd).toBe(20);
    expect(usage.limitRemainingUsd).toBeNull();
  });
});

describe('openrouter requires both routes to succeed', () => {
  it('fails the whole read when /key fails while /credits succeeds', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url === KEY_URL ? new Response('', { status: 500 }) : response(creditsBody({ total_credits: 10 }))));
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => 1_000 });

    await expect(client.read()).rejects.toMatchObject({ status: 502 });
  });

  it('fails the whole read when /credits fails while /key succeeds', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url === CREDITS_URL ? new Response('', { status: 500 }) : response(keyBody())));
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => 1_000 });

    await expect(client.read()).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    ['missing', { data: { total_usage: 1 } }],
    ['null', creditsBody({ total_credits: null })],
    ['string', creditsBody({ total_credits: '10' })],
    ['negative', creditsBody({ total_credits: -1 })],
    ['non-finite', creditsBody({ total_credits: Number.POSITIVE_INFINITY })],
  ])('rejects %s total_credits as a format error', async (_name, credits) => {
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchPair(keyBody(), credits) as any, now: () => 1_000 });
    await expect(client.read()).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    ['missing', { data: { total_credits: 1 } }],
    ['null', creditsBody({ total_usage: null })],
    ['string', creditsBody({ total_usage: '1' })],
  ])('rejects %s total_usage as a format error', async (_name, credits) => {
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchPair(keyBody(), credits) as any, now: () => 1_000 });
    await expect(client.read()).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    ['missing daily', { usage_daily: undefined }],
    ['null weekly', { usage_weekly: null }],
    ['string monthly', { usage_monthly: '1' }],
    ['negative all time', { usage: -0.01 }],
    ['negative limit', { limit: -1 }],
    ['string limit_remaining', { limit_remaining: '2' }],
  ])('rejects a key payload with %s', async (_name, data) => {
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchPair(keyBody(data), creditsBody()) as any, now: () => 1_000 });
    await expect(client.read()).rejects.toMatchObject({ status: 502 });
  });

  it('fails on a network error, a malformed body and a timeout', async () => {
    const network = createOpenRouterClient({
      apiKey: 'k',
      fetchFn: vi.fn().mockRejectedValue(new Error('network')) as any,
      now: () => 1_000,
    });
    await expect(network.read()).rejects.toMatchObject({ status: 502 });

    const malformed = createOpenRouterClient({
      apiKey: 'k',
      fetchFn: vi.fn().mockImplementation((url: string) => Promise.resolve(
        url === KEY_URL ? new Response('not json', { status: 200 }) : response(creditsBody()))) as any,
      now: () => 1_000,
    });
    await expect(malformed.read()).rejects.toMatchObject({ status: 502 });

    vi.useFakeTimers();
    try {
      const timeoutFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
      const timeout = createOpenRouterClient({ apiKey: 'k', fetchFn: timeoutFetch as any, now: () => 1_000 });
      const reading = timeout.read();
      const assertion = expect(reading).rejects.toMatchObject({ status: 502 });
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers 503 for a missing key and for 401/403 on either route', async () => {
    await expect(createOpenRouterClient({ apiKey: '  ' }).read()).rejects.toMatchObject({ status: 503 });

    for (const status of [401, 403]) {
      const keyDenied = createOpenRouterClient({
        apiKey: 'k',
        fetchFn: vi.fn().mockImplementation((url: string) => Promise.resolve(
          url === KEY_URL ? new Response('', { status }) : response(creditsBody()))) as any,
        now: () => 1_000,
      });
      await expect(keyDenied.read()).rejects.toMatchObject({ status: 503 });

      const creditsDenied = createOpenRouterClient({
        apiKey: 'k',
        fetchFn: vi.fn().mockImplementation((url: string) => Promise.resolve(
          url === CREDITS_URL ? new Response('', { status }) : response(keyBody()))) as any,
        now: () => 1_000,
      });
      await expect(creditsDenied.read()).rejects.toMatchObject({ status: 503 });
    }
  });

  it('never caches a partial or failed reading', async () => {
    let now = 1_000;
    let creditsFails = true;
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url === KEY_URL) return Promise.resolve(response(keyBody({ usage_daily: 1 })));
      if (creditsFails) return Promise.resolve(new Response('', { status: 500 }));
      return Promise.resolve(response(creditsBody({ total_credits: 10, total_usage: 2 })));
    });
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => now });

    await expect(client.read()).rejects.toBeInstanceOf(SourceError);
    creditsFails = false;
    now = 1_500;
    await expect(client.read()).resolves.toMatchObject({ balanceUsd: 8, observedAt: 1_500 });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

describe('openrouter cache', () => {
  it('serves a complete reading from memory for 60 s without requesting either route or changing observedAt', async () => {
    let now = 1_000_000;
    const fetchFn = fetchPair(keyBody({ usage_daily: 1 }), creditsBody({ total_credits: 10, total_usage: 2 }));
    const client = createOpenRouterClient({ apiKey: 'k', fetchFn: fetchFn as any, now: () => now });

    const first = await client.read();
    expect(first.observedAt).toBe(1_000_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    now += 59_999;
    const cachedReading = await client.read();
    expect(cachedReading).toEqual(first);
    expect(cachedReading.observedAt).toBe(1_000_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    now += 1;
    const refreshed = await client.read();
    expect(refreshed.observedAt).toBe(1_060_000);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});
