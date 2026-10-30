import { describe, expect, it, vi } from 'vitest';
import {
  checkState,
  createGitHubClient,
  createPrReader,
  deriveReviewStatus,
  parsePrFromGhList,
  prFromGh,
  type GhRunner,
} from './github';

describe('github helper functions', () => {
  describe('checkState', () => {
    it('maps SUCCESS, NEUTRAL, and SKIPPED to pass', () => {
      expect(checkState({ conclusion: 'SUCCESS' })).toBe('pass');
      expect(checkState({ conclusion: 'NEUTRAL' })).toBe('pass');
      expect(checkState({ conclusion: 'SKIPPED' })).toBe('pass');
    });

    it('maps failure conclusions to fail', () => {
      expect(checkState({ conclusion: 'FAILURE' })).toBe('fail');
      expect(checkState({ conclusion: 'ERROR' })).toBe('fail');
      expect(checkState({ conclusion: 'CANCELLED' })).toBe('fail');
      expect(checkState({ conclusion: 'TIMED_OUT' })).toBe('fail');
    });

    it('maps in progress and pending statuses to running', () => {
      expect(checkState({ status: 'IN_PROGRESS' })).toBe('running');
      expect(checkState({ status: 'PENDING' })).toBe('running');
      expect(checkState({ conclusion: 'PENDING' })).toBe('running');
    });

    it('defaults unknown state to pending', () => {
      expect(checkState({})).toBe('pending');
    });
  });

  describe('prFromGh', () => {
    it('parses CockpitPrView with deduplicated check runs and states', () => {
      const raw = JSON.stringify({
        number: 42,
        title: 'Fix issue',
        headRefName: 'fix-branch',
        state: 'OPEN',
        statusCheckRollup: [
          { name: 'ci/test', status: 'COMPLETED', conclusion: 'FAILURE' },
          { name: 'ci/test', status: 'COMPLETED', conclusion: 'SUCCESS' }, // Re-run takes precedence
          { name: 'ci/lint', status: 'IN_PROGRESS' },
        ],
      });

      const pr = prFromGh(raw, 'https://github.com/org/repo/pull/42');
      expect(pr).toEqual({
        number: 42,
        title: 'Fix issue',
        branch: 'fix-branch',
        url: 'https://github.com/org/repo/pull/42',
        state: 'OPEN',
        checks: [
          { name: 'ci/test', state: 'pass' },
          { name: 'ci/lint', state: 'running' },
        ],
      });
    });
  });

  describe('deriveReviewStatus', () => {
    it('identifies draft PRs', () => {
      expect(deriveReviewStatus({ isDraft: true })).toBe('DRAFT');
      expect(deriveReviewStatus({ draft: true })).toBe('DRAFT');
    });

    it('respects reviewDecision', () => {
      expect(deriveReviewStatus({ reviewDecision: 'APPROVED' })).toBe('APPROVED');
      expect(deriveReviewStatus({ reviewDecision: 'CHANGES_REQUESTED' })).toBe('CHANGES_REQUESTED');
      expect(deriveReviewStatus({ reviewDecision: 'REVIEW_REQUIRED' })).toBe('REVIEW_REQUIRED');
    });

    it('checks latestReviews when reviewDecision is not set', () => {
      expect(deriveReviewStatus({ latestReviews: [{ state: 'CHANGES_REQUESTED' }] })).toBe('CHANGES_REQUESTED');
      expect(deriveReviewStatus({ latestReviews: [{ state: 'APPROVED' }] })).toBe('APPROVED');
      expect(deriveReviewStatus({ latestReviews: [{ state: 'COMMENTED' }] })).toBe('COMMENTED');
    });

    it('detects automated Cezar review approval comment', () => {
      expect(deriveReviewStatus({
        comments: [
          { body: 'Automated review — model: google/gemini-3.8\n\nRecommendation: APPROVE\n' },
        ],
      })).toBe('APPROVED');
    });

    it('falls back to REVIEW_REQUIRED if review requests exist, or PENDING otherwise', () => {
      expect(deriveReviewStatus({ reviewRequests: [{ login: 'reviewer1' }] })).toBe('REVIEW_REQUIRED');
      expect(deriveReviewStatus({})).toBe('PENDING');
    });
  });

  describe('parsePrFromGhList', () => {
    it('parses full GitHubPullRequest object from gh json item', () => {
      const raw = {
        number: 10,
        title: 'Add feature',
        author: { login: 'octocat', avatarUrl: 'https://avatar.url' },
        url: 'https://github.com/metelskiwiktor/desk-panel/pull/10',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'APPROVED',
        labels: [{ name: 'feature' }, 'ui'],
        statusCheckRollup: [
          { name: 'build', conclusion: 'SUCCESS' },
          { name: 'test', status: 'IN_PROGRESS' },
        ],
        comments: [{ id: '1' }, { id: '2' }],
        updatedAt: '2026-10-28T10:00:00Z',
        createdAt: '2026-10-28T09:00:00Z',
      };

      const result = parsePrFromGhList(raw, 'metelskiwiktor/desk-panel');
      expect(result).toMatchObject({
        id: 'pr-10',
        number: 10,
        title: 'Add feature',
        repository: 'metelskiwiktor/desk-panel',
        author: 'octocat',
        authorAvatarUrl: 'https://avatar.url',
        url: 'https://github.com/metelskiwiktor/desk-panel/pull/10',
        status: 'OPEN',
        reviewStatus: 'APPROVED',
        labels: ['feature', 'ui'],
        commentsCount: 2,
        draft: false,
        checks: [
          { name: 'build', state: 'pass' },
          { name: 'test', state: 'running' },
        ],
      });
    });
  });
});

