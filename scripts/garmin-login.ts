// One-time Garmin Connect sign-in, run by you in a terminal (`just garmin-login`).
// The e-mail, password (hidden) and MFA code are typed here and never stored or printed; only the OAuth tokens
// are saved, encrypted with DPAPI for the current Windows user, where the service reads them.
import { Garmin, GarminClient } from 'garminconnect-js';
import { createGarminTokenStore, garminTokenFile } from '../server/garmin-tokens';
import { createPrompter } from './prompt';

const file = garminTokenFile(process.env);
const store = createGarminTokenStore(file);
const client = new GarminClient({ tokenStore: store });
const prompt = createPrompter();

function fail(message: string): never {
  prompt.close();
  console.error(message);
  process.exit(1);
}
const describe = (error: unknown) => `${(error as Error)?.constructor?.name ?? 'Error'}${(error as { status?: number })?.status ? ` (HTTP ${(error as { status: number }).status})` : ''}`;

console.log('Garmin Connect: tylko odczyt. Hasło i kod MFA nie są nigdzie zapisywane; zapisują się wyłącznie tokeny (DPAPI).\n');
const email = await prompt.ask('E-mail konta Garmin: ');
const password = await prompt.ask('Hasło (wpisywane niewidocznie): ', true);
try {
  const result = await client.login(email, password);
  if (result.state === 'mfa_required') {
    const code = await prompt.ask('Kod MFA: ');
    await client.resumeLogin(result.mfaState, code);
  }
} catch (error) {
  fail(`Logowanie nie powiodło się: ${describe(error)}. Nie ponawiaj w pętli — Garmin ogranicza próby logowania.`);
}
prompt.close();

// The tokens must really be in the file the service reads, not only in this process.
try {
  if (!(await store.load())) fail('Zalogowano, ale tokeny nie zostały zapisane.');
  const today = new Date().toISOString().slice(0, 10);
  const planned = await new Garmin(client).getScheduledWorkoutSummaries(today, today);
  console.log(`\nGotowe. Logowanie zapisane w ${file}.\nOdczyt próbny: ${planned.length} zaplanowanych treningów na dziś (UTC).`);
  console.log('Usługa podchwyci logowanie przy następnym odczycie (do 15 minut), bez restartu.');
} catch (error) {
  fail(`Logowanie zapisane, ale odczyt próbny się nie udał: ${describe(error)}.`);
}
