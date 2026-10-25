import { beforeEach, describe, expect, it } from 'vitest';
import { WORKSPACE_KEY, readWorkspace } from './tile-grid';
import {
  MAIN_PULPIT, MAX_PULPITS, PULPITS_KEY, addPulpit, defaultPulpits, freeName, parsePulpits, readPulpits, removePulpit, renamePulpit, savePulpits, selectPulpit,
  workspaceKey,
} from './pulpits';

const two = () => addPulpit(defaultPulpits(), 'pa');

describe('virtual desktops: the pure rules', () => {
  it('starts with one desktop that owns the original workspace key', () => {
    expect(defaultPulpits()).toEqual({ items: [{ id: 'main', name: 'Główny' }], active: 'main' });
    expect(workspaceKey(MAIN_PULPIT)).toBe(WORKSPACE_KEY);
    expect(workspaceKey('pa')).toBe(`${WORKSPACE_KEY}.pa`);
  });
  it('adds a desktop, opens it and names it with the smallest free number', () => {
    const state = two();
    expect(state.active).toBe('pa');
    expect(state.items.map(p => p.name)).toEqual(['Główny', 'Pulpit 2']);
    const three = addPulpit(state, 'pb');
    expect(three.items.at(-1)!.name).toBe('Pulpit 3');
    expect(freeName(removePulpit(three, 'pa'))).toBe('Pulpit 2');
  });
  it('stops at the limit and ignores a repeated id', () => {
    let state = defaultPulpits();
    for (let i = 1; i < MAX_PULPITS; i++) state = addPulpit(state, `p${i}`);
    expect(state.items).toHaveLength(MAX_PULPITS);
    expect(addPulpit(state, 'extra')).toBe(state);
    expect(addPulpit(two(), 'pa').items).toHaveLength(2);
  });
  it('renames with trimming and refuses an empty name or an unknown desktop', () => {
    const state = two();
    expect(renamePulpit(state, 'pa', '  AI  ').items[1].name).toBe('AI');
    expect(renamePulpit(state, 'pa', '   ')).toBe(state);
    expect(renamePulpit(state, 'nope', 'x')).toBe(state);
    expect(renamePulpit(state, 'pa', 'x'.repeat(80)).items[1].name).toHaveLength(40);
  });
  it('never removes the last desktop; removing the open one moves to its left neighbour', () => {
    expect(removePulpit(defaultPulpits(), 'main')).toEqual(defaultPulpits());
    const three = addPulpit(two(), 'pb');
    expect(removePulpit(three, 'pb').active).toBe('pa');
    expect(removePulpit(selectPulpit(three, 'main'), 'main').active).toBe('pa');
    expect(removePulpit(three, 'pa').active).toBe('pb'); // another one was open: stays
  });
  it('selects only a desktop that exists', () => {
    const state = two();
    expect(selectPulpit(state, 'main').active).toBe('main');
    expect(selectPulpit(state, 'nope')).toBe(state);
  });
});

describe('virtual desktops: storage', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips and falls back to a single desktop on anything odd', () => {
    const state = renamePulpit(two(), 'pa', 'AI');
    expect(savePulpits(state)).toBe(true);
    expect(readPulpits()).toEqual(state);
    const bad = (value: unknown) => parsePulpits(JSON.stringify(value));
    const ok = { version: 1, items: [{ id: 'main', name: 'A' }], active: 'main' };
    expect(bad(ok)).toEqual({ items: [{ id: 'main', name: 'A' }], active: 'main' });
    expect(bad({ ...ok, version: 2 })).toEqual(defaultPulpits());
    expect(bad({ ...ok, active: 'zzz' })).toEqual(defaultPulpits());
    expect(bad({ ...ok, items: [] })).toEqual(defaultPulpits());
    expect(bad({ ...ok, items: [{ id: 'A B', name: 'x' }] })).toEqual(defaultPulpits());
    expect(bad({ ...ok, items: [{ id: 'main', name: 'a' }, { id: 'main', name: 'b' }] })).toEqual(defaultPulpits());
    expect(bad({ ...ok, items: [{ id: 'main', name: '' }] })).toEqual(defaultPulpits());
    expect(parsePulpits('{nope')).toEqual(defaultPulpits());
    expect(parsePulpits(null)).toEqual(defaultPulpits());
    localStorage.setItem(PULPITS_KEY, '{nope');
    expect(readPulpits()).toEqual(defaultPulpits());
  });
  it('reads a layout of a given desktop from its own key', () => {
    localStorage.setItem(workspaceKey('pa'), JSON.stringify({ version: 1, tiles: [{ kind: 'mail', c: 0, r: 0, w: 1, h: 1 }] }));
    expect(readWorkspace(workspaceKey('pa'))).toEqual([{ kind: 'mail', c: 0, r: 0, w: 1, h: 1 }]);
    expect(readWorkspace()).toBeNull();
  });
});
