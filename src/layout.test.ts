import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLayout, moveWidget, parseLayout, readLayout, saveLayout } from './layout';

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
    const config = moveWidget(defaultLayout(), 'insights', -1);
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
      ['quotas', false],
    ]);
  });
  it('odrzuca w v1 nazwy z prototypu i powtórzone ID', () => {
    expect(parseLayout('{"version":1,"order":["toString"]}')).toEqual(defaultLayout());
    expect(parseLayout('{"version":1,"order":["cezar","cezar"]}')).toEqual(defaultLayout());
  });
  it('przestawianie nie przekracza granic', () => {
    const config = defaultLayout();
    expect(moveWidget(config, 'cezar', -1)).toBe(config);
    expect(moveWidget(config, 'insights', 1)).toBe(config);
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
