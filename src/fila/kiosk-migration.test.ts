import { beforeEach, expect, it } from 'vitest';
import { applyKiosk, KIOSK_BACKUP, KIOSK_JOURNAL, planKiosk, recoverKiosk, restoreKiosk, type KioskExport } from './kiosk-migration';

const key = 'desk-panel.workspace.p1';
const raw = JSON.stringify({ version: 1, tiles: [{ id: 'todo#1', kind: 'todo', c: 0, r: 0, w: 2, h: 1, config: { list: 'l-12345678' } }, { id: 'mail', kind: 'mail', c: 2, r: 0, w: 1, h: 1 }] });
const snapshot: KioskExport = { version: 1, kind: 'desk-panel-pulpits', origin: 'http://127.0.0.1:5174', pulpits: '{"version":1}', workspaces: [{ key, raw }], missingWorkspaces: [] };
const rows = [{ source: `kiosk / http://127.0.0.1:5174 / ${key}`, tile: 'todo#1', query: 'projekt = DESK AND otwarte', settings: { showAgent: false } }];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desk-panel.pulpits', snapshot.pulpits!); localStorage.setItem(key, raw); });

it('changes only the planned configuration and preserves a backup', () => {
  const changes = planKiosk(localStorage, snapshot.origin, snapshot, rows);
  applyKiosk(localStorage, changes);
  const before = JSON.parse(raw), after = JSON.parse(localStorage.getItem(key)!);
  expect(after.tiles[0]).toEqual({ ...before.tiles[0], config: { query: rows[0].query, showAgent: false } });
  expect(after.tiles[1]).toEqual(before.tiles[1]);
  expect(JSON.parse(localStorage.getItem(KIOSK_BACKUP)!)[0].before).toBe(raw);
  expect(localStorage.getItem(KIOSK_JOURNAL)).toBeNull();
  restoreKiosk(localStorage);
  restoreKiosk(localStorage);
  applyKiosk(localStorage, planKiosk(localStorage, snapshot.origin, snapshot, rows));
  expect(localStorage.getItem(key)).toBe(changes[0].after);
});

it('refuses a changed or foreign profile before any write', () => {
  localStorage.setItem(key, raw + ' ');
  expect(() => planKiosk(localStorage, snapshot.origin, snapshot, rows)).toThrow();
  expect(localStorage.getItem(KIOSK_BACKUP)).toBeNull();
  expect(() => planKiosk(localStorage, 'http://localhost:5174', snapshot, rows)).toThrow();
});

it('restores an interrupted write and refuses to overwrite an unknown change', () => {
  const changes = planKiosk(localStorage, snapshot.origin, snapshot, rows);
  localStorage.setItem(KIOSK_JOURNAL, JSON.stringify({ complete: false, changes }));
  localStorage.setItem(KIOSK_BACKUP, JSON.stringify(changes));
  localStorage.setItem(key, changes[0].after);
  recoverKiosk(localStorage);
  expect(localStorage.getItem(key)).toBe(raw);
  applyKiosk(localStorage, planKiosk(localStorage, snapshot.origin, snapshot, rows));
  restoreKiosk(localStorage);
  localStorage.setItem(KIOSK_JOURNAL, JSON.stringify({ complete: false, changes }));
  localStorage.setItem(key, 'foreign');
  expect(() => recoverKiosk(localStorage)).toThrow();
  expect(localStorage.getItem(key)).toBe('foreign');
});

it('keeps session-only operation when storage cannot be read, but fails closed after observing a journal', () => {
  const unavailable = { getItem: () => { throw new Error('denied'); } } as unknown as Storage;
  expect(() => recoverKiosk(unavailable)).not.toThrow();
  const broken = { getItem: () => '{bad json' } as unknown as Storage;
  expect(() => recoverKiosk(broken)).toThrow();
});
