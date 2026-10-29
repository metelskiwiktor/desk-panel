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
const sure = (category: string, move: 'spend' | 'income' = 'spend', tags: string[] = []) => ({ sure: true, options: [{ move, category, ...(tags.length ? { tags } : {}), reasons: ['ten sam sprzedawca: 3 z 3 razy'] }] });
const choice = { sure: false, options: [{ move: 'spend' as const, category: 'c-1', reasons: ['wcześniej było różnie'] }, { move: 'spend' as const, category: 'c-2', reasons: ['wcześniej było różnie'] }] };
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
  it('groups by the mark suggested, biggest first, with sums, and counts the choices apart', () => {
    const preview = assignPreview(ledger, plan());
    expect(preview.problems).toEqual([]);
    expect(preview.groups.map(g => [g.count, g.category?.name, g.move, g.total])).toEqual([[2, 'Sklep spożywczy', 'spend', -51.36], [1, 'Jedzenie', 'spend', -15], [1, 'Pensja', 'income', 1000]]);
    expect(preview.groups[0]).toMatchObject({ why: 'ten sam sprzedawca: 3 z 3 razy', items: [{ day: '2026-10-02', name: 'Społem' }, { day: '2026-10-01', name: 'Biedronka' }], hidden: 0 });
    expect(preview.choices).toEqual({ count: 1, total: -80.59 });
    // the full lists never reach the card, and a done operation (g) or one with no suggestion (f) is not in any group
    expect(JSON.stringify(preview)).not.toContain('"txs"');
    expect(preview.groups.flatMap(g => g.items).map(i => i.name)).not.toContain('Żabka');
  });

  it('keeps to the range of days and says why there is nothing', () => {
    expect(assignPreview(ledger, plan({ from: '2026-10-03', to: '2026-10-03' })).groups.map(g => g.category?.name)).toEqual(['Jedzenie', 'Pensja']);
    expect(assignPreview(ledger, plan({ from: '2026-10-06', to: '2026-10-06' })).problems[0]).toMatch(/1 ma tylko propozycje do wyboru/);
    expect(assignPreview(ledger, plan({ from: '2025-01-01', to: '2025-01-02' })).problems[0]).toMatch(/Nie ma nieoznaczonych/);
  });

  it('takes the operations of the ticked groups only, and an unknown key narrows nothing', () => {
    const [shop, food] = assignPreview(ledger, plan()).groups;
    expect(assignTxs(ledger, plan()).txs.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(assignTxs(ledger, plan(), [shop.key]).txs.sort()).toEqual(['c', 'd']);
    expect(assignTxs(ledger, plan(), [shop.key, food.key, 'g-00000000']).groups).toBe(1);
  });
});

describe('the answer on the card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bank-assign-'));
  const calls: unknown[] = [];
  const sources = { bankLedger: async () => ledger, bankLabelAction: async (a: unknown) => { calls.push(a); return { ok: true as const, assigned: (a as { txs: string[] }).txs.length }; } } as never;
  const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:1/', gh: async () => '{}' });
  const [shop] = assignPreview(ledger, plan()).groups;

  it('marks the ticked groups in one write, once, and keeps what was unticked', async () => {
    const first = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply', skip: [shop.key] }, plan());
    expect(first).toMatchObject({ decision: 'applied', assigned: 2, skipped: [shop.key] });
    expect(calls).toEqual([{ action: 'acceptMany', txs: ['c', 'd'] }]);
    expect(await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply' }, plan())).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it('refuses when every group is unticked, and a rejection changes nothing', async () => {
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
