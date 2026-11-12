/** Mockup data for the Machina concept (C:\Tabularium\Incepta\DeskPanel\Mea\Machina). Machina has no API yet, so, like
 * Fila, the data live here; the IRONMAN states and fragments come from the real automat a-f6354232578d (12.11.2026). */

export type Chwila = 'przeniesienie' | 'pozniej';
export type AutomatStatus = 'aktywny' | 'wstrzymany' | 'czeka na kartę przepisu' | 'czeka na naprawę' | 'czeka na decyzję' | 'zakończony';
export type Rodzaj = 'cykliczny' | 'jednorazowy' | 'zdarzenie' | 'wbudowany';
export type Grupa = 'odczyt' | 'przetwarzanie' | 'akcja' | 'sterowanie';

export interface Klocek { rodzaj: string; grupa: Grupa; opis: string; zakres?: string }
export interface Wersja { n: number; at: string; powod: 'projektowanie' | 'naprawa' | 'przywrócenie'; opis: string; klocki: Klocek[] }
export interface Probka { run: string; at: string; wycinek: string }
export interface Stan { nazwa: string; rodzaj: 'znany' | 'przewidywany' | 'wycofany'; reakcja: string; probki: Probka[]; uwaga?: string }
export interface KlocekWynik { rodzaj: string; wynik: string; zly?: boolean }
export interface Run {
  id: string; at: string; wersja: number; wejscie: string;
  wynik: 'bez zmian' | 'czeka na decyzję' | 'reakcja' | 'błąd oceny' | 'naprawa';
  opis: string; koszt?: number; rozmowa?: string; klocki: KlocekWynik[];
}
export interface Rozmowa { id: string; powod: 'projektowanie' | 'ocena' | 'naprawa' | 'zmiana'; tytul: string; at: string; run?: string }
export interface Automat {
  id: string; nazwa: string; rodzaj: Rodzaj; status: AutomatStatus; wyzwalacze: string[]; opis: string;
  wersje: Wersja[]; stany: Stan[]; runy: Run[]; rozmowy: Rozmowa[];
  historia?: { runy: number; bledy: number; od: string; notatnik: string };
  nastepny?: string; usuwalny: boolean;
}

const IRON_URL_PL = 'ironmanpoznan.com.pl/registration';
const IRON_URL_COM = 'ironman.com/races/im703-poznan';
const IRON_URL_REG = 'ironman.com/races/im703-poznan/register';

const ironKlockiV1: Klocek[] = [
  { rodzaj: 'Odczyt URL', grupa: 'odczyt', opis: IRON_URL_PL, zakres: 'ironmanpoznan.com.pl' },
  { rodzaj: 'Wycinek', grupa: 'przetwarzanie', opis: 'wiersz „Enea IRONMAN 70.3 Poznań”: przyciski i etykiety' },
  { rodzaj: 'Odczyt URL', grupa: 'odczyt', opis: IRON_URL_COM, zakres: 'ironman.com' },
  { rodzaj: 'Wycinek', grupa: 'przetwarzanie', opis: 'karta data-race-id="107211": tag rejestracji' },
  { rodzaj: 'Odczyt URL', grupa: 'odczyt', opis: IRON_URL_REG, zakres: 'ironman.com' },
  { rodzaj: 'Wycinek', grupa: 'przetwarzanie', opis: 'klasa registration-state-- i linki slotmarket.pl' },
  { rodzaj: 'Porównanie ze stanami', grupa: 'przetwarzanie', opis: 'trzy wycinki z katalogiem stanów' },
  { rodzaj: 'Ocena', grupa: 'przetwarzanie', opis: 'Wektor, gdy wycinki nie pasują do żadnego stanu' },
  { rodzaj: 'Wiadomość', grupa: 'akcja', opis: 'do rozmowy automatu, bez tury Wektora' },
  { rodzaj: 'Wydarzenie w kalendarzu', grupa: 'akcja', opis: '07:00–07:30, przypomnienie 60 min', zakres: 'kalendarz panelu' },
  { rodzaj: 'Alert', grupa: 'akcja', opis: 'przycisk z linkiem do formularza', zakres: 'slotmarket.pl' },
  { rodzaj: 'Powiadomienie', grupa: 'akcja', opis: 'dzwonek i telefon (ntfy panelu)' },
];
const ironKlockiV2: Klocek[] = ironKlockiV1.map(k => k.opis.startsWith('karta data-race-id')
  ? { ...k, opis: 'karta 70.3 po nazwie „IRONMAN 70.3 Poznan” (race-id zmienia się między edycjami)' } : k);

