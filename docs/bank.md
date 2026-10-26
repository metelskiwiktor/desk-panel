# Konto bankowe (PKO BP przez Enable Banking)

Kafelek **Konto** pokazuje saldo konta prywatnego w PKO BP, wpływy i wydatki z ostatnich 30 dni, pasek z podziałem wydatków
na **kategorie użytkownika** i operacje pogrupowane po dniach („Dziś”, „Wczoraj”, „Pt, 23 paź”, z sumą dnia). Każda operacja ma kółko
w kolorze i z ikoną swojej kategorii, czystą nazwę, podpis („Jedzenie · karta”, znaczniki: cykliczne, opis) i kwotę ze
znakiem + lub −; wpływy są zielone. Kafelek 1×1 pokazuje tylko saldo i listę, od szerokości dwóch komórek są sumy 30 dni, podpisy i
podpowiedzi przy wierszach, a od wysokości dwóch pasek kategorii. Dane z banku są tylko do odczytu: panel nie ma przelewów ani żadnej
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

Każde pole odpowiada na jedno pytanie:

| Pole | Pytanie | Kto wypełnia |
| --- | --- | --- |
| Druga strona | kto | rozpoznawana z tego, co pokazuje bank (tekst płatności kartą, rachunek, telefon, nazwa); przy telefonie i BLIK wybierana z listy |
| Kategoria (dokładnie jedna) | na co poszły pieniądze; jeden kawałek paska | użytkownik, własna lista z kolorem i ikoną |
| Cel (przy osobie) | po co: pożyczka, zwrot, dokładka, prezent | użytkownik, własna lista jak etykiety |
| Etykiety (dowolnie wiele) | szczegóły, po których potem szukasz (`#internet`, `#tabnote`, `#ogrzewanie`) | użytkownik, tworzone w locie |
| Metoda płatności | jak | sama z kodu, którym PKO kończy tytuł: karta, przelew na telefon, przelew na rachunek, BLIK, telefon w sklepie; nie jest oznaczeniem |
| Cykliczne, opis | | użytkownik |

**Druga strona** ma rodzaj, od którego zależy, o co pyta okno:

- **Firma** (Inea, Społem, pyszne.pl, OVH): kategoria, etykiety, cykliczne. Przykład: Inea, kategoria Rachunki, `#internet`, cykliczne.
- **Osoba** (Alicja, tata, Daniel): do tego **cel**. Przykład: przelew do taty to cel „dokładka”, kategoria Rachunki, `#ogrzewanie` i opis.
  Pożyczka to cel, nie kategoria. Rozliczenie z osobą (widok agenta) sumuje jej operacje według celu ze znakiem: pożyczka −400 i zwrot
  +150 to 250 jeszcze nieoddane, a dokładka nie wygląda jak dług.
- **Ja** (własna firma, inne własne konto): **przelew własny**. Kategoria jest niepotrzebna i operacja nie wisi jako „do przypisania”, ale
  zgodnie z wyborem użytkownika liczy się do sum wpływów i wydatków (to jego pensja). Wydatek na własne konto ma na pasku osobny odcinek
  „Przelewy własne”.

Kategoria to to, co chcesz widzieć jako osobny kawałek paska (Rachunki, Spożywcze, Jedzenie na mieście, Subskrypcje); reszta to etykiety.
Operacja jest **załatwiona**, gdy ma kategorię albo cel, albo jej druga strona to „Ja” (także rozpoznana, zanim ją oznaczysz). **Do
przypisania** są niezałatwione operacje zaksięgowane od wybranego dnia (domyślnie dzień, w którym usługa pierwszy raz otworzyła oznaczenia;
zmiana w ustawieniach na kafelku): przerywane kółko, „przypisz” i „N do przypisania” w nagłówku (otwiera pierwszą i po zapisie przechodzi do
następnej). Starsze zostają „Bez kategorii”, bez licznika.

