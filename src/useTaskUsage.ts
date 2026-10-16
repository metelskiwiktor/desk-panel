import { useEffect, useState } from 'react';
import { usePollingEnabled } from './polling';
import { taskUsageSchema, type TaskUsage } from './task-usage-contract';

export type TaskUsageState = TaskUsage | { status: 'loading'; observedAt: null; tasks: [] };

export function useTaskUsage(): TaskUsageState {
  const [state, setState] = useState<TaskUsageState>({ status: 'loading', observedAt: null, tasks: [] });
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch('/api/task-usage', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = taskUsageSchema.parse(await response.json());
        if (!stopped) setState(value);
      } catch {
        if (!stopped) setState(previous => ({ ...previous, status: 'offline' }) as TaskUsageState);
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 60000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [pollingEnabled]);
  return state;
}
