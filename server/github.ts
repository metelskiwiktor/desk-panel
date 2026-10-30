import { execFile } from 'node:child_process';
import type { CheckState, CockpitPrView } from '../src/cockpit-contract';
import type { GitHubPrCheck, GitHubPrSource, GitHubPullRequest, GitHubReviewer, ReviewStatus } from '../src/types';

export const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

export type GhRunner = (args: string[]) => Promise<string>;

/** `gh` without a shell, a time limit and no window. */
export const runGh: GhRunner = args => new Promise((resolve, reject) => {
  execFile('gh', args, { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

export function checkState(c: Record<string, any>): CheckState {
  const conclusion = String(c.conclusion ?? c.state ?? '').toUpperCase();
  const status = String(c.status ?? '').toUpperCase();
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) return 'pass';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)) return 'fail';
  if (['IN_PROGRESS', 'PENDING'].includes(status) || conclusion === 'PENDING') return 'running';
  return 'pending';
}

export function prFromGh(json: string, url: string): CockpitPrView {
  const pr = JSON.parse(json) as Record<string, any>;
  const rollup: Record<string, any>[] = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  // A check re-run appears twice: the last one counts.
  const checks = new Map<string, CheckState>();
  for (const c of rollup) checks.set(String(c.name || c.context || 'check').slice(0, 60), checkState(c));
  const state = String(pr.state ?? '').toUpperCase();
  return {
    number: Number(pr.number) || Number(url.split('/').at(-1)),
    title: String(pr.title ?? '').slice(0, 200),
    branch: String(pr.headRefName ?? ''),
    url,
    state: state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : 'UNKNOWN',
    checks: [...checks].slice(0, 20).map(([name, s]) => ({ name, state: s })),
  };
}

/** Kept as long as a check runs, longer once all are settled: GitHub is asked gently (30–90 s, as the tile). */
const PR_TTL_MS = 30_000, PR_SETTLED_TTL_MS = 90_000;

/** One cached read of a single PR: the cockpit beside the chat and the PR observers share it, so neither calls `gh` per read. */
export interface PrReader {
  /** `fallback` fills the card when GitHub cannot be read (the Cezar task's own title and branch). */
  read(url: string, fallback?: { title?: string; branch?: string }): Promise<CockpitPrView>;
}

export function createPrReader({ gh = runGh, now = Date.now }: { gh?: GhRunner; now?: () => number } = {}): PrReader {
  const prs = new Map<string, { at: number; value: CockpitPrView; settled: boolean }>();
  const inflight = new Map<string, Promise<CockpitPrView>>();
  return {
    async read(url, fallback = {}) {
      const known = prs.get(url);
      if (known && now() - known.at < (known.settled ? PR_SETTLED_TTL_MS : PR_TTL_MS)) return known.value;
      // A read already running answers this one too: the cockpit and the observers never ask gh twice for one PR.
      const running = inflight.get(url);
      if (running) return running;
      const request = (async (): Promise<CockpitPrView> => {
        try {
          const value = prFromGh(await gh(['pr', 'view', url, '--json', 'number,title,state,headRefName,statusCheckRollup']), url);
          prs.set(url, { at: now(), value, settled: value.state !== 'OPEN' || value.checks.every(c => c.state === 'pass' || c.state === 'fail') });
          return value;
        } catch {
          const value: CockpitPrView = {
            number: Number(url.split('/').at(-1)), title: fallback.title ?? '', branch: fallback.branch ?? '', url, state: known?.value.state ?? 'UNKNOWN',
            checks: known?.value.checks ?? [], checksError: 'Checków CI nie udało się odczytać (GitHub CLI: gh).',
          };
          prs.set(url, { at: now(), value, settled: false });
          return value;
        }
      })();
      inflight.set(url, request);
      try { return await request; } finally { inflight.delete(url); }
    },
  };
}

export const DEFAULT_GITHUB_REPOS: readonly string[] = [
  'metelskiwiktor/desk-panel',
  'metelskiwiktor/cezar-adapter',
  'metelskiwiktor/cezar',
  'metelskiwiktor/tabnote',
];

export function deriveReviewStatus(raw: Record<string, any>): ReviewStatus {
  if (raw.isDraft || raw.draft) return 'DRAFT';
  const decision = String(raw.reviewDecision ?? '').toUpperCase();
  if (decision === 'APPROVED') return 'APPROVED';
  if (decision === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  if (decision === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';

  const reviews: Record<string, any>[] = Array.isArray(raw.latestReviews) && raw.latestReviews.length > 0
    ? raw.latestReviews
    : (Array.isArray(raw.reviews) ? raw.reviews : []);

  if (reviews.some(r => String(r.state ?? '').toUpperCase() === 'CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED';
  }
  if (reviews.some(r => String(r.state ?? '').toUpperCase() === 'APPROVED')) {
    return 'APPROVED';
  }

  // Cezar or automated reviewer comment check
  if (Array.isArray(raw.comments)) {
    const hasApprovalComment = raw.comments.some(c =>
      typeof c?.body === 'string' && /Recommendation:\s*APPROVE\b/i.test(c.body)
    );
    if (hasApprovalComment) return 'APPROVED';
  }

  if (reviews.some(r => String(r.state ?? '').toUpperCase() === 'COMMENTED')) {
    return 'COMMENTED';
  }

  if (Array.isArray(raw.reviewRequests) && raw.reviewRequests.length > 0) {
    return 'REVIEW_REQUIRED';
  }

  return 'PENDING';
}

export function parsePrFromGhList(raw: Record<string, any>, repo: string): GitHubPullRequest {
  const number = Number(raw.number);
  const id = raw.id ? String(raw.id) : `pr-${number}`;
  const title = String(raw.title ?? '').slice(0, 300);
  const url = String(raw.url ?? `https://github.com/${repo}/pull/${number}`);
  const author = raw.author?.login || raw.author?.name || (typeof raw.author === 'string' ? raw.author : 'unknown');
  const authorAvatarUrl = raw.author?.avatarUrl || undefined;

  const rawState = String(raw.state ?? '').toUpperCase();
  const status: 'OPEN' | 'CLOSED' | 'MERGED' = rawState === 'MERGED' ? 'MERGED' : (rawState === 'CLOSED' ? 'CLOSED' : 'OPEN');

  const reviewStatus = deriveReviewStatus(raw);

  const rollup: Record<string, any>[] = Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : [];
  const checksMap = new Map<string, CheckState>();
  for (const c of rollup) {
    const name = String(c.name || c.context || 'check').slice(0, 60);
    checksMap.set(name, checkState(c));
  }
  const checks: GitHubPrCheck[] = [...checksMap].slice(0, 20).map(([name, state]) => ({ name, state }));

  const labels: string[] = Array.isArray(raw.labels)
    ? raw.labels.map((l: any) => typeof l === 'string' ? l : String(l?.name ?? '')).filter(Boolean)
    : [];

  const reviewers: GitHubReviewer[] = [];
  if (Array.isArray(raw.reviewRequests)) {
    for (const req of raw.reviewRequests) {
      const name = req?.login || req?.name || (typeof req === 'string' ? req : '');
      if (name) reviewers.push({ name, status: 'PENDING' });
    }
  }
  if (Array.isArray(raw.latestReviews)) {
    for (const rev of raw.latestReviews) {
      const name = rev?.author?.login || rev?.author?.name || '';
      const revState = String(rev?.state ?? '').toUpperCase();
      const revStatus: ReviewStatus = revState === 'APPROVED' ? 'APPROVED'
        : revState === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED'
        : revState === 'COMMENTED' ? 'COMMENTED'
        : 'PENDING';
      if (name && !reviewers.some(r => r.name === name)) {
        reviewers.push({ name, status: revStatus });
      }
    }
  }

  const commentsCount = Array.isArray(raw.comments)
    ? raw.comments.length
    : (typeof raw.commentsCount === 'number' ? raw.commentsCount : 0);

  return {
    id,
    number,
    title,
    repository: repo,
    author,
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    url,
    status,
    reviewStatus,
    ...(reviewers.length > 0 ? { reviewers } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
    ...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
    commentsCount,
    draft: Boolean(raw.isDraft || raw.draft),
    ...(checks.length > 0 ? { checks } : {}),
  };
}

export const GH_PR_LIST_FIELDS = 'number,title,state,isDraft,reviewDecision,reviewRequests,latestReviews,statusCheckRollup,url,headRefName,author,updatedAt,createdAt,labels,comments';

export async function fetchRepoOpenPrs(repo: string, gh: GhRunner = runGh): Promise<GitHubPullRequest[]> {
  const output = await gh(['pr', 'list', '-R', repo, '--state', 'open', '--json', GH_PR_LIST_FIELDS]);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => parsePrFromGhList(item, repo));
}

export interface GitHubClientOptions {
  repos?: readonly string[];
  gh?: GhRunner;
  now?: () => number;
}

export interface GitHubClient {
  read(): Promise<GitHubPrSource>;
  cached(): GitHubPrSource | undefined;
  invalidate(): void;
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const repos = options.repos && options.repos.length > 0 ? options.repos : DEFAULT_GITHUB_REPOS;
  const gh = options.gh ?? runGh;
  const now = options.now ?? Date.now;

  const RUNNING_TTL_MS = 30_000;
  const SETTLED_TTL_MS = 90_000;

  let cachedValue: GitHubPrSource | undefined;
  let cachedAt = 0;
  let isSettled = false;
  let pending: Promise<GitHubPrSource> | undefined;

  async function fetchAll(): Promise<GitHubPrSource> {
    const results = await Promise.allSettled(repos.map(r => fetchRepoOpenPrs(r, gh)));

    const allPrs: GitHubPullRequest[] = [];
    let successCount = 0;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === 'fulfilled') {
        allPrs.push(...res.value);
        successCount++;
      }
    }

    const timestamp = now();

    if (successCount === 0 && repos.length > 0) {
      if (cachedValue) {
        return {
          ...cachedValue,
          status: 'offline',
        };
      }
      return {
        pullRequests: [],
        repositories: [...repos],
        totalCount: 0,
        status: 'offline',
        observedAt: timestamp,
      };
    }

    allPrs.sort((a, b) => {
      const timeA = a.updatedAt ? Date.parse(String(a.updatedAt)) : 0;
      const timeB = b.updatedAt ? Date.parse(String(b.updatedAt)) : 0;
      if (timeA && timeB && timeA !== timeB) return timeB - timeA;
      return b.number - a.number;
    });

    const hasRunningCheck = allPrs.some(pr =>
      pr.checks?.some(c => c.state === 'running' || c.state === 'pending') ||
      pr.reviewStatus === 'PENDING'
    );
    isSettled = !hasRunningCheck;

    const source: GitHubPrSource = {
      pullRequests: allPrs,
      repositories: [...repos],
      totalCount: allPrs.length,
      status: successCount < repos.length ? 'unavailable' : 'connected',
      observedAt: timestamp,
      lastUpdated: timestamp,
    };

    cachedValue = source;
    cachedAt = timestamp;
    return source;
  }

  return {
    async read() {
      const currentTime = now();
      const ttl = isSettled ? SETTLED_TTL_MS : RUNNING_TTL_MS;
      if (cachedValue && currentTime - cachedAt < ttl) {
        return cachedValue;
      }

      if (!pending) {
        pending = fetchAll().finally(() => {
          pending = undefined;
        });
      }
      return pending;
    },
    cached() {
      return cachedValue;
    },
    invalidate() {
      cachedValue = undefined;
      cachedAt = 0;
    },
  };
}
