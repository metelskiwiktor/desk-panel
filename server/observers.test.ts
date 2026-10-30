// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatError } from './agent-chat';
import { createObservers, ObserverError, resolveObserverTime } from './observers';
import { MAX_ACTIVE_OBSERVERS, OBSERVER_TTL_MS } from '../src/observers-contract';
import type { CockpitPrView } from '../src/cockpit-contract';

const NOW = Date.parse('2026-10-30T12:00:00+01:00');
const TASK = 'desk-panel/f2c9501e-7121-4746-8fc8-19ee3ee9d968';
const PR = 'https://github.com/metelskiwiktor/desk-panel/pull/41';
const pr = (state: CockpitPrView['state'], checks: CockpitPrView['checks']): CockpitPrView => ({ number: 41, title: 'Paski', branch: 'cez/x', url: PR, state, checks });

let clock = NOW;
let dir: string;
let sent: { id: string; text: string; automation: { source: string; reason: string } }[];
let chat: { sendAutomation: (id: string, input: { text: string; automation: { source: string; reason: string } }) => Promise<void> };
let tasks: Record<string, Record<string, any>>;
let prs: Map<string, CockpitPrView>;

beforeEach(() => {
  clock = NOW;
  dir = mkdtempSync(join(tmpdir(), 'desk-observers-'));
  sent = [];
  tasks = {};
  prs = new Map([[PR, pr('OPEN', [{ name: 'test', state: 'running' }])]]);
  chat = { sendAutomation: vi.fn(async (id, input) => { sent.push({ id, ...input }); }) };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (over: Partial<Parameters<typeof createObservers>[0]> = {}) => createObservers({
  file: join(dir, 'observers.json'), chat, now: () => clock, log: () => {},
  readTask: async id => tasks[id] ?? null,
  readPr: async url => { const value = prs.get(url); if (!value) throw new Error('unknown PR'); return value; },
  ...over,
});

describe('time observers', () => {
  it('reads an ISO moment and the Polish phrases in Europe/Warsaw', () => {
    expect(resolveObserverTime('2026-10-30T15:00:00+01:00', NOW)).toBe(Date.parse('2026-10-30T15:00:00+01:00'));
    expect(resolveObserverTime('za 10 minut', NOW)).toBe(NOW + 10 * 60_000);
    expect(resolveObserverTime('za 2 godziny', NOW)).toBe(NOW + 2 * 3_600_000);
    expect(resolveObserverTime('za 3 dni', NOW)).toBe(NOW + 3 * 86_400_000);
    expect(resolveObserverTime('jutro o 9', NOW)).toBe(Date.parse('2026-10-31T09:00:00+01:00'));
    expect(resolveObserverTime('dzisiaj o 15:30', NOW)).toBe(Date.parse('2026-10-30T15:30:00+01:00'));
    expect(resolveObserverTime('w południe', NOW)).toBeNull();
  });

  it('fires once at the moment and never before it', async () => {
    const observers = make();
    const created = await observers.create({ chatId: 'chat-1', kind: 'time', target: 'za 10 minut', instruction: 'Przypomnij o spotkaniu.' });
    expect(created.target).toBe('2026-10-30T12:10 +01:00');
    expect(created.expiresAt).toBe(NOW + 10 * 60_000 + 3_600_000);

    clock = NOW + 9 * 60_000;
    await observers.tick();
    expect(sent).toHaveLength(0);

    clock = NOW + 10 * 60_000;
    await observers.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 'chat-1', automation: { source: 'observer' } });
    expect(sent[0].text).toContain('Przypomnij o spotkaniu.');
    expect(sent[0].automation.reason).toContain('obserwator czasu');
    expect(await observers.list()).toEqual([]);

    await observers.tick();
    expect(sent).toHaveLength(1);
  });

  it('refuses a moment that already passed and a phrase it cannot read', async () => {
    const observers = make();
    await expect(observers.create({ chatId: 'chat-1', kind: 'time', target: '2026-10-30T11:00:00+01:00', instruction: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(observers.create({ chatId: 'chat-1', kind: 'time', target: 'kiedyś', instruction: 'x' })).rejects.toBeInstanceOf(ObserverError);
  });
});

describe('Cezar observers', () => {
  it('stores the state at creation and fires once when the task starts waiting for the user', async () => {
    tasks[TASK] = { id: 'x', status: 'running' };
    const observers = make();
    await observers.create({ chatId: 'chat-1', kind: 'cezar', target: TASK, instruction: 'Zapytaj, czy pomóc w decyzji.' });
    await observers.active([{ id: TASK, status: 'running' } as never]);
    expect(sent).toHaveLength(0);
    const waiting = [{ id: TASK, title: 'Paski', status: 'needs-input' }];
    await observers.active(waiting as never);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Zapytaj, czy pomóc w decyzji.');
    expect(sent[0].automation.reason).toContain('obserwator taska Cezara');
    await observers.active(waiting as never);
    expect(sent).toHaveLength(1);
  });

  it('fires once when the task finishes, and not for a task already done at creation', async () => {
    tasks[TASK] = { id: 'x', status: 'running' };
    const observers = make();
    await observers.create({ chatId: 'chat-1', kind: 'cezar', target: TASK, instruction: 'Podsumuj wynik.' });
    const done = [{ id: TASK, title: 'Paski', status: 'done', pullRequestUrl: PR }];
    await observers.finished(done as never);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(PR);

    const other = 'desk-panel/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    tasks[other] = { id: 'y', status: 'done' };
    await observers.create({ chatId: 'chat-2', kind: 'cezar', target: other, instruction: 'x' });
    await observers.finished([{ id: other, title: 'Stary', status: 'done' }] as never);
    expect(sent).toHaveLength(1);
  });
});

describe('PR observers', () => {
  it('fires once on a change of state or CI and nothing on the same signature', async () => {
    const observers = make();
    await observers.create({ chatId: 'chat-1', kind: 'pr', target: PR, instruction: 'Powiedz, czy można scalić.' });
    await observers.tick();
    expect(sent).toHaveLength(0);

    prs.set(PR, pr('OPEN', [{ name: 'test', state: 'pass' }]));
    await observers.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Powiedz, czy można scalić.');
    expect(sent[0].text).toContain('CI: test: pass');
    expect(await observers.list()).toEqual([]);

    prs.set(PR, pr('MERGED', []));
    await observers.tick();
    expect(sent).toHaveLength(1);
  });

  it('takes the first successful read as the baseline when GitHub was unreadable at creation', async () => {
    let fail = true;
    const observers = make({ readPr: async () => { if (fail) throw new Error('gh missing'); return pr('OPEN', [{ name: 'test', state: 'running' }]); } });
    await observers.create({ chatId: 'chat-1', kind: 'pr', target: PR, instruction: 'x' });
    fail = false;
    await observers.tick();
    expect(sent).toHaveLength(0);
  });
});

describe('limit, expiry, restart and the switch', () => {
  it('refuses an observer above the active limit and stores nothing', async () => {
    tasks[TASK] = { status: 'running' };
    const observers = make();
    for (let i = 0; i < MAX_ACTIVE_OBSERVERS; i++) await observers.create({ chatId: 'chat-1', kind: 'time', target: 'za 30 minut', instruction: `o${i}` });
    await expect(observers.create({ chatId: 'chat-1', kind: 'time', target: 'za 30 minut', instruction: 'za dużo' })).rejects.toThrow(/Limit aktywnych obserwatorów/);
    expect(JSON.parse(readFileSync(join(dir, 'observers.json'), 'utf8')).observers).toHaveLength(MAX_ACTIVE_OBSERVERS);
  });

  it('drops an expired observer without a turn and out of the list', async () => {
    tasks[TASK] = { status: 'running' };
    const observers = make();
    await observers.create({ chatId: 'chat-1', kind: 'cezar', target: TASK, instruction: 'x' });
    clock = NOW + OBSERVER_TTL_MS + 1;
    expect(await observers.list()).toEqual([]);
    await observers.finished([{ id: TASK, title: 'x', status: 'done' }] as never);
    expect(sent).toHaveLength(0);
  });

  it('a cancelled observer never fires', async () => {
    const observers = make();
    const created = await observers.create({ chatId: 'chat-1', kind: 'time', target: 'za 5 minut', instruction: 'x' });
    expect(await observers.cancel(created.id)).toEqual([]);
    clock = NOW + 6 * 60_000;
    await observers.tick();
    expect(sent).toHaveLength(0);
  });

  it('does not send the same observer twice after a restart', async () => {
    const created = await make().create({ chatId: 'chat-1', kind: 'time', target: 'za 1 minutę', instruction: 'x' });
    clock = NOW + 2 * 60_000;
    await make().tick();
    expect(sent).toHaveLength(1);
    const restarted = make();
    restarted.start();
    await restarted.tick();
    restarted.stop();
    expect(sent).toHaveLength(1);
    expect(existsSync(join(dir, 'observers.json'))).toBe(true);
    expect(created.id).toMatch(/^o-/);
  });

  it('with DESK_AUTOMATIONS=0 creates nothing and fires nothing, yet the list still answers', async () => {
    const created = await make().create({ chatId: 'chat-1', kind: 'time', target: 'za 5 minut', instruction: 'x' });
    const off = make({ enabled: false });
    expect(await off.list()).toEqual([expect.objectContaining({ id: created.id })]);
    await expect(off.create({ chatId: 'chat-1', kind: 'time', target: 'za 5 minut', instruction: 'x' })).rejects.toThrow(/DESK_AUTOMATIONS/);
    clock = NOW + 6 * 60_000;
    await off.tick();
    expect(sent).toHaveLength(0);
  });
});

describe('delivery', () => {
  it('waits for a busy conversation and sends its single turn at the next flush', async () => {
    let busy = true;
    const sendAutomation = vi.fn(async (id: string, input: { text: string; automation: { source: string; reason: string } }) => {
      if (busy) throw new ChatError(409);
      sent.push({ id, ...input });
    });
    const observers = make({ chat: { sendAutomation } });
    const created = await observers.create({ chatId: 'chat-1', kind: 'time', target: 'za 1 minutę', instruction: 'x' });
    clock = NOW + 2 * 60_000;
    await observers.tick();
    expect(sent).toHaveLength(0);
    busy = false;
    await observers.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('x');
    expect(sendAutomation).toHaveBeenCalledTimes(2);
    expect(created.id).toMatch(/^o-/);
  });

  it('heads the turn as an automation of its kind and carries the instruction verbatim', async () => {
    const observers = make();
    const instruction = 'Powiedz krótko, czy CI przeszło — bez listy.';
    await observers.create({ chatId: 'chat-1', kind: 'pr', target: PR, instruction });
    prs.set(PR, pr('MERGED', []));
    await observers.tick();
    expect(sent[0].automation.source).toBe('observer');
    expect(sent[0].text.startsWith(instruction)).toBe(true);
  });
});

describe('the minute clock', () => {
  it('exists only while a time or PR observer is active and is cleared when none is left', async () => {
    const start = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    tasks[TASK] = { status: 'running' };
    const observers = make();
    observers.start();
    expect(start).not.toHaveBeenCalled();
    await observers.create({ chatId: 'chat-1', kind: 'cezar', target: TASK, instruction: 'x' });
    expect(start).not.toHaveBeenCalled();
    const timed = await observers.create({ chatId: 'chat-1', kind: 'time', target: 'za 5 minut', instruction: 'x' });
    expect(start).toHaveBeenCalledTimes(1);
    await observers.cancel(timed.id);
    expect(clear).toHaveBeenCalled();
    observers.stop();
    start.mockRestore();
    clear.mockRestore();
  });
});
