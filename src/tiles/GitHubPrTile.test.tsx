import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { GitHubPrTile } from './GitHubPrTile';
import type { GitHubPullRequest } from '../types';

describe('GitHubPrTile', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const samplePrs: GitHubPullRequest[] = [
    {
      id: 'pr-1',
      number: 42,
      title: 'Widget GitHub PR na pulpicie',
      repository: 'desk-panel',
      author: 'wiktor',
      url: 'https://github.com/metelskiwiktor/desk-panel/pull/42',
      reviewStatus: 'APPROVED',
      labels: ['ui', 'feature'],
    },
    {
      id: 'pr-2',
      number: 108,
      title: 'Czyszczenie worktree w Cezarze',
      repository: 'open-mercato/cezar',
      author: 'johndoe',
      url: 'https://github.com/open-mercato/cezar/pull/108',
      reviewStatus: 'CHANGES_REQUESTED',
      labels: ['git'],
    },
  ];

  it('renders provided pull requests with title, repo, author, and status badge', () => {
    render(<GitHubPrTile prs={samplePrs} wide tall />);

    expect(screen.getByRole('region', { name: 'GitHub PR' })).toBeTruthy();
    expect(screen.getByText('desk-panel')).toBeTruthy();
    expect(screen.getByText('cezar')).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('#108')).toBeTruthy();
    expect(screen.getByText('Widget GitHub PR na pulpicie')).toBeTruthy();
    expect(screen.getByText('Czyszczenie worktree w Cezarze')).toBeTruthy();
    expect(screen.getByText('wiktor')).toBeTruthy();
    expect(screen.getByText('johndoe')).toBeTruthy();
    expect(screen.getByText('Zatwierdzony')).toBeTruthy();
    expect(screen.getByText('Wymaga zmian')).toBeTruthy();
    expect(screen.getByText('ui')).toBeTruthy();
    expect(screen.getByText('feature')).toBeTruthy();

    const link = screen.getByRole('link', { name: /Widget GitHub PR na pulpicie/i });
    expect(link.getAttribute('href')).toBe('https://github.com/metelskiwiktor/desk-panel/pull/42');
  });

  it('renders empty state when PR list is empty', () => {
    render(<GitHubPrTile prs={[]} />);
    expect(screen.getByText('Brak otwartych PR')).toBeTruthy();
  });

  it('fetches PRs from /api/github/prs when no prs prop is provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pullRequests: [
          {
            id: 'pr-99',
            number: 99,
            title: 'Nowy PR z fetch',
            repository: 'desk-panel',
            author: 'alice',
            url: 'https://github.com/metelskiwiktor/desk-panel/pull/99',
            reviewStatus: 'REVIEW_REQUIRED',
          },
        ],
      }),
    }));

    render(<GitHubPrTile />);

    await waitFor(() => {
      expect(screen.getByText('Nowy PR z fetch')).toBeTruthy();
    });
    expect(screen.getByText('Wymaga przeglądu')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('handles fetch error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    render(<GitHubPrTile />);

    await waitFor(() => {
      expect(screen.getByText(/Nie udało się pobrać PR/i)).toBeTruthy();
    });
  });
});
