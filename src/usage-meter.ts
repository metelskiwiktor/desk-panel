import { HOUR_MS, type UsageSlice } from './usage-contract';

/** What is on screen now, as the meter sees it; the main view only (ambient > full chat > details > page). */
export interface UsageView {
  view: UsageSlice['view']; page?: UsageSlice['page']; detail?: UsageSlice['detail']; pulpit?: string;
}
const same = (a: UsageView, b: UsageView) => a.view === b.view && a.page === b.page && a.detail === b.detail && a.pulpit === b.pulpit;

/** More than this between two ticks of a running clock means the browser was not observed (sleep, frozen tab). */
export const GAP_MS = 15_000;
export const TICK_MS = 5_000;

export interface MeterIdentity { browser: string; session: string; size: () => { width: number; height: number } }

/**
 * Turns "what is on screen" plus a clock into slices. Pure: the caller feeds `show`, `tick`, `interaction`, `setVisible`
 * and `take` with times, so every rule is testable with a controlled clock. A gap between ticks is not counted (the open
 * slice ends at the last tick), time before the first interaction of the tab session is kept apart from the time since
 * the last one, and no slice crosses a clock hour.
 */
export class UsageMeter {
  private seq = 0;
  private done: UsageSlice[] = [];
  private view: UsageView | null = null;
  private visible = true;
  /** Start of the open slice, or null when nothing is measured (hidden tab, no view yet). */
  private start: number | null = null;
  private cursor = 0;
  private entry = true;
  private visitTouched = false;
  private lastInteraction: number | null = null;
  private noInteractionMs = 0;
  private ageIntegral = 0;
  private maxAgeMs = 0;
  constructor(private readonly who: MeterIdentity) {}

  /** The main view changed (or is known for the first time). */
  show(view: UsageView, now: number) {
    if (this.view && same(this.view, view)) return;
    this.advance(now);
    this.end(true);
    this.view = view;
    this.begin(now);
  }
  /** The tab became hidden or visible again: a hidden tab stops the whole measurement. */
  setVisible(visible: boolean, now: number) {
    if (visible === this.visible) return;
    if (!visible) { this.advance(now); this.end(true); }
    this.visible = visible;
    if (visible) this.begin(now);
  }
  /** A click, touch, key or scroll by the user. */
  interaction(now: number) {
    this.advance(now);
    this.visitTouched = true;
    this.lastInteraction = now;
  }
  /** Timer tick; a long silence since the last one is a gap in observation, not time on screen. */
  tick(now: number) {
    if (this.start !== null && now - this.cursor > GAP_MS) { this.end(true); this.begin(now); return; }
    this.advance(now);
  }
  /** Slices ready to send; the running one is cut at `now` so nothing waits for the tab to close. */
  take(now: number): UsageSlice[] {
    this.advance(now);
    this.end(false);
    if (this.view && this.visible) this.resume(now);
    return this.done.splice(0);
  }
  /** Slices that could not be sent go back in front of the queue. */
  restore(slices: UsageSlice[]) { this.done.unshift(...slices); }

  private begin(now: number) {
    this.entry = true;
    this.visitTouched = false;
    this.resume(now);
  }
  private resume(now: number) {
    this.start = this.view && this.visible ? now : null;
    this.cursor = now;
    this.noInteractionMs = 0; this.ageIntegral = 0; this.maxAgeMs = 0;
  }
  /** Measures up to `now`, closing the slice at every clock hour on the way. */
  private advance(now: number) {
    while (this.start !== null && now > this.cursor) {
      const boundary = (Math.floor(this.start / HOUR_MS) + 1) * HOUR_MS;
      this.measure(Math.min(now, boundary));
      if (this.cursor === boundary) { this.end(false); this.resume(boundary); }
    }
  }
  private measure(to: number) {
    const from = this.cursor;
    if (this.lastInteraction === null) this.noInteractionMs += to - from;
    else {
      const a0 = (from - this.lastInteraction) / 1000, a1 = (to - this.lastInteraction) / 1000;
      this.ageIntegral += (a0 + a1) / 2 * ((to - from) / 1000);
      this.maxAgeMs = Math.max(this.maxAgeMs, to - this.lastInteraction);
    }
    this.cursor = to;
  }
  /** Closes the open slice at the cursor; `visitEnd` when the visit ends with it. */
  private end(visitEnd: boolean) {
    if (this.start === null || !this.view) return;
    if (this.cursor > this.start) {
      const { width, height } = this.who.size();
      const { view, page, detail, pulpit } = this.view;
      this.done.push({
        id: `${this.who.session}:${this.seq++}`, browser: this.who.browser, session: this.who.session, start: this.start, end: this.cursor,
        view, ...(page ? { page } : {}), ...(detail ? { detail } : {}), ...(pulpit ? { pulpit } : {}),
        width: Math.round(width / 50) * 50, height: Math.round(height / 50) * 50,
        entry: this.entry, visitEnd, touched: this.visitTouched,
        noInteractionMs: this.noInteractionMs, ageIntegral: Math.round(this.ageIntegral * 1000) / 1000, maxAgeMs: this.maxAgeMs,
      });
      this.entry = false;
    } else if (visitEnd) {
      // The visit ended right after a cut: the unsent last slice of it carries the end.
      const last = this.done.at(-1);
      if (last && last.session === this.who.session && last.end === this.start) { last.visitEnd = true; last.touched = this.visitTouched; }
    }
    this.start = null;
  }
}
