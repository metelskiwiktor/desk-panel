import { createContext, useContext, useEffect, useRef } from 'react';
import type { AreaSlice, UsageSlice } from './usage-contract';
import { AreaMeter } from './usage-areas';
import { AREA_ATTRIBUTE, areaOf, areaViewOf, isExposed, rememberInteraction, type AreaContext } from './usage-dom';
import { TICK_MS, UsageMeter, type AreaView, type UsageView } from './usage-meter';

/** Where finished slices go (the service); `null` when measuring is not wired, e.g. in tests. A failure only means "try later". */
export interface UsageSink { browser: string; send: (batch: { slices: UsageSlice[]; areas: AreaSlice[] }, keepalive: boolean) => Promise<boolean> }
export const UsageSinkContext = createContext<UsageSink | null>(null);

export const FLUSH_MS = 60_000;
/** How often the page looks at which areas are on screen; an area is charged between two looks. */
export const SCAN_MS = 1_000;
const MAX_QUEUE = 2000;
const BATCH = 100;
const BATCHES_PER_FLUSH = 5;
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => (n % 36).toString(36)).join('');

/** The areas on screen now: marked elements that are in part visible and not wholly covered. */
function exposedAreas(context: AreaContext): AreaView[] {
  const seen = new Map<string, AreaView>();
  for (const element of document.querySelectorAll(`[${AREA_ATTRIBUTE}]`)) {
    const view = areaViewOf(element, context);
    if (view && !seen.has(JSON.stringify(view)) && isExposed(element)) seen.set(JSON.stringify(view), view);
  }
  return [...seen.values()];
}

/**
 * Feeds the meters from the page: the main view and, in parallel, the areas (docs/uzycie.md). Both see the visible tab, and
 * the user's own clicks, touches, keys and wheel (never pointer movement, polling or scripted scrolling); an interaction also
 * goes to the nearest marked area around its target (a key to the one with the focus). `active` is false while this app is
 * not the one on screen.
 */
export function useUsageMeter(view: UsageView, active: boolean, context: AreaContext) {
  const sink = useContext(UsageSinkContext);
  const meters = useRef<{ main: UsageMeter; areas: AreaMeter } | null>(null);
  const latest = useRef({ view, active, context });
  latest.current = { view, active, context };
  const key = JSON.stringify(view) + active + JSON.stringify(context);
  useEffect(() => {
    if (!sink) return;
    if (!meters.current) {
      const session = randomId(), size = () => ({ width: window.innerWidth, height: window.innerHeight });
      meters.current = { main: new UsageMeter({ browser: sink.browser, session, size }), areas: new AreaMeter({ browser: sink.browser, session, size }) };
    }
    const { main, areas } = meters.current;
    const now = Date.now(), on = !document.hidden && latest.current.active;
    main.setVisible(on, now);
    main.show(latest.current.view, now);
    areas.setActive(on, now);
    // The page has just changed under the areas: look at once, so that the time is not charged to what has left.
    if (on) areas.sync(exposedAreas(latest.current.context), now);
  }, [sink, key]);
  useEffect(() => {
    const current = meters.current;
    if (!sink || !current) return;
    const { main, areas } = current;
    let queue: (UsageSlice | AreaSlice)[] = [];
    let sending = false;
    const flush = async (keepalive: boolean) => {
      const now = Date.now();
      queue.push(...main.take(now), ...areas.take(now));
      if (sending || !queue.length) return;
      sending = true;
      try {
        for (let n = 0; n < BATCHES_PER_FLUSH && queue.length; n++) {
          const batch = queue.splice(0, BATCH);
          const ok = await sink.send({ slices: batch.filter((s): s is UsageSlice => 'view' in s), areas: batch.filter((s): s is AreaSlice => 'area' in s) }, keepalive).catch(() => false);
          if (!ok) { queue.unshift(...batch); break; }
          if (keepalive) break;
        }
      } finally { sending = false; queue = queue.slice(-MAX_QUEUE); }
    };
    const visible = () => latest.current.active && !document.hidden;
    const setOn = (on: boolean, now: number) => { main.setVisible(on, now); areas.setActive(on, now); if (on) areas.sync(exposedAreas(latest.current.context), now); };
    const onVisibility = () => { const now = Date.now(); if (document.hidden) { setOn(false, now); void flush(true); } else setOn(visible(), now); };
    const touch = (event: Event) => {
      if (!event.isTrusted || !visible()) return;
      const now = Date.now();
      main.interaction(now);
      if (event.type !== 'wheel' && event.type !== 'touchmove') rememberInteraction(event.type === 'keydown' ? document.activeElement : event.target as Element | null, now);
      const element = areaOf(event.type === 'keydown' ? document.activeElement : event.target);
      const target = element && areaViewOf(element, latest.current.context);
      if (target) areas.interaction(target, now);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;
    for (const name of events) document.addEventListener(name, touch, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const onHide = () => { setOn(false, Date.now()); void flush(true); };
    window.addEventListener('pagehide', onHide);
    const tick = window.setInterval(() => { const now = Date.now(); main.tick(now); areas.tick(now); }, TICK_MS);
    const scan = window.setInterval(() => { if (visible()) areas.sync(exposedAreas(latest.current.context), Date.now()); }, SCAN_MS);
    const send = window.setInterval(() => void flush(false), FLUSH_MS);
    return () => {
      for (const name of events) document.removeEventListener(name, touch, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(tick); window.clearInterval(scan); window.clearInterval(send);
      setOn(false, Date.now());
      void flush(true);
    };
  }, [sink]);
}
