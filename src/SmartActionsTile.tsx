import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CalendarCheck,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  GitPullRequest,
  Landmark,
  Settings,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Source, Task } from './model';
import type { MailState } from './useMail';
import { ctx } from './chat-context';
import { loadDismissedActionIds, saveDismissedActionId, tileAlerts, type TileAlert } from './smart-actions';
import type { SmartActionsView, SmartCategory, SmartRule } from './smart-rules-contract';

const CATEGORY_ICONS: Record<SmartCategory, LucideIcon> = {
  appointment: CalendarCheck,
  pr_review: GitPullRequest,
  payment: CreditCard,
  task_alert: AlertCircle,
  other: Zap,
};
/** The alerts are read again this often, and whenever the unread mail changes. */
const REFRESH_MS = 60_000;

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || 'Nie udało się wykonać akcji.');
  return payload;
}

const pln = (amount: number, currency: string) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

/** What Wektor reads about a rule the user points at: the rule as data, as his tools show it. */
function ruleText(rule: SmartRule): string {
  return [`Reguła Smart Actions ${rule.id} (${rule.enabled ? 'włączona' : 'wyłączona'}), źródło: ${rule.source === 'mail' ? 'poczta' : 'konto'}.`, JSON.stringify(rule)].join('\n');
}
/** What Wektor reads about one alert: which rule made it and what its button does. */
function alertText(a: TileAlert): string {
  return [
    `Alert Smart Actions ${a.id}${a.ruleId ? ` z reguły ${a.ruleId}` : ''} (${a.badge}): ${a.title}`,
    a.snippet && `Początek: ${a.snippet.slice(0, 300)}`,
    a.mail && `Mail: ${a.mail.account}:${a.mail.threadId}`,
    a.url && `Przycisk „${a.label}” → ${hostOf(a.url)}`,
    a.noLink && `Bez przycisku: ${a.noLink}`,
    a.bank && `Operacja ${a.bank.tx}: ${pln(a.bank.amount, a.bank.currency)}; podpowiedzi: ${a.bank.options.map(o => `${o.label}${o.sure ? ' (pewna)' : ''}`).join(' | ')}`,
  ].filter(Boolean).join('\n');
}

export interface SmartActionRulesDialogProps {
  rules: SmartRule[];
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onClose: () => void;
}

