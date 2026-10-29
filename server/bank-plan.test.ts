// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_SHOWN } from '../src/cockpit-contract';
import { bankPlanSchema } from '../src/bank-plan-contract';
import { planPreview } from './bank-plan';
import { stableBankCardId } from './hermes-chat';
import { createCockpit } from './cockpit';
import type { BankLedger } from './bank-labels';

const op = (day: string, amount: number, name: string) => ({ at: Date.parse(`${day}T12:00:00Z`), amount, currency: 'PLN', name, method: 'card' as const, merchant: null, keys: [] });
const entry = (tx: string, day: string, amount: number, name: string, category: string | null, tags: string[] = []) => ({
  tx, op: op(day, amount, name), known: null, suggestion: null, pending: false, inReading: true,
  label: category ? { move: 'spend' as const, category, tags, party: null, recurring: false, comment: '' } : null,
});
const ledger: BankLedger = {
  observedAt: 1, since: '2026-01-01', parties: [], balances: [], tags: ['terapia', 'apteka'],
  categories: [
    { id: 'c-1', name: 'Psycholog', move: 'spend', color: 'violet', icon: 'brain' }, { id: 'c-2', name: 'Podolog', move: 'spend', color: 'brown', icon: 'tag' },
    { id: 'c-3', name: 'Apteka', move: 'spend', color: 'red', icon: 'heart' }, { id: 'c-4', name: 'Zdrowie', move: 'spend', color: 'green', icon: 'heart' },
    { id: 'c-5', name: 'Pensja', move: 'income', color: 'green', icon: 'banknote' },
  ] as BankLedger['categories'],
  entries: [
    entry('a', '2026-10-20', -150, 'Gabinet', 'c-1', ['terapia']), entry('b', '2026-09-20', -150, 'Gabinet', 'c-1'), entry('c', '2026-10-01', -120, 'Podolog K.', 'c-2'),
    entry('d', '2026-10-05', -45.5, 'Apteka G.', 'c-3'), entry('e', '2026-10-06', -30, 'Lekarz', 'c-4'),
  ],
};
const plan = (over: Record<string, unknown> = {}) => bankPlanSchema.parse({ merge: ['psycholog', 'PODOLOG'], into: 'Zdrowie', ...over });

describe('the preview of a merge', () => {
  it('counts what moves from all kept marks, into a category that exists, with a tag from each name', () => {
    const preview = planPreview(ledger, plan());
    expect(preview.problems).toEqual([]);
    expect(preview.sources.map(s => [s.name, s.count, s.spent, s.tag])).toEqual([['Psycholog', 2, 300, 'psycholog'], ['Podolog', 1, 120, 'podolog']]);
    expect(preview.into).toMatchObject({ name: 'Zdrowie', created: false, before: { count: 1, spent: 30 }, after: { count: 4, spent: 450 } });
    expect(preview).toMatchObject({ moved: 3, tagged: 3, noTag: 0 });
    expect(preview.into).toMatchObject({ color: 'green', icon: 'heart' });
  });

  it('says which tags are new and which the user has, what each folded category keeps, and who cannot take a tag', () => {
    const withLimit: BankLedger = {
      ...ledger,
      entries: [...ledger.entries, entry('f', '2026-10-07', -45.5, 'Apteka T.', 'c-3', Array.from({ length: 10 }, (_, i) => `t${i}`))],
    };
    const preview = planPreview(withLimit, plan({ merge: ['Psycholog', 'Apteka'] }));
    expect(preview.sources.map(s => [s.name, s.tag, s.tagState, s.keeps])).toEqual([['Psycholog', 'psycholog', 'new', ['terapia']], ['Apteka', 'apteka', 'exists', ['t0', 't1', 't2', 't3']]]);
    expect(preview.sources[0].color).toBe('violet');
    // two Apteka marks: one with room gets the tag, the one holding ten tags does not; both Psycholog marks get it
    expect(preview).toMatchObject({ moved: 4, tagged: 3, noTag: 1 });
    expect(planPreview(ledger, plan({ tags: false })).sources.every(s => s.tag === null && s.tagState === null)).toBe(true);
  });

  it('makes a category that is not there, and leaves tags out when asked', () => {
    const preview = planPreview(ledger, plan({ into: 'Wizyty', tags: false }));
    expect(preview.into).toMatchObject({ name: 'Wizyty', created: true, before: { count: 0, spent: 0 }, after: { count: 3, spent: 420 } });
    expect(preview.sources.every(s => s.tag === null)).toBe(true);
    expect(preview.tagged).toBe(0);
  });

  it('matches names exactly, never by a part, and says why it cannot go ahead', () => {
    expect(planPreview(ledger, plan({ merge: ['psych'] })).problems[0]).toMatch(/Nie ma kategorii wydatków „psych”.*Psycholog, Podolog, Apteka, Zdrowie/);
    expect(planPreview(ledger, plan({ merge: ['Pensja'] })).problems[0]).toMatch(/Nie ma kategorii wydatków „Pensja”/);
    expect(planPreview(ledger, plan({ merge: ['Zdrowie'] })).problems[0]).toMatch(/kategorią docelową/);
    expect(planPreview(ledger, plan({ merge: ['Psycholog', 'psycholog'] })).sources).toHaveLength(1);
  });
});

