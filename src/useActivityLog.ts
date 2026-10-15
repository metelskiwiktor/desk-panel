import { useEffect, useRef, useState } from 'react';
import { dismissActivity, readActivityLog, recordActivity, restoreActivity, saveActivityLog, type ActivityEntry } from './activity-log';
import type { DashboardData } from './model';
import { EVENT_RULES } from './event-rules';
import { usePollingEnabled } from './polling';

export function useActivityLog(data: DashboardData, now: number) {
  const pollingEnabled = usePollingEnabled();
  const [log, setLog] = useState(readActivityLog);
  const [undo, setUndo] = useState<ActivityEntry | null>(null);
  const [storageError, setStorageError] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  useEffect(() => {
    if (!pollingEnabled) return;
    setLog(previous => recordActivity(previous, data, now));
  }, [data, now, pollingEnabled]);
  useEffect(() => {
    if (!pollingEnabled) return;
    setStorageError(!saveActivityLog(log));
  }, [log, pollingEnabled]);
  const dismiss = (entry: ActivityEntry) => {
    setLog(previous => dismissActivity(previous, entry.id));
    setUndo(entry);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), EVENT_RULES.undoSeconds * 1000);
  };
  const restore = () => {
    if (!undo) return;
    setLog(previous => restoreActivity(previous, undo));
    clearTimeout(undoTimer.current);
    setUndo(null);
  };
  return { entries: log.entries, dismiss, restore, canUndo: undo !== null, storageError };
}
