import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPanelServer } from '../server/app';
import { createCockpit } from '../server/cockpit';
import { createScenarioSources, loadScenario, SCENARIO_PR } from '../server/scenario';
import { createScenarioChat } from '../server/scenario-chat';
import { createServer as createVite } from 'vite';

// Copied into scripts/ in the selected checkout, preserving these relative application imports.
// Windows may supply an 8.3 path (RUNNER~1). Vite rejects '~' before checking fs.allow.
// Resolve the checkout, including junctions, before Vite reads its config or constructs URLs.
const checkout = realpathSync.native(process.cwd());
process.chdir(checkout);
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
const scenarioCockpit = createCockpit({ sources, file: join(mkdtempSync(join(tmpdir(), 'preview-cockpit-')), 'cockpit.json'), cezarUrl: dummyUrl,
  gh: async () => JSON.stringify({ number: 42, title: 'Synthetic PR', state: 'OPEN', headRefName: 'scenario', url: SCENARIO_PR, statusCheckRollup: [] }) });
// The scenario uses a GitHub-shaped URL internally to recognize its mock PR. Never expose it to the browser.
const cockpit: typeof scenarioCockpit = {
  ...scenarioCockpit,
  async view(...args) {
    const view = await scenarioCockpit.view(...args);
    return { ...view, task: view.task?.prUrl ? { ...view.task, prUrl: dummyUrl } : view.task,
      pr: view.pr ? { ...view.pr, url: dummyUrl } : view.pr };
  },
};
const api = createPanelServer(sources, join(process.cwd(), 'dist'), undefined, chat, { cockpit }).listen(0, '127.0.0.1');
await new Promise<void>((ok, fail) => { api.once('listening', ok); api.once('error', fail); });
const address = api.address();
if (!address || typeof address === 'string') throw new Error('API failed to bind');
process.env.DESK_API_URL = `http://127.0.0.1:${address.port}`;
// Vite treats port 0 as its default (5173), rather than asking the OS for a port.
// Release an OS-assigned port immediately before Vite binds it; strictPort makes a
// competing bind fail safely instead of walking onto another port (including 5174).
let frontendPort: number;
do {
  const probe = createPortProbe();
  await new Promise<void>((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok); });
  const candidate = probe.address();
  if (!candidate || typeof candidate === 'string') throw new Error('Port probe failed to bind');
  frontendPort = candidate.port;
  await new Promise<void>((ok, fail) => probe.close(error => error ? fail(error) : ok()));
} while (frontendPort === 5174);
let stopping = false;
const vite = await createVite({ root: checkout, server: { host: '127.0.0.1', port: frontendPort, strictPort: true, proxy: { '/api': { target: process.env.DESK_API_URL, changeOrigin: false } } }, plugins: [{
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
// A listening control endpoint alone does not mean the frontend can be served.
const frontend = await fetch(`http://127.0.0.1:${addr.port}/`);
if (!frontend.ok || !(await frontend.text()).includes('desk-preview-banner')) {
  throw new Error(`Preview frontend failed its readiness check (HTTP ${frontend.status}); inspect Vite output.`);
}
writeFileSync(state, JSON.stringify({ pr: Number(pr), sha, url: `http://127.0.0.1:${addr.port}`, token, pid: process.pid }));
async function stop() { await vite.close(); api.closeAllConnections(); api.close(); dummy.closeAllConnections(); dummy.close(); chat.dispose(); process.exit(0); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
