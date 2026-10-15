// Runs the real UI (Vite) against a scenario API, optionally taking Playwright screenshots.
//   npm run scenario -- standard                       → serve until Ctrl+C
//   npm run scenario -- offline --shot                 → output/screenshots/offline-*.png
//   npm run scenario -- path/to/my.json --shot --pages pulpit,ustawienia --device waveshare-11.6 --scale all
// Screens come from devices.json: --device <id>|all (default: the first one), --scale <factor>|primary|all.
import { existsSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { createPanelServer } from '../server/app';
import { createScenarioSources, loadScenario } from '../server/scenario';
import { devices, viewportsOf, type Viewport } from '../src/devices';

const PAGES = { pulpit: 'Pulpit', zadania: 'Zadania', kalendarz: 'Kalendarz', system: 'System', zdarzenia: 'Zdarzenia', ustawienia: 'Ustawienia' } as const;
type PageName = keyof typeof PAGES;

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  shot: { type: 'boolean', default: false },
  pages: { type: 'string', default: Object.keys(PAGES).join(',') },
  device: { type: 'string', default: Object.keys(devices)[0] },
  scale: { type: 'string', default: 'primary' },
  out: { type: 'string', default: 'output/screenshots' },
} });
const name = positionals[0] ?? 'standard';
const file = name.endsWith('.json') ? resolve(name) : join(process.cwd(), 'scenarios', `${name}.json`);
const label = name.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
try { loadScenario(file); } catch (error) { console.error((error as Error).message); process.exit(1); }

const api = createPanelServer(createScenarioSources(file), join(process.cwd(), 'dist')).listen(0, '127.0.0.1');
await new Promise(done => api.once('listening', done));
// Read by vite.config.ts, so it must be set before Vite loads the config.
process.env.DESK_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
const { createServer } = await import('vite');
const vite = await createServer({ server: { port: 5180 }, logLevel: 'warn' });
await vite.listen();
const url = vite.resolvedUrls!.local[0];
async function stop() { await vite.close(); api.closeAllConnections(); api.close(); }

if (!values.shot) {
  console.log(`Scenariusz ${label}: ${url}  (plik czytany przy każdym zapytaniu; Ctrl+C kończy)`);
  process.on('SIGINT', () => void stop().then(() => process.exit(0)));
} else {
  const pages = values.pages.split(',').map(p => p.trim()) as PageName[];
  const unknown = pages.filter(p => !(p in PAGES));
  if (unknown.length) { console.error(`Nieznane strony: ${unknown.join(', ')}. Dostępne: ${Object.keys(PAGES).join(', ')}`); process.exit(1); }
  const targets = selectViewports(values.device, values.scale);
  mkdirSync(values.out, { recursive: true });
  const browser = await launchChromium();
  try {
    for (const target of targets) {
      // Same model as DevTools device mode: CSS viewport × Windows scaling, so images are physical-resolution.
      const page = await browser.newPage({ viewport: { width: target.width, height: target.height }, deviceScaleFactor: target.scale, hasTouch: target.device.touch });
      page.on('pageerror', error => console.error(`Błąd strony: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') console.error(`Konsola: ${message.text()}`); });
      await page.goto(url);
      await page.waitForTimeout(1500);
      for (const pageName of pages) {
        await page.getByRole('navigation').getByRole('button', { name: PAGES[pageName] }).click();
        await page.waitForTimeout(600);
        const path = join(values.out, `${label}-${pageName}-${target.label}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log(path);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await stop();
  }
}

function selectViewports(device: string, scale: string): Viewport[] {
  const all = (device === 'all' ? Object.keys(devices) : [device]).flatMap(viewportsOf);
  if (scale === 'all') return all;
  if (scale === 'primary') return all.filter(v => v.primary);
  const chosen = all.filter(v => v.scale === Number(scale));
  if (!chosen.length) throw new Error(`Skalowanie ${scale} nie jest skonfigurowane dla ${device} w devices.json.`);
  return chosen;
}

/** Playwright's own Chromium, or a preinstalled one (DESK_CHROMIUM, cloud sandboxes). */
async function launchChromium(): Promise<Browser> {
  try { return await chromium.launch(); } catch (error) {
    const fallback = [process.env.DESK_CHROMIUM, '/opt/pw-browsers/chromium'].find(p => p && existsSync(p));
    if (!fallback) throw new Error(`Brak przeglądarki dla Playwrighta. Uruchom: npx playwright install chromium\n${(error as Error).message}`);
    return chromium.launch({ executablePath: fallback });
  }
}
