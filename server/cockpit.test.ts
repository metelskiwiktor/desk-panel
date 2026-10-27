// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cezarIdsIn, criteriaOf } from '../src/cockpit-contract';
import { cezarTaskView, createCockpit, prFromGh } from './cockpit';
import type { PanelSources } from './sources';
import { createTodoStore } from './todos';

const CEZAR = 'http://127.0.0.1:4321/';
const RUN = 'desk-panel/f2c9501e-7121-4746-8fc8-19ee3ee9d968';
/** The fields a real Cezar run has (as read from Cezar 2026-10), trimmed. */
const raw = (over: Record<string, unknown> = {}) => ({
  id: 'f2c9501e-7121-4746-8fc8-19ee3ee9d968', title: 'Domyślnie zminimalizowane paski stref', titleSummary: 'Paski stref', status: 'running',
  startedAt: '2026-10-27T12:04:59.575Z', branch: 'cez/f2c9501e', tokensUsed: 350_735,
  worktreePath: 'C:\\Users\\Viktor\\AndroidStudioProjects\\desk-panel\\.ai\\cezar\\worktrees\\f2c9501e',
  steps: [
    { id: 'prepare', name: 'Prepare worktree (LF line endings, node_modules & .ai helpers)', status: 'done' },
    { id: 'implement', name: 'Implement', status: 'running' },
    { id: 'fix', name: 'Fix verification or commit', status: 'pending' },
    { id: 'pr', name: 'Open PR', status: 'pending' },
  ],
  ...over,
});
const PROMPT = 'Task: x\nAcceptance criteria:\n- [ ] Pierwsze kryterium\n- [x] Drugie\n* [ ] Trzecie\nNotes for executor:\n- not a criterion';

describe('a Cezar run in the cockpit', () => {
  it('shows status, steps, tokens and a worktree inside the project, never the profile path', () => {
    const task = cezarTaskView(RUN, raw(), CEZAR);
    expect(task).toMatchObject({
      id: RUN, title: 'Paski stref', status: 'RUNNING', repo: 'desk-panel', tokens: 350_735, branch: 'cez/f2c9501e',
      worktree: '.ai/cezar/worktrees/f2c9501e', url: 'http://127.0.0.1:4321/p/desk-panel/tasks/f2c9501e-7121-4746-8fc8-19ee3ee9d968',
    });
    expect(task.steps).toEqual([
      { label: 'Prepare worktree', state: 'done' }, { label: 'Implement', state: 'running' },
      { label: 'Fix verification or commit', state: 'pending' }, { label: 'Open PR', state: 'pending' },
    ]);
    expect(task.progress).toBe(0.25);
    expect(JSON.stringify(task)).not.toContain('Viktor');
  });

  it('is in review while its PR is open, done once merged; steps that never ran are skipped', () => {
    const done = raw({ status: 'done', pullRequestUrl: 'https://github.com/metelskiwiktor/desk-panel/pull/32',
      steps: [{ id: 'a', name: 'Implement', status: 'done' }, { id: 'fix', name: 'Fix', status: 'pending' }] });
    expect(cezarTaskView(RUN, done, CEZAR, 'OPEN')).toMatchObject({ status: 'REVIEW', progress: 1, prUrl: 'https://github.com/metelskiwiktor/desk-panel/pull/32' });
    expect(cezarTaskView(RUN, done, CEZAR, 'MERGED').status).toBe('DONE');
    expect(cezarTaskView(RUN, done, CEZAR).steps[1].state).toBe('skipped');
    expect(cezarTaskView(RUN, raw({ status: 'failed' }), CEZAR).status).toBe('FAILED');
    expect(cezarTaskView(RUN, raw({ status: 'queued' }), CEZAR).status).toBe('QUEUED');
    expect(cezarTaskView(RUN, raw({ status: 'paused' }), CEZAR).status).toBe('INPUT');
    expect(cezarTaskView(RUN, raw({ pullRequestUrl: 'javascript:alert(1)' }), CEZAR).prUrl).toBeUndefined();
  });

  it('reads the CI checks of a PR from the GitHub CLI answer, a re-run counting once', () => {
    const pr = prFromGh(JSON.stringify({ number: 32, title: 'Paski', state: 'OPEN', headRefName: 'cez/f2c9501e', statusCheckRollup: [
      { __typename: 'CheckRun', name: 'check (ubuntu-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'check (ubuntu-latest)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'check (windows-latest)', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'StatusContext', context: 'GitGuardian', state: 'PENDING' },
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
    ] }), 'https://github.com/metelskiwiktor/desk-panel/pull/32');
    expect(pr).toMatchObject({ number: 32, state: 'OPEN', branch: 'cez/f2c9501e' });
    expect(pr.checks).toEqual([
      { name: 'check (ubuntu-latest)', state: 'pass' }, { name: 'check (windows-latest)', state: 'running' },
      { name: 'GitGuardian', state: 'running' }, { name: 'lint', state: 'fail' },
    ]);
  });

  it('finds the acceptance criteria and the Cezar tasks a text mentions', () => {
    expect(criteriaOf(PROMPT)).toEqual(['Pierwsze kryterium', 'Drugie', 'Trzecie']);
    const a = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11', b = '1b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b22';
    expect(cezarIdsIn(`Task desk-panel/${a} i link http://127.0.0.1:4321/p/inne/tasks/${b} oraz ?project=desk-panel&run=${a}`))
      .toEqual([`desk-panel/${a}`, `inne/${b}`, `desk-panel/${a}`]);
    expect(cezarIdsIn('nic tu nie ma')).toEqual([]);
  });
});

