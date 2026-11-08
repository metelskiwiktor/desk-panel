import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrationHash, migrationInputSchema, migrationPlanSchema, previewMigration } from './fila-migration';
import { defaultFilaData, installFilaSnapshot } from './fila';
import { installCockpitSnapshot } from './cockpit';
import { readCutoverMode } from './fila-cutover-gate';

const digest = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;
const missing = async (path: string) => {
  try { return await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
};

/** Installs a verified rehearsal, under an already stopped store owner. Failure leaves an installing marker. */
export async function installCutoverCopy(directory: string, operation: string, expectedPlanHash: string, assertStopped: () => Promise<void>, kiosk?: unknown) {
  const input = migrationInputSchema.parse(await json(join(operation, 'input.json')));
  const plan = migrationPlanSchema.parse(await json(join(operation, 'plan.json')));
  const receipt = await json(join(operation, 'trial.json')) as Record<string, unknown>;
  const savedResult = await json(join(operation, 'result.json'));
  const result = previewMigration(input, plan);
  const output = { fila: result.fila, cockpit: result.cockpit };
  if (!/^[0-9a-f]{64}$/.test(expectedPlanHash) || migrationHash(plan) !== expectedPlanHash ||
      receipt.planHash !== expectedPlanHash || receipt.sourceHash !== plan.sourceHash ||
      receipt.resultHash !== migrationHash(output) || migrationHash(savedResult) !== migrationHash(output) ||
      !result.report.matches || result.report.unresolved.length) throw new Error('Plan lub wynik próby nie zgadza się z identyfikacją.');
  await assertStopped();
  const marker = join(directory, 'fila-cutover.json');
  const oldTodos = await readFile(join(directory, 'todos.json'));
  const oldCockpit = await readFile(join(directory, 'cockpit.json'));
  const oldFila = await missing(join(directory, 'fila.json'));
  if (migrationHash(JSON.parse(oldTodos.toString('utf8'))) !== migrationHash(input.todos) ||
      migrationHash(JSON.parse(oldCockpit.toString('utf8'))) !== migrationHash(input.cockpit)) throw new Error('Magazyn zmienił się od kopii.');
  if (oldFila && migrationHash(JSON.parse(oldFila.toString('utf8'))) !== migrationHash({ version: 1, data: defaultFilaData() })) throw new Error('Cel Fili nie jest pusty.');
  const backup = join(operation, 'install-backup');
  await mkdir(backup); // existing backup belongs to a previous attempt; never overwrite it
  await writeFile(join(backup, 'todos.json'), oldTodos, { flag: 'wx', mode: 0o600 });
  await writeFile(join(backup, 'cockpit.json'), oldCockpit, { flag: 'wx', mode: 0o600 });
  if (oldFila) await writeFile(join(backup, 'fila.json'), oldFila, { flag: 'wx', mode: 0o600 });
  const fila = Buffer.from(JSON.stringify(output.fila, null, 2));
  const cockpit = Buffer.from(JSON.stringify(output.cockpit, null, 2));
  const manifest = { version: 1, planHash: expectedPlanHash, sourceHash: plan.sourceHash,
    before: { todos: digest(oldTodos), cockpit: digest(oldCockpit), fila: oldFila ? digest(oldFila) : null },
    files: { 'fila.json': digest(fila), 'cockpit.json': digest(cockpit) } };
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  // The complete recovery manifest exists before creating a marker that blocks startup.
  await assertStopped();
  await writeFile(marker, JSON.stringify({ version: 1, state: 'prepared' }), { flag: 'wx', mode: 0o600 });
  await assertStopped();
  const checkTodos = await readFile(join(directory, 'todos.json'));
  const checkCockpit = await readFile(join(directory, 'cockpit.json'));
  const checkFila = await missing(join(directory, 'fila.json'));
  if (digest(checkTodos) !== manifest.before.todos || digest(checkCockpit) !== manifest.before.cockpit ||
      (checkFila ? digest(checkFila) : null) !== manifest.before.fila) throw new Error('Magazyn zmienił się podczas przygotowania.');
  const installing = `${marker}.tmp`;
  await writeFile(installing, JSON.stringify({ version: 1, state: 'installing' }), { flag: 'wx', mode: 0o600 });
  await rename(installing, marker);
  await installFilaSnapshot(join(directory, 'fila.json'), fila);
  await installCockpitSnapshot(join(directory, 'cockpit.json'), cockpit);
  await assertStopped();
  const next = `${marker}.tmp`;
  await writeFile(next, JSON.stringify({ version: 1, state: 'locked', files: manifest.files, planHash: expectedPlanHash,
    ...(kiosk === undefined ? {} : { kiosk, kioskHash: migrationHash(kiosk) }) }), { flag: 'wx', mode: 0o600 });
  await rename(next, marker);
  return manifest;
}

/** Restore the byte-exact pre-install stores only before opening writes; unknown changes stop the rollback. */
export async function restoreCutoverCopy(directory: string, operation: string, assertStopped: () => Promise<void>) {
  await assertStopped();
  const backup = join(operation, 'install-backup');
  const manifest = await json(join(backup, 'manifest.json')) as { before: { todos: string; cockpit: string; fila: string | null }; files: Record<string, string> };
  const marker = join(directory, 'fila-cutover.json');
  const markerValue = await json(marker) as { version?: number; state?: string };
  if (markerValue.version !== 1 || !['prepared', 'installing', 'locked'].includes(markerValue.state ?? '')) throw new Error('Brak zamkniętej bramki.');
  const todos = await readFile(join(backup, 'todos.json'));
  const cockpit = await readFile(join(backup, 'cockpit.json'));
  const fila = await missing(join(backup, 'fila.json'));
  if (digest(todos) !== manifest.before.todos || digest(cockpit) !== manifest.before.cockpit ||
      (fila ? digest(fila) : null) !== manifest.before.fila) throw new Error('Kopia została zmieniona.');
  // No store write starts before this phase is durably replaced by `installing`.
  if (markerValue.state === 'prepared') { await assertStopped(); await unlink(marker); return; }
  for (const [name, before] of [['todos.json', manifest.before.todos], ['cockpit.json', manifest.before.cockpit], ['fila.json', manifest.before.fila]] as const) {
    const current = await missing(join(directory, name));
    const hash = current ? digest(current) : null;
    if (hash !== before && hash !== manifest.files[name]) throw new Error('Magazyn ma nieznane zmiany; naprawa w przód.');
  }
  const intermediate = `${marker}.restore-tmp`;
  await writeFile(intermediate, JSON.stringify({ version: 1, state: 'installing' }), { flag: 'wx', mode: 0o600 });
  await rename(intermediate, marker);
  await assertStopped();
  await installCockpitSnapshot(join(directory, 'cockpit.json'), cockpit, 'restore-tmp');
  if (fila) await installFilaSnapshot(join(directory, 'fila.json'), fila, 'restore-tmp');
  else await unlink(join(directory, 'fila.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await assertStopped();
  await unlink(marker);
}

/** One-way boundary: after this marker is installed only forward repair is allowed. */
export async function openCutoverCopy(directory: string, operation: string, expectedPlanHash: string, assertStopped: () => Promise<void>) {
  await assertStopped();
  if (readCutoverMode(directory) !== 'locked') throw new Error('Brak zamkniętej i sprawdzonej bramki.');
  const marker = join(directory, 'fila-cutover.json');
  const current = await json(marker) as { planHash?: string; kiosk?: { snapshot?: unknown } };
  const manifest = await json(join(operation, 'install-backup', 'manifest.json')) as { planHash?: string };
  const acceptance = await json(join(operation, 'acceptance.json')) as { planHash?: string; kioskHash?: string; checks?: Record<string, unknown> };
  const checks = ['data', 'legacyIds', 'kiosk', 'clients', 'cezar', 'oldApi', 'gate'];
  if (current.planHash !== expectedPlanHash || manifest.planHash !== expectedPlanHash || acceptance.planHash !== expectedPlanHash ||
      !current.kiosk?.snapshot || acceptance.kioskHash !== migrationHash(current.kiosk.snapshot) ||
      !acceptance.checks || checks.some(name => acceptance.checks?.[name] !== true)) throw new Error('Odbiór nie potwierdza całego planu.');
  await assertStopped();
  const temp = `${marker}.open-tmp`;
  await writeFile(temp, JSON.stringify({ version: 1, state: 'active', planHash: expectedPlanHash, openedAt: Date.now() }), { flag: 'wx', mode: 0o600 });
  await rename(temp, marker);
}
