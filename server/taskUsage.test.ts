import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createTaskUsageReader } from './taskUsage';
import { createScenarioSources } from './scenario';

const wireTask = { id: 't', title: 'Zadanie', provider: 'claude', status: 'done', startedAt: '2026-10-17T08:00:00.000Z', finishedAt: '2026-10-17T08:05:00.000Z',
  tokensUsed: 1000, inputTokens: 10, outputTokens: 5, costUsd: null, steps: [] };
const wire = (over = {}) => ({ version: 1, asOf: '2026-10-17T10:00:00.000Z', availability: 'available', tasks: [wireTask], ...over });

it('reads the fixed loopback route with backend-only auth, maps times to ms and keeps the last data when the adapter is down', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-usage-test-')), file = join(dir, 'config.env');
  try {
    await writeFile(file, 'PORT=8787\nADAPTER_API_KEY=synthetic-owner\n');
    let now = 0;
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(wire()));
    const read = createTaskUsageReader(file, request, () => now);
    const first = await read();
    expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:8787/panel/v2/tasks/usage?limit=20');
    expect(request.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer synthetic-owner' }, redirect: 'error' });
    expect(first).toMatchObject({ status: 'connected', observedAt: Date.parse('2026-10-17T10:00:00Z') });
    expect(first.tasks[0].finishedAt).toBe(Date.parse('2026-10-17T08:05:00Z'));
    expect(JSON.stringify(first)).not.toContain('synthetic-owner');
    await read();
    expect(request).toHaveBeenCalledTimes(1);
    now += 31000;
    request.mockRejectedValue(new Error('down'));
    expect(await read()).toMatchObject({ status: 'offline', observedAt: first.observedAt, tasks: first.tasks });
    now += 31000;
    request.mockResolvedValue(Response.json(wire({ tasks: [{ ...wireTask, tokensUsed: -1 }] })));
    expect((await read()).status).toBe('offline');
  } finally { await rm(file, { force: true }); await rmdir(dir); }
});

it('serves the standard scenario in the same contract the real reader returns', async () => {
  const usage = await createScenarioSources(join(process.cwd(), 'scenarios/standard.json')).taskUsage!();
  expect(usage.status).toBe('connected');
  expect(usage.tasks.some(t => t.costUsd === null)).toBe(true);
  expect(usage.tasks.some(t => t.finishedAt === null)).toBe(true);
});
