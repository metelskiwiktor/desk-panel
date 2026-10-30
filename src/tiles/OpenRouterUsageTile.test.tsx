import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MODEL_COLORS, OpenRouterUsageTile, modelColors } from './OpenRouterUsageTile';
import type { OpenRouterUsage } from '../openrouter-contract';
import { forgetOpenRouterUsage } from '../useOpenRouterUsage';

describe('OpenRouterUsageTile', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    forgetOpenRouterUsage();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const sampleUsage: OpenRouterUsage = {
    observedAt: 1729000000000,
    totals: {
      windowUsd: 14.85,
      allTimeUsd: 42.50,
    },
    credits: {
      totalUsd: 100.0,
      usedUsd: 42.5,
      remainingUsd: 57.5,
    },
    days: [
      {
        day: '2026-10-27',
        totalUsd: 2.50,
        models: [
          { id: 'anthropic/claude-3.5-sonnet', label: 'claude-3.5-sonnet', usd: 1.50 },
          { id: 'deepseek/deepseek-chat', label: 'deepseek-chat', usd: 1.00 },
        ],
      },
      {
        day: '2026-10-28',
        totalUsd: 3.20,
        models: [
          { id: 'openai/gpt-4o', label: 'gpt-4o', usd: 2.20 },
          { id: 'deepseek/deepseek-chat', label: 'deepseek-chat', usd: 1.00 },
        ],
      },
    ],
  };

  it('renders OpenRouter tile with metrics, stacked bars and legend', () => {
    render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);

    expect(screen.getByRole('region', { name: 'OpenRouter' })).toBeTruthy();
    expect(screen.getByText('W oknie')).toBeTruthy();
    expect(screen.getByText('$14.85')).toBeTruthy();
    expect(screen.getByText('Łącznie')).toBeTruthy();
    expect(screen.getByText('$42.50')).toBeTruthy();
    expect(screen.getByText('Budżet')).toBeTruthy();
    expect(screen.getByText('$57.50')).toBeTruthy();

    expect(screen.getByText('claude-3.5-sonnet')).toBeTruthy();
    expect(screen.getByText('deepseek-chat')).toBeTruthy();
    expect(screen.getByText('gpt-4o')).toBeTruthy();
  });

  it('updates preview text when hovering column or segment', () => {
    render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);

    const cols = screen.getAllByRole('group', { name: /łączny koszt/i });
    expect(cols.length).toBeGreaterThan(0);

    // Hover a column
    fireEvent.pointerEnter(cols[0]);
    expect(screen.getByText('$2.50')).toBeTruthy();

    // Hover a segment
    const segs = screen.getAllByRole('img');
    fireEvent.pointerEnter(segs[0]);
    expect(screen.getByText('$1.50')).toBeTruthy();
  });

  it('renders loading state', () => {
    render(<OpenRouterUsageTile loading />);
    expect(screen.getByText(/Ładowanie zużycia OpenRouter/i)).toBeTruthy();
  });

  it('renders Polish error state when OpenRouter is unavailable', () => {
    render(<OpenRouterUsageTile error="Brak klucza OPENROUTER_API_KEY w panel.env" />);
    expect(screen.getByText('Brak klucza OPENROUTER_API_KEY w panel.env')).toBeTruthy();
  });

  it('fetches data from /api/openrouter when usage prop is omitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleUsage,
    }));

    render(<OpenRouterUsageTile wide tall />);

    await waitFor(() => {
      expect(screen.getByText('$14.85')).toBeTruthy();
    });
    expect(screen.getByText('$42.50')).toBeTruthy();
  });

  it('shows the last answer at once when the tile mounts again (a switch of desktop) and refreshes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsage }));
    render(<OpenRouterUsageTile wide tall />);
    await waitFor(() => expect(screen.getByText('$14.85')).toBeTruthy());
    cleanup();

    // The next answer has not come yet: the tile does not fall back to "loading".
    let answer!: (value: unknown) => void;
    const fetchAgain = vi.fn().mockReturnValue(new Promise(resolve => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchAgain);
    render(<OpenRouterUsageTile wide tall />);
    expect(screen.getByText('$14.85')).toBeTruthy();
    expect(screen.queryByText(/Ładowanie zużycia OpenRouter/i)).toBeNull();
    expect(fetchAgain).toHaveBeenCalledWith('/api/openrouter', expect.anything());
    answer({ ok: true, json: async () => ({ ...sampleUsage, totals: { ...sampleUsage.totals, windowUsd: 15.1 } }) });
    await waitFor(() => expect(screen.getByText('$15.10')).toBeTruthy());
  });

  it('gives every model of the window its own colour, the same in both tile sizes', () => {
    // Eight models: a hash of the id put two of them on one colour; the palette in model order cannot.
    const ids = ['anthropic/claude', 'deepseek/flash', 'deepseek/pro', 'google/gemini', 'moonshotai/kimi', 'openai/gpt', 'qwen/max', 'z-ai/glm'];
    const colors = modelColors([{ day: '2026-10-28', totalUsd: 8, models: ids.map(id => ({ id, label: id, usd: 1 })) }]);
    expect(new Set(colors.values()).size).toBe(MODEL_COLORS.length);
    expect(colors.get('anthropic/claude')).toBe(MODEL_COLORS[0]);

    const { container: cWide } = render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);
    const segWide = cWide.querySelector('[aria-label="claude-3.5-sonnet: $1.50"]') as HTMLElement;
    expect(segWide?.style.backgroundColor).toBeTruthy();

    cleanup();

    const { container: cNarrow } = render(<OpenRouterUsageTile usage={sampleUsage} wide={false} tall={false} />);
    const segNarrow = cNarrow.querySelector('[aria-label="claude-3.5-sonnet: $1.50"]') as HTMLElement;
    expect(segNarrow?.style.backgroundColor).toBe(segWide?.style.backgroundColor);
  });
});
