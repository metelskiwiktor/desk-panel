import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartActionsTile } from './SmartActionsTile';
import type { MailState } from './useMail';
import type { MailThread } from './mail-contract';
import type { Source, Task } from './model';
import { loadDismissedActionIds, loadRulesConfig, ZNANY_LEKARZ_RULE } from './smart-actions';

describe('SmartActionsTile', () => {
  beforeEach(() => {
    localStorage.clear();
    cleanup();
    vi.restoreAllMocks();
  });

  const mockZnanyLekarzThread: MailThread = {
    id: 'owner@gmail.com:doc-1',
    account: 'owner@gmail.com',
    threadId: 'doc-1',
    from: 'ZnanyLekarz <kontakt@znanylekarz.pl>',
    subject: '❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?',
    snippet: 'Wizyta umówiona przez ZnanyLekarz. Potwierdź swoją obecność na wizycie.',
    body: 'Wizyta dla Wiktor\nPotwierdź lub przełóż wizytę: https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi',
    receivedAt: Date.now() - 60000,
    messages: 1,
    sourceUrl: 'https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi',
  };

  const mockNonMatchingThread: MailThread = {
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
    const mail = createMockMail([mockZnanyLekarzThread, mockNonMatchingThread]);
    render(<SmartActionsTile mail={mail} tasks={mockTasks} wide={true} tall={true} />);

    expect(screen.getByRole('region', { name: 'Smart Actions' })).toBeTruthy();
    // 1 ZnanyLekarz action + 1 Cezar task = 2 actions (non-matching thread ignored)
    expect(screen.getByText('2')).toBeTruthy();

    expect(screen.getByText('❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?')).toBeTruthy();
    expect(screen.getByText('Migracja modeli')).toBeTruthy();

    expect(screen.getByText('ZnanyLekarz')).toBeTruthy();
    expect(screen.getByText('Cezar')).toBeTruthy();

    // In wide/tall mode, snippet is rendered
    expect(screen.getByText('Wizyta umówiona przez ZnanyLekarz. Potwierdź swoją obecność na wizycie.')).toBeTruthy();
  });

  it('allows dismissing an action and saves to localStorage', async () => {
    const user = userEvent.setup();
    const mail = createMockMail([mockZnanyLekarzThread]);
    render(<SmartActionsTile mail={mail} />);

    expect(screen.getByText('❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?')).toBeTruthy();
    const dismissBtn = screen.getByRole('button', { name: /Odrzuć akcję/i });
    await user.click(dismissBtn);

    expect(screen.queryByText('❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?')).toBeNull();
    expect(screen.getByText('Brak oczekujących akcji')).toBeTruthy();
    expect(loadDismissedActionIds().has('mail:owner@gmail.com:doc-1')).toBe(true);
  });

  it('marks email as read when clicking mark read trigger', async () => {
    const user = userEvent.setup();
    const mail = createMockMail([mockZnanyLekarzThread]);
    render(<SmartActionsTile mail={mail} />);

    const readBtn = screen.getByRole('button', { name: /Oznacz jako przeczytane/i });
    await user.click(readBtn);

    expect(mail.act).toHaveBeenCalledWith(mockZnanyLekarzThread, 'read');
    expect(screen.queryByText('❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?')).toBeNull();
    expect(loadDismissedActionIds().has('mail:owner@gmail.com:doc-1')).toBe(true);
  });

  it('renders one-click execution link trigger with direct URL', () => {
    const mail = createMockMail([mockZnanyLekarzThread]);
    render(<SmartActionsTile mail={mail} />);

    const link = screen.getByRole('link', { name: /Potwierdź wizytę/i });
    expect(link.getAttribute('href')).toBe('https://d.znanylekarz.pl/xm2m3gr5wmz1m01c0e7evblyv4v6akfi');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders empty state when there are no actions', () => {
    const mail = createMockMail([]);
    render(<SmartActionsTile mail={mail} />);

    expect(screen.getByText('Brak oczekujących akcji')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('opens and closes settings dialog using gear button', async () => {
    const user = userEvent.setup();
    const mail = createMockMail([mockZnanyLekarzThread]);
    render(<SmartActionsTile mail={mail} />);

    const settingsBtn = screen.getByRole('button', { name: /Ustawienia reguł Smart Actions/i });
    await user.click(settingsBtn);

    // Dialog is visible
    expect(screen.getByRole('dialog', { name: 'Konfiguracja reguł Smart Actions' })).toBeTruthy();
    expect(screen.getByText('Reguły Smart Actions')).toBeTruthy();
    expect(screen.getByText('ZnanyLekarz – Potwierdzenie wizyty')).toBeTruthy();
    expect(screen.getByText('Wykrywa wiadomości od ZnanyLekarz z prośbą o potwierdzenie wizyty i udostępnia szybki link akcji.')).toBeTruthy();

    // Close via close button in header
    const closeBtn = screen.getByRole('button', { name: 'Zamknij okno' });
    await user.click(closeBtn);

    expect(screen.queryByRole('dialog', { name: 'Konfiguracja reguł Smart Actions' })).toBeNull();
  });

  it('toggles rule configuration on and off and updates tile actions', async () => {
    const user = userEvent.setup();
    const mail = createMockMail([mockZnanyLekarzThread]);
    render(<SmartActionsTile mail={mail} />);

    // Initially action is shown
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?')).toBeTruthy();

    // Open settings dialog
    await user.click(screen.getByRole('button', { name: /Ustawienia reguł Smart Actions/i }));

    const toggle = screen.getByRole('checkbox', { name: /Przełącz regułę ZnanyLekarz – Potwierdzenie wizyty/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    // Toggle off
    await user.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(loadRulesConfig()[ZNANY_LEKARZ_RULE.id]).toBe(false);

    // Close dialog
    await user.click(screen.getByRole('button', { name: 'Zamknij' }));

    // Tile now shows 0 actions and empty state
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Brak oczekujących akcji')).toBeTruthy();

    // Open settings dialog again and toggle back on
    await user.click(screen.getByRole('button', { name: /Ustawienia reguł Smart Actions/i }));
    const toggleAgain = screen.getByRole('checkbox', { name: /Przełącz regułę ZnanyLekarz – Potwierdzenie wizyty/i }) as HTMLInputElement;
    await user.click(toggleAgain);
    expect(loadRulesConfig()[ZNANY_LEKARZ_RULE.id]).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Zamknij' }));

    // Action is back
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('❓ Czy pojawisz się na wizycie u mgr Artur Wierusz w dniu 28 października o 17:30?')).toBeTruthy();
  });
});
