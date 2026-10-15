# Desk Panel

Lokalny panel React + TypeScript na pionowy ekran biurkowy. **Cezar i Google Calendar korzystają
z rzeczywistych danych. CPU, RAM oraz bieżące limity AI również są rzeczywiste.**
Zegar korzysta z czasu przeglądarki.

## Uruchomienie

Wymagany Node.js 22.12+ i npm. Uruchom Cezara, następnie w katalogu Desk Panelu:

```powershell
npm install
npm run dev
```

To uruchamia lokalne API na `http://127.0.0.1:5174` i Vite (domyślnie port 5173).
Do zwykłego używania wystarczy jeden proces, serwujący również frontend:

```powershell
npm run build
npm start
```

Otwórz `http://127.0.0.1:5174`. Bez Cezara panel działa ze stanem niedostępności;
nie wstawia przykładowych zadań zamiast prawdziwych.

Autostart Windows obsługuje Servy: `just install` buduje projekt i rejestruje
usługę. Szczegóły i logi opisano w [servy/README.md](servy/README.md).
`just` wyświetla krótki zestaw komend; `just check` uruchamia testy i build,
a `just service RESTART` przeładowuje działający serwer po zmianach.

Opcjonalne zmienne środowiska (nie trzeba tworzyć `.env`):

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `DESK_CEZAR_URL` | `http://127.0.0.1:4321` | Lokalny serwer Cezara; HTTP loopback, bez credentials |
| `DESK_PORT` | `5174` | Port serwera Desk Panelu; przy zmianie w development zmień również proxy Vite |
| `DESK_CALENDAR_ID` | `metelski.wiktor@gmail.com` | Konto Google i jego główny kalendarz; login jest sprawdzany |
| `DESK_GOOGLE_OAUTH_CLIENT_FILE` | `~/.desk-panel/google-oauth-client.json` | Pobrany klient OAuth Desktop lub Web, tylko backend |
| `DESK_ADAPTER_ENV_FILE` | `../cezar-adapter/.env` względem projektu | Backend odczytuje istniejący port i klucz właściciela adaptera |

## Google Calendar

Integracja loguje się na własne konto użytkownika przez OAuth Google.
Nie używa klucza Google Play ani konta usługi i nie wymaga udostępniania kalendarza.
Jednorazowe przygotowanie w Google Cloud:

1. Włącz Google Calendar API w projekcie (np. `tabnote-cli`).
2. W Google Auth Platform skonfiguruj Audience External; w trybie Testing dodaj
   swoje konto jako użytkownika testowego.
3. Utwórz klienta OAuth typu **Aplikacja komputerowa / Desktop app**. Obsługiwany
   jest też klient **Web**: dodaj w Google Cloud Authorized redirect URI dokładnie
   `http://127.0.0.1:5174/api/calendar/callback` (dostosuj port przy `DESK_PORT`).
4. Pobierz JSON i zapisz jako `~/.desk-panel/google-oauth-client.json` lub wskaż
   jego lokalną ścieżkę przez `DESK_GOOGLE_OAUTH_CLIENT_FILE`.
5. W Desk Panel → Ustawienia → Twoje konto Google kliknij „Połącz przez Google”,
   następnie „Otwórz logowanie Google”. Wybierz `metelski.wiktor@gmail.com` i udziel
   zgody na odczyt. Użyj zwykłej przeglądarki Chrome/Edge, jeśli Google odrzuci
   logowanie w przeglądarce osadzonej. Agenda odświeży się automatycznie.

Google w trybie Testing może ograniczać trwałość zgody; jeśli dostęp wygaśnie,
panel poprosi o ponowne logowanie. Nie wymaga publikowania ani weryfikowania
aplikacji dla tej lokalnej konfiguracji testowego użytkownika.

Serwer używa oficjalnej `google-auth-library` z zakresem `calendar.readonly`
oraz openid/email do sprawdzenia tożsamości zalogowanego użytkownika. OAuth ma
PKCE, losowy state, jednorazowy callback i dziesięciominutowy limit logowania.
Callback działa wyłącznie na `http://127.0.0.1:5174/api/calendar/callback`
(port zmienia się wraz z `DESK_PORT`). Połączenie z innym kontem jest odrzucane.
Refresh token zapisuje się atomowo poza repo w
`~/.desk-panel/calendar-token.dpapi`, zaszyfrowany DPAPI dla bieżącego użytkownika
Windows. Tokeny i klient OAuth nigdy nie trafiają do przeglądarki. Bez Windows
bezpieczny zapis jest niedostępny; aplikacja zgłasza ten stan zamiast zapisać token jawnie.

