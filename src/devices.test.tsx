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
    expect(viewportsOf('medialove-14').map(v => [v.width, v.height, v.primary])).toEqual([[1280, 720, true], [1536, 864, false], [1920, 1080, false]]);
    expect(ppi(devices['medialove-14'])).toBe(157);
    expect(allViewports().every(v => v.label === `${v.deviceId}@${v.scale}x`)).toBe(true);
  });
  it('matches a screen only with the same scaling, tolerating rounding of fractional sizes', () => {
    expect(matchScreen({ width: 1280, height: 720, scale: 1.5 })?.deviceId).toBe('medialove-14');
    expect(matchScreen({ width: 1365, height: 767, scale: 1.5 })).toBeUndefined();
    expect(matchScreen({ width: 1280, height: 720, scale: 1 })).toBeUndefined();
    expect(() => viewportsOf('missing')).toThrow(/Dostępne/);
  });
});

describe('ScreenCard', () => {
  it('confirms the primary scaling', () => {
    stubScreen(1280, 720, 1.5);
    render(<ScreenCard />);
    expect(screen.getByText(/1280 × 720 px CSS · skalowanie 150%/)).toBeTruthy();
    expect(screen.getByText(/Zgodny z: Medialove 14" Full HD przy 150%/)).toBeTruthy();
  });
  it('points out a fallback scaling and a windowed browser', () => {
    stubScreen(1536, 864, 1.25, { width: 1536, height: 780 });
    render(<ScreenCard />);
    expect(screen.getByText(/wariant zapasowy.*projektowany pod 150%/)).toBeTruthy();
    expect(screen.getByText(/nie na pełnym ekranie/)).toBeTruthy();
  });
  it('says when no configured device matches', () => {
    stubScreen(1366, 768, 1);
    render(<ScreenCard />);
    expect(screen.getByText(/nie odpowiada żadnemu urządzeniu/)).toBeTruthy();
  });
});
