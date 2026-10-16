import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Card } from './components';
import type { QuotaAccount } from './model';
import type { QuotaVisibility } from './quota-visibility';
import { warmupStatusSchema, type WarmupStatus, type WarmupProvider, type WarmupSettings } from './warmup-contract';
import { usePollingEnabled } from './polling';

export function QuotaVisibilitySettings({accounts,value,change,error}:{accounts:QuotaAccount[]|null;value:QuotaVisibility;change:(value:QuotaVisibility)=>void;error:boolean}) {
  const groups=[...new Set([...(accounts?.find(a=>a.provider==='AGY')?.snapshots.flatMap(s=>s.model ? [s.model] : []) || []),...value.hiddenAgyGroups])];
  return <Card title="Widoczność limitów AI" icon={<Settings2 />}>
    <p className="card-intro">Wybierz limity widoczne na pulpicie i w szczegółach. Odczyt danych działa dalej. Ustawienie dotyczy tej przeglądarki.</p>
    {(['Claude','Codex'] as const).map(provider=><label className="visibility-toggle widget-setting" key={provider}>
      <input type="checkbox" checked={!value.hiddenProviders.includes(provider)} onChange={e=>change({...value,hiddenProviders:e.target.checked ? value.hiddenProviders.filter(p=>p!==provider) : [...value.hiddenProviders,provider]})}/><span>{provider === 'Codex' ? 'ChatGPT / Codex' : 'Claude'}</span>
    </label>)}
    <h3>Gemini / Antigravity</h3>
    {groups.map(group=><label className="visibility-toggle widget-setting" key={group}>
      <input type="checkbox" checked={!value.hiddenAgyGroups.includes(group)} onChange={e=>change({...value,hiddenAgyGroups:e.target.checked ? value.hiddenAgyGroups.filter(g=>g!==group) : [...value.hiddenAgyGroups,group]})}/><span>{group}</span>
    </label>)}
    {!groups.length && <p className="meta">Grupy, w tym frontier oraz Claude i GPT, pojawią się po odczycie z AGY CLI.</p>}
    <p className={error ? 'warning' : 'meta'} role="status">{error ? 'Nie udało się zapisać. Wybór działa w tej sesji.' : 'Zmiany zapisują się automatycznie.'}</p>
  </Card>;
}

function WarmupForm({provider,settings,last,save}:{provider:WarmupProvider;settings:WarmupSettings;last:WarmupStatus['last'][string];save:(value:WarmupSettings)=>Promise<void>}) {
  const [value,setValue]=useState(settings),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const edit=(next:WarmupSettings)=>{setValue(next);setMessage('Niezapisane zmiany. Zapisz, aby je zastosować.');};
  useEffect(()=>setValue(settings),[settings.enabled,settings.time,settings.model]);
  return <form className="warmup-form" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setMessage('');
    try{await save(value);setMessage('Zapisano. Harmonogram obowiązuje bez restartu usługi.');}
    catch{setMessage('Nie udało się zapisać. Sprawdź połączenie z aktualnym adapterem.');}
    finally{setBusy(false);}
  }}>
    <fieldset disabled={busy}><legend>{provider === 'Codex' ? 'ChatGPT / Codex' : provider}</legend>
      <label className="visibility-toggle"><input type="checkbox" checked={value.enabled} onChange={e=>edit({...value,enabled:e.target.checked})}/>Włącz codzienny warmup</label>
      <label>Godzina (Europe/Warsaw)<input type="time" required value={value.time} onChange={e=>edit({...value,time:e.target.value})}/></label>
      <label>Model{provider==='Claude' ? <input value="Haiku" readOnly/> : <input placeholder="Model dostępny w Twoim Codex CLI" pattern="[a-zA-Z0-9_.\-]{1,100}" required={value.enabled} value={value.model || ''} onChange={e=>edit({...value,model:e.target.value || undefined})}/>}</label>
      <p className="meta">Prompt: {provider==='Claude' ? 'Reply with exactly [losowy kod]. Do not use tools.' : 'Reply only OK. Do not use tools.'}</p>
      <p className="meta">Krótki prompt jest stały; losowy kod Claude pozwala potwierdzić wykonanie. Narzędzia są wyłączone.</p>
      {settings.configurationError && <p className="warning">Popraw ustawienia warmupu i zapisz.</p>}
      {last && <p className="meta">Ostatnia próba: {new Date(last.at).toLocaleString('pl-PL')} · {({completed:'Wykonano i potwierdzono',completed_existing_window:'Potwierdzono w aktywnym oknie',failed_no_retry:'Błąd; bez automatycznego ponawiania',reserved:'Próba rozpoczęta',window_active:'Okno już aktywne',settings_changed:'Pominięto po zmianie ustawień'} as Record<string,string>)[last.result] || 'Pominięto próbę'}</p>}
      <button className="button" type="submit">{busy ? 'Zapisywanie…' : `Zapisz warmup ${provider}`}</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
  </form>;
}
export function WarmupSettingsCard() {
  const pollingEnabled=usePollingEnabled();
  const [status,setStatus]=useState<WarmupStatus|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!pollingEnabled)return;
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);let stopped=false;
    void fetch('/api/quotas/warmup',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error();const value=warmupStatusSchema.parse(await response.json());if(!stopped){setStatus(value);setError(false);}
    }).catch(()=>{if(!stopped)setError(true);}).finally(()=>clearTimeout(timeout));
    return()=>{stopped=true;clearTimeout(timeout);controller.abort();};
  },[retry,pollingEnabled]);
  return <Card title="Warmup AI" icon={<Settings2 />}>
    <p className="card-intro">Domyślnie wyłączony. Raz dziennie wyśle krótki prompt z istniejącej subskrypcji, jeśli okno 5h jest nieaktywne. Zużywa quota i nie zwiększa limitu.</p>
    <p className="meta">Zmiany dotyczą usługi na tym komputerze i obowiązują po zapisaniu. Aktywne sesje, nieznane quota i blokada kolejnych prób mogą pominąć warmup. Wyłączenie zatrzymuje przyszłe próby; rozpoczęta próba może się dokończyć.</p>
    {error ? <p role="alert">Ustawienia warmupu niedostępne. Wymagany jest aktualny adapter. <button className="button" onClick={()=>{setError(false);setRetry(n=>n+1);}}>Ponów odczyt</button></p> : !status ? <p role="status">Odczyt ustawień…</p> :
      (['Claude','Codex'] as const).map(provider=><WarmupForm key={provider} provider={provider} settings={status.settings[provider]} last={status.last[provider]} save={async value=>{
        const response=await fetch(`/api/quotas/warmup/${provider}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:value.enabled,time:value.time,...(value.model ? {model:value.model} : {})}),signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error();setStatus(warmupStatusSchema.parse(await response.json()));
      }}/>)}
  </Card>;
}
