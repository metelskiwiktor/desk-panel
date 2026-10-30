// `just update`: bring origin/main into this checkout (never over a conflict),
// verify it, and serve the result — committed and uncommitted local changes included.
// On another branch it serves the checkout as it is, without pulling anything.
//   node scripts/update.mjs [--force]   --force redeploys even when nothing changed
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { verify } from './check.mjs';
import { installedMatches, recordInstalled } from './dependencies.mjs';

const BRANCH = 'main';
const REMOTE = `origin/${BRANCH}`;
const MARKER = '.deployed';
const force = process.argv.includes('--force');
const windows = process.platform === 'win32';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = text => text.split('\n').filter(Boolean);
function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  return spawnSync(command, args, { stdio: 'inherit', shell: windows }).status === 0;
}
function fail(message, details = []) {
  console.error(`\n✖ ${message}`);
  for (const line of details) console.error(`  ${line}`);
  process.exit(1);
}
function service(action) {
  if (!windows) { console.log(`(pomijam ${action} usługi — to nie Windows)`); return true; }
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'servy/desk-panel.ps1', '-Action', action];
  if (action === 'RESTART') args.push('-NoBuild');
  return run('powershell.exe', args);
}
/**
 * 'Running', 'Stopped', … ; '' when the service is not registered (before `just install`);
 * null when unknown (not Windows, or the query failed) — then the service actions decide.
 */
function serviceState() {
  if (!windows) return null;
  const { name } = JSON.parse(readFileSync('servy/services.json', 'utf8')).services.find(s => s.id === 'desk-panel');
  const query = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Service -Name '${name}' -ErrorAction SilentlyContinue).Status`], { encoding: 'utf8' });
  return query.status === 0 ? String(query.stdout ?? '').trim() : null;
}
/** Local files that differ from HEAD: modified, staged, deleted or untracked. */
const localChanges = () => [...new Set([...lines(git('diff', '--name-only', 'HEAD')), ...lines(git('ls-files', '--others', '--exclude-standard'))])];
/** Identifies exactly what would be served: HEAD plus every uncommitted change. */
function fingerprint() {
  const hash = createHash('sha256').update(git('rev-parse', 'HEAD')).update(git('diff', 'HEAD', '--binary'));
  for (const file of lines(git('ls-files', '--others', '--exclude-standard')).sort())
    hash.update(file).update(existsSync(file) ? readFileSync(file) : '');
  return hash.digest('hex');
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const onMain = branch === BRANCH;
if (onMain && !run('git', ['fetch', 'origin', BRANCH])) fail('Nie udało się pobrać zmian z origin.');

// 1. Bring in remote commits, but only when that cannot conflict with anything local.
const before = git('rev-parse', 'HEAD');
const incoming = onMain ? Number(git('rev-list', '--count', `HEAD..${REMOTE}`)) : 0;
if (!onMain) console.log(`Gałąź ${branch}: wdrażam ten katalog bez zaciągania ${REMOTE}.`);
else if (incoming) {
  const remoteFiles = lines(git('diff', '--name-only', `HEAD...${REMOTE}`));
  const overlap = localChanges().filter(file => remoteFiles.includes(file));
  if (overlap.length) fail(`Nic nie zaciągnięto: ${REMOTE} zmienia pliki, które masz zmienione lokalnie (niezacommitowane).`,
    [...overlap, '', 'Zacommituj je albo odłóż (git stash) i uruchom ponownie.']);
  const merge = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', 'HEAD', REMOTE], { encoding: 'utf8' });
  if (merge.status !== 0) {
    // Output: tree id, conflicted paths, blank line, messages.
    const [, ...rest] = merge.stdout.split('\n');
    fail(`Nic nie zaciągnięto: lokalne commity konfliktują z ${REMOTE}.`, rest.slice(0, rest.indexOf('') === -1 ? undefined : rest.indexOf('')));
  }
  if (!run('git', ['merge', '--no-edit', REMOTE])) fail('Scalenie nie powiodło się; sprawdź git status.');
  console.log(`✔ Zaciągnięto ${incoming} commit(ów) z ${REMOTE}.`);
} else console.log(`${REMOTE}: brak nowych zmian.`);

const local = localChanges();
if (local.length) console.log(`Lokalne niezacommitowane zmiany też zostaną wdrożone:\n  ${local.join('\n  ')}`);
const target = fingerprint();
// The proof lives in node_modules, so a separate pull cannot hide a changed lockfile.
const reinstall = !installedMatches();
if (!force && !reinstall && existsSync(MARKER) && readFileSync(MARKER, 'utf8').trim() === target) {
  console.log('\n✔ Usługa już serwuje tę wersję. Nic do zrobienia (--force wymusza ponowne wdrożenie).');
  process.exit(0);
}

// 2. Dependencies: a running service holds node_modules, so stop it before replacing them.
const state = serviceState();
const registered = state !== '';
let stopped = false;
if (reinstall) {
  if (!registered) console.log('Usługa nie jest zarejestrowana (just install) — instaluję zależności bez jej zatrzymywania.');
  else if (state !== 'Stopped') {
    stopped = service('STOP');
    if (!stopped) fail('Nie udało się zatrzymać usługi przed instalacją zależności.');
  }
  if (!run('npm', ['ci'])) { if (stopped) service('START'); fail('npm ci nie powiodło się.'); }
  recordInstalled();
}

// 3. Verify, then build next to the served dist and swap only on success.
const checked = await verify('dist.next');
if (!checked) {
  rmSync('dist.next', { recursive: true, force: true });
  if (stopped) service('START');
  fail('Testy, typy, martwy kod lub build nie przeszły. Usługa dalej serwuje poprzednią wersję frontendu.',
    incoming ? [`Zmiany z ${REMOTE} są już scalone lokalnie (poprzedni HEAD: ${before.slice(0, 8)}).`] : []);
}
rmSync('dist.old', { recursive: true, force: true });
if (existsSync('dist')) renameSync('dist', 'dist.old');
try { renameSync('dist.next', 'dist'); }
catch (error) {
  // Never leave the service without a frontend: put the served one back (a scenario server often holds dist.next).
  if (existsSync('dist.old')) renameSync('dist.old', 'dist');
  if (stopped) service('START');
  fail(`Nie udało się podmienić dist (${error.code}); usługa dalej serwuje poprzednią wersję. Zatrzymaj serwery scenariuszy (servy/README.md) i ponów.`);
}
rmSync('dist.old', { recursive: true, force: true });

// 4. Restart and confirm the API answers.
if (!registered) fail('Zbudowano i zweryfikowano, ale usługa nie jest zarejestrowana. Zarejestruj ją: just install');
if (!service(stopped ? 'START' : 'RESTART')) fail('Nie udało się zrestartować usługi (just service pokaże stan).');
if (windows) {
  let healthy = false;
  for (let i = 0; i < 20 && !healthy; i++) {
    await new Promise(done => setTimeout(done, 1000));
    healthy = await fetch('http://127.0.0.1:5174/api/system').then(r => r.ok, () => false);
  }
  if (!healthy) fail('Usługa nie odpowiada na http://127.0.0.1:5174 po restarcie. Sprawdź servy/logs/Desk-Panel/stderr.log.');
}
writeFileSync(MARKER, target + '\n');
console.log(`\n✔ Wdrożono ${git('rev-parse', '--short', 'HEAD')}${local.length ? ` + ${local.length} lokalnych zmian` : ''}.`);
