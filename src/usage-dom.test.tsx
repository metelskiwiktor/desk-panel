import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areaViewOf, isExposed, rememberInteraction, setPreviewViewport, sourceOfOpening } from './usage-dom';
import { UsageSinkContext, useUsageMeter, type UsageSink } from './useUsageMeter';
import { usageKind, usageTile } from './usage-ids';

type Box = { left: number; top: number; right: number; bottom: number };
/** jsdom has no layout: every element reports the rectangle it is given, and `elementsFromPoint` answers from a list of layers. */
function place(element: Element, rect: Box) {
  element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => ({}) });
}
let layers: (x: number, y: number) => Element[];
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  document.elementsFromPoint = (x, y) => layers(x, y);
});
afterEach(() => { cleanup(); setPreviewViewport(null); vi.useRealTimers(); document.body.innerHTML = ''; });

const make = (html: string) => { document.body.innerHTML = html; return document.body.firstElementChild as HTMLElement; };

describe('area exposure', () => {
  it('is exposed with any visible part, not when collapsed, off screen or wholly covered', () => {
    const area = make('<div data-usage-area="tile"><span id="inner"></span></div>');
    const inner = document.getElementById('inner')!;
    place(area, { left: 100, top: 100, right: 300, bottom: 300 });
    layers = () => [inner, area];
    expect(isExposed(area)).toBe(true);
    place(area, { left: 100, top: 100, right: 100, bottom: 300 }); // collapsed to nothing
    expect(isExposed(area)).toBe(false);
    place(area, { left: 100, top: 900, right: 300, bottom: 1100 }); // below the window
    expect(isExposed(area)).toBe(false);
    place(area, { left: 950, top: 100, right: 1050, bottom: 300 }); // half out of the window: the rest counts
    layers = () => [area];
    expect(isExposed(area)).toBe(true);
    const cover = document.createElement('div');
    place(area, { left: 100, top: 100, right: 300, bottom: 300 });
    layers = () => [cover, area];
    expect(isExposed(area)).toBe(false); // an overlay over every point
    layers = x => (x < 150 ? [area] : [cover, area]); // covered in part only
    expect(isExposed(area)).toBe(true);
  });

  it('looks through a dimming layer', () => {
    const area = make('<div data-usage-area="tile"></div>');
    const dim = document.createElement('div');
    dim.setAttribute('data-usage-dim', '');
    place(area, { left: 0, top: 0, right: 200, bottom: 200 });
    layers = () => [dim, area];
    expect(isExposed(area)).toBe(true);
  });

  it('counts only the part of a preview frame the host shows', () => {
    const area = make('<div data-usage-area="tile"></div>');
    layers = () => [area];
    place(area, { left: 100, top: 600, right: 300, bottom: 780 });
    setPreviewViewport({ left: 0, top: 0, right: 1000, bottom: 500 });
    expect(isExposed(area)).toBe(false);
    setPreviewViewport({ left: 0, top: 300, right: 1000, bottom: 700 });
    expect(isExposed(area)).toBe(true);
  });

  it('reads only fixed ids from the page and gives a detail its source tile only when the click came from one', () => {
    const tile = make('<div data-usage-area="tile" data-usage-kind="mail" data-usage-tile="mail"></div>');
    expect(areaViewOf(tile, { page: 'home', pulpit: 'p1' })).toEqual({ area: 'tile', page: 'home', pulpit: 'p1', kind: 'mail', tile: 'mail' });
    tile.setAttribute('data-usage-kind', 'Konto Jana K.');
    expect(areaViewOf(tile, { page: 'home', pulpit: 'p1' })?.kind).toBeUndefined();
    expect(areaViewOf(make('<div data-usage-area="nav"></div>'), { page: 'tasks', pulpit: 'p1' })).toEqual({ area: 'nav', page: 'tasks' });
    expect(areaViewOf(make('<div data-usage-area="nieznany"></div>'), { page: 'home' })).toBeNull();
    const t = make('<div data-usage-area="tile" data-usage-kind="mail"><button id="b"></button></div>');
    rememberInteraction(t.querySelector('#b'), 1000);
    expect(sourceOfOpening(1500)).toBe('mail');
    expect(sourceOfOpening(9000)).toBeUndefined();
    rememberInteraction(make('<button id="chip"></button>'), 2000);
    expect(sourceOfOpening(2100)).toBeUndefined();
  });

  it('writes no provider name: limits get technical ids', () => {
    expect(usageKind('quota:Claude')).toBe('claude');
    expect(usageKind('quota:agy:Gemini Models')).toMatch(/^agy-[0-9a-f]{6}$/);
    expect(usageKind('quota:agy:Gemini Models')).not.toBe(usageKind('quota:agy:Claude & GPT'));
    expect(usageTile('todo#2')).toBe('todo#2');
    expect(usageTile('quota:agy:Gemini Models')).toMatch(/^agy-/);
  });
});

function Probe() {
  useUsageMeter({ view: 'page', page: 'home', pulpit: 'main' }, true, { page: 'home', pulpit: 'main' });
  return <>
    <div data-usage-area="tile" data-usage-kind="mail" data-usage-tile="mail"><button id="mail-b">m</button></div>
    <div data-usage-area="tile" data-usage-kind="cezar" data-usage-tile="cezar"><button id="cezar-b">c</button></div>
  </>;
}

describe('area meter in the page', () => {
  it('charges parallel areas and sends them next to the main view, whose time they do not add to', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(1_800_000_000_000 - (1_800_000_000_000 % 3_600_000) + 600_000);
    const sent: Parameters<UsageSink['send']>[0][] = [];
    const sink: UsageSink = { browser: 'browser01', send: async batch => { sent.push(batch); return true; } };
    const view = render(<UsageSinkContext.Provider value={sink}><Probe /></UsageSinkContext.Provider>);
    const tiles = [...document.querySelectorAll('[data-usage-area="tile"]')];
    tiles.forEach((t, i) => place(t, { left: 100, top: 100 + i * 300, right: 400, bottom: 300 + i * 300 }));
    layers = (x, y) => tiles.filter(t => { const r = t.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    const areas = sent.flatMap(b => b.areas), main = sent.flatMap(b => b.slices);
    const total = (kind: string) => areas.filter(a => a.kind === kind).reduce((n, a) => n + a.end - a.start, 0);
    // The tiles were placed just after mount, so the first look that finds them is the next one, a second later.
    expect(total('mail')).toBe(59_000);
    expect(total('cezar')).toBe(59_000);
    expect(areas.every(a => !a.touched)).toBe(true); // jsdom events are never trusted: a user's click is checked in the browser run
    expect(main.reduce((n, s) => n + s.end - s.start, 0)).toBe(60_000);
  });
});
