// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createPanelServer } from './app';
import { createScenarioSources } from './scenario';
import { createUsageStore, type UsageStore } from './usage';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function serve(usage?: UsageStore) {
  const sources = createScenarioSources(join(process.cwd(), 'scenarios/standard.json'));
  const server = createPanelServer(sources, process.cwd(), undefined, undefined, { usage }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => { server.closeAllConnections(); server.close(); } };
}
const now = Date.now();
const start = now - (now % 3_600_000) - 3_600_000;
const body = JSON.stringify({ slices: [{ id: 'abcdefgh1:1', browser: 'browser01', session: 'abcdefgh1', start, end: start + 60_000, view: 'ambient', width: 1850, height: 1000, entry: true, visitEnd: true, touched: false, noInteractionMs: 60_000, ageIntegral: 0, maxAgeMs: 0 }] });
const post = (base: string, origin?: string) => fetch(`${base}/api/usage`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body });

it('writes usage only for the service: Origin-checked, and a server without a store (scenario, preview) drops it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-route-')); dirs.push(dir);
  const real = await serve(createUsageStore(dir));
  const scenario = await serve();
  try {
    expect((await post(real.base)).status).toBe(403);
    expect((await post(real.base, 'http://evil.example')).status).toBe(403);
    expect(readdirSync(dir)).toEqual([]);
    expect(await (await post(real.base, real.base)).json()).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    const report = await (await fetch(`${real.base}/api/usage/summary?from=2000-01-01&to=2100-01-01`)).json();
    expect(report.byView.ambient.ms).toBe(60_000);
    expect((await fetch(`${real.base}/api/usage/summary?from=jutro`)).status).toBe(400);
    expect((await post(scenario.base, scenario.base)).status).toBe(204);
    expect((await fetch(`${scenario.base}/api/usage/summary`)).status).toBe(503);
  } finally { real.close(); scenario.close(); }
});

it('answers 503 and stays up when the store fails', async () => {
  const broken: UsageStore = { record: async () => { throw new Error('disk'); }, rows: async () => [], prune: async () => undefined };
  const server = await serve(broken);
  try {
    expect((await post(server.base, server.base)).status).toBe(503);
    expect((await fetch(`${server.base}/api/system`)).status).toBeLessThan(500);
  } finally { server.close(); }
});
