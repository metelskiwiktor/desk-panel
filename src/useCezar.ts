import { useEffect, useState } from 'react';
import { cezarSchema, type CezarSnapshot } from './cezar-contract';
import type { Source, Task } from './model';

export function useCezar(enabled: boolean) {
  const [source, setSource] = useState<Source<Task[]>>({ status: 'loading', data: null, observedAt: null, live: true });
  const [snapshot, setSnapshot] = useState<CezarSnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/cezar', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = cezarSchema.parse(await response.json());
        if (!stopped) {
          setSnapshot(value);
          setSource({ status: 'connected', observedAt: value.observedAt, data: value.tasks, live: true, partial: value.partial, loadedAt:Date.now() });
        }
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 5000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [enabled]);
  return { source, snapshot };
}
