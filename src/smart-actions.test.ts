import { beforeEach, describe, expect, it } from 'vitest';
import type { Task } from './model';
import type { SmartAlert } from './smart-rules-contract';
import { loadDismissedActionIds, saveDismissedActionId, taskAlert, tileAlerts } from './smart-actions';

const task = (status: Task['status'], over: Partial<Task> = {}): Task => ({
  id: `t-${status}`, title: 'Migracja', project: 'desk-panel', status, checkedAt: 1_000, description: '', sourceUrl: 'http://cezar/t', ...over,
} as Task);
const alert = (id: string, priority: SmartAlert['priority'], at: number): SmartAlert => ({
  id, ruleId: 'r', source: 'mail', badge: 'X', title: id, snippet: '', category: 'other', priority, at,
});

describe('Smart Actions on the tile', () => {
  beforeEach(() => localStorage.clear());

  it('adds Cezar tasks that wait for the user to the server alerts, without the dismissed ones', () => {
    expect(taskAlert(task('needs-input', { question: 'Zachować API?' }))).toMatchObject({ id: 'cezar:t-needs-input', priority: 'high', snippet: 'Zachować API?', label: 'Odpowiedz' });
    expect(taskAlert(task('review'))).toMatchObject({ priority: 'medium', label: 'Przejrzyj' });
    expect(taskAlert(task('running'))).toBeNull();
    const all = tileAlerts([alert('mail:a', 'medium', 5), alert('mail:b', 'high', 1), alert('mail:c', 'medium', 9)], [task('review', { checkedAt: 7 })], new Set(['mail:c']));
    expect(all.map(a => a.id)).toEqual(['mail:b', 'cezar:t-review', 'mail:a']);
  });

  it('remembers dismissed alerts in this browser', () => {
    saveDismissedActionId('mail:a');
    saveDismissedActionId('bank:t1');
    expect([...loadDismissedActionIds()]).toEqual(['mail:a', 'bank:t1']);
  });
});
