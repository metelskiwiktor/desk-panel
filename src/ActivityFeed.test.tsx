import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityFeed } from './ActivityFeed';
import { useActivityLog } from './useActivityLog';
import { createFixture } from './test-fixtures';
import { emptyActivityLog, recordActivity, type ActivityEntry } from './activity-log';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const now = Date.parse('2026-10-15T10:00:00Z');
const entry: ActivityEntry = { id:'1', detectedAt:now, title:'Przykładowy alert', context:'5h: +6 p.p.', tone:'amber', target:{kind:'quota',provider:'Claude'} };

it('opens details by tap/keyboard, removes by button, and provides undo without a separate view', async () => {
  const user = userEvent.setup();
  const open=vi.fn(), dismiss=vi.fn(), restore=vi.fn();
  render(<ActivityFeed entries={[entry]} open={open} dismiss={dismiss} restore={restore} canUndo storageError={false} />);
  await user.click(screen.getByRole('button',{name:/^Przykładowy alert/}));
  expect(open).toHaveBeenCalledWith(entry.target);
  await user.click(screen.getByRole('button',{name:'Usuń zdarzenie: Przykładowy alert'}));
  expect(dismiss).toHaveBeenCalledWith(entry);
  await user.click(screen.getByRole('button',{name:'Cofnij'}));
  expect(restore).toHaveBeenCalledOnce();
  expect(screen.queryByText('Zobacz wszystkie')).toBeNull();
});

it('distinguishes horizontal dismissals in either direction from vertical scrolling and short drags', () => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId=1; isPrimary=true; });
  const open=vi.fn(), dismiss=vi.fn();
  render(<ActivityFeed entries={[entry]} open={open} dismiss={dismiss} restore={()=>{}} canUndo={false} storageError={false} />);
  const button = screen.getByRole('button',{name:/^Przykładowy alert/});
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
