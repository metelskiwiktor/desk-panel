import type { UsageSink } from './useUsageMeter';

const BROWSER_KEY = 'desk-panel.usage-browser';
const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), n => (n % 36).toString(36)).join('');

/** A random id of this browser profile, kept in local storage; nothing in it says who or what. */
function browserId(): string {
  try {
    const saved = localStorage.getItem(BROWSER_KEY);
    if (saved && /^[a-z0-9]{8,32}$/.test(saved)) return saved;
    const id = fresh();
    localStorage.setItem(BROWSER_KEY, id);
    return id;
  } catch { return fresh(); }
}

/** Posts slices to the panel's own API; any failure is only `false` (the meter keeps them and tries again). */
export function createUsageSink(): UsageSink {
  return {
    browser: browserId(),
    send: async (slices, keepalive) => {
      try {
        const response = await fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slices }), keepalive });
        return response.ok || response.status === 204 || response.status === 400;
      } catch { return false; }
    },
  };
}
