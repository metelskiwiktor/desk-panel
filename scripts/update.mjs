// `just update`: bring origin/main into this checkout (never over a conflict),
// verify it, and serve the result — committed and uncommitted local changes included.
//   node scripts/update.mjs [--force]   --force redeploys even when nothing changed
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

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
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'servy/desk-panel.ps1', '-Action', action]);
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

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== BRANCH) fail(`Usługa jest aktualizowana z gałęzi ${BRANCH}. Przełącz się na nią: git switch ${BRANCH}`);
if (!run('git', ['fetch', 'origin', BRANCH])) fail('Nie udało się pobrać zmian z origin.');

// 1. Bring in remote commits, but only when that cannot conflict with anything local.
const before = git('rev-parse', 'HEAD');
const incoming = Number(git('rev-list', '--count', `HEAD..${REMOTE}`));
if (incoming) {
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
if (!force && existsSync(MARKER) && readFileSync(MARKER, 'utf8').trim() === target) {
  console.log('\n✔ Usługa już serwuje tę wersję. Nic do zrobienia (--force wymusza ponowne wdrożenie).');
  process.exit(0);
}

// 2. Dependencies: the running service uses node_modules, so stop it before replacing them.
const lockChanged = incoming && lines(git('diff', '--name-only', before, 'HEAD')).includes('package-lock.json');
const reinstall = lockChanged || local.includes('package-lock.json') || !existsSync('node_modules');
let stopped = false;
if (reinstall) {
  stopped = service('STOP');
  if (!run('npm', ['ci'])) { if (stopped) service('START'); fail('npm ci nie powiodło się.'); }
}

// 3. Verify, then build next to the served dist and swap only on success.
const checked = run('npm', ['test']) && run('npx', ['tsc', '--noEmit']) && run('npx', ['vite', 'build', '--outDir', 'dist.next', '--emptyOutDir']);
if (!checked) {
  rmSync('dist.next', { recursive: true, force: true });
  if (stopped) service('START');
  fail('Testy lub build nie przeszły. Usługa dalej serwuje poprzednią wersję frontendu.',
    incoming ? [`Zmiany z ${REMOTE} są już scalone lokalnie (poprzedni HEAD: ${before.slice(0, 8)}).`] : []);
}
rmSync('dist.old', { recursive: true, force: true });
if (existsSync('dist')) renameSync('dist', 'dist.old');
renameSync('dist.next', 'dist');
rmSync('dist.old', { recursive: true, force: true });

// 4. Restart and confirm the API answers.
if (!service(stopped ? 'START' : 'RESTART')) fail('Nie udało się zrestartować usługi (just service pokaże stan).');
writeFileSync(MARKER, target + '\n');
if (windows) {
  let healthy = false;
  for (let i = 0; i < 20 && !healthy; i++) {
    await new Promise(done => setTimeout(done, 1000));
    healthy = await fetch('http://127.0.0.1:5174/api/system').then(r => r.ok, () => false);
  }
  if (!healthy) fail('Usługa nie odpowiada na http://127.0.0.1:5174 po restarcie. Sprawdź servy/logs/Desk-Panel/stderr.log.');
}
console.log(`\n✔ Wdrożono ${git('rev-parse', '--short', 'HEAD')}${local.length ? ` + ${local.length} lokalnych zmian` : ''}.`);
