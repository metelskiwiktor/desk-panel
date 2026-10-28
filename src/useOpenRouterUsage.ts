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

export function useOpenRouterUsage(): OpenRouterUsageState {
  const [state, setState] = useState<OpenRouterUsageState>({ status: 'loading' });
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
            setState({ status: 'error', httpStatus: response.status, message: msg });
          }
          return;
        }
        const data = openrouterUsageSchema.parse(await response.json());
        if (!stopped) {
          setState({ ...data, status: 'connected' });
        }
      } catch {
        if (!stopped) {
          setState({
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