Backend
odczytuje strefę kalendarza i rozwinięte wystąpienia wydarzeń przez siedem dni
od początku dzisiejszego dnia. Obsługuje paginację (maks. 2500 wydarzeń, potem
oznaczenie częściowej agendy), wydarzenia całodniowe z wyłącznym końcem oraz DST.
Anulowane wydarzenia i odrzucone przez właściciela zaproszenia są pomijane.
Panel pokazuje nadchodzące i trwające wydarzenia; szczegół zawiera opis, lokalizację
i prawdziwy link `htmlLink`. Całodniowe wydarzenia nie wywołują alertu „spotkanie za…”.

Odczyt frontendowy co 15 sekund; backend pobiera Google najwyżej raz na minutę,
współdzieli równoległe żądania i przechowuje cache tylko w pamięci. Po błędzie
ponawia po 15 sekundach, zachowując ostatnią agendę i jej czas. 403/404 i brak
klienta OAuth pokazują brak dostępu, a nie pusty kalendarz. Surowe błędy GoogleAuth
i tokeny nigdy nie trafiają do odpowiedzi lub logów. Stary zapis nie tworzy
nowych zdarzeń panelu. Nie ma operacji zapisu, zapraszania ani edycji wydarzeń.

## Rzeczywiste dane Cezara

Backend odczytuje wyłącznie wersjonowane HTTP API Cezara: workspace dashboard
oraz jego strony grup questions/reviews/running/queued. Nie czyta plików runów,
nie korzysta z deprecated REST adaptera i nie wymaga tokenów w przeglądarce.
Odczytuje wszystkie projekty zarejestrowane w działającym Cezarze.

- Liczniki pochodzą z `counts`, a nie z liczby wyświetlonych wierszy.
- Wszystkie strony należą do jednego snapshotu. Do 200 wierszy na grupę;
  przekroczenie limitu lub niepełne coverage oznacza jawną listę częściową.
- Grupowanie Cezara rozstrzyga oczekiwanie na odpowiedź, także failed z pytaniem.
  Monitoring pozostaje w toku. Zaplanowane wznowienia mają osobną informację.
- Dashboard pokazuje do trzech zadań według priorytetu; Zadania zawierają
  dostępne aktywne grupy, bez historii zakończonych zadań.
- Szczegół pokazuje tekst dostępny w dashboardzie (może być skrócony), projekt,
  daty i link do dokładnego zadania w lokalnym Cezarze. Runner nie jest zgadywany:
  obecny zbiorczy kontrakt go nie dostarcza.
- Odczyt co 5 sekund, jeden request naraz w przeglądarce, timeout i anulowanie
  po wyłączeniu integracji. Backend współdzieli odczyt i cache przez 4 sekundy.
- Timestamp to `asOf` Cezara. Cezar może ponownie zwrócić identyczny snapshot
  przez 60 sekund. Panel oznacza zapis nieaktualny po 75 sekundach; błąd odczytu
  natychmiast oznacza offline, zachowując ostatni poprawny stan i jego datę.
  Brak odczytu to kreski, nigdy zera. Runtime JSON jest walidowany na obu granicach.

Serwer nasłuchuje tylko na 127.0.0.1, sprawdza Host i nie otwiera CORS.
Odczyty to GET do konkretnych projekcji; rozpoczęcie OAuth to POST z kontrolą
Origin (ochrona CSRF). Nie pozwala na ogólne proxy lub akcje tasków.
Private api-client Cezara nie jest publikowany: integracja waliduje dokumentowany
podzbiór kontraktu bez importów do sąsiedniego checkoutu.

## CPU i RAM

`GET /api/system` mierzy cały komputer przez natywne `node:os`, bez dodatkowego
programu, PowerShella, uprawnień administratora czy instalowania zależności.
CPU to średnia zajętość wszystkich logicznych rdzeni obliczona z różnicy czasów
busy/idle pomiędzy dwoma odczytami. Nie jest to obciążenie samego procesu Node
ani procesów Cezara. Pierwszy odczyt zbiera bazę; wynik pojawia się po ok. 2 s.
RAM to pamięć fizyczna total-minus-free, pokazana w GiB (1024³ bajtów).

