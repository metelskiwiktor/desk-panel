import { useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, Coins } from 'lucide-react';
import type { OpenRouterDayUsage, OpenRouterUsage } from '../openrouter-contract';
import { useOpenRouterUsage } from '../useOpenRouterUsage';

export interface OpenRouterUsageTileProps {
  wide?: boolean;
  tall?: boolean;
  usage?: OpenRouterUsage;
  loading?: boolean;
  error?: string | null;
}

const MODEL_COLORS = [
  '#58a6ff', // blue
  '#bc8cff', // purple
  '#3fb950', // green
  '#f0883e', // orange
  '#f778ba', // pink
  '#56d4dd', // cyan
  '#e3b341', // yellow
  '#79c0ff', // light blue
  '#d2a8ff', // violet
  '#7ee787', // light green
];

/** Stable deterministic color assignment derived solely from the model id */
export function getModelColor(modelId: string): string {
  let hash = 5381;
  for (let i = 0; i < modelId.length; i++) {
    hash = ((hash << 5) + hash) ^ modelId.charCodeAt(i);
  }
  return MODEL_COLORS[Math.abs(hash) % MODEL_COLORS.length];
}

function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  if (amount === 0) return '$0.00';
  if (Math.abs(amount) < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

interface HoverInfo {
  type: 'day' | 'model';
  day: string;
  totalUsd: number;
  modelLabel?: string;
  modelUsd?: number;
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
  const [hovered, setHovered] = useState<HoverInfo | null>(null);

  const rawDays = data?.days ?? [];
  const visibleDays: OpenRouterDayUsage[] = useMemo(() => {
    if (!wide && rawDays.length > 10) {
      return rawDays.slice(-10);
    }
    return rawDays;
  }, [rawDays, wide]);

  const modelList = useMemo(() => {
    const ids = new Set<string>();
    const models: Array<{ id: string; label: string; totalUsd: number }> = [];

    for (const d of rawDays) {
      for (const m of d.models) {
        if (!ids.has(m.id)) {
          ids.add(m.id);
          models.push({ id: m.id, label: m.label, totalUsd: m.usd });
        } else {
          const existing = models.find(x => x.id === m.id);
          if (existing) existing.totalUsd += m.usd;
        }
      }
    }
    models.sort((a, b) => b.totalUsd - a.totalUsd);
    return models;
  }, [rawDays]);

  const maxTotal = useMemo(() => {
    const max = Math.max(...visibleDays.map(d => d.totalUsd), 0.001);
    return max;
  }, [visibleDays]);

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
        {data && (
          <span className="or-hover-preview" aria-live="polite">
            {hovered ? (
              hovered.type === 'model' ? (
                <>
                  <strong className="or-hover-model">{hovered.modelLabel}</strong>:{' '}
                  <span className="or-hover-usd">{formatUsd(hovered.modelUsd)}</span>{' '}
                  <span className="or-hover-sub">({hovered.day})</span>
                </>
              ) : (
                <>
                  <span className="or-hover-day">{hovered.day}</span>:{' '}
                  <span className="or-hover-usd">{formatUsd(hovered.totalUsd)}</span>
                </>
              )
            ) : (
              <span className="or-hover-default">Ostatnie 30 dni: {formatUsd(data.totals.windowUsd)}</span>
            )}
          </span>
        )}
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
        ) : !data || visibleDays.length === 0 ? (
          <div className="or-empty">
            <p className="p2-empty">Brak danych OpenRouter</p>
          </div>
        ) : (
          <div className="or-content">
            <div className="or-chart-wrapper">
              <div
                className="or-chart"
                role="region"
                aria-label="Dzienny wykres kosztu per model"
              >
                {visibleDays.map(day => {
                  const dayHeightPercent = (day.totalUsd / maxTotal) * 100;
                  const isHovered = hovered?.day === day.day;
                  return (
                    <div
                      key={day.day}
                      className={`or-col${isHovered ? ' active' : ''}`}
                      tabIndex={0}
                      role="group"
                      aria-label={`${day.day}: łączny koszt ${formatUsd(day.totalUsd)}`}
                      title={`${day.day}: ${formatUsd(day.totalUsd)}`}
                      onPointerEnter={() => setHovered({ type: 'day', day: day.day, totalUsd: day.totalUsd })}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered({ type: 'day', day: day.day, totalUsd: day.totalUsd })}
                      onBlur={() => setHovered(null)}
                    >
                      <div className="or-col-track">
                        <div
                          className="or-col-bar"
                          style={{
                            height: `${Math.max(day.totalUsd > 0 ? 8 : 2, dayHeightPercent)}%`,
                          }}
                        >
                          {day.models.map(m => {
                            const segHeight = day.totalUsd > 0 ? (m.usd / day.totalUsd) * 100 : 0;
                            const color = getModelColor(m.id);
                            return (
                              <div
                                key={m.id}
                                className="or-seg"
                                style={{
                                  height: `${segHeight}%`,
                                  backgroundColor: color,
                                }}
                                tabIndex={0}
                                role="img"
                                aria-label={`${m.label}: ${formatUsd(m.usd)}`}
                                title={`${m.label}: ${formatUsd(m.usd)} (${day.day})`}
                                onPointerEnter={(e) => {
                                  e.stopPropagation();
                                  setHovered({
                                    type: 'model',
                                    day: day.day,
                                    modelLabel: m.label,
                                    modelUsd: m.usd,
                                    totalUsd: day.totalUsd,
                                  });
                                }}
                                onFocus={(e) => {
                                  e.stopPropagation();
                                  setHovered({
                                    type: 'model',
                                    day: day.day,
                                    modelLabel: m.label,
                                    modelUsd: m.usd,
                                    totalUsd: day.totalUsd,
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <span className="or-col-day" aria-hidden="true">
                        {day.day.slice(8)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="or-side">
              <div className="or-metrics">
                <div className="or-metric" title="Suma wydatków w obserwowanym oknie 30 dni">
                  <span className="or-metric-label">W oknie</span>
                  <span className="or-metric-value">{formatUsd(data.totals.windowUsd)}</span>
                </div>
                <div className="or-metric" title="Łączny koszt wszystkich wywołań zarejestrowanych na koncie OpenRouter">
                  <span className="or-metric-label">Łącznie</span>
                  <span className="or-metric-value">{formatUsd(data.totals.allTimeUsd)}</span>
                </div>
                <div className="or-metric" title="Pozostały limit lub stan dostępnych środków OpenRouter">
                  <span className="or-metric-label">Budżet</span>
                  <span className="or-metric-value">{formatUsd(data.credits.remainingUsd)}</span>
                </div>
              </div>

              {modelList.length > 0 && (
                <div className="or-legend" aria-label="Legenda modeli">
                  {modelList.slice(0, wide ? 6 : 4).map(m => (
                    <div key={m.id} className="or-legend-item" title={`${m.label}: ${formatUsd(m.totalUsd)}`}>
                      <span
                        className="or-legend-dot"
                        style={{ backgroundColor: getModelColor(m.id) }}
                        aria-hidden="true"
                      />
                      <span className="or-legend-name">{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
