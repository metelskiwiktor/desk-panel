import { useEffect, useState } from 'react';
import { usePollingEnabled } from './polling';
import { usageBreakdownSchema, type UsageBreakdown } from './usage-breakdown-contract';

export type UsageBreakdownState = UsageBreakdown | { status: 'loading'; observedAt: null; providers: [] };

export function useUsageBreakdown(): UsageBreakdownState {
  const [state, setState] = useState<UsageBreakdownState>({ status: 'loading', observedAt: null, providers: [] });
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch('/api/usage-breakdown', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = usageBreakdownSchema.parse(await response.json());
        if (!stopped) setState(value);
      } catch {
        if (!stopped) setState(previous => ({ ...previous, status: 'offline' }) as UsageBreakdownState);
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 30000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [pollingEnabled]);
  return state;
}
