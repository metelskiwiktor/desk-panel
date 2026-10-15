import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createSystemReader } from '../server/system';
import { systemSourceSchema } from './system-contract';
import { useSystem } from './useSystem';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  let now = 10000;
  let user = 100;
  let idle = 700;
  let total = 32 * 1024 ** 3;
  const deps = { now: () => now, totalmem: () => total, freemem: () => 8 * 1024 ** 3,
    cpus: () => Array.from({ length: 2 }, () => ({ model: 'Test CPU', speed: 1000, times: { user, idle, sys: 0, irq: 0, nice: 0 } })),
  };
  const read = createSystemReader(deps);
  return { read, advance: (ms = 2000, busy = 50, resting = 50) => { now += ms; user += busy; idle += resting; }, reset: () => { user = 0; idle = 0; }, invalid: () => { total = 0; } };
}
describe('system measurements', () => {
  it('needs two measurements, computes CPU from deltas across cores and reports physical memory in GiB', () => {
    const s = setup();
    expect(s.read()).toMatchObject({ status: 'loading', data: null });
    s.advance();
    const value = s.read();
    expect(value.status).toBe('connected');
    expect(value.data![0]).toMatchObject({ at: 12000, cpuPercent: 50, ramUsedGb: 24, ramTotalGb: 32 });
    expect(s.read()).toEqual(value); // Multiple readers don't append duplicate samples.
    s.advance(2000, 0, 100);
    expect(s.read().data!.at(-1)!.cpuPercent).toBe(0);
  });
  it('bounds history and starts a new history after sleep or a long gap', () => {
    const s = setup(); s.read();
    for (let i = 0; i < 200; i++) { s.advance(); s.read(); }
    expect(s.read().data).toHaveLength(150);
    s.advance(20000);
    expect(s.read()).toMatchObject({ status: 'loading', data: null });
    s.advance();
    expect(s.read().data).toHaveLength(1);
  });
  it('does not turn reset counters or unavailable memory into a zero result', () => {
    const s = setup(); s.read(); s.advance(); const old = s.read();
    s.advance(); s.reset();
    expect(s.read()).toMatchObject({ status: 'unavailable', data: old.data, observedAt: old.observedAt });
    s.advance(); expect(s.read().status).toBe('loading');
    s.advance(); expect(s.read().status).toBe('connected');
    s.advance(); s.invalid(); expect(s.read().status).toBe('unavailable');
  });
  it('rejects invalid percentages, memory and unordered history on the browser boundary', () => {
    const sample = { at: 10, cpuPercent: 50, ramUsedGb: 2, ramTotalGb: 4 };
    const value = { live: true, name: 'Komputer', status: 'connected', observedAt: 10, data: [sample] };
    expect(systemSourceSchema.safeParse(value).success).toBe(true);
    expect(systemSourceSchema.safeParse({ ...value, data: [{ ...sample, cpuPercent: 101 }] }).success).toBe(false);
    expect(systemSourceSchema.safeParse({ ...value, data: [{ ...sample, ramUsedGb: 8 }] }).success).toBe(false);
    expect(systemSourceSchema.safeParse({ ...value, data: [sample, sample] }).success).toBe(false);
  });
  it('keeps the last real measurement on failure and stops polling on unmount', async () => {
    vi.useFakeTimers();
    const value = { live: true, name: 'Komputer', status: 'connected', observedAt: Date.now(), data: [{ at: Date.now(), cpuPercent: 12, ramUsedGb: 5, ramTotalGb: 16 }] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(value)).mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const view = renderHook(() => useSystem());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.status).toBe('connected');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(view.result.current).toMatchObject({ status: 'offline', data: value.data, observedAt: value.observedAt });
    view.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
