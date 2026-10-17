import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCezar } from './cezar';
import { createCalendarReader } from './calendar';
import { createGoogleAccount, GoogleAuthError, type GoogleService } from './google-oauth';
import { createMailReader } from './gmail';
import { createSystemReader } from './system';
import { createQuotaReader } from './quotas';
import { createUsageBreakdownReader } from './usageBreakdown';
import { createWarmupClient } from './warmup';
import { SourceError, type PanelSources } from './sources';

export function createRealSources(options: { port: number; cezarUrl: string; calendarId: string; mailAccounts: string[]; env: NodeJS.ProcessEnv }): PanelSources {
  const { calendarId, env } = options;
  const dir = join(homedir(), '.desk-panel');
  const clientFile = env.DESK_GOOGLE_OAUTH_CLIENT_FILE || join(dir, 'google-oauth-client.json');
  // One callback for every account: it is the redirect URI registered with the OAuth client.
  const redirectUri = `http://127.0.0.1:${options.port}/api/calendar/callback`;
  const emails = [...new Set([calendarId, ...options.mailAccounts])];
  const accounts = emails.map(email => createGoogleAccount({ email, clientFile, redirectUri,
    // The calendar account keeps its original token file, so existing sign-ins survive the upgrade.
    tokenFile: join(dir, email === calendarId ? 'calendar-token.dpapi' : `google-${email.replace(/[^a-z0-9@._-]/gi, '_')}.dpapi`),
    services: [...(email === calendarId ? ['calendar'] : []), ...(options.mailAccounts.includes(email) ? ['mail'] : [])] as GoogleService[],
  }));
  const calendarAccount = accounts[0];
  const readCalendar = createCalendarReader(calendarId, (path, params) =>
    calendarAccount.request('calendar', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`, { params }));
  const mail = createMailReader(accounts.filter(a => a.services.includes('mail')));
  const readSystem = createSystemReader();
  const readQuotas = createQuotaReader(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  const warmup=createWarmupClient(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  const readUsageBreakdown = createUsageBreakdownReader(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  let pending: ReturnType<typeof readCezar> | undefined;
  let cache: Awaited<ReturnType<typeof readCezar>> | undefined;
  let fetchedAt = 0;
  return {
    async cezar() {
      if (!cache || Date.now() - fetchedAt >= 4000) {
        pending ??= readCezar(options.cezarUrl).then(value => { cache = value; fetchedAt = Date.now(); return value; }).finally(() => { pending = undefined; });
        await pending;
      }
      return cache!;
    },
    calendar: () => readCalendar(),
    mail: limit => mail.read(limit),
    async mailAction(account, threadId, action) {
      try { await mail.act(account, threadId, action); }
      catch (error) { throw new SourceError(error instanceof GoogleAuthError ? 401 : 502); }
    },
    googleAccounts: () => Promise.all(accounts.map(a => a.status())),
    system: async () => readSystem(),
    quotas: () => readQuotas(),
    usageBreakdown: readUsageBreakdown,
    warmup:warmup.read,
    saveWarmup:warmup.save,
    runWarmup:warmup.run,
    async googleConnect(email) {
      const account = accounts.find(a => a.email === email);
      if (!account) throw new SourceError(404);
      return account.begin();
    },
    async googleCallback(params) {
      const account = accounts.find(a => a.owns(params));
      try {
        if (!account) throw new GoogleAuthError('invalid_callback');
        await account.finish(params);
        mail.invalidate();
        return { ok: true, message: `Połączono ${account.email.replace(/[<>&"']/g, '')}. Możesz wrócić do Desk Panelu.` };
      } catch (error) {
        const email = account?.email.replace(/[<>&"']/g, '') ?? '';
        if (error instanceof GoogleAuthError && error.reason === 'wrong_account') return { ok: false, message: `Wybrano inne konto. Zaloguj się na ${email}.` };
        if (error instanceof GoogleAuthError && error.reason === 'scopes_missing') return { ok: false, message: 'Zaznacz wszystkie uprawnienia na ekranie zgody Google i spróbuj ponownie.' };
        if (error instanceof GoogleAuthError && error.reason === 'storage_failed') return { ok: false, message: 'Nie udało się bezpiecznie zapisać połączenia na tym komputerze.' };
        return { ok: false, message: 'Nie udało się połączyć. Wróć do panelu i rozpocznij logowanie ponownie.' };
      }
    },
  };
}
