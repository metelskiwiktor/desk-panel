import { beforeEach, describe, expect, it } from 'vitest';
import type { MailThread } from './mail-contract';
import type { Task } from './model';
import {
  defaultRuleRegistry,
  extractAppointmentUrl,
  extractUrl,
  getRegisteredSmartActionRules,
  isRuleEnabled,
  loadDismissedActionIds,
  loadRulesConfig,
  matchThreadCriteria,
  parseEmailAction,
  parseSmartActions,
  parseTaskAction,
  saveDismissedActionId,
  saveRulesConfig,
  SmartActionRegistry,
  ZNANY_LEKARZ_RULE,
  type SmartActionRule,
} from './smart-actions';

describe('extractUrl', () => {
  it('extracts clean https URLs and strips trailing punctuation', () => {
    expect(extractUrl('Link: https://example.com/confirm?id=123.')).toBe('https://example.com/confirm?id=123');
    expect(extractUrl('Check (https://github.com/pr/42), please')).toBe('https://github.com/pr/42');
    expect(extractUrl('No link here')).toBeUndefined();
    expect(extractUrl(undefined)).toBeUndefined();
  });
});

describe('extractAppointmentUrl', () => {
  it('extracts direct confirmation links matching appointment patterns', () => {
    const text = 'Potwierdź lub przełóż wizytę: (https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi)';
    expect(extractAppointmentUrl(text)).toBe('https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi');
  });

  it('falls back to generic URL extraction if specific pattern is not found', () => {
    const text = 'Link: https://znanylekarz.pl/wizyta/123';
    expect(extractAppointmentUrl(text)).toBe('https://znanylekarz.pl/wizyta/123');
  });
});

describe('ZnanyLekarz Rule & matchThreadCriteria', () => {
  const baseThread: MailThread = {
    id: 'test@gmail.com:1',
    account: 'test@gmail.com',
    threadId: '1',
    from: 'Anna Nowak',
    subject: 'Spotkanie',
    snippet: 'Cześć',
    receivedAt: 1700000000000,
    messages: 1,
    sourceUrl: 'https://mail.google.com/1',
  };

  it('matches ZnanyLekarz sender and extracts confirmation link', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'ZnanyLekarz <kontakt@znanylekarz.pl>',
      subject: '❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?',
      snippet: 'Wizyta umówiona przez ZnanyLekarz. Potwierdź swoją obecność na wizycie.',
      body: 'Wizyta dla Wiktor\nśroda 28 października 2026\n17:30\n\nPotwierdź lub przełóż wizytę: https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi\n\nkontakt@znanylekarz.pl',
      sourceUrl: 'https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi',
    };

    expect(matchThreadCriteria(thread, ZNANY_LEKARZ_RULE.matchCriteria)).toBe(true);

    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('appointment');
    expect(action?.priority).toBe('high');
    expect(action?.actionLabel).toBe('Potwierdź wizytę');
    expect(action?.actionUrl).toBe('https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi');
    expect(action?.sourceBadge).toBe('ZnanyLekarz');
  });

  it('matches doctor sender when email body originates from znanylekarz.pl', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'mgr Artur Wierusz',
      subject: '❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?',
      snippet: 'Wizyta umówiona przez ZnanyLekarz Platforma dla lekarzy i pacjentów Potwierdź swoją obecność na wizycie',
      body: 'Wizyta dla Wiktor\nśroda 28 października 2026\n17:30 (GMT+1)\nFabryczna 15, Leszno\n\nPotwierdź lub przełóż (https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi)\n\nkontakt@znanylekarz.pl',
      sourceUrl: 'https://mail.google.com/mail/u/metelski.wiktor%40gmail.com/#inbox/1a1790d1e9092fca',
    };

    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('appointment');
    expect(action?.actionLabel).toBe('Potwierdź wizytę');
    expect(action?.actionUrl).toBe('https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi');
    expect(action?.sourceBadge).toBe('ZnanyLekarz');
  });

  it('returns null for non-ZnanyLekarz emails when only ZnanyLekarz rule is enabled', () => {
    const genericThread: MailThread = {
      ...baseThread,
      from: 'Centrum Medyczne <kontakt@med.local>',
      subject: 'Potwierdzenie wizyty: Dr Jan Kowalski',
      snippet: 'Prosimy o potwierdzenie terminu wizyty w czwartek o 11:30.',
      body: 'Kliknij aby potwierdzić: https://przychodnia.local/potwierdz/98124.',
    };

    const normalThread: MailThread = {
      ...baseThread,
      from: 'Znajomy',
      subject: 'Weekendowe plany',
      snippet: 'Hej, czy idziemy w sobotę na kawę?',
    };

    expect(parseEmailAction(genericThread)).toBeNull();
    expect(parseEmailAction(normalThread)).toBeNull();
  });
});

