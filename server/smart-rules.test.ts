import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailThread } from '../src/mail-contract';
import type { BankSource } from '../src/bank-contract';
import type { BankLabelsSource } from '../src/bank-labels-contract';
import type { SmartRule } from '../src/smart-rules-contract';
import { alertsOf, buttonLink, createSmartRuleStore, defaultQuery, rulePreview, SEED_RULES, SmartRuleError, smartView } from './smart-rules';
import { CARD_SHOWN } from '../src/cockpit-contract';
import { handleChatRoute } from './chat-routes';
import { createCockpit } from './cockpit';
import type { PanelSources } from './sources';

const thread = (over: Partial<MailThread>): MailThread => ({
  id: 'me@x.pl:a1', account: 'me@x.pl', threadId: 'a1', from: 'Nadawca', address: 'nadawca@x.pl', subject: 'Temat', snippet: '',
  body: '', receivedAt: 1_000, messages: 1, sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/a1', ...over,
});
const bill = thread({ id: 'me@x.pl:b1', threadId: 'b1', from: 'INEA', address: 'e-rachunek@inea.com.pl', subject: 'Twój rachunek',
  body: 'Faktura do zapłaty.\nZapłać teraz (https://fakturowanie.inea.com.pl/pay?id=7)\nRegulamin (https://www.inea.com.pl/regulamin)\nKliknij (https://evil.example/inea.com.pl)' });
const offer = thread({ id: 'me@x.pl:b2', threadId: 'b2', from: 'INEA', address: 'oferty@inea.com.pl', subject: 'Nowa oferta światłowodu', receivedAt: 2_000 });
const inea: SmartRule = { id: 'inea-rachunek', name: 'Inea – rachunek', source: 'mail', enabled: true, category: 'payment', priority: 'high', badge: 'Inea',
  match: { from: ['e-rachunek@inea.com.pl'], subject: ['rachunek'] }, button: { label: 'Zapłać rachunek', domain: 'inea.com.pl', contains: 'zapłać' } };

