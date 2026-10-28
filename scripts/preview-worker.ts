import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPanelServer } from './server/app';
import { createCockpit } from './server/cockpit';
import { createScenarioSources, loadScenario, SCENARIO_PR } from './server/scenario';
import { createScenarioChat } from './server/scenario-chat';
import { createServer as createVite } from 'vite';

// This file is copied into the selected checkout; all application imports resolve there.
const { PREVIEW_PR: pr, PREVIEW_SHA: sha, PREVIEW_STATE: state, PREVIEW_TOKEN: token } = process.env;
if (!pr || !sha || !state || !token || !/^\d+$/.test(pr) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid preview identity');
const file = join(process.env.USERPROFILE || process.env.HOME!, 'scenario.json');
loadScenario(file);
// Scenario links must not open the real local Cezar, even after a simulated dispatch.
const dummy = createServer((_req, res) => res.writeHead(404).end()).listen(0, '127.0.0.1');
await new Promise<void>((ok, fail) => { dummy.once('listening', ok); dummy.once('error', fail); });
const dummyAddress = dummy.address();
if (!dummyAddress || typeof dummyAddress === 'string') throw new Error('Dummy server failed to bind');
const dummyUrl = `http://127.0.0.1:${dummyAddress.port}/`;
const sources = createScenarioSources(file);
const createRun = sources.cezarCreateRun;
if (createRun) sources.cezarCreateRun = async input => ({ ...await createRun(input), url: dummyUrl });
const chat = await createScenarioChat();
const cockpit = createCockpit({ sources, file: join(mkdtempSync(join(tmpdir(), 'preview-cockpit-')), 'cockpit.json'), cezarUrl: dummyUrl,
  gh: async () => JSON.stringify({ number: 42, title: 'Synthetic PR', state: 'OPEN', headRefName: 'scenario', url: SCENARIO_PR, statusCheckRollup: [] }) });
const api = createPanelServer(sources, join(process.cwd(), 'dist'), undefined, chat, { cockpit }).listen(0, '127.0.0.1');
await new Promise<void>((ok, fail) => { api.once('listening', ok); api.once('error', fail); });
const address = api.address();
if (!address || typeof address === 'string') throw new Error('API failed to bind');
process.env.DESK_API_URL = `http://127.0.0.1:${address.port}`;
let stopping = false;
const vite = await createVite({ server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: process.env.DESK_API_URL, changeOrigin: false } } }, plugins: [{
  name: 'desk-preview-identity',
  transformIndexHtml: { order: 'post', handler: () => [{ tag: 'div', attrs: { id: 'desk-preview-banner', style: 'position:fixed;z-index:2147483647;bottom:0;left:0;background:#7b2500;color:white;padding:5px 10px;font:14px monospace;pointer-events:none' }, children: `PREVIEW PR #${pr} · ${sha} · dane testowe`, injectTo: 'body' }] },
  configureServer(server) { server.middlewares.use('/__desk_preview_control', (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
    if (req.method === 'GET') { res.end(JSON.stringify({ pr, sha })); return; }
    if (req.method === 'POST') { res.end('stopping'); if (!stopping) { stopping = true; setTimeout(() => void stop(), 50); } return; }
    next();
  }); },
}] });
await vite.listen();
const addr = vite.httpServer?.address();
if (!addr || typeof addr === 'string') throw new Error('Vite failed to bind');
writeFileSync(state, JSON.stringify({ pr: Number(pr), sha, url: `http://127.0.0.1:${addr.port}`, token, pid: process.pid }));
async function stop() { await vite.close(); api.closeAllConnections(); api.close(); dummy.closeAllConnections(); dummy.close(); chat.dispose(); process.exit(0); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
