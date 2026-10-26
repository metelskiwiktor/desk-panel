import {
  Baby, Banknote, BookOpen, Brain, Bus, Car, Coffee, Dumbbell, Film, Fuel, Gamepad2, Gift, GraduationCap, HandCoins, HeartPulse, House, Music,
  PawPrint, PiggyBank, Plane, Receipt, Repeat, Shirt, ShoppingCart, Smartphone, Tag, User, UtensilsCrossed, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import type { BankTransaction } from './bank-contract';
import type { BankColor, BankIcon, BankLabelsData, BankOption, BankPerson } from './bank-labels-contract';
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
  return `${t.amount > 0 ? 'wpływ' : 'przelew'}${note ? ` · ${note}` : ''}`;
}

/**
 * What tells a person apart from another of the same name: the bank's name for them, and the ends of their account and phone
 * number ("„DANIEL KOWALSKI” · rach. ··2874 · tel. ··321"); empty while nothing has been learnt.
 */
export function personHint(p: Pick<BankPerson, 'identifiers'>): string {
  const of = (kind: string) => p.identifiers.filter(i => i.kind === kind);
  const phones = of('phone').length ? of('phone') : of('phoneTail');
  return [...of('name').map(i => `„${i.hint}”`), ...of('account').map(i => `rach. ${i.hint}`), ...phones.map(i => `tel. ${i.hint}`)].join(' · ');
}

/** One proposed mark in words: "Inea · Rachunki · #internet · cykliczne". */
export function optionText(o: BankOption, data: BankLabelsData): string {
  const merchant = o.merchant && data.merchants.find(m => m.id === o.merchant)?.name;
  const person = o.person && data.people.find(p => p.id === o.person)?.name;
  const category = o.category && data.categories.find(c => c.id === o.category)?.name;
  return [merchant, person, category, ...(o.tags ?? []).map(t => `#${t}`), o.recurring ? 'cykliczne' : null].filter(Boolean).join(' · ');
}
