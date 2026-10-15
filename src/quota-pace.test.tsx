import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { QuotaWindow } from './components';
import { quotaPace } from './quota-pace';
import { MINUTE, type QuotaSnapshot } from './model';

afterEach(cleanup);
const now = Date.parse('2026-10-15T10:00:00Z');
const snapshot: QuotaSnapshot = {
  window: '5h', usedPercent: 15, observedAt: now, resetAt: now + 240 * MINUTE,
};

it('compares usage to elapsed time in both windows, including colour boundaries', () => {
  expect(quotaPace(snapshot, now)).toMatchObject({ elapsedPercent: 20, tone: 'green' });
  for (const [usedPercent, tone] of [[25, 'green'], [25.1, 'yellow'], [35, 'yellow'], [35.1, 'red']] as const) {
    expect(quotaPace({ ...snapshot, usedPercent }, now)?.tone).toBe(tone);
  }
  const weekly = { ...snapshot, window: '7d' as const, usedPercent: 30 };
  expect(quotaPace({ ...weekly, resetAt: now + 6 * 24 * 60 * MINUTE }, now)?.tone).toBe('red');
  expect(quotaPace({ ...weekly, resetAt: now + 5 * 60 * MINUTE }, now)?.tone).toBe('green');
});

it('bounds elapsed time and withholds pace for missing, expired and stale observations', () => {
  expect(quotaPace({ ...snapshot, resetAt: now + 400 * MINUTE }, now)?.elapsedPercent).toBe(0);
  for (const patch of [{ usedPercent: null }, { resetAt: null }, { resetAt: now }, { stale: true }, { observedAt: now - 121 * 1000 }]) {
    expect(quotaPace({ ...snapshot, ...patch }, now)).toBeNull();
  }
});

it('shows one usage meter with a time marker and countdown, keeping the legend off the dashboard', () => {
  const view = render(<QuotaWindow snapshot={snapshot} now={now} sourceConnected />);
  const meter = screen.getByRole('meter', { name: 'Użycie limitu 5h' });
  expect(meter.classList.contains('quota-pace-green')).toBe(true);
  expect(meter.getAttribute('aria-valuetext')).toContain('czas okna 20%');
  expect(view.container.querySelector<HTMLElement>('.quota-time-marker')?.style.left).toBe('20%');
  expect(screen.getByText(/Czas okna: 20%/).textContent).toContain('reset za 4h');
  expect(screen.queryByText('Jak czytać wykres')).toBeNull();
  expect(view.container.querySelector('.quota-pace-details')).toBeNull();
  view.rerender(<QuotaWindow snapshot={snapshot} now={now} sourceConnected={false} />);
  expect(view.container.querySelector('.quota-time-marker')).toBeNull();
  expect(screen.queryByText(/reset za/)).toBeNull();
  expect(screen.getByText(/Nieaktualne/)).toBeTruthy();
  view.rerender(<QuotaWindow snapshot={{ ...snapshot, resetAt: now }} now={now} sourceConnected />);
  expect(view.container.querySelector('.quota-time-marker')).toBeNull();
});

it('shows distance from colour thresholds only in fresh details and updates it as time passes', () => {
  const yellow = { ...snapshot, usedPercent: 25.25 };
  const view = render(<QuotaWindow snapshot={yellow} now={now} sourceConnected showPaceDetails />);
  expect(screen.getByText('Żółty · zużycie 5,25 p.p. powyżej upływu czasu')).toBeTruthy();
  expect(screen.getByText('Ponad próg żółtego: 0,25 p.p.')).toBeTruthy();
  expect(screen.getByText('Do progu czerwonego: 9,75 p.p.')).toBeTruthy();
  view.rerender(<QuotaWindow snapshot={snapshot} now={now} sourceConnected showPaceDetails />);
  expect(screen.getByText('Zielony · zużycie 5,00 p.p. poniżej upływu czasu')).toBeTruthy();
  expect(screen.getByText('Do progu żółtego: 10,00 p.p.')).toBeTruthy();
  view.rerender(<QuotaWindow snapshot={{ ...snapshot, usedPercent: 36 }} now={now} sourceConnected showPaceDetails />);
  expect(screen.getByText('Ponad próg czerwonego: 1,00 p.p.')).toBeTruthy();
  view.rerender(<QuotaWindow snapshot={yellow} now={now + MINUTE} sourceConnected showPaceDetails />);
  expect(screen.getByText(/Zielony · zużycie/)).toBeTruthy();
  view.rerender(<QuotaWindow snapshot={yellow} now={now} sourceConnected={false} showPaceDetails />);
  expect(view.container.querySelector('.quota-pace-details')).toBeNull();
});