Panel odczytuje system co ok. 2 s. Backend współdzieli pomiary między kartami
i klientami, nie dopisując próbek częściej niż co 2 s; nie ma osobnego timera
ani procesu. Historia w pamięci jest ograniczona do 150 próbek / 5 minut.
Po przerwie >10 s (np. uśpienie lub brak czytelników) zbiera nową bazę i zaczyna
nową historię. Błąd lub cofnięcie liczników nie daje fikcyjnego 0%; poprzedni
odczyt zachowuje swój timestamp i oznaczenie braku pomiaru. Świeżość systemu
wynosi 15 s. Wysoki RAM zasila regułę zdarzeń panelu.
Endpoint jest lokalny, read-only; nie zbiera danych dysku.

## Limity AI

Panel czyta `/panel/v1/quotas/live` w cezar-adapter co 15 s (cache serwera 10 s,
timeout 10 s). Adapter współdzieli rzeczywisty odczyt providerów co najwyżej raz
na 60 s. Połączenie wyłącznie loopback, klucz właściciela w nagłówku.
Istniejący `.env` adaptera jest parsowany prywatnie, bez zmieniania process.env.
Klucz nie trafia do przeglądarki ani logów. Nie używamy deprecated `/gpt/v1`.

To bieżące quota 5h/7d kont zalogowanych w lokalnych CLI. Claude używa odczytu
OAuth usage istniejącego adaptera; Codex ma krótki app-server z wyłącznie metodą
account/rateLimits/read po inicjalizacji. Nie ma promptów, rozmów ani inference.
Po odczycie proces Codexa jest zamykany; bez czytelników odczyty ustają.
Nie jest uruchamiany nowy task Cezara. Polling nie generuje tokenów modelu;
same endpointy kont mogą mieć niezależny limit częstotliwości zapytań.

Pasek pokazuje zużycie, jasna kreska ze strzałką — upływ czasu w nominalnym oknie
5h/7d wyliczony z terminu resetu. Pod paskiem jest procent czasu i odliczanie do
resetu. Kolor porównuje zużycie z upływem czasu: zielony do 5 p.p. ponad czas
(także poniżej), żółty ponad 5 do 15 p.p., czerwony ponad 15 p.p.
Legenda jest tylko w szczegółach konta, razem z dokładnymi datami obserwacji i resetu.
Szczegóły pokazują też różnicę zużycie–czas w p.p., odległość od progu kolejnego
koloru oraz przekroczenie progu żółtego/czerwonego (dwa miejsca po przecinku).
Stare/offline odczyty są szare i nie pokazują kreski ani bieżącego odliczania;
reset nie zeruje zużycia bez nowego pomiaru. Kolor opisuje tempo, nie dostępność limitu.

Timestamp pomiaru i reset są widoczne w szczegółach. Brak okna to null, nie 0%. Błąd zachowuje
ostatni odczyt z jego pierwotną datą. Wiek >120 s (dwie minuty)
lub brak/miniony reset wyłącza bieżące alerty. Claude po
błędzie ma 5-minutowy backoff. To aktualny odczyt; nie łączymy historii różnych
loginów. Historyczny endpoint `/panel/v1/quotas` i taskowe snapshoty nadal działają
bez odpytywania providera i nie są modyfikowane przez live polling.

## Interfejs

Stopki kart pokazują częstotliwość odświeżania, czas danych i osobno czas ostatniego
poprawnego pobrania przez panel, z dokładnością do sekund. Błąd nie przesuwa daty
ostatniego sukcesu. Świeżość jest sprawdzana względem bieżącego czasu renderu,
również gdy pomiar nadejdzie pomiędzy jednosekundowymi tickami zegara interfejsu.

Dotknięcie wiersza otwiera szczegół; osobny przycisk otwiera źródło. Układ kart
(widoczność, kolejność, wariant) zapisuje się w localStorage. Poniżej 640 CSS px
siatka przechodzi do jednej kolumny. Brak procentów postępu, ETA i danych dysku.

Wszystkie karty korzystają z podłączonych źródeł; panel nie ma trybu ani danych
demonstracyjnych. Null oznacza brak pomiaru; historia to dyskretne obserwacje.
Zdarzenia korzystają z tych samych źródeł co karty. Offline lub stare dane nie
tworzą nowych alertów.

## Scenariusze i zrzuty ekranu

UI czyta wyłącznie lokalne API (`/api/*`), walidowane schematami z `src/*-contract.ts`.
Serwer składa je z interfejsu `PanelSources` (`server/sources.ts`), który ma dwie
implementacje: `server/real-sources.ts` (usługa: Cezar, Google, komputer, adapter
limitów) i `server/scenario.ts` (plik JSON). UI nie wie, która odpowiada.

