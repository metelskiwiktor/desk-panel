import { z } from 'zod';

export type ReviewStatus =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_REQUIRED'
  | 'PENDING'
  | 'DRAFT'
  | 'COMMENTED';

export const reviewStatusSchema = z.enum([
  'APPROVED',
  'CHANGES_REQUESTED',
  'REVIEW_REQUIRED',
  'PENDING',
  'DRAFT',
  'COMMENTED',
]);

export interface GitHubReviewer {
  name: string;
  avatarUrl?: string;
  status?: ReviewStatus;
}

export const gitHubReviewerSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    avatarUrl: z.string().optional(),
    status: reviewStatusSchema.optional(),
  }),
]);

export interface GitHubPrCheck {
  name: string;
  state: 'pass' | 'fail' | 'running' | 'pending';
}

export const gitHubPrCheckSchema = z.object({
  name: z.string(),
  state: z.enum(['pass', 'fail', 'running', 'pending']),
});

export interface GitHubPullRequest {
  id: string | number;
  number: number;
  title: string;
  repository: string;
  author: string;
  authorAvatarUrl?: string;
  url: string;
  status?: 'OPEN' | 'CLOSED' | 'MERGED';
  reviewStatus: ReviewStatus;
  reviewers?: (string | GitHubReviewer)[];
  labels?: string[];
  updatedAt?: string | number;
  createdAt?: string | number;
  commentsCount?: number;
  draft?: boolean;
  checks?: GitHubPrCheck[];
}

export const gitHubPullRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  number: z.number().int(),
  title: z.string(),
  repository: z.string(),
  author: z.string(),
  authorAvatarUrl: z.string().optional(),
  url: z.string(),
  status: z.enum(['OPEN', 'CLOSED', 'MERGED']).optional(),
  reviewStatus: reviewStatusSchema,
  reviewers: z.array(gitHubReviewerSchema).optional(),
  labels: z.array(z.string()).optional(),
  updatedAt: z.union([z.string(), z.number()]).optional(),
  createdAt: z.union([z.string(), z.number()]).optional(),
  commentsCount: z.number().optional(),
  draft: z.boolean().optional(),
  checks: z.array(gitHubPrCheckSchema).optional(),
});

export interface GitHubPrSource {
  pullRequests: GitHubPullRequest[];
  repositories?: string[];
  totalCount?: number;
  lastUpdated?: string | number;
  status?: 'connected' | 'offline' | 'unavailable' | 'loading';
  observedAt?: number | null;
}

export const gitHubPrSourceSchema = z.object({
  pullRequests: z.array(gitHubPullRequestSchema),
  repositories: z.array(z.string()).optional(),
  totalCount: z.number().optional(),
  lastUpdated: z.union([z.string(), z.number()]).optional(),
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']).optional(),
  observedAt: z.number().finite().nullable().optional(),
});

export function formatReviewStatus(status: ReviewStatus): { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' } {
  switch (status) {
    case 'APPROVED':
      return { label: 'Zatwierdzony', tone: 'success' };
    case 'CHANGES_REQUESTED':
      return { label: 'Wymaga zmian', tone: 'danger' };
    case 'REVIEW_REQUIRED':
      return { label: 'Wymaga przeglądu', tone: 'warning' };
    case 'PENDING':
      return { label: 'W trakcie', tone: 'warning' };
    case 'DRAFT':
      return { label: 'Draft', tone: 'neutral' };
    case 'COMMENTED':
      return { label: 'Skomentowany', tone: 'neutral' };
    default:
      return { label: status, tone: 'neutral' };
  }
}
