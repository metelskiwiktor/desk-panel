import type { PanelSources } from './sources';
import type { GitHubPrSource } from '../src/types';

export async function fetchGitHubPrs(sources: PanelSources): Promise<GitHubPrSource> {
  if (sources.githubPr) {
    return sources.githubPr();
  }
  return {
    pullRequests: [],
    repositories: [],
    totalCount: 0,
  };
}

export function gitHubRoutes(sources: PanelSources): Record<string, () => Promise<GitHubPrSource>> {
  return {
    '/api/github/prs': () => fetchGitHubPrs(sources),
    '/api/github-prs': () => fetchGitHubPrs(sources),
    '/api/github': () => fetchGitHubPrs(sources),
  };
}

export { jsonRoutes } from './sources';
