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

export const DISMISSED_STORAGE_KEY = 'desk-panel.dismissed-smart-actions';

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

const APPOINTMENT_REGEX = /(?:potwierd(?:zenie|ź)\s+wizyt|wizyt[aęy]|dr\s+[a-z]|lekarz|stomatolog|przychodni|znanylekarz|termin\s+wizyt|appointment\s+confirm|doctor\s+visit)/i;
const PR_REVIEW_REGEX = /(?:requested\s+your\s+review|review\s+requested|prośba\s+o\s+review|pull\s+request|pr\s*#\d+|code\s+review)/i;
const PAYMENT_REGEX = /(?:do\s+opłacenia|faktur[ayę]|invoice|opłać\b|rachun(?:ek|ku)|płatnoś(?:ć|ci)|oczekuje\s+na\s+opłacenie|termin\s+płatności|payment\s+due|zapłać)/i;
const TASK_ALERT_REGEX = /(?:nowe\s+zadanie|przypisane\s+do\s+ciebie|assigned\s+to\s+you|jira|critical|alert|incydent|action\s+required|wymaga\s+uwagi)/i;

export function parseEmailAction(thread: MailThread): SmartAction | null {
  const subject = thread.subject;
  const from = thread.from;
  const snippet = thread.snippet;
  const body = thread.body ?? '';
  const fullText = `${subject} ${from} ${snippet} ${body}`;

  const directUrl = extractUrl(body) || extractUrl(snippet) || thread.sourceUrl;

  if (APPOINTMENT_REGEX.test(fullText)) {
    const appointmentUrl = extractAppointmentUrl(body) || extractAppointmentUrl(snippet) || directUrl;
    return {
      id: `mail:${thread.id}`,
      source: 'mail',
      sourceId: thread.id,
      sourceBadge: from.replace(/<.*>/, '').trim() || 'Wizyta',
      title: subject,
      snippet: snippet || 'Wymagane potwierdzenie wizyty',
      category: 'appointment',
      priority: 'high',
      timestamp: thread.receivedAt,
      actionUrl: appointmentUrl,
      actionLabel: 'Potwierdź wizytę',
      mailThread: thread,
    };
  }

  if (PR_REVIEW_REGEX.test(fullText) || /github|gitlab/i.test(from)) {
    return {
      id: `mail:${thread.id}`,
      source: 'mail',
      sourceId: thread.id,
      sourceBadge: /github/i.test(from) ? 'GitHub' : 'PR Review',
      title: subject,
      snippet: snippet || 'Prośba o review w pull requeście',
      category: 'pr_review',
      priority: 'high',
      timestamp: thread.receivedAt,
      actionUrl: directUrl,
      actionLabel: 'Zobacz PR',
      mailThread: thread,
    };
  }

  if (PAYMENT_REGEX.test(fullText)) {
    return {
      id: `mail:${thread.id}`,
      source: 'mail',
      sourceId: thread.id,
      sourceBadge: from.replace(/<.*>/, '').trim() || 'Płatność',
      title: subject,
      snippet: snippet || 'Płatność lub faktura oczekująca na realizację',
      category: 'payment',
      priority: 'high',
      timestamp: thread.receivedAt,
      actionUrl: directUrl,
      actionLabel: 'Opłać rachunek',
      mailThread: thread,
    };
  }

  if (TASK_ALERT_REGEX.test(fullText)) {
    return {
      id: `mail:${thread.id}`,
      source: 'mail',
      sourceId: thread.id,
      sourceBadge: /jira/i.test(from) ? 'Jira' : 'Alert',
      title: subject,
      snippet: snippet || 'Wymaga uwagi lub działania',
      category: 'task_alert',
      priority: 'high',
      timestamp: thread.receivedAt,
      actionUrl: directUrl,
      actionLabel: 'Otwórz zadanie',
      mailThread: thread,
    };
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
}): SmartAction[] {
  const dismissed = options.dismissedIds instanceof Set
    ? options.dismissedIds
    : new Set(options.dismissedIds ?? []);

  const actions: SmartAction[] = [];

  if (options.threads) {
    for (const thread of options.threads) {
      const action = parseEmailAction(thread);
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
