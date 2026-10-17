import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createUsageBreakdownReader } from './usageBreakdown';
import { createScenarioSources } from './scenario';

const wire = (over = {}) => ({ version: 1, asOf: '2026-10-17T10:00:00.000Z', availability: 'available', providers: [
  { provider: 'Claude', usedPercent: 40, observedAt: '2026-10-17T09:59:40.000Z', resetAt: '2026-10-17T13:00:00.000Z', segments: [{ kind: 'task', id: 't', title: 'Zadanie', percent: 10 }, { kind: 'other', percent: 30 }] }], ...over });

it('reads the fixed loopback route with backend-only auth, maps times to ms and keeps the last data when the adapter is down', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'usage-breakdown-test-')), file = join(dir, 'config.env');
  try {
    await writeFile(file, 'PORT=8787\nADAPTER_API_KEY=synthetic-owner\n');
    let now = 0;
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(wire()));
    const read = createUsageBreakdownReader(file, request, () => now);
    const first = await read();
    expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:8787/panel/v2/usage/breakdown');
    expect(request.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer synthetic-owner' }, redirect: 'error' });
    expect(first).toMatchObject({ status: 'connected', observedAt: Date.parse('2026-10-17T10:00:00Z') });
    expect(first.providers[0].resetAt).toBe(Date.parse('2026-10-17T13:00:00Z'));
    expect(JSON.stringify(first)).not.toContain('synthetic-owner');
    await read();
    expect(request).toHaveBeenCalledTimes(1);
    now += 21000;
    request.mockRejectedValue(new Error('down'));
    expect(await read()).toMatchObject({ status: 'offline', observedAt: first.observedAt, providers: first.providers });
    now += 21000;
    request.mockResolvedValue(Response.json(wire({ providers: [{ provider: 'Claude', usedPercent: 140, observedAt: null, resetAt: null, segments: [] }] })));
    expect((await read()).status).toBe('offline');
  } finally { await rm(file, { force: true }); await rmdir(dir); }
});

it('serves the standard scenario in the same contract the real reader returns', async () => {
  const usage = await createScenarioSources(join(process.cwd(), 'scenarios/standard.json')).usageBreakdown!();
  expect(usage.status).toBe('connected');
  expect(usage.providers.map(p => p.provider)).toEqual(['Claude', 'Codex', 'Gemini']);
  expect(usage.providers.some(p => p.usedPercent === null)).toBe(true);
});
