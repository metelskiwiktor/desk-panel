import type { BankTransaction } from './bank-contract';

/**
 * Turns what PKO writes for an operation into what a person recognises: a clean name, a category and how it was paid.
 * The bank gives text only (no logo, address or category), so this works from the text; a payment by phone or BLIK has no
 * merchant in it at all and is shown as exactly that.
 */
export type BankCategory = 'income' | 'phone' | 'atm' | 'grocery' | 'fuel' | 'eat' | 'sub' | 'health' | 'transfer' | 'other';
export const categoryNames: Record<BankCategory, string> = {
  income: 'Wpływy', phone: 'Bez nazwy sklepu', atm: 'Terminal', grocery: 'Zakupy', fuel: 'Paliwo', eat: 'Jedzenie', sub: 'Subskrypcje', health: 'Zdrowie', transfer: 'Przelewy', other: 'Inne',
};
export interface Described { name: string; sub: string; category: BankCategory }

/** Upper case without Polish letters or accents: how PKO writes merchants, and what the patterns below are matched against. */
const plain = (text: string) => text.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const BRANDS: [RegExp, string, BankCategory][] = [
  [/BIEDRONKA/, 'Biedronka', 'grocery'], [/SPOLEM/, 'Społem', 'grocery'], [/ZABKA/, 'Żabka', 'grocery'], [/DINO\b/, 'Dino', 'grocery'], [/ALDI\b/, 'Aldi', 'grocery'], [/ROSSMANN/, 'Rossmann', 'grocery'],
  [/\bLIDL\b/, 'Lidl', 'grocery'], [/KAUFLAND/, 'Kaufland', 'grocery'], [/AUCHAN/, 'Auchan', 'grocery'], [/CARREFOUR/, 'Carrefour', 'grocery'], [/EUROSPAR|\bSPAR\b/, 'Spar', 'grocery'],
  [/POLOMARKET/, 'Polomarket', 'grocery'], [/STOKROTKA/, 'Stokrotka', 'grocery'], [/\bHEBE\b/, 'Hebe', 'grocery'],
  [/ORLEN/, 'Orlen', 'fuel'], [/\bBP\b/, 'BP', 'fuel'], [/\bSHELL\b/, 'Shell', 'fuel'], [/CIRCLE K/, 'Circle K', 'fuel'], [/\bMOYA\b/, 'Moya', 'fuel'], [/STACJA PALIW/, 'Stacja paliw', 'fuel'],
  [/MCDONALD/, 'McDonald’s', 'eat'], [/AMREST/, 'AmRest', 'eat'], [/BURGER KING/, 'Burger King', 'eat'], [/STARBUCKS/, 'Starbucks', 'eat'], [/\bKFC\b/, 'KFC', 'eat'],
  [/NETFLIX/, 'Netflix', 'sub'], [/SPOTIFY/, 'Spotify', 'sub'], [/ANTHROPIC/, 'Anthropic', 'sub'], [/OPENAI/, 'OpenAI', 'sub'], [/GOOGLE PLAY/, 'Google Play', 'sub'], [/YOUTUBE/, 'YouTube', 'sub'],
  [/APPLE\.COM|ITUNES/, 'Apple', 'sub'], [/DISNEY/, 'Disney+', 'sub'],
  [/TOPFARM/, 'Topfarm', 'health'], [/APTEK/, 'Apteka', 'health'],
];
/** Words that say what a merchant is when the name itself is unknown. */
const KEYWORDS: [RegExp, BankCategory][] = [
  [/CUKIERNIA|PIEKARNIA|RESTAURA|KAWIARNIA|PIZZ|DONER|KEBAB|\bBAR\b|BISTRO/, 'eat'],
  [/MEDYCZN|KLINIK|STOMAT|PRZYCHODNIA|LEKARZ/, 'health'],
  [/STACJA NR|STACJA PALIW/, 'fuel'],
  [/SKLEP|MARKET|SPOZYW/, 'grocery'],
];
/** Towns that PKO glues to the front of a merchant ("LESZNOSERCE SP ZOO"); other towns are found by their capital letters. */
const CITIES = [
  'WARSZAWA', 'KRAKOW', 'LODZ', 'WROCLAW', 'POZNAN', 'GDANSK', 'SZCZECIN', 'BYDGOSZCZ', 'LUBLIN', 'BIALYSTOK', 'KATOWICE', 'GDYNIA', 'CZESTOCHOWA', 'RADOM', 'TORUN', 'KIELCE', 'RZESZOW',
  'OLSZTYN', 'OPOLE', 'GORZOW WIELKOPOLSKI', 'GORZOW', 'ZIELONA GORA', 'LESZNO', 'SWIEBODZIN', 'SKORZEWO', 'TULCE', 'SWIECIE', 'SOPOT', 'KONIN', 'KALISZ', 'PILA', 'GNIEZNO', 'OSTROW',
  'DUBLIN', 'LOS GATOS', 'LONDON', 'AMSTERDAM', 'BERLIN', 'PRAGA', 'PRAHA',
].sort((a, b) => b.length - a.length);