describe('the cockpit of a conversation', () => {
  const CHAT = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11';
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cockpit-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  function setup() {
    const todos = createTodoStore();
    const created = vi.fn(async (input: { task: string; title?: string }) => ({ ok: true as const, id: RUN, project: 'desk-panel', url: `${CEZAR}p/desk-panel/tasks/x`, workflow: 'w', runner: 'r', model: 'm', input }));
    const sources = {
      cezarRun: vi.fn(async (id: string) => id === RUN ? raw({ status: 'done', pullRequestUrl: 'https://github.com/metelskiwiktor/desk-panel/pull/32' }) : null),
      cezarCreateRun: created,
      todos: () => todos.read(),
      todoAction: (a: Parameters<typeof todos.apply>[0]) => todos.apply(a),
    } as unknown as PanelSources;
    const gh = vi.fn(async () => JSON.stringify({ number: 32, title: 'Paski', state: 'OPEN', headRefName: 'cez/f2c9501e', statusCheckRollup: [{ name: 'check', status: 'COMPLETED', conclusion: 'SUCCESS' }] }));
    const file = join(dir, 'cockpit.json');
    return { cockpit: createCockpit({ sources, file, cezarUrl: CEZAR, gh }), created, gh, file, todos, sources };
  }

  it('watches nothing until the conversation dispatches or mentions a task', async () => {
    const { cockpit } = setup();
    expect(await cockpit.view(CHAT)).toMatchObject({ task: null, pr: null, list: null, dispatches: {} });
    const view = await cockpit.view(CHAT, RUN);
    expect(view.task).toMatchObject({ id: RUN, status: 'REVIEW' });
    expect(view.pr).toMatchObject({ number: 32, checks: [{ name: 'check', state: 'pass' }] });
  });

  it('dispatches only on the user\'s answer, once, with the prompt as the user left it, and makes the subtask list', async () => {
    const { cockpit, created, file, todos, gh } = setup();
    const answer = { toolCallId: 'call_1', decision: 'dispatch' as const, title: 'Paski stref', prompt: PROMPT };
    const outcome = await cockpit.dispatch(CHAT, answer);
    expect(outcome).toMatchObject({ decision: 'dispatched', taskId: RUN, prompt: PROMPT });
    expect(await cockpit.dispatch(CHAT, answer)).toEqual(outcome); // a double click
    expect(created).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith({ task: PROMPT, title: 'Paski stref' });
    const list = (await todos.read()).data!.lists[0];
    expect(list.name).toBe('Wektor · Paski stref');
    expect(list.tasks.map(t => [t.title, t.by])).toEqual([['Pierwsze kryterium', 'agent'], ['Drugie', 'agent'], ['Trzecie', 'agent']]);

    const view = await cockpit.view(CHAT, 'other/0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11');
    expect(view.task?.id).toBe(RUN); // what the chat dispatched wins over what it mentions
    expect(view.list).toMatchObject({ id: list.id, tasks: [{ title: 'Pierwsze kryterium', done: false }, {}, {}] });
    expect(view.dispatches.call_1).toMatchObject({ decision: 'dispatched' });
    await cockpit.view(CHAT);
    expect(gh).toHaveBeenCalledTimes(1); // the PR is read gently
    expect(JSON.parse(readFileSync(file, 'utf8')).chats[CHAT].runs).toEqual([RUN]);
  });

  it('keeps a refusal, and dispatches nothing for it', async () => {
    const { cockpit, created, sources, file } = setup();
    await cockpit.dispatch(CHAT, { toolCallId: 'call_2', decision: 'reject', title: 'x', prompt: 'y' });
    expect(created).not.toHaveBeenCalled();
    // A restarted panel shows the same answer on the card.
    const again = createCockpit({ sources, file, cezarUrl: CEZAR, gh: async () => '{}' });
    expect((await again.view(CHAT)).dispatches.call_2).toMatchObject({ decision: 'rejected' });
  });

  it('a to-do item the task implements gives its own list as the subtasks', async () => {
    const { cockpit, todos } = setup();
    const made = await todos.apply({ action: 'createList', name: 'Moje' });
    const item = await todos.apply({ action: 'addTask', list: made.list!.id, title: 'Zrobić paski' });
    await cockpit.dispatch(CHAT, { toolCallId: 'call_3', decision: 'dispatch', title: 'Paski', prompt: PROMPT, todoId: item.task!.id as `t-${string}` });
    expect((await todos.read()).data!.lists).toHaveLength(1);
    expect((await cockpit.view(CHAT)).list).toMatchObject({ name: 'Moje', tasks: [{ title: 'Zrobić paski' }] });
  });

  it('without the GitHub CLI says the checks are not known, and keeps the PR', async () => {
    const { sources, file } = setup();
    const cockpit = createCockpit({ sources, file, cezarUrl: CEZAR, gh: async () => { throw new Error('gh: not found'); } });
    const view = await cockpit.view(CHAT, RUN);
    expect(view.pr).toMatchObject({ number: 32, checks: [], checksError: expect.stringContaining('gh') });
  });
});

