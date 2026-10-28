import { useEffect, useState } from 'react';
import { usePollingEnabled } from './polling';
import { openrouterUsageSchema, type OpenRouterUsage } from './openrouter-contract';

export interface OpenRouterUsageError {
  status: 'error';
  httpStatus: number | null;
  message: string;
}

export interface OpenRouterUsageLoading {
  status: 'loading';
}

export type OpenRouterUsageState =
  | (OpenRouterUsage & { status: 'connected' })
  | OpenRouterUsageLoading
  | OpenRouterUsageError;

/**
 * The last answer, kept across mounts: a switch of desktop remounts the tile, which showed "loading" until the next
 * answer came. Now it shows the last one at once and refreshes it; a failed refresh keeps it on screen.
 */
let last: (OpenRouterUsage & { status: 'connected' }) | null = null;
export function forgetOpenRouterUsage() { last = null; }

export function useOpenRouterUsage(): OpenRouterUsageState {
  const [state, setState] = useState<OpenRouterUsageState>(() => last ?? { status: 'loading' });
  const pollingEnabled = usePollingEnabled();

  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;

    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch('/api/openrouter', { signal: controller.signal });
        if (!response.ok) {
          const msg = response.status === 503
            ? 'Brak klucza OPENROUTER_API_KEY w panel.env'
            : response.status === 502
              ? 'Błąd połączenia z OpenRouter'
              : `Błąd OpenRouter (${response.status})`;
          if (!stopped) {
            setState(last ?? { status: 'error', httpStatus: response.status, message: msg });
          }
          return;
        }
        const data = openrouterUsageSchema.parse(await response.json());
        last = { ...data, status: 'connected' };
        if (!stopped) {
          setState(last);
        }
      } catch {
        if (!stopped) {
          setState(last ?? {
            status: 'error',
            httpStatus: null,
            message: 'Błąd połączenia z serwerem',
          });
        }
      } finally {
        clearTimeout(timeout);
        if (!stopped) {
          timer = setTimeout(read, 60_000);
        }
      }
    }

    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [pollingEnabled]);

  return state;
}
