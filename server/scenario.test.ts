import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createPanelServer } from './app';
import { createScenarioSources, loadScenario, parseScenario } from './scenario';

const dir = join(process.cwd(), 'scenarios');
const now = Date.UTC(2026, 9, 14, 10);
describe('scenario files', () => {
  it.each(readdirSync(dir).filter(f => f.endsWith('.json')))('%s matches the API contracts', (file) => {
    expect(() => loadScenario(join(dir, file), now)).not.toThrow();
  });
  it('resolves relative timestamps and defaults missing endpoints to a failure', () => {
    const scenario = parseScenario({ system: { live: true, name: 'Komputer', status: 'connected', observedAt: 'now-1h30m',
      data: [{ at: 'now-2s', cpuPercent: 10, ramUsedGb: 1, ramTotalGb: 2 }] } }, now);
    expect(scenario.system).toMatchObject({ observedAt: now - 90 * 60_000, data: [{ at: now - 2000 }] });
    expect(scenario.cezar).toEqual({ $error: 503 });
  });
  it('reports contract violations with their path', () => {
    expect(() => parseScenario({ quotas: { live: true, name: 'Limity AI', status: 'connected', observedAt: 'now', data: [{ provider: 'Claude', snapshots: [], history: [] }] } }, now))
      .toThrow(/quotas/);
    expect(() => parseScenario({ unknown: {} }, now)).toThrow();
  });
  it('applies the same 30-day mail window as Gmail', async () => {
    const scenario = JSON.parse(readFileSync(join(dir, 'standard.json'), 'utf8'));
    const [recent] = scenario.mail.data;
    scenario.mail.data = [recent, { ...recent, id: `${recent.account}:aa01`, threadId: 'aa01', receivedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }];
    const file = join(mkdtempSync(join(tmpdir(), 'desk-panel-')), 'old-mail.json');
    writeFileSync(file, JSON.stringify(scenario));
    const mail = await createScenarioSources(file).mail(10);
    expect(mail).toMatchObject({ total: 1, data: [{ id: recent.id }] });
  });
  it('serves the scenario over HTTP like the real server, including failures', async () => {
    const server = createPanelServer(createScenarioSources(join(dir, 'offline.json')), dir).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/api/cezar`)).status).toBe(502);
      expect(await (await fetch(`${base}/api/calendar`)).json()).toMatchObject({ status: 'offline', name: 'Google Calendar' });
      expect((await fetch(`${base}/api/missing`)).status).toBe(404);
    } finally { server.close(); }
  });
});
