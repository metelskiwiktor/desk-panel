import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { MailThread } from '../src/mail-contract';
import { isDone, type BankLabelsSource } from '../src/bank-labels-contract';
import type { BankSource } from '../src/bank-contract';
import type { PanelSources } from './sources';
import {
  SMART_LIMITS, smartRuleSchema, type SmartActionsView, type SmartAlert, type SmartButton, type SmartMailMatch, type SmartMailRow, type SmartRule,
  type SmartRulePlan, type SmartRulePreview, type SmartTestRow,
} from '../src/smart-rules-contract';

/**
 * Smart Actions rules (the contract says what they are) and the alerts they make. Pure functions over mail and the
 * account, plus a small JSON store. The store starts with the rule the panel had in code before rules were data.
 */

export class SmartRuleError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const SEED_RULES: SmartRule[] = [{
  id: 'znanylekarz-confirm', name: 'ZnanyLekarz – potwierdzenie wizyty', source: 'mail', enabled: true,
  description: 'Mail od ZnanyLekarz z prośbą o potwierdzenie wizyty.', category: 'appointment', priority: 'high', badge: 'ZnanyLekarz',
  match: { from: ['znanylekarz'], subject: ['wizyt', 'potwierdź', 'potwierdzenie', 'obecność'] },
  button: { label: 'Potwierdź wizytę', domain: 'znanylekarz.pl', contains: 'potwierd' },
}];

const lower = (s?: string) => (s ?? '').toLowerCase();
const any = (text: string, list?: string[]) => !!list?.some(w => text.includes(w.toLowerCase()));

/** Whether a mail rule's conditions hold for a conversation (see the contract). */
export function matchesMail(match: SmartMailMatch, thread: MailThread): boolean {
  const from = `${lower(thread.from)} ${lower(thread.address)}`, subject = lower(thread.subject);
  const body = `${subject} ${lower(thread.snippet)} ${lower(thread.body)}`;
  if (match.from?.length && !any(from, match.from)) return false;
  if (match.subject?.length && !any(subject, match.subject)) return false;
  if (match.body?.length && !any(body, match.body)) return false;
  return !any(subject, match.subjectNot) && !any(body, match.bodyNot);
}

