// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createZnanyLekarzReader } from './znanylekarz';
import { appointmentQuerySchema } from '../src/appointment-contract';
const NOW = Date.parse('2026-10-29T10:00:00+01:00');
const fixture = () => JSON.parse(readFileSync('scenarios/fixtures/znanylekarz.json', 'utf8'));
const query = appointmentQuerySchema.parse({ profile: 'https://www.znanylekarz.pl/profil/anna-maj', service: 'konsultacja dermatologiczna', mode: 'online' });
function setup(data = fixture(), alter?: (u: URL) => Response | undefined) {
  const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(raw));
    if (init?.method !== 'GET') throw new Error('write refused');
    const changed = alter?.(u); if (changed) return changed;
    if (u.pathname.startsWith('/profil/')) return new Response(data.profile);
    if (u.pathname.endsWith('/addresses')) return Response.json(data.addresses);
    if (u.pathname.endsWith('/services')) return Response.json(data.services);
    if (u.pathname.endsWith('/slots')) return Response.json(data.slots);
    return Response.json(data.doctor);
  });
  return { fetcher, read: createZnanyLekarzReader({ fetcher: fetcher as typeof fetch, now: () => NOW }) };
}
describe('ZnanyLekarz anonymous reader', () => {
  it('fetches actual service duration, filters by service and makes a bound URL without exposing its token', async () => {
    const { read, fetcher } = setup(); const p = await read(query);
    expect(p).toMatchObject({ doctorId: '101', addressId: '201', serviceId: '301', durationMinutes: 30, price: 250, timeZone: 'Europe/Warsaw' });
    expect(p.slots).toHaveLength(2);
    expect(new URL(p.slots[0].bookingUrl).searchParams.get('address_service_id')).toBe('301');
    expect(JSON.stringify(p)).not.toContain('public-fixture-secret');
    const requests = fetcher.mock.calls.map(([url]) => new URL(String(url)));
    expect(requests.find(u => u.pathname.endsWith('/services'))?.searchParams.getAll('with[]')).toContain('service.duration');
    expect(requests.filter(u => u.pathname.endsWith('/slots')).map(u => [u.searchParams.get('filters[address_service_id]'), u.searchParams.get('filters[is_new_patient]')])).toEqual([['301', '1'], ['301', '0']]);
    for (const u of requests.filter(u => u.pathname.endsWith('/slots'))) {
      expect(u.searchParams.get('start')).toBe('2026-10-29T00:00:00+01:00');
      expect(u.searchParams.get('end')).toBe('2026-12-10T00:00:00+01:00');
    }
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
    await read(query); expect(fetcher).toHaveBeenCalledTimes(6);
    await read(query, true); expect(fetcher).toHaveBeenCalledTimes(12);
  });
  it('uses only the intersection for unknown first/returning status, never invents duration', async () => {
    const data = fixture(); delete data.services._items[0].duration;
    const { read } = setup(data, u => u.pathname.endsWith('/slots') && u.searchParams.get('filters[is_new_patient]') === '0' ? Response.json({ _items: [data.slots._items[1]] }) : undefined);
    const p = await read(query); expect(p.durationMinutes).toBeNull(); expect(p.slots.map(s => s.startAt)).toEqual([Date.parse(data.slots._items[1].start)]);
  });
  it('rejects SSRF, foreign redirects, manipulated booking URLs and inconsistent slot dates', async () => {
    for (const profile of ['http://127.0.0.1/private', 'https://www.znanylekarz.pl.evil.test/profil/anna', 'https://user@www.znanylekarz.pl/profil/anna', 'https://www.znanylekarz.pl:444/profil/anna', 'https://www.znanylekarz.pl/profil/anna?token=secret']) expect(appointmentQuerySchema.safeParse({ ...query, profile }).success).toBe(false);
    const redirect = setup(fixture(), () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
    await expect(redirect.read(query)).rejects.toMatchObject({ status: 502 }); expect(redirect.fetcher).toHaveBeenCalledTimes(1);
    for (const url of ['https://evil.test/booking/wybierz-wizyte/101/201/2026-11-09T08:00:00+01:00', 'https://www.znanylekarz.pl/booking/wybierz-wizyte/999/201/2026-11-09T08:00:00+01:00', 'https://www.znanylekarz.pl/booking/wybierz-wizyte/101/201/2026-11-10T08:00:00+01:00']) {
      const data = fixture(); data.slots._items[0].booking_url = url;
      await expect(setup(data).read(query)).rejects.toMatchObject({ status: 502 });
    }
  });
  it('fails closed on ambiguous services, malformed pages, pagination loops, old ranges and provider errors', async () => {
    const data = fixture(); data.services._items.push({ ...data.services._items[0], id: '302' });
    await expect(setup(data).read(query)).rejects.toMatchObject({ status: 409 });
    const broken = fixture(); broken.slots = { _items: [{ start: 'bad' }] }; await expect(setup(broken).read(query)).rejects.toMatchObject({ status: 502 });
    const loop = fixture(); loop.slots._links = { next: { href: 'https://evil.test/' } }; await expect(setup(loop).read(query)).rejects.toMatchObject({ status: 502 });
    await expect(setup().read({ ...query, from: '2020-01-01' })).rejects.toMatchObject({ status: 400 });
    const read = createZnanyLekarzReader({ fetcher: vi.fn().mockRejectedValue(new Error('public-fixture-secret')) });
    await expect(read(query)).rejects.not.toThrow('public-fixture-secret');
  });
});
