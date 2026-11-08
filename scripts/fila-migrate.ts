import { readFile, writeFile, rename, realpath, lstat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { migrationHash, migrationInputSchema, migrationPlanSchema, previewMigration, type MigrationInput, type MigrationPlan } from '../server/fila-migration';
import { defaultFilaData } from '../server/fila';

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const inside = (root: string, file: string) => { const r = relative(root, file); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/** All output is confined to an explicitly marked offline workspace outside Git and outside live stores. */
async function workspace(directory: string) {
  const root = await realpath(resolve(directory));
  const repo = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  const servicePath = join(await realpath(homedir()), '.desk-panel');
  const service = await realpath(servicePath).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return servicePath;
    throw error;
  });
  if (inside(repo, root) || (inside(service, root) && !inside(join(service, 'fila-migration'), root))) throw new Error('Wybierz osobny katalog poza repo i magazynem usługi.');
  const marker = await json(join(root, 'offline.json'));
  if (marker.kind !== 'fila-migration-copy' || marker.version !== 1) throw new Error('Brak znacznika kopii offline.json.');
  // Refuse junctions/symlinks even within an otherwise valid workspace.
  for (const name of ['input.json', 'plan.json', 'report.json', 'result.json', 'before.json', 'trial.json', 'report.json.tmp', 'result.json.tmp']) {
    try { const info = await lstat(join(root, name)); if (info.isSymbolicLink() || info.nlink > 1) throw new Error('Dowiązanie w katalogu próby.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return root;
}

export async function runMigration(command: string, directory: string) {
  const root = await workspace(directory);
  const save = async (name: string, value: unknown, exclusive = false) => {
    const file = join(root, name);
    if (exclusive) return writeFile(file, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(`${file}.tmp`, file);
  };
  if (command === 'rollback') {
    const trial = await json(join(root, 'trial.json'));
    const current = await json(join(root, 'result.json'));
    const before = await json(join(root, 'before.json'));
    if (migrationHash(before) !== trial.beforeHash) throw new Error('Kopia sprzed próby zmieniła się.');
    if (migrationHash(current) === trial.beforeHash) return { restored: true, replayed: true };
    if (migrationHash(current) !== trial.resultHash) throw new Error('Po próbie pojawiły się zmiany: tylko naprawa w przód.');
    await save('result.json', before);
    return { restored: true, beforeHash: trial.beforeHash };
  }
  if (!['preview', 'trial'].includes(command)) throw new Error('Użycie: just fila-migrate preview|trial|rollback KATALOG_KOPII');
  let input: MigrationInput, plan: MigrationPlan, result: ReturnType<typeof previewMigration>;
  try {
    input = migrationInputSchema.parse(await json(join(root, 'input.json')));
    plan = migrationPlanSchema.parse(await json(join(root, 'plan.json')));
    result = previewMigration(input, plan);
  } catch (error) {
    await save('report.json', { status: 'refused', matches: false, approved: false, error: error instanceof Error ? error.message : 'Niepoprawne wejście.' });
    throw error;
  }
  await save('report.json', result.report);
  if (command === 'preview') return { matches: result.report.matches, records: result.report.records.length, unresolved: result.report.unresolved.length, approved: false };
  if (!result.report.matches) throw new Error('Porównanie niezgodne: próba odrzucona.');
  const before = { fila: { version: 1, data: defaultFilaData() }, cockpit: input.cockpit };
  const output = { fila: result.fila, cockpit: result.cockpit };
  const receipt = { sourceHash: plan.sourceHash, planHash: migrationHash(plan), beforeHash: migrationHash(before), resultHash: migrationHash(output) };
  // A retry cannot overwrite anything changed since the trial, even if a new plan has the same name.
  try {
    const existing = await json(join(root, 'trial.json'));
    if (migrationHash(existing) !== migrationHash(receipt)) throw new Error('Inna próba: użyj nowego katalogu kopii.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await save('before.json', before, true);
    await save('trial.json', receipt, true);
  }
  try {
    const current = await json(join(root, 'result.json'));
    if (![receipt.beforeHash, receipt.resultHash].includes(migrationHash(current))) throw new Error('Wynik ma nowe zapisy: tylko naprawa w przód.');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  await save('result.json', output);
  return { matches: true, resultHash: receipt.resultHash, records: result.report.records.length, unresolved: result.report.unresolved.length, approved: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  if (!command || !directory) { console.error('Użycie: just fila-migrate preview|trial|rollback KATALOG_KOPII'); process.exitCode = 1; }
  else runMigration(command, directory).then(result => console.log(JSON.stringify(result))).catch(() => {
    // Input validation may contain private values. Detailed reports stay in the offline workspace.
    console.error('Migracja odmówiona: sprawdź plan, skrót wejścia, znacznik kopii i integralność próby. Nie zmieniono danych usługi.'); process.exitCode = 1;
  });
}
