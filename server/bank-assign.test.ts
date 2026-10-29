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
const entry = (tx: string, day: string, amount: number, name: string, over: { known?: string; label?: unknown; suggestion?: unknown } = {}) =>
  ({ tx, op: op(day, amount, name), known: over.known ?? null, suggestion: over.suggestion ?? null, pending: !over.label, inReading: true, label: over.label ?? null }) as BankLedger['entries'][number];
const phone = (tx: string, day: string, amount: number, over: { label?: unknown } = {}) => ({ ...entry(tx, day, amount, 'Płatność telefonem', over), op: { ...op(day, amount, 'Płatność telefonem'), method: 'phone' as const } }) as BankLedger['entries'][number];
const ledger: BankLedger = {
  observedAt: 1, since: '2026-10-26', balances: [], tags: [],
  parties: [{ id: 'p-orlen', name: 'Orlen' }, { id: 'p-spolem', name: 'Społem' }, { id: 'p-alicja', name: 'Alicja' }, { id: 'p-nowy', name: 'Nowy' }],
  categories: [
    { id: 'c-1', name: 'Paliwo', move: 'spend', color: 'orange', icon: 'fuel' }, { id: 'c-2', name: 'Jedzenie', move: 'spend', color: 'green', icon: 'utensils' },
    { id: 'c-3', name: 'Sklep spożywczy', move: 'spend', color: 'blue', icon: 'cart' }, { id: 'c-4', name: 'Pensja', move: 'income', color: 'teal', icon: 'banknote' },
  ] as BankLedger['categories'],
  entries: [
    // earlier operations the user marked: Orlen is fuel four times and food once, Społem always groceries, Alicja one settlement
    ...[1, 2, 3, 4].map(n => entry(`h-o${n}`, `2026-08-0${n}`, -100, 'Orlen', { label: mark('p-orlen', 'spend', 'c-1') })),
    entry('h-o5', '2026-08-09', -15, 'Orlen', { label: mark('p-orlen', 'spend', 'c-2') }),
    ...[1, 2, 3].map(n => entry(`h-s${n}`, `2026-08-1${n}`, -20, 'Społem', { label: mark('p-spolem', 'spend', 'c-3') })),
    entry('h-a1', '2026-08-20', -300, 'Alicja', { label: mark('p-alicja', 'settle', null) }),
    // not marked yet
    entry('o1', '2026-10-05', -200.15, 'Orlen', { known: 'p-orlen' }), entry('o2', '2026-10-04', -18.4, 'Orlen', { known: 'p-orlen' }),
    entry('s1', '2026-10-03', -28.87, 'Społem', { known: 'p-spolem' }), entry('s2', '2026-10-02', -22.49, 'Społem', { known: 'p-spolem' }),
    entry('a1', '2026-10-01', -200, 'Alicja', { known: 'p-alicja' }), entry('a2', '2026-09-30', -150, 'Alicja', { known: 'p-alicja' }),
    // known, but nothing to offer: no earlier operation of this side was marked
    entry('n1', '2026-10-06', -9, 'Nowy', { known: 'p-nowy' }),
    // a payment the bank gives no name for: linked only by the same amount to earlier ones (80,59 was food twice, 25 never marked)
    ...[1, 2].map(n => phone(`h-t${n}`, `2026-09-0${n}`, -80.59, { label: mark(null, 'spend', 'c-2') })),
    phone('t1', '2026-10-06', -80.59), phone('t2', '2026-10-07', -25),
    phone('h-t3', '2026-09-05', -80.59, { label: mark(null, 'spend', 'c-2') }),
  ],
};
const plan = (over: Record<string, unknown> = {}) => bankAssignSchema.parse(over);
const byName = (name: string) => assignPreview(ledger, plan()).recipients.find(r => r.name === name)!;

describe('recipients and their templates', () => {
  it('groups unmarked operations by recipient, with the marks its earlier operations got, certain ones first', () => {
    const preview = assignPreview(ledger, plan());
    expect(preview.problems).toEqual([]);
    expect(preview.recipients.map(r => [r.name, r.count, r.certain])).toEqual([['Społem', 2, true], ['Płatność telefonem', 1, true], ['Orlen', 2, false], ['Alicja', 2, false]]);
    // the fuel station: most frequent first, each with how many times
    expect(byName('Orlen').templates.map(t => [t.mark.category?.name, t.count])).toEqual([['Paliwo', 4], ['Jedzenie', 1]]);
    expect(byName('Orlen')).toMatchObject({ total: -218.55, items: [{ tx: 'o1', day: '2026-10-05' }, { tx: 'o2' }], hidden: 0 });
    // one earlier mark is a sample, not a habit: Alicja is not certain, and her one settlement is only a template
    expect(byName('Alicja')).toMatchObject({ certain: false, templates: [{ mark: { move: 'settle', category: null }, count: 1 }] });
    // a side with nothing marked before is not listed; a payment with no name is one recipient per amount, with the earlier ones of that amount
    expect(preview.recipients.map(r => r.name)).not.toContain('Nowy');
    expect(preview.recipients.filter(r => r.name === 'Płatność telefonem').map(r => [r.amount, r.templates.map(t => [t.mark.category?.name, t.count])])).toEqual([[-80.59, [['Jedzenie', 3]]]]);
    // 25 zł has no earlier payment of that amount, so it offers nothing and is not listed
    expect(preview.categories.map(c => c.name)).toEqual(['Paliwo', 'Jedzenie', 'Sklep spożywczy', 'Pensja']);
    expect(JSON.stringify(preview)).not.toContain('"party"');
  });

  it('says what was asked and which days the operations really span, and keeps to the range', () => {
    expect(assignPreview(ledger, plan()).range).toEqual({ from: null, to: null, first: '2026-09-30', last: '2026-10-06' });
    const narrow = assignPreview(ledger, plan({ from: '2026-10-04', to: '2026-10-05' }));
    expect(narrow.range).toEqual({ from: '2026-10-04', to: '2026-10-05', first: '2026-10-04', last: '2026-10-05' });
    expect(narrow.recipients.map(r => r.name)).toEqual(['Orlen']);
    expect(assignPreview(ledger, plan({ from: '2025-01-01', to: '2025-01-02' })).problems[0]).toMatch(/Nie ma nieoznaczonych/);
  });
});

