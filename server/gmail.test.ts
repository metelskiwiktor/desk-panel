// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMailReader, MAIL_QUERY, projectThread, sender } from './gmail';
import { GoogleAuthError, type GoogleService } from './google-oauth';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
type Init = { method?: string; params?: Record<string, string | string[]>; data?: unknown };
function message(from: string, subject: string, at: number, unread = true, snippet = 'Podgląd &amp; treść', body?: string) {
  return { labelIds: unread ? ['UNREAD', 'INBOX'] : ['INBOX'], snippet, internalDate: String(at), ...(body ? { body } : {}),
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
    expect(init.params).toMatchObject({ format: 'full' });
    return { id, historyId: history[id] ?? '1', messages: threads[id] };
  });
  return { email, request, state };
}

describe('Gmail reader', () => {
  it('requests the last 30 days and excludes older unread messages and cached data as it ages', async () => {
    const day = 24 * 60 * 60 * 1000;
    let now = 100 * day;
    const a = account('a@gmail.com', {
      aa1: [message('A', 'Recent', now - day)],
      aa2: [message('B', 'Boundary', now - 30 * day)],
      aa3: [message('C', 'Old unread', now - 31 * day), message('C', 'Recent read', now, false)],
    });
    const reader = createMailReader([a], () => now);
    const first = await reader.read(1);
    expect(a.request).toHaveBeenCalledWith('mail', `${BASE}/threads`, { params: { q: 'in:inbox is:unread newer_than:30d', maxResults: '100' } });
    expect(first).toMatchObject({ total: 2, accounts: [{ unread: 2 }] });
    expect(first.data?.map(t => t.threadId)).toEqual(['aa1']);
    now += 1; // No refresh: the boundary item must expire even out of cache.
    expect(await reader.read(30)).toMatchObject({ total: 1, accounts: [{ unread: 1 }] });
    a.state.fail = new Error('network');
    now += 31 * day;
    expect(await reader.read(30)).toMatchObject({ status: 'offline', total: 0, data: [], accounts: [{ unread: 0, observedAt: 100 * day }] });
  });
  it('marks an account whose unread count is a lower bound because Gmail listed more than were loaded', async () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`a${i.toString(16).padStart(3, '0')}`, [message('A', `T${i}`, 1_000_000 - i)]]));
    const reader = createMailReader([account('a@gmail.com', many), account('b@gmail.com', { b1: [message('B', 'T', 1_000_000)] })], () => 1_000_000);
    const result = await reader.read(10);
    expect(result.accounts).toMatchObject([{ unread: 200, partial: true }, { unread: 1 }]);
    expect(result.accounts[1]).not.toHaveProperty('partial');
  });
  it('refreshes a cached login failure immediately after successful consent', async () => {
    const a = account('a@gmail.com', {});
    a.state.fail = new GoogleAuthError('login_required');
    const reader = createMailReader([a], () => 1_000_000);
    expect((await reader.read(10)).accounts[0].status).toBe('unavailable');
    a.state.fail = undefined;
    reader.invalidate();
    expect((await reader.read(10)).accounts[0]).toMatchObject({ status: 'connected', unread: 0 });
  });
  it('backs off quota errors per account without losing observations or asking for login', async () => {
    let now = 1_000_000;
    const a = account('a@gmail.com', {});
    const b = account('b@gmail.com', {});
    const reader = createMailReader([a, b], () => now);
    await reader.read(10);
    a.state.fail = { response: { status: 403, data: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } } };
    now += 30_000;
    const failed = await reader.read(10);
    expect(failed.accounts[0]).toMatchObject({ status: 'offline', observedAt: 1_000_000, message: expect.stringContaining('Gmail ograniczył') });
    const calls = a.request.mock.calls.length;
    const otherCalls = b.request.mock.calls.length;
    now += 30_000;
    reader.invalidate(); // Logging in again must not bypass Google's quota backoff.
    await reader.read(10);
    expect(a.request).toHaveBeenCalledTimes(calls);
    expect(b.request.mock.calls.length).toBeGreaterThan(otherCalls);
    now += 30_000;
    await reader.read(10); // Second failure waits two minutes.
    const secondCalls = a.request.mock.calls.length;
    now += 60_000;
    await reader.read(10);
    expect(a.request).toHaveBeenCalledTimes(secondCalls);
    a.state.fail = undefined;
    now += 60_000;
    expect((await reader.read(10)).accounts[0]).toMatchObject({ status: 'connected', observedAt: now });
  });
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
    expect(result.data![1]).toMatchObject({ snippet: 'Podgląd & treść', body: 'Podgląd & treść', sourceUrl: 'https://mail.google.com/mail/u/a%40gmail.com/#inbox/aa1' });
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
  it('extracts full message body when projecting Gmail threads and falls back to snippet', () => {
    const rawWithDirectBody = {
      id: 'aa1', historyId: '1', messages: [{
        labelIds: ['UNREAD'], snippet: 'Krótki podgląd', body: 'Pełna treść wiadomości\nz nową linią', internalDate: '1000',
        payload: { headers: [{ name: 'From', value: 'Test <t@x.pl>' }, { name: 'Subject', value: 'Temat' }] },
      }],
    };
    expect(projectThread('user@gmail.com', rawWithDirectBody).body).toBe('Pełna treść wiadomości\nz nową linią');

    const rawWithBase64Payload = {
      id: 'aa2', historyId: '1', messages: [{
        labelIds: ['UNREAD'], snippet: 'Podgląd', internalDate: '1000',
        payload: {
          headers: [{ name: 'From', value: 't@x.pl' }, { name: 'Subject', value: 'S' }],
          body: { data: Buffer.from('Treść z payload.body').toString('base64url') },
        },
      }],
    };
    expect(projectThread('user@gmail.com', rawWithBase64Payload).body).toBe('Treść z payload.body');

    const rawWithMultipart = {
      id: 'aa3', historyId: '1', messages: [{
        labelIds: ['UNREAD'], snippet: 'Podgląd', internalDate: '1000',
        payload: {
          headers: [{ name: 'From', value: 't@x.pl' }, { name: 'Subject', value: 'S' }],
          parts: [
            { mimeType: 'text/html', body: { data: Buffer.from('<p>HTML</p>').toString('base64url') } },
            { mimeType: 'text/plain', body: { data: Buffer.from('Czysty tekst z parts').toString('base64url') } },
          ],
        },
      }],
    };
    expect(projectThread('user@gmail.com', rawWithMultipart).body).toBe('Czysty tekst z parts');

    const rawFallback = {
      id: 'aa4', historyId: '1', messages: [{
        labelIds: ['UNREAD'], snippet: 'Tylko &amp; podgląd', internalDate: '1000',
        payload: { headers: [{ name: 'From', value: 't@x.pl' }, { name: 'Subject', value: 'S' }] },
      }],
    };
    expect(projectThread('user@gmail.com', rawFallback).body).toBe('Tylko & podgląd');
  });
});
