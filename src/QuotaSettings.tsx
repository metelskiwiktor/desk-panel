import { useEffect, useRef, useState } from 'react';
import { History, Settings2 } from 'lucide-react';
import { Card } from './components';
import type { QuotaAccount } from './model';
import type { QuotaVisibility } from './quota-visibility';
import { warmupStatusSchema, warmupRunResultSchema, type WarmupRunResult, type WarmupStatus, type WarmupProvider, type WarmupSettings, type WarmupHistoryEntry } from './warmup-contract';
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

const resultLabels:Record<string,string>={completed:'Wykonano i potwierdzono',completed_existing_window:'Potwierdzono w aktywnym oknie',failed_no_retry:'Błąd; bez automatycznego ponawiania',
  reserved:'Próba rozpoczęta',window_active:'Okno już aktywne',settings_changed:'Pominięto po zmianie ustawień'};
const reasonLabels:Record<string,string>={claude_turn_timeout:'Claude nie zakończył odpowiedzi w limicie czasu',claude_total_timeout:'Przekroczono łączny limit czasu Claude',
  claude_startup_unverified:'Nie potwierdzono startu Claude CLI',claude_quota_unverified:'Nie potwierdzono quota po próbie',claude_account_changed:'Zmieniło się konto Claude w trakcie',
  claude_history_audit_failed:'Próba zostawiła ślad w historii Claude',turn_not_completed:'CLI nie zakończyło tury',unexpected_tool_activity:'CLI użyło narzędzia lub wykonało więcej niż jedną turę',gemini_model_not_allowed:'Model spoza grupy Gemini Models',
  cli_timeout:'CLI przekroczyło limit czasu',cli_not_installed:'Brak CLI',cli_execution_failed:'CLI zakończyło się błędem',subscription_auth_required:'Wymagane logowanie subskrypcją',
  custom_cli_config_unsupported:'Niestandardowa konfiguracja CLI blokuje warmup',execution_failed:'Nieznany błąd wykonania'};
const describeReason=(reason?:string)=>reason ? `${reasonLabels[reason] || 'Błąd'} (${reason})` : undefined;
const manualLabels:Record<string,string>={locked:'Inny warmup już trwa. Spróbuj po jego zakończeniu.',
  active_session:'Aktywna sesja CLI blokuje próbę. Zakończ ją i spróbuj ponownie.',session_state_unknown:'Nie można sprawdzić aktywnych sesji CLI.',
  quota_unknown:'Nie można potwierdzić aktualnego stanu quota.',model_required:'Najpierw podaj model i zapisz ustawienia.',
  claude_haiku_required:'Claude wymaga modelu Haiku.',gemini_model_not_allowed:'Zapisz model z grupy Gemini Models.',
  settings_changed:'Ustawienia zmieniły się w trakcie próby. Spróbuj ponownie.',
  disabled:'Adapter nie obsługuje wymuszenia przy wyłączonym automacie. Zaktualizuj adapter.',
  duplicate_or_cooldown:'Adapter nie obsługuje pominięcia cooldownu. Zaktualizuj adapter.',
  window_active:'Adapter pominął próbę w aktywnym oknie. Zaktualizuj adapter.'};
const providerName=(provider:WarmupProvider)=>provider==='Codex' ? 'ChatGPT / Codex' : provider==='Gemini' ? 'Gemini (Antigravity)' : provider;
const COOLDOWN_MS=5*3600000;

/** One shared read for the settings forms and the history card, refreshed while settings are open. */
export function useWarmupStatus() {
  const pollingEnabled=usePollingEnabled();
  const [status,setStatus]=useState<WarmupStatus|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const running=useRef(new Set<WarmupProvider>());
  useEffect(()=>{
    if(!pollingEnabled)return;
    let stopped=false,controller:AbortController|undefined;
    const read=()=>{
      controller=new AbortController();const current=controller,timeout=setTimeout(()=>current.abort(),12000);
      void fetch('/api/quotas/warmup',{signal:current.signal}).then(async response=>{
        if(!response.ok)throw new Error();const value=warmupStatusSchema.parse(await response.json());if(!stopped){setStatus(value);setError(false);}
      }).catch(()=>{if(!stopped)setError(true);}).finally(()=>clearTimeout(timeout));
    };
    read();const interval=setInterval(read,30000);
    return()=>{stopped=true;clearInterval(interval);controller?.abort();};
  },[retry,pollingEnabled]);
  return {status,error,retry:()=>{setError(false);setRetry(n=>n+1);},
    run:async(provider:WarmupProvider)=>{
      if(running.current.has(provider))throw new Error('running');
      running.current.add(provider);
      try{
        const response=await fetch(`/api/quotas/warmup/${provider}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true}),signal:AbortSignal.timeout(310000)});
        if(!response.ok)throw new Error(response.status===409 ? 'running' : 'unavailable');
        const result=warmupRunResultSchema.parse(await response.json());
        if(result.provider!==provider)throw new Error('unavailable');
        return result;
      }finally{running.current.delete(provider);setRetry(n=>n+1);}
    },
    save:async(provider:WarmupProvider,value:WarmupSettings)=>{
      const response=await fetch(`/api/quotas/warmup/${provider}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:value.enabled,...(value.model ? {model:value.model} : {})}),signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error();setStatus(warmupStatusSchema.parse(await response.json()));
    }};
}
type WarmupState=ReturnType<typeof useWarmupStatus>;

