// @vitest-environment node
import { expect, it } from 'vitest';
import { createMachinaReader, cutBetween, isPublicAddress, MACHINA_FETCH, MachinaFetchError, pageText, type MachinaHop } from './machina-fetch';

it('takes only addresses of the public internet', () => {
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946']) expect([address, isPublicAddress(address)]).toEqual([address, true]);
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', 'not-an-address', '',
  ]) expect([address, isPublicAddress(address)]).toEqual([address, false]);
});

const reader = (pages: Record<string, MachinaHop>, hosts: Record<string, string[]> = {}) => {
  const seen: [string, string][] = [];
  const read = createMachinaReader({ resolve: async host => { if (host in hosts) return hosts[host]!; if (host.endsWith('.missing')) throw new Error('ENOTFOUND'); return ['93.184.216.34']; }, get: async (url, address) => { seen.push([url.href, address]); return pages[url.href] ?? { status: 404, body: '' }; } });
  return { read, seen };
};
const fails = async (promise: Promise<unknown>, text: RegExp) => { const error = await promise.then(() => null, e => e); expect(error).toBeInstanceOf(MachinaFetchError); expect(error.message).toMatch(text); };

it('checks every hop of a read: scheme, port, credentials, scope and where the name points, and connects to the address it checked', async () => {
  const ok = { status: 200, type: 'text/html', body: 'ok' };
  const { read, seen } = reader({
    'https://example.com/a': { status: 302, location: '/b', body: '' }, 'https://example.com/b': { status: 301, location: 'https://www.example.com/c?x=1', body: '' }, 'https://www.example.com/c?x=1': ok,
    'https://example.com/out': { status: 302, location: 'https://example.com.evil.test/', body: '' }, 'https://example.com.evil.test/': ok,
    'https://example.com/port': { status: 302, location: 'https://example.com:8443/', body: '' }, 'https://example.com/user': { status: 302, location: 'https://u:p@example.com/', body: '' },
    'https://example.com/ip': { status: 302, location: 'https://93.184.216.34/', body: '' }, 'https://example.com/pdf': { status: 200, type: 'application/pdf', body: '%PDF' },
    'https://example.com/loop': { status: 302, location: '/loop', body: '' }, 'https://rebind.example.com/': ok, 'https://example.com/gone': { status: 500, body: '' },
  }, { 'rebind.example.com': ['93.184.216.34', '192.168.0.10'], 'empty.example.com': [] });
  expect(await read('https://example.com/a', ['example.com'])).toEqual({ url: 'https://www.example.com/c?x=1', text: 'ok' });
  expect(seen).toEqual([['https://example.com/a', '93.184.216.34'], ['https://example.com/b', '93.184.216.34'], ['https://www.example.com/c?x=1', '93.184.216.34']]);
  seen.length = 0;
  await fails(read('https://example.com/out', ['example.com']), /poza zatwierdzonym zakresem/);
  await fails(read('https://notexample.com/', ['example.com']), /poza zatwierdzonym zakresem/);
  await fails(read('https://example.com/port', ['example.com']), /bez portu/);
  await fails(read('https://example.com/user', ['example.com']), /danych logowania/);
  await fails(read('http://example.com/', ['example.com']), /https/);
  await fails(read('https://example.com/ip', ['example.com']), /po nazwie/);
  await fails(read('https://[::1]/', ['example.com']), /po nazwie/);
  await fails(read('https://rebind.example.com/', ['example.com']), /nie jest publiczny/);
  await fails(read('https://empty.example.com/', ['example.com']), /nie jest publiczny/);
  await fails(read('https://x.example.missing/', ['example.missing']), /Nie znaleziono/);
  await fails(read('https://example.com/pdf', ['example.com']), /nie jest tekstem/);
  await fails(read('https://example.com/gone', ['example.com']), /kodem 500/);
  await fails(read('https://example.com/', []), /poza zatwierdzonym zakresem/);
  await fails(read('nie adres', ['example.com']), /Niepoprawny adres/);
  // Nothing outside the scope and nothing private was ever requested.
  expect(seen.map(([url]) => url)).toEqual(['https://example.com/out', 'https://example.com/port', 'https://example.com/user', 'https://example.com/ip', 'https://example.com/pdf', 'https://example.com/gone']);
  seen.length = 0;
  await fails(read('https://example.com/loop', ['example.com']), /Za dużo przekierowań/);
  expect(seen).toHaveLength(MACHINA_FETCH.redirects + 1);
});

it('turns a page into tidy text with its links and cuts the fragment between two markers', () => {
  const html = `<html><head><title>T</title><style>p{}</style><script>var a = "<p>nie</p>";</script></head><body><!-- ukryte -->
    <h1>Zapisy&nbsp;2027</h1><p>Status:   <b>otwarte</b> &amp; trwają do&#32;31&#x2e;12</p>
    <a href="/formularz?a=1&amp;b=2">Formularz <i>online</i></a> <a href='https://inna.test/(x)'>Obcy</a> <a href="javascript:alert(1)">Zły</a> <a href=mailto:a@b.c>Mail</a>
    <footer>Regulamin</footer></body></html>`;
  const text = pageText(html, 'https://example.com/zapisy/');
  expect(text).toBe('T Zapisy 2027 Status: otwarte & trwają do 31.12 [Formularz online](https://example.com/formularz?a=1&b=2) [Obcy](https://inna.test/%28x%29) Zły Mail Regulamin');
  expect(cutBetween(text, 'Status:', 'Regulamin')).toEqual({
    text: 'otwarte & trwają do 31.12 [Formularz online](https://example.com/formularz?a=1&b=2) [Obcy](https://inna.test/%28x%29) Zły Mail',
    links: ['https://example.com/formularz?a=1&b=2', 'https://inna.test/%28x%29'],
  });
  // Spacing in a marker does not matter; a missing marker or an empty fragment is "no fragment".
  expect(cutBetween(text, 'Status:\n   otwarte', '[Formularz')?.text).toBe('& trwają do 31.12');
  expect(cutBetween(text, undefined, 'Zapisy')).toEqual({ text: 'T', links: [] });
  expect(cutBetween(text, 'Regulamin')).toBeNull();
  expect(cutBetween(text, 'Nie ma takiego')).toBeNull();
  expect(cutBetween(text, 'Status:', 'Nie ma takiego')).toBeNull();
  expect(cutBetween(text, 'Regulamin', 'Status:')).toBeNull();
});
