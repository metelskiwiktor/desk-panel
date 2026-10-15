import { useEffect, useState } from 'react';
import { quotaSourceSchema, type QuotaSource } from './quota-contract';

export function useQuotas(enabled: boolean) {
  const [source, setSource] = useState<QuotaSource & { loadedAt?: number }>({ live: true, name: 'Zapisane limity AI', status: 'loading', observedAt: null, data: null });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/quotas', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = quotaSourceSchema.parse(await response.json());
        if (!stopped) setSource(previous => ({ ...value, loadedAt: value.status === 'connected' ? Date.now() : previous.loadedAt }));
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 15000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [enabled]);
  return source;
}
