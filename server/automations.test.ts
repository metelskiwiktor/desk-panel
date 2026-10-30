// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomations, nextOccurrence, resolveObserverTime } from './automations';
import { RUN_REPORT_TIMEOUT_MS, type Automation } from '../src/automation-contract';

const NOW = Date.parse('2026-10-30T12:00:00+01:00');
let clock = NOW;
let dir: string;
let sent: { id: string; text: string; automation: { source: string; reason: string } }[];
let chat: {
  sendAutomation: (id: string, input: { text: string; automation: { source: string; reason: string } }) => Promise<void>;
  createAutomation: (input: { text: string; title?: string; automation: { source: string; reason: string } }) => Promise<{ id: string }>;
};
let nextChat = 0;

beforeEach(() => {
  clock = NOW;
  nextChat = 0;
  dir = mkdtempSync(join(tmpdir(), 'desk-automations-'));
  sent = [];
  chat = {
    sendAutomation: vi.fn(async (id, input) => { sent.push({ id, ...input }); }),
    createAutomation: vi.fn(async input => { const id = `run-chat-${++nextChat}`; sent.push({ id, ...input }); return { id }; }),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (over: Partial<Parameters<typeof createAutomations>[0]> = {}) => createAutomations({
  file: join(dir, 'automations.json'), chat, now: () => clock, log: () => {}, ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({
  name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'daily', time: '07:00' }, actions: [{ kind: 'message' }], learn: false, ...over,
} as never);

describe('migration from observers.json', () => {
  it('turns old observers into automations without losing their content', async () => {
    const old = { version: 1, observers: [
      { id: 'o-aaaaaaaaaaaa', chatId: 'chat-1', kind: 'time', target: '2026-10-30T15:00 +01:00', instruction: 'Przypomnij.', createdAt: NOW, expiresAt: NOW + 3_600_000, status: 'active', snapshot: { at: Date.parse('2026-10-30T15:00:00+01:00') } },
      { id: 'o-bbbbbbbbbbbb', chatId: 'chat-2', kind: 'cezar', target: 'desk-panel/x', instruction: 'Pilnuj taska.', createdAt: NOW, expiresAt: NOW + 3_600_000, status: 'active', snapshot: { state: 'running' } },
    ] };
    writeFileSync(join(dir, 'observers.json'), JSON.stringify(old));
    const automations = make({ observersFile: join(dir, 'observers.json') });
    const rows = await automations.list();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ goal: 'Przypomnij.', trigger: { kind: 'once', at: Date.parse('2026-10-30T15:00:00+01:00') } });
    expect(rows[1].trigger).toEqual({ kind: 'cezar', taskId: 'desk-panel/x' });
    expect(JSON.parse(readFileSync(join(dir, 'automations.json'), 'utf8')).automations).toHaveLength(2);
  });
});

describe('daily and weekly scheduling in Europe/Warsaw', () => {
  it('reads the local clock and lands on the next day when today\u2019s hour passed', () => {
    const after = Date.parse('2026-10-30T08:00:00+01:00');
    expect(nextOccurrence({ kind: 'daily', time: '07:00' }, after)).toBe(Date.parse('2026-10-31T07:00:00+01:00'));
    expect(nextOccurrence({ kind: 'daily', time: '19:00' }, after)).toBe(Date.parse('2026-10-30T19:00:00+01:00'));
  });
  it('keeps the local hour across the DST change', () => {
    // Sunday 25.10.2026 is when Europe/Warsaw leaves summer time (03:00 -> 02:00).
    const saturday = Date.parse('2026-10-24T12:00:00+02:00');
    const next = nextOccurrence({ kind: 'daily', time: '07:00' }, saturday)!;
    expect(new Date(next).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })).toBe('07:00');
    const monday = nextOccurrence({ kind: 'weekly', weekday: 1, time: '07:00' }, Date.parse('2026-10-24T12:00:00+02:00'))!;
    expect(new Date(monday).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })).toBe('07:00');
  });
  it('honours from and until', () => {
    expect(nextOccurrence({ kind: 'daily', time: '07:00', from: '2026-11-02', until: '2026-11-05' }, NOW)).toBe(Date.parse('2026-11-02T07:00:00+01:00'));
    expect(nextOccurrence({ kind: 'daily', time: '07:00', from: '2026-11-02', until: '2026-11-05' }, Date.parse('2026-11-06T00:00:00+01:00'))).toBeNull();
  });
});