describe('Smart Actions rules', () => {
  it('a mail rule needs every list it has and none of its exclusions', () => {
    const visit = thread({ address: 'noreply@znanylekarz.pl', subject: '❗Ważne: sprawdź, czy szczegóły wizyty się zgadzają' });
    const [seed] = SEED_RULES;
    // The seed is the rule the panel had in code: it catches this mail too (the bug the user asked Wektor to fix).
    expect(alertsOf(SEED_RULES, [{ ...visit, body: 'Szczegóły (https://d.znanylekarz.pl/a)' }])).toHaveLength(1);
    const fixed = { ...seed, match: { ...(seed as Extract<SmartRule, { source: 'mail' }>).match, subjectNot: ['sprawdź, czy szczegóły'] } } as SmartRule;
    expect(alertsOf([fixed], [visit])).toEqual([]);
    // Only what can be done: a mail that matches but has no link for the button gives no alert.
    expect(alertsOf([inea], [{ ...bill, body: 'Termin płatności mija jutro. Numer konta 12 3456.' }])).toEqual([]);
    expect(alertsOf([inea], [bill, offer]).map(a => a.id)).toEqual(['mail:me@x.pl:b1']);
    expect(alertsOf([{ ...inea, enabled: false }], [bill])).toEqual([]);
  });

  it('a button opens only a link of its own domain, the one naming its word first', () => {
    expect(buttonLink(inea.source === 'mail' ? inea.button! : null!, bill)).toEqual({ url: 'https://fakturowanie.inea.com.pl/pay?id=7' });
    // A link that only names the domain in its path is not on it.
    expect(buttonLink({ label: 'X', domain: 'example.com' }, thread({ body: 'Tu (https://example.com.evil.pl/a)' }))).toEqual({ noLink: 'w mailu nie ma linku z domeny example.com' });
    const alert = alertsOf([inea], [bill])[0];
    expect(alert).toMatchObject({ url: 'https://fakturowanie.inea.com.pl/pay?id=7', label: 'Zapłać rachunek', badge: 'Inea', mail: { account: 'me@x.pl', threadId: 'b1' } });
  });

  it('a bank rule shows each operation not done that has a suggestion, every option as a button', () => {
    const bank = { data: { accounts: [], transactions: [
      { id: 't1', accountId: 'a', at: 5_000, amount: -42, currency: 'PLN', title: 'Żabka' },
      { id: 't2', accountId: 'a', at: 4_000, amount: -120, currency: 'PLN', title: 'A. Nowak' },
      { id: 't3', accountId: 'a', at: 3_000, amount: -10, currency: 'PLN', title: 'Bez podpowiedzi' },
    ] } } as unknown as BankSource;
    const labels = { data: {
      categories: [{ id: 'c-food', name: 'Jedzenie' }, { id: 'c-gift', name: 'Prezenty' }], parties: [{ id: 'p-ania', name: 'Ania', identifiers: [] }], labels: {},
      suggestions: {
        t1: { sure: true, options: [{ move: 'spend', category: 'c-food', reasons: ['ten sam tekst w banku'] }] },
        t2: { sure: false, options: [{ move: 'settle', party: 'p-ania', reasons: ['r'] }, { move: 'spend', category: 'c-gift', reasons: ['r'] }] },
      },
    } } as unknown as BankLabelsSource;
    const rule: SmartRule = { id: 'przelewy', name: 'Przelewy', source: 'bank', suggestion: 'dowolna', enabled: true, category: 'payment', priority: 'medium', badge: 'Konto' };
    const alerts = alertsOf([rule], null, { bank, labels });
    expect(alerts.map(a => [a.id, a.bank?.options.map(o => `${o.label}${o.sure ? '!' : ''}`)])).toEqual([
      ['bank:t1', ['Jedzenie!']], ['bank:t2', ['Rozliczenie: Ania', 'Prezenty']],
    ]);
    expect(alertsOf([{ ...rule, suggestion: 'pewna' }], null, { bank, labels }).map(a => a.id)).toEqual(['bank:t1']);
  });

  it('a preview tells what the change does to each test mail, compared with the rule saved now', () => {
    const before = { ...inea, match: { from: ['inea.com.pl'] } } as SmartRule;
    const offerWithLink = { ...offer, body: 'Oferta (https://moja.inea.com.pl/oferta)' };
    const reminder = thread({ threadId: 'b3', address: 'e-rachunek@inea.com.pl', subject: 'Przypomnienie: rachunek', body: 'Numer konta 12 3456.' });
    const preview = rulePreview([before], { rule: inea }, { query: defaultQuery(inea), threads: [bill, offerWithLink, reminder] });
    expect(preview.kind).toBe('change');
    expect(preview.query).toBe('(from:e-rachunek@inea.com.pl) newer_than:180d');
    expect(preview.rows.map(r => [r.threadId, r.caught, r.caughtNow, r.noLink])).toEqual([
      ['b1', true, true, undefined], ['b2', false, true, undefined], ['b3', false, false, 'pasuje, ale w mailu nie ma linku z domeny inea.com.pl'],
    ]);
    expect(rulePreview([], { remove: 'nope' }, null).problems[0]).toMatch(/Nie ma reguły nope/);
  });

  it('the store saves a plan in one write and keeps rules across restarts', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'smart-')), 'smart-rules.json');
    const store = createSmartRuleStore(file);
    expect(store.list().map(r => r.id)).toEqual(['znanylekarz-confirm']);
    store.apply({ rule: inea });
    store.toggle('znanylekarz-confirm', false);
    expect(createSmartRuleStore(file).list().map(r => [r.id, r.enabled])).toEqual([['znanylekarz-confirm', false], ['inea-rachunek', true]]);
    store.apply({ remove: 'inea-rachunek' });
    expect(JSON.parse(readFileSync(file, 'utf8')).rules).toHaveLength(1);
    expect(() => store.apply({ rule: { ...inea, id: 'znanylekarz-confirm', source: 'bank', suggestion: 'dowolna' } as SmartRule })).toThrow(SmartRuleError);
  });
});


it('expires automation alerts after 30 days and removes cancelled automations immediately', async () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const time = vi.spyOn(Date, 'now').mockReturnValue(now);
  const action = { kind: 'smartAction', result: 'ok', ref: 'recent', at: now, title: 'Recent' };
  const sources = { mail: async () => ({ data: [] }), automations: async () => ({ automations: [
    { id: 'active', name: 'A', status: 'active', runs: [{ actions: [action, { ...action, ref: 'old', at: now - 30 * 24 * 60 * 60_000 - 1 }] }] },
    { id: 'cancelled', name: 'B', status: 'cancelled', runs: [{ actions: [{ ...action, ref: 'cancelled' }] }] },
  ] }) } as unknown as import('./sources').PanelSources;
  try { expect((await smartView(sources)).alerts.map(x => x.id)).toEqual(['recent']); }
  finally { time.mockRestore(); }
});

