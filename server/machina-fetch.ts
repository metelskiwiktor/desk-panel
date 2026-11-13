import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { hostInDomain } from '../src/machina-contract';

/**
 * The public read of a Machina `fetch` block: one GET without sign-in, only inside the domains the card approved. Every
 * hop (the first address and each redirect) is checked again: https, default port, no credentials, a host inside the
 * scope, and every address the name resolves to must be public. The connection then goes to exactly the address that
 * was checked, so a name cannot answer differently between the check and the connect. Anything else ends the read with
 * an error and no content. Own values (docs/automaty.md): 5 redirects, 15 s for a whole hop (not only for silence on
 * the line), 2 MB of body, text only.
 */
export const MACHINA_FETCH = { redirects: 5, timeoutMs: 15_000, bytes: 2 * 1024 * 1024 } as const;
export class MachinaFetchError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** True only for an address on the public internet: no loopback, private, link-local, CGNAT, multicast, documentation or mapped ranges. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  // An IPv4-mapped address in hex form (::ffff:7f00:1) is refused whole: nothing public needs it.
  if (/^::ffff:/i.test(address)) return false;
  return !blocked.check(address, 'ipv6');
}

export interface MachinaHop { status: number; location?: string; type?: string; body: string }
export interface MachinaReaderOptions {
  resolve?: (host: string) => Promise<string[]>;
  /** One GET to `address` for `url` (SNI and Host from the URL), without following anything. */
  get?: (url: URL, address: string) => Promise<MachinaHop>;
}

const resolveAll = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map(entry => entry.address);
const getOnce = (url: URL, address: string) => new Promise<MachinaHop>((resolve, reject) => {
  // The whole answer has this long: a server that drips a byte now and then is cut off like a silent one.
  const deadline = setTimeout(() => req.destroy(new MachinaFetchError('Strona nie odpowiedziała na czas.')), MACHINA_FETCH.timeoutMs);
  const settle = <T>(done: (value: T) => void) => (value: T) => { clearTimeout(deadline); done(value); };
  resolve = settle(resolve); reject = settle(reject);
  const req = request({
    host: address, servername: url.hostname, port: 443, method: 'GET', path: `${url.pathname}${url.search}`,
    headers: { Host: url.hostname, Accept: 'text/html,text/plain,application/xhtml+xml,application/json;q=0.9,*/*;q=0.1', 'User-Agent': 'desk-panel-machina/1', 'Accept-Encoding': 'identity' },
    timeout: MACHINA_FETCH.timeoutMs,
  }, res => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MACHINA_FETCH.bytes) { req.destroy(new MachinaFetchError('Strona jest za duża.')); return; }
      chunks.push(chunk);
    });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', reject);
  });
  req.on('timeout', () => req.destroy(new MachinaFetchError('Strona nie odpowiedziała na czas.')));
  req.on('error', reject);
  req.end();
});

/** Reads `address` inside `domains`; answers the final address and the body as text, or throws `MachinaFetchError`. */
export function createMachinaReader(options: MachinaReaderOptions = {}) {
  const resolve = options.resolve ?? resolveAll, get = options.get ?? getOnce;
  const check = async (url: URL, domains: string[]) => {
    if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new MachinaFetchError('Odczyt tylko po https, bez portu i danych logowania.');
    if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new MachinaFetchError('Odczyt tylko po nazwie z zatwierdzonej domeny.');
    if (!domains.some(domain => hostInDomain(url.hostname, domain))) throw new MachinaFetchError(`Adres ${url.hostname} jest poza zatwierdzonym zakresem.`);
    let addresses: string[];
    try { addresses = await resolve(url.hostname); } catch { throw new MachinaFetchError(`Nie znaleziono adresu ${url.hostname}.`); }
    if (!addresses.length || !addresses.every(isPublicAddress)) throw new MachinaFetchError(`Adres ${url.hostname} nie jest publiczny.`);
    return addresses[0]!;
  };
  return async (address: string, domains: string[]): Promise<{ url: string; text: string }> => {
    let url: URL;
    try { url = new URL(address); } catch { throw new MachinaFetchError('Niepoprawny adres.'); }
    for (let hop = 0; hop <= MACHINA_FETCH.redirects; hop++) {
      const target = await check(url, domains);
      let answer: MachinaHop;
      try { answer = await get(url, target); }
      catch (error) { throw error instanceof MachinaFetchError ? error : new MachinaFetchError('Nie udało się odczytać strony.'); }
      if (answer.status >= 300 && answer.status < 400 && answer.location) {
        try { url = new URL(answer.location, url); } catch { throw new MachinaFetchError('Niepoprawne przekierowanie.'); }
        continue;
      }
      if (answer.status !== 200) throw new MachinaFetchError(`Strona odpowiedziała kodem ${answer.status}.`);
      if (answer.type && !/^(text\/|application\/(json|xhtml\+xml|xml)\b)/i.test(answer.type)) throw new MachinaFetchError('Strona nie jest tekstem.');
      return { url: url.href, text: answer.body };
    }
    throw new MachinaFetchError('Za dużo przekierowań.');
  };
}
export type MachinaReader = ReturnType<typeof createMachinaReader>;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === '#') { const code = name[1]!.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1)); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '; }
  return ENTITIES[name.toLowerCase()] ?? whole;
});
/** Spacing made even, so the same content compares equal whatever the page's line breaks. */
export const tidy = (text: string) => text.replace(/\s+/gu, ' ').trim();

/**
 * A page as plain text with its links kept in place as `[label](address)`: scripts, styles and tags are dropped, a link's
 * address is made absolute against the page. Only http(s) links survive.
 */
export function pageText(body: string, base: string): string {
  const withLinks = body
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_whole, a?: string, b?: string, c?: string, label = '') => {
      let href = '';
      try { const u = new URL(decode(a ?? b ?? c ?? ''), base); if (u.protocol === 'https:' || u.protocol === 'http:') href = u.href; } catch { /* not a link */ }
      const text = tidy(decode(String(label).replace(/<[^>]*>/g, ' ')));
      return href ? ` [${text.replace(/[[\]]/g, '')}](${href.replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16)}`)}) ` : ` ${text} `;
    });
  return tidy(decode(withLinks.replace(/<[^>]*>/g, ' ')));
}

/** The part of `text` after the first `after` and before the next `before` (either may be absent); null when a marker is missing or nothing is left. */
export function cutBetween(text: string, after?: string, before?: string): { text: string; links: string[] } | null {
  let start = 0;
  if (after !== undefined) { const at = text.indexOf(tidy(after)); if (at < 0) return null; start = at + tidy(after).length; }
  let end = text.length;
  if (before !== undefined) { const at = text.indexOf(tidy(before), start); if (at < 0) return null; end = at; }
  const part = tidy(text.slice(start, end));
  if (!part) return null;
  return { text: part, links: [...new Set([...part.matchAll(/\]\((https?:[^)\s]+)\)/g)].map(m => m[1]!))] };
}
