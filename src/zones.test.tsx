import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch, type ScenarioName } from './test-fixtures';
import { nearestSize } from './SizeGrip';
import { BOTTOM_SIZES, DEFAULT_ZONES, TOP_CYCLE, TOP_SIZES, ZONES_KEY, cycleSize, parseZones, stepSize, useZones } from './zones';

const now = new Date('2026-10-14T10:00:00Z').getTime(); // a Wednesday
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const renderWith = (scenario: ScenarioName = 'standard') => { vi.stubGlobal('fetch', vi.fn(scenarioFetch(scenario))); return render(<App />); };
const frame = () => document.querySelector('.p3-frame')!;

describe('zone sizes', () => {
  it('steps along the order and stops at the ends', () => {
    expect(stepSize(TOP_SIZES, 'std', -1)).toBe('cmp');
    expect(stepSize(TOP_SIZES, 'cmp', -1)).toBe('cmp');
    expect(stepSize(BOTTOM_SIZES, 'mid', 1)).toBe('month');
    expect(stepSize(BOTTOM_SIZES, 'month', 1)).toBe('month');
  });
  it('cycles round, from the last size to the first', () => {
    expect([cycleSize(TOP_CYCLE, 'std'), cycleSize(TOP_CYCLE, 'cmp')]).toEqual(['cmp', 'std']);
    expect([cycleSize(BOTTOM_SIZES, 'short'), cycleSize(BOTTOM_SIZES, 'mid'), cycleSize(BOTTOM_SIZES, 'month')]).toEqual(['mid', 'month', 'short']);
  });
  it('reads only valid saved sizes', () => {
    expect(parseZones('{"top":"cmp","bottom":"short"}')).toEqual({ top: 'cmp', bottom: 'short' });
    expect(parseZones('{"top":"off","bottom":"mid"}')).toEqual({ top: 'cmp', bottom: 'mid' }); // saved before the hidden strip went
    for (const bad of [null, '', '{', '{"top":"huge","bottom":"mid"}', '{"top":"std"}']) expect(parseZones(bad)).toEqual(DEFAULT_ZONES);
  });
  it('remembers a change and goes back to the default when the panel idles', () => {
    const { result, rerender } = renderHook(({ idle }) => useZones(idle), { initialProps: { idle: false } });
    act(() => result.current.setBottom('month'));
    expect(JSON.parse(localStorage.getItem(ZONES_KEY)!)).toEqual({ top: 'std', bottom: 'month' });
    expect(renderHook(() => useZones(false)).result.current.zones.bottom).toBe('month');
    rerender({ idle: true });
    expect(result.current.zones).toEqual(DEFAULT_ZONES);
    expect(JSON.parse(localStorage.getItem(ZONES_KEY)!)).toEqual(DEFAULT_ZONES);
  });
});

