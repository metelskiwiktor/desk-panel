// An isolated panel for trying Fila's MCP with a real client (`just fila-trial`, docs/fila.md, Q-025).
// It serves the panel on its own free loopback port over a throw-away store in a temporary directory, with its own client
// tokens and its own Hermes token: it never reads or writes the service's data (`~/.desk-panel`) and never listens on
// the service port. It writes ready client configurations into that directory and keeps running until Ctrl-C.
// Tokens go into files there, never to the screen.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FILA_CLIENTS } from '../src/fila-contract';
import { createPanelServer } from '../server/app';
import { createFilaStore } from '../server/fila';
import { filaTokens } from '../server/fila-routes';
import { createScenarioSources } from '../server/scenario';

const dir = mkdtempSync(join(tmpdir(), 'desk-fila-trial-'));
const home = join(dir, 'home');
mkdirSync(home, { recursive: true });
const tokens = filaTokens(home);
const mcpToken = randomBytes(32).toString('hex');
const file = join(dir, 'fila.json');
const fila = createFilaStore({ file });
const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), fila };

// A small project to search, read and change: three threads, one with a Specyfikacja.
const user = (action: Parameters<typeof fila.apply>[0]) => fila.apply(action, 'user');
await user({ action: 'createProject', key: 'PRBA', name: 'Próba Fili' });
await fila.applyBatch([{ action: 'setModules', project: 'PRBA', modules: ['Adapter', 'Wektor'] }], 'claude-code');
await user({ action: 'createThread', project: 'PRBA', type: 'funkcja', title: 'Adapter MCP dla Fili', module: 'Adapter' });
await user({ action: 'createThread', project: 'PRBA', type: 'blad', title: 'Wektor gubi kontekst rozmowy', module: 'Wektor' });
await user({ action: 'createThread', project: 'PRBA', type: 'sprawa', title: 'Sprawdzić próbę klientów' });
await fila.applyBatch([{ action: 'setSpec', thread: 'PRBA-1', text: 'CEL: cztery narzędzia.\nZAKRES: wyszukiwanie, odczyt, zapis, sprawdzenie zapytania.', baseRevision: 0 }], 'claude-code');

const server = createPanelServer(sources, process.cwd(), undefined, undefined, { filaTokens: tokens, mcpToken, wektorFila: true }).listen(Number(process.env.FILA_TRIAL_PORT) || 0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const port = (server.address() as AddressInfo).port;
const url = `http://127.0.0.1:${port}/api/fila/mcp`;

// Claude Code / Claude Desktop-style configuration and one file per client token.
for (const client of FILA_CLIENTS) {
  writeFileSync(join(dir, `token-${client}.txt`), tokens[client]!, { mode: 0o600 });
  writeFileSync(join(dir, `mcp-${client}.json`), JSON.stringify({ mcpServers: { fila: { type: 'http', url, headers: { Authorization: `Bearer ${tokens[client]}` } } } }, null, 2), { mode: 0o600 });
}
writeFileSync(join(dir, 'mcp-hermes-token.txt'), mcpToken, { mode: 0o600 });
writeFileSync(join(dir, 'trial.json'), JSON.stringify({ pid: process.pid, port, url, panel: `http://127.0.0.1:${port}`, dir, store: file }, null, 2));

console.log(`Próba Fili: ${url}`);
console.log(`Katalog (osobny magazyn, tokeny i konfiguracje klientów): ${dir}`);
console.log('Dane próbne: projekt PRBA (PRBA-1 ma Specyfikację). Ctrl-C kończy próbę; katalog zostaje do usunięcia.');
const stop = () => { server.closeAllConnections(); server.close(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
