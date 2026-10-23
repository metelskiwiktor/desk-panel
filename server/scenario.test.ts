import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createPanelServer } from './app';
import { workoutProgress } from '../src/training-progress';
import type { TrainingSource } from '../src/training-contract';
import { createScenarioSources, loadScenario, parseScenario } from './scenario';

const dir = join(process.cwd(), 'scenarios');
const now = Date.UTC(2026, 9, 14, 10);
describe('scenario files', () => {
  it.each(readdirSync(dir).filter(f => f.endsWith('.json')))('%s matches the API contracts', (file) => {
    expect(() => loadScenario(join(dir, file), now)).not.toThrow();
  });
  it('resolves relative timestamps and defaults missing endpoints to a failure', () => {
    const scenario = parseScenario({ system: { live: true, name: 'Komputer', status: 'connected', observedAt: 'now-1h30m',
      data: [{ at: 'now-2s', cpuPercent: 10, ramUsedGb: 1, ramTotalGb: 2 }] } }, now);
    expect(scenario.system).toMatchObject({ observedAt: now - 90 * 60_000, data: [{ at: now - 2000 }] });
    expect(scenario.cezar).toEqual({ $error: 503 });
  });
  it('reports contract violations with their path', () => {
    expect(() => parseScenario({ quotas: { live: true, name: 'Limity AI', status: 'connected', observedAt: 'now', data: [{ provider: 'Claude', snapshots: [], history: [] }] } }, now))
      .toThrow(/quotas/);
    expect(() => parseScenario({ unknown: {} }, now)).toThrow();
  });
  it('applies the same 30-day mail window as Gmail', async () => {
    const scenario = JSON.parse(readFileSync(join(dir, 'standard.json'), 'utf8'));
    const [recent] = scenario.mail.data;
    scenario.mail.data = [recent, { ...recent, id: `${recent.account}:aa01`, threadId: 'aa01', receivedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }];
    const file = join(mkdtempSync(join(tmpdir(), 'desk-panel-')), 'old-mail.json');
    writeFileSync(file, JSON.stringify(scenario));
    const mail = await createScenarioSources(file).mail(10);
    expect(mail).toMatchObject({ total: 1, data: [{ id: recent.id }] });
  });
  it('serves the scenario over HTTP like the real server, including failures', async () => {
    const server = createPanelServer(createScenarioSources(join(dir, 'offline.json')), dir).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/api/cezar`)).status).toBe(502);
      expect(await (await fetch(`${base}/api/calendar`)).json()).toMatchObject({ status: 'offline', name: 'Google Calendar' });
      expect((await fetch(`${base}/api/missing`)).status).toBe(404);
    } finally { server.close(); }
  });
  it('resolves day tokens to calendar days and moments of the local day', () => {
    const at = new Date(now);
    const local = (offset: number) => { const d = new Date(at); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const workout = { id: 'w', name: 'Baza', sport: 'cycling', date: 'today+2', durationSec: 4380, phrase: 'BASE', trainingEffect: null, trainingEffectLabel: null, keyWorkout: false, restDay: false, race: false, steps: null };
    const activity = { startAt: 'today-1@22:10', durationSec: 600, sport: 'indoor_cycling', avgPower: null, avgHeartRate: null, trainingStress: null };
    const { training } = parseScenario({ training: { live: true, name: 'Garmin Connect', status: 'connected', observedAt: 'now', data: { plan: null, workouts: [workout, { ...workout, id: 'v', date: 'today' }], activities: [activity] } } }, now);
    const data = (training as { data: { workouts: { date: string }[]; activities: { startAt: number }[] } }).data;
    expect(data.workouts.map(w => w.date)).toEqual([local(2), local(0)]);
    const yesterday = new Date(at); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(22, 10, 0, 0);
    expect(data.activities[0].startAt).toBe(yesterday.getTime());
  });
  it('judges the training-done scenario: today done, yesterday\'s Sprint only partly', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { training } = loadScenario(join(dir, 'training-done.json'), now);
    const { data } = training as unknown as TrainingSource;
    const states = Object.fromEntries(data!.workouts.map(w => [w.name, workoutProgress(w, data!.activities, now, zone).state]));
    expect(states).toMatchObject({ Sprint: 'partial', 'Długa jazda': 'done', Baza: 'planned' });
  });
  it('serves the Garmin plan over HTTP, with its failure states', async () => {
    const serve = async (file: string) => {
      const server = createPanelServer(createScenarioSources(join(dir, file)), dir).listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      try { return await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/training`)).json(); }
      finally { server.close(); }
    };
    expect(await serve('training-intervals.json')).toMatchObject({ status: 'connected', name: 'Garmin Connect', data: { workouts: expect.arrayContaining([expect.objectContaining({ name: 'Próg' })]) } });
    expect(await serve('offline.json')).toMatchObject({ status: 'offline', data: expect.anything() });
    expect(await serve('unavailable.json')).toMatchObject({ status: 'unavailable', data: null, message: expect.stringContaining('just garmin-login') });
  });
});
