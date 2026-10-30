import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChat } from './useChat';
import { chatHooks, ID, mockServer } from './chat.test-kit';

chatHooks();
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const reply = (status = 200) => new Response('{}', { status });

describe('temporary chat lifecycle', () => {
  it('excludes pending keep from pagehide, switching and unmount; restores cleanup on failed PATCH', async () => {
    mockServer([]);
    const original = fetch;
    const pending = deferred<Response>();
    const deletes: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return pending.promise;
      if (init?.method === 'DELETE') deletes.push(String(url));
      return original(url, init);
    }));
    const { result, unmount } = renderHook(() => useChat('hermes'));
    act(() => result.current.startNew(true));
    await waitFor(() => expect(result.current.temporary).toBe(true));
    await act(async () => { await result.current.send('private', []); });
    act(() => result.current.keepTemporary());
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => result.current.startNew());
    await waitFor(() => expect(result.current.activeId).toBeNull());
    expect(deletes).toEqual([]);
    await act(async () => { pending.resolve(reply(500)); });
    expect(result.current.error).not.toBe('');
    unmount();
    expect(deletes).toEqual([`/api/chats/${ID}?temporary=1`]);
  });

  it('cleans temporary content on parent unmount with conditional DELETE', async () => {
    const calls = mockServer([]);
    const { result, unmount } = renderHook(() => useChat('hermes'));
    act(() => result.current.startNew(true));
    await waitFor(() => expect(result.current.temporary).toBe(true));
    await act(async () => { await result.current.send('private', []); });
    unmount();
    expect(calls.filter(c => c.method === 'DELETE').map(c => c.url)).toEqual([`/api/chats/${ID}?temporary=1`]);
  });

  it('allows switching even if temporary DELETE fails', async () => {
    mockServer([]);
    const original = fetch;
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE' ? Promise.reject(new Error('offline')) : original(url, init)));
    const { result } = renderHook(() => useChat('hermes'));
    act(() => result.current.startNew(true));
    await waitFor(() => expect(result.current.temporary).toBe(true));
    await act(async () => { await result.current.send('private', []); });
    act(() => result.current.startNew());
    await waitFor(() => expect(result.current.activeId).toBeNull());
    expect(result.current.temporary).toBe(false);
  });
});
