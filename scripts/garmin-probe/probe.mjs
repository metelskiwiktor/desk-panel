// One-shot, read-only probe of Garmin Connect through garminconnect-js. Run it yourself in a terminal:
// you type the e-mail, the password (hidden) and the MFA code. Tokens live in memory only and the
// result is written as an anonymised *shape* to output/garmin-probe/. See README.md.
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shape, collectSecrets, findLeaks, scrubString } from './sanitize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'output', 'garmin-probe');
const TIME_ZONE = 'Europe/Warsaw';

function selfTest() {
  const sample = {
    displayName: 'Jan Kowalski', userProfilePK: 123456, workoutId: 98765, workoutName: 'Baza', scheduledDate: '2026-10-24',
    sportTypeKey: 'running', itemType: 'workout', estimatedDurationInSecs: 3000, estimatedDistanceInMeters: 8000.5,
    ownerEmail: 'jan@example.com', note: 'jan@example.com', activityName: 'Poznań Bieganie', startLatitude: 52.4, lon: 16.9,
    accessToken: 'abcdEFGH1234abcdEFGH1234abcdEFGH1234', uuid: '3f2b8c1e-5a4d-4e0b-9f3a-2c1d7e6b5a49', status: 'ACTIVE',
    steps: [1, 2, 3, 4, 5], nested: { location: 'Kościan', phase: 'build', free: 'some personal free text here', userProfilePk: 109608854, weight: 104500, difference: -2200, mystery: 4455667 },
  };
  const out = JSON.stringify(shape(sample));
  const secrets = ['Jan Kowalski', 'jan@example.com', 'Poznań', 'Kościan', '123456', '98765', '52.4', '16.9', '109608854', '104500', '-2200', '4455667', sample.accessToken, sample.uuid, 'personal free text'];
  const leaks = findLeaks(out, secrets);
  const kept = ['Baza', '2026-10-24', 'running', 'workout', '3000', 'ACTIVE'].filter(v => !out.includes(v));
  console.log(out);
  if (leaks.length || kept.length) { console.error('SELFTEST FAILED', { leaks, lostUseful: kept }); process.exit(1); }
  console.log('\nSELFTEST OK: no identifying value survived, useful values kept.');
}