function stripCity(raw: string): string {
  const flat = plain(raw);
  const city = CITIES.find(c => flat.startsWith(c) && flat.length > c.length);
  if (city) return raw.slice(city.length).trim();
  const camel = /^[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]{3,}(?: [A-Z][a-ząćęłńóśźż]{2,})?(?=[A-Z0-9])/.exec(raw);
  return camel && raw.length > camel[0].length ? raw.slice(camel[0].length).trim() : raw;
}
/** Capitalises words written in capitals; short ones (PSS, TK) stay as written. */
const SMALL_WORDS = new Set(['NA', 'DO', 'OD', 'ZA', 'DLA']);
const titleCase = (text: string) => text
  .replace(/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{4,}/g, w => w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)
  .replace(/\b[A-Z]{2,3}\b/g, w => SMALL_WORDS.has(w) ? w.toLowerCase() : w);

/** A merchant text without its town, country, store number and company form. */
export function cleanName(raw: string): string {
  let s = stripCity(raw.replace(/\s+/g, ' ').trim());
  s = s.replace(/\bNR\.?\s*\d+\b/gi, '').replace(/\b\d{2,}\b/g, '').replace(/\b[A-Z]{1,2}\.?\d{1,4}\b/g, '').replace(/(?<=[A-Za-z])\d{3,}\b/g, '');
  s = stripCity(s.replace(/\s+/g, ' ').trim()); // "LESZNO3306 LESZNOFRANCISZKA": the town twice, with a number between
  s = s.replace(/(?<=\S)(PL|IE|NL|DE)$/, '');
  s = s.replace(/\s*\bSP\.?\s*Z\.?\s*O\.?\s*O\.?\s*$/i, '').replace(/\s*\bS\.?\s?A\.?\s*$/i, '');
  s = s.replace(/[\s.,*-]+$/, '').replace(/\s+/g, ' ').trim();
  return titleCase(s || raw.trim());
}

/** The part of a transfer title a person wrote, or null for what the bank writes itself ("PRZELEW IKO NA NUMER …", "… TRANSFER-IN", "OD: 48…"). */
export function humanNote(note: string | undefined): string | null {
  if (!note) return null;
  const text = note.replace(/\s*OD:.*$/i, '').replace(/\s+/g, ' ').trim();
  if (!text || /\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/.test(text) || /^PRZELEW\b/i.test(text) && text === text.toUpperCase()) return null;
  const sentence = text === text.toUpperCase() ? text[0] + text.slice(1).toLowerCase() : text;
  return sentence.length > 48 ? `${sentence.slice(0, 47)}…` : sentence;
}

const METHOD: Record<string, string> = { 'Płatność kartą': 'karta' };

export function describe(t: BankTransaction): Described {
  const flat = plain(t.title);
  const method = METHOD[t.note ?? ''];
  if (t.title === 'Płatność telefonem' || t.title === 'Płatność BLIK') {
    return t.amount > 0 ? { name: 'Zwrot', sub: `Zwrot · ${t.title === 'Płatność BLIK' ? 'BLIK' : 'telefon'}`, category: 'income' }
      : { name: t.title, sub: 'Sklep nieznany', category: 'phone' };
  }
  if (t.title === 'Przelew z karty') return { name: t.title, sub: 'Karta', category: 'transfer' };
  if (/^S1PO\d/.test(flat)) return { name: 'Terminal z kodem S1PO', sub: 'Wygląda na bankomat', category: 'atm' };
  const brand = BRANDS.find(([pattern]) => pattern.test(flat));
  const note = humanNote(t.note);
  const name = brand?.[1] ?? cleanName(t.title);
  if (t.amount > 0) return { name, sub: note ? `Wpływ · ${note}` : 'Wpływ · przelew', category: 'income' };
  const category = brand?.[2] ?? KEYWORDS.find(([pattern]) => pattern.test(flat))?.[1] ?? (t.note && !method ? 'transfer' : 'other');
  const sub = category === 'transfer' ? (note ? `Przelew · ${note}` : 'Przelew')
    : [category === 'other' ? '' : categoryNames[category], method].filter(Boolean).join(' · ') || (method ? 'Karta' : '');
  return { name, sub: sub.charAt(0).toUpperCase() + sub.slice(1), category };
}
