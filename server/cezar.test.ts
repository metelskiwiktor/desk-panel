import { describe, expect, it } from 'vitest';
import { readCezar } from './cezar';

const asOf = '2026-10-24T18:00:00.000Z';
const coverage = { projects: [{ projectId: 'p', state: 'complete' }] };

function fakeCezar(events: unknown[], run: object = { model: 'sonnet' }): typeof fetch {
  const row = { projectId: 'p', id: 'r1', title: 'Task', status: 'running' };
  return (async (input: URL | string) => {
    const path = new URL(String(input)).pathname;
    const group = new URL(String(input)).searchParams.get('group');
    const body =
      path === '/api/v1/workspace/dashboard'
        ? { snapshotId: 's', asOf, coverage, counts: { running: 1, queued: 0, questions: 0, reviews: 0, scheduled: 0 } }
        : path === '/api/v1/workspace/dashboard/tasks'
          ? { snapshotId: 's', asOf, coverage, page: { rows: group === 'running' ? [row] : [], total: group === 'running' ? 1 : 0, nextOffset: null } }
          : path === '/api/v1/config'
            ? { defaultModels: { claude: 'sonnet' } }
            : path.endsWith('/history')
              ? { events }
              : { runner: 'claude', ...run };
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
}

describe('readCezar model', () => {
  it('shows the model the session resolved to, not the requested alias', async () => {
    const result = await readCezar('http://cezar.test', fakeCezar([{ type: 'session.started', model: 'claude-sonnet-5-5' }]));
    expect((result.tasks[0] as { model?: string }).model).toBe('claude-sonnet-5-5');
  });

  it('prefers the model recorded on the run, with no need to read the history', async () => {
    const result = await readCezar('http://cezar.test', fakeCezar([], { model: 'sonnet', resolvedModel: 'claude-sonnet-5-5' }));
    expect((result.tasks[0] as { model?: string }).model).toBe('claude-sonnet-5-5');
  });

  it('leaves the model out when the history has no session start, whatever the run says', async () => {
    const result = await readCezar('http://cezar.test', fakeCezar([]));
    expect((result.tasks[0] as { model?: string }).model).toBeUndefined();
  });
});
