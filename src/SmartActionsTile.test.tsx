import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartActionsTile } from './SmartActionsTile';
import type { MailState } from './useMail';
import type { MailThread } from './mail-contract';
import type { Source, Task } from './model';
import { loadDismissedActionIds } from './smart-actions';

describe('SmartActionsTile', () => {
  beforeEach(() => {
    localStorage.clear();
    cleanup();
    vi.restoreAllMocks();
  });

  const mockMailThread: MailThread = {
    id: 'owner@gmail.com:doc-1',
    account: 'owner@gmail.com',
    threadId: 'doc-1',
    from: 'Centrum Medyczne',
    subject: 'Potwierdzenie wizyty: Dr Jan Kowalski',
    snippet: 'Prosimy o potwierdzenie wizyty w czwartek o 11:30.',
    body: 'Potwierdź: https://przychodnia.local/potwierdz/98124',
    receivedAt: Date.now() - 60000,
    messages: 1,
    sourceUrl: 'https://przychodnia.local/potwierdz/98124',
  };

  const mockMailThreadPr: MailThread = {
    id: 'praca@gmail.com:pr-2',
    account: 'praca@gmail.com',
    threadId: 'pr-2',
    from: 'GitHub',
    subject: '[desk-panel] PR #3: Gmail w panelu',
    snippet: 'metelskiwiktor requested your review on this pull request.',
    body: 'Review at https://github.com/org/repo/pull/3',
    receivedAt: Date.now() - 120000,
    messages: 2,
    sourceUrl: 'https://github.com/org/repo/pull/3',
  };

  const mockTasks: Source<Task[]> = {
    status: 'connected',
    observedAt: Date.now(),
    data: [
      {
        id: 't-1',
        title: 'Migracja modeli',
        project: 'desk-panel',
        status: 'needs-input',
        question: 'Czy zachować kompatybilność wsteczną?',
        checkedAt: Date.now(),
        description: 'Zadanie',
        sourceUrl: 'http://cezar/t-1',
      },
    ],
  };

  const createMockMail = (threads: MailThread[]): MailState => ({
    source: {
      live: true,
      name: 'Gmail',
      status: 'connected',
      observedAt: Date.now(),
      data: threads,
      accounts: [],
      total: threads.length,
    },
    threads,
    hasMore: false,
    loadMore: vi.fn(),
    act: vi.fn().mockResolvedValue(undefined),
    undo: null,
    restore: vi.fn(),
    error: '',
  });

  it('renders pending actions with count, source badges, and priority indicators', () => {
    const mail = createMockMail([mockMailThread, mockMailThreadPr]);
    render(<SmartActionsTile mail={mail} tasks={mockTasks} wide={true} tall={true} />);

    expect(screen.getByRole('region', { name: 'Smart Actions' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // 2 emails + 1 task

    expect(screen.getByText('Potwierdzenie wizyty: Dr Jan Kowalski')).toBeTruthy();
    expect(screen.getByText('[desk-panel] PR #3: Gmail w panelu')).toBeTruthy();
    expect(screen.getByText('Migracja modeli')).toBeTruthy();

    expect(screen.getByText('Centrum Medyczne')).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('Cezar')).toBeTruthy();

    // In wide/tall mode, snippet is rendered
    expect(screen.getByText('Prosimy o potwierdzenie wizyty w czwartek o 11:30.')).toBeTruthy();
  });

  it('allows dismissing an action and saves to localStorage', async () => {
    const user = userEvent.setup();
    const mail = createMockMail([mockMailThread]);
    render(<SmartActionsTile mail={mail} />);

    expect(screen.getByText('Potwierdzenie wizyty: Dr Jan Kowalski')).toBeTruthy();
    const dismissBtn = screen.getByRole('button', { name: /Odrzuć akcję/i });
    await user.click(dismissBtn);

    expect(screen.queryByText('Potwierdzenie wizyty: Dr Jan Kowalski')).toBeNull();
    expect(screen.getByText('Brak oczekujących akcji')).toBeTruthy();
    expect(loadDismissedActionIds().has('mail:owner@gmail.com:doc-1')).toBe(true);
  });

  it('marks email as read when clicking mark read trigger', async () => {
    const user = userEvent.setup();
    const mail = createMockMail([mockMailThread]);
    render(<SmartActionsTile mail={mail} />);

    const readBtn = screen.getByRole('button', { name: /Oznacz jako przeczytane/i });
    await user.click(readBtn);

    expect(mail.act).toHaveBeenCalledWith(mockMailThread, 'read');
    expect(screen.queryByText('Potwierdzenie wizyty: Dr Jan Kowalski')).toBeNull();
    expect(loadDismissedActionIds().has('mail:owner@gmail.com:doc-1')).toBe(true);
  });

  it('renders one-click execution link trigger with direct URL', () => {
    const mail = createMockMail([mockMailThread]);
    render(<SmartActionsTile mail={mail} />);

    const link = screen.getByRole('link', { name: /Potwierdź wizytę/i });
    expect(link.getAttribute('href')).toBe('https://przychodnia.local/potwierdz/98124');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders empty state when there are no actions', () => {
    const mail = createMockMail([]);
    render(<SmartActionsTile mail={mail} />);

    expect(screen.getByText('Brak oczekujących akcji')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });
});
