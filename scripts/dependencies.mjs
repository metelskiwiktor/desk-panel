// Proof of which lockfile node_modules was installed from. Stored inside node_modules,
// so removing it also removes the proof. `just setup` records it after `npm ci`:
//   node scripts/dependencies.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEPENDENCIES_MARKER = 'node_modules/.desk-panel-dependencies';
/** Default `root` keeps the plain relative path (scripts and tests read it as such); a worktree root is joined. */
const at = (root, path) => (root === '.' ? path : join(root, path));
/** `npm ci` installs exactly the lockfile, so it alone identifies the installation. */
export const lockHash = (root = '.') => createHash('sha256').update(readFileSync(at(root, 'package-lock.json'))).digest('hex');
export const installedMatches = (root = '.') => existsSync(at(root, DEPENDENCIES_MARKER)) && readFileSync(at(root, DEPENDENCIES_MARKER), 'utf8').trim() === lockHash(root);
export const recordInstalled = (root = '.') => writeFileSync(at(root, DEPENDENCIES_MARKER), lockHash(root) + '\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) recordInstalled();
