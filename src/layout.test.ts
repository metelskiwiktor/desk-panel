import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLayout, parseLayout, readLayout, saveLayout } from './layout';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('wersjonowany układ', () => {
  it.each([null, '', '{broken', 'null', '{}', '{"version":9}', '{"version":2,"widgets":[]}'])(
    'fallback dla %s',
    (raw) => {
      expect(parseLayout(raw)).toEqual(defaultLayout());
    },
  );
  it('zachowuje kolejność, widoczność i wariant po zapisie', () => {
    const config = defaultLayout();
    config.widgets.reverse();
    config.widgets[0].visible = false;
    config.widgets[1].displayMode = 'compact';
    expect(saveLayout(config)).toBe(true);
    expect(readLayout()).toEqual(config);
  });
  it('odrzuca nieznane ID, duplikaty, zły typ i niewłaściwy tryb', () => {
    for (const property of [
      { id: 'unknown' },
      { id: 'system' },
      { visible: 'yes' },
      { displayMode: 'auto' },
      { priority: 'urgent' },
    ]) {
      const config = defaultLayout();
      Object.assign(config.widgets[0], property);
      expect(parseLayout(JSON.stringify(config))).toEqual(defaultLayout());
    }
  });
  it('migruje v1 i zachowuje ukryte brakujące widgety', () => {
    const migrated = parseLayout('{"version":1,"order":["insights","cezar"]}');
    expect(migrated.version).toBe(2);
    expect(migrated.widgets.map((w) => [w.id, w.visible])).toEqual([
      ['insights', true],
      ['cezar', true],
      ['system', false],
      ['calendar', false],
      ['training', false],
      ['quotas', false],
      ['breakdown', false],
      ['mail', false],
      ['todo', false],
      ['bank', false],
      ['smart-actions', false],
    ]);
  });
  it('wczytuje układ zapisany ze starą kartą zegara, bez niej', () => {
    const saved = { version: 2, widgets: [...defaultLayout().widgets, { id: 'ambient', visible: false, displayMode: 'expanded', priority: 'normal' }] };
    expect(parseLayout(JSON.stringify(saved))).toEqual(defaultLayout());
  });
  it('dopisuje karty dodane po zapisaniu układu, zachowując kolejność użytkownika', () => {
    const saved = { version: 2, widgets: defaultLayout().widgets.filter((w) => w.id !== 'mail').reverse() };
    saved.widgets[0] = { ...saved.widgets[0], visible: false };
    const layout = parseLayout(JSON.stringify(saved));
    expect(layout.widgets.map((w) => w.id)).toEqual(['smart-actions', 'bank', 'todo', 'insights', 'breakdown', 'quotas', 'training', 'calendar', 'system', 'cezar', 'mail']);
    expect(layout.widgets[0].visible).toBe(false);
    expect(layout.widgets.at(-1)!.visible).toBe(true);
  });
  it('odrzuca w v1 nazwy z prototypu i powtórzone ID', () => {
    expect(parseLayout('{"version":1,"order":["toString"]}')).toEqual(defaultLayout());
    expect(parseLayout('{"version":1,"order":["cezar","cezar"]}')).toEqual(defaultLayout());
  });
  it('działa przy zablokowanym localStorage, zwraca błąd zapisu', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked');
    });
    expect(readLayout()).toEqual(defaultLayout());
    expect(saveLayout(defaultLayout())).toBe(false);
  });
});
