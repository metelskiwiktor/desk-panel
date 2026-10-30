// Local trusted-PR preview controller. State is separate from Desk Panel's service and data.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, openSync, closeSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep this selection stable for start, status and stop; do not silently move existing previews.
const configuredRoot = process.env.DESK_PREVIEW_ROOT?.trim();
if (configuredRoot && !isAbsolute(configuredRoot)) {
  console.error('DESK_PREVIEW_ROOT must be an absolute directory path.');
  process.exit(1);
}
const base = configuredRoot || join(tmpdir(), 'desk-panel-pr-previews');
const [action, number] = process.argv.slice(2);
const valid = /^[1-9]\d{0,8}$/.test(number || '');
if (!['start', 'stop', 'status'].includes(action) || !valid) { console.error('Usage: node scripts/preview.mjs start|stop|status <PR number>'); process.exit(1); }
const dir = join(base, `pr-${number}`), checkout = join(dir, 'checkout'), stateFile = join(dir, 'state.json');
const launchFile = join(dir, 'launch.json'), setupFile = join(dir, 'setup.json');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const readLaunch = () => { try { return JSON.parse(readFileSync(launchFile, 'utf8')); } catch { return null; } };
const readSetup = () => { try { return JSON.parse(readFileSync(setupFile, 'utf8')); } catch { return null; } };
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } };
async function request(state, method = 'GET') {
  if (!state || state.pr !== Number(number) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(state.url) || !/^[a-f0-9]{64}$/.test(state.token || '')) return false;
  try { const r = await fetch(`${state.url}/__desk_preview_control`, { method, headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    return method === 'POST' ? true : JSON.stringify(await r.json()) === JSON.stringify({ pr: number, sha: state.sha });
  } catch { return false; }
}
const pause = ms => new Promise(r => setTimeout(r, ms));
function processIdentity(operation, launch) {
  if (process.platform !== 'win32') throw new Error('Automatic recovery of an unresponsive preview is available on Windows only; inspect the PID manually.');
  const helper = fileURLToPath(new URL('./preview-process.ps1', import.meta.url));
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Operation', operation, '-ProcessId', String(launch.pid || 0), '-Marker', launch.marker];
  if (operation === 'terminate') args.push('-Creation', launch.creation);
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (result.status !== 0) throw new Error(`Unable to verify preview process identity: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
  return result.stdout.trim();
}
// Shared by stop and failed start. A missing creation time is recovered only after checking
// the random marker on the process; termination compares the creation time on one OS handle.
async function recoverWorker(record) {
  if (!record) return;
  let launch = record;
  if (launch.pending) {
    if (!/^[a-f0-9]{64}$/.test(launch.marker || '')) throw new Error('Preview launch marker is invalid; inspect before cleanup.');
    const found = processIdentity('find', launch);
    if (found === 'gone') return;
    if (!/^\d+$/.test(found)) throw new Error('Could not identify the pending preview process.');
    launch = { pid: Number(found), marker: launch.marker };
  }
  if (!Number.isInteger(launch.pid) || launch.pid <= 0 || !/^[a-f0-9]{64}$/.test(launch.marker || '')) throw new Error('Preview process identity is incomplete; inspect before cleanup.');
  if (!alive(launch.pid)) return;
  if (!launch.creation) {
    const creation = processIdentity('identify', launch);
    if (creation === 'gone' && !alive(launch.pid)) return;
    if (!/^\d+$/.test(creation)) throw new Error('Could not verify preview process creation time.');
    launch = { ...launch, creation };
  }
  if (!/^\d+$/.test(launch.creation)) throw new Error('Invalid preview process creation time.');
  const result = processIdentity('terminate', launch);
  if (result === 'mismatch') throw new Error('Preview PID belongs to a different process; inspect it before cleanup.');
  if (!['terminated', 'gone'].includes(result)) throw new Error('Could not stop verified preview process.');
  for (let i = 0; i < 40 && alive(launch.pid); i++) await pause(250);
  if (alive(launch.pid)) throw new Error('Preview process is still running or its PID was reused; inspect it before cleanup.');
}
const state = readState();
if (action === 'status') {
  if (await request(state)) console.log(JSON.stringify({ status: 'running', pr: state.pr, sha: state.sha, url: state.url }));
  else { console.log(JSON.stringify({ status: existsSync(dir) ? 'stale' : 'stopped', pr: Number(number) })); }
} else if (action === 'stop') {
  if (await request(state)) {
    await request(state, 'POST');
    for (let i = 0; i < 40 && await request(state); i++) await pause(250);
  }
  const launch = readLaunch();
  const setup = readSetup();
  if (!launch && setup?.pid && alive(setup.pid)) throw new Error('Preview is still preparing the checkout or dependencies; wait for start to finish before stopping.');
  if (!launch && existsSync(launchFile)) throw new Error('Preview process identity is unreadable; inspect it before cleanup.');
  if (state && launch?.pid) for (let i = 0; i < 40 && alive(launch.pid); i++) await pause(250);
  if (launch?.pending && setup?.pid && alive(setup.pid)) throw new Error('Preview launch is still in progress; retry stop shortly.');
  await recoverWorker(launch);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  console.log(`Preview PR #${number} stopped and cleaned up.`);
} else {
  if (existsSync(dir)) throw new Error(`Preview state already exists. Run: node scripts/preview.mjs stop ${number}`);
  let spawned;
  try {
    mkdirSync(base, { recursive: true });
    mkdirSync(dir);
    writeFileSync(setupFile, JSON.stringify({ pid: process.pid }));
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
    copyFileSync(fileURLToPath(new URL('./preview-worker.ts', import.meta.url)), join(checkout, 'scripts/.desk-preview-worker.ts'));
    const token = randomBytes(32).toString('hex');
    Object.assign(env, { PREVIEW_PR: number, PREVIEW_SHA: sha, PREVIEW_STATE: stateFile, PREVIEW_TOKEN: token });
    const log = openSync(join(dir, 'preview.log'), 'a');
    const marker = randomBytes(32).toString('hex');
    // A pending record prevents concurrent cleanup during the process spawn.
    writeFileSync(launchFile, JSON.stringify({ marker, pending: true }));
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/.desk-preview-worker.ts', marker], { cwd: checkout, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    if (!child.pid) throw new Error('Could not launch preview worker.');
    const launch = { pid: child.pid, marker };
    spawned = launch;
    child.unref(); closeSync(log);
    writeFileSync(`${launchFile}.next`, JSON.stringify(launch));
    renameSync(`${launchFile}.next`, launchFile);
    if (process.platform === 'win32') {
      const creation = processIdentity('identify', launch);
      if (!/^\d+$/.test(creation)) throw new Error('Could not identify preview process; see preview log.');
      Object.assign(launch, { creation });
      const nextFile = `${launchFile}.next`;
      writeFileSync(nextFile, JSON.stringify(launch));
      renameSync(nextFile, launchFile);
    }
    rmSync(setupFile, { force: true });

    for (let i = 0; i < 120; i++) { await pause(250); if (!alive(child.pid)) break; const ready = readState(); if (await request(ready)) { console.log(JSON.stringify({ status: 'running', pr: ready.pr, sha: ready.sha, url: ready.url })); process.exit(0); } }
    throw new Error(`Preview did not become ready. Inspect ${join(dir, 'preview.log')}, then run stop ${number}.`);
  } catch (error) {
    const failure = spawned && !alive(spawned.pid) ? 'The preview worker exited before it was ready.' : error.message;
    if (spawned) {
      try {
        await recoverWorker(readLaunch() || spawned);
        console.error('The preview worker has stopped.');
      } catch (cleanupError) {
        console.error(`Could not safely stop the preview worker: ${cleanupError.message}. Run stop after resolving the identity problem; do not kill an unverified PID.`);
      }
      console.error(`Preview startup failed: ${failure}\nInspect ${join(dir, 'preview.log')}. The selected PR may be incompatible with the preview scenario APIs. Run stop ${number} to remove retained files.`);
    } else console.error(error.message);
    if (process.platform === 'win32' && !spawned) console.error('If Git or npm reports a path that is too long, set DESK_PREVIEW_ROOT to a short absolute directory and use that same setting for start, status and stop. See docs/testowanie.md.');
    process.exitCode = 1;
  }
}
