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
