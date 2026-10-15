import { cpus, freemem, totalmem } from 'node:os';
import { systemSourceSchema, type SystemSource } from '../src/system-contract';

type CpuTimes = ReturnType<typeof cpus>[number]['times'];
const counters = (cores: { times: CpuTimes }[]) => {
  if (!cores.length) throw new Error('CPU counters unavailable');
  const result = cores.reduce((sum, core) => {
    const values = Object.values(core.times);
    if (values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid counters');
    return { idle: sum.idle + core.times.idle, total: sum.total + values.reduce((a, b) => a + b, 0), cores: cores.length };
  }, { idle: 0, total: 0, cores: cores.length });
  return result;
};
export function createSystemReader(deps = { cpus, freemem, totalmem, now: Date.now }) {
  let baseline: ReturnType<typeof counters> | undefined;
  let baselineAt = 0;
  let lastAttempt = -Infinity;
  let source: SystemSource = { live: true, name: 'Komputer', status: 'loading', observedAt: null, data: null };
  return function read(): SystemSource {
    const now = deps.now();
    if (now >= lastAttempt && now - lastAttempt < 2000) return source;
    lastAttempt = now;
    try {
      const current = counters(deps.cpus());
      const total = deps.totalmem();
      const free = deps.freemem();
      if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0 || free < 0 || free > total) throw new Error('Invalid memory');
      const previous = baseline;
      const elapsed = now - baselineAt;
      baseline = current; baselineAt = now;
      // First read and resume need two adjacent measurements; never invent 0%.
      if (!previous || elapsed > 10000 || elapsed <= 0 || previous.cores !== current.cores) {
        source = { live: true, name: 'Komputer', status: 'loading', observedAt: null, data: null, message: 'Zbieram pierwsze próbki CPU…' };
        return source;
      }
      const totalDelta = current.total - previous.total;
      const idleDelta = current.idle - previous.idle;
      if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) throw new Error('Invalid CPU delta');
      const sample = { at: now, cpuPercent: 100 * (1 - idleDelta / totalDelta),
        ramUsedGb: (total - free) / 1024 ** 3, ramTotalGb: total / 1024 ** 3 };
      const history = [...(source.data || []).filter(s => s.at > now - 300000), sample].slice(-150);
      source = systemSourceSchema.parse({ live: true, name: 'Komputer', status: 'connected', observedAt: now, data: history });
    } catch {
      baseline = undefined;
      source = { ...source, status: 'unavailable', message: 'Pomiar CPU i RAM jest niedostępny. Ponowię odczyt.' };
    }
    return source;
  };
}
