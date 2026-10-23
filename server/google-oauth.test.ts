// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OAuth2Client, LoginTicket } from 'google-auth-library';
import { createGoogleAccount, type GoogleService } from './google-oauth';
import { readPrivate, writePrivate } from './private-store';

vi.mock('./private-store', () => ({ readPrivate: vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }), writePrivate: vi.fn(async () => {}) }));
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  await Promise.all(dirs.splice(0).map(path => {
    if (!path.startsWith(join(tmpdir(), 'desk-oauth-test-'))) throw new Error('Invalid cleanup target');
    return rm(path, { recursive: true, force: true });
  }));
});
async function setup(type: 'installed' | 'web' = 'installed', services: GoogleService[] = ['calendar']) {
  const dir = await mkdtemp(join(tmpdir(), 'desk-oauth-test-'));
  dirs.push(dir);
  const clientFile = join(dir, 'client.json');
  await writeFile(clientFile, JSON.stringify({ [type]: { client_id: 'test.apps.googleusercontent.com', client_secret: 'test-oauth-secret' } }));
  return createGoogleAccount({ clientFile, tokenFile: join(dir, 'token'), email: 'owner@gmail.com', services, redirectUri: 'http://127.0.0.1:5174/api/calendar/callback' });
}
const CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly', GMAIL = 'https://www.googleapis.com/auth/gmail.modify';
function mockExchange(email: string, scope = `openid email ${CALENDAR}`) {
  vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({ tokens: { id_token: 'fake-id', refresh_token: 'fake-refresh', scope }, res: null } as never);
  vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue(new LoginTicket('header', { email, email_verified: true, iss: 'https://accounts.google.com', aud: 'test.apps.googleusercontent.com', sub: 'test', iat: 1, exp: 9999999999 }) as never);
}
describe('Google OAuth', () => {
  it('accepts the supplied Web client and restores a matching saved account after restart', async () => {
    const auth = await setup('web');
    const url = new URL(await auth.begin());
    expect(url.searchParams.get('client_id')).toBe('test.apps.googleusercontent.com');
    vi.mocked(readPrivate).mockResolvedValueOnce({ clientId: 'test.apps.googleusercontent.com', email: 'owner@gmail.com', refreshToken: 'fake-restored' });
    expect(await auth.status()).toMatchObject({ status: 'connected', email: 'owner@gmail.com' });
  });
  it('creates a read-only consent URL with loopback redirect, PKCE, state and expected account', async () => {
    const auth = await setup();
    const url = new URL(await auth.begin());
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5174/api/calendar/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')!.length).toBeGreaterThanOrEqual(43);
    expect(url.searchParams.get('login_hint')).toBe('owner@gmail.com');
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(await auth.status()).toMatchObject({ status: 'unavailable', reason: 'login_required' });
  });
  it('reports an unreadable saved sign-in as storage_failed, not as a missing login', async () => {
    const auth = await setup();
    vi.mocked(readPrivate).mockRejectedValueOnce(new Error('Private store unavailable'));
    expect(await auth.status()).toMatchObject({ status: 'unavailable', reason: 'storage_failed' });
  });
  it('reports a refresh token rejected by Google as token_expired', async () => {
    const auth = await setup();
    vi.mocked(readPrivate).mockResolvedValueOnce({ clientId: 'test.apps.googleusercontent.com', email: 'owner@gmail.com', refreshToken: 'fake-old' });
    vi.spyOn(OAuth2Client.prototype, 'request').mockRejectedValue({ response: { status: 400, data: { error: 'invalid_grant' } } });
    await expect(auth.request('calendar', 'https://www.googleapis.com/calendar/v3/calendars/x/events')).rejects.toMatchObject({ reason: 'token_expired' });
    expect(await auth.status()).toMatchObject({ status: 'unavailable', reason: 'token_expired' });
  });
  it('rejects wrong/expired state before exchanging codes', async () => {
    const auth = await setup();
    const url = new URL(await auth.begin());
    const exchange = vi.spyOn(OAuth2Client.prototype, 'getToken');
    await expect(auth.finish(new URLSearchParams({ state: 'wrong', code: 'code' }))).rejects.toMatchObject({ reason: 'invalid_callback' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    await expect(auth.finish(new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' }))).rejects.toMatchObject({ reason: 'invalid_callback' });
    expect(exchange).not.toHaveBeenCalled();
  });
  it('rejects a different signed-in account and does not store its credentials', async () => {
    const auth = await setup();
    const url = new URL(await auth.begin());
    mockExchange('someone-else@gmail.com');
    await expect(auth.finish(new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' }))).rejects.toMatchObject({ reason: 'wrong_account' });
    expect(writePrivate).not.toHaveBeenCalled();
  });
  it('stores only the verified account refresh credential and refuses callback replay', async () => {
    const auth = await setup();
    const url = new URL(await auth.begin());
    mockExchange('owner@gmail.com');
    const query = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' });
    await auth.finish(query);
    expect(writePrivate).toHaveBeenCalledWith(expect.any(String), { email: 'owner@gmail.com', clientId: 'test.apps.googleusercontent.com', refreshToken: 'fake-refresh', scopes: ['openid', 'email', CALENDAR] });
    expect(await auth.status()).toMatchObject({ status: 'connected', email: 'owner@gmail.com' });
    await expect(auth.finish(query)).rejects.toMatchObject({ reason: 'invalid_callback' });
  });
  it('asks for every service of the account and refuses a consent with an unticked permission', async () => {
    const auth = await setup('installed', ['calendar', 'mail']);
    const url = new URL(await auth.begin());
    expect(url.searchParams.get('scope')).toContain('gmail.modify');
    expect(url.searchParams.get('scope')).not.toContain('mail.google.com');
    mockExchange('owner@gmail.com', `openid email ${CALENDAR}`);
    await expect(auth.finish(new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' }))).rejects.toMatchObject({ reason: 'scopes_missing' });
    expect(writePrivate).not.toHaveBeenCalled();
  });
  it('keeps a calendar-only token from before Gmail working for the calendar and asks to reconnect for mail', async () => {
    const auth = await setup('installed', ['calendar', 'mail']);
    vi.mocked(readPrivate).mockResolvedValueOnce({ clientId: 'test.apps.googleusercontent.com', email: 'owner@gmail.com', refreshToken: 'fake-restored' });
    expect(await auth.status()).toMatchObject({ status: 'unavailable', reason: 'scopes_missing', missing: ['mail'] });
    await expect(auth.request('mail', 'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX')).rejects.toMatchObject({ reason: 'scopes_missing' });
    const call = vi.spyOn(OAuth2Client.prototype, 'request').mockResolvedValue({ data: { ok: true } } as never);
    expect(await auth.request('calendar', 'https://www.googleapis.com/calendar/v3/calendars/x')).toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('connects a mail-only account once Gmail consent is granted', async () => {
    const auth = await setup('installed', ['mail']);
    const url = new URL(await auth.begin());
    mockExchange('owner@gmail.com', `openid email ${GMAIL}`);
    await auth.finish(new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' }));
    expect(await auth.status()).toMatchObject({ status: 'connected', missing: [] });
  });
});
