import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Capture exactly the named inputs; missing files are explicit and links are never followed. */
export async function captureCutoverSnapshot(operation: string, inputs: Record<string, string>, assertStopped: () => Promise<void>) {
  await assertStopped();
  const root = join(operation, 'snapshot');
  await mkdir(root);
  const entries: { name: string; sha256: string | null }[] = [];
  async function capture(name: string, source: string): Promise<void> {
    let info;
    try { info = await lstat(source); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { entries.push({ name, sha256: null }); return; } throw error; }
    if (info.isSymbolicLink()) throw new Error('Kopia nie przechodzi przez dowiązania.');
    if (info.isDirectory()) {
      const children = await readdir(source);
      if (!children.length) entries.push({ name: `${name}/`, sha256: null });
      for (const child of children.sort()) await capture(`${name}/${child}`, join(source, child));
      return;
    }
    if (!info.isFile() || info.nlink > 1) throw new Error('Niepoprawny plik w kopii.');
    const destination = join(root, ...name.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const sourceBytes = await readFile(source), copy = await readFile(destination);
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    if (hash(sourceBytes) !== hash(copy)) throw new Error('Plik zmienił się podczas kopiowania.');
    entries.push({ name, sha256: hash(copy) });
  }
  for (const [name, source] of Object.entries(inputs)) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(name) || name.split('/').some(part => part === '..' || !part)) throw new Error('Niepoprawna nazwa kopii.');
    await capture(name, source);
  }
  await assertStopped();
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, entries }, null, 2), { flag: 'wx', mode: 0o600 });
  return entries.length;
}

/** Refuse a stale, incomplete or altered snapshot before installation. */
export async function verifyCutoverSnapshot(operation: string, inputs: Record<string, string>, assertStopped: () => Promise<void>, exclude: string[] = []) {
  await assertStopped();
  const root = join(operation, 'snapshot');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version?: number; entries?: { name: string; sha256: string | null }[] };
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Brak kompletnego manifestu kopii.');
  const current: { name: string; sha256: string | null }[] = [];
  async function observe(name: string, source: string): Promise<void> {
    let info;
    try { info = await lstat(source); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { current.push({ name, sha256: null }); return; } throw error; }
    if (info.isSymbolicLink()) throw new Error('Dowiązanie w danych kopii.');
    if (info.isDirectory()) {
      const children = await readdir(source);
      if (!children.length) current.push({ name: `${name}/`, sha256: null });
      for (const child of children.sort()) await observe(`${name}/${child}`, join(source, child));
      return;
    }
    if (!info.isFile() || info.nlink > 1) throw new Error('Niepoprawny plik danych.');
    const hash = createHash('sha256').update(await readFile(source)).digest('hex');
    const copy = await readFile(join(root, ...name.split('/')));
    if (hash !== createHash('sha256').update(copy).digest('hex')) throw new Error('Kopia różni się od źródła.');
    current.push({ name, sha256: hash });
  }
  const omitted = new Set(exclude);
  for (const [name, source] of Object.entries(inputs)) if (!omitted.has(name)) await observe(name, source);
  const expected = manifest.entries.filter(entry => !omitted.has(entry.name));
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Lista lub skróty źródeł zmieniły się od snapshotu.');
  await assertStopped();
}