describe('the consent card route for a Smart Actions rule', () => {
  const CHAT = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b44';
  const rule = (badge: string) => ({ id: 'inea-rachunek', name: 'Inea – rachunek', source: 'mail', enabled: true, category: 'payment', priority: 'high', badge,
    match: { from: ['e-rachunek@inea.com.pl'], subject: ['rachunek'] }, button: { label: 'Zapłać rachunek', domain: 'inea.com.pl' } });
  const card = (message: string, badge: string) => ({ type: 'tool', id: `${message}:s-1`, name: 'mcp__desk_panel__panel_smart_rule_propose', input: JSON.stringify({ tytul: 'Inea', rule: rule(badge), q: 'from:inea' }), output: JSON.stringify({ result: `${CARD_SHOWN.smartRule}: test gotowy.` }), state: 'done' });
  const conversation = () => ({ id: CHAT, engine: 'hermes', items: [
    { id: 'm1', role: 'agent', status: 'done', at: 1, parts: [card('m1', 'Inea')] },
    { id: 'm2', role: 'agent', status: 'done', at: 2, parts: [card('m2', 'Inea po zmianie')] },
  ] }) as never;
  function response() {
    let status = 200; let body = '';
    return {
      get status() { return status; }, get body() { return body; },
      setHeader() {}, writeHead(code: number) { status = code; return this; }, end(value?: string) { body = value ?? ''; return this; },
    };
  }
  const request = (body: unknown) => ({ method: 'POST', headers: { origin: 'http://panel' }, setEncoding() {}, async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } }) as never;
  const url = new URL(`http://panel/api/chats/${CHAT}/smart-rule`);

  it('refuses an older proposal replaced later in the conversation, and applies the newest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-route-'));
    const sources = { smartRules: createSmartRuleStore(null) } as unknown as PanelSources;
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    const chat = { get: async () => conversation() } as never;
    try {
      const stale = response();
      await handleChatRoute(request({ toolCallId: 'm1:s-1', decision: 'apply' }), stale as never, url, 'http://panel', chat, cockpit);
      expect(stale.status).toBe(409);
      expect(stale.body).toContain('zastąpiona nowszą');
      expect((await cockpit.view(CHAT, [])).bankPlans).toEqual({});
      const fresh = response();
      await handleChatRoute(request({ toolCallId: 'm2:s-1', decision: 'apply' }), fresh as never, url, 'http://panel', chat, cockpit);
      expect(fresh.status).toBe(200);
      expect(JSON.parse(fresh.body)).toMatchObject({ decision: 'applied' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('serializes the cards of one conversation: a stalled older apply ends 409 and the newer value stays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-race-'));
    const store = createSmartRuleStore(null);
    const both = conversation() as unknown as { items: unknown[] };
    // At first only the older card exists; the newer proposal arrives while its preview stalls.
    let current: unknown = { ...both, items: [both.items[0]] };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const inPreview = new Promise<void>(resolve => { entered = resolve; });
    let searches = 0;
    const sources = {
      smartRules: store,
      // The first card's preview stalls; the newer card is proposed and applied meanwhile.
      mailSearch: async () => { if (++searches === 1) { entered(); await gate; } return []; },
    } as unknown as PanelSources;
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    const chat = { get: async () => current } as never;
    try {
      const older = response();
      const applying = handleChatRoute(request({ toolCallId: 'm1:s-1', decision: 'apply' }), older as never, url, 'http://panel', chat, cockpit);
      await inPreview;
      current = conversation();
      const newer = response();
      const waiting = handleChatRoute(request({ toolCallId: 'm2:s-1', decision: 'apply' }), newer as never, url, 'http://panel', chat, cockpit);
      release();
      await Promise.all([applying, waiting]);
      expect(older.status).toBe(409);
      expect(older.body).toContain('zastąpiona nowszą');
      expect(newer.status).toBe(200);
      expect(JSON.parse(newer.body)).toMatchObject({ decision: 'applied' });
      expect(store.list().find(r => r.id === 'inea-rachunek')?.badge).toBe('Inea po zmianie');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns the kept answer of an already applied card, even after a newer proposal replaced it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-retry-'));
    const store = createSmartRuleStore(null);
    const sources = { smartRules: store } as unknown as PanelSources;
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    const all = conversation() as unknown as { id: string; engine: string; items: unknown[] };
    // At first only the older card exists; the newer proposal arrives after it was applied.
    let current: unknown = { ...all, items: [all.items[0]] };
    const chat = { get: async () => current } as never;
    try {
      const first = response();
      await handleChatRoute(request({ toolCallId: 'm1:s-1', decision: 'apply' }), first as never, url, 'http://panel', chat, cockpit);
      expect(first.status).toBe(200);
      const outcome = JSON.parse(first.body);
      current = conversation();
      const retry = response();
      await handleChatRoute(request({ toolCallId: 'm1:s-1', decision: 'apply' }), retry as never, url, 'http://panel', chat, cockpit);
      expect(retry.status).toBe(200);
      expect(JSON.parse(retry.body)).toEqual(outcome);
      const newer = response();
      await handleChatRoute(request({ toolCallId: 'm2:s-1', decision: 'apply' }), newer as never, url, 'http://panel', chat, cockpit);
      expect(newer.status).toBe(200);
      expect(store.list().find(r => r.id === 'inea-rachunek')?.badge).toBe('Inea po zmianie');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
