import { describe, expect, it } from 'vitest';
import { CHART_WINDOW_MS, loadChart } from './SystemPopover';
import type { SystemSample } from './model';

const sample = (at: number, cpuPercent: number): SystemSample => ({ at, cpuPercent, ramUsedGb: 8, ramTotalGb: 32 });

describe('load chart', () => {
  it('is empty without samples', () => {
    expect(loadChart([], s => s.cpuPercent)).toEqual({ path: '', area: '', last: null, avg: 0, max: 0 });
  });
  it('puts the newest sample on the right edge and 100% on the top', () => {
    const chart = loadChart([sample(0, 0), sample(CHART_WINDOW_MS, 100)], s => s.cpuPercent);
    expect(chart.last).toEqual({ x: 360, y: 0 });
    expect(chart.path.startsWith('M')).toBe(true);
    expect(chart).toMatchObject({ avg: 50, max: 100 });
  });
  it('starts late when there is little history and drops what is older than the window', () => {
    const now = 10 * CHART_WINDOW_MS;
    const chart = loadChart([sample(now - 2 * CHART_WINDOW_MS, 90), sample(now - CHART_WINDOW_MS / 2, 40), sample(now, 20)], s => s.cpuPercent);
    expect(chart.path.startsWith('M180.0 ')).toBe(true);
    expect(chart.max).toBe(40);
  });
  it('keeps values inside the chart', () => {
    expect(loadChart([sample(1, 250)], s => s.cpuPercent).last!.y).toBe(0);
  });
});
