import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrationHash } from './fila-migration';
import { filaDataSchema } from '../src/fila-contract';
import { validateCockpitSnapshot } from './cockpit';

/** An operation marker survives restarts. Unknown or unreadable markers fail closed. */
export function readCutoverMode(directory: string): 'legacy' | 'locked' | 'active' {
  let raw: string;
  try { raw = readFileSync(join(directory, 'fila-cutover.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'legacy';
    throw new Error('Nie można odczytać bramki przełączenia Fili.');
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && (value as { version?: unknown }).version === 1 &&
      (value as { state?: unknown }).state === 'active' &&
      typeof (value as { planHash?: unknown }).planHash === 'string' && /^[0-9a-f]{64}$/.test((value as { planHash: string }).planHash) &&
      typeof (value as { openedAt?: unknown }).openedAt === 'number' && Number.isFinite((value as { openedAt: number }).openedAt)) {
      const fila = JSON.parse(readFileSync(join(directory, 'fila.json'), 'utf8'));
      if (fila.version !== 1) throw new Error('Niepoprawny magazyn Fili.');
      filaDataSchema.parse(fila.data);
      validateCockpitSnapshot(JSON.parse(readFileSync(join(directory, 'cockpit.json'), 'utf8')));
      return 'active';
    }
    if (value && typeof value === 'object' && (value as { version?: unknown }).version === 1 &&
      (value as { state?: unknown }).state === 'locked') {
      const files = (value as { files?: Record<string, unknown> }).files;
      if (!files || Object.keys(files).sort().join(',') !== 'cockpit.json,fila.json') throw new Error('Brak manifestu magazynów.');
      for (const name of ['cockpit.json', 'fila.json']) {
        const expected = files[name];
        if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) throw new Error('Niepoprawny skrót.');
        const actual = createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
        if (actual !== expected) throw new Error('Magazyn zmienił się od instalacji.');
      }
      const bundle = (value as { kiosk?: unknown; kioskHash?: unknown });
      if (bundle.kiosk !== undefined && (typeof bundle.kioskHash !== 'string' || migrationHash(bundle.kiosk) !== bundle.kioskHash)) throw new Error('Niepoprawny plan kiosku.');
      return 'locked';
    }
  } catch { /* refuse malformed marker */ }
  throw new Error('Niepoprawna bramka przełączenia Fili; start zatrzymany.');
}

export function readCutoverKiosk(directory: string): unknown {
  if (readCutoverMode(directory) !== 'locked') return undefined;
  return (JSON.parse(readFileSync(join(directory, 'fila-cutover.json'), 'utf8')) as { kiosk?: unknown }).kiosk;
}
