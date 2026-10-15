import { afterEach, expect, it, vi } from 'vitest';
import { ACTIVITY_LIMIT, dismissActivity, emptyActivityLog, readActivityLog, recordActivity, restoreActivity, saveActivityLog } from './activity-log';
import { createDemo } from './demo';
import { MINUTE } from './model';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const now = Date.parse('2026-10-15T10:00:00Z');
function quotaData(usedPercent = 26) {
  const data = createDemo(now, 'empty');
  data.quotas.data = [{ provider: 'Claude', history: [], snapshots: [{ window:'5h',usedPercent, observedAt:now, resetAt:now+240*MINUTE }] }];
  return data;
}
it('records yellow once, retains it after dismissal and reload, and permits a red escalation', () => {
  const data = quotaData();
  let log = recordActivity(emptyActivityLog(), data, now);
  expect(log.entries).toHaveLength(1);
  expect(log.entries[0].tone).toBe('amber');
  expect(recordActivity(log, data, now+1000)).toBe(log);
  const removed = log.entries[0];
  log = dismissActivity(log, removed.id);
  expect(saveActivityLog(log)).toBe(true);
  log = recordActivity(readActivityLog(), data, now+2000);
  expect(log.entries).toHaveLength(0);
  data.quotas.data![0].snapshots[0].usedPercent = 37;
  log = recordActivity(log, data, now+3000);
  expect(log.entries).toHaveLength(1);
  expect(log.entries[0].tone).toBe('red');
  expect(restoreActivity(log, removed).entries).toHaveLength(2);
});
it('does not warn on recovery or colour flapping, but rearms in a new reset window', () => {
  const data = quotaData(40);
  let log = recordActivity(emptyActivityLog(), data, now);
  data.quotas.data![0].snapshots[0].usedPercent = 26;
  log = recordActivity(log, data, now);
  expect(log.entries).toHaveLength(1);
  data.quotas.data![0].snapshots[0].usedPercent = 40;
  expect(recordActivity(log, data, now)).toBe(log);
  data.quotas.data![0].snapshots[0].resetAt! += 300 * MINUTE;
  log = recordActivity(log, data, now);
  expect(log.entries).toHaveLength(2);
});
it('keeps 90% warnings even when pace is green, and never records old/offline/missing readings', () => {
  const data = quotaData(92);
  data.quotas.data![0].snapshots[0].resetAt = now + MINUTE;
  const log = recordActivity(emptyActivityLog(), data, now);
  expect(log.entries).toHaveLength(1);
  expect(log.entries[0].title).toContain('blisko wyczerpania');
  data.quotas.status = 'offline';
  expect(recordActivity(emptyActivityLog(), data, now).entries).toHaveLength(0);
  data.quotas.status = 'connected';
  data.quotas.data![0].snapshots[0].resetAt = now;
  expect(recordActivity(emptyActivityLog(), data, now).entries).toHaveLength(0);
});
it('retains historical entries during outages, bounds the journal and rejects broken storage', () => {
  const data = createDemo(now);
  let log = recordActivity(emptyActivityLog(), data, now);
  expect(recordActivity(log, createDemo(now, 'offline'), now)).toBe(log);
  data.tasks.data = Array.from({length:120}, (_,i) => ({ ...data.tasks.data![0], id:`question-${i}` }));
  log = recordActivity(log, data, now);
  expect(log.entries).toHaveLength(ACTIVITY_LIMIT);
  localStorage.setItem('desk-panel.events.v1', '{broken');
  expect(readActivityLog()).toEqual(emptyActivityLog());
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
  expect(saveActivityLog(log)).toBe(false);
});
it('rearms task questions only on confirmed resolution, preserving partial/offline uncertainty', () => {
  const data = createDemo(now, 'empty');
  data.tasks.data = [createDemo(now).tasks.data![0]];
  let log = recordActivity(emptyActivityLog(), data, now);
  data.tasks.data = [];
  data.tasks.partial = true;
  log = recordActivity(log, data, now);
  data.tasks.data = [createDemo(now).tasks.data![0]];
  expect(recordActivity(log, data, now).entries).toHaveLength(1);
  data.tasks.data[0].status = 'running';
  log = recordActivity(log, data, now);
  data.tasks.data[0].status = 'needs-input';
  log = recordActivity(log, data, now+1);
  expect(log.entries).toHaveLength(2);
});
it('rearms RAM after a real low sample, not after an offline or short-history gap', () => {
  const data = createDemo(now, 'ram');
  let log = recordActivity(emptyActivityLog(), data, now);
  expect(log.entries).toHaveLength(1);
  data.system.status = 'offline';
  log = recordActivity(log, data, now);
  data.system.status = 'connected';
  expect(recordActivity(log, data, now)).toBe(log);
  const original = data.system.data!;
  data.system.data = [{ ...original.at(-1)!, ramUsedGb: 10 }];
  log = recordActivity(log, data, now);
  data.system.data = original;
  expect(recordActivity(log, data, now+1).entries).toHaveLength(2);
});
