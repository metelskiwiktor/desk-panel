// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomations, nextOccurrence, resolveObserverTime } from './automations';
import { ChatError } from './agent-chat';
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
    await automations.createFromPlan('chat-1', plan());
    const aside = readdirSync(dir).find(name => name.startsWith('observers.json.corrupt-'));
    expect(aside).toBeTruthy();
    expect(readFileSync(join(dir, aside!), 'utf8')).toBe('{broken');
  });
});

describe('loading the store', () => {
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
    const run = await automations.report('chat-1', { runId: pendingId(), outcome: 'done', summary: 'Cel osiągnięty.', notebook: 'Nowa wiedza.' });
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
    const run = await automations.report('chat-1', { runId: pendingId(), outcome: 'not-yet', summary: 'Jeszcze nie.', notebook: 'Niedozwolone.' });
    expect(run.notebookChanged).toBe(false);
    expect((await automations.get(created.id))!.notebook).toBe('');
  });

  it('refuses a report outside a run', async () => {
    const automations = make();
    await expect(automations.report('chat-1', { runId: 'run-000000000000', outcome: 'done', summary: 'x' })).rejects.toMatchObject({ status: 409 });
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

describe('run identity and restarts', () => {
  it('binds a report to its own run when two one-shot runs share a conversation', async () => {
    const automations = make();
    const first = await automations.createFromPlan('origin', plan({ name: 'First goal', trigger: { kind: 'once', at: NOW + 60_000 } }));
    const second = await automations.createFromPlan('origin', plan({ name: 'Second goal', trigger: { kind: 'once', at: NOW + 120_000 } }));
    clock = NOW + 60_000;
    await automations.tick();
    clock = NOW + 120_000;
    await automations.tick();
    const ids = stored().pending.map((p: { id: string }) => p.id);
    await automations.report('origin', { runId: ids[1], outcome: 'done', summary: 'Second goal completed' });
    expect((await automations.get(first.id))!.runs).toHaveLength(0);
    expect((await automations.get(second.id))!.runs[0].summary).toBe('Second goal completed');
  });

  it('reserves a cyclic run before starting it, so a restart resumes it exactly once', async () => {
    let release!: (value: { id: string }) => void;
    const gate = new Promise<{ id: string }>(resolve => { release = resolve; });
    const automations = make({ chat: { createAutomation: () => gate } });
    await automations.createFromPlan('origin', plan());
    clock = Date.parse('2026-10-31T07:00:00+01:00');
    const tick = automations.tick();
    expect(stored().pending).toHaveLength(1);
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
    await automations.report('origin', { runId: pendingId(), outcome: 'done', summary: 'Done' });
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
    await automations.report('origin', { runId: pendingId(), outcome: 'done', summary: 'Done' });
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
    await automations.report(run.chatId, { runId: run.id, outcome: 'not-yet', summary: 'Jeszcze nie.' });
    expect((await automations.get(created.id))!.status).toBe('expired');
  });

  it('keeps the scheduled hour across the spring DST gap', () => {
    const after = Date.parse('2026-03-29T04:00:00+02:00');
    expect(nextOccurrence({ kind: 'daily', time: '02:30' }, after)).toBe(Date.parse('2026-03-30T02:30:00+02:00'));
    expect(nextOccurrence({ kind: 'weekly', weekday: 7, time: '02:30' }, after)).toBe(Date.parse('2026-04-05T02:30:00+02:00'));
    expect(nextOccurrence({ kind: 'daily', time: '02:30' }, Date.parse('2026-03-28T12:00:00+01:00'))).toBe(Date.parse('2026-03-29T03:30:00+02:00'));
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
