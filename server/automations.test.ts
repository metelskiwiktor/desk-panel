// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomationExecutor } from './automation-actions';
import { createCalendarWriter } from './calendar-write';
import { smartView } from './smart-rules';
import type { PanelSources } from './sources';
import { createPanelServer } from './app';
import { createAutomations, nextOccurrence, resolveObserverTime } from './automations';
import { ChatError } from './agent-chat';
import { RUN_REPORT_TIMEOUT_MS, describeTrigger, scheduleLabel, triggerSchema, type Automation } from '../src/automation-contract';

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
  file: join(dir, 'automations.json'), now: () => clock, log: () => {}, ...over,
  chat: { ...(over.chat ?? chat), automationTurn: () => { const p = stored().pending[0]; return p ? { chatId: p.chatId, turnId: p.turnId, runId: 'hermes-run' } : undefined; } },
});
const plan = (over: Record<string, unknown> = {}) => ({
  name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'daily', time: '07:00' }, actions: [{ kind: 'message' }], learn: false, ...over,
} as never);
const stored = () => JSON.parse(readFileSync(join(dir, 'automations.json'), 'utf8'));
const pendingId = (at = 0) => stored().pending[at].id as string;

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

  it('keeps every historical observer, not just the newest 500', async () => {
    const observers = Array.from({ length: 501 }, (_, i) => ({
      id: `o-${i}`, chatId: 'old', kind: 'time', target: 'later', instruction: `instruction ${i}`,
      createdAt: NOW, expiresAt: NOW + 60_000, status: 'fired', firedAt: NOW, snapshot: { at: NOW },
    }));
    writeFileSync(join(dir, 'observers.json'), JSON.stringify({ version: 1, observers }));
    expect(await make({ observersFile: join(dir, 'observers.json') }).list()).toHaveLength(501);
  });

  it('keeps a corrupt observers file aside instead of silently skipping it', async () => {
    const file = join(dir, 'observers.json');
    writeFileSync(file, '{broken');
    const automations = make({ observersFile: file });
    await expect(automations.createFromPlan('chat-1', plan())).rejects.toMatchObject({ status: 503 });
    const aside = readdirSync(dir).find(name => name.startsWith('observers.json.corrupt-'));
    expect(aside).toBeTruthy();
    expect(readFileSync(join(dir, aside!), 'utf8')).toBe('{broken');
  });
});

describe('loading the store', () => {
  it('reads a live record with a legacy time without rewriting the file', async () => {
    const legacy = JSON.stringify({
      version: 1,
      automations: [{
        id: 'a-eeeeeeeeeeee', name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'daily', time: '07:00', from: '2026-10-30', until: '2026-12-30' },
        status: 'active', notebook: '', learn: false, actions: [{ kind: 'message' }], chatId: 'origin', createdAt: NOW, runs: [], changes: [],
      }],
      pending: [], outbox: [],
    });
    writeFileSync(join(dir, 'automations.json'), legacy);
    const automations = make();
    expect((await automations.list())[0].trigger).toEqual({ kind: 'daily', times: ['7:00'], from: '2026-10-30', until: '2026-12-30' });
    expect(readFileSync(join(dir, 'automations.json'), 'utf8')).toBe(legacy);
  });

  it('does not write on load just because the store was migrated earlier', async () => {
    const legacy = JSON.stringify({
      version: 1,
      migratedFrom: 'observers.json',
      automations: [{
        id: 'a-eeeeeeeeeeee', name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'daily', time: '07:00', from: '2026-10-30', until: '2026-12-30' },
        status: 'active', notebook: '', learn: false, actions: [{ kind: 'message' }], chatId: 'origin', createdAt: NOW, runs: [], changes: [],
      }],
      pending: [], outbox: [],
    });
    writeFileSync(join(dir, 'automations.json'), legacy);
    const automations = make();
    expect((await automations.list())[0].trigger).toEqual({ kind: 'daily', times: ['7:00'], from: '2026-10-30', until: '2026-12-30' });
    expect(readFileSync(join(dir, 'automations.json'), 'utf8')).toBe(legacy);
  });

  it('keeps a corrupt automations.json aside instead of overwriting it with an empty store', async () => {
    writeFileSync(join(dir, 'automations.json'), '{broken');
    const automations = make();
    expect(await automations.list()).toEqual([]);
    const aside = readdirSync(dir).find(name => name.startsWith('automations.json.corrupt-'));
    expect(aside).toBeTruthy();
    expect(readFileSync(join(dir, aside!), 'utf8')).toBe('{broken');
  });
});

