# Konto bankowe (PKO BP przez Enable Banking)

Kafelek **Konto** pokazuje saldo konta prywatnego w PKO BP, wpływy i wydatki z ostatnich 30 dni, pasek z podziałem wydatków
na kategorie i operacje pogrupowane po dniach („Dziś”, „Wczoraj”, „Pt, 23 paź”, z sumą dnia). Każda operacja ma ikonę kategorii
w kółku, czystą nazwę, podpis („Zakupy · karta”) i kwotę ze znakiem + lub −; wpływy są zielone. Kafelek 1×1 pokazuje tylko saldo i
listę, od szerokości dwóch komórek są sumy 30 dni i podpisy, a od wysokości dwóch pasek kategorii. Dane są tylko do odczytu: panel
nie ma przelewów ani żadnej operacji zapisu w banku.

Bank oddaje przez API sam tekst, bez logo, adresu, godziny i kategorii (pole MCC jest puste). Nazwy i kategorie robi więc
`src/bank-merchants.ts` z tekstu: zdejmuje miasto sklejone z nazwą, kraj, numer sklepu i formę prawną, rozpoznaje znane sieci
(Biedronka, Społem, Żabka, Orlen, McDonald’s, Netflix i inne ze słownika w pliku) i zgaduje kategorię po słowach (cukiernia, centrum
medyczne). Płatność telefonem i BLIK nie niesie nazwy sklepu w żadnym polu (sprawdzone w surowej odpowiedzi; odczyt operacji
oczekujących PKO odrzuca), więc jest pokazana jako „Płatność telefonem · Sklep nieznany”, bez zgadywania. Nazwę, logo i lokalizację
PKO dokłada tylko w IKO i iPKO.

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
- Agent czatu nie widzi danych bankowych: nie ma widoku w `/api/agent/*`, a wskazanie kafelka Konto przekazuje tylko jego nazwę.

## Scenariusze

`scenarios/standard.json` ma klucz `bank` w kształcie API (`src/bank-contract.ts`); `at` operacji to chwila w dniu
(`"today-1@12:00"`). Scenariusz nie obsługuje łączenia z bankiem.
