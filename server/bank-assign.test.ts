// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankAssignSchema } from '../src/bank-assign-contract';
import { assignMarks, assignPreview } from './bank-assign';
import { stableBankCardId } from './hermes-chat';
import { createCockpit } from './cockpit';
import type { BankLedger } from './bank-labels';

const op = (day: string, amount: number, name: string) => ({ at: Date.parse(`${day}T12:00:00Z`), amount, currency: 'PLN', name, method: 'card' as const, merchant: null, keys: [] });
const mark = (party: string | null, move: 'spend' | 'income' | 'settle', category: string | null, tags: string[] = []) => ({ move, category, tags, party, recurring: false, comment: '' });
const entry = (tx: string, day: string, amount: number, name: string, over: { known?: string; label?: unknown } = {}) =>
  ({ tx, op: op(day, amount, name), known: over.known ?? null, suggestion: null, pending: !over.label, inReading: true, label: over.label ?? null }) as BankLedger['entries'][number];
/** A phone payment: the bank gives no shop for it. */
const phone = (tx: string, day: string, amount: number, label?: unknown) => ({ ...entry(tx, day, amount, 'Płatność telefonem', { label }), op: { ...op(day, amount, 'Płatność telefonem'), method: 'phone' as const } }) as BankLedger['entries'][number];
const ledger: BankLedger = {
  observedAt: 1, since: '2026-10-26', balances: [], tags: [],
  parties: [{ id: 'p-orlen', name: 'Orlen' }, { id: 'p-spolem', name: 'Społem' }, { id: 'p-alicja', name: 'Alicja' }, { id: 'p-nowy', name: 'Nowy' }, { id: 'p-pyszne', name: 'pyszne.pl' }],
  categories: [
    { id: 'c-1', name: 'Paliwo', move: 'spend', color: 'orange', icon: 'fuel' }, { id: 'c-2', name: 'Jedzenie', move: 'spend', color: 'green', icon: 'utensils' },
    { id: 'c-3', name: 'Sklep spożywczy', move: 'spend', color: 'blue', icon: 'cart' }, { id: 'c-4', name: 'Pensja', move: 'income', color: 'teal', icon: 'banknote' },
    { id: 'c-5', name: 'Donejt', move: 'spend', color: 'pink', icon: 'gift' },
  ] as BankLedger['categories'],
  entries: [
    // earlier operations the user marked: Orlen is fuel four times and food once, Społem always groceries, Alicja one settlement
    ...[1, 2, 3, 4].map(n => entry(`h-o${n}`, `2026-08-0${n}`, -100, 'Orlen', { label: mark('p-orlen', 'spend', 'c-1') })),
    entry('h-o5', '2026-08-09', -15, 'Orlen', { label: mark('p-orlen', 'spend', 'c-2') }),
    ...[1, 2, 3].map(n => entry(`h-s${n}`, `2026-08-1${n}`, -20, 'Społem', { label: mark('p-spolem', 'spend', 'c-3') })),
    entry('h-a1', '2026-08-20', -300, 'Alicja', { label: mark('p-alicja', 'settle', null) }),
    // earlier phone payments: 80,59 was food three times (once with a note of the shop), 12 was a tip once
    phone('h-t1', '2026-09-01', -80.59, mark(null, 'spend', 'c-2')), phone('h-t2', '2026-09-02', -80.59, mark(null, 'spend', 'c-2')), phone('h-t3', '2026-09-05', -80.59, mark(null, 'spend', 'c-2')),
    phone('h-t4', '2026-09-06', -84.1, mark('p-pyszne', 'spend', 'c-2')), phone('h-t5', '2026-09-07', -12, mark(null, 'spend', 'c-5', ['tipply'])),
    // not marked yet
    entry('o1', '2026-10-05', -200.15, 'Orlen', { known: 'p-orlen' }), entry('o2', '2026-10-04', -18.4, 'Orlen', { known: 'p-orlen' }),
    entry('s1', '2026-10-03', -28.87, 'Społem', { known: 'p-spolem' }), entry('s2', '2026-10-02', -22.49, 'Społem', { known: 'p-spolem' }),
    entry('a1', '2026-10-01', -200, 'Alicja', { known: 'p-alicja' }), entry('a2', '2026-09-30', -150, 'Alicja', { known: 'p-alicja' }),
    // known, but nothing to offer: no earlier operation of this side was marked
    entry('n1', '2026-10-06', -9, 'Nowy', { known: 'p-nowy' }),
    phone('t1', '2026-10-06', -80.59), phone('t2', '2026-10-07', -80.59), phone('t3', '2026-10-08', -25),
  ],
};
const plan = (over: Record<string, unknown> = {}) => bankAssignSchema.parse(over);
const preview = () => assignPreview(ledger, plan());
const byName = (name: string) => preview().recipients.find(r => r.name === name)!;