export function SmartActionRulesDialog({ rules, onToggleRule, onClose }: SmartActionRulesDialogProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus(); }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  };

  return createPortal(
    <div className="todo-dlg-scrim sa-dialog-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="todo-dlg sa-rules-dlg" role="dialog" aria-modal="true" aria-label="Konfiguracja reguł Smart Actions" ref={root} tabIndex={-1} onKeyDown={handleKeyDown}>
        <div className="todo-dlg-head sa-rules-dlg-head">
          <div className="sa-rules-dlg-title-group">
            <Settings size={18} className="sa-settings-dlg-icon" aria-hidden="true" />
            <h2>Reguły Smart Actions</h2>
          </div>
          <button type="button" className="sa-rules-close-btn" aria-label="Zamknij okno" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="card-intro sa-rules-intro">
          Włącz albo wyłącz regułę. Nową regułę albo zmianę przygotuje Wektor: wskaż mu regułę i powiedz, co poprawić.
        </p>

        <div className="sa-rules-list" role="list" aria-label="Zarejestrowane reguły">
          {rules.length === 0 ? <p className="p2-empty">Brak reguł.</p> : rules.map((rule) => {
            const CategoryIcon = rule.source === 'bank' ? Landmark : CATEGORY_ICONS[rule.category] || Zap;
            const match = rule.source === 'mail' ? rule.match : undefined;
            return (
              <div key={rule.id} className={`sa-rule-card ${rule.enabled ? 'is-enabled' : 'is-disabled'}`} role="listitem" data-rule-id={rule.id}
                {...ctx('smartRule', rule.id, `Reguła Smart Actions: ${rule.name}`, ruleText(rule))}>
                <div className="sa-rule-card-header">
                  <div className="sa-rule-title-group">
                    <CategoryIcon size={16} className="sa-category-icon" aria-hidden="true" />
                    <span className="sa-rule-name">{rule.name}</span>
                  </div>
                  <label className="sa-rule-toggle" aria-label={`Przełącz regułę ${rule.name}`}>
                    <input type="checkbox" checked={rule.enabled} onChange={(e) => onToggleRule(rule.id, e.target.checked)} />
                    <span className={`sa-rule-toggle-badge ${rule.enabled ? 'active' : 'inactive'}`}>{rule.enabled ? 'Aktywna' : 'Wyłączona'}</span>
                  </label>
                </div>
                {rule.description && <p className="sa-rule-description">{rule.description}</p>}
                <div className="sa-rule-meta">
                  <span className="sa-rule-meta-tag">Etykieta: <strong>{rule.badge}</strong></span>
                  {match?.from?.length ? <span className="sa-rule-meta-tag">Nadawca: <code>{match.from.join(', ')}</code></span> : null}
                  {match?.subject?.length ? <span className="sa-rule-meta-tag">Temat: <code>{match.subject.join(', ')}</code></span> : null}
                  {match?.subjectNot?.length ? <span className="sa-rule-meta-tag">Temat nie: <code>{match.subjectNot.join(', ')}</code></span> : null}
                  {match?.body?.length ? <span className="sa-rule-meta-tag">Treść: <code>{match.body.join(', ')}</code></span> : null}
                  {match?.bodyNot?.length ? <span className="sa-rule-meta-tag">Treść nie: <code>{match.bodyNot.join(', ')}</code></span> : null}
                  {rule.source === 'mail' && rule.button && <span className="sa-rule-meta-tag">Przycisk: <strong>{rule.button.label}</strong> → <code>{rule.button.domain}</code></span>}
                  {rule.source === 'bank' && <span className="sa-rule-meta-tag">Podpowiedź: <strong>{rule.suggestion}</strong></span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="todo-dlg-actions sa-rules-actions">
          <span />
          <button type="button" className="save" onClick={onClose}>Zamknij</button>
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
  const [view, setView] = useState<SmartActionsView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/smart-actions');
      if (!response.ok) throw new Error();
      setView(await response.json() as SmartActionsView);
      setError('');
    } catch { setError('Nie udało się odczytać Smart Actions.'); }
  }, []);
  // The unread mail as the dashboard has it now: a mail read or archived elsewhere drops its alert at once.
  const mailKey = mail?.threads?.map(t => t.id).join(',') ?? '';
  useEffect(() => { void load(); }, [load, mailKey]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const actions = tileAlerts(view?.alerts ?? [], tasks?.data, dismissedIds);

  const handleDismiss = (id: string) => {
    saveDismissedActionId(id);
    setDismissedIds((prev) => new Set(prev).add(id));
  };
  const handleMarkRead = (action: TileAlert) => {
    const thread = mail?.threads?.find(t => t.id === `${action.mail?.account}:${action.mail?.threadId}`);
    if (thread && mail?.act) void mail.act(thread, 'read');
    else if (action.mail) void post('/api/mail/action', { account: action.mail.account, threadId: action.mail.threadId, action: 'read' }).catch(() => {});
    handleDismiss(action.id);
  };
  /** The user's own mark, one of the panel's suggestions: kept on this computer, nothing goes to the bank. */
  const handleAccept = async (action: TileAlert, option: number) => {
    if (!action.bank) return;
    setBusy(action.id);
    try { await post('/api/bank/labels/action', { action: 'accept', tx: action.bank.tx, option }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się oznaczyć operacji.'); }
    finally { setBusy(null); }
  };
  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try { await post('/api/smart-rules/toggle', { id: ruleId, enabled }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się przełączyć reguły.'); }
  };

  return (
    <>
      <section className={`p2-card smart-actions${wide ? ' wide' : ''}${tall ? ' tall' : ''}`} aria-label="Smart Actions">
        <div className="p2-card-head static sa-head">
          <span className="p2-card-title sa-title-head">
            <Zap size={16} aria-hidden="true" className="sa-zap-icon" />
            <span>Smart Actions</span>
          </span>
          <div className="sa-head-actions">
            <span className="p2-meta sa-count" title="Liczba oczekujących akcji">{actions.length}</span>
            <button type="button" className="sa-settings-btn" aria-label="Ustawienia reguł Smart Actions" title="Konfiguracja reguł" onClick={() => setShowSettings(true)}>
              <Settings size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="sa-body">
          {(error || view?.problems.length) ? <p className="sa-problem" role="status">{[error, ...(view?.problems ?? [])].filter(Boolean).join(' ')}</p> : null}
          {actions.length === 0 ? (
            <div className="sa-empty">
              <CheckCircle2 size={24} className="sa-empty-icon" aria-hidden="true" />
              <p className="p2-empty">{view || error ? 'Brak oczekujących akcji' : 'Wczytuję…'}</p>
            </div>
          ) : (
            <ul className="sa-list" aria-label="Lista oczekujących akcji">
              {actions.map((action) => {
                const Icon = action.source === 'bank' ? Landmark : CATEGORY_ICONS[action.category] || Zap;
                return (
                  <li key={action.id} className={`sa-item sa-item-${action.priority} sa-cat-${action.category}`} data-action-id={action.id}
                    {...ctx('smartAction', action.id, `Alert Smart Actions: ${action.title}`, alertText(action))}>
                    <div className="sa-item-left">
                      <span className={`sa-prio-dot prio-${action.priority}`} title={`Priorytet: ${action.priority}`} aria-label={`Priorytet: ${action.priority}`} />
                      <Icon size={16} className="sa-category-icon" aria-hidden="true" />
                      <span className="sa-badge" title={action.badge}>{action.badge}</span>
                    </div>

                    <div className="sa-item-content">
                      <div className="sa-item-title-row">
                        <span className="sa-item-title" title={action.title}>
                          {action.bank && <b className="sa-amount">{pln(action.bank.amount, action.bank.currency)}</b>}{action.title}
                        </span>
                      </div>
                      {(wide || tall) && action.snippet && <p className="sa-item-snippet" title={action.snippet}>{action.snippet}</p>}
                    </div>

                    <div className="sa-actions">
                      {action.url && (
                        <a href={action.url} target="_blank" rel="noopener noreferrer" className="sa-btn sa-btn-action" title={action.label ?? 'Otwórz'} aria-label={`${action.label ?? 'Otwórz'}: ${action.title}`}>
                          <span className="sa-btn-label">{action.label ?? 'Otwórz'}</span>
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      )}
                      {action.mail && (
                        <button type="button" className="sa-btn sa-btn-read" aria-label={`Oznacz jako przeczytane: ${action.title}`} title="Oznacz jako przeczytane" onClick={() => handleMarkRead(action)}>
                          <Check size={14} aria-hidden="true" />
                        </button>
                      )}
                      <button type="button" className="sa-btn sa-btn-dismiss" aria-label={`Odrzuć akcję: ${action.title}`} title="Odrzuć akcję" onClick={() => handleDismiss(action.id)}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>

                    {action.bank && (
                      <div className="sa-opts" role="group" aria-label={`Oznacz: ${action.title}`}>
                        {action.bank.options.map(o => (
                          <button key={o.index} type="button" className={`sa-opt${o.sure ? ' sure' : ''}`} disabled={busy === action.id}
                            title={o.reason ? `${o.reason}${o.sure ? '' : ' (niepewne)'}` : undefined} onClick={() => void handleAccept(action, o.index)}>
                            {o.sure && <Check size={12} aria-hidden="true" />}{o.label}
                          </button>
                        ))}
                        {(wide || tall) && <span className="sa-opt-note">{action.bank.options[0]?.sure ? action.bank.options[0].reason : `${action.bank.options.length > 1 ? `${action.bank.options.length} możliwości, ` : ''}niepewne`}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {showSettings && <SmartActionRulesDialog rules={view?.rules ?? []} onToggleRule={(id, on) => void handleToggleRule(id, on)} onClose={() => setShowSettings(false)} />}
    </>
  );
}
