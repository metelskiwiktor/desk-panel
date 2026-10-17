import { mkdtemp,writeFile,rm,rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect,it,vi } from 'vitest';
import { createWarmupClient } from './warmup';
import { createPanelServer } from './app';
import { createScenarioSources } from './scenario';

it('forwards only validated settings to fixed loopback routes with backend-only owner auth',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'warmup-client-test-')),file=join(dir,'config.env');
  try{
    await writeFile(file,'PORT=8787\nADAPTER_API_KEY=synthetic-owner\n');
    const status=await createScenarioSources(join(process.cwd(),'scenarios/quota-settings.json')).warmup!();
    const request=vi.fn<typeof fetch>().mockResolvedValue(Response.json(status));
    const result=await createWarmupClient(file,request).save('Claude',{enabled:true,model:'haiku'});
    expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:8787/panel/v2/quotas/warmup/settings/Claude');
    expect(request.mock.calls[0][1]).toMatchObject({method:'PUT',headers:{Authorization:'Bearer synthetic-owner'},redirect:'error'});
    expect(JSON.stringify(result)).not.toContain('synthetic-owner');
    request.mockResolvedValue(new Response('private diagnostics',{status:500}));
    await expect(createWarmupClient(file,request).read()).rejects.toMatchObject({status:502});
  }finally{await rm(file,{force:true});await rmdir(dir);}
});
it('enforces same-origin writes, body limits and provider/settings validation; reads never save',async()=>{
  const sources=createScenarioSources(join(process.cwd(),'scenarios/quota-settings.json'));
  const save=vi.spyOn(sources,'saveWarmup');
  const server=createPanelServer(sources,process.cwd()).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,url=`${base}/api/quotas/warmup/Claude`;
  const body=JSON.stringify({enabled:true,model:'haiku'});
  try{
    expect((await fetch(`${base}/api/quotas/warmup`)).status).toBe(200);expect(save).not.toHaveBeenCalled();
    expect((await fetch(url,{method:'POST',body})).status).toBe(403);
    expect((await fetch(url,{method:'POST',headers:{Origin:'https://foreign.example'},body})).status).toBe(403);
    expect((await fetch(url,{method:'POST',headers:{Origin:base},body:JSON.stringify({enabled:true,prompt:'arbitrary'})})).status).toBe(400);
    expect((await fetch(url,{method:'POST',headers:{Origin:base},body:JSON.stringify({enabled:true,model:'opus'})})).status).toBe(400);
    expect((await fetch(url,{method:'POST',headers:{Origin:base},body:'x'.repeat(5000)})).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
    expect((await fetch(url,{method:'POST',headers:{Origin:base},body})).status).toBe(200);expect(save).toHaveBeenCalledTimes(1);
    expect((await (await fetch(`${base}/api/quotas/warmup`)).json()).settings.Claude.enabled).toBe(true);
  }finally{server.closeAllConnections();server.close();}
});

it.each(['Claude','Codex','Gemini'] as const)('%s: forwards explicit force, shares no credentials and releases the in-flight guard after errors',async provider=>{
  const dir=await mkdtemp(join(tmpdir(),'warmup-client-test-')),file=join(dir,'config.env');
  try{
    await writeFile(file,'PORT=8787\nADAPTER_API_KEY=synthetic-owner\n');
    const result=await createScenarioSources(join(process.cwd(),'scenarios/quota-settings.json')).runWarmup!(provider);
    let release!:(response:Response)=>void;
    const request=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const client=createWarmupClient(file,request),first=client.run(provider);
    await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
    await expect(client.run(provider)).rejects.toMatchObject({status:409});
    const [url,init]=request.mock.calls[0];
    expect(url).toBe(`http://127.0.0.1:8787/panel/v2/quotas/warmup/${provider}`);
    expect(init).toMatchObject({method:'POST',headers:{Authorization:'Bearer synthetic-owner'},redirect:'error'});
    expect(JSON.parse(String(init!.body))).toEqual({dryRun:false,force:true});
    release(new Response('private diagnostics',{status:500}));
    await expect(first).rejects.toMatchObject({status:502});
    request.mockResolvedValue(Response.json({...result,privateDiagnostic:'synthetic-owner'}));
    expect(await client.run(provider)).toEqual(result);
    request.mockResolvedValue(Response.json({...result,provider:provider==='Claude' ? 'Codex' : 'Claude'}));
    await expect(client.run(provider)).rejects.toMatchObject({status:502});
    request.mockResolvedValue(new Response('',{status:404}));
    await expect(client.run(provider)).rejects.toMatchObject({status:503});
  }finally{await rm(file,{force:true});await rmdir(dir);}
});

it('manual API requires same-origin explicit force and a known provider; GET and settings saves never invoke it',async()=>{
  const sources=createScenarioSources(join(process.cwd(),'scenarios/quota-settings.json'));
  const run=vi.spyOn(sources,'runWarmup');
  const save=vi.spyOn(sources,'saveWarmup');
  const server=createPanelServer(sources,process.cwd()).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,url=`${base}/api/quotas/warmup/Claude/run`;
  const post=(target:string,body:string,origin=base)=>fetch(target,{method:'POST',headers:{Origin:origin},body});
  try{
    expect((await fetch(`${base}/api/quotas/warmup`)).status).toBe(200);
    expect((await fetch(url)).status).toBe(404);
    expect((await post(`${base}/api/quotas/warmup/Claude`,JSON.stringify({enabled:false,model:'haiku'}))).status).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect((await post(url,'{"force":true}','https://foreign.example')).status).toBe(403);
    for(const body of ['{}','{"force":false}','{"force":true,"prompt":"arbitrary"}','{"force":true,"model":"opus"}','invalid']){
      expect((await post(url,body)).status).toBe(400);
    }
    expect((await post(url,'x'.repeat(5000))).status).toBe(413);
    expect((await post(`${base}/api/quotas/warmup/AGY/run`,'{"force":true}')).status).toBe(400);
    expect((await post(`${url}/extra`,'{"force":true}')).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    for(const provider of ['Claude','Codex','Gemini'] as const){
      const response=await post(`${base}/api/quotas/warmup/${provider}/run`,'{"force":true}');
      expect(response.status).toBe(200);expect(await response.json()).toMatchObject({provider,result:expect.stringMatching(/^completed/)});
      expect(run).toHaveBeenLastCalledWith(provider);
    }
    expect(save).toHaveBeenCalledTimes(1);
  }finally{server.closeAllConnections();server.close();}
});
