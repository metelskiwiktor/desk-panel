import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { allViewports, devices, matchScreen, ppi, viewportsOf } from './devices';
import { ScreenCard } from './ScreenCard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function stubScreen(width: number, height: number, scale: number, inner = { width, height }) {
  vi.spyOn(window.screen, 'width', 'get').mockReturnValue(width);
  vi.spyOn(window.screen, 'height', 'get').mockReturnValue(height);
  vi.stubGlobal('devicePixelRatio', scale);
  vi.stubGlobal('innerWidth', inner.width);
  vi.stubGlobal('innerHeight', inner.height);
}

describe('devices.json', () => {
  it('derives CSS viewports from physical resolution and Windows scaling', () => {
    expect(viewportsOf('medialove-14').map(v => [v.width, v.height, v.primary])).toEqual([[864, 1536, true], [720, 1280, false], [1080, 1920, false]]);
    expect(ppi(devices['medialove-14'])).toBe(157);
    expect(allViewports().every(v => v.label === `${v.deviceId}@${v.scale}x`)).toBe(true);
  });
  it('matches a screen only with the same scaling, tolerating rounding of fractional sizes', () => {
    expect(matchScreen({ width: 864, height: 1536, scale: 1.25 })?.deviceId).toBe('medialove-14');
    expect(matchScreen({ width: 663, height: 1414, scale: 1.25 })).toBeUndefined();
    expect(matchScreen({ width: 864, height: 1536, scale: 1 })).toBeUndefined();
    expect(() => viewportsOf('missing')).toThrow(/Dostępne/);
  });
});

describe('ScreenCard', () => {
  it('confirms the primary scaling', () => {
    stubScreen(864, 1536, 1.25);
    render(<ScreenCard />);
    expect(screen.getByText(/864 × 1536 px CSS · skalowanie 125%/)).toBeTruthy();
    expect(screen.getByText(/Zgodny z: Medialove 14" Full HD przy 125%/)).toBeTruthy();
  });
  it('points out a fallback scaling and a windowed browser', () => {
    stubScreen(720, 1280, 1.5, { width: 720, height: 1180 });
    render(<ScreenCard />);
    expect(screen.getByText(/wariant zapasowy.*projektowany pod 125%/)).toBeTruthy();
    expect(screen.getByText(/nie na pełnym ekranie/)).toBeTruthy();
  });
  it('says when no configured device matches', () => {
    stubScreen(1920, 1080, 1);
    render(<ScreenCard />);
    expect(screen.getByText(/nie odpowiada żadnemu urządzeniu/)).toBeTruthy();
  });
});
