import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TabletPreview } from './TabletPreview';
import { devices, viewportsOf } from './devices';

vi.mock('./App', () => ({ App: ({ onTabletPreviewChange }: { onTabletPreviewChange: () => void }) =>
  <button onClick={onTabletPreviewChange}>Settings preview action</button> }));
afterEach(cleanup);

it('isolates the dashboard in an unscaled target viewport and closes without changing the page URL', () => {
  const url = window.location.href;
  render(<TabletPreview />);
  fireEvent.click(screen.getByText('Settings preview action'));
  const frame = screen.getByTitle('Pionowy podgląd panelu') as HTMLIFrameElement;
  const target = viewportsOf(Object.keys(devices)[0])[0];
  expect([frame.width, frame.height]).toEqual([String(target.width), String(target.height)]);
  expect(frame.style.transform).toBe('');
  expect(screen.queryByText('Settings preview action')).toBeNull(); // No second polling dashboard in the host.
  fireEvent.click(screen.getByText('Zamknij podgląd'));
  expect(screen.getByText('Settings preview action')).toBeTruthy();
  expect(window.location.href).toBe(url);
});

it('accepts close messages only from its own same-origin frame', () => {
  render(<TabletPreview />);
  fireEvent.click(screen.getByText('Settings preview action'));
  const frame = screen.getByTitle('Pionowy podgląd panelu') as HTMLIFrameElement;
  const send = (origin: string, source: Window | null) => fireEvent(window, new MessageEvent('message', {
    origin, source, data: 'desk-panel:close-preview',
  }));
  send('https://example.com', frame.contentWindow);
  send(window.location.origin, window);
  expect(screen.getByTitle('Pionowy podgląd panelu')).toBeTruthy();
  send(window.location.origin, frame.contentWindow);
  expect(screen.queryByTitle('Pionowy podgląd panelu')).toBeNull();
});
