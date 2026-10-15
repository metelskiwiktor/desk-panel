// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQuotaReader } from './quotas';

it('keeps owner auth private and preserves quota evidence during network failure', async () => {
  const directory = await mkdtemp(join(tmpdir(),'desk-quota-test-'));
  try {
    const envFile = join(directory,'adapter.env');
    await writeFile(envFile,'ADAPTER_API_KEY=FAKE-PRIVATE-KEY\nPORT=8787\n');
    const w = {window:'5h',usedPercent:15,observedAt:'2026-10-14T19:00:00Z',resetAt:'2026-10-15T00:00:00Z',source:'anthropic-oauth-usage',stale:true};
    const empty = {window:'7d',usedPercent:null,observedAt:null,resetAt:null,source:null,stale:false};
    let now = Date.parse('2026-10-14T20:00:00Z');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({version:1,asOf:new Date(now).toISOString(),availability:'available',accounts:[
      {provider:'Claude',snapshots:[w,empty],history:[]}, {provider:'Codex',snapshots:[{...empty,window:'5h'},empty],history:[]},
    ]})).mockRejectedValue(new Error('failed'));
    const read = createQuotaReader(envFile,fetcher,() => now);
    const value = await read();
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/panel/v1/quotas/live',expect.objectContaining({headers:{Authorization:'Bearer FAKE-PRIVATE-KEY'},redirect:'error'}));
    expect(JSON.stringify(value)).not.toContain('FAKE-PRIVATE-KEY');
    expect(value.data![0].snapshots[0].observedAt).toBe(Date.parse(w.observedAt));
    await read(); expect(fetcher).toHaveBeenCalledTimes(1);
    now += 15000;
    expect(await read()).toMatchObject({status:'offline',data:value.data,observedAt:value.observedAt});
  } finally {
    if (!directory.startsWith(join(tmpdir(),'desk-quota-test-'))) throw new Error('Invalid cleanup');
    await rm(directory,{recursive:true,force:true});
  }
});
