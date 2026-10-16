import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { warmupStatusSchema, type WarmupSettings, type WarmupProvider } from '../src/warmup-contract';
import { SourceError } from './sources';

/** Only fixed loopback adapter routes. The browser never receives the owner credential. */
export function createWarmupClient(envFile:string,request:typeof fetch=fetch) {
  async function call(provider?:WarmupProvider,value?:WarmupSettings) {
    try{
      const env=parse(await readFile(envFile));const port=Number(env.PORT || '8787');
      if(!env.ADAPTER_API_KEY || !Number.isInteger(port) || port<1 || port>65535)throw new Error('configuration');
      const response=await request(`http://127.0.0.1:${port}/panel/v2/quotas/warmup${provider ? `/settings/${provider}` : ''}`,{
        method:provider ? 'PUT' : 'GET',headers:{Authorization:`Bearer ${env.ADAPTER_API_KEY}`,'Content-Type':'application/json'},
        ...(provider ? {body:JSON.stringify(value)} : {}),signal:AbortSignal.timeout(10000),redirect:'error',
      });
      if(!response.ok)throw new SourceError(response.status===404 ? 503 : response.status===400 ? 400 : 502);
      return warmupStatusSchema.parse(await response.json());
    }catch(error){if(error instanceof SourceError)throw error;throw new SourceError(502);}
  }
  return {read:()=>call(),save:(provider:WarmupProvider,value:WarmupSettings)=>call(provider,value)};
}
