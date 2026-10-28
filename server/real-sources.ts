import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BankError, createBank } from './bank';
import { createBankLabelStore, privateFile } from './bank-labels';
import { readPrivate, writePrivate } from './private-store';
import { readCezar } from './cezar';
import { cezarAction, createCezarRun, createFinishedReader, readCezarRun, readCezarDefaults } from './cezar-finished';
import { createCalendarReader } from './calendar';
import { createGarminApi, createGarminReader } from './garmin';
import { garminTokenFile } from './garmin-tokens';
import { createGoogleAccount, GoogleAuthError, type GoogleService } from './google-oauth';
import { createMailReader } from './gmail';
import { createSystemReader } from './system';
import { createTodoStore } from './todos';
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
  const calendarRequest = (id: string) => (path: string, params?: Record<string, string>) =>
    calendarAccount.request('calendar', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}${path}`, { params });
  // Other calendars of the calendar account, e.g. a subscribed Garmin training calendar (`…@import.calendar.google.com`).
  const extraCalendars = (env.DESK_EXTRA_CALENDARS || '').split(',').map(id => id.trim()).filter(Boolean);
  const readCalendar = createCalendarReader(calendarId, calendarRequest(calendarId), Date.now, extraCalendars.map(calendarRequest));
  // The plan day boundaries follow the machine's zone unless set explicitly.
  const readTraining = createGarminReader({ api: createGarminApi(garminTokenFile(env)), timeZone: env.DESK_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone });
  const mail = createMailReader(accounts.filter(a => a.services.includes('mail')));
  // PKO BP through Enable Banking. The consent returns to the panel's own address: the Tailscale name when there is one.
  const bank = createBank({
    appId: env.DESK_BANK_APP_ID?.trim() || undefined,
    keyFile: env.DESK_BANK_KEY_FILE || join(dir, 'enablebanking', 'private.pem'),
    redirectUrl: env.DESK_BANK_REDIRECT_URL || (env.DESK_ALLOWED_HOST ? `https://${env.DESK_ALLOWED_HOST.trim().toLowerCase()}/api/bank/callback` : `http://127.0.0.1:${options.port}/api/bank/callback`),
    store: { read: name => readPrivate(join(dir, `bank-${name}.dpapi`)), write: (name, value) => writePrivate(join(dir, `bank-${name}.dpapi`), value) },
  });
  // The user's marks on its operations, from the kept reading only: marking never makes the bank be read.
  const bankLabels = createBankLabelStore({ operations: () => bank.cached(), persistence: privateFile(join(dir, 'bank-labels.dpapi'), { read: readPrivate, write: writePrivate }) });
  const readSystem = createSystemReader();
  const todoStore = createTodoStore({ file: join(dir, 'todos.json') });
  const readQuotas = createQuotaReader(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  const warmup=createWarmupClient(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  const readUsageBreakdown = createUsageBreakdownReader(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  let pending: ReturnType<typeof readCezar> | undefined;
  let cache: Awaited<ReturnType<typeof readCezar>> | undefined;
  let fetchedAt = 0;
  const finishedReader = createFinishedReader(options.cezarUrl);
  let lastFinished: Awaited<ReturnType<typeof finishedReader.read>> = [];
  let active = new Set<string>();
  return {
    async cezar() {
      if (!cache || Date.now() - fetchedAt >= 4000) {
        pending ??= readCezar(options.cezarUrl).then(value => {
          cache = value; fetchedAt = Date.now();
          // A task that left the active lists most likely finished: have the finished list ready for it at once, not up to 30 s later.
          const ids = new Set(value.tasks.map(t => t.id));
          if (!value.partial) finishedReader.expect([...active].filter(id => !ids.has(id)));
          active = ids;
          return value;
        }).finally(() => { pending = undefined; });
        await pending;
      }
      // Finished tasks are a bonus: a Cezar that cannot list them still shows the rest, with the last list it gave.
      lastFinished = await finishedReader.read().catch(() => lastFinished);
      return { ...cache!, finished: lastFinished };
    },
    async cezarRun(id) {
      return readCezarRun(options.cezarUrl, id);
    },
    async cezarAction(id, action) {
      try { await cezarAction(options.cezarUrl, id, action); }
      catch { throw new SourceError(502); }
      finishedReader.invalidate(id);
    },
    async cezarCreateRun(input) {
      try {
        const created = await createCezarRun(options.cezarUrl, input);
        cache = undefined;
        fetchedAt = 0;
        return created;
      } catch {
        throw new SourceError(502);
      }
    },
    async cezarDefaults(workflow, selectedRunner) {
      return readCezarDefaults(options.cezarUrl, workflow, selectedRunner);
    },
    calendar: () => readCalendar(),
    training: () => readTraining(),
    mail: limit => mail.read(limit),
    async mailAction(account, threadId, action) {
      try { await mail.act(account, threadId, action); }
      catch (error) { throw new SourceError(error instanceof GoogleAuthError ? 401 : 502); }
    },
    googleAccounts: () => Promise.all(accounts.map(a => a.status())),
    system: async () => readSystem(),
    quotas: () => readQuotas(),
    todos: () => todoStore.read(),
    todoAction: action => todoStore.apply(action),
    bank: () => bank.read(),
    bankLabels: () => bankLabels.read(),
    bankLabelAction: action => bankLabels.apply(action),
    bankLedger: () => bankLabels.ledger(),
    async bankConnect() {
      try { return await bank.begin(); }
      catch { throw new SourceError(409); }
    },
    async bankCallback(params) {
      try {
        if (!bank.owns(params)) throw new BankError('invalid_callback');
        await bank.finish(params);
        return { ok: true, message: 'Połączono konto PKO BP. Możesz wrócić do Desk Panelu.' };
      } catch (error) {
        if (error instanceof BankError && error.reason === 'storage_failed') return { ok: false, message: 'Nie udało się bezpiecznie zapisać zgody na tym komputerze.' };
        return { ok: false, message: 'Nie udało się połączyć konta. Wróć do panelu i rozpocznij łączenie ponownie.' };
      }
    },
    usageBreakdown: readUsageBreakdown,
    githubPr: async () => ({ pullRequests: [], repositories: [], totalCount: 0 }),
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
