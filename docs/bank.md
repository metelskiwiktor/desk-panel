# Konto bankowe (PKO BP przez Enable Banking)

Kafelek **Konto** pokazuje saldo konta prywatnego w PKO BP, przychody, wydatki i netto z ostatnich 30 dni, pasek z podziałem wydatków
na **kategorie użytkownika**, salda rozliczeń z ludźmi i operacje pogrupowane po dniach („Dziś”, „Wczoraj”, „Pt, 23 paź”, z sumą dnia).
Każda operacja ma kółko w kolorze i z ikoną swojej kategorii (albo ruchu), czystą nazwę, podpis („Jedzenie · karta”, znaczniki: cykliczne,
opis) i kwotę ze znakiem + lub −; wpływy są zielone. Kafelek 1×1 pokazuje tylko saldo i listę, od szerokości dwóch komórek są sumy 30 dni,
podpisy i podpowiedzi przy wierszach, a od wysokości dwóch pasek kategorii i rozliczenia. Dane z banku są tylko do odczytu: panel nie ma przelewów ani żadnej
operacji zapisu w banku; oznaczenia są lokalne.

Bank oddaje przez API sam tekst, bez logo, adresu, godziny i kategorii (pole MCC jest puste). Nazwy robi więc `src/bank-merchants.ts`
z tekstu: zdejmuje miasto sklejone z nazwą, kraj, numer sklepu i formę prawną i rozpoznaje znane sieci (Biedronka, Społem, Żabka,
Orlen, McDonald’s, Netflix i inne ze słownika w pliku). Kategorii panel już nie zgaduje: nadaje je użytkownik (niżej). Płatność
telefonem i BLIK nie niesie nazwy sklepu w żadnym polu (sprawdzone w surowej odpowiedzi; odczyt operacji oczekujących PKO odrzuca), więc
jest pokazana jako „Płatność telefonem · sklep nieznany”. Nazwę, logo i lokalizację PKO dokłada tylko w IKO i iPKO.

