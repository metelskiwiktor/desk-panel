export * from './zones';

/**
 * Returns whether work content is present for PR data.
 * Must be false when PR data is empty or absent, keeping zones tests green.
 */
export function hasWorkContent(prData?: { pullRequests?: unknown[] } | unknown[] | null): boolean {
  if (!prData) return false;
  if (Array.isArray(prData)) return prData.length > 0;
  if (Array.isArray(prData.pullRequests)) return prData.pullRequests.length > 0;
  return false;
}
