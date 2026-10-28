import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileEdit,
  GitPullRequest,
  MessageSquare,
  User,
  type LucideIcon,
} from 'lucide-react';
import {
  formatReviewStatus,
  type GitHubPullRequest,
  type GitHubPrSource,
  type ReviewStatus,
} from '../types';

export interface GitHubPrTileProps {
  prs?: GitHubPullRequest[];
  wide?: boolean;
  tall?: boolean;
  loading?: boolean;
}

const REVIEW_ICONS: Record<ReviewStatus, LucideIcon> = {
  APPROVED: CheckCircle2,
  CHANGES_REQUESTED: AlertCircle,
  REVIEW_REQUIRED: Clock,
  PENDING: Clock,
  DRAFT: FileEdit,
  COMMENTED: MessageSquare,
};

export function GitHubPrTile({
  prs: initialPrs,
  wide = false,
  tall = false,
  loading: initialLoading = false,
}: GitHubPrTileProps): ReactNode {
  const [prs, setPrs] = useState<GitHubPullRequest[]>(initialPrs ?? []);
  const [loading, setLoading] = useState<boolean>(!initialPrs && initialLoading);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrs) {
      setPrs(initialPrs);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    fetch('/api/github/prs')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GitHubPrSource | GitHubPullRequest[]>;
      })
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data)) {
          setPrs(data);
        } else if (data && Array.isArray(data.pullRequests)) {
          setPrs(data.pullRequests);
        } else if (data && typeof data === 'object' && 'data' in data && data.data && Array.isArray((data.data as any).pullRequests)) {
          setPrs((data.data as any).pullRequests);
        } else {
          setPrs([]);
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Błąd pobierania');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialPrs]);

  return (
    <section
      className={`p2-card gh-pr-tile${wide ? ' wide' : ''}${tall ? ' tall' : ''}`}
      aria-label="GitHub PR"
    >
      <div className="p2-card-head static gh-pr-head">
        <span className="p2-card-title gh-pr-title-head">
          <GitPullRequest size={16} aria-hidden="true" className="gh-pr-icon" />
          <span>GitHub PR</span>
        </span>
        <div className="gh-pr-head-actions">
          <span className="p2-meta gh-pr-count" title="Liczba otwartych Pull Requestów">
            {prs.length}
          </span>
        </div>
      </div>

      <div className="gh-pr-body">
        {loading ? (
          <div className="gh-pr-empty">
            <p className="p2-empty">Ładowanie PR...</p>
          </div>
        ) : error ? (
          <div className="gh-pr-empty">
            <p className="p2-empty">Nie udało się pobrać PR ({error})</p>
          </div>
        ) : prs.length === 0 ? (
          <div className="gh-pr-empty">
            <CheckCircle2 size={24} className="gh-pr-empty-icon" aria-hidden="true" />
            <p className="p2-empty">Brak otwartych PR</p>
          </div>
        ) : (
          <ul className="gh-pr-list" aria-label="Otwarte Pull Requesty">
            {prs.map((pr) => {
              const statusInfo = formatReviewStatus(pr.reviewStatus);
              const StatusIcon = REVIEW_ICONS[pr.reviewStatus] || GitPullRequest;
              const repoShort = pr.repository.includes('/')
                ? pr.repository.split('/')[1]
                : pr.repository;

              return (
                <li key={pr.id ?? `${pr.repository}#${pr.number}`} className="gh-pr-item">
                  <div className="gh-pr-item-top">
                    <span className="gh-pr-repo" title={pr.repository}>
                      {repoShort}
                    </span>
                    <span className="gh-pr-number">#{pr.number}</span>
                    <span className={`gh-pr-status-badge tone-${statusInfo.tone}`} title={statusInfo.label}>
                      <StatusIcon size={12} aria-hidden="true" />
                      <span>{statusInfo.label}</span>
                    </span>
                  </div>

                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gh-pr-item-title"
                    title={pr.title}
                  >
                    <span>{pr.title}</span>
                    <ExternalLink size={12} className="gh-pr-ext-icon" aria-hidden="true" />
                  </a>

                  <div className="gh-pr-item-meta">
                    <span className="gh-pr-author" title={`Autor: ${pr.author}`}>
                      <User size={12} aria-hidden="true" />
                      <span>{pr.author}</span>
                    </span>

                    {pr.labels && pr.labels.length > 0 && (
                      <div className="gh-pr-labels">
                        {pr.labels.map((lbl) => (
                          <span key={lbl} className="gh-pr-label-chip">
                            {lbl}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