Oficjalne API PKO BP jest dla licencjonowanych TPP, więc panel korzysta z pośrednika
[Enable Banking](https://enablebanking.com) w trybie **restricted production**: darmowy dostęp do własnych,
wcześniej podlinkowanych kont, bez umowy. Pośrednik nie ma CLI do odczytu; to REST API (`https://api.enablebanking.com`),
a panel podpisuje zapytania krótkim JWT RS256 kluczem aplikacji (`server/bank.ts`).

## Jednorazowa konfiguracja

1. Klucz i certyfikat (poza Gitem, katalog tylko dla Twojego użytkownika):

   ```powershell
   openssl req -x509 -newkey rsa:2048 -nodes -keyout "$HOME\.desk-panel\enablebanking\private.pem" -out "$HOME\.desk-panel\enablebanking\public.crt" -days 3650 -subj "/CN=desk-panel"
   ```

2. W [Control Panel](https://enablebanking.com/cp/applications): nowa aplikacja **Production**, „Generate outside the
   browser and import public certificate” (wklej `public.crt`), redirect URL
   `https://<nazwa>.ts.net/api/bank/callback` (adres Tailscale z [tailscale.md](tailscale.md); Enable Banking odrzuca
   `http://127.0.0.1`), Privacy i Terms URL dowolne. Potem **Activate by linking accounts**: PKO Bank Polski, osoba prywatna,
   potwierdzenie w IKO. Aplikacja dostaje status **Active (restricted)** i widzi tylko podlinkowane konta.
3. W `%USERPROFILE%\.desk-panel\panel.env`: `DESK_BANK_APP_ID=<Application ID z Control Panel>` (to nie sekret), potem
   `just service RESTART`.
4. W panelu na kafelku Konto: **Połącz konto** → **Otwórz logowanie w banku** → iPKO i potwierdzenie w IKO. Podlinkowanie z kroku 2
   nie daje jeszcze dostępu do danych; zgoda przez API to osobny krok, który wykonuje ten przycisk.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `DESK_BANK_APP_ID` | brak | Application ID z Enable Banking; bez niego kafelek mówi, że konto nie jest skonfigurowane |
| `DESK_BANK_KEY_FILE` | `~/.desk-panel/enablebanking/private.pem` | Klucz prywatny aplikacji, tylko backend |
| `DESK_BANK_REDIRECT_URL` | `https://<DESK_ALLOWED_HOST>/api/bank/callback`, a bez niego `http://127.0.0.1:<port>/api/bank/callback` | Musi być jednym z adresów zarejestrowanych w aplikacji |

## Zgoda, odczyt i przechowywanie

- Zgoda w banku trwa do 180 dni (panel prosi o 179). Po jej wygaśnięciu kafelek zachowuje ostatni odczyt i oferuje
  **Połącz ponownie**; na 14 dni przed końcem pokazuje plakietkę „zgoda: N dni”.
- Bank pozwala na około cztery odczyty konta na dobę bez udziału użytkownika (PSD2), więc panel czyta bank najwyżej co 7
  godzin (`BANK_REFRESH_MS`), także po restarcie usługi, bo ostatni odczyt leży na dysku. Po błędzie czeka 30 minut.
  Błąd, 429 albo brak sieci zostawia ostatni odczyt z jego własną godziną; bank odrzucający zgodę (401/403) prosi o ponowne połączenie.
  Przeglądarka pyta panel co minutę, ale to tylko pamięć serwera.
- Sesja (`bank-session.dpapi`) i ostatni odczyt (`bank-cache.dpapi`) leżą w `~/.desk-panel`, zaszyfrowane DPAPI dla
  bieżącego użytkownika Windows, jak tokeny Google. Do przeglądarki trafiają tylko saldo, operacje i ostatnie 4 cyfry IBAN-u.
- Callback `GET /api/bank/callback` przyjmuje tylko odpowiedź na logowanie rozpoczęte przez panel (losowy `state`, jednorazowy,
  10 minut). Start zgody `POST /api/bank/connect` jest sprawdzany po `Origin`, jak inne akcje.
- Pełne numery rachunków i telefonów kontrahentów zostają w zaszyfrowanym cache (`raw` operacji jest tam w całości od wersji z
  oznaczeniami; wcześniejsze odczyty mają IBAN-y już ucięte). Wszystko, co wychodzi z serwera (`/api/bank`, scenariusz, agent), przechodzi
  przez `publicTransaction` w `server/bank-parties.ts`: IBAN do ostatnich 4 cyfr, numer telefonu tak, jak maskuje go bank (`486*****321`).
- Agent czatu widzi konto i oznaczenia tylko do odczytu przez `/api/agent/bank` (niżej). Wskazanie kafelka Konto przekazuje tylko jego nazwę.

## Oznaczenia operacji

Najpierw jedno pytanie: **co zrobiły pieniądze**. Odpowiedź to **ruch**, a ruch decyduje, do której sumy operacja trafia, i ma
dokładnie jedną oś. Dzięki temu każdy wykres czyta jedno pole i sumuje się do 100%.

| Ruch | Pytanie | Oś (jedna) | Liczy się do |
| --- | --- | --- | --- |
| **Wydatek** | na co poszło? | kategoria wydatku (własna lista z kolorem i ikoną) | wydatków i netto; wpływ oznaczony jako wydatek to zwrot (sklep, cashback, znajomy oddaje swoją część kolacji) i zmniejsza kategorię |
| **Przychód** | skąd przyszło? | źródło przychodu (osobna lista: Pensja, Sprzedaż, Zwrot podatku) | przychodów i netto; wypływ oznaczony jako przychód to korekta |
| **Rozliczenie** | kto komu jest winien? | druga strona | tylko salda z tą stroną: pożyczka −400 i oddanie +150 to „Anna odda Ci 250 zł”; nie liczy się do wydatków ani przychodów |
| **Przełożenie** | gdzie leży? | kieszeń, opcjonalnie (własna lista: Oszczędności, Revolut) | nigdzie: to nadal Twoje pieniądze |

Do tego, przy każdym ruchu:

| Pole | Pytanie | Kto wypełnia |
| --- | --- | --- |
| Druga strona | kto | rozpoznawana z tego, co pokazuje bank (tekst płatności kartą, rachunek, telefon, nazwa); nowa dostaje nazwę z banku do poprawienia; przy telefonie i BLIK wybierana z listy |
| Etykiety (dowolnie wiele) | szczegóły, po których potem szukasz (`#internet`, `#ogrzewanie`, `#dokładka`) | użytkownik, tworzone w locie |
| Cykliczne, opis | kontekst | użytkownik |
| Metoda płatności | jak | sama z kodu, którym PKO kończy tytuł: karta, przelew na telefon, przelew na rachunek, BLIK, telefon w sklepie; nie jest oznaczeniem |

Druga strona nie ma rodzaju (osoba, firma): o liczeniu decyduje ruch, nie to, kto stoi po drugiej stronie. Przelew do taty na
ogrzewanie to Wydatek w kategorii Rachunki z `#ogrzewanie`, pożyczka dla Anny to Rozliczenie z Anną, pensja z własnej firmy to Przychód ze
źródła Pensja, a przelew na własne oszczędności to Przełożenie do kieszeni „Oszczędności”.

**Reguła na przyszłość.** Nowe pytanie (np. „powód”) nie staje się nową osią obok kategorii. Jeśli zmienia, do której sumy trafiają
pieniądze, to nowy ruch (bardzo rzadko, np. inwestycje). Jeśli nie, to wartość na istniejącej osi (nowa kategoria albo źródło), gdy ma być
osobnym kawałkiem wykresu, albo etykieta.

Operacja jest **załatwiona**, gdy ma ruch, a wydatek i przychód także kategorię albo źródło (`isDone` w kontrakcie). **Do przypisania** są
niezałatwione operacje zaksięgowane od wybranego dnia (domyślnie dzień, w którym usługa pierwszy raz otworzyła oznaczenia; zmiana w ustawieniach
na kafelku): przerywane kółko, „przypisz” i „N do przypisania” w nagłówku (otwiera pierwszą i po zapisie przechodzi do następnej). Starsze
zostają „Nieoznaczone”, bez licznika. Rozpoznana druga strona sama niczego nie załatwia: przelew z firmy, rozpoznany po rachunku, dostaje pewną
podpowiedź (✓ jednym dotknięciem), ale nie zapisuje się sam.

Kafelek liczy sumy 30 dni według ruchów: przychody, wydatki i netto (przychód minus wydatek); nieoznaczona operacja liczy się według znaku, a
rozliczenia i przełożenia nie liczą się wcale. Pasek dzieli wydatki według kategorii, każda pomniejszona o zwroty, z odcinkiem „Bez
kategorii” dla reszty. Pod nim „Rozliczenia”: salda otwarte z każdą stroną z całej zapisanej historii („Anna odda Ci 250 zł”, „Jonasz czeka na zwrot 400 zł”), od wysokości dwóch komórek.

Wiersz pokazuje nazwę drugiej strony (gdy jest znana, zamiast tekstu banku), kategorię albo źródło w jego kolorze, „Rozliczenie” albo
„Przełożenie · Oszczędności” z ikoną ruchu (kwota przełożenia jest wyszarzona), etykiety, sposób płatności („sklep nieznany” znika, gdy
płatność telefonem ma drugą stronę) i znaczniki: cykliczne, opis. Dotknięcie otwiera okno: podpowiedź albo wybór na górze, potem cztery
przyciski ruchu (płatność kartą, telefonem i BLIK zaczyna od Wydatku, przelew czeka na wybór), każdy z nawykiem drugiej strony („2×”: tyle
jej wcześniejszych operacji w tę samą stronę było tym ruchem, `habits`). Pod nimi zdanie mówi, co się zapisze („Wydane 54,20 zł · u
Biedronka · na Spożywcze”, „Przełożone 2 000 zł · do Oszczędności”), z brakującymi częściami wyblakłymi, a pod zdaniem jedna lista ruchu:
kategorie wydatku, źródła przychodu albo kieszenie przełożenia (z „Nowa”/„Nowe”), a przy rozliczeniu saldo przed i po tej operacji.
Rozliczenia bez drugiej strony nie da się zapisać. Dalej druga strona, etykiety, „Cykliczne”, opis, Wyczyść i Zapisz oraz „Odpowiedź banku”.
Okno nie wylicza wszystkiego: druga strona pokazuje wybraną albo pole z nazwą z banku, a zapisane strony dopiero, gdy wpisujesz (pięć
pasujących); etykiety pokazują wybrane i osiem najczęstszych, resztę znajduje wpisywanie. Wpisana nazwa równa zapisanej stronie to ta strona;
„to ktoś inny” robi nową o tej samej nazwie. Podgląd surowej odpowiedzi po najechaniu na wiersz został.

Oznaczenie trzyma kopię swojej operacji (dzień, kwota, nazwa, sposób), bo bank oddaje tylko 35 dni, więc salda rozliczeń i przyszłe widoki
operacji cyklicznych mają całą historię bez migracji. Plik ma wersję 4 (ruch, jedna oś, druga strona bez rodzaju). Kod, który przenosił pliki
wersji 1–3 przy odczycie, usunięto po przeniesieniu jedynego pliku; starszy plik trafia do kopii obok i oznaczenia zaczynają się od zera
(historia gita ma ten kod, commit przed `6c9634d`).

### Druga strona i jej identyfikatory

Druga strona (`k-…`; `p-…` i `m-…` to osoby i sprzedawcy z wcześniejszych wersji) to encja z listą identyfikatorów. Co bank faktycznie
daje (sprawdzone na odczycie konta, 150 operacji):

| Operacja | Nazwa | Rachunek | Telefon | Tekst sprzedawcy |
| --- | --- | --- | --- | --- |
| przelew przychodzący (`TRANSFER-IN`) | `debtor.name` | `debtor_account` | brak | brak |
| przelew na telefon, wychodzący (`MOBILE-PAYMENT-C2C-EXTERNAL`) | `creditor.name` | `creditor_account` | w tytule `DO: 486*****321`, zamaskowany | brak |
| przelew na telefon, przychodzący (`MOBILE-PAYMENT-C2C`) | `debtor.name` | `debtor_account` | w tytule `OD: 48600700321`, w całości | brak |
| karta | brak | brak (to własne konto) | brak | tytuł („LESZNOJMP S.A. BIEDRONKA 5133PL”) |
| telefon lub BLIK w sklepie | brak | brak | brak | brak |

W tytule przelewu na telefon jest też **własny** numer (`OD:` przy wychodzącym, `DO:` przy przychodzącym); panel bierze tylko stronę
kontrahenta i nigdy własnego rachunku. Po oznaczeniu identyfikatory strony operacji (rachunek, telefon, a z pełnego numeru także jego
zamaskowana postać, nazwa z banku, tekst płatności kartą bez miasta i numeru sklepu) dopisują się do wskazanej drugiej strony. Identyfikator
należy do jednej (ostatnie oznaczenie wygrywa), a w ustawieniach można go zapomnieć. Nieznany kontrahent przelewu dostaje w oknie nazwę z
banku jako nową drugą stronę; po zapisie panel rozpoznaje go sam.

Dwie strony mogą mieć to samo imię: rozróżnia je to, co pokazał bank. Wpisana nazwa równa zapisanej to ta strona, a „to ktoś inny” robi drugą. Lista w oknie i w
ustawieniach pokazuje przy imieniu nazwę z banku i końcówki („Daniel · „DANIEL KOWALSKI” · rach. ··2874 · tel. ··321”); rachunek ma 4 cyfry,
telefon 3, bo resztę maskuje bank.

**Przechowywanie.** Identyfikator to `rodzaj:HMAC-SHA256(klucz, rodzaj:wartość)`; klucz (32 losowe bajty) jest tylko w pliku oznaczeń.
Dopasowanie wymaga tylko równości, więc pełnego numeru nie trzeba trzymać; numer telefonu (mała przestrzeń) dałoby się odgadnąć ze
zwykłego skrótu, ale nie bez klucza. Tekst sprzedawcy z karty nie jest tajny i jest trzymany wprost (`merchant:BIEDRONKA`). Przy
identyfikatorze zostaje to, co bank i tak pokazuje (`··2874`, `··321`, nazwa), żeby było widać, po czym encja jest rozpoznawana. Nic z tego
nie wymaga nowego odczytu banku. Rachunki działają od pierwszego odczytu po wdrożeniu oznaczeń (wcześniejszy cache ma IBAN-y ucięte); nazwy,
telefony i tekst sprzedawcy od razu.

Plik `~/.desk-panel/bank-labels.dpapi` jest zaszyfrowany DPAPI dla użytkownika Windows, jak odczyt banku: oznaczenia trzymają kopie operacji,
opisy i drugie strony powiązane z kwotami, więc to dane bankowe, a nie zwykła lista jak `todos.json`. Zapis jest atomowy (plik tymczasowy i
rename, `private-store.ts`); plik, który się odszyfrował, ale nie pasuje do schematu, jest odkładany (`.corrupt-<czas>`) z komunikatem, a plik
chwilowo nieczytelny (DPAPI, blokada) zostaje nietknięty i nic nie jest zapisywane, dopóki się nie odczyta.

### Podpowiedzi

Tylko przez powiązania, które trzymają (`server/bank-suggest.ts`), bez ukrytego modelu, przedziałów kwot i pory dnia (bank jej nie podaje).
Podpowiedź liczy się dla każdej niezałatwionej operacji, także starszej niż dzień „do przypisania”, i stoi przy jej wierszu (✓ i ✕ albo
„N możliwości”); starsza nie jest tylko liczona w „do przypisania”.

1. **Kto**: tekst sprzedawcy z banku, rachunek, pełny numer telefonu albo nazwa z banku należą do znanej drugiej strony. Okno od razu pokazuje,
   kto to jest, także bez wcześniejszych oznaczeń. Zamaskowany numer (pierwsza i trzy ostatnie cyfry) tylko podpowiada, z prośbą o sprawdzenie.
2. **Co**: wcześniejsze oznaczenia tej strony z tym samym kierunkiem pieniędzy, pogrupowane po tym, co mówiły (ruch, kategoria, etykiety,
   cykliczne). Wystarczy jedno oznaczenie: strona jest rozpoznana pewnie.
3. **Płatność bez nazwy** (telefon, BLIK): tylko ta sama kwota co do grosza; zawsze jako wybór, nigdy jako pewna podpowiedź.

Gdy pewne powiązanie prowadzi do oznaczeń, które wszystkie mówią to samo, podpowiedź jest **pewna**: wypełnia okno, a ✓ przy wierszu albo
Przyjmij ją zapisuje. Gdy wcześniej bywało różnie albo łączy tylko kwota, są **do wyboru** (najwyżej trzy, najczęstsze i najnowsze pierwsze):
jedno dotknięcie zapisuje wybrane, „Żadne” je odrzuca. Bez powiązania nie ma podpowiedzi. Nic nie zapisuje się samo. Odrzucenie jest
pamiętane dla tej operacji, a zapisanie czegoś innego niż pewna podpowiedź sprawia, że następnym razem to samo będzie już tylko wyborem.
Opcję „zawsze automatycznie dla tej strony” można dodać później jako regułę na tej samej podstawie; dziś jej nie ma.

Sprawdzenie na odczycie konta (pierwsza wersja reguł, symulacja oznaczania od najstarszej): płatności kartą miały wcześniejsze oznaczenie
tego samego sprzedawcy w 54 z 95 przypadków, kontrahent przelewu był rozpoznany 14 z 14 razy, a płatności bez nazwy powtarzały kwotę tylko
w 3 z 33.

### API

| Trasa | Co robi |
| --- | --- |
| `GET /api/bank/labels` | kategorie wydatków, źródła przychodu i kieszenie (`move`), nawyk drugiej strony przy nieoznaczonych (`habits`), etykiety, drugie strony (identyfikatory w postaci uciętej), oznaczenia operacji z ostatniego odczytu, rozpoznana druga strona (`known`), podpowiedzi, lista „do przypisania”, salda rozliczeń (`balances`; `src/bank-labels-contract.ts`) |
| `POST /api/bank/labels/action` | jedna akcja, sprawdzana po `Origin` jak inne zapisy: `label` (ruch, kategoria, druga strona, etykiety, cykliczne, opis; kategoria musi być z listy ruchu, rozliczenie wymaga drugiej strony), `clear`, `accept` (z numerem możliwości), `reject`, `createCategory`, `updateCategory`, `deleteCategory`, `mergeCategory` (oznaczenia kategorii przechodzą do innej z tej samej listy, nazwa może zostać etykietą; w Ustawieniach przycisk „Scal”), `renameTag`, `deleteTag`, `createParty`, `updateParty` (nazwa), `deleteParty`, `forgetIdentifier`, `setSince`; odmowa ma pole `error` z powodem |
| `GET /api/agent/bank` | tekst dla agenta czatu: saldo, operacje z zakresu (`from`, `to`, domyślnie 30 dni, najwyżej 400; `ruch`, `kategoria`, `etykieta`, `strona`, `nieprzypisane=1`), przychody, wydatki i netto, wydatki według kategorii, przychody według źródła, salda rozliczeń z całej historii; bez pełnych numerów |

Przeglądarka czyta oznaczenia co minutę i zaraz po każdej akcji; to odczyt pamięci serwera, bank nie jest pytany. Agent oznaczeń nie
zmienia (instrukcja w `server/agent-chat.ts`), a to, co odczyta z `/api/agent/bank`, trafia do dostawcy modelu `agy` ([czat.md](czat.md)).

## Scenariusze

`scenarios/standard.json` ma klucz `bank` w kształcie API (`src/bank-contract.ts`); `at` operacji to chwila w dniu
(`"today-1@12:00"`), a `raw` może mieć pełne (zmyślone) numery, bo scenariusz maskuje je przy wyjściu jak usługa. Klucz `bankLabels` (`since`, `categories` z `move`, `parties`, `labels` po id operacji z `move`, `category`, `tags`, `party`,
`recurring`, `comment`) to oznaczenia na start; drugie strony uczą się identyfikatorów z nich jak z gestu, a akcje są
pamiętane w pamięci do restartu. Scenariusz standardowy ma rozliczenie z Anną (saldo „Anna czeka na zwrot 120 zł”), pensję z firmy i sprzedaż
laptopa jako przychody, pewne podpowiedzi (Biedronka, Claude, Moja firma, Anna) i wybór po samej kwocie (BLIK 70,85 zł). Scenariusz nie obsługuje łączenia z bankiem.

## Wektor i bank: karta danych i karta zgody

Czat (Wektor, Hermes) czyta bank narzędziami `panel_bank` (tekst) i `panel_show` (karta z wierszami). Karta danych (`GET /api/bank/show`:
`view` tabela albo słupki, `kategorie` po nazwie, `nieoznaczone`, `from`/`to`) czyta wiersze sama, a model dostaje tylko podsumowanie:
sumy, od kiedy są oznaczenia, ile wydatków jest nieoznaczonych i nazwy operacji w pokazanych oraz w innych kategoriach.

Zmianę Wektor może tylko zaproponować: `panel_bank_propose` (`merge` dokładne nazwy kategorii wydatków, `into` nazwa docelowa, nowa albo
istniejąca, `tags` czy zostawić nazwy scalanych kategorii jako etykiety). Karta zgody pokazuje podgląd liczony przez panel
(`GET /api/bank/plan`): wiersze „ile × kategoria, jej etykiety” po lewej, wspólną strzałkę, po prawej kategorię docelową z nowymi
etykietami (zielone, z plusem) i tymi, które już są; kategoria, która znika, jest przekreślona z minusem. Nic się nie zmienia, dopóki
użytkownik nie kliknie „Wykonaj”: wtedy `POST /api/chats/:id/bank-plan` (tylko id karty i decyzja) bierze plan z rozmowy, liczy go
jeszcze raz i wykonuje jedną atomową akcją `mergeInto`. Decyzja i podgląd z chwili odpowiedzi zostają przy rozmowie
(`~/.desk-panel/cockpit.json`), więc karta pokazuje je także później. Wektor nie pokazuje karty z własnej inicjatywy przy samej prośbie o
radę: najpierw proponuje słowami, kartę dopiero po zgodzie albo przy wyraźnej prośbie o zmianę. Id karty to skrót z planu
(`stableBankCardId`), bo Hermes nie daje użytecznych id wywołań. Instrukcja rozmowy o banku to `BANK_GUIDE` w `src/chat-contract.ts`
(skill „Bank” i część preambuły).
