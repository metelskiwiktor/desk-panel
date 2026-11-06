import type { AreaSlice } from './usage-contract';
import { UsageMeter, type AreaView, type MeterIdentity } from './usage-meter';

const keyOf = (v: AreaView) => [v.area, v.page, v.pulpit, v.kind, v.tile, v.source, v.chat].map(x => x ?? '').join('|');

/**
 * Exposure of the panel's areas, in parallel (t-01c8aa59, docs/uzycie.md). Each area has a meter of its own, so the time since
 * its own last interaction and its own first interaction are kept apart from every other area and from the main views.
 * The caller says which areas are exposed now (`sync`), whether the app is on screen at all (`setActive`) and which area a
 * trusted user event landed in (`interaction`); an area that is not exposed is not charged and takes no interaction.
 * Slices of all areas share one id counter, so they stay unique per session.
 */
export class AreaMeter {
  private meters = new Map<string, UsageMeter<AreaView, AreaSlice>>();
  private exposed = new Set<string>();
  private active = false;
  private seq = 0;
  constructor(private readonly who: MeterIdentity) {}

  setActive(active: boolean, now: number) {
    if (active === this.active) return;
    this.active = active;
    this.apply(now);
  }
  /** The areas on screen now (visible in part, not wholly covered); every other area is paused. */
  sync(views: AreaView[], now: number) {
    const next = new Set<string>();
    for (const view of views) {
      const key = keyOf(view);
      next.add(key);
      if (!this.meters.has(key)) {
        const meter = new UsageMeter<AreaView, AreaSlice>({ ...this.who, nextId: () => `${this.who.session}:${this.seq++}` });
        meter.setVisible(false, now);
        meter.show(view, now);
        this.meters.set(key, meter);
      }
    }
    this.exposed = next;
    this.apply(now);
  }
  /** A click, touch, key or scroll by the user, in the nearest area that contains its target. */
  interaction(view: AreaView, now: number) {
    const key = keyOf(view);
    if (this.active && this.exposed.has(key)) this.meters.get(key)?.interaction(now);
  }
  tick(now: number) { for (const meter of this.meters.values()) meter.tick(now); }
  take(now: number): AreaSlice[] { return [...this.meters.values()].flatMap(meter => meter.take(now)); }
  private apply(now: number) {
    for (const [key, meter] of this.meters) meter.setVisible(this.active && this.exposed.has(key), now);
  }
}