describe('recipients and their templates', () => {
  it('groups unmarked operations by recipient, with the marks its earlier operations got, certain ones first', () => {
    const p = preview();
    expect(p.problems).toEqual([]);
    expect(p.recipients.map(r => [r.name, r.count, r.certain])).toEqual([['Społem', 2, true], ['Orlen', 2, false], ['Alicja', 2, false]]);
    // the fuel station: most frequent first, each with how many times
    expect(byName('Orlen').templates.map(t => [t.mark.category?.name, t.count])).toEqual([['Paliwo', 4], ['Jedzenie', 1]]);
    expect(byName('Orlen')).toMatchObject({ total: -218.55, items: [{ tx: 'o1', day: '2026-10-05' }, { tx: 'o2' }], hidden: 0 });
    // one earlier mark is a sample, not a habit: Alicja is not certain, and her one settlement is only a template
    expect(byName('Alicja')).toMatchObject({ certain: false, templates: [{ mark: { move: 'settle', category: null }, count: 1 }] });
    // a side with nothing marked before is not listed, and a payment with no name is not a recipient at all
    expect(p.recipients.map(r => r.name)).not.toContain('Nowy');
    expect(p.recipients.map(r => r.name)).not.toContain('Płatność telefonem');
    expect(p.categories.map(c => c.name)).toEqual(['Paliwo', 'Jedzenie', 'Sklep spożywczy', 'Pensja', 'Donejt']);
    expect(JSON.stringify(p)).not.toContain('"p-orlen"');
  });

  it('puts payments with no name from the bank in a pool with every template their earlier marks give, and a hint only for the very same amount', () => {
    const pool = preview().pool!;
    // only payments with a lead are listed; the 25 zł one has none and is only counted
    expect(pool).toMatchObject({ count: 2, total: -161.18, rest: 1, hidden: 0 });
    // all such payments together, whatever the shop: food with no note three times, then the newer of two used once (a tip, food with a note)
    expect(pool.templates.map(t => [t.mark.category?.name, t.mark.tags, t.party, t.count])).toEqual([['Jedzenie', [], null, 3], ['Donejt', ['tipply'], null, 1], ['Jedzenie', [], 'pyszne.pl', 1]]);
    // 80,59 was marked the same way three times: that is the lead (never a tick)
    expect(pool.items.map(i => [i.tx, i.hint])).toEqual([['t2', { template: pool.templates[0].key, count: 3 }], ['t1', { template: pool.templates[0].key, count: 3 }]]);
    // one earlier payment of an amount is no lead (12 was a tip once): left out like the 25 zł one
    const more = assignPreview({ ...ledger, entries: [...ledger.entries, phone('t4', '2026-10-09', -12)] }, plan()).pool!;
    expect(more).toMatchObject({ count: 2, rest: 2 });
    expect(more.items.map(i => i.tx)).not.toContain('t4');
    expect(assignPreview(ledger, plan({ from: '2025-01-01', to: '2025-01-02' })).pool).toBeNull();
  });

  it('says what was asked and which days the operations really span, and keeps to the range', () => {
    expect(preview().range).toEqual({ from: null, to: null, first: '2026-09-30', last: '2026-10-07' });
    const narrow = assignPreview(ledger, plan({ from: '2026-10-04', to: '2026-10-05' }));
    expect(narrow.range).toEqual({ from: '2026-10-04', to: '2026-10-05', first: '2026-10-04', last: '2026-10-05' });
    expect(narrow.recipients.map(r => r.name)).toEqual(['Orlen']);
    expect(assignPreview(ledger, plan({ from: '2025-01-01', to: '2025-01-02' })).problems[0]).toMatch(/Nie ma nieoznaczonych/);
  });
});