describe('the answer on the card', () => {
  const CHAT = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11';
  const answered = JSON.stringify({ result: `${CARD_SHOWN.bankPlan}: 3 operacji przejdzie.` });
  // The ids the chat makes for these cards: the answer and the plan, so a decision is tied to what the user saw.
  const okInput = { merge: ['Subskrypcje', 'Rachunki'], into: 'Stałe opłaty', tytul: 'Stałe opłaty' };
  const badInput = { merge: ['Nie ma takiej'], into: 'X' };
  const refusedInput = { merge: ['Subskrypcje'], into: 'Y' };
  const OK = stableBankCardId('m1', JSON.stringify(okInput))!, BAD = stableBankCardId('m1', JSON.stringify(badInput))!, REFUSED = stableBankCardId('m1', JSON.stringify(refusedInput))!;
  const card = (id: string, input: unknown, output = answered) => ({ type: 'tool', id, name: 'mcp__desk_panel__panel_bank_propose', input: JSON.stringify(input), output, state: 'done' });

  async function withServer<T>(run: (base: string, sources: Awaited<ReturnType<typeof makeSources>>) => Promise<T>) {
    const { createPanelServer } = await import('./app');
    const sources = await makeSources();
    const dir = mkdtempSync(join(tmpdir(), 'bank-plan-'));
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    const items = [{
      id: 'm1', role: 'agent', status: 'done', parts: [
        card(OK, okInput),
        // the same plan sent twice in one answer is one card with one id
        card(OK, okInput),
        card(BAD, badInput),
        card(REFUSED, refusedInput, JSON.stringify({ result: 'Nie ma kategorii wydatków „Y”.' })),
        // a card that never got its stable id (Hermes's own call id) cannot be answered
        card('call_raw', okInput),
      ],
    }];
    const chat = { get: async () => ({ engine: 'hermes', items }) } as never;
    const server = createPanelServer(sources, dir, undefined, chat, { cockpit }).listen(0, '127.0.0.1');
    await new Promise(done => server.once('listening', done));
    try { return await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, sources); }
    finally { server.closeAllConnections(); await new Promise(done => server.close(done)); rmSync(dir, { recursive: true, force: true }); }
  }
  async function makeSources() {
    const { createScenarioSources } = await import('./scenario');
    return createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
  }
  const post = (base: string, body: unknown, headers: Record<string, string> = { Origin: base }) =>
    fetch(`${base}/api/chats/${CHAT}/bank-plan`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });

  it('changes nothing until the user answers, only the page may answer, and the plan comes from the conversation', async () => {
    await withServer(async (base, sources) => {
      const before = (await sources.bankLedger()).categories.map(c => c.name);
      const preview = await (await fetch(`${base}/api/bank/plan?merge=Subskrypcje&merge=Rachunki&into=${encodeURIComponent('Stałe opłaty')}`)).json();
      expect(preview).toMatchObject({ problems: [], into: { name: 'Stałe opłaty', created: true } });
      expect((await sources.bankLedger()).categories.map(c => c.name)).toEqual(before);

      expect((await post(base, { toolCallId: OK, decision: 'apply' }, {})).status).toBe(403);
      // A request that carries its own plan is refused: only a card id and a yes or no are taken.
      expect((await post(base, { toolCallId: OK, decision: 'apply', merge: ['Zdrowie'], into: 'Wszystko' })).status).toBe(400);
      expect((await post(base, { toolCallId: 'm1:nope', decision: 'apply' })).status).toBe(409);
      expect((await post(base, { toolCallId: 'call_raw', decision: 'apply' })).status).toBe(409);
      const refused = await post(base, { toolCallId: REFUSED, decision: 'apply' });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toContain('odrzucił');
      const impossible = await post(base, { toolCallId: BAD, decision: 'apply' });
      expect(impossible.status).toBe(409);
      expect((await impossible.json()).error).toContain('Nie ma kategorii wydatków');
      expect((await sources.bankLedger()).categories.map(c => c.name)).toEqual(before);

      const applied = await post(base, { toolCallId: OK, decision: 'apply' });
      expect(applied.status).toBe(200);
      const outcome = await applied.json();
      expect(outcome).toMatchObject({ decision: 'applied', into: 'Stałe opłaty', created: true, moved: preview.moved });
      const after = await sources.bankLedger();
      expect(after.categories.map(c => c.name)).toContain('Stałe opłaty');
      expect(after.categories.map(c => c.name)).not.toContain('Subskrypcje');
      expect(after.entries.filter(e => e.label?.category === after.categories.find(c => c.name === 'Stałe opłaty')!.id)).toHaveLength(preview.moved);
      expect(after.entries.some(e => e.label?.tags.includes('subskrypcje') || e.label?.tags.includes('rachunki'))).toBe(true);
      // The same answer again (a double click) answers the same and does nothing twice.
      expect(await (await post(base, { toolCallId: OK, decision: 'apply' })).json()).toEqual(outcome);
      const view = await (await fetch(`${base}/api/chats/${CHAT}/cockpit`)).json();
      expect(view.bankPlans[OK]).toMatchObject({ decision: 'applied' });
    });
  });

  it('a rejection changes nothing and is kept', async () => {
    await withServer(async (base, sources) => {
      const before = (await sources.bankLedger()).categories.map(c => c.name);
      expect(await (await post(base, { toolCallId: OK, decision: 'reject' })).json()).toMatchObject({ decision: 'rejected' });
      expect((await sources.bankLedger()).categories.map(c => c.name)).toEqual(before);
      expect((await (await post(base, { toolCallId: OK, decision: 'apply' })).json())).toMatchObject({ decision: 'rejected' });
    });
  });
});
