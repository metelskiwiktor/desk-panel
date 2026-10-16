import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,render,screen,within,waitFor,renderHook,act,fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { WarmupSettingsCard } from './QuotaSettings';
import { scenarioFetch,createFixture } from './test-fixtures';
import { filterQuotas,useQuotaVisibility } from './quota-visibility';

beforeEach(()=>{localStorage.clear();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const navigate=async(user:ReturnType<typeof userEvent.setup>,name:string)=>user.click(within(screen.getByRole('navigation')).getByRole('button',{name}));
it('hides only the selected AGY group on dashboard and details, survives reload, and can restore it',async()=>{
  vi.stubGlobal('fetch',vi.fn(scenarioFetch('quota-settings')));const user=userEvent.setup(),view=render(<App/>);
  await screen.findByText(/Gemini 4 Argon ·/);await navigate(user,'Ustawienia');
  await user.click(screen.getByRole('checkbox',{name:'Gemini 4 Argon'}));
  await navigate(user,'Pulpit');expect(screen.queryByText(/Gemini 4 Argon ·/)).toBeNull();expect(screen.getByText(/Claude and GPT models ·/)).toBeTruthy();
  await user.click(screen.getByRole('button',{name:/^AGY /}));expect(screen.queryByText(/Gemini 4 Argon/)).toBeNull();
  view.unmount();render(<App/>);await screen.findAllByText(/Gemini Models ·/);expect(screen.queryByText(/Gemini 4 Argon ·/)).toBeNull();
  await navigate(user,'Ustawienia');expect((screen.getByRole('checkbox',{name:'Gemini 4 Argon'}) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole('checkbox',{name:'Gemini 4 Argon'}));await navigate(user,'Pulpit');expect(screen.getByText(/Gemini 4 Argon ·/)).toBeTruthy();
});
it('does not mutate source readings and leaves previously unknown groups visible',()=>{
  const accounts=createFixture(Date.now(),'quota-settings').quotas.data!;
  const filtered=filterQuotas(accounts,{hiddenProviders:['Claude'],hiddenAgyGroups:['Gemini 4 Argon']})!;
  expect(filtered.some(a=>a.provider==='Claude')).toBe(false);
  expect(filtered.find(a=>a.provider==='AGY')!.snapshots.some(s=>s.model==='Claude and GPT models')).toBe(true);
  expect(accounts.find(a=>a.provider==='AGY')!.snapshots.some(s=>s.model==='Gemini 4 Argon')).toBe(true);
});
it('reports browser storage failure while applying visibility in the current session',()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied');});
  const {result}=renderHook(()=>useQuotaVisibility());act(()=>result.current.set({hiddenProviders:['Codex'],hiddenAgyGroups:[]}));
  expect(result.current.value.hiddenProviders).toEqual(['Codex']);expect(result.current.error).toBe(true);
});
it('loads disabled defaults and persists enable/time plus disable through the settings endpoint only',async()=>{
  const request=vi.fn(scenarioFetch('quota-settings'));vi.stubGlobal('fetch',request);const user=userEvent.setup();render(<WarmupSettingsCard/>);
  const claude=await screen.findByRole('group',{name:'Claude'});
  expect((within(claude).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((within(claude).getByLabelText('Model') as HTMLInputElement).readOnly).toBe(true);
  await user.click(within(claude).getByRole('checkbox'));fireEvent.change(within(claude).getByLabelText('Godzina (Europe/Warsaw)'),{target:{value:'07:30'}});
  await screen.findByText(/Niezapisane zmiany/);await user.click(within(claude).getByRole('button',{name:'Zapisz warmup Claude'}));
  await screen.findByText(/Zapisano/);
  const post=request.mock.calls.find(([,init])=>init?.method==='POST')!;
  expect(String(post[0])).toBe('/api/quotas/warmup/Claude');expect(JSON.parse(String(post[1]!.body))).toEqual({enabled:true,time:'07:30',model:'haiku'});
  expect(request.mock.calls.some(([url])=>String(url).includes('execute'))).toBe(false);
  await user.click(within(claude).getByRole('checkbox'));await user.click(within(claude).getByRole('button',{name:'Zapisz warmup Claude'}));
  await waitFor(()=>expect(JSON.parse(String(request.mock.calls.filter(([,init])=>init?.method==='POST').at(-1)![1]!.body)).enabled).toBe(false));
});
it('shows an unavailable adapter and never invents an enabled state',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));render(<WarmupSettingsCard/>);
  expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByRole('checkbox')).toBeNull();
});