describe('daily and weekly scheduling in Europe/Warsaw', () => {
  it('reads the local clock and lands on the next day when today\u2019s hour passed', () => {
    const after = Date.parse('2026-10-30T08:00:00+01:00');
    expect(nextOccurrence({ kind: 'daily', times: ['7:00'] }, after)).toBe(Date.parse('2026-10-31T07:00:00+01:00'));
    expect(nextOccurrence({ kind: 'daily', times: ['19:00'] }, after)).toBe(Date.parse('2026-10-30T19:00:00+01:00'));
  });
  it('keeps the local hour across the DST change', () => {
    // Sunday 25.10.2026 is when Europe/Warsaw leaves summer time (03:00 -> 02:00).
    const saturday = Date.parse('2026-10-24T12:00:00+02:00');
    const next = nextOccurrence({ kind: 'daily', times: ['7:00'] }, saturday)!;
    expect(new Date(next).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })).toBe('07:00');
    const monday = nextOccurrence({ kind: 'weekly', weekday: 1, times: ['7:00'] }, Date.parse('2026-10-24T12:00:00+02:00'))!;
    expect(new Date(monday).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })).toBe('07:00');
  });
  it('honours from and until', () => {
    expect(nextOccurrence({ kind: 'daily', times: ['7:00'], from: '2026-11-02', until: '2026-11-05' }, NOW)).toBe(Date.parse('2026-11-02T07:00:00+01:00'));
    expect(nextOccurrence({ kind: 'daily', times: ['7:00'], from: '2026-11-02', until: '2026-11-05' }, Date.parse('2026-11-06T00:00:00+01:00'))).toBeNull();
  });
});

