import { describe, expect, it } from 'vitest';
import { areaSliceSchema, type AreaSlice } from './usage-contract';
import { AreaMeter } from './usage-areas';
import { UsageMeter, type AreaView } from './usage-meter';

const H = 3_600_000;
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % H) + 10 * 60_000;
const areas = () => new AreaMeter({ browser: 'browser01', session: 'session01', size: () => ({ width: 1873, height: 1021 }) });
const mail: AreaView = { area: 'tile', page: 'home', pulpit: 'main', kind: 'mail', tile: 'mail' };
const cezar: AreaView = { area: 'tile', page: 'home', pulpit: 'main', kind: 'cezar', tile: 'cezar' };
const clock: AreaView = { area: 'clock', page: 'home', pulpit: 'main' };
/** Ticks every 5 s like the page, up to `to`. */
const run = (m: AreaMeter, from: number, to: number) => { for (let t = from + 5000; t <= to; t += 5000) m.tick(t); };
const ms = (slices: AreaSlice[], pick: (s: AreaSlice) => boolean) => slices.filter(pick).reduce((n, s) => n + s.end - s.start, 0);

describe('area meter', () => {
  it('measures the visible areas in parallel, each for its own time, and every slice passes the contract', () => {
    const m = areas();
    m.setActive(true, T0);
    m.sync([mail, clock], T0); run(m, T0, T0 + 30_000);
    m.sync([mail, cezar, clock], T0 + 30_000); run(m, T0 + 30_000, T0 + 60_000);
    const slices = m.take(T0 + 60_000);
    expect(ms(slices, s => s.kind === 'mail')).toBe(60_000);
    expect(ms(slices, s => s.kind === 'cezar')).toBe(30_000);
    expect(ms(slices, s => s.area === 'clock')).toBe(60_000);
    expect(slices.every(s => areaSliceSchema.safeParse(s).success)).toBe(true);
    expect(new Set(slices.map(s => s.id)).size).toBe(slices.length);
    expect(slices.find(s => s.kind === 'mail')).toMatchObject({ page: 'home', pulpit: 'main', tile: 'mail', width: 1850, height: 1000 });
  });

  it('pauses an area that is collapsed, off screen, covered or in a hidden tab, and counts the way back as a new entry', () => {
    const m = areas();
    m.setActive(true, T0);
    m.sync([mail], T0); run(m, T0, T0 + 20_000);
    m.sync([], T0 + 20_000); run(m, T0 + 20_000, T0 + 120_000); // nothing of it is exposed
    m.sync([mail], T0 + 120_000); run(m, T0 + 120_000, T0 + 130_000);
    m.setActive(false, T0 + 130_000); // hidden tab or paused host
    m.setActive(true, T0 + 400_000); run(m, T0 + 400_000, T0 + 410_000);
    const slices = m.take(T0 + 410_000);
    expect(ms(slices, () => true)).toBe(20_000 + 10_000 + 10_000);
    expect(slices.filter(s => s.entry)).toHaveLength(3);
  });

  it('keeps the interaction time of each area apart, and does not touch an area that is not exposed', () => {
    const m = areas();
    m.setActive(true, T0);
    m.sync([mail, cezar], T0); run(m, T0, T0 + 30_000);
    m.interaction(mail, T0 + 30_000);
    m.interaction(clock, T0 + 30_000); // not exposed: ignored
    run(m, T0 + 30_000, T0 + 50_000);
    const slices = m.take(T0 + 50_000);
    const of = (kind: string) => slices.find(s => s.kind === kind)!;
    expect(of('mail')).toMatchObject({ touched: true, noInteractionMs: 30_000, maxAgeMs: 20_000 });
    expect(of('mail').ageIntegral).toBeCloseTo(200, 3);
    expect(of('cezar')).toMatchObject({ touched: false, noInteractionMs: 50_000, maxAgeMs: 0, ageIntegral: 0 });
    expect(ms(slices, () => true)).toBe(100_000); // 50 s each, in parallel
  });

  it('remembers the last interaction of an area over a pause and does not age it while it is paused', () => {
    const m = areas();
    m.setActive(true, T0);
    m.sync([mail], T0); m.interaction(mail, T0 + 5_000);
    m.sync([], T0 + 10_000); m.sync([mail], T0 + 100_000); run(m, T0 + 100_000, T0 + 110_000);
    const last = m.take(T0 + 110_000).at(-1)!;
    expect(last.noInteractionMs).toBe(0); // this area was touched before in the session: there is no "before the first" any more
    expect(last.maxAgeMs).toBe(110_000 - 5_000); // age is wall-clock since the touch, but only exposed seconds are charged
    expect(last.end - last.start).toBe(10_000);
  });

  it('does not change the main view meter: parallel areas never add to its time', () => {
    const main = new UsageMeter({ browser: 'browser01', session: 'session01', size: () => ({ width: 1873, height: 1021 }) });
    const m = areas();
    main.show({ view: 'page', page: 'home', pulpit: 'main' }, T0); m.setActive(true, T0); m.sync([mail, cezar, clock], T0);
    for (let t = T0 + 5000; t <= T0 + 60_000; t += 5000) { main.tick(t); m.tick(t); }
    expect(ms(m.take(T0 + 60_000), () => true)).toBe(180_000);
    expect(main.take(T0 + 60_000).reduce((n, s) => n + s.end - s.start, 0)).toBe(60_000);
  });

  it('is strict: no text, and a tile only with its kind', () => {
    const base = { id: 'session01:1', browser: 'browser01', session: 'session01', start: T0, end: T0 + 1000, width: 1850, height: 1000, entry: true, visitEnd: true, touched: false, noInteractionMs: 1000, ageIntegral: 0, maxAgeMs: 0, page: 'home', pulpit: 'main' };
    expect(areaSliceSchema.safeParse({ ...base, area: 'clock' }).success).toBe(true);
    expect(areaSliceSchema.safeParse({ ...base, area: 'clock', title: 'Moja rozmowa' }).success).toBe(false);
    expect(areaSliceSchema.safeParse({ ...base, area: 'tile' }).success).toBe(false);
    expect(areaSliceSchema.safeParse({ ...base, area: 'tile', kind: 'Nazwa Konta', tile: 'x' }).success).toBe(false);
    expect(areaSliceSchema.safeParse({ ...base, area: 'wektor', chat: 'compact' }).success).toBe(true);
    expect(areaSliceSchema.safeParse({ ...base, area: 'clock', chat: 'compact' }).success).toBe(false);
    expect(areaSliceSchema.safeParse({ ...base, area: 'detail-mail', source: 'mail' }).success).toBe(true);
    expect(areaSliceSchema.safeParse({ ...base, area: 'nav', source: 'mail' }).success).toBe(false);
  });
});