const zamkniete: Stan = {
  nazwa: 'Zamknięte (2026 wyprzedane)', rodzaj: 'znany', reakcja: 'bez zmian',
  probki: [
    { run: 'run-0101', at: '20 lis 10:00', wycinek: 'PL: „Read more · SOLD OUT” · .com: „Registration Opening Soon” · /register: opening_soon, slotmarket 735' },
    { run: 'run-0126', at: '2 gru 10:00', wycinek: 'PL: „Read more · SOLD OUT” · .com: „Registration Opening Soon” · /register: opening_soon, slotmarket 735' },
  ],
};

const IRONMAN_PRZENIESIONY: Automat = {
  id: 'a-f6354232578d', nazwa: 'Zapisy: IRONMAN 70.3 Poznań 2027', rodzaj: 'cykliczny', status: 'czeka na kartę przepisu',
  wyzwalacze: ['codziennie 10:00 i 19:00, do 28 sty 2027'],
  opis: 'Czy ruszyły zapisy na Enea IRONMAN 70.3 Poznań 2027 (tylko 70.3).',
  wersje: [], stany: [], runy: [],
  rozmowy: [{ id: 'r-proj', powod: 'projektowanie', tytul: 'Projektowanie przepisu', at: '20 lis 09:12' }],
  historia: { runy: 26, bledy: 6, od: '31 paź', notatnik: '2026-11-12 10:00 (odczyt) — bez zmian: wiersz 70.3 = Read more + SOLD OUT; ironman.com: „Registration Opening Soon” przy race-id 107211; /register = opening_soon, jedyny slotmarket 735 (2026). Pułapka: „Registration Now Open” należy do karty 94586 (5150 Erkner).' },
  usuwalny: true,
};