describe('SmartActionRegistry & Extensibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('allows registering and unregistering custom rules cleanly', () => {
    const customRule: SmartActionRule = {
      id: 'custom-pr-rule',
      name: 'GitHub PR Review',
      description: 'Wykrywa review w pull requestach',
      category: 'pr_review',
      priority: 'high',
      enabled: true,
      matchCriteria: {
        senderDomains: ['github.com'],
        subjectKeywords: ['pr #', 'pull request'],
      },
      extract: (thread) => ({
        id: `mail:${thread.id}`,
        source: 'mail',
        sourceId: thread.id,
        sourceBadge: 'GitHub',
        title: thread.subject,
        snippet: thread.snippet,
        category: 'pr_review',
        priority: 'high',
        timestamp: thread.receivedAt,
        actionUrl: thread.sourceUrl,
        actionLabel: 'Zobacz PR',
        mailThread: thread,
      }),
    };

    const thread: MailThread = {
      id: 'gh-1',
      account: 'test@gmail.com',
      threadId: 'gh-1',
      from: 'GitHub <notifications@github.com>',
      subject: '[desk-panel] PR #3: Smart Actions',
      snippet: 'Review requested',
      receivedAt: 1700000000000,
      messages: 1,
      sourceUrl: 'https://github.com/org/repo/pull/3',
    };

    // Before registering custom rule, it does not match
    expect(parseEmailAction(thread)).toBeNull();

    // Register custom rule
    defaultRuleRegistry.register(customRule);
    expect(getRegisteredSmartActionRules().some((r) => r.id === 'custom-pr-rule')).toBe(true);

    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('pr_review');
    expect(action?.actionLabel).toBe('Zobacz PR');

    // Clean up
    defaultRuleRegistry.unregister('custom-pr-rule');
    expect(getRegisteredSmartActionRules().some((r) => r.id === 'custom-pr-rule')).toBe(false);
    expect(parseEmailAction(thread)).toBeNull();
  });

  it('respects rule enabled/disabled state and rulesConfig', () => {
    const registry = new SmartActionRegistry([ZNANY_LEKARZ_RULE]);
    expect(isRuleEnabled(ZNANY_LEKARZ_RULE, { [ZNANY_LEKARZ_RULE.id]: false })).toBe(false);
    expect(isRuleEnabled(ZNANY_LEKARZ_RULE, { [ZNANY_LEKARZ_RULE.id]: true })).toBe(true);

    saveRulesConfig({ [ZNANY_LEKARZ_RULE.id]: false });
    expect(loadRulesConfig()).toEqual({ [ZNANY_LEKARZ_RULE.id]: false });

    const thread: MailThread = {
      id: 'doc-1',
      account: 'test@gmail.com',
      threadId: 'doc-1',
      from: 'ZnanyLekarz <kontakt@znanylekarz.pl>',
      subject: '❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?',
      snippet: 'Wizyta umówiona przez ZnanyLekarz. Potwierdź swoją obecność.',
      body: 'Wizyta: https://d.znanylekarz.pl/test',
      receivedAt: 1700000000000,
      messages: 1,
      sourceUrl: 'https://d.znanylekarz.pl/test',
    };

    // When rule is disabled in config, parseEmailAction returns null
    expect(parseEmailAction(thread, registry.getRules(), { [ZNANY_LEKARZ_RULE.id]: false })).toBeNull();
  });
});

describe('parseTaskAction', () => {
  const baseTask: Task = {
    id: 'task-1',
    title: 'Migracja bazy danych',
    project: 'DeskPanel',
    status: 'running',
    checkedAt: 1700000000000,
    description: 'Opis zadania',
    sourceUrl: 'http://cezar/tasks/task-1',
  };

  it('creates action for task needing input', () => {
    const task: Task = {
      ...baseTask,
      status: 'needs-input',
      question: 'Czy zastosować indeks na kolumnie email?',
    };
    const action = parseTaskAction(task);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('task_alert');
    expect(action?.priority).toBe('high');
    expect(action?.actionLabel).toBe('Odpowiedz');
    expect(action?.snippet).toBe('Czy zastosować indeks na kolumnie email?');
  });

  it('creates action for task in review', () => {
    const task: Task = {
      ...baseTask,
      status: 'review',
    };
    const action = parseTaskAction(task);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('task_alert');
    expect(action?.priority).toBe('medium');
    expect(action?.actionLabel).toBe('Przejrzyj');
  });

  it('ignores running or done tasks', () => {
    expect(parseTaskAction({ ...baseTask, status: 'running' })).toBeNull();
    expect(parseTaskAction({ ...baseTask, status: 'done' })).toBeNull();
  });
});

describe('parseSmartActions and dismissed storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('aggregates, sorts by priority and timestamp, and filters dismissed actions', () => {
    const threads: MailThread[] = [
      {
        id: 'mail-1',
        account: 'a@b.c',
        threadId: 't1',
        from: 'ZnanyLekarz <kontakt@znanylekarz.pl>',
        subject: 'Wizyta kontrolna',
        snippet: 'Potwierdź obecność',
        body: 'Wizyta u lekarza: https://d.znanylekarz.pl/w1',
        receivedAt: 2000,
        messages: 1,
        sourceUrl: 'https://d.znanylekarz.pl/w1',
      },
    ];

    const tasks: Task[] = [
      {
        id: 'cezar-1',
        title: 'Cezar review',
        project: 'Project',
        status: 'review',
        checkedAt: 3000,
        description: 'Review',
        sourceUrl: 'http://cezar/1',
      },
    ];

    const all = parseSmartActions({ threads, tasks });
    expect(all).toHaveLength(2);
    // mail-1 has high priority, cezar-1 has medium priority
    expect(all[0].id).toBe('mail:mail-1');
    expect(all[1].id).toBe('cezar:cezar-1');

    // Test dismissal
    saveDismissedActionId('mail:mail-1');
    expect(loadDismissedActionIds().has('mail:mail-1')).toBe(true);

    const filtered = parseSmartActions({ threads, tasks, dismissedIds: loadDismissedActionIds() });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('cezar:cezar-1');

    localStorage.clear();
    expect(loadDismissedActionIds().size).toBe(0);
  });
});
