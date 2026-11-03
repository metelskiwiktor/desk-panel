import type { ReactNode } from 'react';
import { AlertCircle, Coins } from 'lucide-react';
import type { OpenRouterUsage } from '../openrouter-contract';
import { useOpenRouterUsage } from '../useOpenRouterUsage';

export interface OpenRouterUsageTileProps {
  wide?: boolean;
  tall?: boolean;
  usage?: OpenRouterUsage;
  loading?: boolean;
  error?: string | null;
}

function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  if (amount === 0) return '$0.00';
  if (Math.abs(amount) < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function limitNote(usage: OpenRouterUsage): string {
  if (usage.limitUsd === null) return 'Klucz bez limitu';
  const remaining = usage.limitRemainingUsd === null ? '—' : formatUsd(usage.limitRemainingUsd);
  return `limit ${formatUsd(usage.limitUsd)}, zostało ${remaining}`;
}

interface MetricProps {
  label: string;
  value: number;
  title: string;
  className?: string;
}

function Metric({ label, value, title, className }: MetricProps): ReactNode {
  return (
    <div className={`or-metric${className ? ` ${className}` : ''}`} title={title}>
      <span className="or-metric-label">{label}</span>
      <span className="or-metric-value">{formatUsd(value)}</span>
    </div>
  );
}

interface OpenRouterUsageTileViewProps {
  wide?: boolean;
  tall?: boolean;
  data: OpenRouterUsage | null;
  loading: boolean;
  error: string | null;
}

function OpenRouterUsageTileView({
  wide = false,
  tall = false,
  data,
  loading,
  error,
}: OpenRouterUsageTileViewProps): ReactNode {
  return (
    <section
      className={`p2-card or-tile${wide ? ' wide' : ''}${tall ? ' tall' : ''}`}
      aria-label="OpenRouter"
    >
      <div className="p2-card-head static or-head">
        <span className="p2-card-title or-title-head">
          <Coins size={16} aria-hidden="true" className="or-icon" />
          <span>OpenRouter</span>
        </span>
      </div>

      <div className="or-body">
        {loading ? (
          <div className="or-empty">
            <p className="p2-empty">Ładowanie zużycia OpenRouter...</p>
          </div>
        ) : error ? (
          <div className="or-empty">
            <AlertCircle size={24} className="or-error-icon" aria-hidden="true" />
            <p className="p2-empty">{error}</p>
          </div>
        ) : !data ? (
          <div className="or-empty">
            <p className="p2-empty">Brak danych OpenRouter</p>
          </div>
        ) : (
          <div className="or-grid">
            <span className="or-scope-label">Koszty klucza API</span>
            <Metric label="Dzisiaj" value={data.dailyUsd} title="Koszt bieżącego klucza dzisiaj" />
            <Metric label="Ten tydzień" value={data.weeklyUsd} title="Koszt bieżącego klucza w tym tygodniu" />
            <Metric label="Ten miesiąc" value={data.monthlyUsd} title="Koszt bieżącego klucza w tym miesiącu" />
            <Metric label="Łącznie" value={data.allTimeUsd} title="Łączny koszt bieżącego klucza" />
            <span className="or-limit">{limitNote(data)}</span>
            <span className="or-scope-label">Konto</span>
            <Metric
              label="Saldo konta"
              value={data.balanceUsd}
              title="Saldo całego konta OpenRouter: doładowania minus wykorzystane środki"
              className="or-metric-account"
            />
          </div>
        )}
      </div>
    </section>
  );
}

function OpenRouterUsageTileConnected({ wide, tall }: { wide?: boolean; tall?: boolean }): ReactNode {
  const state = useOpenRouterUsage();
  return (
    <OpenRouterUsageTileView
      wide={wide}
      tall={tall}
      data={state.status === 'connected' ? state : null}
      loading={state.status === 'loading'}
      error={state.status === 'error' ? state.message : null}
    />
  );
}

export function OpenRouterUsageTile({
  wide = false,
  tall = false,
  usage,
  loading,
  error,
}: OpenRouterUsageTileProps): ReactNode {
  if (usage !== undefined || loading !== undefined || error !== undefined) {
    return (
      <OpenRouterUsageTileView
        wide={wide}
        tall={tall}
        data={usage ?? null}
        loading={loading ?? false}
        error={error ?? null}
      />
    );
  }
  return <OpenRouterUsageTileConnected wide={wide} tall={tall} />;
}