const IRONMAN_POZNIEJ: Automat = {
  ...IRONMAN_PRZENIESIONY, status: 'czeka na decyzję', nastepny: 'dziś 19:00',
  wersje: [
    { n: 1, at: '20 lis 09:30', powod: 'projektowanie', opis: 'pierwszy przepis z rozmowy projektowania', klocki: ironKlockiV1 },
    { n: 2, at: '28 lis 10:14', powod: 'naprawa', opis: 'karta 70.3 szukana po nazwie, nie po race-id', klocki: ironKlockiV2 },
  ],
  stany: [
    zamkniete,
    { nazwa: 'Ogłoszona data otwarcia', rodzaj: 'przewidywany', reakcja: 'wydarzenie w kalendarzu na ten dzień i powiadomienie; automat działa dalej', probki: [] },
    { nazwa: 'Zapisy otwarte (link slotmarket.pl do edycji 2027)', rodzaj: 'przewidywany', reakcja: 'wiadomość, wydarzenie, alert z linkiem, powiadomienie; potem koniec automatu', probki: [] },
    { nazwa: 'Lista oczekujących albo przedsprzedaż', rodzaj: 'przewidywany', reakcja: 'powiadomienie', probki: [] },
    { nazwa: '„Registration Now Open” na stronie 70.3', rodzaj: 'wycofany', reakcja: '—', uwaga: 'pomyłka oceny 24 lis: tag należał do karty 5150 Erkner; próbka przeniesiona do „Zamknięte”',
      probki: [{ run: 'run-0110', at: '24 lis 19:00', wycinek: '.com: „Registration Now Open” (karta 94586)' }] },
  ],
  runy: [
    { id: 'run-0127', at: '2 gru 19:00', wersja: 2, wejscie: 'pora 19:00', wynik: 'czeka na decyzję', koszt: 0.04, rozmowa: 'r-ocena',
      opis: 'Wycinek .com inny niż znane: „Race date: June 14, 2027 · Registration: TBA”. Wektor proponuje nowy stan.',
      klocki: [{ rodzaj: 'Odczyt URL ×3', wynik: '200 · 274 kB · 1,1 MB · 640 kB' }, { rodzaj: 'Wycinki', wynik: '3 z 3 znalezione' },
        { rodzaj: 'Porównanie', wynik: 'karta 70.3 nie pasuje do żadnego stanu', zly: true }, { rodzaj: 'Ocena', wynik: 'nowy stan: „Ogłoszona data zawodów 2027” → karta' }] },
    { id: 'run-0126', at: '2 gru 10:00', wersja: 2, wejscie: 'pora 10:00', wynik: 'bez zmian', opis: 'Zamknięte (2026 wyprzedane).',
      klocki: [{ rodzaj: 'Odczyt URL ×3', wynik: '200 · 200 · 200' }, { rodzaj: 'Wycinki', wynik: '3 z 3' }, { rodzaj: 'Porównanie', wynik: 'Zamknięte (2026 wyprzedane)' }] },
    { id: 'run-0119', at: '28 lis 10:00', wersja: 1, wejscie: 'pora 10:00', wynik: 'naprawa', koszt: 0.11, rozmowa: 'r-naprawa',
      opis: 'Nie znaleziono karty race-id 107211. Automat czekał na naprawę do zatwierdzenia wersji 2 (10:14).',
      klocki: [{ rodzaj: 'Odczyt URL ×3', wynik: '200 · 200 · 200' }, { rodzaj: 'Wycinki', wynik: '2 z 3: brak karty 107211', zly: true }, { rodzaj: 'Naprawa', wynik: 'wersja 2 na karcie' }] },
    { id: 'run-0110', at: '24 lis 19:00', wersja: 1, wejscie: 'pora 19:00', wynik: 'reakcja', koszt: 0.03, rozmowa: 'r-ocena-0110',
      opis: 'Ocena zaproponowała nowy stan „Registration Now Open”, zatwierdzony kartą (powiadomienie). 25 lis poprawka kartą: tag należał do 5150 Erkner, stan wycofany, próbka w „Zamknięte”.',
      klocki: [{ rodzaj: 'Odczyt URL ×3', wynik: '200 · 200 · 200' }, { rodzaj: 'Porównanie', wynik: 'inny wygląd' }, { rodzaj: 'Ocena', wynik: 'nowy stan → karta zatwierdzona; później wycofany' }] },
    { id: 'run-0101', at: '20 lis 10:00', wersja: 1, wejscie: 'pora 10:00', wynik: 'bez zmian', opis: 'Pierwszy run wersji 1: Zamknięte (2026 wyprzedane).',
      klocki: [{ rodzaj: 'Odczyt URL ×3', wynik: '200 · 200 · 200' }, { rodzaj: 'Porównanie', wynik: 'Zamknięte (2026 wyprzedane)' }] },
  ],
  rozmowy: [
    { id: 'r-ocena', powod: 'ocena', tytul: 'Ocena: nowy wygląd karty 70.3', at: '2 gru 19:01', run: 'run-0127' },
    { id: 'r-naprawa', powod: 'naprawa', tytul: 'Naprawa: brak karty 107211', at: '28 lis 10:01', run: 'run-0119' },
    { id: 'r-ocena-0110', powod: 'ocena', tytul: 'Ocena: „Registration Now Open”', at: '24 lis 19:01', run: 'run-0110' },
    { id: 'r-proj', powod: 'projektowanie', tytul: 'Projektowanie przepisu', at: '20 lis 09:12' },
  ],
};

