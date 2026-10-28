// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'desk-preview-test-'));
const checkout = join(dir, 'checkout'), alias = join(dir, 'RUNNER~1'), stateFile = join(dir, 'state.json'), token = 'a'.repeat(64);
let child, state, sha, output = '';
const pause = ms => new Promise(r => setTimeout(r, ms));

describe('isolated preview worker', () => {
  beforeAll(async () => {
    execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', '--', root, checkout], { stdio: 'ignore' });
    execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: checkout, stdio: 'ignore' });
    // A synthetic head differs from the checkout running the controller, on both sides of the API.
    const app = join(checkout, 'server', 'app.ts');
    writeFileSync(app, readFileSync(app, 'utf8').replace("res.setHeader('X-Content-Type-Options', 'nosniff');", "res.setHeader('X-Preview-Backend', 'selected-code'); res.setHeader('X-Content-Type-Options', 'nosniff');"));
    const index = join(checkout, 'index.html');
    writeFileSync(index, readFileSync(index, 'utf8').replace('</head>', '<meta name="selected-frontend" content="yes"></head>'));
    execFileSync('git', ['add', 'server/app.ts', 'index.html'], { cwd: checkout });
    execFileSync('git', ['-c', 'user.name=Preview Test', '-c', 'user.email=preview@example.invalid', '-c', 'core.hooksPath=', 'commit', '-m', 'synthetic preview head'], { cwd: checkout, stdio: 'ignore' });
    sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
    symlinkSync(join(root, 'node_modules'), join(checkout, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    copyFileSync(join(root, 'scripts', 'preview-worker.ts'), join(checkout, '.desk-preview-worker.ts'));
    copyFileSync(join(root, 'scripts', 'preview-scenario.json'), join(dir, 'scenario.json'));
    // Reproduce Windows runner's short-name spelling even on machines without 8.3 names.
    symlinkSync(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir');
    child = spawn(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '.desk-preview-worker.ts'], {
      cwd: alias, env: { ...process.env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, PREVIEW_PR: '123', PREVIEW_SHA: sha, PREVIEW_STATE: stateFile, PREVIEW_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c);
    for (let i = 0; i < 120; i++) { try { state = JSON.parse(readFileSync(stateFile, 'utf8')); break; } catch { if (child.exitCode !== null) break; await pause(250); } }
    if (!state) throw new Error(`Preview failed to start: ${output}`);
  }, 40000);
  afterAll(async () => {
    if (state) await fetch(`${state.url}/__desk_preview_control`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    if (child && child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), pause(5000)]);
    if (child && child.exitCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  });
  it('serves selected frontend and backend and shows exact identity', async () => {
    const responsePage = await fetch(state.url);
    expect(responsePage.status).toBe(200);
    const page = await responsePage.text();
    expect(page).toContain('selected-frontend'); expect(page).toContain(`PREVIEW PR #123 · ${sha}`);
    const source = await fetch(`${state.url}/src/main.tsx`);
    expect(source.status).toBe(200);
    expect(await source.text()).toContain('createRoot');
    // The canonical checkout must not relax Vite's access restriction.
    const outside = join(dir, 'outside.txt');
    writeFileSync(outside, 'outside checkout');
    const denied = await fetch(`${state.url}/@fs/${outside.replaceAll('\\', '/')}`);
    expect(denied.status).toBe(403);
    const response = await fetch(`${state.url}/api/calendar`);
    expect(response.headers.get('x-preview-backend')).toBe('selected-code');
    expect(JSON.stringify(await response.json())).toContain('Przykładowe spotkanie');
    expect((await fetch(`${state.url}/__desk_preview_control`)).status).toBe(403);
  }, 15000);
  it('keeps writes and Hermes chat in the scenario', async () => {
    const post = (path, body) => fetch(`${state.url}${path}`, { method: 'POST', headers: { origin: state.url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/bank/connect', {})).status).toBe(409);
    expect((await post('/api/google/connect', { email: 'test@example.invalid' })).status).toBe(409);
    expect((await post('/api/mail/action', { account: 'test@example.invalid', threadId: 'missing', action: 'read' })).status).toBeGreaterThanOrEqual(400);
    expect((await post('/api/cezar/action', { id: 'missing', action: 'archive' })).status).toBeGreaterThanOrEqual(400);
    expect((await post('/api/quotas/warmup/Claude/run', {})).status).toBeGreaterThanOrEqual(400);
    const run = await post('/api/cezar/runs', { task: 'Synthetic task' });
    expect(run.status).toBe(201);
    const createdRun = await run.json();
    expect(createdRun.id).toContain('00000000-0000-4000-8000-');
    expect((await fetch(createdRun.url)).status).toBe(404);
    expect((await post('/api/todos/action', { action: 'createList', name: 'Synthetic test' })).status).toBe(200);
    expect(JSON.stringify(await (await fetch(`${state.url}/api/todos`)).json())).toContain('Synthetic test');
    const created = await post('/api/chats', { text: 'Cześć', engine: 'hermes' });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    for (let i = 0; i < 80; i++) { const c = await (await fetch(`${state.url}/api/chats/${id}`)).json(); if (!c.running) { expect(JSON.stringify(c)).toMatch(/scenariusz|makiet|testow/i); return; } await pause(100); }
    throw new Error('Mock chat did not finish');
  }, 15000);
  it('keeps the watched synthetic PR link inside the loopback stand-in', async () => {
    const post = (path, body) => fetch(`${state.url}${path}`, { method: 'POST', headers: { origin: state.url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // The previous test dispatched the mock's first run. Ask the Hermes stand-in to watch it.
    const created = await post('/api/chats', { text: 'Nasłuchuj Cezara', engine: 'hermes' });
    const { id } = await created.json();
    for (let i = 0; i < 170; i++) {
      const view = await (await fetch(`${state.url}/api/chats/${id}/cockpit`)).json();
      if (view.pr) {
        expect(view.pr.number).toBe(42);
        expect(view.pr.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
        expect(view.task.prUrl).toBe(view.pr.url);
        expect((await fetch(view.pr.url)).status).toBe(404);
        return;
      }
      await pause(100);
    }
    throw new Error('Synthetic watched PR did not appear');
  }, 25000);

});
