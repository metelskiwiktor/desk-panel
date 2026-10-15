// Proof of which lockfile node_modules was installed from. Stored inside node_modules,
// so removing it also removes the proof. `just setup` records it after `npm ci`:
//   node scripts/dependencies.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEPENDENCIES_MARKER = 'node_modules/.desk-panel-dependencies';
/** `npm ci` installs exactly the lockfile, so it alone identifies the installation. */
export const lockHash = () => createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
export const installedMatches = () => existsSync(DEPENDENCIES_MARKER) && readFileSync(DEPENDENCIES_MARKER, 'utf8').trim() === lockHash();
export const recordInstalled = () => writeFileSync(DEPENDENCIES_MARKER, lockHash() + '\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) recordInstalled();
