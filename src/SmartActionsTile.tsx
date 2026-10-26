import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  GitPullRequest,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Source, Task } from './model';
import type { MailState } from './useMail';
import {
  loadDismissedActionIds,
  parseSmartActions,
  saveDismissedActionId,
  type SmartAction,
  type SmartActionCategory,
} from './smart-actions';

const CATEGORY_ICONS: Record<SmartActionCategory, LucideIcon> = {
  appointment: CalendarCheck,
  pr_review: GitPullRequest,
  payment: CreditCard,
  task_alert: AlertCircle,
  other: Zap,
};

export function SmartActionsTile({
  mail,
  tasks,
  wide = false,
  tall = false,
}: {
  mail?: MailState;
  tasks?: Source<Task[]>;
  wide?: boolean;
  tall?: boolean;
}): ReactNode {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissedActionIds());

  const actions = parseSmartActions({
    threads: mail?.threads,
    tasks: tasks?.data,
    dismissedIds,
  });

  const handleDismiss = (id: string) => {
    saveDismissedActionId(id);
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const handleMarkRead = (action: SmartAction) => {
    if (action.mailThread && mail?.act) {
      void mail.act(action.mailThread, 'read');
    }
    handleDismiss(action.id);
  };

  return (
    <section
      className={`p2-card smart-actions${wide ? ' wide' : ''}${tall ? ' tall' : ''}`}
      aria-label="Smart Actions"
    >
      <div className="p2-card-head static sa-head">
        <span className="p2-card-title sa-title-head">
          <Zap size={16} aria-hidden="true" className="sa-zap-icon" />
          <span>Smart Actions</span>
        </span>
        <span className="p2-meta sa-count" title="Liczba oczekujących akcji">
          {actions.length}
        </span>
      </div>

      <div className="sa-body">
        {actions.length === 0 ? (
          <div className="sa-empty">
            <CheckCircle2 size={24} className="sa-empty-icon" aria-hidden="true" />
            <p className="p2-empty">Brak oczekujących akcji</p>
          </div>
        ) : (
          <ul className="sa-list" aria-label="Lista oczekujących akcji">
            {actions.map((action) => {
              const Icon = CATEGORY_ICONS[action.category] || Zap;
              return (
                <li
                  key={action.id}
                  className={`sa-item sa-item-${action.priority} sa-cat-${action.category}`}
                  data-action-id={action.id}
                >
                  <div className="sa-item-left">
                    <span
                      className={`sa-prio-dot prio-${action.priority}`}
                      title={`Priorytet: ${action.priority}`}
                      aria-label={`Priorytet: ${action.priority}`}
                    />
                    <Icon size={16} className="sa-category-icon" aria-hidden="true" />
                    <span className="sa-badge" title={action.sourceBadge}>
                      {action.sourceBadge}
                    </span>
                  </div>

                  <div className="sa-item-content">
                    <div className="sa-item-title-row">
                      <span className="sa-item-title" title={action.title}>
                        {action.title}
                      </span>
                    </div>
                    {(wide || tall) && action.snippet && (
                      <p className="sa-item-snippet" title={action.snippet}>
                        {action.snippet}
                      </p>
                    )}
                  </div>

                  <div className="sa-actions">
                    {action.actionUrl && (
                      <a
                        href={action.actionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sa-btn sa-btn-action"
                        title={action.actionLabel ?? 'Otwórz'}
                        aria-label={`${action.actionLabel ?? 'Otwórz'}: ${action.title}`}
                      >
                        <span className="sa-btn-label">{action.actionLabel ?? 'Otwórz'}</span>
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                    {action.mailThread && (
                      <button
                        type="button"
                        className="sa-btn sa-btn-read"
                        aria-label={`Oznacz jako przeczytane: ${action.title}`}
                        title="Oznacz jako przeczytane"
                        onClick={() => handleMarkRead(action)}
                      >
                        <Check size={14} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="sa-btn sa-btn-dismiss"
                      aria-label={`Odrzuć akcję: ${action.title}`}
                      title="Odrzuć akcję"
                      onClick={() => handleDismiss(action.id)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
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
