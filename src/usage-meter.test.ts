import { describe, expect, it } from 'vitest';
import { usageSliceSchema, type UsageSlice } from './usage-contract';
import { GAP_MS, UsageMeter } from './usage-meter';

const H = 3_600_000;
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % H) + 10 * 60_000; // 10 minutes into an hour
const meter = () => new UsageMeter({ browser: 'browser01', session: 'session01', size: () => ({ width: 1873, height: 1021 }) });
const home = { view: 'page', page: 'home', pulpit: 'main' } as const;
/** Ticks every 5 s like the page does, up to `to`. */
const run = (m: UsageMeter, from: number, to: number) => { for (let t = from + 5000; t <= to; t += 5000) m.tick(t); };
const total = (slices: UsageSlice[], pick: (s: UsageSlice) => boolean) => slices.filter(pick).reduce((n, s) => n + s.end - s.start, 0);

describe('usage meter', () => {
  it('gives each main view its own time and every slice passes the contract', () => {
    const m = meter();
    m.show(home, T0); run(m, T0, T0 + 60_000);
    m.show({ view: 'page', page: 'tasks' }, T0 + 60_000); run(m, T0 + 60_000, T0 + 90_000);
    m.show({ view: 'ambient' }, T0 + 90_000); run(m, T0 + 90_000, T0 + 100_000);
    m.show({ view: 'chat' }, T0 + 100_000); run(m, T0 + 100_000, T0 + 130_000);
    m.show({ view: 'detail', detail: 'mail' }, T0 + 130_000); m.show(home, T0 + 140_000);
    const slices = m.take(T0 + 150_000);
    expect(total(slices, s => s.view === 'ambient')).toBe(10_000);
    expect(total(slices, s => s.view === 'chat')).toBe(30_000);
    expect(total(slices, s => s.view === 'detail')).toBe(10_000);
    expect(total(slices, s => s.page === 'tasks')).toBe(30_000);
    expect(total(slices, s => s.page === 'home')).toBe(60_000 + 10_000);
    expect(slices.every(s => usageSliceSchema.safeParse(s).success)).toBe(true);
    expect(slices[0]).toMatchObject({ width: 1850, height: 1000, pulpit: 'main', entry: true });
  });

  it('does not charge a hidden tab and counts the way back as a new entry', () => {
    const m = meter();
    m.show(home, T0); run(m, T0, T0 + 20_000);
    m.setVisible(false, T0 + 20_000);
    m.setVisible(true, T0 + 600_000); run(m, T0 + 600_000, T0 + 610_000);
    const slices = m.take(T0 + 610_000);
    expect(total(slices, () => true)).toBe(30_000);
    expect(slices.filter(s => s.entry)).toHaveLength(2);
    expect(slices.filter(s => s.visitEnd)).toHaveLength(1);
  });

  it('does not add a gap in observation (sleep) to the time on screen', () => {
    const m = meter();
    m.show(home, T0); run(m, T0, T0 + 30_000);
    const wake = T0 + 30_000 + 3_600_000 - 20 * 60_000; // the clock was stopped for most of an hour
    m.tick(wake);
    run(m, wake, wake + 20_000);
    const slices = m.take(wake + 20_000);
    expect(total(slices, () => true)).toBe(30_000 + 20_000);
    expect(GAP_MS).toBeLessThan(wake - (T0 + 30_000));
  });

  it('keeps the time before the first interaction apart from the time since the last one', () => {
    const m = meter();
    m.show(home, T0); run(m, T0, T0 + 30_000);
    m.interaction(T0 + 30_000); // the view is displayed the whole time, touched or not
    run(m, T0 + 30_000, T0 + 50_000);
    m.interaction(T0 + 50_000); // resets the counter
    run(m, T0 + 50_000, T0 + 60_000);
    const [slice] = m.take(T0 + 60_000);
    expect(slice).toMatchObject({ end: T0 + 60_000, noInteractionMs: 30_000, maxAgeMs: 20_000, touched: true });
    expect(slice.ageIntegral).toBeCloseTo(250, 3); // 0→20 s, then 0→10 s since the touch: 200 + 50 s·s
    expect(slice.end - slice.start).toBe(60_000);
  });

  it('marks a visit without any interaction, and one with', () => {
    const m = meter();
    m.show(home, T0); run(m, T0, T0 + 10_000);
    m.show({ view: 'page', page: 'tasks' }, T0 + 10_000); m.interaction(T0 + 12_000);
    m.show(home, T0 + 20_000);
    const slices = m.take(T0 + 30_000);
    expect(slices.find(s => s.page === 'home' && s.visitEnd)).toMatchObject({ touched: false });
    expect(slices.find(s => s.page === 'tasks')).toMatchObject({ visitEnd: true, touched: true });
  });

  it('cuts at the clock hour, flushes the running slice without a second entry, and takes back what could not be sent', () => {
    const m = meter();
    const hour = T0 - 10 * 60_000 + H;
    m.show(home, hour - 20_000); run(m, hour - 20_000, hour + 20_000);
    const first = m.take(hour + 20_000);
    expect(first.map(s => [s.start, s.end, s.entry])).toEqual([[hour - 20_000, hour, true], [hour, hour + 20_000, false]]);
    run(m, hour + 20_000, hour + 30_000);
    const second = m.take(hour + 30_000);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ entry: false, id: 'session01:2' });
    m.restore(first);
    expect(m.take(hour + 30_000).map(s => s.id)).toEqual(['session01:0', 'session01:1']);
  });
});
