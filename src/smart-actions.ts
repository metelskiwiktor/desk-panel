import type { SmartAlert } from './smart-rules-contract';
import type { Task } from './model';

/**
 * The tile's side of Smart Actions. Mail and bank alerts come from the server (`GET /api/smart-actions`, rules as data,
 * see smart-rules-contract); Cezar tasks waiting for the user are added here from the tasks the dashboard already has.
 * What the user dismissed is remembered in this browser only.
 */

export type TileAlert = Omit<SmartAlert, 'source' | 'ruleId'> & { source: SmartAlert['source'] | 'cezar'; ruleId?: string };

export const DISMISSED_STORAGE_KEY = 'desk-panel.dismissed-smart-actions';

export function taskAlert(task: Task): TileAlert | null {
  if (task.status !== 'needs-input' && task.status !== 'review') return null;
  const input = task.status === 'needs-input';
  return {
    id: `cezar:${task.id}`, source: 'cezar', badge: 'Cezar', title: task.title, category: 'task_alert',
    snippet: input ? task.question || task.lastMessage || 'Zadanie czeka na odpowiedź lub decyzję' : 'Zadanie zakończone, oczekuje na weryfikację zmian',
    priority: input ? 'high' : 'medium', at: task.checkedAt,
    ...(task.sourceUrl ? { url: task.sourceUrl, label: input ? 'Odpowiedz' : 'Przejrzyj' } : {}),
  };
}

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;
/** The server's alerts and the Cezar tasks, without the dismissed ones: highest priority, then newest first. */
export function tileAlerts(alerts: SmartAlert[], tasks: Task[] | null | undefined, dismissed: Set<string>): TileAlert[] {
  const all: TileAlert[] = [...alerts, ...(tasks ?? []).flatMap(t => taskAlert(t) ?? [])];
  return all.filter(a => !dismissed.has(a.id)).sort((a, b) => WEIGHT[b.priority] - WEIGHT[a.priority] || b.at - a.at);
}

export function loadDismissedActionIds(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '[]') as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    // Storage might be restricted
  }
  return new Set();
}

export function saveDismissedActionId(id: string): void {
  try {
    const current = loadDismissedActionIds();
    current.add(id);
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...current]));
  } catch {
    // Storage might be restricted
  }
}
