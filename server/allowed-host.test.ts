import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createPanelServer } from './app';
import { createScenarioSources } from './scenario';

it('lets one extra HTTPS name reach the loopback listener through a local proxy, and nothing else', async () => {
  const name = 'pc.tail1234.ts.net';
  const server = createPanelServer(createScenarioSources(join(process.cwd(), 'scenarios/quota-settings.json')), process.cwd(), name).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  // fetch() cannot override Host, which is the whole point of this test.
  const send = (method: string, path: string, headers: Record<string, string>, body?: string) => new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end(body);
  });
  const body = JSON.stringify({ enabled: true, model: 'haiku' });
  const post = (headers: Record<string, string>) => send('POST', '/api/quotas/warmup/Claude', headers, body);
  try {
    expect(await send('GET', '/api/quotas/warmup', { Host: name })).toBe(200);
    expect(await send('GET', '/api/quotas/warmup', { Host: 'evil.ts.net' })).toBe(403);
    expect(await send('GET', '/api/quotas/warmup', { Host: `${name}:443` })).toBe(403);
    expect(await post({ Host: name, Origin: `https://${name}` })).toBe(200);
    expect(await post({ Host: name, Origin: `http://${name}` })).toBe(403);
    expect(await post({ Host: name, Origin: 'https://evil.ts.net' })).toBe(403);
    expect(await post({ Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` })).toBe(200);
  } finally { server.closeAllConnections(); server.close(); }
});