describe('what would be marked', () => {
  const t = (name: string, i: number) => byName(name).templates[i].key;
  const orlen = () => byName('Orlen').key;

  const phoneKey = () => assignPreview(ledger, plan()).recipients.find(r => r.name === 'Płatność telefonem')!.key;

  it('marks only the certain recipients by default, each with its own template, and not the others', () => {
    expect(assignMarks(ledger, plan())).toEqual([
      { tx: 's1', move: 'spend', category: 'c-3', tags: [], party: 'p-spolem', recurring: false }, { tx: 's2', move: 'spend', category: 'c-3', tags: [], party: 'p-spolem', recurring: false },
      { tx: 't1', move: 'spend', category: 'c-2', tags: [], party: null, recurring: false },
    ]);
  });

  it('takes a template for a whole recipient, and for one operation a template or any category', () => {
    const marks = assignMarks(ledger, plan(), { groupPicks: [{ group: orlen(), template: t('Orlen', 0) }], picks: [{ tx: 'o2', template: t('Orlen', 1) }, { tx: 's1', category: 'c-2' }] });
    expect(Object.fromEntries(marks.map(m => [m.tx, m.category]))).toEqual({ s1: 'c-2', s2: 'c-3', t1: 'c-2', o1: 'c-1', o2: 'c-2' });
    // a category of another move sets that move (a source of income is an income), and the recipient stays
    expect(assignMarks(ledger, plan(), { picks: [{ tx: 'a1', category: 'c-4' }] })).toContainEqual({ tx: 'a1', move: 'income', category: 'c-4', tags: [], party: 'p-alicja', recurring: false });
  });

  it('leaves out the recipients and operations the user unticked, and drops what is no longer there', () => {
    expect(assignMarks(ledger, plan(), { skip: [byName('Społem').key, phoneKey()] })).toEqual([]);
    expect(assignMarks(ledger, plan(), { skipOps: ['s1'] }).map(m => m.tx)).toEqual(['s2', 't1']);
    // a template that is not this recipient's, a deleted category and an unknown key are dropped, never guessed
    expect(assignMarks(ledger, plan(), { picks: [{ tx: 'o1', template: t('Społem', 0) }, { tx: 'o2', category: 'c-99' }, { tx: 'nope', category: 'c-1' }] }).map(m => m.tx)).toEqual(['s1', 's2', 't1']);
    expect(assignMarks(ledger, plan(), { groupPicks: [{ group: 'r-00000000', template: t('Orlen', 0) }] }).map(m => m.tx)).toEqual(['s1', 's2', 't1']);
  });
});

describe('the answer on the card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bank-assign-'));
  const calls: { action: string; items: { tx: string; category: string | null }[] }[] = [];
  const sources = { bankLedger: async () => ledger, bankLabelAction: async (a: never) => { calls.push(a); return { ok: true as const, assigned: (a as { items: unknown[] }).items.length }; } } as never;
  const phoneKeyOf = () => assignPreview(ledger, plan()).recipients.find(r => r.name === 'Płatność telefonem')!.key;
  const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:1/', gh: async () => '{}' });

  it('marks what is ticked and chosen in one write, once, and keeps the choice', async () => {
    const choice = { groupPicks: [{ group: byName('Orlen').key, template: byName('Orlen').templates[0].key }], skipOps: ['o2'], picks: [{ tx: 'a1', category: 'c-2' }] };
    const first = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply', ...choice }, plan());
    expect(first).toMatchObject({ decision: 'applied', assigned: 5, choice });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'markMany' });
    expect(calls[0].items.map(i => [i.tx, i.category])).toEqual([['s1', 'c-3'], ['s2', 'c-3'], ['t1', 'c-2'], ['o1', 'c-1'], ['a1', 'c-2']]);
    expect(await cockpit.bankAssign('chat', { toolCallId: 'm1:b-1', decision: 'apply' }, plan())).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it('refuses when nothing is ticked, and a rejection changes nothing but keeps what was proposed', async () => {
    await expect(cockpit.bankAssign('chat', { toolCallId: 'm1:b-2', decision: 'apply', skip: [byName('Społem').key, phoneKeyOf()] }, plan())).rejects.toMatchObject({ status: 409 });
    const rejected = await cockpit.bankAssign('chat', { toolCallId: 'm1:b-3', decision: 'reject' }, plan());
    expect(rejected).toMatchObject({ decision: 'rejected', preview: { recipients: [{}, {}, {}, {}] } });
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
