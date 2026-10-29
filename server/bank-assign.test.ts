// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankAssignSchema } from '../src/bank-assign-contract';
import { assignPreview, assignTxs } from './bank-assign';
import { stableBankCardId } from './hermes-chat';
import { createCockpit } from './cockpit';
import type { BankLedger } from './bank-labels';

const op = (day: string, amount: number, name: string) => ({ at: Date.parse(`${day}T12:00:00Z`), amount, currency: 'PLN', name, method: 'card' as const, merchant: null, keys: [] });
const sure = (category: string, move: 'spend' | 'income' = 'spend', tags: string[] = []) => ({ sure: true, options: [{ move, category, ...(tags.length ? { tags } : {}), reasons: ['ten sam sprzedawca', 'Sklep: 3 z 3 razy'] }] });
const choice = { sure: false, options: [{ move: 'spend' as const, category: 'c-1', reasons: ['x', 'Sklep: 1 z 2 razy'] }, { move: 'spend' as const, category: 'c-2', reasons: ['x', 'Jedzenie: 1 z 2 razy'] }] };
const entry = (tx: string, day: string, amount: number, name: string, suggestion: unknown, label: unknown = null) => ({ tx, op: op(day, amount, name), known: null, suggestion, pending: true, inReading: true, label }) as BankLedger['entries'][number];
const ledger: BankLedger = {
  observedAt: 1, since: '2026-10-26', parties: [], balances: [], tags: [],
  categories: [
    { id: 'c-1', name: 'Sklep spożywczy', move: 'spend', color: 'green', icon: 'cart' }, { id: 'c-2', name: 'Jedzenie', move: 'spend', color: 'orange', icon: 'utensils' },
    { id: 'c-3', name: 'Pensja', move: 'income', color: 'teal', icon: 'banknote' },
  ] as BankLedger['categories'],
  entries: [
    entry('a', '2026-10-01', -28.87, 'Biedronka', sure('c-1')), entry('b', '2026-10-02', -22.49, 'Społem', sure('c-1')), entry('c', '2026-10-03', -15, 'KFC', sure('c-2')),
    entry('d', '2026-10-03', 1000, 'Firma', sure('c-3', 'income')), entry('e', '2026-10-06', -80.59, 'Płatność telefonem', choice),
    entry('f', '2026-10-07', -9, 'Żabka', null), entry('g', '2026-10-08', -12, 'Biedronka', sure('c-1'), { move: 'spend', category: 'c-1', tags: [], party: null, recurring: false, comment: '' }),
  ],
};
const plan = (over: Record<string, unknown> = {}) => bankAssignSchema.parse(over);

