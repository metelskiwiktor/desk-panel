import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { saveCheckHistory } from './check-history.mjs';

afterEach(() => vi.useRealTimers());

it('keeps the ten newest complete check reports, including failures and a missing Vitest report', () => {
  const root = mkdtempSync(join(tmpdir(), 'desk-check-history-'));
  vi.useFakeTimers();
  try {
    let latest;
    for (let i = 0; i < 12; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
      latest = saveCheckHistory(root, { log: `run ${i}`, failures: i === 11 ? [{ test: 'failed' }] : [], tests: i === 11 ? undefined : `report ${i}`, results: [{ label: 'testy', code: i === 11 ? 1 : 0, seconds: '1.0' }] });
    }
    const names = readdirSync(root).sort();
    expect(names).toHaveLength(10);
    expect(names[0]).toContain('00-00-02');
    expect(readFileSync(join(root, latest, 'check.log'), 'utf8')).toBe('run 11');
    expect(JSON.parse(readFileSync(join(root, latest, 'check-failures.json'), 'utf8')).failures).toEqual([{ test: 'failed' }]);
    expect(JSON.parse(readFileSync(join(root, latest, 'result.json'), 'utf8')).results[0].code).toBe(1);
    expect(readdirSync(join(root, latest))).not.toContain('check-tests.json');
    expect(readFileSync(join(root, names[0], 'check-tests.json'), 'utf8')).toBe('report 2');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