describe('cockpit routes', () => {
  it('reads freely on loopback, but only the panel\'s own page may answer a card; ids are checked', async () => {
    const { createPanelServer } = await import('./app');
    const { createScenarioSources } = await import('./scenario');
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-route-'));
    const sources = createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: CEZAR, gh: async () => '{}' });
    const chat = { get: async () => ({}) } as never;
    const server = createPanelServer(sources, dir, undefined, chat, { cockpit }).listen(0, '127.0.0.1');
    await new Promise(done => server.once('listening', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const CHAT = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11';
    try {
      expect((await fetch(`${base}/api/chats/${CHAT}/cockpit`)).status).toBe(200);
      expect((await fetch(`${base}/api/chats/${CHAT}/cockpit?run=../../etc`)).status).toBe(400);
      const body = JSON.stringify({ toolCallId: 'call_1', decision: 'dispatch', title: 'Paski', prompt: 'Task: x\n- [ ] Jedno' });
      expect((await fetch(`${base}/api/chats/${CHAT}/dispatch`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status).toBe(403);
      const ok = await fetch(`${base}/api/chats/${CHAT}/dispatch`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: base } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ decision: 'dispatched', taskId: expect.stringMatching(/^desk-panel\//) });
      const view = await (await fetch(`${base}/api/chats/${CHAT}/cockpit`)).json();
      expect(view.task).toMatchObject({ status: 'RUNNING', steps: expect.arrayContaining([{ label: 'Implement', state: 'pending' }]) });
      expect(view.list.tasks).toEqual([expect.objectContaining({ title: 'Jedno', done: false })]);
    } finally {
      server.closeAllConnections();
      await new Promise(done => server.close(done));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
