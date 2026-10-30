import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { createPanelServer } from '../server/app';
import { createCockpit } from '../server/cockpit';
import { createScenarioSources, loadScenario, SCENARIO_PR } from '../server/scenario';
import { createScenarioChat } from '../server/scenario-chat';
import { PANEL_TOOLS } from '../server/panel-mcp';
import { devices, viewportsOf, type Viewport } from '../src/devices';

async function freeLoopbackPort() {
  const reservation = createHttpServer();
  await new Promise<void>((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((done, fail) => reservation.close(error => error ? fail(error) : done()));
  return port;
}

/** One isolated API, stand-in Hermes and Vite. No real provider, service port or user storage is used. */
export async function startScenario(file: string, hermes: 'up' | 'down' = 'up') {
  loadScenario(file);
  const sources = createScenarioSources(file);
  const chat = await createScenarioChat({ hermes, toolScript: async message => {
    const fixture = loadScenario(file).appointment;
    if (!/wizyt|znanylekarz/i.test(message) || !('query' in fixture)) return;
    const args = fixture.query;
    const output = await PANEL_TOOLS.panel_znanylekarz.run(args, { sources, views: {}, now: Date.now(), cezarUrl: 'http://127.0.0.1:4321/' });
    return { tools: [{ name: 'mcp_desk-panel_panel_znanylekarz', args, output }], answer: 'Wybierz dzień i godzinę na karcie. To dane scenariusza; niczego nie rezerwujesz.' };
  } });
  const directory = mkdtempSync(join(tmpdir(), 'desk-panel-scenario-cockpit-'));
  let checksAsked = 0;
  const cockpit = createCockpit({
    sources, file: join(directory, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/',
    gh: async () => JSON.stringify({ number: 42, title: 'Chip statusu taska w kokpicie', state: 'OPEN', headRefName: 'cez/00000000', url: SCENARIO_PR,
      statusCheckRollup: ['test', 'typecheck', 'build'].map((name, i) => ({ name, status: checksAsked++ > 2 + i ? 'COMPLETED' : 'IN_PROGRESS', conclusion: checksAsked > 3 + i ? 'SUCCESS' : '' })) }),
  });
  const api = createPanelServer(sources, join(process.cwd(), 'dist'), undefined, chat, { cockpit });
  let vite: ViteDevServer | undefined, stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    try { await vite?.close(); }
    finally {
      try {
        api.closeAllConnections();
        if (api.listening) await new Promise<void>((done, fail) => api.close(error => error ? fail(error) : done()));
      } finally {
        try { await chat.dispose(); }
        finally {
          const owned = resolve(directory);
          if (dirname(owned) !== resolve(tmpdir()) || !basename(owned).startsWith('desk-panel-scenario-cockpit-')) throw new Error('Nieprawidłowy katalog tymczasowy scenariusza.');
          rmSync(owned, { recursive: true, force: true });
        }
      }
    }
  })();
  try {
    await new Promise<void>((done, fail) => { api.once('error', fail); api.listen(0, '127.0.0.1', () => { api.off('error', fail); done(); }); });
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    // Vite 6 treats port 0 as its default port. Ask the OS for a port first; Vite may retry if it is taken meanwhile.
    vite = await createServer({ server: { host: '127.0.0.1', port: await freeLoopbackPort(), strictPort: false, proxy: { '/api': { target: apiUrl, changeOrigin: false } } }, logLevel: 'warn' });
    await vite.listen();
    return { url: vite.resolvedUrls!.local[0], stop };
  } catch (error) { await stop(); throw error; }
}

export function selectViewports(device: string, scale: string): Viewport[] {
  const all = (device === 'all' ? Object.keys(devices) : [device]).flatMap(viewportsOf);
  if (scale === 'all') return all;
  if (scale === 'primary') return all.filter(v => v.primary);
  const chosen = all.filter(v => v.scale === Number(scale));
  if (!chosen.length) throw new Error(`Skalowanie ${scale} nie jest skonfigurowane dla ${device} w devices.json.`);
  return chosen;
}

export async function launchChromium(): Promise<Browser> {
  try { return await chromium.launch(); } catch (error) {
    const fallback = [process.env.DESK_CHROMIUM, '/opt/pw-browsers/chromium'].find(p => p && existsSync(p));
    if (!fallback) throw new Error(`Brak przeglądarki dla Playwrighta. Uruchom: npx playwright install chromium\n${(error as Error).message}`);
    return chromium.launch({ executablePath: fallback });
  }
}
