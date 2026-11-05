import { createContext, useContext, useEffect, useRef } from 'react';
import type { UsageSlice } from './usage-contract';
import { TICK_MS, UsageMeter, type UsageView } from './usage-meter';

/** Where finished slices go (the service); `null` when measuring is not wired, e.g. in tests. A failure only means "try later". */
export interface UsageSink { browser: string; send: (slices: UsageSlice[], keepalive: boolean) => Promise<boolean> }
export const UsageSinkContext = createContext<UsageSink | null>(null);

export const FLUSH_MS = 60_000;
const MAX_QUEUE = 500;
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => (n % 36).toString(36)).join('');

/**
 * Feeds the meter from the page: the main view, the visible tab, the user's own clicks, touches, keys and wheel
 * (never pointer movement, polling or scripted scrolling). `active` is false while this app is not the one on screen.
 */
export function useUsageMeter(view: UsageView, active: boolean) {
  const sink = useContext(UsageSinkContext);
  const meter = useRef<UsageMeter | null>(null);
  const latest = useRef({ view, active });
  latest.current = { view, active };
  const key = JSON.stringify(view) + active;
  useEffect(() => {
    if (!sink) return;
    const m = meter.current ??= new UsageMeter({ browser: sink.browser, session: randomId(), size: () => ({ width: window.innerWidth, height: window.innerHeight }) });
    const now = Date.now();
    m.setVisible(!document.hidden && latest.current.active, now);
    m.show(latest.current.view, now);
  }, [sink, key]);
  useEffect(() => {
    const m = meter.current;
    if (!sink || !m) return;
    let queue: UsageSlice[] = [];
    let sending = false;
    const flush = async (keepalive: boolean) => {
      queue.push(...m.take(Date.now()));
      if (sending || !queue.length) return;
      sending = true;
      const batch = queue.splice(0, 100);
      try { if (!(await sink.send(batch, keepalive))) queue.unshift(...batch); }
      catch { queue.unshift(...batch); }
      finally { sending = false; queue = queue.slice(-MAX_QUEUE); }
    };
    const visible = () => latest.current.active && !document.hidden;
    const onVisibility = () => { const now = Date.now(); if (document.hidden) { m.setVisible(false, now); void flush(true); } else m.setVisible(visible(), now); };
    const touch = (event: Event) => { if (event.isTrusted && visible()) m.interaction(Date.now()); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;
    for (const name of events) document.addEventListener(name, touch, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const onHide = () => { m.setVisible(false, Date.now()); void flush(true); };
    window.addEventListener('pagehide', onHide);
    const tick = window.setInterval(() => m.tick(Date.now()), TICK_MS);
    const send = window.setInterval(() => void flush(false), FLUSH_MS);
    return () => {
      for (const name of events) document.removeEventListener(name, touch, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(tick); window.clearInterval(send);
      m.setVisible(false, Date.now());
      void flush(true);
    };
  }, [sink]);
}
