import { z } from 'zod';
import { parseWorkspace } from '../src/tile-grid';
import type { MigrationInput, MigrationPlan } from './fila-migration';

const kioskSchema = z.object({
  version: z.literal(1), kind: z.literal('desk-panel-pulpits'), exportedAt: z.string(), origin: z.string().url(),
  pulpits: z.string().nullable(),
  workspaces: z.array(z.object({ key: z.string(), source: z.string(), raw: z.string() }).strict()),
  missingWorkspaces: z.array(z.string()),
}).strict();

/** Tie the exported profile to the same raw workspaces covered by the approved migration input. */
export function kioskBundle(input: MigrationInput, plan: MigrationPlan, value: unknown) {
  const snapshot = kioskSchema.parse(value);
  if (snapshot.workspaces.length !== input.workspaces.length || new Set(snapshot.workspaces.map(w => w.key)).size !== snapshot.workspaces.length) throw new Error('Eksport nie obejmuje tej samej liczby układów.');
  for (const workspace of snapshot.workspaces) {
    if (!parseWorkspace(workspace.raw) || workspace.source !== `${snapshot.origin} ${workspace.key}`) throw new Error('Niepoprawny układ kiosku.');
    const matches = input.workspaces.filter(item => item.source.endsWith(` ${workspace.key}`) && item.source.includes(` / ${snapshot.origin} / `));
    if (matches.length !== 1 || matches[0].raw !== workspace.raw) throw new Error('Eksport kiosku różni się od wejścia planu.');
  }
  return { snapshot, rows: plan.tiles.map(({ source, tile, query, settings }) => ({ source, tile, query, settings })) };
}
