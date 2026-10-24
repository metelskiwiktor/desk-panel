import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityFeed, nowe } from './ActivityFeed';
import { useActivityLog } from './useActivityLog';
import { createFixture } from './test-fixtures';
import { emptyActivityLog, recordActivity, type ActivityEntry } from './activity-log';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const now = Date.parse('2026-10-15T10:00:00Z');
const entry: ActivityEntry = { id:'1', detectedAt:now, title:'Przykładowy alert', context:'5h: +6 p.p.', tone:'amber', target:{kind:'quota',provider:'Claude'} };

it('opens details by tap/keyboard, removes by button, and provides undo without a separate view', async () => {
  const user = userEvent.setup();
  const open=vi.fn(), dismiss=vi.fn(), restore=vi.fn();
  render(<ActivityFeed entries={[entry]} open={open} dismiss={dismiss} restore={restore} canUndo storageError={false} showRules={()=>{}} />);
  await user.click(screen.getByRole('button',{name:'Zdarzenia panelu: 1, najnowsze: Przykładowy alert'}));
  await user.click(screen.getByRole('button',{name:'Limity AI: Przykładowy alert'}));
  expect(open).toHaveBeenCalledWith(entry.target);
  await user.click(screen.getByRole('button',{name:'Usuń zdarzenie: Przykładowy alert'}));
  expect(dismiss).toHaveBeenCalledWith(entry);
  await user.click(screen.getByRole('button',{name:'Cofnij'}));
  expect(restore).toHaveBeenCalledOnce();
  expect(screen.queryByText('Zobacz wszystkie')).toBeNull();
});

it('keeps the bell with a zero and says the list is empty, with the way to the rules', async () => {
  const user = userEvent.setup();
  const showRules = vi.fn();
  render(<ActivityFeed entries={[]} open={vi.fn()} dismiss={vi.fn()} restore={vi.fn()} canUndo={false} storageError={false} showRules={showRules} />);
  expect(screen.queryByRole('region', { name: 'Zdarzenia panelu' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Zdarzenia panelu: 0' }));
  expect(screen.getByText('Brak zdarzeń')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Zasady zdarzeń/ }));
  expect(showRules).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: 'Zdarzenia panelu' })).toBeNull();
});

it('folds on Escape and on a tap outside', async () => {
  const user = userEvent.setup();
  render(<><button>poza</button><ActivityFeed entries={[entry]} open={vi.fn()} dismiss={vi.fn()} restore={vi.fn()} canUndo={false} storageError={false} showRules={() => {}} /></>);
  await user.click(screen.getByRole('button', { name: /^Zdarzenia panelu:/ }));
  expect(screen.getByRole('region', { name: 'Zdarzenia panelu' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('region', { name: 'Zdarzenia panelu' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Zdarzenia panelu:/ }));
  await user.click(screen.getByRole('button', { name: 'poza' }));
  expect(screen.queryByRole('region', { name: 'Zdarzenia panelu' })).toBeNull();
});

it('distinguishes horizontal dismissals in either direction from vertical scrolling and short drags', () => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId=1; isPrimary=true; });
  const open=vi.fn(), dismiss=vi.fn();
  render(<ActivityFeed entries={[entry]} open={open} dismiss={dismiss} restore={()=>{}} canUndo={false} storageError={false} showRules={()=>{}} />);
  fireEvent.click(screen.getByRole('button',{name:/^Zdarzenia panelu:/}));
  const button = screen.getByRole('button',{name:'Limity AI: Przykładowy alert'});
  function drag(x:number,y:number,cancel=false) {
    fireEvent.pointerDown(button,{clientX:150,clientY:100,button:0});
    fireEvent.pointerMove(button,{clientX:150+x,clientY:100+y});
    if(cancel)fireEvent.pointerCancel(button);
    else fireEvent.pointerUp(button,{clientX:150+x,clientY:100+y});
    fireEvent.click(button,{detail:1});
  }
  drag(10,120);
  drag(35,0);
  drag(120,0,true);
  expect(dismiss).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  drag(-120,0);
  drag(120,0);
  expect(dismiss).toHaveBeenCalledTimes(2);
  expect(open).not.toHaveBeenCalled();
});

