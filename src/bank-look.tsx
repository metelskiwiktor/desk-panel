import {
  Baby, Banknote, BookOpen, Brain, Bus, Car, Coffee, Dumbbell, Film, Fuel, Gamepad2, Gift, GraduationCap, HandCoins, HeartPulse, House, Music,
  PawPrint, PiggyBank, Plane, Receipt, Repeat, Shirt, ShoppingBag, ShoppingCart, Smartphone, Tag, User, UtensilsCrossed, Wrench, Zap, ArrowLeftRight, type LucideIcon,
} from 'lucide-react';
import type { BankTransaction } from './bank-contract';
import type { BankColor, BankIcon, BankLabelsData, BankMove, BankOption, BankParty } from './bank-labels-contract';
import { describe, humanNote } from './bank-merchants';

/** How a category's colour and icon look; the names are what the server keeps. */
export const COLOR_VALUES: Record<BankColor, string> = {
  green: '#1baf7a', teal: '#22b3b3', blue: '#4d93e6', indigo: '#6f7ff0', violet: '#9b7be8', pink: '#e87ba4', red: '#e5585a',
  orange: '#eb6834', amber: '#eda100', brown: '#b0835c', slate: '#8a97ab',
};
export const COLOR_NAMES: Record<BankColor, string> = {
  green: 'zielony', teal: 'morski', blue: 'niebieski', indigo: 'indygo', violet: 'fioletowy', pink: 'różowy', red: 'czerwony', orange: 'pomarańczowy',
  amber: 'bursztynowy', brown: 'brązowy', slate: 'szary',
};
export const ICONS: Record<BankIcon, LucideIcon> = {
  tag: Tag, cart: ShoppingCart, utensils: UtensilsCrossed, coffee: Coffee, fuel: Fuel, car: Car, bus: Bus, home: House, zap: Zap, heart: HeartPulse,
  brain: Brain, dumbbell: Dumbbell, repeat: Repeat, handCoins: HandCoins, piggyBank: PiggyBank, gift: Gift, shirt: Shirt, plane: Plane, book: BookOpen,
  graduation: GraduationCap, gamepad: Gamepad2, film: Film, music: Music, paw: PawPrint, baby: Baby, wrench: Wrench, receipt: Receipt,
  smartphone: Smartphone, banknote: Banknote, user: User,
};

/** The way an operation was made, as PKO ends its title (`MOBILE-PAYMENT-C2C-EXTERNAL`), in words; null when the bank sent no code. */
const CODES: [RegExp, string][] = [
  [/^MOBILE-PAYMENT-C2C/, 'przelew na telefon'], [/^TRANSFER-/, 'przelew na rachunek'], [/^CARD-PAYMENT$/, 'karta'], [/^BLIK-/, 'BLIK'],
  [/^MOBILE-PAYMENT-ATM/, 'bankomat, telefon'], [/^MOBILE-PAYMENT-POS-RETURN/, 'zwrot, telefon'], [/^MOBILE-PAYMENT-POS/, 'telefon w sklepie'], [/^PAYCARD-TRANSFER$/, 'przelew z karty'],
];
export function methodName(t: BankTransaction): string | null {
  const info = t.raw?.remittance_information;
  const code = Array.isArray(info) && info.length ? String(info.at(-1)).trim() : '';
  return CODES.find(([pattern]) => pattern.test(code))?.[1] ?? null;
}

/**
 * How an operation was made and what its title says, without any category: "karta", "przelew · Zwrot za kolację",
 * "sklep nieznany" for a payment by phone (the bank sends no name for it) until the user names the merchant (`named`).
 */
export function howPaid(t: BankTransaction, named = false): string {
  const d = describe(t);
  if (t.title === 'Płatność telefonem' || t.title === 'Płatność BLIK') {
    const way = t.title === 'Płatność BLIK' ? 'BLIK' : 'telefon';
    return t.amount > 0 ? `zwrot · ${way}` : named ? way : 'sklep nieznany';
  }
  if (t.title === 'Przelew z karty') return 'z karty';
  if (d.category === 'atm') return 'wygląda na bankomat';
  if (t.note === 'Płatność kartą') return 'karta';
  if (t.note === 'Płatność telefonem') return 'telefon';
  const note = humanNote(t.note);
  return `${methodName(t) ?? (t.amount > 0 ? 'wpływ' : 'przelew')}${note ? ` · ${note}` : ''}`;
}

/** The moves in the words, hints, icons and colours the screen uses. */
export const MOVE_WORDS: Record<BankMove, string> = { spend: 'Wydatek', income: 'Przychód', settle: 'Rozliczenie', move: 'Przełożenie' };
export const MOVE_HINTS: Record<BankMove, string> = { spend: 'na co poszło', income: 'skąd przyszło', settle: 'pożyczka, oddanie', move: 'między moimi kontami' };
export const MOVE_ICONS: Record<BankMove, LucideIcon> = { spend: ShoppingBag, income: Banknote, settle: HandCoins, move: ArrowLeftRight };
export const MOVE_COLORS: Record<BankMove, string> = { spend: '#e8955a', income: '#1baf7a', settle: '#9b7be8', move: '#8a97ab' };

/**
 * The move an operation most likely is before anything was learnt: a payment in a shop (card, phone, BLIK) is a spend, also a
 * refund of one; a transfer could be anything, so it is left to the user.
 */
export function likelyMove(t: BankTransaction): BankMove | null {
  if (t.title === 'Płatność telefonem' || t.title === 'Płatność BLIK') return 'spend';
  return t.note === 'Płatność kartą' && describe(t).category !== 'atm' ? 'spend' : null;
}

/** What is open with a side, as the user reads it: "Anna odda Ci 250,00 zł", "Jonasz czeka na zwrot 400,00 zł", "Anna: rozliczone". */
export function balanceText(name: string, amount: number, currency: string): string {
  const sum = Math.abs(amount).toLocaleString('pl-PL', { style: 'currency', currency });
  return Math.abs(amount) < 0.005 ? `${name}: rozliczone` : amount > 0 ? `${name} odda Ci ${sum}` : `${name} czeka na zwrot ${sum}`;
}

/**
 * What tells a person apart from another of the same name: the bank's name for them, and the ends of their account and phone
 * number ("„DANIEL KOWALSKI” · rach. ··2874 · tel. ··321"); empty while nothing has been learnt.
 */
export function personHint(p: Pick<BankParty, 'identifiers'>): string {
  const of = (kind: string) => p.identifiers.filter(i => i.kind === kind);
  const phones = of('phone').length ? of('phone') : of('phoneTail');
  return [...of('name').map(i => `„${i.hint}”`), ...of('account').map(i => `rach. ${i.hint}`), ...phones.map(i => `tel. ${i.hint}`)].join(' · ');
}

/**
 * One proposed mark in words: "Inea · Rachunki · #internet · cykliczne", "Anna · Rozliczenie", "Moja firma · Przychód · Pensja". A
 * spend is said by its category alone.
 */
export function optionText(o: BankOption, data: BankLabelsData): string {
  const party = o.party && data.parties.find(p => p.id === o.party)?.name;
  const category = o.category && data.categories.find(c => c.id === o.category)?.name;
  const move = o.move && (o.move !== 'spend' || !category) ? MOVE_WORDS[o.move] : null;
  return [party, move, category, ...(o.tags ?? []).map(t => `#${t}`), o.recurring ? 'cykliczne' : null].filter(Boolean).join(' · ');
}
