import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, render, screen } from '@testing-library/react';
import { QuotaWindow } from './components';
import { quotaSourceSchema } from './quota-contract';
import { quotaState } from './model';
import { useQuotas } from './useQuotas';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('uses actual observation age and stale evidence, preserves missing values and expires reset', () => {
  const now = Date.now();
  const value = { window:'5h' as const, usedPercent:15, observedAt:now - 60001, resetAt:now+3600000, source:'anthropic-oauth-usage', stale:false };
  expect(quotaState(value,now)).toBe('stale');
  expect(quotaState({...value,observedAt:now,stale:true},now)).toBe('stale');
  expect(quotaState({...value,observedAt:null,usedPercent:null},now)).toBe('unavailable');
  expect(quotaState({...value,observedAt:now,resetAt:now},now)).toBe('stale');
  expect(quotaState({...value,observedAt:now,usedPercent:0},now)).toBe('fresh');
  expect(quotaState({...value,freshForMs:90000},now)).toBe('fresh');
  expect(quotaState({...value,freshForMs:90000,observedAt:now-90001},now)).toBe('stale');
});
it('validates missing windows without fake zero and rejects out-of-range percentages', () => {
  const observation = { window:'5h', usedPercent:null, observedAt:null, resetAt:null, source:null, stale:false };
  const value = { live:true,name:'Zapisane limity AI',status:'connected',observedAt:Date.now(),data:[{provider:'Claude',snapshots:[observation,{...observation,window:'7d'}],history:[]}] };
  expect(quotaSourceSchema.parse(value).data![0].snapshots[0].usedPercent).toBe(null);
  expect(quotaSourceSchema.safeParse({...value,data:[{...value.data[0],snapshots:[{...observation,usedPercent:101},observation]}]}).success).toBe(false);
});
it('retains actual cached observations during disconnection and stops polling', async () => {
  vi.useFakeTimers();
  const value = { live:true,name:'Zapisane limity AI',status:'connected',observedAt:Date.now(),data:[] };
  const request = vi.fn().mockResolvedValueOnce(Response.json(value)).mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch',request);
  const view = renderHook(() => useQuotas());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(view.result.current.status).toBe('connected');
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(view.result.current).toMatchObject({status:'offline',data:[],observedAt:value.observedAt});
  view.unmount();
  await vi.advanceTimersByTimeAsync(30000);
  expect(request).toHaveBeenCalledTimes(2);
});
it('renders dynamic AGY groups with unknown reset, and separates auth status from retained usage',()=>{
  const now=Date.now();
  const observation={window:'future-group-limit',model:'Future Model',usedPercent:25,observedAt:now,resetAt:null,
    state:'fresh' as const,stale:false,attemptedAt:now,source:'agy-cli:/usage'};
  render(<QuotaWindow snapshot={observation} now={now} sourceConnected />);
  expect(screen.getByText(/Future Model/)).toBeTruthy();expect(screen.getByText('25%')).toBeTruthy();
  expect(screen.getByText('Termin resetu nieznany')).toBeTruthy();
  expect(screen.getByRole('meter').getAttribute('aria-valuetext')).not.toContain('nieaktualna');
  cleanup();
  render(<QuotaWindow snapshot={{...observation,window:'5h',model:undefined,state:'auth_required',reason:'http_401',stale:true}} now={now} sourceConnected />);
  expect(screen.getByText('Wymaga logowania')).toBeTruthy();expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('25');
  expect(screen.getByText(/Nieaktualne/)).toBeTruthy();
});
