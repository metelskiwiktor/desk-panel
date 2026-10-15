// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMailReader, MAIL_QUERY, sender } from './gmail';
import { GoogleAuthError, type GoogleService } from './google-oauth';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
type Init = { method?: string; params?: Record<string, string | string[]>; data?: unknown };
function message(from: string, subject: string, at: number, unread = true, snippet = 'Podgląd &amp; treść') {
  return { labelIds: unread ? ['UNREAD', 'INBOX'] : ['INBOX'], snippet, internalDate: String(at),
    payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }] } };
}
/** A fake Gmail account: `threads` maps id → messages, `fail` makes the next calls throw. */
function account(email: string, threads: Record<string, ReturnType<typeof message>[]>, history: Record<string, string> = {}) {
  const state = { fail: undefined as unknown };
  const request = vi.fn(async (service: GoogleService, url: string, init: Init = {}) => {
    expect(service).toBe('mail');
    if (state.fail) throw state.fail;
    if (url === `${BASE}/labels/INBOX`) return { threadsUnread: Object.keys(threads).length };
    if (url === `${BASE}/threads`) {
      expect(init.params?.q).toBe(MAIL_QUERY);
      return { threads: Object.keys(threads).map(id => ({ id, historyId: history[id] ?? '1' })) };
    }
    const id = url.slice(`${BASE}/threads/`.length).split('/')[0];
    if (init.method === 'POST') return {};
    expect(init.params).toMatchObject({ format: 'metadata' });
    return { id, historyId: history[id] ?? '1', messages: threads[id] };
  });
  return { email, request, state };
}

describe('Gmail reader', () => {
  it('parses senders and keeps only the display name', () => {
    expect(sender('"Anna Nowak" <anna@x.pl>')).toBe('Anna Nowak');
    expect(sender('<noreply@x.pl>')).toBe('noreply@x.pl');
    expect(sender('bez@nawiasow.pl')).toBe('bez@nawiasow.pl');
  });
  it('merges unread conversations of all accounts newest first, from the latest unread message', async () => {
    let now = 1_000_000;
    const a = account('a@gmail.com', { aa1: [message('Stary <s@x.pl>', 'Wątek', 100, true), message('Nowy <n@x.pl>', 'Re: Wątek', 300, false)] });
    const b = account('b@gmail.com', { bb2: [message('"GitHub" <g@x.pl>', '', 200)] });
    const reader = createMailReader([a, b], () => now);
    const result = await reader.read(10);
    expect(result).toMatchObject({ status: 'connected', observedAt: now, total: 2 });
    expect(result.data!.map(t => [t.id, t.from, t.subject, t.messages])).toEqual([['b@gmail.com:bb2', 'GitHub', '(bez tematu)', 1], ['a@gmail.com:aa1', 'Stary', 'Wątek', 2]]);
    expect(result.data![1]).toMatchObject({ snippet: 'Podgląd & treść', sourceUrl: 'https://mail.google.com/mail/u/a%40gmail.com/#inbox/aa1' });
    expect((await reader.read(1)).data).toHaveLength(1);
  });
  it('reuses metadata of unchanged conversations and keeps the last list with its time on failure', async () => {
    let now = 1_000_000;
    const a = account('a@gmail.com', { aa1: [message('A <a@x.pl>', 'Temat', 100)] });
    const reader = createMailReader([a], () => now);
    await reader.read(10);
    now += 30_000;
    await reader.read(10);
    expect(a.request.mock.calls.filter(([, url]) => url === `${BASE}/threads/aa1`)).toHaveLength(1);
    now += 30_000;
    a.state.fail = new Error('network');
    const failed = await reader.read(10);
    expect(failed).toMatchObject({ status: 'offline', observedAt: 1_030_000, total: 1 });
    a.state.fail = new GoogleAuthError('scopes_missing');
    now += 30_000;
    expect((await reader.read(10)).accounts[0]).toMatchObject({ status: 'unavailable', message: expect.stringContaining('Połącz konto ponownie') });
  });
  it('marks read, trashes and undoes whole conversations through Gmail', async () => {
    const a = account('a@gmail.com', { aa1: [message('A <a@x.pl>', 'Temat', 100)], aa2: [message('B <b@x.pl>', 'Inny', 50)] });
    const reader = createMailReader([a], () => 1_000_000);
    await reader.read(10);
    await reader.act('a@gmail.com', 'aa1', 'read');
    expect(a.request).toHaveBeenCalledWith('mail', `${BASE}/threads/aa1/modify`, { method: 'POST', data: { removeLabelIds: ['UNREAD'] } });
    await reader.act('a@gmail.com', 'aa1', 'unread');
    expect(a.request).toHaveBeenCalledWith('mail', `${BASE}/threads/aa1/modify`, { method: 'POST', data: { addLabelIds: ['UNREAD'] } });
    await reader.act('a@gmail.com', 'aa2', 'trash');
    expect(a.request).toHaveBeenCalledWith('mail', `${BASE}/threads/aa2/trash`, { method: 'POST' });
    await reader.act('a@gmail.com', 'aa2', 'untrash');
    expect(a.request).toHaveBeenCalledWith('mail', `${BASE}/threads/aa2/untrash`, { method: 'POST' });
    await expect(reader.act('other@gmail.com', 'aa1', 'read')).rejects.toThrow();
    await expect(reader.act('a@gmail.com', '../labels', 'read')).rejects.toThrow();
  });
});