describe('several times a day in one automation', () => {
  it('normalizes a legacy time and sorts distinct times into one canonical form', () => {
    expect(triggerSchema.parse({ kind: 'daily', time: '07:00' })).toEqual({ kind: 'daily', times: ['7:00'] });
    expect(triggerSchema.parse({ kind: 'weekly', weekday: 1, time: '18:30' })).toEqual({ kind: 'weekly', weekday: 1, times: ['18:30'] });
    expect(triggerSchema.parse({ kind: 'daily', times: ['19:00', '7:00', '12:00'] })).toEqual({ kind: 'daily', times: ['7:00', '12:00', '19:00'] });
    expect(() => triggerSchema.parse({ kind: 'daily', times: [] })).toThrow();
  });

  it('rejects duplicates after normalizing and more than six entries instead of merging them', () => {
    expect(() => triggerSchema.parse({ kind: 'daily', times: ['7:00', '07:00'] })).toThrow();
    expect(() => triggerSchema.parse({ kind: 'daily', times: ['1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00'] })).toThrow();
    expect(() => triggerSchema.parse({ kind: 'daily', times: ['1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00', '07:00'] })).toThrow();
  });

  it('picks the earliest upcoming time across a day boundary and respects until and from', () => {
    const daily = triggerSchema.parse({ kind: 'daily', times: ['7:00', '19:00'] });
    expect(nextOccurrence(daily, Date.parse('2026-10-30T06:00:00+01:00'))).toBe(Date.parse('2026-10-30T07:00:00+01:00'));
    expect(nextOccurrence(daily, Date.parse('2026-10-30T08:00:00+01:00'))).toBe(Date.parse('2026-10-30T19:00:00+01:00'));
    expect(nextOccurrence(daily, Date.parse('2026-10-30T20:00:00+01:00'))).toBe(Date.parse('2026-10-31T07:00:00+01:00'));
    expect(nextOccurrence(triggerSchema.parse({ kind: 'daily', times: ['7:00', '19:00'], until: '2026-10-30' }), Date.parse('2026-10-30T20:00:00+01:00'))).toBeNull();
    expect(nextOccurrence(triggerSchema.parse({ kind: 'daily', times: ['7:00', '19:00'], from: '2026-11-02', until: '2026-11-03' }), NOW)).toBe(Date.parse('2026-11-02T07:00:00+01:00'));
  });

  it('keeps the weekly day and takes the next time on it', () => {
    const weekly = triggerSchema.parse({ kind: 'weekly', weekday: 1, times: ['7:00', '19:00'] });
    expect(nextOccurrence(weekly, Date.parse('2026-10-26T08:00:00+01:00'))).toBe(Date.parse('2026-10-26T19:00:00+01:00'));
    expect(nextOccurrence(weekly, Date.parse('2026-10-26T20:00:00+01:00'))).toBe(Date.parse('2026-11-02T07:00:00+01:00'));
  });

  it('describes several times in Polish', () => {
    expect(describeTrigger(triggerSchema.parse({ kind: 'daily', times: ['7:00', '19:00'] }))).toBe('codziennie 7:00 i 19:00');
    expect(scheduleLabel(triggerSchema.parse({ kind: 'daily', times: ['7:00', '19:00'] }))).toBe('codziennie 7:00 i 19:00');
    expect(describeTrigger(triggerSchema.parse({ kind: 'weekly', weekday: 1, times: ['7:00', '12:00', '19:00'] }))).toBe('w poniedziałki 7:00, 12:00 i 19:00');
    expect(scheduleLabel(triggerSchema.parse({ kind: 'weekly', weekday: 1, times: ['7:00', '12:00', '19:00'] }))).toBe('poniedziałki 7:00, 12:00 i 19:00');
  });

  it('runs each time once and does not double-run when the panel was off', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', { name: 'Zapisy', goal: 'Sprawdź zapisy.', trigger: { kind: 'daily', times: ['7:00', '19:00'] }, actions: [{ kind: 'message' }], learn: false });
    expect(created.nextRunAt).toBe(Date.parse('2026-10-30T19:00:00+01:00'));
    clock = Date.parse('2026-10-31T08:00:00+01:00');
    await automations.tick();
    expect(sent).toHaveLength(1);
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-10-31T19:00:00+01:00'));
    const run = stored().pending[0];
    automations.turnChanged({ chatId: run.chatId, turnId: run.turnId, runId: 'hermes-run', ended: false });
    await automations.report({ runId: run.id, token: run.token, outcome: 'not-yet', summary: 'Jeszcze nie.' });
    const execution = stored().execution!;
    automations.turnChanged({ chatId: execution.chatId, turnId: execution.turnId, runId: 'hermes-run', ended: true });
    await automations.tick();
    expect(sent).toHaveLength(1);
    clock = Date.parse('2026-10-31T19:00:00+01:00');
    await automations.tick();
    expect(sent).toHaveLength(2);
  });

  it('keeps the next run a schedule change set while a run was going, instead of backdating it to the old slot', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', { name: 'Zapisy', goal: 'Sprawdź zapisy.', trigger: { kind: 'daily', times: ['7:00'] }, actions: [{ kind: 'message' }], learn: false });
    clock = Date.parse('2026-10-31T07:00:30+01:00');
    await automations.tick();
    const run = stored().pending[0];
    automations.turnChanged({ chatId: run.chatId, turnId: run.turnId, runId: 'hermes-run', ended: false });
    clock = Date.parse('2026-10-31T07:05:00+01:00');
    await automations.createFromPlan('chat-1', { name: 'Zapisy', goal: 'Sprawdź zapisy.', trigger: { kind: 'daily', times: ['7:03', '7:10'] }, actions: [{ kind: 'message' }], learn: false, replaces: created.id });
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-10-31T07:10:00+01:00'));
    clock = Date.parse('2026-10-31T07:06:00+01:00');
    await automations.report({ runId: run.id, token: run.token, outcome: 'not-yet', summary: 'Jeszcze nie.' });
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-10-31T07:10:00+01:00'));
  });

  it('runs a slot that passed while a run was in progress instead of skipping it', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', { name: 'Zapisy', goal: 'Sprawdź zapisy.', trigger: { kind: 'daily', times: ['7:00', '7:01'] }, actions: [{ kind: 'message' }], learn: false });
    expect(created.nextRunAt).toBe(Date.parse('2026-10-31T07:00:00+01:00'));
    clock = Date.parse('2026-10-31T07:00:30+01:00');
    await automations.tick();
    expect(sent).toHaveLength(1);
    const run = stored().pending[0];
    automations.turnChanged({ chatId: run.chatId, turnId: run.turnId, runId: 'hermes-run', ended: false });
    // 07:01 passes while the 07:00 run is still going.
    clock = Date.parse('2026-10-31T07:02:00+01:00');
    await automations.report({ runId: run.id, token: run.token, outcome: 'not-yet', summary: 'Jeszcze nie.' });
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-10-31T07:01:00+01:00'));
    const execution = stored().execution!;
    automations.turnChanged({ chatId: execution.chatId, turnId: execution.turnId, runId: 'hermes-run', ended: true });
    await automations.tick();
    expect(sent).toHaveLength(2);
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-11-01T07:00:00+01:00'));
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
    expect(sent[0].text).toContain('filtruj już w poleceniu');
    expect(sent[0].text).toContain('Brak frazy w wyniku filtra nie dowodzi');
    expect((await automations.get(created.id))!.nextRunAt).toBe(Date.parse('2026-11-01T07:00:00+01:00'));
  });

  it('saves the report, changes the notebook only when learn is on, and done ends the automation', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', plan({ trigger: { kind: 'once', at: NOW + 60_000 }, learn: true }));
    clock = NOW + 60_000;
    await automations.tick();
    expect(sent).toHaveLength(1);
    automations.turnChanged({ chatId: stored().pending[0].chatId, turnId: stored().pending[0].turnId, runId: 'hermes-run', ended: false });
    const run = await automations.report({ runId: pendingId(), token: stored().pending[0].token, outcome: 'done', summary: 'Cel osiągnięty.', notebook: 'Nowa wiedza.' });
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
    automations.turnChanged({ chatId: stored().pending[0].chatId, turnId: stored().pending[0].turnId, runId: 'hermes-run', ended: false });
    const run = await automations.report({ runId: pendingId(), token: stored().pending[0].token, outcome: 'not-yet', summary: 'Jeszcze nie.', notebook: 'Niedozwolone.' });
    expect(run.notebookChanged).toBe(false);
    expect((await automations.get(created.id))!.notebook).toBe('');
  });

  it('refuses a report outside a run', async () => {
    const automations = make();
    await expect(automations.report({ runId: 'run-000000000000', token: '0'.repeat(32), outcome: 'done', summary: 'x' })).rejects.toMatchObject({ status: 409 });
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

  it('queues overdue automations until the previous turn ends', async () => {
    const automations = make();
    await automations.createFromPlan('chat-1', plan({ name: 'A', trigger: { kind: 'once', at: NOW + 60_000 } }));
    await automations.createFromPlan('chat-1', plan({ name: 'B', trigger: { kind: 'once', at: NOW + 60_000 } }));
    clock = NOW + 120_000;
    await automations.tick();
    expect(sent).toHaveLength(1);
    await automations.tick();
    expect(sent).toHaveLength(1);
    const first = stored().pending[0];
    automations.turnChanged({ chatId: first.chatId, turnId: first.turnId, runId: 'hermes-run', ended: true });
    await automations.tick();
    expect(sent.filter(s => s.text.includes('panel_automation_report'))).toHaveLength(2);
    await automations.tick();
    expect(sent.filter(s => s.text.includes('panel_automation_report'))).toHaveLength(2);
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

describe('run identity and restarts', () => {
  it('reserves a cyclic run before starting it, so a restart resumes it exactly once', async () => {
    let release!: (value: { id: string }) => void;
    const gate = new Promise<{ id: string }>(resolve => { release = resolve; });
    const automations = make({ chat: { createAutomation: () => gate } });
    await automations.createFromPlan('origin', plan());
    clock = Date.parse('2026-10-31T07:00:00+01:00');
    const tick = automations.tick();
    await vi.waitFor(() => expect(stored().pending).toHaveLength(1));
    expect(stored().automations[0].nextRunAt).toBeGreaterThan(clock);
    const send = vi.fn(async () => ({ id: 'restart-run' }));
    const restart = make({ chat: { createAutomation: send } });
    await restart.tick();
    expect(send).toHaveBeenCalledTimes(1);
    release({ id: 'run-chat-1' });
    await tick;
  });

  it('keeps a result through a transient 503 and sends it once after a restart', async () => {
    const send = vi.fn(async () => {});
    const automations = make({ chat: { sendAutomation: send } });
    await automations.createFromPlan('origin', plan({ trigger: { kind: 'once', at: NOW + 60_000 } }));
    clock += 60_000;
    await automations.tick();
    send.mockRejectedValue(new ChatError(503, 'Hermes unavailable'));
    automations.turnChanged({ chatId: stored().pending[0].chatId, turnId: stored().pending[0].turnId, runId: 'hermes-run', ended: false });
    await automations.report({ runId: pendingId(), token: stored().pending[0].token, outcome: 'done', summary: 'Done' });
    await automations.tick();
    expect(stored().outbox).toHaveLength(1);
    expect(stored().outbox[0].nonce).toBeTruthy();
    automations.stop();
    const after = vi.fn(async () => {});
    const restart = make({ chat: { sendAutomation: after } });
    await restart.tick();
    await restart.tick();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('drops a result for a conversation that is gone', async () => {
    const send = vi.fn(async () => {});
    const automations = make({ chat: { sendAutomation: send } });
    await automations.createFromPlan('origin', plan({ trigger: { kind: 'once', at: NOW + 60_000 } }));
    clock += 60_000;
    await automations.tick();
    send.mockRejectedValue(new ChatError(404, 'Nie ma takiej rozmowy.'));
    automations.turnChanged({ chatId: stored().pending[0].chatId, turnId: stored().pending[0].turnId, runId: 'hermes-run', ended: false });
    await automations.report({ runId: pendingId(), token: stored().pending[0].token, outcome: 'done', summary: 'Done' });
    await automations.tick();
    expect(stored().outbox).toEqual([]);
  });
});

describe('schedules and limits', () => {
  it('runs the last daily occurrence on its until date, then expires on not-yet', async () => {
    const send = vi.fn(async () => ({ id: 'run-chat' }));
    const automations = make({ chat: { createAutomation: send } });
    const created = await automations.createFromPlan('origin', plan({ trigger: { kind: 'daily', time: '07:00', until: '2026-10-31' } }));
    clock = Date.parse('2026-10-31T07:00:00+01:00');
    await automations.tick();
    expect(send).toHaveBeenCalledTimes(1);
    const run = stored().pending[0];
    automations.turnChanged({ chatId: stored().pending[0].chatId, turnId: stored().pending[0].turnId, runId: 'hermes-run', ended: false });
    await automations.report({ runId: run.id, token: run.token, outcome: 'not-yet', summary: 'Jeszcze nie.' });
    expect((await automations.get(created.id))!.status).toBe('expired');
  });

  it('keeps the scheduled hour across the spring DST gap', () => {
    const after = Date.parse('2026-03-29T04:00:00+02:00');
    expect(nextOccurrence({ kind: 'daily', times: ['2:30'] }, after)).toBe(Date.parse('2026-03-30T02:30:00+02:00'));
    expect(nextOccurrence({ kind: 'weekly', weekday: 7, times: ['2:30'] }, after)).toBe(Date.parse('2026-04-05T02:30:00+02:00'));
    expect(nextOccurrence({ kind: 'daily', times: ['2:30'] }, Date.parse('2026-03-28T12:00:00+01:00'))).toBe(Date.parse('2026-03-29T03:30:00+02:00'));
  });

  it('does not let resume bypass the active-automation limit', async () => {
    const automations = make();
    const first = await automations.createFromPlan('origin', plan());
    await automations.update({ id: first.id, action: 'pause' });
    for (let i = 0; i < 20; i++) await automations.createFromPlan('origin', plan());
    await expect(automations.update({ id: first.id, action: 'resume' })).rejects.toMatchObject({ status: 409 });
    expect((await automations.list()).filter(a => a.status === 'active')).toHaveLength(20);
    expect((await automations.get(first.id))!.status).toBe('paused');
  });

  it('leaves the original automation active when creating its replacement fails', async () => {
    const automations = make();
    const original = await automations.createFromPlan('origin', plan());
    await expect(automations.createFromPlan('origin', {
      name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'once', at: NOW - 1 }, actions: [{ kind: 'message' }], learn: false, replaces: original.id,
    })).rejects.toThrow(/minął/);
    expect((await automations.get(original.id))!.status).toBe('active');
  });
});

describe('delivery serialization', () => {
  it('does not send the same pending run twice from a Cezar callback and a tick', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const send = vi.fn(async () => { await gate; });
    const automations = make({ readTask: async () => ({ status: 'running' }), chat: { sendAutomation: send } });
    await automations.createObserver({ chatId: 'origin', kind: 'cezar', target: 'repo/task', instruction: 'Watch' });
    const first = automations.active([{ id: 'repo/task', status: 'needs-input' }] as never);
    expect(send).toHaveBeenCalledTimes(1);
    const second = automations.tick();
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
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


describe('in-place consent updates', () => {
  it('preserves identity, history, notebook and paused status at the active limit, persists the diff and recalculates the schedule', async () => {
    const automations = make();
    const original = await automations.createFromPlan('origin', plan());
    await automations.update({ id: original.id, notebook: 'Ważna notatka' });
    await automations.update({ id: original.id, action: 'runNow' });
    const run = stored().pending[0];
    automations.turnChanged({ chatId: run.chatId, turnId: run.turnId, runId: 'hermes-run', ended: false });
    await automations.report({ runId: run.id, token: run.token, outcome: 'not-yet', summary: 'Jeszcze nie.' });
    await automations.update({ id: original.id, action: 'pause' });
    for (let i = 0; i < 20; i++) await automations.createFromPlan('other', plan());
    const before = (await automations.get(original.id))!;
    clock += 60_000;
    const updated = await automations.createFromPlan('different-chat', plan({ replaces: original.id, name: 'Nowa nazwa', goal: 'Nowy cel', trigger: { kind: 'daily', time: '18:00' } }));
    expect(updated).toMatchObject({ id: original.id, chatId: 'origin', createdAt: original.createdAt, status: 'paused', notebook: before.notebook, runs: before.runs });
    expect(updated.nextRunAt).toBe(Date.parse('2026-10-30T18:00:00+01:00'));
    expect(updated.changes.at(-1)).toMatchObject({ at: clock, by: 'user', fields: { name: { before: 'Ceny', after: 'Nowa nazwa' }, goal: { before: 'Sprawdź cennik.', after: 'Nowy cel' }, trigger: { before: before.trigger, after: updated.trigger } } });
    expect((await make().get(original.id))!.changes).toEqual(updated.changes);
    // Updating an active record at 20 active entries also consumes no new slot.
    const active = (await automations.list()).find(a => a.status === 'active')!;
    expect((await automations.createFromPlan('different-chat', plan({ replaces: active.id, name: 'Aktywny' }))).status).toBe('active');
    expect(await automations.list()).toHaveLength(21);
    for (let i = 0; i < 55; i++) await automations.createFromPlan('origin', plan({ replaces: original.id, name: `Nazwa ${i}` }));
    expect((await make().get(original.id))!.changes).toHaveLength(50);
  });

  it('keeps a pending run and its settings across an update and restart; the following run gets the new settings', async () => {
    let automations = make();
    const original = await automations.createFromPlan('origin', plan({ learn: true }));
    await automations.update({ id: original.id, action: 'runNow' });
    const run = stored().pending[0];
    automations.turnChanged({ chatId: run.chatId, turnId: run.turnId, runId: 'hermes-run', ended: false });
    await automations.createFromPlan('elsewhere', plan({ replaces: original.id, goal: 'Nowy cel', learn: false, trigger: { kind: 'daily', time: '18:00' } }));
    expect(stored().pending[0]).toMatchObject({ id: run.id, token: run.token, hermesRunId: 'hermes-run', settings: { learn: true, goal: 'Sprawdź cennik.' } });
    automations = make();
    await automations.report({ runId: run.id, token: run.token, outcome: 'not-yet', summary: 'Dokończony.', notebook: 'Z poprzedniego runu' });
    expect((await automations.get(original.id))!.notebook).toBe('Z poprzedniego runu');
    expect((await automations.get(original.id))!.runs).toHaveLength(1);
    expect((await automations.get(original.id))!.nextRunAt).toBe(Date.parse('2026-10-30T18:00:00+01:00'));
    const execution = stored().execution;
    automations.turnChanged({ chatId: execution.chatId, turnId: execution.turnId, runId: 'hermes-run', ended: true });
    await automations.update({ id: original.id, action: 'runNow' });
    expect(sent.at(-1)!.text).toContain('Nowy cel');
    expect(stored().pending[0].settings.learn).toBe(false);
  });

  it.each(['done', 'expired', 'cancelled'] as const)('refuses a %s record without changing history', async status => {
    const automations = make();
    const a = await automations.createFromPlan('origin', plan());
    const data = stored(); data.automations[0].status = status;
    writeFileSync(join(dir, 'automations.json'), JSON.stringify(data));
    const reloaded = make();
    await expect(reloaded.createFromPlan('origin', plan({ replaces: a.id }))).rejects.toThrow(/nowy automat bez replaces/);
    expect(stored()).toEqual(data);
  });
});


describe('consented run actions', () => {
  const actions = [{ kind: 'calendarEvent', reminderMinutes: 45, domain: 'example.com' }, { kind: 'smartAction', domain: 'example.com' }, { kind: 'notify', domain: 'example.com' }];
  async function running(executeAction: Parameters<typeof createAutomations>[0]['executeAction'], log?: (line: string) => void) {
    const automations = make({ executeAction, ...(log ? { log } : {}) });
    const a = await automations.createFromPlan('origin', plan({ actions }));
    await automations.update({ id: a.id, action: 'runNow' });
    const p = stored().pending[0];
    automations.turnChanged({ chatId: p.chatId, turnId: p.turnId, runId: 'hermes-run', ended: false });
    return { automations, a, p, input: { runId: p.id, token: p.token, title: 'Nowe zapisy', url: 'https://forms.example.com/signup' } };
  }
  it.each(['notify', 'calendarEvent', 'smartAction'] as const)('requires a separate non-public domain for %s links on create, update and act', async action => {
    const { automations, a, input } = await running(vi.fn().mockResolvedValue('ref'));
    for (const domain of ['co.uk', 'github.io']) {
      await expect(automations.createFromPlan('origin', plan({ actions: [{ kind: action, domain }] }))).rejects.toThrow();
      await expect(automations.createFromPlan('origin', plan({ replaces: a.id, actions: [{ kind: action, domain }] }))).rejects.toThrow();
    }
    await expect(automations.act({ ...input, action, url: 'https://evil.test/' })).rejects.toMatchObject({ status: 403 });
    if (action !== 'smartAction') {
      await automations.createFromPlan('origin', plan({ replaces: a.id, actions: [{ kind: action, ...(action === 'calendarEvent' ? { reminderMinutes: 45 } : {}) }] }));
      await expect(automations.act({ ...input, action })).rejects.toMatchObject({ status: 403 });
      expect((await automations.act({ ...input, action, url: undefined })).result).toBe('ok');
    }
  });
  it.each(['notify', 'calendarEvent', 'smartAction'] as const)('permits %s content without a link when no domain was approved', async action => {
    const execute = vi.fn().mockResolvedValue('ref');
    const automations = make({ executeAction: execute });
    const a = await automations.createFromPlan('origin', plan({ actions: [{ kind: action }] }));
    await automations.update({ id: a.id, action: 'runNow' });
    const p = stored().pending[0];
    automations.turnChanged({ chatId: p.chatId, turnId: p.turnId, runId: 'hermes-run', ended: false });
    const input = { runId: p.id, token: p.token, action, title: 'Treść' };
    await expect(automations.act({ ...input, url: 'https://example.com/' })).rejects.toMatchObject({ status: 403 });
    expect((await automations.act(input)).result).toBe('ok');
  });
  it('uses the separate approved domain of each action', async () => {
    const automations = make({ executeAction: vi.fn().mockResolvedValue('ref') });
    const actions = [{ kind: 'notify', domain: 'notify.example.com' }, { kind: 'calendarEvent', domain: 'calendar.example.com' }, { kind: 'smartAction', domain: 'smart.example.com' }];
    const a = await automations.createFromPlan('origin', plan({ actions }));
    await automations.update({ id: a.id, action: 'runNow' });
    const p = stored().pending[0];
    automations.turnChanged({ chatId: p.chatId, turnId: p.turnId, runId: 'hermes-run', ended: false });
    for (const { kind, domain } of actions) {
      const input = { runId: p.id, token: p.token, action: kind as 'notify' | 'calendarEvent' | 'smartAction', title: 'Treść' };
      await expect(automations.act({ ...input, url: 'https://other.example.com/' })).rejects.toMatchObject({ status: 403 });
      expect((await automations.act({ ...input, url: `https://${domain}/` })).result).toBe('ok');
    }
  });
  it.each(['pause', 'cancel'] as const)('blocks act after %s', async action => {
    const execute = vi.fn();
    const { automations, a, input } = await running(execute);
    await automations.update({ id: a.id, action });
    await expect(automations.act({ ...input, action: 'notify' })).rejects.toMatchObject({ status: action === 'pause' ? 403 : 409 });
    expect(execute).not.toHaveBeenCalled();
  });
  it('allows only narrower domains, keeps Calendar parameters fixed and cannot gain permissions mid-run', async () => {
    const execute = vi.fn().mockResolvedValue('ref');
    const { automations, a, input } = await running(execute);
    await automations.createFromPlan('origin', plan({ replaces: a.id, actions: [
      { kind: 'notify', domain: 'forms.example.com' }, { kind: 'calendarEvent', reminderMinutes: 15, domain: 'example.com' },
    ] }));
    await expect(automations.act({ ...input, action: 'calendarEvent', when: '2027-01-01T10:00' })).rejects.toMatchObject({ status: 403 });
    await expect(automations.act({ ...input, action: 'notify', url: 'https://other.example.com/' })).rejects.toMatchObject({ status: 403 });
    expect((await automations.act({ ...input, action: 'notify' })).result).toBe('ok');
    expect(execute.mock.calls[0][1].domain).toBe('forms.example.com');
    await automations.createFromPlan('origin', plan({ replaces: a.id, actions: [{ kind: 'smartAction', domain: 'evil.test' }] }));
    await expect(automations.act({ ...input, action: 'smartAction', url: 'https://evil.test/' })).rejects.toMatchObject({ status: 403 });
  });
  it('does not grant a newly added kind to the run that started with message only', async () => {
    const execute = vi.fn();
    const automations = make({ executeAction: execute });
    const a = await automations.createFromPlan('origin', plan());
    await automations.update({ id: a.id, action: 'runNow' });
    const p = stored().pending[0];
    automations.turnChanged({ chatId: p.chatId, turnId: p.turnId, runId: 'hermes-run', ended: false });
    await automations.createFromPlan('origin', plan({ replaces: a.id, actions: [{ kind: 'notify', domain: 'example.com' }] }));
    await expect(automations.act({ runId: p.id, token: p.token, action: 'notify', title: 'New' })).rejects.toMatchObject({ status: 403 });
    expect(execute).not.toHaveBeenCalled();
  });
  it('returns 404 for a removed automation and rejects a legacy public-suffix consent at act', async () => {
    const { input } = await running(vi.fn());
    const data = stored();
    data.automations[0].actions = [{ kind: 'notify', domain: 'github.io' }];
    data.pending[0].settings.actions = [{ kind: 'notify', domain: 'github.io' }];
    // Simulate a previously accepted consent without bypassing the effect boundary.
    // The store schema also rejects it on reload; no action can be executed.
    writeFileSync(join(dir, 'automations.json'), JSON.stringify(data));
    await expect(make().act({ ...input, action: 'notify', url: 'https://owner.github.io/' })).rejects.toMatchObject({ status: 503 });
    // A valid orphan reservation has a distinct 404 response, not a null dereference.
    data.automations = [];
    data.pending[0].settings.actions = [{ kind: 'notify', domain: 'example.com' }];
    writeFileSync(join(dir, 'automations.json'), JSON.stringify(data));
    rmSync(join(dir, 'automations.json.blocked'), { force: true });
    await expect(make().act({ ...input, action: 'notify' })).rejects.toMatchObject({ status: 404 });
  });
  it('normalizes the link passed to the provider and saved for the bell', async () => {
    const execute = vi.fn().mockResolvedValue('ref');
    const { automations, input } = await running(execute);
    expect((await automations.act({ ...input, action: 'notify', url: 'HTTPS://Example.COM:443/x' })).url).toBe('https://example.com/x');
    expect(execute.mock.calls[0][0].url).toBe('https://example.com/x');
    expect(stored().pending[0].actions[0].url).toBe('https://example.com/x');
  });
  it('rejects report while a provider is pending, but permits pause and cancel without waiting for the network', async () => {
    let release!: (ref: string) => void;
    const gate = new Promise<string>(resolve => { release = resolve; });
    const execute = vi.fn(() => gate);
    const { automations, a, input } = await running(execute);
    const act = automations.act({ ...input, action: 'notify' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    try {
      await expect(automations.report({ runId: input.runId, token: input.token, outcome: 'done', summary: 'Done' })).rejects.toMatchObject({ status: 409 });
      await automations.update({ id: a.id, action: 'pause' });
      await automations.update({ id: a.id, action: 'cancel' });
    } finally { release('ref'); await act; }
    const run = (await automations.get(a.id))!.runs[0];
    expect(run.actions![0].result).toBe('ok');
    expect(stored().automations[0].runs[0].actions[0].result).toBe('ok');
  });
  it('requires the approved kind, token, live turn and enabled automations; links respect domain boundaries', async () => {
    const execute = vi.fn().mockResolvedValue('ref');
    const { automations, a, p, input } = await running(execute);
    for (const url of ['https://example.com.evil.test/', 'http://example.com/', 'https://evilexample.com/', 'https://user:pass@example.com/', 'https://example.com:444/']) {
      await expect(automations.act({ ...input, action: 'smartAction', url })).rejects.toMatchObject({ status: 403 });
    }
    await expect(automations.act({ ...input, token: '0'.repeat(32), action: 'notify' })).rejects.toMatchObject({ status: 409 });
    await expect(make({ enabled: false }).act({ ...input, action: 'notify' })).rejects.toMatchObject({ status: 409 });
    expect(execute).not.toHaveBeenCalled();
    // Removing consent immediately blocks the action in the running turn.
    await automations.createFromPlan('origin', plan({ replaces: a.id, actions: [{ kind: 'message' }] }));
    await expect(automations.act({ ...input, action: 'notify' })).rejects.toMatchObject({ status: 403 });
    automations.turnChanged({ chatId: p.chatId, turnId: p.turnId, runId: 'hermes-run', ended: true });
    await expect(automations.act({ ...input, action: 'notify' })).rejects.toMatchObject({ status: 409 });
    const other = make();
    const b = await other.createFromPlan('other', plan());
    await other.update({ id: b.id, action: 'runNow' });
    const q = stored().pending[0];
    other.turnChanged({ chatId: q.chatId, turnId: q.turnId, runId: 'hermes-run', ended: false });
    await expect(other.act({ ...input, runId: q.id, token: q.token, action: 'notify' })).rejects.toMatchObject({ status: 403 });
  });
  it('executes once under parallel calls and after restart, persists refs; alerts reach the HTTP API', async () => {
    const execute = vi.fn(createAutomationExecutor({}));
    const { automations, a, input } = await running(execute);
    const call = { ...input, action: 'smartAction' as const, text: 'Formularz już działa.' };
    const results = await Promise.all([automations.act(call), automations.act(call)]);
    expect(results[0].result).toBe('ok');
    expect(['pending', 'ok']).toContain(results[1].result); expect(execute).toHaveBeenCalledOnce();
    const reloaded = make({ executeAction: execute });
    expect(await reloaded.act(call)).toEqual(results[0]); expect(execute).toHaveBeenCalledOnce();
    await reloaded.report({ runId: input.runId, token: input.token, outcome: 'done', summary: 'Zapisy ruszyły.' });
    expect((await reloaded.get(a.id))!.runs[0].actions).toEqual(results.slice(0, 1));
    const sources = { automations: async () => ({ automations: await reloaded.list() }), mail: async () => ({ data: [] }) } as unknown as PanelSources;
    const time = vi.spyOn(Date, 'now').mockReturnValue(clock);
    expect((await smartView(sources)).alerts[0]).toMatchObject({ source: 'automation', url: input.url, badge: 'Automat: Ceny', id: `${input.runId}:smartAction` });
    const server = createPanelServer(sources, dir);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/smart-actions`);
      expect(response.status).toBe(200);
      expect((await response.json()).alerts[0].title).toBe('Nowe zapisy');
    } finally { time.mockRestore(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('writes the consent reminder with a stable Google id and recovers identical insert on 409', async () => {
    let saved: any;
    let inserts = 0;
    const request = vi.fn(async (_path: string, init: any) => {
      if (init.method === 'GET') return saved;
      inserts++;
      if (saved) throw Object.assign(new Error(), { response: { status: 409 } });
      saved = { ...init.data, htmlLink: 'https://calendar.google.com/calendar/event?eid=fixture' };
      return saved;
    });
    const writeCalendar = createCalendarWriter(request);
    const execute = createAutomationExecutor({ writeCalendar });
    const { automations, input } = await running(execute);
    const call = { ...input, action: 'calendarEvent' as const, when: '2027-01-10T10:30' };
    const result = await automations.act(call);
    expect(result.result).toBe('ok');
    expect(saved.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 45 }] });
    await automations.act(call); expect(inserts).toBe(1);
    // Lost-response retry of the existing writer uses the same key, not a new Google id.
    const ref = await execute(call, { kind: 'calendarEvent', reminderMinutes: 45 }, `${input.runId}:calendarEvent`, 'Ceny');
    expect(ref).toBe(result.ref); expect(inserts).toBe(2);
    expect(request.mock.calls.at(-1)![0]).toBe(`/events/${result.ref}`);
  });
  it('keeps a failed action and its message, permits reporting; never leaks provider errors', async () => {
    const { automations, a, input } = await running(createAutomationExecutor({ writeCalendar: vi.fn().mockRejectedValue(new Error('private-key')) }));
    const result = await automations.act({ ...input, action: 'calendarEvent', when: '2027-01-10T10:30' });
    expect(result).toMatchObject({ result: 'error', error: expect.stringContaining('calendar.events.owned') });
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(stored().outbox[0].text).toContain('błąd akcji');
    await automations.report({ runId: input.runId, token: input.token, outcome: 'done', summary: 'Cel osiągnięty; błąd kalendarza.' });
    expect((await automations.get(a.id))!.runs[0].actions![0].result).toBe('error');
  });
  it('sends ntfy only when opted in; topic and raw fetch error stay out of logs and public results', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const input = { action: 'notify' as const, title: 'Zapisy ruszyły', text: 'Formularz działa. Dalszy tekst.', runId: 'run-123456789abc', token: '0'.repeat(32), url: 'https://example.com/' };
    await createAutomationExecutor({ fetcher })(input, { kind: 'notify' }, 'key', 'Nazwa');
    expect(fetcher).not.toHaveBeenCalled();
    const secret = 'https://ntfy.sh/private-topic';
    const log = vi.fn();
    const execute = createAutomationExecutor({ fetcher, ntfyUrl: secret });
    const { automations, a, input: runInput } = await running(execute, log);
    fetcher.mockRejectedValueOnce(new Error(secret));
    expect(await automations.act({ ...runInput, action: 'notify', text: input.text })).toMatchObject({ result: 'error', error: expect.stringContaining('dzwonku') });
    await automations.act({ ...runInput, action: 'notify' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(secret);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', body: 'Formularz działa.' });
    await automations.report({ runId: runInput.runId, token: runInput.token, outcome: 'done', summary: 'Powiadomiono.' });
    expect(JSON.stringify(await automations.get(a.id))).not.toContain(secret);
    expect(stored().automations[0].runs[0].actions[0].result).toBe('error');
    expect(JSON.stringify(stored().outbox)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-topic');
    expect(log.mock.calls.some(([line]) => line.includes('done'))).toBe(true);
  });
  it('uses consented all-day date, exclusive next day across DST, and rejects malformed local clocks', async () => {
    const writer = vi.fn().mockResolvedValue({ id: 'event' });
    const execute = createAutomationExecutor({ writeCalendar: writer });
    const input = { action: 'calendarEvent' as const, title: 'Dzień', runId: 'run-123456789abc', token: '0'.repeat(32), when: '2027-10-31' };
    await execute(input, { kind: 'calendarEvent', allDay: true }, 'key', 'Nazwa');
    expect(writer.mock.calls[0][1]).toMatchObject({ allDay: true, reminderMinutes: 60, startAt: Date.parse('2027-10-31T00:00:00+02:00'), endAt: Date.parse('2027-11-01T00:00:00+01:00') });
    for (const when of ['2027-02-30T10:00', '2027-03-28T02:30', '2027-01-01T10:00Z']) await expect(execute({ ...input, when }, { kind: 'calendarEvent' }, 'key', 'Nazwa')).rejects.toMatchObject({ status: 400 });
    expect(writer).toHaveBeenCalledOnce();
  });
});
