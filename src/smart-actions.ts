import type { MailThread } from './mail-contract';
import type { Task } from './model';

export type SmartActionCategory = 'appointment' | 'pr_review' | 'payment' | 'task_alert' | 'other';
export type SmartActionPriority = 'high' | 'medium' | 'low';

export interface SmartAction {
  id: string;
  source: 'mail' | 'cezar' | 'system' | 'alert';
  sourceId: string;
  sourceBadge: string;
  title: string;
  snippet: string;
  category: SmartActionCategory;
  priority: SmartActionPriority;
  timestamp: number;
  actionUrl?: string;
  actionLabel?: string;
  mailThread?: MailThread;
}

export interface SmartActionMatchCriteria {
  /** Domain patterns to check against sender or body (e.g. ['znanylekarz.pl']) */
  senderDomains?: string[];
  /** Sender keywords to check against from header or content (e.g. ['znanylekarz']) */
  senderKeywords?: string[];
  /** Subject keywords or phrases (case-insensitive substring match) */
  subjectKeywords?: string[];
  /** Body or snippet keywords or phrases (case-insensitive substring match) */
  bodyKeywords?: string[];
}

export interface SmartActionRule {
  id: string;
  name: string;
  description: string;
  category: SmartActionCategory;
  priority: SmartActionPriority;
  enabled: boolean;
  matchCriteria: SmartActionMatchCriteria;
  matches?: (thread: MailThread) => boolean;
  extract: (thread: MailThread) => SmartAction | null;
}

export const DISMISSED_STORAGE_KEY = 'desk-panel.dismissed-smart-actions';
export const RULES_CONFIG_STORAGE_KEY = 'desk-panel.smart-action-rules-config';

export function extractUrl(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/https?:\/\/[^\s<>"]+/);
  if (!match) return undefined;
  return match[0].replace(/[.,;:)]+$/, '');
}