describe('runs and reports', () => {
  it('starts a cyclic run in a fresh conversation and schedules the next one', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', plan());
    expect(created.trigger).toMatchObject({ kind: 'daily', from: '2026-10-30', until: '2027-01-28' });
    clock = Date.parse('2026-10-31T07:00:00+01:00');
    await automations.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe('run-chat-1');
    expect(sent[0].automation.source).toBe('automation');
    expect(sent[0].text).toContain('Sprawdź cennik.');
    expect(sent[0].text).toContain('panel_automation_report');
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-11-01T07:00:00+01:00'));
  });

  it('saves the report, changes the notebook only when learn is on, and done ends the automation', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', plan({ trigger: { kind: 'once', at: NOW + 60_000 }, learn: true }));
    clock = NOW + 60_000;
    await automations.tick();
    expect(sent).toHaveLength(1);
    const run = await automations.report('chat-1', { outcome: 'done', summary: 'Cel osiągnięty.', notebook: 'Nowa wiedza.' });
    expect(run).toMatchObject({ outcome: 'done', notebookChanged: true, previousNotebook: '' });
    const after = (await automations.get(created.id))!;
    expect(after.status).toBe('done');
    expect(after.notebook).toBe('Nowa wiedza.');
    expect(after.runs).toHaveLength(1);
  });

  it('does not change the notebook when the automation does not learn', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', plan({ trigger: { kind: 'once', at: NOW + 60_000 }, learn: false }));
    clock = NOW + 60_000;
    await automations.tick();
    const run = await automations.report('chat-1', { outcome: 'not-yet', summary: 'Jeszcze nie.', notebook: 'Niedozwolone.' });
    expect(run.notebookChanged).toBe(false);
    expect((await automations.get(created.id))!.notebook).toBe('');
  });

  it('refuses a report outside a run', async () => {
    const automations = make();
    await expect(automations.report('chat-1', { outcome: 'done', summary: 'x' })).rejects.toMatchObject({ status: 409 });
  });

  it('turns a run without a report into an error after 15 minutes', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', plan({ trigger: { kind: 'once', at: NOW + 60_000 } }));
    clock = NOW + 60_000;
    await automations.tick();
    clock += RUN_REPORT_TIMEOUT_MS + 1;
    await automations.tick();
    const after = (await automations.get(created.id))!;
    expect(after.runs.at(-1)).toMatchObject({ outcome: 'error' });
    expect(after.status).toBe('done');
  });

  it('runs at most one overdue automation per tick after a restart', async () => {
    const automations = make();
    await automations.createFromPlan('chat-1', plan({ name: 'A', trigger: { kind: 'once', at: NOW + 60_000 } }));
    await automations.createFromPlan('chat-1', plan({ name: 'B', trigger: { kind: 'once', at: NOW + 60_000 } }));
    clock = NOW + 120_000;
    await automations.tick();
    expect(sent).toHaveLength(1);
    await automations.tick();
    expect(sent).toHaveLength(2);
    await automations.tick();
    expect(sent).toHaveLength(2);
  });

  it('with DESK_AUTOMATIONS=0 creates nothing and starts no run, yet the list answers', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', plan({ trigger: { kind: 'once', at: NOW + 60_000 } }));
    const off = make({ enabled: false });
    await expect(off.createFromPlan('chat-1', plan())).rejects.toThrow(/DESK_AUTOMATIONS/);
    clock = NOW + 60_000;
    await off.tick();
    expect(sent).toHaveLength(0);
    expect(await off.get(created.id)).toBeDefined();
  });
});

describe('one-shot observers', () => {
  it('reads a Polish moment and creates a once automation', async () => {
    const automations = make();
    expect(resolveObserverTime('za 10 minut', NOW)).toBe(NOW + 10 * 60_000);
    const created = await automations.createObserver({ chatId: 'chat-1', kind: 'time', target: 'za 10 minut', instruction: 'Przypomnij.' }) as Automation;
    expect(created.trigger).toEqual({ kind: 'once', at: NOW + 10 * 60_000 });
    expect(await automations.list()).toHaveLength(1);
  });
});
