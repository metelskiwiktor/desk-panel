import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UsageBreakdownCard } from './UsageBreakdownCard';
import type { UsageBreakdownState } from './useUsageBreakdown';

afterEach(cleanup);
const claude = { provider: 'Claude' as const, usedPercent: 92, observedAt: Date.now(), resetAt: Date.now() + 3600000, segments: [
  { kind: 'task' as const, id: 't1', title: 'Naprawa synchronizacji', percent: 15 }, { kind: 'task' as const, id: 't2', title: 'Przegląd notatki', percent: 8, shared: true },
  { kind: 'session' as const, id: 'session:claude-app:desk-panel', title: 'desk-panel', origin: 'claude-app' as const, percent: 20 }, { kind: 'session' as const, id: 'session:cezar', title: 'pomocnicze', origin: 'cezar' as const, percent: 10 }, { kind: 'other' as const, percent: 24 }, { kind: 'unobserved' as const, percent: 15 }] };
const gemini = { provider: 'Gemini' as const, usedPercent: null, observedAt: null, resetAt: null, segments: [] };
const usage = (over: Partial<UsageBreakdownState> = {}) => ({ status: 'connected', observedAt: Date.now(), providers: [claude, gemini], ...over }) as UsageBreakdownState;

it('splits each limit bar into Cezar tasks, other sources and usage from before the readings', () => {
  render(<UsageBreakdownCard usage={usage()} />);
  expect(screen.getByRole('heading', { name: 'Podział zużycia AI' })).toBeTruthy();
  expect(screen.getByRole('img', { name: /Claude: 92% limitu 5h\. Zadania Cezara 23, sesje poza Cezarem 30, inne źródła 24, sprzed pomiarów 15/ })).toBeTruthy();
  expect(screen.getByText('Cezar · Naprawa synchronizacji')).toBeTruthy();
  expect(screen.getByText('Sprzed pomiarów')).toBeTruthy();
  expect(screen.getByText('Cezar · Przegląd notatki (równolegle)')).toBeTruthy();
  expect(screen.getByText('Claude (aplikacja) · desk-panel')).toBeTruthy();
  expect(screen.getByText('Cezar · pomocnicze')).toBeTruthy();
  expect(screen.getByText('Inne źródła (bez śladu w sesjach)')).toBeTruthy();
  cleanup();
  render(<UsageBreakdownCard usage={usage({ providers: [{ ...gemini, usedPercent: 5, segments: [
    { kind: 'session', id: 'session:antigravity-app:x', title: 'bez katalogu', origin: 'antigravity-app', percent: 3 },
    { kind: 'session', id: 'session:warmup', title: 'automatyczny warmup', origin: 'warmup', percent: 2 }] }] })} />);
  expect(screen.getByText('Antigravity (aplikacja) · bez katalogu')).toBeTruthy();
  expect(screen.getByText('Automatyczny warmup')).toBeTruthy();
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

it('draws the bar from the timeline, so one source can appear on both sides of another', () => {
  const timeline = [{ key: 'session:claude-app:desk-panel', percent: 20 }, { key: 't1', percent: 15 }, { key: 'session:claude-app:desk-panel', percent: 10 }];
  const provider = { ...claude, usedPercent: 45, segments: [
    { kind: 'session' as const, id: 'session:claude-app:desk-panel', title: 'desk-panel', origin: 'claude-app' as const, percent: 30 },
    { kind: 'task' as const, id: 't1', title: 'Zadanie', percent: 15 }], timeline };
  const { container } = render(<UsageBreakdownCard usage={usage({ providers: [provider] })} />);
  const widths = [...container.querySelectorAll('.breakdown-bar i')].map(i => (i as HTMLElement).style.width);
  expect(widths).toEqual(['20%', '15%', '10%']);
  const colours = [...container.querySelectorAll('.breakdown-bar i')].map(i => (i as HTMLElement).style.background);
  expect(colours[0]).toBe(colours[2]);
  expect(colours[0]).not.toBe(colours[1]);
});
