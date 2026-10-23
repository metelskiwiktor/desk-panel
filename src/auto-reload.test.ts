import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundleOf, watchForNewBuild } from './auto-reload';

const page = (bundle: string) => `<html><head><script type="module" crossorigin src="/assets/${bundle}.js"></script></head></html>`;

describe('auto reload', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.head.innerHTML = ''; });

  it('reads the hashed bundle from index.html', () => {
    expect(bundleOf(page('index-abc'))).toBe('/assets/index-abc.js');
    expect(bundleOf('<html></html>')).toBeNull();
  });

  it('reloads only when the served bundle differs from the running one', async () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<script type="module" src="/assets/index-old.js"></script>';
    const served = vi.fn().mockResolvedValue({ ok: true, text: async () => page('index-old') });
    vi.stubGlobal('fetch', served);
    const reload = vi.fn();
    const stop = watchForNewBuild(1000, reload);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).not.toHaveBeenCalled();
    served.mockResolvedValue({ ok: true, text: async () => page('index-new') });
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores a failing check', async () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<script type="module" src="/assets/index-old.js"></script>';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const reload = vi.fn();
    const stop = watchForNewBuild(1000, reload);
    await vi.advanceTimersByTimeAsync(2000);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