describe('what would be marked', () => {
  const t = (name: string, i: number) => byName(name).templates[i].key;
  const orlen = () => byName('Orlen').key;

  it('marks only the certain recipients by default, each with its own template, and nothing of the pool', () => {
    expect(assignMarks(ledger, plan())).toEqual([
      { tx: 's1', move: 'spend', category: 'c-3', tags: [], party: 'p-spolem', recurring: false }, { tx: 's2', move: 'spend', category: 'c-3', tags: [], party: 'p-spolem', recurring: false },
    ]);
  });

  it('takes a template for a whole recipient, and for one operation a template or any category', () => {
    const marks = assignMarks(ledger, plan(), { groupPicks: [{ group: orlen(), template: t('Orlen', 0) }], picks: [{ tx: 'o2', template: t('Orlen', 1) }, { tx: 's1', category: 'c-2' }] });
    expect(Object.fromEntries(marks.map(m => [m.tx, m.category]))).toEqual({ s1: 'c-2', s2: 'c-3', o1: 'c-1', o2: 'c-2' });
    // a category of another move sets that move (a source of income is an income), and the recipient stays
    expect(assignMarks(ledger, plan(), { picks: [{ tx: 'a1', category: 'c-4' }] })).toContainEqual({ tx: 'a1', move: 'income', category: 'c-4', tags: [], party: 'p-alicja', recurring: false });
  });

  it('marks a payment of the pool only by its own pick: a template with the note it carried, or a category with none', () => {
    const pool = preview().pool!;
    const tipTemplate = pool.templates[1].key, noted = pool.templates[2].key;
    const marks = assignMarks(ledger, plan(), { picks: [{ tx: 't1', template: noted }, { tx: 't2', template: tipTemplate }, { tx: 't3', template: tipTemplate }] });
    expect(marks).toContainEqual({ tx: 't1', move: 'spend', category: 'c-2', tags: [], party: 'p-pyszne', recurring: false });
    expect(marks).toContainEqual({ tx: 't2', move: 'spend', category: 'c-5', tags: ['tipply'], party: null, recurring: false });
    // a payment with no lead is not on the card, so a pick for it is dropped
    expect(marks.map(m => m.tx)).not.toContain('t3');
    expect(assignMarks(ledger, plan(), { picks: [{ tx: 't1', category: 'c-1' }] })).toContainEqual({ tx: 't1', move: 'spend', category: 'c-1', tags: [], party: null, recurring: false });
    // a group pick does nothing to the pool, and an operation unticked is left out
    expect(assignMarks(ledger, plan(), { groupPicks: [{ group: orlen(), template: t('Orlen', 0) }] }).map(m => m.tx)).not.toContain('t1');
    expect(assignMarks(ledger, plan(), { picks: [{ tx: 't1', template: noted }], skipOps: ['t1'] }).map(m => m.tx)).not.toContain('t1');
  });

  it('leaves out the recipients and operations the user unticked, and drops what is no longer there', () => {
    expect(assignMarks(ledger, plan(), { skip: [byName('Społem').key] })).toEqual([]);
    expect(assignMarks(ledger, plan(), { skipOps: ['s1'] }).map(m => m.tx)).toEqual(['s2']);
    // a template that is not this recipient's, a deleted category and an unknown key are dropped, never guessed
    expect(assignMarks(ledger, plan(), { picks: [{ tx: 'o1', template: t('Społem', 0) }, { tx: 'o2', category: 'c-99' }, { tx: 't1', template: 't-00000000' }, { tx: 'nope', category: 'c-1' }] }).map(m => m.tx)).toEqual(['s1', 's2']);
    expect(assignMarks(ledger, plan(), { groupPicks: [{ group: 'r-00000000', template: t('Orlen', 0) }] }).map(m => m.tx)).toEqual(['s1', 's2']);
  });
});

describe('the answer on the card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bank-assign-'));
  const calls: { action: string; items: { tx: string; category: string | null }[] }[] = [];
  const sources = { bankLedger: async () => ledger, bankLabelAction: async (a: never) => { calls.push(a); return { ok: true as const, assigned: (a as { items: unknown[] }).items.length }; } } as never;
  const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:1/', gh: async () => '{}' });

  it('marks what is ticked and chosen in one write, once, and keeps the choice', async () => {
    const choice = { groupPicks: [{ group: byName('Orlen').key, template: byName('Orlen').templates[0].key }], skipOps: ['o2'], picks: [{ tx: 'a1', category: 'c-2' }, { tx: 't1', template: preview().pool!.templates[0].key }] };
    const first = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply', ...choice }, plan());
    expect(first).toMatchObject({ decision: 'applied', assigned: 5, choice });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'markMany' });
    expect(calls[0].items.map(i => [i.tx, i.category])).toEqual([['s1', 'c-3'], ['s2', 'c-3'], ['o1', 'c-1'], ['a1', 'c-2'], ['t1', 'c-2']]);
    expect(await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply' }, plan())).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it('refuses when nothing is ticked, and a rejection changes nothing but keeps what was proposed', async () => {
    await expect(cockpit.bankAssign('chat', { toolCallId: 'm1:b-2', decision: 'apply', skip: [byName('Społem').key] }, plan())).rejects.toMatchObject({ status: 409 });
    const rejected = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-3', decision: 'reject' }, plan());
    expect(rejected).toMatchObject({ decision: 'rejected', preview: { recipients: [{}, {}, {}], pool: { count: 2, rest: 1 } } });
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
