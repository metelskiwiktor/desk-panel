import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,render,screen,within,waitFor,renderHook,act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { WarmupHistoryCard, WarmupSettingsCard, useWarmupStatus } from './QuotaSettings';
import { scenarioFetch,createFixture } from './test-fixtures';
import { filterQuotas,useQuotaVisibility } from './quota-visibility';

beforeEach(()=>{localStorage.clear();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Warmup() {const warmup=useWarmupStatus();return <><WarmupSettingsCard warmup={warmup}/><WarmupHistoryCard warmup={warmup}/></>;}
const navigate=async(user:ReturnType<typeof userEvent.setup>,name:string)=>user.click(within(screen.getByRole('navigation')).getByRole('button',{name}));
it('hides only the selected AGY group on dashboard and details, survives reload, and can restore it',async()=>{
  vi.stubGlobal('fetch',vi.fn(scenarioFetch('quota-settings')));const user=userEvent.setup(),view=render(<App/>);
  await screen.findByText(/^Gemini 4 Argon/);await navigate(user,'Ustawienia');
  await user.click(screen.getByRole('checkbox',{name:'Gemini 4 Argon'}));
  await navigate(user,'Pulpit');expect(screen.queryByText(/^Gemini 4 Argon/)).toBeNull();expect(screen.getByText(/^Agy: Claude & GPT/)).toBeTruthy();
  await user.click(screen.getByRole('button',{name:/^Gemini /}));expect(screen.queryByText(/Gemini 4 Argon/)).toBeNull();
  view.unmount();render(<App/>);await screen.findAllByText(/^Gemini/);expect(screen.queryByText(/^Gemini 4 Argon/)).toBeNull();
  await navigate(user,'Ustawienia');expect((screen.getByRole('checkbox',{name:'Gemini 4 Argon'}) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole('checkbox',{name:'Gemini 4 Argon'}));await navigate(user,'Pulpit');expect(screen.getByText(/^Gemini 4 Argon/)).toBeTruthy();
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
it('loads disabled automatic reset defaults and persists enable/disable without a daily time or execution',async()=>{
  const request=vi.fn(scenarioFetch('quota-settings'));vi.stubGlobal('fetch',request);const user=userEvent.setup();render(<Warmup/>);
  const claude=await screen.findByRole('group',{name:'Claude'});
  expect((within(claude).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((within(claude).getByLabelText('Model') as HTMLInputElement).readOnly).toBe(true);
  expect(screen.queryByLabelText(/Godzina/)).toBeNull();
  expect(screen.getByText(/Co 30 sekund/)).toBeTruthy();
  await user.click(within(claude).getByRole('checkbox'));
  await screen.findByText(/Niezapisane zmiany/);await user.click(within(claude).getByRole('button',{name:'Zapisz warmup Claude'}));
  await screen.findByText(/Zapisano/);
  const post=request.mock.calls.find(([,init])=>init?.method==='POST')!;
  expect(String(post[0])).toBe('/api/quotas/warmup/Claude');expect(JSON.parse(String(post[1]!.body))).toEqual({enabled:true,model:'haiku'});
  expect(request.mock.calls.some(([url])=>String(url).includes('execute'))).toBe(false);
  await user.click(within(claude).getByRole('checkbox'));await user.click(within(claude).getByRole('button',{name:'Zapisz warmup Claude'}));
  await waitFor(()=>expect(JSON.parse(String(request.mock.calls.filter(([,init])=>init?.method==='POST').at(-1)![1]!.body)).enabled).toBe(false));
});
it('shows an unavailable adapter and never invents an enabled state',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));render(<Warmup/>);
  expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByRole('checkbox')).toBeNull();
});
it('rejects a legacy daily scheduler instead of presenting it as automatic reset warmup',async()=>{
  const legacy=await (await scenarioFetch('quota-settings')('/api/quotas/warmup')).json();delete legacy.mode;
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(legacy)));render(<Warmup/>);
  expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByRole('checkbox')).toBeNull();
});
it('explains the Codex prompt without Claude wording and shows why the last attempt failed',async()=>{
  vi.stubGlobal('fetch',vi.fn(scenarioFetch('quota-settings')));render(<Warmup/>);
  const codex=await screen.findByRole('group',{name:'ChatGPT / Codex'}),claude=screen.getByRole('group',{name:'Claude'});
  expect(within(codex).queryByText(/Claude/)).toBeNull();expect(within(codex).getByText(/zakończona tura Codex CLI/)).toBeTruthy();
  expect(within(claude).getByText(/Ostatnia próba:.*claude_turn_timeout/)).toBeTruthy();
});
it('lists sent warmups newest first with expandable prompt, reply, tokens and quota',async()=>{
  vi.stubGlobal('fetch',vi.fn(scenarioFetch('quota-settings')));const user=userEvent.setup();render(<Warmup/>);
  await screen.findByText(/Reply only OK. Do not use tools./,{selector:'code'});const rows=[...document.querySelectorAll<HTMLElement>('details.warmup-history-row')];
  expect(rows).toHaveLength(2);expect(rows[0].textContent).toMatch(/ChatGPT \/ Codex.*Wykonano.*7\.8 s.*8126 tok\./);
  await user.click(within(rows[0]).getByText(/ChatGPT \/ Codex/));
  expect(within(rows[0]).getByText('Reply only OK. Do not use tools.')).toBeTruthy();
  expect(within(rows[0]).getByText(/wejście 8121 \(z cache 6400\) · wyjście 5/)).toBeTruthy();
  expect(within(rows[0]).getByText(/100% → 1%/)).toBeTruthy();
  expect(within(rows[1]).getByText(/Ręcznie/)).toBeTruthy();expect(within(rows[1]).getByText(/Niedostępne/)).toBeTruthy();
});
it('says when the adapter is too old to keep history instead of claiming there were no attempts',async()=>{
  const status=await (await scenarioFetch('quota-settings')('/api/quotas/warmup')).json();delete status.history;
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(status)));render(<Warmup/>);
  expect(await screen.findByText(/nie zapisuje historii/)).toBeTruthy();expect(screen.queryByText('Brak prób warmupu.')).toBeNull();
});
