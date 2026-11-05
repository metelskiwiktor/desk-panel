import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep complete runs only; a pending directory is never mistaken for a finished report. */
export function saveCheckHistory(root, { log, failures, tests, results }) {
  mkdirSync(root, { recursive: true });
  const pending = mkdtempSync(join(root, '.pending-'));
  try {
    writeFileSync(join(pending, 'check.log'), log);
    writeFileSync(join(pending, 'check-failures.json'), JSON.stringify({ failures }, null, 2));
    if (tests !== undefined) writeFileSync(join(pending, 'check-tests.json'), tests);
    writeFileSync(join(pending, 'result.json'), JSON.stringify({ completedAt: new Date().toISOString(), results }, null, 2));
    const name = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
    renameSync(pending, join(root, name));
    const completed = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d{4}-\d\d-\d\dT/.test(entry.name)).map(entry => entry.name).sort().reverse();
    for (const old of completed.slice(10)) rmSync(join(root, old), { recursive: true, force: true });
    return name;
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
}
