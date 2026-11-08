import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { installCutoverCopy, openCutoverCopy, restoreCutoverCopy } from '../server/fila-cutover-install';
import { migrationHash, migrationPlanSchema } from '../server/fila-migration';
import { migrationInputSchema } from '../server/fila-migration';
import { kioskBundle } from '../server/fila-kiosk-plan';
import { captureCutoverSnapshot, verifyCutoverSnapshot } from '../server/fila-snapshot';

async function stopped() {
  if (process.platform !== 'win32') throw new Error('Kontrola usługi jest dostępna tylko na Windows.');
  // A missing service, another listener, or an unreadable SCM state is not evidence of a stopped owner.
  const script = "$ErrorActionPreference='Stop'; $s=Get-CimInstance Win32_Service -Filter \"Name='Desk-Panel'\"; if ($null -eq $s -or $s.State -ne 'Stopped' -or $s.ProcessId -ne 0) { exit 1 }; $l=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq 5174 }; if ($l) { exit 1 }";
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', timeout: 15000 });
}

function snapshotInputs(root: string, target: string) {
  const names = ['todos.json', 'cockpit.json', 'fila.json', 'automations.json', 'observers.json', 'panel.env', 'hermes.env', 'mcp-token', 'fila-tokens.json', 'hermes-chats', 'chats', 'chat-files'];
  const inputs = Object.fromEntries(names.map(name => [`panel/${name}`, join(target, name)]));
  inputs['kiosk/kiosk-export.json'] = join(root, 'kiosk-export.json');
  inputs['hermes/user-config.yaml'] = join(homedir(), '.hermes', 'config.yaml');
  inputs['hermes/user.env'] = join(homedir(), '.hermes', '.env');
  if (!process.env.LOCALAPPDATA) throw new Error('Brak LOCALAPPDATA.');
  inputs['hermes/service-config.yaml'] = join(process.env.LOCALAPPDATA, 'hermes', 'config.yaml');
  inputs['hermes/service.env'] = join(process.env.LOCALAPPDATA, 'hermes', '.env');
  return inputs;
}

async function main(command: string, directory: string, expectedHash?: string) {
  const root = await realpath(resolve(directory));
  const migration = await realpath(join(homedir(), '.desk-panel', 'fila-migration'));
  const rel = relative(migration, root);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Wybierz nowy katalog operacji w fila-migration.');
  const target = join(homedir(), '.desk-panel');
  if (command === 'identify') {
    const plan = migrationPlanSchema.parse(JSON.parse(await readFile(join(root, 'plan.json'), 'utf8')));
    const input = migrationInputSchema.parse(JSON.parse(await readFile(join(root, 'input.json'), 'utf8')));
    if (migrationHash(input) !== plan.sourceHash) throw new Error('Plan nie pasuje do wejścia.');
    const bundle = kioskBundle(input, plan, JSON.parse(await readFile(join(root, 'kiosk-export.json'), 'utf8')));
    return { planHash: migrationHash(plan), sourceHash: plan.sourceHash, kioskHash: migrationHash(bundle.snapshot) };
  }
  if (command === 'snapshot') {
    const exported = await lstat(join(root, 'kiosk-export.json'));
    if (!exported.isFile() || exported.isSymbolicLink() || exported.nlink > 1) throw new Error('Brak zwykłego pliku eksportu kiosku.');
    for (const name of ['plan.json', 'trial.json', 'result.json', 'approval.json']) {
      try { await lstat(join(root, name)); throw new Error('Snapshot wymaga nowego katalogu operacji.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await captureCutoverSnapshot(root, snapshotInputs(root, target), stopped);
    return;
  }
  if (command === 'restore' || command === 'open') {
    const backup = join(root, 'install-backup');
    const backupStat = await lstat(backup);
    if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) throw new Error('Niepoprawny katalog kopii.');
    for (const name of ['manifest.json', 'todos.json', 'cockpit.json']) {
      const stat = await lstat(join(backup, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('Niepoprawna kopia.');
    }
    try { const fila = await lstat(join(backup, 'fila.json')); if (!fila.isFile() || fila.isSymbolicLink() || fila.nlink > 1) throw new Error('Niepoprawna kopia Fili.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
    if (!expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash) || manifest.planHash !== expectedHash) throw new Error('Identyfikacja kopii nie zgadza się.');
    if (command === 'restore') {
      const marker = JSON.parse(await readFile(join(target, 'fila-cutover.json'), 'utf8'));
      // In prepared, no installation write began: preserve any newer source data instead of requiring a stale snapshot.
      if (marker.state !== 'prepared') await verifyCutoverSnapshot(root, snapshotInputs(root, target), stopped, ['panel/cockpit.json', 'panel/fila.json', 'kiosk/kiosk-export.json']);
      return restoreCutoverCopy(target, root, stopped);
    }
    const acceptance = await lstat(join(root, 'acceptance.json'));
    if (!acceptance.isFile() || acceptance.isSymbolicLink() || acceptance.nlink > 1) throw new Error('Niepoprawny odbiór.');
    return openCutoverCopy(target, root, expectedHash, stopped);
  }
  if (command !== 'install') throw new Error('Użycie: fila-cutover snapshot|install|restore|open KATALOG [HASH_PLANU]');
  for (const name of ['offline.json', 'input.json', 'plan.json', 'trial.json', 'result.json', 'approval.json', 'kiosk-export.json']) {
    const stat = await lstat(join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('Plik operacji jest dowiązaniem lub nie jest zwykłym plikiem.');
  }
  const read = async (name: string) => JSON.parse(await readFile(join(root, name), 'utf8'));
  const offline = await read('offline.json');
  if (offline.kind !== 'fila-migration-copy' || offline.version !== 1) throw new Error('Brak znacznika kopii.');
  const plan = migrationPlanSchema.parse(await read('plan.json'));
  const approval = await read('approval.json');
  if (!expectedHash || migrationHash(plan) !== expectedHash || approval.planHash !== expectedHash ||
      approval.sourceHash !== plan.sourceHash || approval.cutoverAuthorized !== true)
    throw new Error('Brak zgody na identyfikowany świeży plan i jego uruchomienie.');
  const kiosk = kioskBundle(migrationInputSchema.parse(await read('input.json')), plan, await read('kiosk-export.json'));
  if (approval.kioskHash !== migrationHash(kiosk.snapshot)) throw new Error('Zgoda nie identyfikuje eksportu kiosku.');
  await verifyCutoverSnapshot(root, snapshotInputs(root, target), stopped);
  return installCutoverCopy(target, root, expectedHash, stopped, kiosk);
}

const [command, directory, hash] = process.argv.slice(2);
if (!command || !directory) { console.error('Użycie: fila-cutover snapshot|install|restore|open KATALOG [HASH_PLANU]'); process.exitCode = 1; }
else main(command, directory, hash).then(result => console.log(result ? JSON.stringify(result) : 'Operacja zakończona.')).catch(() => {
  console.error('Operacja odmówiona albo przerwana. Nie otwieraj zapisów; sprawdź bramkę, kopię i warunki w procedurze.');
  process.exitCode = 1;
});