const wbudowany = (id: string, nazwa: string, wyzwalacz: string, opis: string, klocki: Klocek[]): Automat => ({
  id, nazwa, rodzaj: 'wbudowany', status: 'aktywny', wyzwalacze: [wyzwalacz], opis, usuwalny: false,
  wersje: [{ n: 1, at: 'z kodem panelu', powod: 'projektowanie', opis: 'przepis panelu (zmienia go tylko kod)', klocki }], stany: [], runy: [], rozmowy: [],
});

const prosty = (id: string, nazwa: string, rodzaj: Rodzaj, status: AutomatStatus, wyzwalacze: string[], opis: string, klocki: Klocek[]): Automat => ({
  id, nazwa, rodzaj, status, wyzwalacze, opis, usuwalny: true, stany: [], runy: [], rozmowy: [],
  wersje: [{ n: 1, at: 'przeniesiony 20 lis', powod: 'projektowanie', opis: 'przeniesiony przez panel z obecnych ustawień', klocki }],
});

const FAKTURA_ALERT = prosty('a-faktura-alert', 'Faktury OpenRouter: alert', 'zdarzenie', 'aktywny', ['mail z reguły: od OpenRouter, temat „Your receipt”, link pay.stripe.com'],
  'Nowy paragon OpenRouter daje alert z przyciskiem „Zaksięguj fakturę”.',
  [{ rodzaj: 'Alert', grupa: 'akcja', opis: 'przycisk „Zaksięguj fakturę” → automat „Faktury OpenRouter: księgowanie”' }]);
const FAKTURA_KSIEG = prosty('a-faktura-ksieg', 'Faktury OpenRouter: księgowanie', 'zdarzenie', 'aktywny', ['przycisk alertu „Faktury OpenRouter: alert”'],
  'Pobiera PDF faktury, zapisuje na Drive, buduje .epp i dodaje wydarzenie.',
  [{ rodzaj: 'Pobierz plik', grupa: 'odczyt', opis: 'PDF z linku w mailu (wejście runu)', zakres: 'pay.stripe.com' },
    { rodzaj: 'Zapis pliku', grupa: 'akcja', opis: 'Koszty/OpenRouter/<miesiąc>/<nr faktury>.pdf', zakres: 'Drive: folder Koszty' },
    { rodzaj: 'Skrypt', grupa: 'przetwarzanie', opis: 'kurs NBP z dnia poprzedniego i plik .epp', zakres: 'Q-009' },
    { rodzaj: 'Wydarzenie w kalendarzu', grupa: 'akcja', opis: 'dzień faktury, link do folderu', zakres: 'kalendarz panelu' }]);

const wspolne = (iron: Automat): Automat[] => [
  iron,
  prosty('a-znanylekarz', 'ZnanyLekarz: potwierdź wizytę', 'zdarzenie', 'aktywny', ['mail z reguły: od ZnanyLekarz, „potwierdź”'],
    'Dawna reguła poczty Smart Actions.', [{ rodzaj: 'Alert', grupa: 'akcja', opis: 'przycisk z linkiem z maila', zakres: 'znanylekarz.pl' }]),
  prosty('a-konto', 'Konto: podpowiedzi oznaczeń', 'zdarzenie', 'aktywny', ['operacja konta z podpowiedzią'],
    'Dawna reguła konta Smart Actions.', [{ rodzaj: 'Alert', grupa: 'akcja', opis: 'do 3 przycisków: oznacz operację podpowiedzią (pojedyncza akcja)' }]),
  prosty('a-obs-czas', 'Przypomnij o odpowiedzi do Kasi', 'jednorazowy', 'aktywny', ['jutro 9:00'],
    'Utworzył Wektor bez karty: tylko wznowienie rozmowy, w której powstał.', [{ rodzaj: 'Wznów rozmowę', grupa: 'akcja', opis: 'rozmowa „Odpowiedź do Kasi”' }]),
  prosty('a-obs-pr', 'PR #57: wynik CI', 'jednorazowy', 'aktywny', ['PR metelskiwiktor/desk-panel#57: zmiana CI'],
    'Dawny obserwator PR.', [{ rodzaj: 'Wiadomość', grupa: 'akcja', opis: 'do rozmowy, z której go utworzono' }]),
  wbudowany('a-cezar-czeka', 'Zadania Cezara czekające na Ciebie', 'task Cezara czeka na użytkownika', 'Alert dla każdego taska, który czeka na decyzję.',
    [{ rodzaj: 'Alert', grupa: 'akcja', opis: 'przycisk otwiera task w kokpicie' }]),
  wbudowany('a-cezar-wznow', 'Wznawianie rozmów po zleceniach Cezara', 'task zlecony z rozmowy: zakończony albo czeka', 'Wejściem runu są task i rozmowa, z której go zlecono.',
    [{ rodzaj: 'Wznów rozmowę', grupa: 'akcja', opis: 'rozmowa zlecenia, z wynikiem taska' }]),
];