/** The mail's https links with the text before them (the body keeps an html link as `text (url)`). */
export function linksOf(text: string): { url: string; host: string; text: string }[] {
  const links: { url: string; host: string; text: string }[] = [];
  for (const m of text.matchAll(/https:\/\/[^\s<>"()]+/g)) {
    const url = m[0].replace(/[.,;:]+$/, '');
    let host: string;
    try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
    const line = text.slice(Math.max(0, text.lastIndexOf('\n', m.index) + 1), m.index).slice(-80).replace(/[(\s]+$/, '').trim();
    links.push({ url, host, text: line });
  }
  return links;
}
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The button's link: only on its domain, the one naming `contains` first. */
export function buttonLink(button: SmartButton, thread: MailThread): { url?: string; noLink?: string } {
  const links = linksOf(thread.body ?? thread.snippet).filter(l => onDomain(l.host, button.domain));
  if (!links.length) return { noLink: `w mailu nie ma linku z domeny ${button.domain}` };
  const want = lower(button.contains);
  const best = want ? links.find(l => lower(l.text).includes(want) || lower(l.url).includes(want)) : undefined;
  return { url: (best ?? links[0]).url };
}

type MailRule = Extract<SmartRule, { source: 'mail' }>;
/** What a mail rule does with a mail: an alert only when its conditions hold and the button has a link to open. */
export function verdict(rule: MailRule, thread: MailThread): { caught: boolean; url?: string; noLink?: string } {
  if (!matchesMail(rule.match, thread)) return { caught: false };
  const link = buttonLink(rule.button, thread);
  return link.url ? { caught: true, url: link.url } : { caught: false, noLink: `pasuje, ale ${link.noLink}` };
}

/** The alert of a mail the rule gives one for (see `verdict`), or null. */
export function mailAlert(rule: MailRule, thread: MailThread): SmartAlert | null {
  const { url } = verdict(rule, thread);
  if (!url) return null;
  return {
    id: `mail:${thread.id}`, ruleId: rule.id, source: 'mail', badge: rule.badge, title: thread.subject, snippet: thread.snippet,
    category: rule.category, priority: rule.priority, at: thread.receivedAt, url, label: rule.button.label,
    mail: { account: thread.account, threadId: thread.threadId, sourceUrl: thread.sourceUrl },
  };
}

/** The operations a bank rule shows: not done, with a suggestion (`pewna`: only a sure one); every option is a button. */
export function bankAlerts(rule: Extract<SmartRule, { source: 'bank' }>, bank: BankSource, labels: BankLabelsSource): SmartAlert[] {
  const data = labels.data;
  if (!data) return [];
  const alerts: SmartAlert[] = [];
  for (const t of bank.data?.transactions ?? []) {
    const s = data.suggestions[t.id];
    if (!s?.options.length || isDone(data.labels[t.id]) || (rule.suggestion === 'pewna' && !s.sure)) continue;
    alerts.push({
      id: `bank:${t.id}`, ruleId: rule.id, source: 'bank', badge: rule.badge, category: rule.category, priority: rule.priority,
      title: t.title, snippet: t.note ?? '', at: t.at,
      bank: { tx: t.id, amount: t.amount, currency: t.currency, options: s.options.map((o, index) => ({ index, label: optionLabel(o, data), sure: s.sure, reason: o.reasons.at(-1) })) },
    });
  }
  return alerts;
}
type LabelsData = NonNullable<BankLabelsSource['data']>;
const MOVES: Record<string, string> = { spend: 'Wydatek', income: 'Przychód', settle: 'Rozliczenie', move: 'Przełożenie' };
function optionLabel(o: LabelsData['suggestions'][string]['options'][number], data: LabelsData): string {
  const category = o.category ? data.categories.find(c => c.id === o.category)?.name : undefined;
  const party = o.party ? data.parties.find(p => p.id === o.party)?.name : undefined;
  return [category ?? (o.move ? MOVES[o.move] : undefined), party].filter(Boolean).join(': ') || 'Podpowiedź';
}

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;
/** Every alert of the enabled rules: the first rule that catches a mail wins it. Highest priority, then newest first. */
export function alertsOf(rules: SmartRule[], mail: MailThread[] | null, bank?: { bank: BankSource; labels: BankLabelsSource }): SmartAlert[] {
  const alerts: SmartAlert[] = [];
  const mailRules = rules.filter((r): r is MailRule => r.enabled && r.source === 'mail');
  for (const thread of mail ?? []) {
    const alert = mailRules.map(r => mailAlert(r, thread)).find(Boolean);
    if (alert) alerts.push(alert);
  }
  const seen = new Set<string>();
  if (bank) for (const rule of rules) if (rule.enabled && rule.source === 'bank') for (const a of bankAlerts(rule, bank.bank, bank.labels)) if (!seen.has(a.id)) { seen.add(a.id); alerts.push(a); }
  return alerts.sort((a, b) => WEIGHT[b.priority] - WEIGHT[a.priority] || b.at - a.at);
}

export const mailRow = (t: MailThread): SmartMailRow => ({
  id: t.id, account: t.account, threadId: t.threadId, from: t.from, address: t.address ?? '', subject: t.subject, at: t.receivedAt,
  unread: t.unread ?? true, sourceUrl: t.sourceUrl,
});

/**
 * The Gmail query a test runs on when Wektor names none: mails of the rule's senders from half a year, or, for a rule
 * without senders, its subject words. A rule is checked against what it should catch and what it should leave.
 */
export function defaultQuery(rule: SmartRule): string | null {
  if (rule.source !== 'mail') return null;
  const quote = (w: string) => /\s/.test(w) ? `"${w.replace(/"/g, '')}"` : w.replace(/[(){}"]/g, '');
  const words = rule.match.from?.length ? rule.match.from.map(w => `from:${quote(w)}`) : (rule.match.subject ?? rule.match.body ?? []).map(quote);
  return words.length ? `(${words.join(' OR ')}) newer_than:180d` : null;
}

/** What a proposal would do: the rule before and after, and each test mail caught or not by both. */
export function rulePreview(rules: SmartRule[], plan: SmartRulePlan, test: { query: string | null; threads: MailThread[] } | null, bank?: { bank: BankSource; labels: BankLabelsSource }): SmartRulePreview {
  const problems: string[] = [];
  if ('remove' in plan) {
    const before = rules.find(r => r.id === plan.remove) ?? null;
    if (!before) problems.push(`Nie ma reguły ${plan.remove}. Reguły: ${rules.map(r => r.id).join(', ') || 'brak'}.`);
    return { kind: 'remove', before, after: null, query: null, rows: [], problems };
  }
  const after = plan.rule, before = rules.find(r => r.id === after.id) ?? null;
  if (!before && rules.length >= SMART_LIMITS.rules) problems.push(`Jest już ${SMART_LIMITS.rules} reguł: zmień albo usuń którąś.`);
  if (before && before.source !== after.source) problems.push('Reguła nie zmienia źródła: nadaj nowej regule inne id.');
  const rows: SmartTestRow[] = after.source === 'mail' ? (test?.threads ?? []).map(t => ({
    ...mailRow(t), ...verdict(after, t), ...(before?.source === 'mail' ? { caughtNow: before.enabled && verdict(before, t).caught } : {}),
  })) : [];
  const bankCount = after.source === 'bank' && bank ? bankAlerts(after, bank.bank, bank.labels).length : undefined;
  return { kind: before ? 'change' : 'new', before, after, query: test?.query ?? null, rows, ...(bankCount !== undefined ? { bankCount } : {}), problems };
}

const storeSchema = z.object({ version: z.literal(1), rules: z.array(smartRuleSchema) });
export interface SmartRuleStore {
  list(): SmartRule[];
  /** Saves the plan (one write); throws SmartRuleError when it cannot be carried out now. */
  apply(plan: SmartRulePlan): SmartRule[];
  toggle(id: string, enabled: boolean): SmartRule[];
}
export function createSmartRuleStore(file: string | null, seed: SmartRule[] = SEED_RULES): SmartRuleStore {
  let rules: SmartRule[] = seed;
  if (file && existsSync(file)) {
    try { rules = storeSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).rules; } catch { /* a broken file keeps the seed until the next write */ }
  }
  const save = (next: SmartRule[]) => {
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, rules: next }, null, 2), 'utf8');
      renameSync(`${file}.tmp`, file);
    }
    rules = next;
    return rules;
  };
  return {
    list: () => rules,
    apply(plan) {
      const problems = rulePreview(rules, plan, null).problems;
      if (problems.length) throw new SmartRuleError(409, problems.join(' '));
      if ('remove' in plan) return save(rules.filter(r => r.id !== plan.remove));
      const at = rules.findIndex(r => r.id === plan.rule.id);
      return save(at < 0 ? [...rules, plan.rule] : rules.map((r, i) => i === at ? plan.rule : r));
    },
    toggle(id, enabled) {
      if (!rules.some(r => r.id === id)) throw new SmartRuleError(404, `Nie ma reguły ${id}.`);
      return save(rules.map(r => r.id === id ? { ...r, enabled } : r));
    },
  };
}

