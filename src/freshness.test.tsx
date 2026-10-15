import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { fresh, MAX_AGE, quotaState } from './model';
import { SourceNote } from './components';
import { preciseStamp } from './format';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('keeps system data current for 15 seconds and rejects genuinely future timestamps', () => {
  const now = Date.now();
  const source = {status:'connected' as const,observedAt:now-15000,data:[]};
  expect(fresh(source,now,MAX_AGE.system)).toBe(true);
  expect(fresh({...source,observedAt:now-15001},now,MAX_AGE.system)).toBe(false);
  expect(fresh({...source,observedAt:now+5000},now,MAX_AGE.system)).toBe(false);
});
it('does not call new system data stale while the one-second UI clock is between ticks', async () => {
  vi.useFakeTimers();
  const start = Date.parse('2026-10-15T08:00:00Z');
  vi.setSystemTime(start);
  vi.spyOn(window,'scrollTo').mockImplementation(() => {});
  let deliver: ((value:Response) => void) | undefined;
  vi.stubGlobal('fetch',vi.fn((path:string) => path === '/api/system' ? new Promise<Response>(resolve => {deliver=resolve;}) : Promise.resolve(new Response('',{status:503}))));
  render(<App />);
  vi.setSystemTime(start+100);
  await act(async () => {deliver!(Response.json({live:true,name:'Komputer',status:'connected',observedAt:start+50,data:[{at:start+50,cpuPercent:10,ramUsedGb:4,ramTotalGb:16}]}));});
  expect(screen.getByRole('button', { name: 'PC · CPU 10% · RAM 25%' })).toBeTruthy();
  expect(screen.queryByText(/PC · brak pomiaru/)).toBeNull();
});
it('accepts live AI readings up to the two-minute threshold', () => {
  const now = Date.now();
  expect(quotaState({window:'5h',usedPercent:10,observedAt:now-120000,resetAt:now+60000,source:'live',freshForMs:120000},now)).toBe('fresh');
  expect(quotaState({window:'5h',usedPercent:10,observedAt:now-120001,resetAt:now+60000,source:'live',freshForMs:120000},now)).toBe('stale');
});
it('shows cadence, precise measurement time and last successful load separately', () => {
  const now = Date.parse('2026-10-15T08:00:05Z');
  render(<SourceNote source={{status:'connected',live:true,name:'Komputer',observedAt:now-3000,loadedAt:now-1000,data:[]}} now={now} maxAge={15000} refreshEveryMs={2000} />);
  expect(screen.getByText(/Dane z/).textContent).toContain(preciseStamp(now-3000));
  expect(screen.getByText(/Odświeżanie: co 2 s/).textContent).toContain(`Ostatnie pobranie: ${preciseStamp(now-1000)}`);
});
