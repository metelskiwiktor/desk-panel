import { describe, expect, it, vi } from 'vitest';
import { cezarAction, createFinishedReader } from './cezar-finished';

const asOf = '2026-10-24T18:00:00.000Z';
const at = (minutesAgo: number) => new Date(Date.parse(asOf) - minutesAgo * 60_000).toISOString();
const run = (id: string, minutesAgo: number, archived = false, project = 'p') => ({
  projectId: project, id, title: `Task ${id} with a long prompt`, titleSummary: `Summary ${id}`, status: 'done', archived,
  startedAt: at(minutesAgo + 5), finishedAt: at(minutesAgo),
});

/** A Cezar that serves the overview in pages of 20 per group and a detail per run; counts what is asked. */
function cezar(groups: { completed?: ReturnType<typeof run>[]; failed?: ReturnType<typeof run>[] }, details: Record<string, object | 'fail'> = {}) {
  const calls: string[] = [];
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/v1/workspace/dashboard/overview') {
      const rows = groups[url.searchParams.get('group') as 'completed' | 'failed'] ?? [];
      const offset = Number(url.searchParams.get('offset'));
      const next = offset + 20 < rows.length ? offset + 20 : null;
      return Response.json({ asOf, page: { rows: rows.slice(offset, offset + 20), total: rows.length, nextOffset: next } });
    }
    const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
    const detail = details[id];
    if (detail === 'fail') return new Response('', { status: 500 });
    return Response.json(detail ?? { seenAt: at(1) });
  }) as unknown as typeof fetch;
  return { request, calls };
}

describe('finished Cezar tasks', () => {
  it('lists done and failed tasks that are not archived, newest first, with the read receipt and the details', async () => {
    const { request } = cezar(
      { completed: [run('a', 10), run('old', 90, true), run('b', 300)], failed: [{ ...run('f', 30), status: 'failed' }] },
      { a: { branch: 'feat/a', workflow: 'implement-review', model: 'claude-opus-5-5', runner: 'Claude', diffStat: { adds: 5, dels: 1, files: 2 }, pullRequestUrl: 'https://github.com/x/y/pull/3' }, b: { seenAt: at(100) } },
    );
    const tasks = await createFinishedReader('http://127.0.0.1:4321', request).read();
    expect(tasks.map(t => [t.id, t.status, t.unread])).toEqual([['p/a', 'done', true], ['p/f', 'failed', false], ['p/b', 'done', false]]);
    expect(tasks[0]).toMatchObject({ title: 'Summary a', project: 'p', branch: 'feat/a', workflow: 'implement-review', runner: 'Claude', model: 'claude-opus-5-5',
      diffStat: { adds: 5, dels: 1, files: 2 }, pullRequestUrl: 'https://github.com/x/y/pull/3', sourceUrl: 'http://127.0.0.1:4321/p/p/tasks/a' });
    expect(tasks[0].completedAt).toBe(Date.parse(at(10)));
  });
  it('reads on past a page of archived tasks, and stops at the end of the list', async () => {
    const archived = Array.from({ length: 20 }, (_, i) => run(`x${i}`, 1000 + i, true));
    const { request, calls } = cezar({ completed: [...archived, run('live', 20)] });
    const tasks = await createFinishedReader('http://127.0.0.1:4321', request).read();
    expect(tasks.map(t => t.id)).toEqual(['p/live']);
    expect(calls.filter(c => c.includes('group=completed'))).toHaveLength(2);
  });
  it('asks Cezar again only after the list has aged or something was changed through the panel', async () => {
    let time = 0;
    const { request, calls } = cezar({ completed: [run('a', 10), run('b', 20)] }, { a: { seenAt: at(1) }, b: {} });
    const reader = createFinishedReader('http://127.0.0.1:4321', request, () => time);
    await reader.read();
    const first = calls.length;
    time = 10_000;
    await reader.read();
    expect(calls).toHaveLength(first);
    reader.invalidate('p/a');
    await reader.read();
    // The overview again (both groups) and the one changed run; the other keeps its cached details.
    expect(calls.slice(first).filter(c => c.includes('/runs/'))).toEqual(['GET /api/v1/p/p/runs/a']);
    expect(calls.slice(first).filter(c => c.includes('overview'))).toHaveLength(2);
  });
  it('shows a task without flagging it when its details cannot be read, and fails on a broken overview', async () => {
    const { request } = cezar({ completed: [run('a', 10)] }, { a: 'fail' });
    const [task] = await createFinishedReader('http://127.0.0.1:4321', request).read();
    expect(task.unread).toBeUndefined();
    const broken = vi.fn(async () => Response.json({ asOf: 'broken' })) as unknown as typeof fetch;
    await expect(createFinishedReader('http://127.0.0.1:4321', broken).read()).rejects.toThrow();
  });
});

describe('writes to Cezar', () => {
  const sent = () => {
    const request = vi.fn(async () => Response.json({})) as unknown as typeof fetch;
    return { request, last: () => (request as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)! as [URL, RequestInit] };
  };
  it('archives, restores, marks read and unread with a POST to that run only', async () => {
    const { request, last } = sent();
    for (const [action, path] of [['archive', 'archive'], ['unarchive', 'archive'], ['read', 'read'], ['unread', 'unread']] as const) {
      await cezarAction('http://127.0.0.1:4321', 'my-project/0163e4f7-0e7d', action, request);
      const [url, init] = last();
      expect(url.pathname).toBe(`/api/v1/p/my-project/runs/0163e4f7-0e7d/${path}`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(action === 'unarchive' ? JSON.stringify({ archived: false }) : undefined);
    }
  });
  it('fails when Cezar refuses', async () => {
    const refuse = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(cezarAction('http://127.0.0.1:4321', 'p/abc', 'archive', refuse)).rejects.toThrow();
  });
});
