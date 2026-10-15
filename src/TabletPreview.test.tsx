import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TabletPreview } from './TabletPreview';
import { devices, viewportsOf } from './devices';

vi.mock('./App', async () => {
  const { useState } = await import('react');
  return { App: ({ onTabletPreviewChange }: { onTabletPreviewChange: () => void }) => {
    const [opened, setOpened] = useState(0);
    return <button onClick={() => { setOpened(opened + 1); onTabletPreviewChange(); }}>Settings preview action {opened}</button>;
  } };
});
afterEach(cleanup);

it('isolates the dashboard in an unscaled target viewport and closes without changing the page URL', () => {
  const url = window.location.href;
  render(<TabletPreview />);
  fireEvent.click(screen.getByText('Settings preview action 0'));
  const frame = screen.getByTitle('Pionowy podgląd panelu') as HTMLIFrameElement;
  const target = viewportsOf(Object.keys(devices)[0])[0];
  expect([frame.width, frame.height]).toEqual([String(target.width), String(target.height)]);
  expect(frame.style.transform).toBe('');
  // The host dashboard is hidden, not unmounted, so it keeps its page and state.
  expect(screen.getByText('Settings preview action 1').closest('[hidden]')).toBeTruthy();
  fireEvent.click(screen.getByText('Zamknij podgląd'));
  expect(screen.getByText('Settings preview action 1').closest('[hidden]')).toBeNull();
  expect(window.location.href).toBe(url);
});

it('accepts close messages only from its own same-origin frame', () => {
  render(<TabletPreview />);
  fireEvent.click(screen.getByText('Settings preview action 0'));
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
