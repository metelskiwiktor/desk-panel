import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { OpenRouterUsageTile } from './OpenRouterUsageTile';
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
    dailyUsd: 2.5,
    weeklyUsd: 9.75,
    monthlyUsd: 21.4,
    allTimeUsd: 42.5,
    balanceUsd: 57.5,
    limitUsd: 100,
    limitRemainingUsd: 57.5,
    observedAt: 1729000000000,
  };

  it('shows the five official values with their labels', () => {
    render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);

    expect(screen.getByRole('region', { name: 'OpenRouter' })).toBeTruthy();
    expect(screen.getByText('Dzisiaj')).toBeTruthy();
    expect(screen.getByText('$2.50')).toBeTruthy();
    expect(screen.getByText('Ten tydzień')).toBeTruthy();
    expect(screen.getByText('$9.75')).toBeTruthy();
    expect(screen.getByText('Ten miesiąc')).toBeTruthy();
    expect(screen.getByText('$21.40')).toBeTruthy();
    expect(screen.getByText('Łącznie')).toBeTruthy();
    expect(screen.getByText('$42.50')).toBeTruthy();
    expect(screen.getByText('Saldo konta')).toBeTruthy();
    expect(screen.getByText('$57.50')).toBeTruthy();
  });

  it('marks the four counters as the key and the balance as the account', () => {
    render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);

    expect(screen.getByText('Koszty klucza API')).toBeTruthy();
    expect(screen.getByText('Konto')).toBeTruthy();
  });

  it('renders one limit annotation: a numeric limit with its remainder', () => {
    render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);
    expect(screen.getByText('limit $100.00, zostało $57.50')).toBeTruthy();
  });

  it('renders one limit annotation: no limit, and an em dash for an unknown remainder', () => {
    const { rerender } = render(<OpenRouterUsageTile usage={{ ...sampleUsage, limitUsd: null, limitRemainingUsd: null }} wide tall />);
    expect(screen.getByText('bez limitu')).toBeTruthy();

    rerender(<OpenRouterUsageTile usage={{ ...sampleUsage, limitUsd: 20, limitRemainingUsd: null }} wide tall />);
    expect(screen.getByText('limit $20.00, zostało —')).toBeTruthy();
  });

  it('does not render the old window metric, budget metric or per-model chart', () => {
    render(<OpenRouterUsageTile usage={sampleUsage} wide tall />);

    expect(screen.queryByText('W oknie')).toBeNull();
    expect(screen.queryByText('Budżet')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Dzienny wykres kosztu per model' })).toBeNull();
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
      expect(screen.getByText('$2.50')).toBeTruthy();
    });
    expect(screen.getByText('$42.50')).toBeTruthy();
  });

  it('shows the last answer at once when the tile mounts again and refreshes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsage }));
    render(<OpenRouterUsageTile wide tall />);
    await waitFor(() => expect(screen.getByText('$2.50')).toBeTruthy());
    cleanup();

    let answer!: (value: unknown) => void;
    const fetchAgain = vi.fn().mockReturnValue(new Promise(resolve => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchAgain);
    render(<OpenRouterUsageTile wide tall />);
    expect(screen.getByText('$2.50')).toBeTruthy();
    expect(screen.queryByText(/Ładowanie zużycia OpenRouter/i)).toBeNull();
    expect(fetchAgain).toHaveBeenCalledWith('/api/openrouter', expect.anything());
    answer({ ok: true, json: async () => ({ ...sampleUsage, dailyUsd: 3.1 }) });
    await waitFor(() => expect(screen.getByText('$3.10')).toBeTruthy());
  });

  it('clears the last answer and shows the error after a successful reading (regression)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => sampleUsage }));
    render(<OpenRouterUsageTile wide tall />);
    await waitFor(() => expect(screen.getByText('$2.50')).toBeTruthy());
    cleanup();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    render(<OpenRouterUsageTile wide tall />);
    await waitFor(() => expect(screen.getByText('Błąd połączenia z OpenRouter')).toBeTruthy());
    expect(screen.queryByText('$2.50')).toBeNull();
  });
});
