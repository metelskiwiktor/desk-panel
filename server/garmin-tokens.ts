import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenStore, Tokens } from 'garminconnect-js';
import { readPrivate, writePrivate } from './private-store';

export const garminTokenFile = (env: NodeJS.ProcessEnv) => env.DESK_GARMIN_TOKEN_FILE || join(homedir(), '.desk-panel', 'garmin-tokens.dpapi');

/** Saved Garmin tokens exist but cannot be read (DPAPI of another user, corrupt file). */
export class GarminStorageError extends Error {}

const isTokens = (value: unknown): value is Tokens => {
  const tokens = value as { oauth1?: unknown; oauth2?: unknown } | null;
  return !!tokens && typeof tokens === 'object' && !!tokens.oauth1 && typeof tokens.oauth1 === 'object' && !!tokens.oauth2 && typeof tokens.oauth2 === 'object';
};

/** garminconnect-js keeps its OAuth tokens here, encrypted with DPAPI for the current Windows user like the Google tokens. */
export function createGarminTokenStore(file: string, io = { read: readPrivate, write: writePrivate, remove: (path: string) => rm(path, { force: true }) }): TokenStore {
  return {
    async load() {
      let value: unknown;
      try { value = await io.read(file); }
      // No file is a normal first run; anything else is a different problem.
      catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw new GarminStorageError('unreadable');
      }
      if (!isTokens(value)) throw new GarminStorageError('invalid');
      return value;
    },
    save: tokens => io.write(file, tokens),
    clear: () => io.remove(file),
  };
}