export function extractAppointmentUrl(text?: string): string | undefined {
  if (!text) return undefined;
  const confirmPatterns = [
    /(?:potwierd[a-ząćęłńóśźż]*|obecnoś[ćci]|przełóż|wizyt[a-zęóąśłżźćń]*)\b[^\n\r]*?(https?:\/\/[^\s<>"]+)/i,
    /(https?:\/\/[^\s<>"]+)[^\n\r]*?(?:potwierd[a-ząćęłńóśźż]*|obecnoś[ćci]|przełóż)/i,
    /https?:\/\/[^\s<>"]*(?:znanylekarz|potwierdz|confirm|wizyt)[^\s<>"]*/i,
  ];
  for (const pattern of confirmPatterns) {
    const match = text.match(pattern);
    if (match) {
      const url = match[1] || match[0];
      return url.replace(/[.,;:)]+$/, '');
    }
  }
  return extractUrl(text);
}

export function matchThreadCriteria(thread: MailThread, criteria: SmartActionMatchCriteria): boolean {
  const from = (thread.from || '').toLowerCase();
  const subject = (thread.subject || '').toLowerCase();
  const snippet = (thread.snippet || '').toLowerCase();
  const body = (thread.body || '').toLowerCase();
  const content = `${subject} ${snippet} ${body}`;

  const hasDomains = Boolean(criteria.senderDomains && criteria.senderDomains.length > 0);
  const hasSenderKeywords = Boolean(criteria.senderKeywords && criteria.senderKeywords.length > 0);

  if (hasDomains || hasSenderKeywords) {
    let senderMatched = false;

    if (hasDomains && criteria.senderDomains) {
      if (criteria.senderDomains.some((d) => from.includes(d.toLowerCase()) || body.includes(d.toLowerCase()))) {
        senderMatched = true;
      }
    }

    if (!senderMatched && hasSenderKeywords && criteria.senderKeywords) {
      if (criteria.senderKeywords.some((k) => from.includes(k.toLowerCase()) || content.includes(k.toLowerCase()))) {
        senderMatched = true;
      }
    }

    if (!senderMatched) return false;
  }

  if (criteria.subjectKeywords && criteria.subjectKeywords.length > 0) {
    const hasSubjectMatch = criteria.subjectKeywords.some((kw) => subject.includes(kw.toLowerCase()));
    if (!hasSubjectMatch) return false;
  }

  if (criteria.bodyKeywords && criteria.bodyKeywords.length > 0) {
    const hasBodyMatch = criteria.bodyKeywords.some((kw) => content.includes(kw.toLowerCase()));
    if (!hasBodyMatch) return false;
  }

  return true;
}

export const ZNANY_LEKARZ_RULE: SmartActionRule = {
  id: 'znanylekarz-confirm',
  name: 'ZnanyLekarz – Potwierdzenie wizyty',
  description: 'Wykrywa wiadomości od ZnanyLekarz z prośbą o potwierdzenie wizyty i udostępnia szybki link akcji.',
  category: 'appointment',
  priority: 'high',
  enabled: true,
  matchCriteria: {
    senderDomains: ['znanylekarz.pl'],
    senderKeywords: ['znanylekarz'],
    subjectKeywords: ['wizycie', 'wizyt', 'potwierdź', 'potwierdzenie', 'obecność', 'termin wizyty'],
    bodyKeywords: ['znanylekarz', 'potwierdź', 'przełóż', 'wizyta', 'wizyty'],
  },
  extract: (thread: MailThread): SmartAction | null => {
    const body = thread.body ?? '';
    const snippet = thread.snippet ?? '';
    const appointmentUrl = extractAppointmentUrl(body) || extractAppointmentUrl(snippet) || extractUrl(body) || extractUrl(snippet) || thread.sourceUrl;

    return {
      id: `mail:${thread.id}`,
      source: 'mail',
      sourceId: thread.id,
      sourceBadge: 'ZnanyLekarz',
      title: thread.subject,
      snippet: snippet || 'Wymagane potwierdzenie wizyty',
      category: 'appointment',
      priority: 'high',
      timestamp: thread.receivedAt,
      actionUrl: appointmentUrl,
      actionLabel: 'Potwierdź wizytę',
      mailThread: thread,
    };
  },
};

export class SmartActionRegistry {
  private rules: Map<string, SmartActionRule> = new Map();

  constructor(initialRules: SmartActionRule[] = [ZNANY_LEKARZ_RULE]) {
    for (const rule of initialRules) {
      this.register(rule);
    }
  }

  register(rule: SmartActionRule): void {
    this.rules.set(rule.id, { ...rule });
  }

  unregister(id: string): void {
    this.rules.delete(id);
  }

  getRules(): SmartActionRule[] {
    return Array.from(this.rules.values());
  }

  getRule(id: string): SmartActionRule | undefined {
    return this.rules.get(id);
  }

  clear(): void {
    this.rules.clear();
  }
}

export const defaultRuleRegistry = new SmartActionRegistry([ZNANY_LEKARZ_RULE]);

export function registerSmartActionRule(rule: SmartActionRule): void {
  defaultRuleRegistry.register(rule);
}

export function unregisterSmartActionRule(id: string): void {
  defaultRuleRegistry.unregister(id);
}

export function getRegisteredSmartActionRules(): SmartActionRule[] {
  return defaultRuleRegistry.getRules();
}

export function loadRulesConfig(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(RULES_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Restricted environment
  }
  return {};
}

export function saveRulesConfig(config: Record<string, boolean>): void {
  try {
    localStorage.setItem(RULES_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Restricted environment
  }
}

export function isRuleEnabled(rule: SmartActionRule, config?: Record<string, boolean>): boolean {
  if (config && typeof config[rule.id] === 'boolean') {
    return config[rule.id];
  }
  return rule.enabled;
}

export function parseEmailAction(
  thread: MailThread,
  rules: SmartActionRule[] = defaultRuleRegistry.getRules(),
  rulesConfig?: Record<string, boolean>,
): SmartAction | null {
  for (const rule of rules) {
    if (!isRuleEnabled(rule, rulesConfig)) {
      continue;
    }

    const matches = rule.matches ? rule.matches(thread) : matchThreadCriteria(thread, rule.matchCriteria);
    if (matches) {
      const action = rule.extract(thread);
      if (action) {
        return action;
      }
    }
  }
  return null;
}

export function parseTaskAction(task: Task): SmartAction | null {
  if (task.status === 'needs-input') {
    return {
      id: `cezar:${task.id}`,
      source: 'cezar',
      sourceId: task.id,
      sourceBadge: 'Cezar',
      title: task.title,
      snippet: task.question || task.lastMessage || 'Zadanie czeka na odpowiedź lub decyzję',
      category: 'task_alert',
      priority: 'high',
      timestamp: task.checkedAt,
      actionUrl: task.sourceUrl,
      actionLabel: 'Odpowiedz',
    };
  }

  if (task.status === 'review') {
    return {
      id: `cezar:${task.id}`,
      source: 'cezar',
      sourceId: task.id,
      sourceBadge: 'Cezar',
      title: task.title,
      snippet: 'Zadanie zakończone, oczekuje na weryfikację zmian',
      category: 'task_alert',
      priority: 'medium',
      timestamp: task.checkedAt,
      actionUrl: task.sourceUrl,
      actionLabel: 'Przejrzyj',
    };
  }

  return null;
}

export function parseSmartActions(options: {
  threads?: MailThread[] | null;
  tasks?: Task[] | null;
  dismissedIds?: Set<string> | string[];
  rules?: SmartActionRule[];
  rulesConfig?: Record<string, boolean>;
}): SmartAction[] {
  const dismissed = options.dismissedIds instanceof Set
    ? options.dismissedIds
    : new Set(options.dismissedIds ?? []);

  const rules = options.rules ?? defaultRuleRegistry.getRules();
  const rulesConfig = options.rulesConfig ?? loadRulesConfig();

  const actions: SmartAction[] = [];

  if (options.threads) {
    for (const thread of options.threads) {
      const action = parseEmailAction(thread, rules, rulesConfig);
      if (action && !dismissed.has(action.id)) {
        actions.push(action);
      }
    }
  }

  if (options.tasks) {
    for (const task of options.tasks) {
      const action = parseTaskAction(task);
      if (action && !dismissed.has(action.id)) {
        actions.push(action);
      }
    }
  }

  const priorityWeight: Record<SmartActionPriority, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return actions.sort((a, b) => {
    const diff = priorityWeight[b.priority] - priorityWeight[a.priority];
    if (diff !== 0) return diff;
    return b.timestamp - a.timestamp;
  });
}

export function loadDismissedActionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === 'string'));
    }
  } catch {
    // Storage might be restricted
  }
  return new Set();
}

export function saveDismissedActionId(id: string): void {
  try {
    const current = loadDismissedActionIds();
    current.add(id);
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...current]));
  } catch {
    // Storage might be restricted
  }
}

export function clearDismissedActionIds(): void {
  try {
    localStorage.removeItem(DISMISSED_STORAGE_KEY);
  } catch {
    // Storage might be restricted
  }
}
