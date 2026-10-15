import { usePollingEnabled } from './polling';
import { useEffect, useState } from 'react';
import { calendarSourceSchema, type CalendarSource } from './calendar-contract';

export function useCalendar() {
  const [source, setSource] = useState<CalendarSource & { loadedAt?: number }>({ name: 'Google Calendar', calendarId: '', live: true, status: 'loading', observedAt: null, data: null });
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
        const response = await fetch('/api/calendar', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = calendarSourceSchema.parse(await response.json());
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
  }, [pollingEnabled]);
  return source;
}
