import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { UsageBreakdownCard, breakdownPieces } from './UsageBreakdownCard';
import { splitFor } from './Dashboard';
import type { UsageBreakdownState } from './useUsageBreakdown';

afterEach(cleanup);
const claude = { provider: 'Claude' as const, usedPercent: 92, observedAt: Date.now(), resetAt: Date.now() + 3600000, segments: [
  { kind: 'task' as const, id: 't1', title: 'Naprawa synchronizacji', percent: 15 }, { kind: 'task' as const, id: 't2', title: 'Przegląd notatki', percent: 8, shared: true },
  { kind: 'session' as const, id: 'session:claude-app:desk-panel', title: 'desk-panel', origin: 'claude-app' as const, percent: 20 }, { kind: 'session' as const, id: 'session:cezar', title: 'pomocnicze', origin: 'cezar' as const, percent: 10 },
  { kind: 'other' as const, percent: 24 }, { kind: 'unobserved' as const, percent: 15 }] };
const gemini = { provider: 'Gemini' as const, usedPercent: null, observedAt: null, resetAt: null, segments: [] };
const usage = (over: Partial<UsageBreakdownState> = {}) => ({ status: 'connected', observedAt: Date.now(), providers: [claude, gemini], ...over }) as UsageBreakdownState;

it('lists sources under group headings, with Cezar tasks and helper calls together and a lone session on one line', () => {
  render(<UsageBreakdownCard usage={usage()} />);
  expect(screen.getByRole('heading', { name: 'Podział zużycia AI' })).toBeTruthy();
  const cezar = screen.getByText('Cezar').closest('li')!;
  expect(within(cezar).getByText('33 p.p.')).toBeTruthy();
  expect(within(cezar).getByText('Naprawa synchronizacji')).toBeTruthy();
  expect(within(cezar).getByText('Przegląd notatki (równolegle)')).toBeTruthy();
  expect(within(cezar).getByText('pomocnicze')).toBeTruthy();
  expect(screen.getByText('Claude (aplikacja) · desk-panel')).toBeTruthy();
  expect(screen.getByText('Inne źródła (bez śladu w sesjach)')).toBeTruthy();
  expect(screen.getByText('Sprzed pomiarów')).toBeTruthy();
});

it('puts the window and the time of the last reading on the day', () => {
  const start = new Date(2026, 9, 17, 10, 10).getTime(), observed = new Date(2026, 9, 17, 12, 28).getTime();
  render(<UsageBreakdownCard usage={usage({ observedAt: observed, providers: [{ ...claude, resetAt: start + 5 * 3600000 }, gemini] })} />);
  expect(screen.getByText('okno 10:10–15:10 · 92% zużyte')).toBeTruthy();
  expect(screen.getByText('bieżące okno 5h · pomiar 12:28')).toBeTruthy();
});

it('says when a provider has no current reading instead of drawing an empty bar', () => {
  render(<UsageBreakdownCard usage={usage()} />);
  expect(screen.getByText('brak aktualnego pomiaru')).toBeTruthy();
});

it('states loading, no data and offline without inventing numbers, and names Antigravity and warmup sources', () => {
  render(<UsageBreakdownCard usage={{ status: 'loading', observedAt: null, providers: [] }} />);
  expect(screen.getByText('Ładowanie podziału…')).toBeTruthy();
  cleanup();
  render(<UsageBreakdownCard usage={usage({ providers: [gemini] })} />);
  expect(screen.getByText('Brak aktualnych pomiarów limitów.')).toBeTruthy();
  cleanup();
  render(<UsageBreakdownCard usage={usage({ status: 'offline' })} />);
  expect(screen.getByText(/ostatnie dane/)).toBeTruthy();
  cleanup();
  render(<UsageBreakdownCard usage={usage({ providers: [{ ...gemini, usedPercent: 5, segments: [
    { kind: 'session', id: 'session:antigravity-app:x', title: 'bez katalogu', origin: 'antigravity-app', percent: 3 },
    { kind: 'session', id: 'session:warmup', title: 'automatyczny warmup', origin: 'warmup', percent: 2 }] }] })} />);
  expect(screen.getByText('Antigravity (aplikacja) · bez katalogu')).toBeTruthy();
  expect(screen.getByText('Automatyczny warmup')).toBeTruthy();
});

