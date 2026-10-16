import { useState } from 'react';
import { z } from 'zod';
import type { QuotaAccount } from './model';

const key='desk-panel.quota-visibility';
const schema=z.object({hiddenProviders:z.array(z.enum(['Claude','Codex'])).max(2),hiddenAgyGroups:z.array(z.string().max(160)).max(200)});
export type QuotaVisibility=z.infer<typeof schema>;
export const defaultQuotaVisibility=():QuotaVisibility=>({hiddenProviders:[],hiddenAgyGroups:[]});
export function filterQuotas(accounts:QuotaAccount[]|null,preferences:QuotaVisibility):QuotaAccount[]|null {
  return accounts?.flatMap(account=>{
    if(account.provider!=='AGY')return preferences.hiddenProviders.includes(account.provider) ? [] : [account];
    const visible=(s:QuotaAccount['snapshots'][number])=>!s.model || !preferences.hiddenAgyGroups.includes(s.model);
    const snapshots=account.snapshots.filter(visible);
    return account.snapshots.length && !snapshots.length ? [] : [{...account,snapshots,history:account.history.filter(visible)}];
  }) ?? null;
}
export function useQuotaVisibility() {
  const [value,setValue]=useState<QuotaVisibility>(()=>{try{return schema.parse(JSON.parse(localStorage.getItem(key) || 'null'));}catch{return defaultQuotaVisibility();}});
  const [error,setError]=useState(false);
  return {value,error,set:(next:QuotaVisibility)=>{setValue(next);try{localStorage.setItem(key,JSON.stringify(next));setError(false);}catch{setError(true);}}};
}
