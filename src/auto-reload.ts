const BUNDLE = /<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/;

/** The hashed bundle path in an index.html, so a new build is recognisable without a version endpoint. */
export const bundleOf = (html: string) => BUNDLE.exec(html)?.[1] ?? null;

/**
 * Reloads the page once the server serves a different build than the one running, so a kiosk
 * screen picks up `just update` by itself. A failed check (service restarting) is simply retried.
 */
export function watchForNewBuild(everyMs = 60_000, reload = () => window.location.reload()) {
  const running = bundleOf(document.documentElement.outerHTML);
  if (!running) return () => {};
  const check = async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' });
      const served = res.ok ? bundleOf(await res.text()) : null;
      if (served && served !== running) reload();
    } catch { /* offline or restarting: try again next time */ }
  };
  const timer = window.setInterval(check, everyMs);
  return () => window.clearInterval(timer);
}
