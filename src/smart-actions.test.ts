import { beforeEach, describe, expect, it } from 'vitest';
import type { MailThread } from './mail-contract';
import type { Task } from './model';
import {
  clearDismissedActionIds,
  extractUrl,
  loadDismissedActionIds,
  parseEmailAction,
  parseSmartActions,
  parseTaskAction,
  saveDismissedActionId,
} from './smart-actions';

describe('extractUrl', () => {
  it('extracts clean https URLs and strips trailing punctuation', () => {
    expect(extractUrl('Link: https://example.com/confirm?id=123.')).toBe('https://example.com/confirm?id=123');
    expect(extractUrl('Check (https://github.com/pr/42), please')).toBe('https://github.com/pr/42');
    expect(extractUrl('No link here')).toBeUndefined();
    expect(extractUrl(undefined)).toBeUndefined();
  });
});

describe('parseEmailAction', () => {
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

  it('detects appointment confirmations and extracts direct link', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'Centrum Medyczne <kontakt@med.local>',
      subject: 'Potwierdzenie wizyty: Dr Jan Kowalski',
      snippet: 'Prosimy o potwierdzenie terminu wizyty w czwartek o 11:30.',
      body: 'Kliknij aby potwierdzić: https://przychodnia.local/potwierdz/98124.',
    };
    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('appointment');
    expect(action?.priority).toBe('high');
    expect(action?.actionLabel).toBe('Potwierdź wizytę');
    expect(action?.actionUrl).toBe('https://przychodnia.local/potwierdz/98124');
    expect(action?.sourceBadge).toContain('Centrum Medyczne');
  });

  it('detects PR review requests', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'GitHub <notifications@github.com>',
      subject: '[desk-panel] PR #3: Gmail w panelu',
      snippet: 'metelskiwiktor requested your review on this pull request.',
      body: 'Review: https://github.com/org/repo/pull/3',
    };
    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('pr_review');
    expect(action?.priority).toBe('high');
    expect(action?.actionLabel).toBe('Zobacz PR');
    expect(action?.actionUrl).toBe('https://github.com/org/repo/pull/3');
    expect(action?.sourceBadge).toBe('GitHub');
  });

  it('detects payment notifications and invoices to pay', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'Bank Millennium',
      subject: 'Faktura do opłacenia: F/2026/10/8812',
      snippet: 'Nowa faktura na kwotę 120,00 zł oczekuje na opłacenie do 30.10.2026.',
      body: 'Opłać online: https://bank.local/pay/8812',
    };
    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('payment');
    expect(action?.priority).toBe('high');
    expect(action?.actionLabel).toBe('Opłać rachunek');
    expect(action?.actionUrl).toBe('https://bank.local/pay/8812');
  });

  it('detects task alerts and Jira assignment notifications', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'Jira Notifications',
      subject: 'Nowe zadanie przypisane do Ciebie: DESK-42',
      snippet: 'DESK-42 Przegląd układu na ekranie pionowym.',
      body: 'Link do zadania: https://jira.local/browse/DESK-42',
    };
    const action = parseEmailAction(thread);
    expect(action).not.toBeNull();
    expect(action?.category).toBe('task_alert');
    expect(action?.priority).toBe('high');
    expect(action?.actionLabel).toBe('Otwórz zadanie');
    expect(action?.actionUrl).toBe('https://jira.local/browse/DESK-42');
  });

  it('returns null for non-actionable emails', () => {
    const thread: MailThread = {
      ...baseThread,
      from: 'Znajomy',
      subject: 'Weekendowe plany',
      snippet: 'Hej, czy idziemy w sobotę na kawę?',
    };
    expect(parseEmailAction(thread)).toBeNull();
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
        from: 'GitHub',
        subject: 'PR review',
        snippet: 'requested your review',
        receivedAt: 1000,
        messages: 1,
        sourceUrl: 'https://mail/1',
      },
      {
        id: 'mail-2',
        account: 'a@b.c',
        threadId: 't2',
        from: 'Lekarz',
        subject: 'Potwierdzenie wizyty',
        snippet: 'potwierdź wizytę',
        receivedAt: 2000,
        messages: 1,
        sourceUrl: 'https://mail/2',
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
    expect(all).toHaveLength(3);
    // Both mail actions have 'high' priority; mail-2 (ts 2000) should be before mail-1 (ts 1000)
    // cezar-1 has 'medium' priority, so it should be last despite higher timestamp
    expect(all[0].id).toBe('mail:mail-2');
    expect(all[1].id).toBe('mail:mail-1');
    expect(all[2].id).toBe('cezar:cezar-1');

    // Test dismissal
    saveDismissedActionId('mail:mail-2');
    expect(loadDismissedActionIds().has('mail:mail-2')).toBe(true);

    const filtered = parseSmartActions({ threads, tasks, dismissedIds: loadDismissedActionIds() });
    expect(filtered).toHaveLength(2);
    expect(filtered.map(a => a.id)).toEqual(['mail:mail-1', 'cezar:cezar-1']);

    clearDismissedActionIds();
    expect(loadDismissedActionIds().size).toBe(0);
  });
});
