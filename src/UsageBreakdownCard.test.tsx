import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UsageBreakdownCard } from './UsageBreakdownCard';
import type { UsageBreakdownState } from './useUsageBreakdown';

afterEach(cleanup);
const claude = { provider: 'Claude' as const, usedPercent: 92, observedAt: Date.now(), resetAt: Date.now() + 3600000, segments: [
  { kind: 'task' as const, id: 't1', title: 'Naprawa synchronizacji', percent: 15 }, { kind: 'task' as const, id: 't2', title: 'Przegląd notatki', percent: 8, shared: true },
  { kind: 'other' as const, percent: 54 }, { kind: 'unobserved' as const, percent: 15 }] };
const gemini = { provider: 'Gemini' as const, usedPercent: null, observedAt: null, resetAt: null, segments: [] };
const usage = (over: Partial<UsageBreakdownState> = {}) => ({ status: 'connected', observedAt: Date.now(), providers: [claude, gemini], ...over }) as UsageBreakdownState;

it('splits each limit bar into Cezar tasks, other sources and usage from before the readings', () => {
  render(<UsageBreakdownCard usage={usage()} />);
  expect(screen.getByRole('heading', { name: 'Podział zużycia AI' })).toBeTruthy();
  expect(screen.getByRole('img', { name: /Claude: 92% limitu 5h\. Zadania Cezara 23, poza Cezarem 54, sprzed pomiarów 15/ })).toBeTruthy();
  expect(screen.getByText(/zadania Cezara 23 · poza Cezarem 54 · sprzed pomiarów 15/)).toBeTruthy();
  expect(screen.getByText('Przegląd notatki (równolegle)')).toBeTruthy();
  expect(screen.getByText('Poza Cezarem')).toBeTruthy();
});

it('says when a provider has no current reading instead of drawing an empty bar', () => {
  render(<UsageBreakdownCard usage={usage()} />);
  expect(screen.getByText('brak aktualnego pomiaru')).toBeTruthy();
});

it('states loading, no data and offline without inventing numbers', () => {
  render(<UsageBreakdownCard usage={{ status: 'loading', observedAt: null, providers: [] }} />);
  expect(screen.getByText('Ładowanie podziału…')).toBeTruthy();
  cleanup();
  render(<UsageBreakdownCard usage={usage({ providers: [gemini] })} />);
  expect(screen.getByText('Brak aktualnych pomiarów limitów.')).toBeTruthy();
  cleanup();
  render(<UsageBreakdownCard usage={usage({ status: 'offline' })} />);
  expect(screen.getByText(/ostatnie dane/)).toBeTruthy();
});
