import { useEffect, useState } from 'react';
import { usePollingEnabled } from './polling';
import { trainingSourceSchema, type TrainingSource } from './training-contract';

export type TrainingState = TrainingSource & { loadedAt?: number };
/** The server reads Garmin at most every 15 minutes; the panel only has to notice it promptly. */
const POLL_MS = 60_000;

export function useTraining() {
  const [source, setSource] = useState<TrainingState>({ name: 'Garmin Connect', live: true, status: 'loading', observedAt: null, data: null });
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/training', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = trainingSourceSchema.parse(await response.json());
        if (!stopped) setSource(previous => ({ ...value, loadedAt: value.status === 'connected' ? Date.now() : previous.loadedAt }));
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, POLL_MS);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [pollingEnabled]);
  return source;
}
