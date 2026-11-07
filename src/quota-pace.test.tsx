import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { QuotaWindow } from './components';
import { LimitCard } from './QuotaBars';
import { nextCheckpoint, quotaPace, quotaProjection } from './quota-pace';
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
  expect(quotaPace({ ...snapshot, window: 'gemini-5h' }, now)).toMatchObject({ elapsedPercent: 20, tone: 'green' });
  expect(quotaPace({ ...snapshot, window: 'gemini-weekly', usedPercent: 30, resetAt: now + 6 * 24 * 60 * MINUTE }, now)?.tone).toBe('red');
});

it('keeps a spent limit red until the reset, however close the reset is', () => {
  for (const minutesLeft of [240, 60, 11, 1]) {
    expect(quotaPace({ ...snapshot, usedPercent: 100, resetAt: now + minutesLeft * MINUTE }, now)).toMatchObject({ tone: 'red', exhausted: true });
  }
  expect(quotaPace({ ...snapshot, usedPercent: 99, resetAt: now + 11 * MINUTE }, now)).toMatchObject({ tone: 'green', exhausted: false });
});

it('bounds elapsed time and withholds pace for missing, expired and stale observations', () => {
  expect(quotaPace({ ...snapshot, resetAt: now + 400 * MINUTE }, now)?.elapsedPercent).toBe(0);
  for (const patch of [{ usedPercent: null }, { resetAt: null }, { resetAt: now }, { stale: true }, { observedAt: now - 301 * 1000 }]) {
    expect(quotaPace({ ...snapshot, ...patch }, now)).toBeNull();
  }
});

it('projects both windows to a future checkpoint, clamps the edges and flags a reset before it', () => {
  const weekly = { ...snapshot, window: '7d' as const, usedPercent: 30, resetAt: now + 6 * 24 * 60 * MINUTE };
  const weeklyProjection = quotaProjection(weekly, now, now + 12 * 60 * MINUTE)!;
  expect(weeklyProjection.running).toBe(true);
  expect(weeklyProjection.percent).toBeCloseTo(21.4286, 3);
  expect(quotaProjection(snapshot, now, now + 120 * MINUTE)).toEqual({ percent: 60, running: true });
  expect(quotaProjection({ ...snapshot, resetAt: now + 400 * MINUTE }, now, now + 50 * MINUTE)).toEqual({ percent: 0, running: true });
  expect(quotaProjection({ ...snapshot, resetAt: now + 60 * MINUTE }, now, now + 120 * MINUTE)).toEqual({ percent: 100, running: false });
  expect(quotaProjection({ ...snapshot, resetAt: now + 125 * MINUTE }, now, now + 660 * MINUTE)).toEqual({ percent: 100, running: false });
  for (const patch of [{ resetAt: null }, { stale: true }, { observedAt: now - 301 * 1000 }]) {
    expect(quotaProjection({ ...snapshot, ...patch }, now, now + 120 * MINUTE)).toBeNull();
  }
});

it('finds the next local 10:00, rolling to tomorrow after it', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m).getTime();
  const checkpoint = (day: number) => new Date(2026, 9, day, 10, 0).getTime();
  expect(nextCheckpoint(at(9))).toBe(checkpoint(15));
  expect(nextCheckpoint(at(10))).toBe(checkpoint(16));
  expect(nextCheckpoint(at(23, 4))).toBe(checkpoint(16));
});

it('renders the checkpoint label and tick only for a window still running at 10:00', () => {
  const localNow = new Date(2026, 9, 15, 23, 4).getTime();
  const card = {
    id: 'Claude', provider: 'Claude' as const, title: 'Claude',
    snapshots: [
      { window: '5h', usedPercent: 44, observedAt: localNow, resetAt: localNow + 125 * MINUTE },
      { window: '7d', usedPercent: 60, observedAt: localNow, resetAt: localNow + 4300 * MINUTE },
    ],
  };
  const view = render(<LimitCard card={card} now={localNow} connected open={() => {}} />);
  expect(screen.getByText(/reset za .* · jutro 10:00 · \d+,\d%/)).toBeTruthy();
  expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/jutro 10:00 · \d+,\d%/);
  expect(view.container.querySelectorAll('.p3-lfuture')).toHaveLength(1);
  expect(view.container.querySelector('.p3-lrow.thin .p3-lfuture')).toBeTruthy();
  view.rerender(<LimitCard card={{ ...card, snapshots: [card.snapshots[0]] }} now={localNow} connected open={() => {}} />);
  expect(screen.queryByText(/10:00/)).toBeNull();
  expect(view.container.querySelectorAll('.p3-lfuture')).toHaveLength(0);
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