describe('groups of sure suggestions', () => {
  it('groups by the mark suggested, biggest first, with sums, and lists the choices apart with their options', () => {
    const preview = assignPreview(ledger, plan());
    expect(preview.problems).toEqual([]);
    expect(preview.groups.map(g => [g.count, g.category?.name, g.move, g.total])).toEqual([[2, 'Sklep spożywczy', 'spend', -51.36], [1, 'Jedzenie', 'spend', -15], [1, 'Pensja', 'income', 1000]]);
    expect(preview.groups[0]).toMatchObject({ why: 'ten sam sprzedawca', items: [{ tx: 'b', day: '2026-10-02', name: 'Społem' }, { tx: 'a', day: '2026-10-01', name: 'Biedronka' }], hidden: 0 });
    expect(preview.choices).toMatchObject({ count: 1, total: -80.59, items: [{ tx: 'e', why: 'Sklep: 1 z 2 razy', options: [{ category: { name: 'Sklep spożywczy' } }, { category: { name: 'Jedzenie' } }] }] });
    // the full lists of a group never reach the card; a done operation (g) or one with no suggestion (f) is in no group
    expect(JSON.stringify(preview)).not.toContain('"txs"');
    expect(preview.groups.flatMap(g => g.items).map(i => i.name)).not.toContain('Żabka');
  });

  it('says what was asked and which days the operations really span', () => {
    expect(assignPreview(ledger, plan()).range).toEqual({ from: null, to: null, first: '2026-10-01', last: '2026-10-06' });
    expect(assignPreview(ledger, plan({ from: '2026-10-02', to: '2026-10-03' })).range).toEqual({ from: '2026-10-02', to: '2026-10-03', first: '2026-10-02', last: '2026-10-03' });
  });

  it('keeps to the range of days and says why there is nothing', () => {
    expect(assignPreview(ledger, plan({ from: '2026-10-03', to: '2026-10-03' })).groups.map(g => g.category?.name)).toEqual(['Jedzenie', 'Pensja']);
    expect(assignPreview(ledger, plan({ from: '2026-10-06', to: '2026-10-06' }))).toMatchObject({ groups: [], problems: [], choices: { count: 1 } });
    expect(assignPreview(ledger, plan({ from: '2025-01-01', to: '2025-01-02' })).problems[0]).toMatch(/Nie ma nieoznaczonych/);
  });

  it('takes the ticked operations, the picked options only where there is a choice, and an unknown key narrows nothing', () => {
    const [shop, food] = assignPreview(ledger, plan()).groups;
    expect(assignTxs(ledger, plan()).txs.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(assignTxs(ledger, plan(), { skip: [shop.key] }).txs.sort()).toEqual(['c', 'd']);
    expect(assignTxs(ledger, plan(), { skip: [shop.key, food.key, 'g-00000000'] }).groups).toBe(1);
    expect(assignTxs(ledger, plan(), { skipOps: ['a', 'zzz'] }).txs.sort()).toEqual(['b', 'c', 'd']);
    // a pick for a sure operation, for a missing option, or for an unknown operation is dropped; a real one stays
    expect(assignTxs(ledger, plan(), { picks: [{ tx: 'a', option: 0 }, { tx: 'e', option: 2 }, { tx: 'nope', option: 0 }, { tx: 'e', option: 1 }] }).picks).toEqual([{ tx: 'e', option: 1 }]);
  });
});

describe('the answer on the card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bank-assign-'));
  const calls: unknown[] = [];
  const sources = { bankLedger: async () => ledger, bankLabelAction: async (a: unknown) => { calls.push(a); const x = a as { txs: string[]; picks: unknown[] }; return { ok: true as const, assigned: x.txs.length + x.picks.length }; } } as never;
  const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:1/', gh: async () => '{}' });
  const [shop] = assignPreview(ledger, plan()).groups;

  it('marks what is ticked and picked in one write, once, and keeps what was unticked', async () => {
    const first = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply', skip: [shop.key], skipOps: ['d'], picks: [{ tx: 'e', option: 1 }] }, plan());
    expect(first).toMatchObject({ decision: 'applied', assigned: 2, skipped: [shop.key], skippedOps: ['d'], picked: [{ tx: 'e', option: 1 }] });
    expect(calls).toEqual([{ action: 'acceptMany', txs: ['c'], picks: [{ tx: 'e', option: 1 }] }]);
    expect(await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply' }, plan())).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it('refuses when everything is unticked, and a rejection changes nothing', async () => {
    const all = assignPreview(ledger, plan()).groups.map(g => g.key);
    await expect(cockpit.bankAssign('chat', { toolCallId: 'm1:b-2', decision: 'apply', skip: all }, plan())).rejects.toMatchObject({ status: 409 });
    const rejected = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-3', decision: 'reject' }, plan());
    expect(rejected).toMatchObject({ decision: 'rejected', preview: { groups: [{}, {}, {}] } });
    expect(calls).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives the card an id from its range, the same every time', () => {
    const id = (input: unknown) => stableBankCardId('m1', JSON.stringify(input), 'mcp__desk_panel__panel_bank_assign');
    expect(id({ tytul: 'a' })).toBe(id({ tytul: 'b' }));
    expect(id({ from: '2026-09-24' })).not.toBe(id({}));
    expect(id({ from: 'wczoraj' })).toBeNull();
  });
});