Wiersz pokazuje nazwę drugiej strony (gdy jest znana, zamiast tekstu banku), kategorię w jej kolorze albo „Przelew własny”, cel, etykiety,
sposób płatności („sklep nieznany” znika, gdy płatność telefonem ma drugą stronę) i znaczniki: cykliczne, opis. Dotknięcie otwiera okno:
podpowiedź albo wybór na górze, „Kto to?” dla nieznanego kontrahenta przelewu (Osoba, Firma, Ja), druga strona (lista z identyfikatorami; nowa
z wyborem rodzaju; dla karty wypełniona nazwą z banku jako firma; rodzaj znanej zmienia się jednym dotknięciem), potem pola zależne od rodzaju,
etykiety, „Cykliczne”, opis, Wyczyść i Zapisz oraz „Odpowiedź banku”. Podgląd surowej odpowiedzi po najechaniu na wiersz został.

Oznaczenie trzyma kopię swojej operacji (dzień, kwota, nazwa, sposób), bo bank oddaje tylko 35 dni, więc przyszłe widoki pożyczek i operacji
cyklicznych mają całą historię bez migracji. Pliki wcześniejszych wersji są przenoszone same przy odczycie: osoby i sprzedawcy stają się drugą
stroną rodzaju osoba i firma, a oznaczenie kategorią „Pożyczka” dostaje cel „pożyczka” (pieniądze wyszły) albo „zwrot” (przyszły), a sama
kategoria znika.

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
należy do jednej (ostatnie oznaczenie wygrywa), a w ustawieniach można go zapomnieć. Panel nie zgaduje, czy nieznany kontrahent przelewu to
osoba, firma czy „Ja”; pyta raz („Kto to?”) i potem rozpoznaje sam.

Dwie osoby mogą mieć to samo imię (firma i „Ja” o tej samej nazwie to ta sama): rozróżnia je to, co pokazał bank. Lista w oknie i w
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
2. **Co**: wcześniejsze oznaczenia tej strony z tym samym kierunkiem pieniędzy, pogrupowane po tym, co mówiły (kategoria, cel, etykiety,
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
| `GET /api/bank/labels` | kategorie, etykiety, cele, drugie strony z rodzajem (identyfikatory w postaci uciętej), oznaczenia operacji z ostatniego odczytu, rozpoznana druga strona (`known`), podpowiedzi, lista „do przypisania” (`src/bank-labels-contract.ts`) |
| `POST /api/bank/labels/action` | jedna akcja, sprawdzana po `Origin` jak inne zapisy: `label`, `clear`, `accept` (z numerem możliwości), `reject`, `createCategory`, `updateCategory`, `deleteCategory`, `renameTag`, `deleteTag`, `renamePurpose`, `deletePurpose`, `createParty`, `updateParty` (nazwa, rodzaj), `deleteParty`, `forgetIdentifier`, `setSince`; odmowa ma pole `error` z powodem |
| `GET /api/agent/bank` | tekst dla agenta czatu: saldo, operacje z zakresu (`from`, `to`, domyślnie 30 dni, najwyżej 400; `kategoria`, `etykieta`, `strona`, `cel`, `nieprzypisane=1`), wydatki według kategorii, rozliczenie z osobami według celu z całej historii; bez pełnych numerów |

Przeglądarka czyta oznaczenia co minutę i zaraz po każdej akcji; to odczyt pamięci serwera, bank nie jest pytany. Agent oznaczeń nie
zmienia (instrukcja w `server/agent-chat.ts`), a to, co odczyta z `/api/agent/bank`, trafia do dostawcy modelu `agy` ([czat.md](czat.md)).

## Scenariusze

`scenarios/standard.json` ma klucz `bank` w kształcie API (`src/bank-contract.ts`); `at` operacji to chwila w dniu
(`"today-1@12:00"`), a `raw` może mieć pełne (zmyślone) numery, bo scenariusz maskuje je przy wyjściu jak usługa. Klucz `bankLabels` (`since`, `categories`, `parties` z `kind`, `labels` po id operacji z `category`, `tags`, `party`,
`purpose`, `recurring`, `comment`) to oznaczenia na start; drugie strony uczą się identyfikatorów z nich jak z gestu, a akcje są
pamiętane w pamięci do restartu. Scenariusz standardowy ma pożyczkę i zwrot (Anna, Jonasz), przelewy własne z firmy, pewne
podpowiedzi (Biedronka, Claude, Moja firma, Anna) i wybór po samej kwocie (BLIK 70,85 zł). Scenariusz nie obsługuje łączenia z bankiem.
