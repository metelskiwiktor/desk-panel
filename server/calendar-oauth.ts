import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readPrivate, writePrivate } from './private-store';

const clientKey = z.object({ client_id: z.string().endsWith('.apps.googleusercontent.com'), client_secret: z.string().min(1) });
const clientSchema = z.union([z.object({ installed: clientKey }), z.object({ web: clientKey })]);
const tokenSchema = z.object({ clientId: z.string(), email: z.string(), refreshToken: z.string().min(1) });
export class CalendarAuthError extends Error {
  constructor(public readonly reason: 'client_missing' | 'login_required' | 'invalid_client' | 'invalid_callback' | 'wrong_account' | 'storage_failed') { super(reason); }
}
export function createCalendarOAuth(options: { clientFile: string; tokenFile: string; redirectUri: string; email: string }) {
  let active: OAuth2Client | undefined;
  let flow: { state: string; verifier: string; expires: number; client: OAuth2Client; clientId: string } | undefined;
  let needsLogin = false;
  let loading: Promise<OAuth2Client> | undefined;
  async function configured() {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(options.clientFile, 'utf8')); }
    catch { throw new CalendarAuthError('client_missing'); }
    const parsed = clientSchema.safeParse(raw);
    if (!parsed.success) throw new CalendarAuthError('invalid_client');
    const key = 'installed' in parsed.data ? parsed.data.installed : parsed.data.web;
    const client = new OAuth2Client({ clientId: key.client_id, clientSecret: key.client_secret, redirectUri: options.redirectUri,
      transporterOptions: { timeout: 8000, retry: false },
    });
    return { client, clientId: key.client_id };
  }
  async function getClient() {
    if (needsLogin) throw new CalendarAuthError('login_required');
    if (active) return active;
    loading ??= (async () => {
      const { client, clientId } = await configured();
      try {
        const stored = tokenSchema.parse(await readPrivate(options.tokenFile));
        if (stored.clientId !== clientId || stored.email !== options.email) throw new Error('Mismatched account');
        client.setCredentials({ refresh_token: stored.refreshToken });
      } catch { throw new CalendarAuthError('login_required'); }
      active = client;
      return client;
    })().finally(() => { loading = undefined; });
    return loading;
  }
  return {
    async status() {
      try { await getClient(); return { status: 'connected' as const, email: options.email }; }
      catch (error) { return { status: 'unavailable' as const, email: options.email, reason: error instanceof CalendarAuthError ? error.reason : 'login_required' }; }
    },
    async begin() {
      const { client, clientId } = await configured();
      const codes = await client.generateCodeVerifierAsync();
      const state = randomBytes(32).toString('base64url');
      flow = { state, verifier: codes.codeVerifier, expires: Date.now() + 10 * 60_000, client, clientId };
      return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', login_hint: options.email,
        scope: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'], state,
        code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
      });
    },
    async finish(query: URLSearchParams) {
      const current = flow;
      if (!current || query.get('state') !== current.state || current.expires < Date.now()) throw new CalendarAuthError('invalid_callback');
      flow = undefined; // One use, including denial and failed exchanges.
      const code = query.get('code');
      if (!code || query.has('error')) throw new CalendarAuthError('invalid_callback');
      const { tokens } = await current.client.getToken({ code, codeVerifier: current.verifier, redirect_uri: options.redirectUri });
      if (!tokens.id_token || !tokens.refresh_token) throw new CalendarAuthError('login_required');
      const ticket = await current.client.verifyIdToken({ idToken: tokens.id_token, audience: current.clientId });
      const identity = ticket.getPayload();
      if (!identity?.email_verified || identity.email?.toLowerCase() !== options.email.toLowerCase()) throw new CalendarAuthError('wrong_account');
      if (!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/calendar.readonly')) throw new CalendarAuthError('login_required');
      try { await writePrivate(options.tokenFile, { email: options.email, clientId: current.clientId, refreshToken: tokens.refresh_token }); }
      catch { throw new CalendarAuthError('storage_failed'); }
      current.client.setCredentials(tokens);
      active = current.client;
      needsLogin = false;
    },
    async request(path: string, params?: Record<string, string>) {
      const client = await getClient();
      try {
        const response = await client.request({ url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.email)}${path}`, params,
          timeout: 8000, retry: false });
        return response.data;
      } catch (error) {
        const e = error as { response?: { status?: number; data?: { error?: unknown } } };
        if (e.response?.status === 401 || e.response?.data?.error === 'invalid_grant') {
          active = undefined; needsLogin = true; throw new CalendarAuthError('login_required');
        }
        throw error;
      }
    },
  };
}
