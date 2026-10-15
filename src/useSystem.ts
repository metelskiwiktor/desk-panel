import { useEffect, useState } from 'react';
import { systemSourceSchema, type SystemSource } from './system-contract';

export function useSystem(enabled: boolean) {
  const [source, setSource] = useState<SystemSource & { loadedAt?: number }>({ name: 'Komputer', live: true, status: 'loading', observedAt: null, data: null });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('/api/system', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = systemSourceSchema.parse(await response.json());
        if (!stopped) setSource(previous => ({ ...value, loadedAt: value.status === 'connected' ? Date.now() : previous.loadedAt }));
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 2000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [enabled]);
  return source;
}
