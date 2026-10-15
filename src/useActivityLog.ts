import { useEffect, useRef, useState } from 'react';
import { dismissActivity, emptyActivityLog, readActivityLog, recordActivity, restoreActivity, saveActivityLog, type ActivityEntry } from './activity-log';
import type { DashboardData } from './model';
import { EVENT_RULES } from './event-rules';

export function useActivityLog(data: DashboardData, now: number, scope: string) {
  const [session, setSession] = useState(() => ({ scope, log: scope === 'live' ? readActivityLog() : emptyActivityLog() }));
  const [undo, setUndo] = useState<{ scope: string; entry: ActivityEntry } | null>(null);
  const [storageError, setStorageError] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  useEffect(() => {
    setSession(previous => {
      const base = previous.scope === scope ? previous.log : scope === 'live' ? readActivityLog() : emptyActivityLog();
      const log = recordActivity(base, data, now);
      return previous.scope === scope && previous.log === log ? previous : { scope, log };
    });
  }, [data, now, scope]);
  useEffect(() => {
    if (session.scope === 'live' && scope === 'live') setStorageError(!saveActivityLog(session.log));
  }, [session, scope]);
  const dismiss = (entry: ActivityEntry) => {
    setSession(previous => previous.scope !== scope ? previous : { ...previous, log: dismissActivity(previous.log, entry.id) });
    setUndo({ scope, entry });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), EVENT_RULES.undoSeconds * 1000);
  };
  const restore = () => {
    if (undo?.scope !== scope) return;
    setSession(previous => previous.scope !== scope ? previous : { ...previous, log: restoreActivity(previous.log, undo.entry) });
    clearTimeout(undoTimer.current);
    setUndo(null);
  };
  return { entries: session.scope === scope ? session.log.entries : [], dismiss, restore,
    canUndo: undo?.scope === scope, storageError: scope === 'live' && storageError };
}
