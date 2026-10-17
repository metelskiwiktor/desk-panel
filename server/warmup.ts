import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { warmupStatusSchema, type WarmupSettings, type WarmupProvider } from '../src/warmup-contract';
import { SourceError } from './sources';
import { z } from 'zod';
import { warmupRunResultSchema, type WarmupRunResult } from '../src/warmup-contract';

/** Only fixed loopback adapter routes. The browser never receives the owner credential. */
export function createWarmupClient(envFile:string,request:typeof fetch=fetch) {
  async function call<T>(path:string,method:string,schema:z.ZodType<T>,value?:unknown,timeout=10000):Promise<T> {
    try{
      const env=parse(await readFile(envFile));const port=Number(env.PORT || '8787');
      if(!env.ADAPTER_API_KEY || !Number.isInteger(port) || port<1 || port>65535)throw new Error('configuration');
      const response=await request(`http://127.0.0.1:${port}/panel/v2/quotas/warmup${path}`,{
        method,headers:{Authorization:`Bearer ${env.ADAPTER_API_KEY}`,'Content-Type':'application/json'},
        ...(value ? {body:JSON.stringify(value)} : {}),signal:AbortSignal.timeout(timeout),redirect:'error',
      });
      if(!response.ok)throw new SourceError(response.status===404 ? 503 : response.status===400 ? 400 : 502);
      return schema.parse(await response.json());
    }catch(error){if(error instanceof SourceError)throw error;throw new SourceError(502);}
  }
  const running=new Set<WarmupProvider>();
  return {read:()=>call('','GET',warmupStatusSchema),
    save:(provider:WarmupProvider,value:WarmupSettings)=>call(`/settings/${provider}`,'PUT',warmupStatusSchema,value),
    run:async(provider:WarmupProvider):Promise<WarmupRunResult>=>{
      if(running.has(provider))throw new SourceError(409);
      running.add(provider);
      try{
        // CLI execution + quota verification can take minutes. The adapter keeps its own durable lock.
        const result=await call(`/${provider}`,'POST',warmupRunResultSchema,{dryRun:false,force:true},300000);
        if(result.provider!==provider)throw new SourceError(502);
        return result;
      }finally{running.delete(provider);}
    }};
}