it('builds the quota bar parts from the timeline in the source colour, so one source can appear on both sides of another and tiny parts stay in', () => {
  const timeline = [{ key: 'session:claude-app:desk-panel', percent: 20 }, { key: 't1', percent: 0.1 }, { key: 'session:claude-app:desk-panel', percent: 10 }];
  const parts = breakdownPieces({ ...claude, usedPercent: 30.1, segments: [
    { kind: 'session', id: 'session:claude-app:desk-panel', title: 'desk-panel', origin: 'claude-app', percent: 30 },
    { kind: 'task', id: 't1', title: 'Zadanie', percent: 0.1 }], timeline });
  expect(parts.map(p => p.percent)).toEqual([20, 0.1, 10]);
  expect(parts[0].color).toBe(parts[2].color);
  expect(parts[0].color).not.toBe(parts[1].color);
  expect(parts[1].label).toBe('Cezar · Zadanie · 0,1 p.p.');
});

it('shows a time lane per source group when slices carry times, with a marker for now', () => {
  const now = Date.now(), start = now + 3600000 - 5 * 3600000;
  const provider = { ...claude, observedAt: now, resetAt: now + 3600000, usedPercent: 40, segments: [
    { kind: 'unobserved' as const, percent: 10 }, { kind: 'session' as const, id: 'session:claude-app:desk-panel', title: 'desk-panel', origin: 'claude-app' as const, percent: 25 },
    { kind: 'task' as const, id: 't1', title: 'Zadanie', percent: 5 }], timeline: [
    { key: 'unobserved', percent: 10, from: start, to: start + 1800000 }, { key: 'session:claude-app:desk-panel', percent: 25, from: start + 1800000, to: start + 3 * 3600000 },
    { key: 't1', percent: 5, from: start + 3600000, to: start + 3 * 3600000 / 2 }] };
  const { container } = render(<UsageBreakdownCard usage={usage({ providers: [provider] })} />);
  const lanes = [...container.querySelectorAll('.breakdown-lane')];
  expect(lanes.map(l => l.querySelector('.breakdown-lane-label span')!.textContent)).toEqual(['Sprzed pomiarów', 'Claude (aplikacja)', 'Cezar']);
  expect(lanes.every(l => l.querySelectorAll('.breakdown-track i').length >= 1)).toBe(true);
  expect(container.querySelector('.breakdown-now')).toBeTruthy();
  cleanup();
  const { container: bare } = render(<UsageBreakdownCard usage={usage({ providers: [{ ...provider, timeline: [{ key: 'unobserved', percent: 10 }] }] })} />);
  expect(bare.querySelector('.breakdown-lanes')).toBeNull();
  expect(screen.getByText('Cezar')).toBeTruthy();
});

it('splits the Antigravity 5h quota bar too, whatever the adapter calls its window, but not other models or windows', () => {
  const reset = Date.now() + 3600000;
  const agy = { ...gemini, usedPercent: 10, resetAt: reset, segments: [{ kind: 'session' as const, id: 'session:antigravity-app:x', title: 'x', origin: 'antigravity-app' as const, percent: 10 }] };
  const state = usage({ providers: [agy] });
  const snap = (window: string) => ({ window, usedPercent: 10, resetAt: reset }) as never;
  const card = (title: string) => ({ provider: 'AGY', title }) as never;
  expect(splitFor(snap('gemini-5h'), card('Gemini'), state)?.length).toBe(1);
  expect(splitFor(snap('gemini-weekly'), card('Gemini'), state)).toBeUndefined();
  expect(splitFor(snap('3p-5h'), card('Gemini Claude&GPT'), state)).toBeUndefined();
  expect(splitFor(snap('gemini-5h'), card('Gemini'), usage({ status: 'offline', providers: [agy] }))).toBeUndefined();
  expect(splitFor({ window: 'gemini-5h', usedPercent: 10, resetAt: reset + 3 * 3600000 } as never, card('Gemini'), state)).toBeUndefined();
});