function ask(rl, state, label, hidden) {
  return new Promise(resolve => {
    // The prompt must go through readline (it redraws the line); only what is typed afterwards is muted.
    rl.question(label, answer => { state.muted = false; if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
    state.muted = hidden;
  });
}

const warsawDay = (offsetDays = 0) => {
  const base = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(new Date());
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (process.argv.includes('--selftest')) return selfTest();
  const { GarminClient, Garmin, MemoryTokenStore } = await import('garminconnect-js');
  const state = { muted: false };
  const muteable = new Writable({ write(chunk, enc, cb) { if (!state.muted) process.stdout.write(chunk, enc); cb(); } });
  const rl = createInterface({ input: process.stdin, output: muteable, terminal: true });

  console.log('Garmin probe: tylko odczyt, tokeny tylko w pamięci, hasło i kod nie trafiają do żadnego pliku.\n');
  const email = await ask(rl, state, 'E-mail konta Garmin: ', false);
  const password = await ask(rl, state, 'Hasło (wpisywane niewidocznie): ', true);
  const secrets = [email, email.split('@')[0], password];

  const store = new MemoryTokenStore();
  const client = new GarminClient({ tokenStore: store });
  let result;
  try { result = await client.login(email, password); }
  catch (error) { console.error(`Logowanie nie powiodło się: ${error?.constructor?.name}${error?.status ? ` (HTTP ${error.status})` : ''}. Nie ponawiaj w pętli — Garmin ogranicza próby.`); rl.close(); process.exit(1); }
  if (result.state === 'mfa_required') {
    const code = await ask(rl, state, 'Kod MFA: ', false);
    secrets.push(code);
    try { await client.resumeLogin(result.mfaState, code); }
    catch (error) { console.error(`Kod MFA odrzucony: ${error?.constructor?.name}.`); rl.close(); process.exit(1); }
  }
  rl.close();
  const tokens = await store.load();
  secrets.push(...collectSecrets(tokens));
  console.log('Zalogowano. Odczyt danych (po jednym zapytaniu, z przerwami)...\n');

  const garmin = new Garmin(client);
  const today = warsawDay(), in7 = warsawDay(7), in60 = warsawDay(60);
  const [y, m] = today.split('-').map(Number);
  const nextMonth = m === 12 ? [y + 1, 1] : [y, m + 1];
  const results = {};
  const run = async (label, fn) => {
    const t0 = Date.now();
    let data;
    try {
      data = await fn();
      results[label] = { ok: true, ms: Date.now() - t0, shape: shape(data) };
      const keys = data && typeof data === 'object' ? (Array.isArray(data) ? `lista ${data.length}` : Object.keys(data).slice(0, 6).join(', ')) : String(data);
      console.log(`  ok   ${label.padEnd(34)} ${keys}`);
    } catch (error) {
      results[label] = { ok: false, ms: Date.now() - t0, error: { name: error?.constructor?.name, status: error?.status ?? error?.statusCode ?? null, message: scrubString(error?.message ?? '') } };
      console.log(`  BŁĄD ${label.padEnd(34)} ${error?.constructor?.name}${error?.status ? ` ${error.status}` : ''}`);
    }
    await sleep(400);
    return data;
  };

  await run('scheduledWorkouts(current month)', () => garmin.getScheduledWorkouts(y, m));
  await run('scheduledWorkouts(next month)', () => garmin.getScheduledWorkouts(...nextMonth));
  const upcoming = await run('scheduledWorkoutSummaries(7d)', () => garmin.getScheduledWorkoutSummaries(today, in7));
  // Done-status: do past planned workouts carry associatedActivityId / associatedActivityDateTime?
  await run('scheduledWorkoutSummaries(past 7d)', () => garmin.getScheduledWorkoutSummaries(warsawDay(-7), warsawDay(-1)));
  // Every workoutPhrase the plan uses in the next 4 weeks, as "phrase|sport|name" -> count (a lookup table, no per-day data).
  await run('workoutPhrases(28d)', async () => {
    const counts = {};
    for (const w of await garmin.getScheduledWorkoutSummaries(today, warsawDay(28))) {
      const key = `${w.workoutPhrase}|${w.workoutType}|${w.workoutName}${w.isRestDay ? '|REST' : ''}${w.race ? '|RACE' : ''}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  });
  await run('nextScheduledWorkout', () => garmin.getNextScheduledWorkout());
  await run('trainingPlanWorkouts(today)', () => garmin.getTrainingPlanWorkouts(today));
  // Coach workouts have no workoutId (getWorkoutById 404s); steps and intervals come by workoutUuid.
  const uuids = (upcoming ?? []).filter(w => w?.workoutUuid && !w.isRestDay).slice(0, 3).map(w => w.workoutUuid);
  for (const [i, uuid] of uuids.entries()) await run(`adaptiveWorkout(upcoming #${i + 1})`, () => garmin.getAdaptiveWorkout(uuid));
  if (!uuids.length) console.log('  (brak treningów z workoutUuid w najbliższych 7 dniach — pominięto adaptiveWorkout)');
  await run('activities(last 5)', () => garmin.getActivities(0, 5));
  await run('calendarEvents(next 60d)', () => garmin.listCalendarEvents(today, in60));
  await run('trainingStatus(today)', () => garmin.getTrainingStatus(today));
  await run('trainingReadiness(today)', () => garmin.getTrainingReadiness(today));
  await run('morningTrainingReadiness(today)', () => garmin.getMorningTrainingReadiness(today));
  await run('bodyBattery(today)', () => garmin.getBodyBattery(today));
  await run('sleep(today)', () => garmin.getSleepData(today));
  await run('hrv(today)', () => garmin.getHrvData(today));
  await run('restingHr(today)', () => garmin.getRhrDay(today));
  await run('maxMetrics(today)', () => garmin.getMaxMetrics(today));
  await run('racePredictions(latest)', () => garmin.getRacePredictions());
  await run('userSummary(today)', () => garmin.getUserSummary(today));

  const out = { probe: 'garmin-probe', libraryVersion: '0.10.0', node: process.version, timeZone: TIME_ZONE, generatedFor: 'shape only — no tokens, no identity', results };
  const serialized = JSON.stringify(out, null, 2);
  const leaks = findLeaks(serialized, secrets);
  if (leaks.length) {
    console.error(`\nPRZERWANO: wynik zawierałby ${leaks.length} wartość(i) z Twoich danych logowania lub tokenów. Plik NIE został zapisany.`);
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  const hhmm = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(':', '');
  const file = join(outDir, `shape-${today}-${hhmm}.json`);
  writeFileSync(file, serialized);
  const failed = Object.values(results).filter(r => !r.ok).length;
  console.log(`\nZapisano: ${file}\nOdczytów: ${Object.keys(results).length}, błędów: ${failed}. Tokeny zniknęły razem z procesem.`);
}

main().catch(error => { console.error('Sonda przerwana:', error?.constructor?.name, scrubString(error?.message ?? '')); process.exit(1); });