it('persists dismissal across remounts and permits undo for six seconds', () => {
  vi.useFakeTimers();
  const data=createFixture(now);
  const first = renderHook(() => useActivityLog(data,now));
  const count=first.result.current.entries.length;
  act(()=>first.result.current.dismiss(first.result.current.entries[0]));
  expect(first.result.current.entries).toHaveLength(count-1);
  act(()=>first.result.current.restore());
  expect(first.result.current.entries).toHaveLength(count);
  act(()=>first.result.current.dismiss(first.result.current.entries[0]));
  act(()=>vi.advanceTimersByTime(6001));
  expect(first.result.current.canUndo).toBe(false);
  first.unmount();
  const second = renderHook(()=>useActivityLog(data,now));
  expect(second.result.current.entries).toHaveLength(count-1);
});

it('degrades to an in-memory list when storage is unavailable', () => {
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});
  const data=createFixture(now);
  const view=renderHook(()=>useActivityLog(data,now));
  expect(view.result.current.storageError).toBe(true);
  expect(view.result.current.entries.length).toBeGreaterThan(0);
  act(()=>view.result.current.dismiss(view.result.current.entries[0]));
  expect(view.result.current.entries.length).toBe(recordActivity(emptyActivityLog(),data,now).entries.length-1);
});

describe('what is new since the list was last open', () => {
  const props = { open: vi.fn(), dismiss: vi.fn(), restore: () => {}, canUndo: false, storageError: false, showRules: () => {} };
  const later = (ms: number): ActivityEntry => ({ ...entry, id: String(ms), title: 'Nowy alert', detectedAt: now + ms });
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });

  it('does not open on its own: the bell says there is one new and how many there are in all', () => {
    const view = render(<ActivityFeed entries={[entry]} {...props} />);
    expect(screen.queryByText(/^\+\d/)).toBeNull(); // what was there at the start is not news
    vi.setSystemTime(now + 6000);
    view.rerender(<ActivityFeed entries={[later(6000), entry]} {...props} />);
    expect(screen.queryByRole('region', { name: 'Zdarzenia panelu' })).toBeNull();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zdarzenia panelu: 2, nowe: 1, najnowsze: Nowy alert' }).textContent).toBe('2+1');
  });
  it('marks the new entries in the open list and counts them as seen afterwards', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(<ActivityFeed entries={[entry]} {...props} />);
    vi.setSystemTime(now + 6000);
    view.rerender(<ActivityFeed entries={[later(6000), entry]} {...props} />);
    await user.click(screen.getByRole('button', { name: /^Zdarzenia panelu:/ }));
    expect(screen.getByText('1 nowe')).toBeTruthy();
    expect(screen.getByText('2 łącznie')).toBeTruthy();
    expect(screen.getAllByText('nowe')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByText('+1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Zdarzenia panelu: 2, najnowsze: Nowy alert' })).toBeTruthy();
  });
  it('keeps what is new through a reload and says nothing about a first start', () => {
    const first = render(<ActivityFeed entries={[entry]} {...props} />);
    vi.setSystemTime(now + 6000);
    first.rerender(<ActivityFeed entries={[later(6000), entry]} {...props} />);
    first.unmount();
    render(<ActivityFeed entries={[later(6000), entry]} {...props} />);
    expect(screen.getByText('+1')).toBeTruthy();
    expect(localStorage.getItem('desk-panel.events-seen')).toBe(String(now));
  });
  it('speaks Polish about the numbers', () => {
    expect([1, 2, 4, 5, 12, 22, 25].map(nowe)).toEqual(['nowe', 'nowe', 'nowe', 'nowych', 'nowych', 'nowe', 'nowych']);
  });
});