function WarmupForm({provider,settings,last,save,run}:{provider:WarmupProvider;settings:WarmupSettings;last:WarmupStatus['last'][string];save:(value:WarmupSettings)=>Promise<void>;run:()=>Promise<WarmupRunResult>}) {
  const [value,setValue]=useState(settings),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [running,setRunning]=useState(false),[manualMessage,setManualMessage]=useState(''),[manualError,setManualError]=useState(false);
  const edit=(next:WarmupSettings)=>{setValue(next);setMessage('Niezapisane zmiany. Zapisz, aby je zastosować.');};
  useEffect(()=>setValue(settings),[settings.enabled,settings.model]);
  const nextAllowed=last && Date.parse(last.at)+COOLDOWN_MS>Date.now() ? new Date(Date.parse(last.at)+COOLDOWN_MS) : null;
  return <form className="warmup-form" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setMessage('');
    try{await save(value);setMessage('Zapisano. Automat działa bez restartu usługi.');}
    catch{setMessage('Nie udało się zapisać. Sprawdź połączenie z aktualnym adapterem.');}
    finally{setBusy(false);}
  }}>
    <fieldset disabled={busy || running}><legend>{providerName(provider)}</legend>
      <label className="visibility-toggle"><input type="checkbox" checked={value.enabled} onChange={e=>edit({...value,enabled:e.target.checked})}/>Włącz warmup po zamknięciu okna 5h</label>
      <label>Model{provider==='Claude' ? <input value="Haiku" readOnly/> : <input placeholder={provider==='Gemini' ? 'gemini-3.8-flash-low' : 'Model dostępny w Twoim Codex CLI'} pattern="[a-zA-Z0-9_.\-]{1,100}" required={value.enabled} value={value.model || ''} onChange={e=>edit({...value,model:e.target.value || undefined})}/>}</label>
      <p className="meta">Prompt: {provider==='Claude' ? 'Reply with exactly [losowy kod]. Do not use tools.' : 'Reply only OK. Do not use tools.'}</p>
      <p className="meta">{provider==='Claude' ? 'Krótki prompt jest stały; losowy kod pozwala potwierdzić, że Claude odpowiedział. Narzędzia są wyłączone.' : provider==='Gemini' ? 'Dotyczy tylko grupy Gemini Models (okno gemini-5h), nie Argon ani Claude i GPT. Wykonanie potwierdza jedna zwykła tura agy.' : 'Krótki prompt jest stały; wykonanie potwierdza zakończona tura Codex CLI. Narzędzia są wyłączone.'}</p>
      {settings.configurationError && <p className="warning">Popraw ustawienia warmupu i zapisz.</p>}
      {last && <p className="meta">Ostatnia próba: {new Date(last.at).toLocaleString('pl-PL')} · {resultLabels[last.result] || 'Pominięto próbę'}{last.reason ? ` · ${describeReason(last.reason)}` : ''}</p>}
      {nextAllowed && <p className="meta">Następna możliwa próba automatyczna: {nextAllowed.toLocaleString('pl-PL')} (5h odstępu od ostatniej)</p>}
      <button className="button" type="submit">{busy ? 'Zapisywanie…' : `Zapisz warmup ${provider}`}</button>
      <button className="button" type="button" onClick={async()=>{
        setRunning(true);setManualMessage('');setManualError(false);
        try{
          const result=await run(),ok=result.result==='completed' || result.result==='completed_existing_window';
          setManualError(!ok);
          setManualMessage(ok ? `Warmup ${provider} wykonany${result.result==='completed_existing_window' ? ' w aktywnym oknie' : ''}.` :
            `Warmup ${provider}: ${manualLabels[result.result] || 'Nie udało się wykonać warmupu.'}${result.reason ? ` ${describeReason(result.reason)}` : ''}`);
        }catch(error){
          setManualError(true);setManualMessage(error instanceof Error && error.message==='running' ? 'Warmup już trwa. Spróbuj po jego zakończeniu.' :
            'Nie udało się potwierdzić wykonania. Sprawdź połączenie i wersję adaptera. Próba mogła nadal trwać; możesz spróbować ponownie.');
        }finally{setRunning(false);}
      }}>{running ? `Warmup ${provider} w toku…` : `Uruchom warmup ${provider} teraz`}</button>
      <p className="meta">Ręczna próba używa zapisanego modelu, także przy wyłączonym automacie. Pomija cooldown i stan okna 5h. Zużywa quota; nie resetuje ani nie zwiększa limitów dostawcy.</p>
    </fieldset>
    {running && <p role="status">Warmup {provider} w toku. Weryfikacja może potrwać kilka minut.</p>}
    {manualMessage && <p role={manualError ? 'alert' : 'status'}>{manualMessage}</p>}
    {message && <p role="status">{message}</p>}
  </form>;
}
export function WarmupSettingsCard({warmup}:{warmup:WarmupState}) {
  const {status,error}=warmup;
  return <Card title="Warmup AI" icon={<Settings2 />}>
    <p className="card-intro">Domyślnie wyłączony. Co 30 sekund sprawdza, czy okno 5h jest zamknięte i nie ma aktywnej sesji CLI. Wtedy sam wyśle krótki prompt z istniejącej subskrypcji, aby rozpocząć kolejne okno. Zużywa quota i nie zwiększa limitu.</p>
    <p className="meta">Automat działa przez całą dobę, bez ustalania godziny. Zmiany dotyczą usługi na tym komputerze i obowiązują po zapisaniu. Aktywny proces CLI blokuje próbę, również gdy jest bezczynny. Nieznane quota blokują warmup. Automat zachowuje minimum 5h między próbami, także po błędzie. Wyłączenie zatrzymuje przyszłe próby automatyczne; rozpoczęta próba może się dokończyć. Równoległe wywołania warmupu są blokowane także w trybie ręcznym.</p>
    {error && !status ? <p role="alert">Ustawienia warmupu niedostępne. Wymagany jest aktualny adapter. <button className="button" onClick={warmup.retry}>Ponów odczyt</button></p> : !status ? <p role="status">Odczyt ustawień…</p> :
      (['Claude','Codex','Gemini'] as const).flatMap(provider=>status.settings[provider] ? [[provider,status.settings[provider]!] as const] : []).map(([provider,settings])=><WarmupForm key={provider} provider={provider} settings={settings} last={status.last[provider]} save={value=>warmup.save(provider,value)} run={()=>warmup.run(provider)}/>)}
  </Card>;
}