/** Alerts as the tile and Wektor see them: unread mail and the kept bank reading (never a new bank read). */
export async function smartView(sources: PanelSources): Promise<SmartActionsView> {
  const rules = sources.smartRules?.list() ?? [];
  const problems: string[] = [];
  let mail: MailThread[] | null = null;
  try {
    const source = await sources.mail(500);
    mail = source.data;
    if (!mail) problems.push(`Poczta: ${source.message ?? 'brak odczytu'}.`);
  } catch { problems.push('Poczta: nie udało się odczytać.'); }
  let bank: { bank: BankSource; labels: BankLabelsSource } | undefined;
  if (rules.some(r => r.enabled && r.source === 'bank')) {
    try { bank = { bank: await sources.bank(), labels: await sources.bankLabels() }; }
    catch { problems.push('Konto: nie udało się odczytać.'); }
  }
  return { rules, alerts: alertsOf(rules, mail, bank), problems };
}

export const TEST_LIMIT = 30;
/** A proposal worked out now: the test mails come from Gmail (`q`, or the rule's own senders), the operations from the kept reading. */
export async function previewPlan(sources: PanelSources, plan: SmartRulePlan): Promise<SmartRulePreview> {
  const rules = sources.smartRules?.list() ?? [];
  if ('remove' in plan) return rulePreview(rules, plan, null);
  const query = plan.q ?? defaultQuery(plan.rule);
  let test: { query: string | null; threads: MailThread[] } | null = null;
  if (plan.rule.source === 'mail' && query) {
    if (!sources.mailSearch) throw new SmartRuleError(503, 'Wyszukiwanie poczty nie jest dostępne.');
    test = { query, threads: await sources.mailSearch(query, TEST_LIMIT) };
  }
  const bank = plan.rule.source === 'bank' ? { bank: await sources.bank(), labels: await sources.bankLabels() } : undefined;
  return rulePreview(rules, plan, test, bank);
}
