import { createHash, randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { appointmentPreviewSchema, appointmentQuerySchema, type AppointmentPreview, type AppointmentQuery } from '../src/appointment-contract';

export class AppointmentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const ORIGIN = 'https://www.znanylekarz.pl';
const id = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String);
const doctorSchema = z.object({ full_name: z.string().min(1), url: z.string().optional() });
const addressSchema = z.object({ id, name: z.string().nullable().optional(), street: z.string().nullable().optional(), city_name: z.string().nullable().optional(), is_online_only: z.boolean().default(false), timezone: z.string().nullable().optional() });
const serviceSchema = z.object({ id, name: z.string().min(1), price: z.number().nonnegative().nullable().optional(), is_price_from: z.boolean().default(false), duration: z.number().int().positive().max(1440).nullable().optional() });
const slotSchema = z.object({ start: z.iso.datetime({ offset: true }), booking_url: z.string().min(1) });
const pageOf = <T extends z.ZodType>(item: T) => z.object({ _items: z.array(item), _links: z.object({ next: z.object({ href: z.string() }).optional() }).optional() });
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase().trim();

/** Only anonymous public GETs. The short-lived public token stays in this function, never in the preview or errors. */
export function createZnanyLekarzReader({ fetcher = fetch, now = Date.now }: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, { at: number; value: AppointmentPreview }>();
  const pending = new Map<string, Promise<AppointmentPreview>>();
  async function get(url: string, token?: string): Promise<Response> {
    let current = new URL(url, ORIGIN);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (current.origin !== ORIGIN || current.username || current.password) throw new AppointmentError(502, 'ZnanyLekarz zwrócił nieprawidłowy adres.');
      const response = await fetcher(current, { method: 'GET', redirect: 'manual', headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : {}, signal: AbortSignal.timeout(12_000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); if (!location) break; current = new URL(location, current); continue; }
      if (!response.ok) throw new AppointmentError(response.status === 429 ? 429 : 502, response.status === 429 ? 'ZnanyLekarz ograniczył odczyty. Spróbuj ponownie później.' : 'Nie udało się pobrać danych z ZnanyLekarz. Spróbuj ponownie później.');
      return response;
    }
    throw new AppointmentError(502, 'Nie udało się otworzyć profilu ZnanyLekarz.');
  }
  async function pages<T extends z.ZodType>(url: string, item: T, token: string): Promise<z.infer<T>[]> {
    const rows: z.infer<T>[] = []; const seen = new Set<string>();
    let next: string | undefined = url;
    for (let n = 0; next && n < 10; n++) {
      if (seen.has(next)) throw new AppointmentError(502, 'Nieprawidłowa paginacja ZnanyLekarz.');
      seen.add(next);
      const response = await get(next, token);
      const bytes = await response.text();
      if (bytes.length > 2_000_000) throw new AppointmentError(502, 'Odpowiedź ZnanyLekarz jest zbyt duża.');
      const page = pageOf(item).parse(JSON.parse(bytes));
      rows.push(...page._items);
      const href = page._links?.next?.href;
      if (href) { const u = new URL(href, ORIGIN); if (u.origin !== ORIGIN || u.pathname !== new URL(url, ORIGIN).pathname) throw new AppointmentError(502, 'Nieprawidłowa paginacja ZnanyLekarz.'); }
      next = href;
    }
    if (next || rows.length > 1500) throw new AppointmentError(502, 'ZnanyLekarz zwrócił za dużo wyników. Zawęź zakres.');
    return rows;
  }
  return async function read(raw: AppointmentQuery, fresh = false): Promise<AppointmentPreview> {
    const query = appointmentQuerySchema.parse(raw);
    const key = JSON.stringify(query);
    const known = cache.get(key);
    if (!fresh && known && now() - known.at >= 0 && now() - known.at < 60_000) return { ...known.value, id: `a-${randomBytes(16).toString('hex')}` };
    if (!fresh && pending.has(key)) return { ...await pending.get(key)!, id: `a-${randomBytes(16).toString('hex')}` };
    const operation = (async () => {
      try {
        const profileUrl = new URL(query.profile); profileUrl.hostname = 'www.znanylekarz.pl';
        const response = await get(profileUrl.href);
        const html = await response.text();
        if (html.length > 4_000_000) throw new AppointmentError(502, 'Profil ZnanyLekarz jest zbyt duży.');
        const doctorId = /\bDOCTOR_ID\s*:\s*['"]?(\d+)/.exec(html)?.[1];
        const token = /['"]ACCESS_TOKEN['"]\s*:\s*['"]([^'"\s]+)['"]/.exec(html)?.[1];
        if (!doctorId || !token) throw new AppointmentError(502, 'ZnanyLekarz zmienił profil lub wymaga interakcji w przeglądarce. Nie udało się odczytać terminów.');
        const base = `/api/v3/doctors/${doctorId}`;
        const doctor = doctorSchema.parse(await (await get(base, token)).json());
        const addresses = await pages(`${base}/addresses?with[]=address.online_only&with[]=address.timezone&limit=100`, addressSchema, token);
        const matching = addresses.filter(a => (query.mode === 'dowolnie' || a.is_online_only === (query.mode === 'online')) && (!query.address || fold([a.name, a.street, a.city_name].filter(Boolean).join(', ')).includes(fold(query.address))));
        if (!matching.length) throw new AppointmentError(409, 'Nie ma takiego gabinetu lub trybu wizyty. Dostępne: ' + addresses.map(a => [a.name, a.street, a.city_name].filter(Boolean).join(', ')).join('; '));
        const options: { address: z.infer<typeof addressSchema>; service: z.infer<typeof serviceSchema> }[] = [];
        if (matching.length > 12) throw new AppointmentError(409, 'Ten lekarz ma wiele gabinetów. Podaj miasto lub nazwę gabinetu w polu address.');
        for (const address of matching) {
          const services = await pages(`${base}/addresses/${address.id}/services?filters[calendar]=true&with[]=service.duration&limit=100`, serviceSchema, token);
          options.push(...services.map(service => ({ address, service })));
        }
        const exact = options.filter(o => fold(o.service.name) === fold(query.service));
        const candidates = exact.length ? exact : options.filter(o => fold(o.service.name).includes(fold(query.service)));
        if (candidates.length !== 1) throw new AppointmentError(409, `${candidates.length ? 'Pasuje kilka usług lub gabinetów' : 'Nie ma takiej usługi'}. Doprecyzuj service i address: ${options.slice(0, 20).map(o => `${o.service.name} — ${[o.address.name, o.address.street, o.address.city_name].filter(Boolean).join(', ')}`).join('; ')}`);
        const { address, service } = candidates[0];
        const zone = address.timezone || 'Europe/Warsaw';
        const today = DateTime.fromMillis(now(), { zone }).startOf('day');
        const from = query.from ? DateTime.fromISO(query.from, { zone }) : today;
        const to = query.to ? DateTime.fromISO(query.to, { zone }) : from.plus({ days: 41 });
        if (!today.isValid || !from.isValid || !to.isValid || from < today || to < from || to.diff(from, 'days').days > 89 || to > today.plus({ days: 180 })) throw new AppointmentError(400, 'Terminy: od dziś, zakres do 90 dni, najwyżej 180 dni naprzód.');
        const readSlots = (first: boolean) => {
          // The public endpoint rejects fractional seconds with 404 ("Invalid date given for parameter start").
          const params = new URLSearchParams({ start: from.toISO({ suppressMilliseconds: true })!, end: to.plus({ days: 1 }).toISO({ suppressMilliseconds: true })!, 'filters[address_service_id]': service.id, 'filters[is_new_patient]': first ? '1' : '0', 'filters[has_insurance]': '0', limit: '200' });
          return pages(`${base}/addresses/${address.id}/slots?${params}`, slotSchema, token);
        };
        let slots = await readSlots(query.firstVisit ?? true);
        if (query.firstVisit === undefined) { const returning = new Set((await readSlots(false)).map(s => s.start)); slots = slots.filter(s => returning.has(s.start)); }
        const unique = new Map<number, AppointmentPreview['slots'][number]>();
        for (const slot of slots) {
          const startAt = Date.parse(slot.start);
          if (startAt < now() || startAt < from.toMillis() || startAt >= to.plus({ days: 1 }).toMillis()) continue;
          const url = new URL(slot.booking_url, ORIGIN);
          // The date and both provider ids must agree with the slot. Add the actual chosen service to the provider URL.
          const expected = `/booking/wybierz-wizyte/${doctorId}/${address.id}/`;
          if (url.origin !== ORIGIN || url.username || url.password || !url.pathname.startsWith(expected) || Date.parse(decodeURIComponent(url.pathname.slice(expected.length))) !== startAt) throw new AppointmentError(502, 'ZnanyLekarz zwrócił niespójny link do terminu.');
          for (const param of url.searchParams.keys()) if (param !== 'address_service_id') url.searchParams.delete(param);
          url.searchParams.set('address_service_id', service.id);
          unique.set(startAt, { id: createHash('sha256').update(`${doctorId}:${address.id}:${service.id}:${startAt}`).digest('hex').slice(0, 24), startAt, bookingUrl: url.href });
        }
        const value = appointmentPreviewSchema.parse({ id: `a-${randomBytes(16).toString('hex')}`, query, observedAt: now(), doctorId, doctor: doctor.full_name, profileUrl: profileUrl.href,
          addressId: address.id, location: address.is_online_only ? 'Online' : [address.name, address.street, address.city_name].filter(Boolean).join(', '), online: address.is_online_only,
          serviceId: service.id, service: service.name, price: service.price ?? null, priceFrom: service.is_price_from, durationMinutes: service.duration ?? null, timeZone: zone,
          from: from.toISODate(), to: to.toISODate(), slots: [...unique.values()].sort((a, b) => a.startAt - b.startAt) });
        if (cache.size >= 50) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: now(), value });
        return value;
      } catch (error) { if (error instanceof AppointmentError) throw error; throw new AppointmentError(502, 'Nie udało się odczytać poprawnych danych ZnanyLekarz. Spróbuj ponownie później.'); }
    })();
    if (!fresh) pending.set(key, operation);
    try { return await operation; } finally { if (!fresh) pending.delete(key); }
  };
}