const percent=(value:number|null|undefined)=>value===null || value===undefined ? '—' : `${Math.round(value)}%`;
const tokens=(entry:WarmupHistoryEntry)=>entry.usage ? `${entry.usage.inputTokens+entry.usage.outputTokens} tok.` : null;
function HistoryRow({entry}:{entry:WarmupHistoryEntry}) {
  const ok=entry.result.startsWith('completed');
  return <details className="warmup-history-row">
    <summary>
      <span className="row-title">{new Date(entry.startedAt).toLocaleString('pl-PL')} · {providerName(entry.provider)}</span>
      <span className={ok ? 'meta' : 'meta warning'}>{resultLabels[entry.result] || entry.result} · {(entry.durationMs/1000).toFixed(1)} s{tokens(entry) ? ` · ${tokens(entry)}` : ''}</span>
    </summary>
    <dl>
      <dt>Uruchomienie</dt><dd>{entry.trigger==='auto' ? 'Automat (po zamknięciu okna 5h)' : 'Ręcznie (skrypt lub API)'}</dd>
      <dt>Model</dt><dd>{entry.model || '—'}</dd>
      {entry.reason && <><dt>Powód</dt><dd>{describeReason(entry.reason)}</dd></>}
      <dt>Wysłano</dt><dd><code>{entry.prompt || '—'}</code></dd>
      <dt>Odpowiedź</dt><dd><code>{entry.response || '—'}</code></dd>
      <dt>Tokeny</dt><dd>{entry.usage ? `wejście ${entry.usage.inputTokens}${entry.usage.cachedInputTokens!==null ? ` (z cache ${entry.usage.cachedInputTokens})` : ''} · wyjście ${entry.usage.outputTokens}` : entry.provider==='Claude' ? 'Niedostępne — Claude działa bez transkryptu' : '—'}</dd>
      <dt>Okno 5h</dt><dd>{percent(entry.quotaBefore?.usedPercent)} → {percent(entry.quotaAfter?.usedPercent)}{entry.quotaAfter?.resetAt ? ` · reset ${new Date(entry.quotaAfter.resetAt).toLocaleString('pl-PL')}` : ''}{entry.windowEffect==='started' ? ' · rozpoczęto okno' : entry.windowEffect==='already_active' ? ' · okno było aktywne' : ''}</dd>
      <dt>Czas</dt><dd>{new Date(entry.startedAt).toLocaleTimeString('pl-PL')} – {new Date(entry.finishedAt).toLocaleTimeString('pl-PL')}</dd>
    </dl>
  </details>;
}
export function WarmupHistoryCard({warmup}:{warmup:WarmupState}) {
  const {status,error}=warmup,history=status?.history;
  return <Card title="Historia warmupu" icon={<History />}>
    <p className="card-intro">Każdy wysłany prompt warmupu: kiedy, co wysłano, co wróciło, tokeny i quota przed i po. Pominięte sprawdzenia co 30 s nie trafiają tutaj. Rozwiń wiersz, aby zobaczyć szczegóły.</p>
    {error && !status ? <p className="meta">Historia niedostępna bez adaptera.</p> : !status ? <p role="status">Odczyt historii…</p> :
      !history ? <p className="meta">Ta wersja adaptera nie zapisuje historii. Zaktualizuj adapter.</p> :
      !history.length ? <p className="meta">Brak prób warmupu.</p> :
      <div className="warmup-history">{history.map(entry=><HistoryRow key={entry.id} entry={entry}/>)}</div>}
  </Card>;
}