Scenariusz w `scenarios/*.json` zawiera po jednej odpowiedzi na endpoint (`cezar`,
`calendar`, `calendarConnection`, `system`, `quotas`) dokładnie w kształcie API.
Czasy zapisuje się względem chwili zapytania: `"now"`, `"now-20m"`, `"now+1h30m"`
(ms, s, m, h, d). Zamiast odpowiedzi endpoint może mieć `{ "$error": 502 }` albo
`{ "$pending": true }` (ładowanie bez końca); brakujący endpoint odpowiada 503.
Plik jest czytany przy każdym zapytaniu, więc zmiany widać od razu, a błędy
kontraktu są zgłaszane ze ścieżką pola.

```powershell
just scenario offline                                  # UI na scenariuszu, adres w konsoli
just screenshots standard                              # output/screenshots/standard-*.png
just screenshots high-ram --pages pulpit,system --size 1080x1920
npm run scenario -- C:\temp\moj.json --shot           # dowolny plik
```

Skrypt uruchamia Vite i API scenariusza na wolnych portach (nie dotyka usługi ani
prawdziwych źródeł). Te same pliki zasilają testy UI (`src/test-fixtures.ts`), a
`server/scenario.test.ts` sprawdza, że każdy z nich spełnia kontrakty.

## Zdarzenia

Zakładka „Zdarzenia” w dolnej nawigacji opisuje aktualne reguły w krótkiej tabeli:
warunek utworzenia oraz kiedy dany wpis może pojawić się ponownie. Pokazuje też
zasady zapisu historii i usuwania. Progi i czasy są współdzielone z detekcją zdarzeń.

Karta zastępuje Insights listą przewijaną pionowo (bez osobnego „Zobacz wszystkie”).
Przesunięcie wpisu w lewo lub prawo usuwa go; przycisk × jest alternatywą dla gestu,
a „Cofnij” działa przez sześć sekund. Dotknięcie wpisu otwiera szczegóły źródła.
Przewijanie pionowe i przerwany/krótki gest nie usuwają wpisu ani nie otwierają szczegółów.

Lista przechowuje ostatnie 100 wykrytych zdarzeń z godziną wykrycia i opisem z tego
momentu. Zapisuje je lokalnie w przeglądarce, również po usunięciu warunku alertu
lub utracie połączenia. Zamknięty panel nie zbiera zdarzeń w tle.
Zablokowany/uszkodzony localStorage nie blokuje pulpitu.

Reguły: Cezar wymaga odpowiedzi; zadania zakończone w ostatnich 10 minutach;
spotkania w ciągu 15 minut; RAM ≥90% przez ciągłą minutę. Limity AI tworzą osobne
zdarzenia dla konta i okna: żółte tempo (>5 p.p.), czerwone (>15 p.p.), zużycie ≥90%.
Każdy próg limitu zgłaszany jest najwyżej raz w danym oknie resetu, także po
usunięciu wpisu i odświeżeniu strony; eskalacja do czerwonego tworzy nowy wpis,
spadek z czerwonego do żółtego nie ostrzega ponownie. Porównanie terminu resetu
toleruje korekty do 5 minut względem pierwotnego zgłoszenia (bez zaokrąglania do
przedziałów). Wygasłe okno nie blokuje nowego. Przy wczytywaniu historii scalane
są potwierdzone duplikaty quota, z zachowaniem pierwszej godziny wykrycia.
Pytania i RAM mogą zgłosić
nowy epizod po potwierdzonym ustąpieniu warunku. Nieaktualne źródło nie potwierdza
ustąpienia. Pamięć deduplikacji jest ograniczona do ostatnich 2000 jednorazowych
sygnałów i 1000 aktywnych warunków.

## Weryfikacja

```powershell
npm run typecheck
npm test
npm run build
```

Testy obejmują interfejs (na scenariuszach z `scenarios/` podawanych przez
to samo API co serwer scenariuszy), layout, reguły i historię zdarzeń, gesty oraz integrację:
paginację, autorytatywne liczniki, failed w grupie pytań, niepełne coverage,
błędny JSON, wygasły snapshot, rzeczywiste wiersze i linki oraz awarię bez
zastępczych danych. Testy kalendarza obejmują DST, wydarzenia całodniowe, odrzucone zaproszenia,
paginację, cache, awarię z zachowaniem danych oraz brak wycieku błędów autoryzacji.
Testy OAuth pinują PKCE, konto, state, expiry i odrzucenie powtórnego callbacku.
Build sprawdza także kod serwera.
