import { useCallback, useEffect, useState } from 'react';

/** Fullscreen for the whole panel; `supported` is false where the browser or kiosk window has no such API. */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [active, setActive] = useState(() => supported && !!document.fullscreenElement);
  useEffect(() => {
    if (!supported) return;
    const changed = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [supported]);
  const toggle = useCallback(() => {
    // The browser refuses outside a user gesture or when the window forbids it; the button then simply does nothing.
    const result = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void result.catch(() => {});
  }, []);
  return { supported, active, toggle };
}
