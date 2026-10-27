import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CalendarCheck,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  GitPullRequest,
  Settings,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Source, Task } from './model';
import type { MailState } from './useMail';
import {
  getRegisteredSmartActionRules,
  isRuleEnabled,
  loadDismissedActionIds,
  loadRulesConfig,
  parseSmartActions,
  saveDismissedActionId,
  saveRulesConfig,
  type SmartAction,
  type SmartActionCategory,
  type SmartActionRule,
} from './smart-actions';

const CATEGORY_ICONS: Record<SmartActionCategory, LucideIcon> = {
  appointment: CalendarCheck,
  pr_review: GitPullRequest,
  payment: CreditCard,
  task_alert: AlertCircle,
  other: Zap,
};

export interface SmartActionRulesDialogProps {
  rules: SmartActionRule[];
  rulesConfig: Record<string, boolean>;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onClose: () => void;
}

export function SmartActionRulesDialog({
  rules,
  rulesConfig,
  onToggleRule,
  onClose,
}: SmartActionRulesDialogProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div
      className="todo-dlg-scrim sa-dialog-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="todo-dlg sa-rules-dlg"
        role="dialog"
        aria-modal="true"
        aria-label="Konfiguracja reguł Smart Actions"
        ref={root}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="todo-dlg-head sa-rules-dlg-head">
          <div className="sa-rules-dlg-title-group">
            <Settings size={18} className="sa-settings-dlg-icon" aria-hidden="true" />
            <h2>Reguły Smart Actions</h2>
          </div>
          <button
            type="button"
            className="sa-rules-close-btn"
            aria-label="Zamknij okno"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="card-intro sa-rules-intro">
          Zarządzaj aktywnymi regułami automatycznego wykrywania szybkich akcji w wiadomościach. Wyłączona reguła nie generuje powiadomień na kafelku.
        </p>

        <div className="sa-rules-list" role="list" aria-label="Zarejestrowane reguły">
          {rules.length === 0 ? (
            <p className="p2-empty">Brak zarejestrowanych reguł.</p>
          ) : (
            rules.map((rule) => {
              const enabled = isRuleEnabled(rule, rulesConfig);
              const CategoryIcon = CATEGORY_ICONS[rule.category] || Zap;

              return (
                <div
                  key={rule.id}
                  className={`sa-rule-card ${enabled ? 'is-enabled' : 'is-disabled'}`}
                  role="listitem"
                  data-rule-id={rule.id}
                >
                  <div className="sa-rule-card-header">
                    <div className="sa-rule-title-group">
                      <CategoryIcon size={16} className="sa-category-icon" aria-hidden="true" />
                      <span className="sa-rule-name">{rule.name}</span>
                    </div>
                    <label className="sa-rule-toggle" aria-label={`Przełącz regułę ${rule.name}`}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => onToggleRule(rule.id, e.target.checked)}
                      />
                      <span className={`sa-rule-toggle-badge ${enabled ? 'active' : 'inactive'}`}>
                        {enabled ? 'Aktywna' : 'Wyłączona'}
                      </span>
                    </label>
                  </div>

                  <p className="sa-rule-description">{rule.description}</p>

                  <div className="sa-rule-meta">
                    <span className="sa-rule-meta-tag">
                      Kategoria: <strong>{rule.category}</strong>
                    </span>
                    <span className="sa-rule-meta-tag">
                      Priorytet: <strong>{rule.priority}</strong>
                    </span>
                    {rule.matchCriteria.senderDomains && rule.matchCriteria.senderDomains.length > 0 && (
                      <span className="sa-rule-meta-tag">
                        Domeny: <code>{rule.matchCriteria.senderDomains.join(', ')}</code>
                      </span>
                    )}
                    {rule.matchCriteria.subjectKeywords && rule.matchCriteria.subjectKeywords.length > 0 && (
                      <span className="sa-rule-meta-tag">
                        Temat: <code>{rule.matchCriteria.subjectKeywords.join(', ')}</code>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="todo-dlg-actions sa-rules-actions">
          <span />
          <button type="button" className="save" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
  const [rulesConfig, setRulesConfig] = useState<Record<string, boolean>>(() => loadRulesConfig());
  const [showSettings, setShowSettings] = useState(false);

  const registeredRules = getRegisteredSmartActionRules();

  const actions = parseSmartActions({
    threads: mail?.threads,
    tasks: tasks?.data,
    dismissedIds,
    rules: registeredRules,
    rulesConfig,
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

  const handleToggleRule = (ruleId: string, enabled: boolean) => {
    const updated = { ...rulesConfig, [ruleId]: enabled };
    setRulesConfig(updated);
    saveRulesConfig(updated);
  };

  return (
    <>
      <section
        className={`p2-card smart-actions${wide ? ' wide' : ''}${tall ? ' tall' : ''}`}
        aria-label="Smart Actions"
      >
        <div className="p2-card-head static sa-head">
          <span className="p2-card-title sa-title-head">
            <Zap size={16} aria-hidden="true" className="sa-zap-icon" />
            <span>Smart Actions</span>
          </span>
          <div className="sa-head-actions">
            <span className="p2-meta sa-count" title="Liczba oczekujących akcji">
              {actions.length}
            </span>
            <button
              type="button"
              className="sa-settings-btn"
              aria-label="Ustawienia reguł Smart Actions"
              title="Konfiguracja reguł"
              onClick={() => setShowSettings(true)}
            >
              <Settings size={15} aria-hidden="true" />
            </button>
          </div>
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

      {showSettings && (
        <SmartActionRulesDialog
          rules={registeredRules}
          rulesConfig={rulesConfig}
          onToggleRule={handleToggleRule}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
