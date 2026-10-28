// Local trusted-PR preview controller. State is separate from Desk Panel's service and data.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = join(tmpdir(), 'desk-panel-pr-previews');
const [action, number] = process.argv.slice(2);
const valid = /^[1-9]\d{0,8}$/.test(number || '');
if (!['start', 'stop', 'status'].includes(action) || !valid) { console.error('Usage: node scripts/preview.mjs start|stop|status <PR number>'); process.exit(1); }
const dir = join(base, `pr-${number}`), checkout = join(dir, 'checkout'), stateFile = join(dir, 'state.json');
const launchFile = join(dir, 'launch.json');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readLaunch = () => { try { return JSON.parse(readFileSync(launchFile, 'utf8')); } catch { return null; } };
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } };
async function request(state, method = 'GET') {
  if (!state || state.pr !== Number(number) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(state.url) || !/^[a-f0-9]{64}$/.test(state.token || '')) return false;
  try { const r = await fetch(`${state.url}/__desk_preview_control`, { method, headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    return method === 'POST' ? true : JSON.stringify(await r.json()) === JSON.stringify({ pr: number, sha: state.sha });
  } catch { return false; }
}
const pause = ms => new Promise(r => setTimeout(r, ms));
const state = readState();
if (action === 'status') {
  if (await request(state)) console.log(JSON.stringify({ status: 'running', pr: state.pr, sha: state.sha, url: state.url }));
  else { console.log(JSON.stringify({ status: existsSync(dir) ? 'stale' : 'stopped', pr: Number(number) })); }
} else if (action === 'stop') {
  if (await request(state)) {
    if (!await request(state, 'POST')) throw new Error('Preview did not accept stop');
    for (let i = 0; i < 40 && await request(state); i++) await pause(250);
    if (await request(state)) throw new Error('Preview is still running; retry stop.');
  }
  const launch = readLaunch();
  if (launch && Number.isInteger(launch.pid)) {
    for (let i = 0; i < 40 && alive(launch.pid); i++) await pause(250);
    if (alive(launch.pid)) throw new Error('Preview process is still running or its PID was reused; inspect it before cleanup.');
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  console.log(`Preview PR #${number} stopped and cleaned up.`);
} else {
  if (existsSync(dir)) throw new Error(`Preview state already exists. Run: node scripts/preview.mjs stop ${number}`);
  mkdirSync(base, { recursive: true });
  mkdirSync(dir);
  try {
    const cwd = process.cwd();
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }).trim();
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(remote)) throw new Error('origin must be a GitHub HTTPS repository URL');
    execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', '--', cwd, checkout], { stdio: 'inherit' });
    execFileSync('git', ['fetch', '--no-tags', '--', remote, `refs/pull/${number}/head`], { cwd: checkout, stdio: 'inherit' });
    const sha = execFileSync('git', ['rev-parse', 'FETCH_HEAD^{commit}'], { cwd: checkout, encoding: 'utf8' }).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid resolved commit');
    execFileSync('git', ['checkout', '--detach', sha], { cwd: checkout, stdio: 'inherit' });
    // Do not inherit service/provider secrets or the user's npm configuration.
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, npm_config_userconfig: join(dir, 'npmrc') });
    console.log('Installing selected commit dependencies without lifecycle scripts...');
    const npm = process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd ci --ignore-scripts --no-audit --no-fund'], { cwd: checkout, env, stdio: 'inherit' }) : spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: checkout, env, stdio: 'inherit' });
    if (npm.status !== 0) throw new Error('Dependency installation failed; see output above.');
    copyFileSync(fileURLToPath(new URL('./preview-scenario.json', import.meta.url)), join(dir, 'scenario.json'));
    copyFileSync(fileURLToPath(new URL('./preview-worker.ts', import.meta.url)), join(checkout, '.desk-preview-worker.ts'));
    const token = randomBytes(32).toString('hex');
    Object.assign(env, { PREVIEW_PR: number, PREVIEW_SHA: sha, PREVIEW_STATE: stateFile, PREVIEW_TOKEN: token });
    const log = openSync(join(dir, 'preview.log'), 'a');
    const child = spawn(process.execPath, [join(checkout, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '.desk-preview-worker.ts'], { cwd: checkout, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    if (!child.pid) throw new Error('Could not launch preview worker.');
    writeFileSync(launchFile, JSON.stringify({ pid: child.pid }));
    child.unref(); closeSync(log);
    for (let i = 0; i < 120; i++) { await pause(250); if (!alive(child.pid)) break; const ready = readState(); if (await request(ready)) { console.log(JSON.stringify({ status: 'running', pr: ready.pr, sha: ready.sha, url: ready.url })); process.exit(0); } }
    throw new Error(`Preview did not become ready. Inspect ${join(dir, 'preview.log')}, then run stop ${number}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
