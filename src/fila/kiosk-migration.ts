import { parseWorkspace, WORKSPACE_KEY } from '../tile-grid';
import { PULPITS_KEY } from '../pulpits';

export interface KioskExport {
  version: 1; kind: 'desk-panel-pulpits'; origin: string; pulpits: string | null;
  workspaces: { key: string; raw: string }[]; missingWorkspaces: string[];
}
export interface KioskTilePlan { source: string; tile: string; query: string; settings: Record<string, string | number | boolean> }
export const KIOSK_JOURNAL = 'desk-panel.fila-cutover-journal';
export const KIOSK_BACKUP = 'desk-panel.fila-cutover-backup';

/** Prepare without writing: every raw value and every key must still match the exported profile. */
export function planKiosk(storage: Storage, origin: string, snapshot: KioskExport, rows: KioskTilePlan[]) {
  if (snapshot.version !== 1 || snapshot.kind !== 'desk-panel-pulpits' || snapshot.origin !== origin ||
      !Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.missingWorkspaces) || !Array.isArray(rows)) throw new Error('Niepoprawny eksport kiosku.');
  if (storage.getItem(PULPITS_KEY) !== snapshot.pulpits) throw new Error('Nazwy lub wybór pulpitów zmieniły się od eksportu.');
  const entries = new Map<string, string>();
  for (const entry of snapshot.workspaces) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.raw !== 'string' || entries.has(entry.key) ||
        !(entry.key === WORKSPACE_KEY || entry.key.startsWith(`${WORKSPACE_KEY}.`)) || !parseWorkspace(entry.raw)) throw new Error('Niepoprawny układ w eksporcie.');
    entries.set(entry.key, entry.raw);
  }
  const missing = new Set(snapshot.missingWorkspaces);
  if (missing.size !== snapshot.missingWorkspaces.length || [...missing].some(key => typeof key !== 'string' || entries.has(key) || !(key === WORKSPACE_KEY || key.startsWith(`${WORKSPACE_KEY}.`)))) throw new Error('Niepoprawna lista brakujących układów.');
  for (const [key, raw] of entries) if (storage.getItem(key) !== raw) throw new Error('Układ kiosku zmienił się od eksportu.');
  for (const key of missing) if (storage.getItem(key) !== null) throw new Error('Pojawił się nowy układ kiosku.');
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (key === WORKSPACE_KEY || key.startsWith(`${WORKSPACE_KEY}.`)) && !entries.has(key)) throw new Error('Eksport nie obejmuje wszystkich układów.');
  }
  const updated = new Map(entries);
  const seen = new Set<string>();
  for (const row of rows) {
    const candidates = [...entries.keys()].filter(key => row.source.endsWith(` ${key}`));
    if (candidates.length !== 1 || typeof row.tile !== 'string' || typeof row.query !== 'string' || !row.query.trim() || !row.settings || typeof row.settings !== 'object') throw new Error('Kafelek nie wskazuje jednego układu.');
    const key = candidates[0], identity = `${key}|${row.tile}`;
    if (seen.has(identity)) throw new Error('Kafelek występuje w planie dwukrotnie.');
    seen.add(identity);
    const data = JSON.parse(updated.get(key)!);
    const matches = data.tiles.filter((tile: { id?: string; kind?: string }) => (tile.id ?? tile.kind) === row.tile && tile.kind === 'todo');
    if (matches.length !== 1) throw new Error('Nie znaleziono kafelka z planu.');
    matches[0].config = { ...row.settings, query: row.query };
    const raw = JSON.stringify(data);
    if (!parseWorkspace(raw)) throw new Error('Wynikowy układ jest niepoprawny.');
    updated.set(key, raw);
  }
  const todoCount = [...entries.values()].reduce((count, raw) => count + parseWorkspace(raw)!.filter(tile => tile.kind === 'todo').length, 0);
  if (seen.size !== todoCount) throw new Error('Plan nie obejmuje wszystkich kafelków Zadania.');
  return [...entries].filter(([key, raw]) => updated.get(key) !== raw).map(([key, before]) => ({ key, before, after: updated.get(key)! }));
}

/** A write-ahead record lets the next launch recover an interrupted multi-key change. */
export function recoverKiosk(storage: Storage) {
  let raw: string | null;
  try { raw = storage.getItem(KIOSK_JOURNAL); }
  catch { return; } // No journal was observed: preserve the panel's normal session-only operation.
  if (!raw) return;
  const journal = JSON.parse(raw) as { complete: boolean; changes: { key: string; before: string; after: string }[] };
  if (!Array.isArray(journal.changes) || typeof journal.complete !== 'boolean') throw new Error('Niepoprawny dziennik konfiguracji kiosku.');
  for (const change of journal.changes) {
    if (!(change.key === WORKSPACE_KEY || change.key.startsWith(`${WORKSPACE_KEY}.`)) || typeof change.before !== 'string' || typeof change.after !== 'string' ||
        ![change.before, change.after].includes(storage.getItem(change.key) ?? '')) throw new Error('Układ zmieniono podczas odtwarzania.');
  }
  if (journal.complete && journal.changes.some(change => storage.getItem(change.key) !== change.after)) throw new Error('Układ zmieniono po zastosowaniu planu.');
  if (!journal.complete) for (const change of journal.changes) storage.setItem(change.key, change.before);
  storage.removeItem(KIOSK_JOURNAL);
}

export function applyKiosk(storage: Storage, changes: ReturnType<typeof planKiosk>) {
  if (storage.getItem(KIOSK_JOURNAL)) throw new Error('Istnieje niedokończona zmiana kiosku.');
  for (const change of changes) if (storage.getItem(change.key) !== change.before) throw new Error('Układ kiosku zmienił się od sprawdzenia.');
  const backup = storage.getItem(KIOSK_BACKUP);
  if (backup && backup !== JSON.stringify(changes)) throw new Error('Istnieje kopia innej zmiany kiosku.');
  if (!backup) storage.setItem(KIOSK_BACKUP, JSON.stringify(changes));
  storage.setItem(KIOSK_JOURNAL, JSON.stringify({ complete: false, changes }));
  for (const change of changes) storage.setItem(change.key, change.after);
  storage.setItem(KIOSK_JOURNAL, JSON.stringify({ complete: true, changes }));
  storage.removeItem(KIOSK_JOURNAL);
}

export function restoreKiosk(storage: Storage) {
  if (storage.getItem(KIOSK_JOURNAL)) throw new Error('Najpierw odtwórz niedokończoną zmianę.');
  const raw = storage.getItem(KIOSK_BACKUP);
  if (!raw) throw new Error('Brak kopii konfiguracji kiosku.');
  const backup = JSON.parse(raw) as { key: string; before: string; after: string }[];
  if (!Array.isArray(backup) || backup.some(change => !(change.key === WORKSPACE_KEY || change.key.startsWith(`${WORKSPACE_KEY}.`)) ||
    typeof change.before !== 'string' || typeof change.after !== 'string')) throw new Error('Niepoprawna kopia układu.');
  if (backup.every(change => storage.getItem(change.key) === change.before)) return;
  if (backup.some(change => storage.getItem(change.key) !== change.after)) throw new Error('Układ zmieniono po migracji; nie można go nadpisać.');
  const changes = backup.map(change => ({ key: change.key, before: change.after, after: change.before }));
  storage.setItem(KIOSK_JOURNAL, JSON.stringify({ complete: false, changes }));
  for (const change of changes) storage.setItem(change.key, change.after);
  storage.setItem(KIOSK_JOURNAL, JSON.stringify({ complete: true, changes }));
  storage.removeItem(KIOSK_JOURNAL);
}