describe('createGitHubClient', () => {
  it('queries open PRs across configured repositories', async () => {
    const gh: GhRunner = vi.fn().mockImplementation(async (args: string[]) => {
      const repoIdx = args.indexOf('-R');
      const repo = args[repoIdx + 1];
      if (repo === 'repo1') {
        return JSON.stringify([
          {
            number: 1,
            title: 'PR 1',
            author: { login: 'user1' },
            state: 'OPEN',
            reviewDecision: 'APPROVED',
            statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
          },
        ]);
      }
      return '[]';
    });

    const client = createGitHubClient({
      repos: ['repo1', 'repo2'],
      gh,
      now: () => 1000,
    });

    const source = await client.read();
    expect(source.status).toBe('connected');
    expect(source.pullRequests).toHaveLength(1);
    expect(source.pullRequests[0].title).toBe('PR 1');
    expect(source.totalCount).toBe(1);
    expect(source.repositories).toEqual(['repo1', 'repo2']);
  });

  it('coalesces concurrent reads into a single execution', async () => {
    let callCount = 0;
    const gh: GhRunner = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 10));
      return '[]';
    });

    const client = createGitHubClient({
      repos: ['repo1'],
      gh,
      now: () => 1000,
    });

    const [res1, res2] = await Promise.all([client.read(), client.read()]);
    expect(res1).toBe(res2);
    expect(callCount).toBe(1);
  });

  it('applies 30s TTL when checks are running and 90s TTL when settled', async () => {
    let time = 1000;
    let callCount = 0;

    const gh = vi.fn<GhRunner>().mockImplementation(async () => {
      callCount++;
      return JSON.stringify([
        {
          number: 1,
          title: 'Running PR',
          state: 'OPEN',
          statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }],
        },
      ]);
    });

    const client = createGitHubClient({
      repos: ['repo1'],
      gh,
      now: () => time,
    });

    // Initial read
    await client.read();
    expect(callCount).toBe(1);

    // Call at 20s (under 30s TTL) -> should use cache
    time += 20_000;
    await client.read();
    expect(callCount).toBe(1);

    // Call at 35s (past 30s TTL for running) -> should re-fetch
    time += 15_000;
    await client.read();
    expect(callCount).toBe(2);

    // Now make it settled
    gh.mockImplementationOnce(async () => {
      callCount++;
      return JSON.stringify([
        {
          number: 1,
          title: 'Settled PR',
          state: 'OPEN',
          reviewDecision: 'APPROVED',
          statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
        },
      ]);
    });

    time += 35_000;
    await client.read();
    expect(callCount).toBe(3);

    // Settled TTL is 90s: at +60s it should still be cached
    time += 60_000;
    await client.read();
    expect(callCount).toBe(3);

    // At +95s it should expire and re-fetch
    time += 35_000;
    await client.read();
    expect(callCount).toBe(4);
  });

  it('gracefully degrades when one repo fails (fail-soft with partial results)', async () => {
    const gh: GhRunner = vi.fn().mockImplementation(async (args: string[]) => {
      const repoIdx = args.indexOf('-R');
      const repo = args[repoIdx + 1];
      if (repo === 'failing-repo') {
        throw new Error('Rate limit or network error');
      }
      return JSON.stringify([
        {
          number: 2,
          title: 'Good PR',
          state: 'OPEN',
        },
      ]);
    });

    const client = createGitHubClient({
      repos: ['failing-repo', 'working-repo'],
      gh,
    });

    const source = await client.read();
    expect(source.status).toBe('unavailable');
    expect(source.pullRequests).toHaveLength(1);
    expect(source.pullRequests[0].title).toBe('Good PR');
  });

  it('gracefully degrades to offline status when all repos fail', async () => {
    const gh: GhRunner = vi.fn().mockRejectedValue(new Error('gh not found'));

    const client = createGitHubClient({
      repos: ['repo1'],
      gh,
      now: () => 5000,
    });

    const source = await client.read();
    expect(source.status).toBe('offline');
    expect(source.pullRequests).toEqual([]);
    expect(source.totalCount).toBe(0);
  });
});

describe('createPrReader', () => {
  it('shares one cached read of a PR and asks gh again only after its TTL', async () => {
    let clock = 0;
    const gh: GhRunner = vi.fn(async () => JSON.stringify({ number: 41, title: 'Paski', state: 'OPEN', headRefName: 'cez/x', statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] }));
    const reader = createPrReader({ gh, now: () => clock });
    const url = 'https://github.com/metelskiwiktor/desk-panel/pull/41';
    const first = await reader.read(url);
    expect(gh).toHaveBeenCalledTimes(1);
    clock = 19_000;
    await reader.read(url);
    expect(gh).toHaveBeenCalledTimes(1);
    clock = 21_000;
    await reader.read(url);
    expect(gh).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ number: 41, state: 'OPEN', checks: [{ name: 'test', state: 'running' }] });
  });
});
