import { describe, expect, it } from 'vitest';
import { readCezar } from './cezar';
import { createCezarRun, readCezarDefaults } from './cezar-finished';

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

describe('createCezarRun', () => {
  it('reads workflow-specific Cezar defaults and honors a selected runner and model lock', async () => {
    const config = { defaultRunner: 'claude', defaultModels: { claude: 'sonnet', codex: 'native' }, workflowRunners: { analysis: 'codex' }, workflowModels: { analysis: { claude: 'opus', codex: 'gpt-6.1-sol' } }, modelsLocked: false };
    const request = (async () => new Response(JSON.stringify(config))) as typeof fetch;
    expect(await readCezarDefaults('http://cezar.test', 'analysis', undefined, request)).toMatchObject({ runner: 'codex', model: 'gpt-6.1-sol' });
    expect(await readCezarDefaults('http://cezar.test', 'analysis', 'claude', request)).toMatchObject({ runner: 'claude', model: 'opus' });
    config.modelsLocked = true;
    expect(await readCezarDefaults('http://cezar.test', 'analysis', 'claude', request)).toMatchObject({ runner: 'claude', model: 'sonnet', modelsLocked: true });
  });

  it('offers AGY presets when Cezar has no AGY catalog endpoint', async () => {
    const request = (async () => new Response(JSON.stringify({ defaultRunner: 'agy', workflowModels: { analysis: { agy: 'gemini-3.8-flash-high' } } }))) as typeof fetch;
    const result = await readCezarDefaults('http://cezar.test', 'analysis', undefined, request);
    expect(result).toMatchObject({ runner: 'agy', model: 'gemini-3.8-flash-high', catalogSource: 'presets' });
    expect(result.models.map(m => m.id)).toEqual(['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high']);
  });
  it('lets Cezar resolve workflow defaults and returns the task URL', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    const fetchMock = (async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/runs')) return new Response(JSON.stringify({ id: '99887766' }), { status: 201 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await createCezarRun('http://127.0.0.1:4173', {
      title: 'Wybór skillów w czacie',
      task: 'Task: Add @ skill picker\nType: UI',
    }, fetchMock);

    expect(result).toEqual({
      ok: true,
      id: 'desk-panel/99887766',
      project: 'desk-panel',
      workflow: 'desk-panel-task',
      url: 'http://127.0.0.1:4173/p/desk-panel/tasks/99887766',
    });
    expect(calls[0]).toEqual({
      url: 'http://127.0.0.1:4173/api/v1/p/desk-panel/runs',
      method: 'POST',
      body: {
        task: 'Task: Add @ skill picker\nType: UI',
        workflow: 'desk-panel-task',
        autonomous: true,
        worktree: true,
      },
    });
    expect(calls[1]).toEqual({
      url: 'http://127.0.0.1:4173/api/v1/p/desk-panel/runs/99887766',
      method: 'PATCH',
      body: { title: 'Wybór skillów w czacie' },
    });
  });

  it('passes explicit runner and model to Cezar without replacing them', async () => {
    let body: any;
    const fetchMock = (async (_input: URL | string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: '99887766' }), { status: 201 });
    }) as typeof fetch;
    await createCezarRun('http://127.0.0.1:4173', { task: 'Analyze', workflow: 'analysis', runner: 'codex', model: 'gpt-6.1-sol' }, fetchMock);
    expect(body).toMatchObject({ workflow: 'analysis', runner: 'codex', model: 'gpt-6.1-sol' });
  });
});