describe('three zones', () => {
  it('starts with the standard top, the work area and the medium week', async () => {
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    expect(frame().getAttribute('data-top')).toBe('std');
    expect(frame().getAttribute('data-bottom')).toBe('mid');
    expect(screen.getByRole('region', { name: 'Dziś' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Najbliższe dni' })).getAllByRole('button', { name: /^Pokaż dzień:/ })).toHaveLength(7);
  });
  it('steps the week through chips, cards and a month that takes the work area\'s place', async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    const grip = () => screen.getByRole('button', { name: 'Zmień rozmiar kalendarza dni' });
    await user.click(grip());
    expect(frame().getAttribute('data-bottom')).toBe('month');
    expect(screen.queryByRole('region', { name: 'Claude' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Poczta' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Najbliższe dni' })).getAllByRole('button', { name: /^Pokaż dzień:/ })).toHaveLength(35);
    expect(JSON.parse(localStorage.getItem(ZONES_KEY)!).bottom).toBe('month');
    await user.click(grip());
    expect(frame().getAttribute('data-bottom')).toBe('short');
    expect(screen.getByRole('region', { name: 'Claude' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Najbliższe dni' })).getAllByRole('button', { name: /^Pokaż dzień:/ })).toHaveLength(7);
    await user.click(grip());
    expect(frame().getAttribute('data-bottom')).toBe('mid');
    expect(await screen.findByRole('region', { name: 'Poczta' })).toBeTruthy();
  });
  it('steps the top between the standard strip and a line', async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(screen.getByRole('button', { name: 'Zmień rozmiar paska dnia' }));
    expect(frame().getAttribute('data-top')).toBe('cmp');
    await user.click(within(screen.getByRole('region', { name: 'Najbliższe dni' })).getByRole('button', { name: /^Pokaż dzień: Pt/ }));
    expect(frame().getAttribute('data-top')).toBe('cmp');
    expect(screen.getByRole('region', { name: /piątek/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zmień rozmiar paska dnia' }));
    expect(frame().getAttribute('data-top')).toBe('std');
  });
  it('shows the selected day on top, and today again from today\'s card; there are no arrows', async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    expect(screen.queryByRole('button', { name: /Następny dzień|Poprzedni dzień/ })).toBeNull();
    const days = within(screen.getByRole('region', { name: 'Najbliższe dni' }));
    await user.click(days.getByRole('button', { name: /^Pokaż dzień: Czw/ }));
    const thursday = screen.getByRole('region', { name: /czwartek/ });
    expect(within(thursday).getByText('jutro')).toBeTruthy();
    await user.click(days.getByRole('button', { name: /^Pokaż dzień: Śr 14, dziś/ }));
    expect(screen.getByRole('region', { name: 'Dziś' })).toBeTruthy();
  });
  it('leaves the work area out when nothing in it would say anything, and the month needs no cards', async () => {
    localStorage.setItem('desk-panel.layout', JSON.stringify({ version: 2, widgets: ['cezar', 'system', 'calendar', 'training', 'quotas', 'breakdown', 'insights', 'mail', 'todo', 'bank', 'ambient'].map(id => ({ id, visible: id === 'calendar' || id === 'training', displayMode: 'expanded', priority: 'normal' })) }));
    renderWith();
    await screen.findByRole('region', { name: 'Dziś' });
    expect(document.querySelector('.p3-work')).toBeNull();
    expect(frame().getAttribute('data-work')).toBe('false');
  });
});

describe('dragging the grips', () => {
  const drag = (grip: HTMLElement, from: number, to: number) => {
    fireEvent.pointerDown(grip, { clientY: from, button: 0 });
    fireEvent.pointerMove(grip, { clientY: (from + to) / 2 });
    fireEvent.pointerMove(grip, { clientY: to });
    fireEvent.pointerUp(grip, { clientY: to });
    fireEvent.click(grip, { detail: 1 });
  };
  beforeEach(() => { vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; }); });

  it('picks the size nearest to the height', () => {
    expect([nearestSize([40, 60, 124], 10), nearestSize([40, 60, 124], 52), nearestSize([40, 60, 124], 95), nearestSize([40, 60, 124], 900)]).toEqual([0, 1, 2, 2]);
  });
  it('drags the top edge up to a line, and down again to the standard strip', async () => {
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    const grip = () => screen.getByRole('button', { name: 'Zmień rozmiar paska dnia' });
    drag(grip(), 300, 230); // 124 - 70 = 54: nearest is the line (44)
    expect(frame().getAttribute('data-top')).toBe('cmp');
    drag(grip(), 300, 400); // 44 + 100 = 144, held at the standard height
    expect(frame().getAttribute('data-top')).toBe('std');
    drag(grip(), 300, 100); // all the way up: held at the line
    expect(frame().getAttribute('data-top')).toBe('cmp');
    drag(grip(), 300, 460);
    expect(frame().getAttribute('data-top')).toBe('std');
    expect((frame() as HTMLElement).style.getPropertyValue('--p3-top')).toBe('');
  });
  it('drags the bottom edge up to a month and down to chips; a drag is not also a tap', async () => {
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    const grip = () => screen.getByRole('button', { name: 'Zmień rozmiar kalendarza dni' });
    drag(grip(), 500, 100);
    expect(frame().getAttribute('data-bottom')).toBe('month');
    drag(grip(), 100, 700);
    expect(frame().getAttribute('data-bottom')).toBe('short');
  });
  it('draws the size the drag would settle on while it goes on, and drops it when the drag is cancelled', async () => {
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    const bottom = screen.getByRole('button', { name: 'Zmień rozmiar kalendarza dni' });
    fireEvent.pointerDown(bottom, { clientY: 500, button: 0 });
    fireEvent.pointerMove(bottom, { clientY: 100 }); // 224 + 400, held at the month
    expect(frame().getAttribute('data-bottom')).toBe('month');
    expect(screen.queryByRole('region', { name: 'Poczta' })).toBeNull();
    fireEvent.pointerMove(bottom, { clientY: 700 }); // 224 - 200: the shortest
    expect(frame().getAttribute('data-bottom')).toBe('short');
    expect(localStorage.getItem(ZONES_KEY)).toBeNull(); // nothing is saved before the grip is let go
    fireEvent.pointerCancel(bottom);
    expect(frame().getAttribute('data-bottom')).toBe('mid');
    const top = screen.getByRole('button', { name: 'Zmień rozmiar paska dnia' });
    fireEvent.pointerDown(top, { clientY: 300, button: 0 });
    fireEvent.pointerMove(top, { clientY: 100 });
    expect(frame().getAttribute('data-top')).toBe('cmp');
    expect(frame().hasAttribute('data-dragging')).toBe(true);
    expect(document.querySelector('.p3-day.cmp .p3-items')).toBeTruthy();
    fireEvent.pointerMove(top, { clientY: 340 }); // back to the standard strip, with the same grip
    expect(frame().getAttribute('data-top')).toBe('std');
    fireEvent.pointerUp(top, { clientY: 340 });
    expect(frame().hasAttribute('data-dragging')).toBe(false);
    expect(frame().getAttribute('data-top')).toBe('std');
    expect(JSON.parse(localStorage.getItem(ZONES_KEY)!).top).toBe('std');
  });
  it('treats a short move as a tap that steps to the next size', async () => {
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    const grip = screen.getByRole('button', { name: 'Zmień rozmiar paska dnia' });
    fireEvent.pointerDown(grip, { clientY: 300, button: 0 });
    fireEvent.pointerMove(grip, { clientY: 302 });
    fireEvent.pointerUp(grip, { clientY: 302 });
    fireEvent.click(grip, { detail: 1 });
    expect(frame().getAttribute('data-top')).toBe('cmp');
  });
});
