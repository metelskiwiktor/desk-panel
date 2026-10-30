import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppointmentView } from '../appointment-contract';

export interface VisitWorkspaceEntry {
  view: AppointmentView;
  day: string;
  picked: string;
  disabled: boolean;
  /** Current calendar form end, including a user's correction; null means unknown. */
  endAt: number | null;
  chooseDay(day: string): void;
  chooseSlot(id: string): void;
  review(): void;
}
const Workspace = createContext<{
  entries: Record<string, VisitWorkspaceEntry>;
  active: string | null;
  settled: ReadonlySet<string>;
  settle(id: string): void;
  put(id: string, entry: VisitWorkspaceEntry): void;
  remove(id: string): void;
  show(id: string | null): void;
  offer(id: string, at: number): void;
  openTimeline(): void;
  openSummary(): void;
} | null>(null);

/** One instance per open conversation; the cards keep their authoritative server state. */
export function AppointmentWorkspace({ children, openTimeline, openSummary }: { children: ReactNode; openTimeline(): void; openSummary(): void }) {
  const [entries, setEntries] = useState<Record<string, VisitWorkspaceEntry>>({});
  const [active, show] = useState<string | null>(null);
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const settle = useCallback((id: string) => setSettled(previous => previous.has(id) ? previous : new Set([...previous, id])), []);
  const latest = useRef(-Infinity);
  const offer = useCallback((id: string, at: number) => { if (at >= latest.current) { latest.current = at; show(id); } }, []);
  const put = useCallback((id: string, entry: VisitWorkspaceEntry) => {
    setEntries(previous => ({ ...previous, [id]: entry }));
  }, []);
  const remove = useCallback((id: string) => {
    setEntries(previous => { const next = { ...previous }; delete next[id]; return next; });
    show(previous => previous === id ? null : previous);
  }, []);
  const value = useMemo(() => ({ entries, active, settled, settle, put, remove, show, offer, openTimeline, openSummary }), [entries, active, settled, settle, put, remove, offer, openTimeline, openSummary]);
  return <Workspace.Provider value={value}>{children}</Workspace.Provider>;
}
export const useAppointmentWorkspace = () => useContext(Workspace);
