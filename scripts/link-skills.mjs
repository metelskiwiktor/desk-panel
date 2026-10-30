#!/usr/bin/env node
// Agent skills live once, in skills/<name>/SKILL.md (tracked). Claude Code reads .claude/skills and Codex reads .agents/skills:
// both are local links to skills/ (gitignored, a junction on Windows: no admin rights or developer mode needed). Run by
// `just setup`; safe to run again. A real folder in a link's place is left alone and reported, never deleted.
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'skills');
let failed = false;
for (const link of [join(root, '.claude', 'skills'), join(root, '.agents', 'skills')]) {
  const name = link.slice(root.length + 1);
  let stat;
  try { stat = lstatSync(link); } catch { stat = null; }
  if (stat?.isSymbolicLink()) {
    let points;
    try { points = realpathSync(link); } catch { points = readlinkSync(link); }
    if (points === realpathSync(target)) { console.log(`${name} -> skills (jest)`); continue; }
    console.error(`${name} wskazuje na ${points}, nie na skills/: popraw ręcznie.`);
    failed = true;
    continue;
  }
  if (stat) { console.error(`${name} to zwykły folder, nie dowiązanie: przenieś jego skille do skills/ i usuń go.`); failed = true; continue; }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`${name} -> skills (utworzone)`);
}
if (!existsSync(join(target))) { console.error('Brak folderu skills/.'); failed = true; }
process.exit(failed ? 1 : 0);
