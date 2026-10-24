import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ambient } from './AmbientClock';
import { ambientLines, forcedAmbient, isNight, pixelShift, useAmbient, useNight } from './ambient-mode';
import type { CalendarEvent, Task } from './model';
import type { TrainingActivity, TrainingWorkout } from './training-contract';

/** Local wall-clock times, like the panel reads them, so the tests hold in any time zone. */
const at = (h: number, m = 0, day = 24) => new Date(2026, 9, day, h, m).getTime();
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const meeting = (from: number, to: number, title = 'Rozmowa'): CalendarEvent => ({ id: title, title, startAt: from, endAt: to, description: '', allDay: false });
const workout = (over: Partial<TrainingWorkout> = {}): TrainingWorkout => ({
  id: 'w', name: 'Próg', sport: 'cycling', date: '2026-10-24', durationSec: 3000, phrase: 'LACTATE_THRESHOLD', trainingEffect: null, trainingEffectLabel: null,
  keyWorkout: false, restDay: false, race: false, steps: null, ...over,
});
const task = (status: Task['status']): Task => ({ id: `t/${status}`, title: status, project: 'P', status, checkedAt: 0, description: '' });
const none = { events: [], workouts: [], activities: [] as TrainingActivity[], tasks: null, unreadMail: null, timeZone: zone };

describe('ambient lines', () => {
  it('says nothing when nothing applies', () => {
    expect(ambientLines({ ...none, now: at(11, 20) })).toEqual([]);
    expect(ambientLines({ ...none, now: at(11, 20), tasks: [task('running'), task('done')], unreadMail: 0 })).toEqual([]);
  });
  it('names the next meeting with the time left, and the one that is on', () => {
    const lines = ambientLines({ ...none, now: at(11, 20), events: [meeting(at(14, 45), at(15, 45)), meeting(at(9), at(10), 'Stara')] });
    expect(lines).toEqual([{ kind: 'meeting', strong: 'Rozmowa', text: '14:45 · za 3 h 25' }]);
    expect(ambientLines({ ...none, now: at(15, 0), events: [meeting(at(14, 45), at(15, 45))] })[0].text).toBe('trwa do 15:45');
  });
  it('keeps a meeting out of the picture when it is more than a day away', () => {
    expect(ambientLines({ ...none, now: at(11, 20), events: [meeting(at(11, 20, 26), at(12, 20, 26))] })).toEqual([]);
  });
  it('shows a workout that is not done, and tomorrow\'s when today is free', () => {
    const now = at(11, 20);
    expect(ambientLines({ ...none, now, workouts: [workout()] })).toEqual([{ kind: 'training', strong: 'Próg', text: 'trening dziś · 50 min' }]);
    const done: TrainingActivity = { startAt: at(8), durationSec: 3000, sport: 'indoor_cycling', avgPower: null, avgHeartRate: null, trainingStress: null };
    expect(ambientLines({ ...none, now, workouts: [workout()], activities: [done] })).toEqual([]);
    expect(ambientLines({ ...none, now, workouts: [workout({ date: '2026-10-25', name: 'Baza' })] })).toEqual([{ kind: 'training', strong: 'Baza', text: 'trening jutro' }]);
    expect(ambientLines({ ...none, now, workouts: [workout({ restDay: true })] })).toEqual([]);
  });
  it('counts what waits in Cezar and the unread mail', () => {
    const lines = ambientLines({ ...none, now: at(11, 20), tasks: [task('needs-input'), task('review'), task('running')], unreadMail: 4 });
    expect(lines).toEqual([{ kind: 'cezar', strong: 'Cezar', text: '2 czeka na Ciebie' }, { kind: 'mail', strong: 'Poczta', text: '4 nieprzeczytane' }]);
    expect(ambientLines({ ...none, now: at(11, 20), unreadMail: 1 })[0].text).toBe('1 nieprzeczytana');
  });
});

describe('ambient mode', () => {
  it('knows the night and reads the forced mode from the address', () => {
    expect([isNight(at(22, 59)), isNight(at(23)), isNight(at(5, 59)), isNight(at(6))]).toEqual([false, true, true, false]);
    expect([forcedAmbient('?ambient=day'), forcedAmbient('?ambient=night'), forcedAmbient('?ambient=x'), forcedAmbient('')]).toEqual(['day', 'night', null, null]);
  });
  it('drifts a few pixels a minute and stays on a small grid', () => {
    const shifts = Array.from({ length: 60 }, (_, i) => pixelShift(at(10, i)));
    expect(new Set(shifts.map(s => `${s.x},${s.y}`)).size).toBeGreaterThan(4);
    expect(shifts.every(s => Math.abs(s.x) <= 14 && Math.abs(s.y) <= 14)).toBe(true);
    expect(pixelShift(at(10, 5))).toEqual(pixelShift(at(10, 5) + 30_000));
  });
  it('shows the clock to the Ambient view and wakes on a tap', () => {
    const wake = vi.fn();
    render(<Ambient now={at(11, 20)} night={false} wake={wake} lines={[{ kind: 'mail', strong: 'Poczta', text: '4 nieprzeczytane' }]} />);
    expect(screen.getByText('11:20')).toBeTruthy();
    expect(screen.getByText('4 nieprzeczytane')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wybudź panel' }));
    expect(wake).toHaveBeenCalledTimes(1);
  });
});

describe('the quiet clock', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const idle = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it('never shows by itself, however long nobody touches the panel, and wakes only on wake()', () => {
    vi.setSystemTime(at(23, 30));
    const { result } = renderHook(() => useAmbient(Date.now()));
    idle(3 * 60 * 60_000);
    expect(result.current.ambient).toBe(false);
  });
  it('shows by the button, ignores touches meanwhile and ends on wake()', () => {
    vi.setSystemTime(at(12));
    const { result } = renderHook(() => useAmbient(Date.now()));
    act(() => result.current.enter());
    expect(result.current.ambient).toBe(true);
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    expect(result.current.ambient).toBe(true);
    act(() => result.current.wake());
    expect(result.current.ambient).toBe(false);
  });
});

describe('day and night button', () => {
  afterEach(() => localStorage.clear());
  it('follows the hour until the button says otherwise, and gives the choice up when the hour changes', () => {
    const { result, rerender } = renderHook(({ now }) => useNight(now), { initialProps: { now: at(14) } });
    expect(result.current.night).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.night).toBe(true);
    rerender({ now: at(15) });
    expect(result.current.night).toBe(true);
    rerender({ now: at(23, 30) }); // dusk: the hour decides again
    expect(result.current.night).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.night).toBe(false); // "day" pressed at night
    rerender({ now: at(2, 0, 25) });
    expect(result.current.night).toBe(false);
    rerender({ now: at(9, 0, 25) }); // dawn
    expect(result.current.night).toBe(false);
    rerender({ now: at(23, 30, 25) });
    expect(result.current.night).toBe(true);
  });
  it('remembers the choice across reloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(at(14));
    const first = renderHook(() => useNight(at(14)));
    act(() => first.result.current.toggle());
    first.unmount();
    expect(renderHook(() => useNight(at(15))).result.current.night).toBe(true);
    vi.restoreAllMocks();
  });
  it('lets an ambient clock follow the chosen night', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12));
    const { result } = renderHook(() => useAmbient(Date.now(), true));
    expect(result.current.night).toBe(true);
    vi.useRealTimers();
  });
});