export const automaty = (chwila: Chwila): Automat[] => chwila === 'przeniesienie'
  ? wspolne(IRONMAN_PRZENIESIONY)
  : [...wspolne(IRONMAN_POZNIEJ), FAKTURA_ALERT, FAKTURA_KSIEG, { ...prosty('a-obs-czas-old', 'Obserwator czasu: 30 paź 21:02', 'jednorazowy', 'zakończony', ['30 paź 21:02'], 'Dawny obserwator, wykonany.', []) }];

/** The recipe card of the IRONMAN design conversation (D-002, D-009, D-035). */
export const KARTA_PRZEPISU = {
  automat: IRONMAN_PRZENIESIONY.nazwa, wersja: 1, klocki: ironKlockiV1,
  znany: { nazwa: 'Zamknięte (2026 wyprzedane)', probka: zamkniete.probki[0].wycinek.replace('20 lis', '') },
  przewidywane: IRONMAN_POZNIEJ.stany.filter(s => s.rodzaj === 'przewidywany'),
  zakresy: ['ironmanpoznan.com.pl (odczyt)', 'ironman.com (odczyt)', 'slotmarket.pl (link w alercie)', 'kalendarz panelu (zapis wydarzeń)', 'powiadomienia panelu'],
};

/** The assessment conversation of run-0127 (D-030, D-037). */
export const OCENA = {
  tytul: 'Ocena: nowy wygląd karty 70.3', run: 'run-0127',
  bylo: '„Registration Opening Soon” · TBD · August 30, 2026',
  jest: '„Race date: June 14, 2027” · „Registration: TBA”',
  wektor: 'Wycinek karty 70.3 (ironman.com) zmienił się: zamiast daty edycji 2026 jest data zawodów 2027 (14 czerwca), a rejestracja nadal „TBA”. Pozostałe dwa wycinki bez zmian (PL: SOLD OUT 2026, /register: opening_soon). To nie jest żaden stan z katalogu: ani „Ogłoszona data otwarcia” (nie ma daty zapisów), ani otwarte zapisy. Proponuję nowy stan z łagodną reakcją.',
  karta: { stan: 'Ogłoszona data zawodów 2027 (zapisy TBA)', probka: '.com: „Race date: June 14, 2027” · „Registration: TBA”', reakcja: ['powiadomienie: ogłoszono datę zawodów 2027, zapisy jeszcze nie ruszyły', 'automat działa dalej'] },
};

export const ALERT_FAKTURY = {
  autor: 'Automat: Faktury OpenRouter: alert', tytul: 'Paragon OpenRouter #2609-9426', tresc: '31 paź · 20,00 USD · link do faktury PDF',
  przycisk: 'Zaksięguj fakturę', cel: 'Faktury OpenRouter: księgowanie',
  wejscie: ['alert „Paragon OpenRouter #2609-9426”', 'mail OpenRouter, 31 paź 17:30', 'link pay.stripe.com/invoice/…/pdf'],
};
