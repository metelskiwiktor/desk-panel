import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskUsageCard } from './TaskUsageCard';
import type { TaskUsageState } from './useTaskUsage';

afterEach(cleanup);
const task = (id: string, over = {}) => ({ id, title: `Zadanie ${id}`, provider: 'claude', status: 'done', startedAt: Date.now() - 7200000, finishedAt: Date.now() - 3600000,
  tokensUsed: 2000000, inputTokens: 100, outputTokens: 50, costUsd: 4.5, steps: [{ name: 'Do the task', provider: 'claude', tokensUsed: 2000000, costUsd: 4.5 }], ...over });
const usage = (over: Partial<TaskUsageState> = {}) => ({ status: 'connected', observedAt: Date.now(), tasks: [task('a'), task('b', { provider: 'codex', costUsd: null, tokensUsed: 500000 })], ...over }) as TaskUsageState;

it('lists tasks with tokens, switches to cost, and disables cost when no task has one', () => {
  render(<TaskUsageCard usage={usage()} />);
  expect(screen.getByText('Zadanie a')).toBeTruthy();
  expect(screen.getAllByText(/mln tok\./).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Koszt' }));
  expect(screen.getAllByText(/\$4,50/).length).toBeGreaterThan(0);
  cleanup();
  render(<TaskUsageCard usage={usage({ tasks: [task('c', { costUsd: null })] })} />);
  expect((screen.getByRole('button', { name: 'Koszt' }) as HTMLButtonElement).disabled).toBe(true);
});

it('states loading, empty and offline cases without inventing numbers', () => {
  render(<TaskUsageCard usage={{ status: 'loading', observedAt: null, tasks: [] }} />);
  expect(screen.getByText('Ładowanie zużycia…')).toBeTruthy();
  cleanup();
  render(<TaskUsageCard usage={usage({ tasks: [] })} />);
  expect(screen.getByText('Brak zadań ze zużyciem.')).toBeTruthy();
  cleanup();
  render(<TaskUsageCard usage={usage({ status: 'offline' })} />);
  expect(screen.getByText(/ostatnie dane/)).toBeTruthy();
});
