import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readPrivate, writePrivate } from './private-store';

export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  // Read, mark read/unread and move to Trash. Never permanent deletion (that needs https://mail.google.com/).
  mail: 'https://www.googleapis.com/auth/gmail.modify',
} as const;
export type GoogleService = keyof typeof SCOPES;

const clientKey = z.object({ client_id: z.string().endsWith('.apps.googleusercontent.com'), client_secret: z.string().min(1) });
const clientSchema = z.union([z.object({ installed: clientKey }), z.object({ web: clientKey })]);
// `scopes` is absent in tokens saved before multi-account support; those were calendar-only.
const tokenSchema = z.object({ clientId: z.string(), email: z.string(), refreshToken: z.string().min(1), scopes: z.array(z.string()).optional() });
export type GoogleAuthReason = 'client_missing' | 'login_required' | 'invalid_client' | 'invalid_callback' | 'wrong_account' | 'storage_failed' | 'scopes_missing';
export class GoogleAuthError extends Error {
  constructor(public readonly reason: GoogleAuthReason) { super(reason); }
}

/** One Google account with the services the panel uses for it; its refresh token is stored with DPAPI. */
export function createGoogleAccount(options: { clientFile: string; tokenFile: string; redirectUri: string; email: string; services: GoogleService[] }) {
  const required = options.services.map(s => SCOPES[s]);
  let active: { client: OAuth2Client; scopes: string[] } | undefined;
  let flow: { state: string; verifier: string; expires: number; client: OAuth2Client; clientId: string } | undefined;
  let needsLogin = false;
  let loading: Promise<{ client: OAuth2Client; scopes: string[] }> | undefined;
  async function configured() {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(options.clientFile, 'utf8')); }
    catch { throw new GoogleAuthError('client_missing'); }
    const parsed = clientSchema.safeParse(raw);
    if (!parsed.success) throw new GoogleAuthError('invalid_client');
    const key = 'installed' in parsed.data ? parsed.data.installed : parsed.data.web;
    const client = new OAuth2Client({ clientId: key.client_id, clientSecret: key.client_secret, redirectUri: options.redirectUri,
      transporterOptions: { timeout: 8000, retry: false },
    });
    return { client, clientId: key.client_id };
  }
  async function session() {
    if (needsLogin) throw new GoogleAuthError('login_required');
    if (active) return active;
    loading ??= (async () => {
      const { client, clientId } = await configured();
      try {
        const stored = tokenSchema.parse(await readPrivate(options.tokenFile));
        if (stored.clientId !== clientId || stored.email !== options.email) throw new Error('Mismatched account');
        client.setCredentials({ refresh_token: stored.refreshToken });
        active = { client, scopes: stored.scopes ?? [SCOPES.calendar] };
        return active;
      } catch { throw new GoogleAuthError('login_required'); }
    })().finally(() => { loading = undefined; });
    return loading;
  }
  return {
    email: options.email,
    services: options.services,
    async status() {
      try {
        const { scopes } = await session();
        const missing = options.services.filter(s => !scopes.includes(SCOPES[s]));
        return missing.length
          ? { status: 'unavailable' as const, email: options.email, reason: 'scopes_missing' as const, services: options.services, missing }
          : { status: 'connected' as const, email: options.email, services: options.services, missing };
      } catch (error) {
        return { status: 'unavailable' as const, email: options.email, services: options.services, missing: options.services,
          reason: error instanceof GoogleAuthError ? error.reason : 'login_required' as const };
      }
    },
    async begin() {
      const { client, clientId } = await configured();
      const codes = await client.generateCodeVerifierAsync();
      const state = randomBytes(32).toString('base64url');
      flow = { state, verifier: codes.codeVerifier, expires: Date.now() + 10 * 60_000, client, clientId };
      return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', login_hint: options.email,
        scope: ['openid', 'email', ...required], state,
        code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
      });
    },
    /** Whether a callback's state belongs to this account's pending sign-in. */
    owns: (query: URLSearchParams) => !!flow && query.get('state') === flow.state,
    async finish(query: URLSearchParams) {
      const current = flow;
      if (!current || query.get('state') !== current.state || current.expires < Date.now()) throw new GoogleAuthError('invalid_callback');
      flow = undefined; // One use, including denial and failed exchanges.
      const code = query.get('code');
      if (!code || query.has('error')) throw new GoogleAuthError('invalid_callback');
      const { tokens } = await current.client.getToken({ code, codeVerifier: current.verifier, redirect_uri: options.redirectUri });
      if (!tokens.id_token || !tokens.refresh_token) throw new GoogleAuthError('login_required');
      const ticket = await current.client.verifyIdToken({ idToken: tokens.id_token, audience: current.clientId });
      const identity = ticket.getPayload();
      if (!identity?.email_verified || identity.email?.toLowerCase() !== options.email.toLowerCase()) throw new GoogleAuthError('wrong_account');
      const granted = tokens.scope?.split(' ') ?? [];
      // Google lets the user untick individual permissions; every service this account serves needs its scope.
      if (!required.every(scope => granted.includes(scope))) throw new GoogleAuthError('scopes_missing');
      try { await writePrivate(options.tokenFile, { email: options.email, clientId: current.clientId, refreshToken: tokens.refresh_token, scopes: granted }); }
      catch { throw new GoogleAuthError('storage_failed'); }
      current.client.setCredentials(tokens);
      active = { client: current.client, scopes: granted };
      needsLogin = false;
    },
    /** Authorized Google API call; a service whose scope was not granted fails with scopes_missing. */
    async request(service: GoogleService, url: string, init: { method?: 'GET' | 'POST'; params?: Record<string, string | string[]>; data?: unknown } = {}) {
      const { client, scopes } = await session();
      if (!scopes.includes(SCOPES[service])) throw new GoogleAuthError('scopes_missing');
      try {
        const response = await client.request({ url, method: init.method ?? 'GET', params: init.params, data: init.data,
          paramsSerializer: params => serialize(params), timeout: 8000, retry: false });
        return response.data;
      } catch (error) {
        const e = error as { response?: { status?: number; data?: { error?: unknown } } };
        if (e.response?.status === 401 || e.response?.data?.error === 'invalid_grant') {
          active = undefined; needsLogin = true; throw new GoogleAuthError('login_required');
        }
        throw error;
      }
    },
  };
}
export type GoogleAccount = ReturnType<typeof createGoogleAccount>;

/** Repeats array params (`metadataHeaders=From&metadataHeaders=Subject`), as Google APIs expect. */
function serialize(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const item of [value].flat()) query.append(key, String(item));
  return query.toString();
}
