// The map in AGENTS.md ("Where knowledge lives") is how every agent session finds the project's knowledge: a path that no
// longer exists sends it nowhere, and a document missing from it is never read. Moving, renaming or adding a document fails
// here until the map says so.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
const map = agents.slice(agents.indexOf('## Where knowledge lives'), agents.indexOf('## Commands'));
/** The "Where" column of each row. */
const cells = map.split('\n').filter(line => line.startsWith('|') && !/^\|\s*(What|---)/.test(line)).map(line => line.split('|')[2] ?? '');
/** Every path a cell names: `src/x.ts`, `servy/README.md`, `.claude/skills/x`; a bare `bank.md` is a file in docs/. */
const named = cells.flatMap(cell => [...cell.matchAll(/(?<![\w/.])\.?[\w-]+(?:\/[\w.-]+)*\.?[\w-]*(?:\.(?:md|ts|tsx|yaml))?/g)]
  .map(([token]) => token)
  .filter(token => token.includes('/') || /\.(md|ts|tsx|yaml)$/.test(token))
  .map(token => token.includes('/') || token === 'README.md' ? token : `docs/${token}`));

describe('the map of AGENTS.md', () => {
  it('names only paths that exist', () => {
    expect(named.length).toBeGreaterThan(20);
    expect(named.filter(path => !existsSync(join(root, path)))).toEqual([]);
  });

  it('lists every document in docs/', () => {
    const docs = readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`);
    expect(docs.filter(doc => !named.includes(doc))).toEqual([]);
  });
});
