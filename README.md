# Desk Panel

Lokalny panel React + TypeScript na poziomy ekran biurkowy (1280×720 CSS). **Cezar i Google Calendar korzystają
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

W Ustawieniach „Otwórz podgląd pionowy” osadza niezmieniony panel w osobnym obszarze
o wymiarach głównego ekranu z `devices.json`. Podgląd przewija się bez automatycznego
pomniejszania, a powiększenie przeglądarki działa jak zwykle. Jego style dotyczą tylko
zewnętrznej warstwy; dashboard używa tego samego układu co na docelowym ekranie.
Ukryty panel zachowuje stronę i stan, ale wstrzymuje odpytywanie API i anuluje
trwające odczyty. Po zamknięciu podglądu odczyty wznawiają się od razu.
Limity AI są zawsze bezpośrednio pod kartami. Wysokość kart wynika z zawartości,
a długie listy poczty przewijają się wewnątrz karty.

Opcjonalne zmienne środowiska (nie trzeba tworzyć `.env`):

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `DESK_CEZAR_URL` | `http://127.0.0.1:4321` | Lokalny serwer Cezara; HTTP loopback, bez credentials |
| `DESK_PORT` | `5174` | Port serwera Desk Panelu; przy zmianie w development zmień również proxy Vite |
| `DESK_CALENDAR_ID` | `metelski.wiktor@gmail.com` | Konto Google i jego główny kalendarz; login jest sprawdzany |
| `DESK_EXTRA_CALENDARS` | brak | Dodatkowe kalendarze tego samego konta, rozdzielone przecinkami (identyfikator z ustawień kalendarza Google, np. zasubskrybowany plan Garmin `…@import.calendar.google.com`); ich zdarzenia trafiają do tej samej agendy |
| `DESK_MAIL_ACCOUNTS` | konto z `DESK_CALENDAR_ID` | Konta Gmail na liście poczty, rozdzielone przecinkami (np. `a@gmail.com,b@gmail.com`) |
| `DESK_GOOGLE_OAUTH_CLIENT_FILE` | `~/.desk-panel/google-oauth-client.json` | Pobrany klient OAuth Desktop lub Web, tylko backend |
| `DESK_ADAPTER_ENV_FILE` | `../cezar-adapter/.env` względem projektu | Backend odczytuje istniejący port i klucz właściciela adaptera |

Usługa Windows czyta dodatkowo opcjonalny plik `%USERPROFILE%\.desk-panel\panel.env`
(poza Gitem; linie `KLUCZ=wartość`, `#` to komentarz), np. z prywatnymi adresami:

```
DESK_MAIL_ACCOUNTS=pierwszy@gmail.com,drugi@gmail.com
```

Zmiany w nim działają po `just service RESTART`. Zobacz [servy/README.md](servy/README.md).

## Google Calendar

Integracja loguje się na własne konto użytkownika przez OAuth Google.
Nie używa klucza Google Play ani konta usługi i nie wymaga udostępniania kalendarza.
Jednorazowe przygotowanie w Google Cloud:

1. Włącz Google Calendar API i Gmail API w projekcie (np. `tabnote-cli`).
2. W Google Auth Platform skonfiguruj Audience External; w trybie Testing dodaj
   wszystkie swoje konta (kalendarz i poczta) jako użytkowników testowych. W Data Access
   dodaj zakresy `calendar.readonly` i `gmail.modify`.
3. Utwórz klienta OAuth typu **Aplikacja komputerowa / Desktop app**. Obsługiwany
   jest też klient **Web**: dodaj w Google Cloud Authorized redirect URI dokładnie
   `http://127.0.0.1:5174/api/calendar/callback` (dostosuj port przy `DESK_PORT`).
4. Pobierz JSON i zapisz jako `~/.desk-panel/google-oauth-client.json` lub wskaż
   jego lokalną ścieżkę przez `DESK_GOOGLE_OAUTH_CLIENT_FILE`.
5. W Desk Panel → Ustawienia → Konta Google kliknij przy każdym koncie „Połącz przez Google”,
   następnie „Otwórz logowanie Google”. Wybierz właściwe konto i zaznacz wszystkie
   uprawnienia (zgoda z odznaczonym uprawnieniem jest odrzucana). Użyj zwykłej przeglądarki Chrome/Edge, jeśli Google odrzuci
   logowanie w przeglądarce osadzonej. Agenda odświeży się automatycznie.

Google w trybie Testing może ograniczać trwałość zgody; jeśli dostęp wygaśnie,
panel poprosi o ponowne logowanie. Nie wymaga publikowania ani weryfikowania
aplikacji dla tej lokalnej konfiguracji testowego użytkownika.

Serwer używa oficjalnej `google-auth-library` z zakresem `calendar.readonly`
oraz openid/email do sprawdzenia tożsamości zalogowanego użytkownika. OAuth ma
PKCE, losowy state, jednorazowy callback i dziesięciominutowy limit logowania.
Callback działa wyłącznie na `http://127.0.0.1:5174/api/calendar/callback`
(port zmienia się wraz z `DESK_PORT`). Połączenie z innym kontem jest odrzucane.
Refresh token każdego konta zapisuje się atomowo poza repo — konto kalendarza w
`~/.desk-panel/calendar-token.dpapi`, pozostałe w `~/.desk-panel/google-<email>.dpapi` —
razem z listą przyznanych zakresów, zaszyfrowany DPAPI dla bieżącego użytkownika
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

## Poczta (Gmail)

Karta „Poczta” pokazuje nieprzeczytane wątki z Odebranych z ostatnich 30 dni (`in:inbox is:unread newer_than:30d`, wszystkie
karty, bez spamu i kosza) ze wszystkich kont z `DESK_MAIL_ACCOUNTS`, najnowsze na górze.
Liczniki obejmują pobrane wątki z tego okresu (do 200 na konto), przed podziałem listy na strony;
gdy Gmail ma ich więcej, licznik ma postać „200+”. Scenariusze stosują to samo 30-dniowe okno.
Przesunięcie w lewo oznacza wątek jako przeczytany, w prawo przenosi go do Kosza w Gmailu
(odwracalne przez 30 dni; trwałego usuwania nie ma). Te same akcje są pod przyciskami
✓ i kosza oraz w szczegółach wątku. Przez 6 sekund „Cofnij” wykonuje w Gmailu akcję
odwrotną (nieprzeczytane / przywróć z kosza). Gdy Gmail odmówi, wątek wraca na listę.

Lista przewija się wewnątrz karty o stałej wysokości (`--mail-list-height`), a kolejne
porcje po 30 wątków doczytuje się przy przewijaniu. Backend czyta tylko metadane (nadawca,
temat, podgląd Gmaila, data), nigdy treści ani załączników; niezmienione wątki (ten sam
`historyId`) bierze z pamięci. Odczyt co 30 s; po błędzie zostaje ostatnia lista i jej czas.

Zakres `gmail.modify` pozwala czytać, zmieniać etykiety i przenosić do kosza. Konto
kalendarza połączone przed dodaniem poczty dalej pokazuje kalendarz, a w Ustawieniach
prosi o ponowne połączenie, żeby dodać Gmail.

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
Odczyty to GET do konkretnych projekcji; rozpoczęcie OAuth i akcje poczty to POST
z kontrolą Origin (ochrona CSRF) i walidowanym, małym JSON-em. Nie pozwala na ogólne proxy lub akcje tasków.
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

## Garmin Connect (plan treningowy)

Dane treningowe pochodzą z planu w Garmin Connect, przez nieoficjalną bibliotekę
[garminconnect-js](https://github.com/DynamicsNinja/garminconnect-js) (przypięta wersja 0.10.0, bez
zależności). Garmin nie ma publicznego API, więc jego endpointy mogą się zmienić bez zapowiedzi;
panel działa wtedy dalej, a źródło pokazuje stan „offline" lub „niedostępne".

Logowanie robisz raz, w terminalu — hasła nie wpisuje się w przeglądarce ani w panelu:

```powershell
just garmin-login
```

Skrypt pyta o e-mail, hasło (niewidoczne) i kod MFA. Hasło i kod nie są nigdzie zapisywane;
zapisują się wyłącznie tokeny OAuth, zaszyfrowane DPAPI dla bieżącego użytkownika Windows w
`~/.desk-panel/garmin-tokens.dpapi` (`DESK_GARMIN_TOKEN_FILE`). Usługa musi działać na tym samym
koncie Windows i podchwyci logowanie przy następnym odczycie (do 15 minut), bez restartu. Token OAuth1
wygasa po ok. 30 dniach bez użycia; panel odpytuje Garmin stale, więc się odnawia, ale po dłuższej
przerwie trzeba zalogować się ponownie. Strefa czasowa dnia: `DESK_TIME_ZONE` (domyślnie strefa komputera).

Odczyt to wyłącznie GET: plan od 7 dni wstecz do 14 dni naprzód, kroki treningu (interwały i docelowa
moc) dla najbliższych 7 dni oraz ostatnie aktywności. Garmin jest pytany najwyżej co 15 minut (po błędzie
co 5 min, po limicie zapytań co 30 min), a kroki treningu trzymane są w pamięci 6 godzin. Błąd zachowuje
ostatni plan z pierwotną godziną pomiaru. Do panelu trafiają tylko: nazwa, sport, dzień, szacowany czas,
poziom (`workoutPhrase`), efekt treningowy i kroki, a z aktywności czas, sport, średnia moc i tętno oraz
TSS. Waga, sen, tętno, miejsca, nazwy aktywności i identyfikatory konta nie opuszczają backendu.

`GET /api/training` zwraca kontrakt z `src/training-contract.ts`. Czy trening jest wykonany, liczy
`src/training-progress.ts` z nagrań danego dnia (od 80% planowanego czasu; nagrania krótsze niż 2 min
się nie liczą), bo pole Garmina `associatedActivityId` bywa puste. Gotowość treningowa, sen, HRV i
body battery nie są czytane: to konto ich nie zwraca. Dawny import planu przez zasubskrybowany kalendarz
Garmin w Google (`DESK_EXTRA_CALENDARS`) nie jest już potrzebny do planu; zostaje dla zwykłych
wydarzeń, np. zawodów w głównym kalendarzu Google.

## Interfejs

Pulpit mieści się na poziomym ekranie (1280×720 CSS) bez przewijania. Rama ma trzy strefy,
a układ nie zależy od urządzenia:

- u góry godzina, data, pigułka zdarzeń panelu i jedna linia stanu (PC z CPU/RAM, Cezar —
  „nic nie czeka” / „N czeka na Ciebie” / „N w toku”, Gmail); pigułka stoi w pasku, więc nic nie zasłania;
- po lewej „Dziś”: spotkanie za 15 minut lub trwające zajmuje miejsce na górze (odliczanie), pod nim
  dzisiejszy trening z Garmina (nazwa, rower, czas, poziom, efekt treningowy oraz profil interwałów:
  szerokość słupka to czas, wysokość to moc docelowa), uwaga o wczorajszym treningu zrobionym tylko
  częściowo, a na dole cały dzień jako pasek godzin z linią „teraz” (przeszłość zakreskowana, spotkania
  jako bloki, nakładające się w pasach, wydarzenia całodniowe nad paskiem). Dotknięcie treningu otwiera
  jego szczegóły z listą kroków, spotkania — szczegóły wydarzenia, „Kalendarz” — pełną agendę;
- po prawej limity AI jako pierścienie: zewnętrzny to okno 5h, wewnętrzny 7d, biała kreska pokazuje,
  ile czasu okna już upłynęło, a kolor (zielony / żółty / czerwony) mówi tylko, czy zużycie wyprzedza
  czas; pod pierścieniami procent i reset. „Podział zużycia” otwiera szczegóły z podziałem na źródła;
- gdy Cezar czeka lub pracuje, poczta ma wątki albo komputer przekroczył 90%, ich karty dochodzą pod
  limity, a pierścienie zwijają się do jednego rzędu; bez nich limity zajmują całą kolumnę.
  Cezar pokazuje najpierw zadania czekające na Ciebie (tytuł, projekt, pytanie), potem te w toku
  (aktywność, czas, testy); jedno zadanie to jedna linia, a obok poczty widać dwie pozycje i „i N więcej”.
  Poczta to lista nadawca / temat / początek wiadomości; przesunięcie w lewo oznacza przeczytane, w prawo kosz;
- na dole siedem najbliższych dni: plan treningowy (czas i poziom, ✓ przy wykonanym) razem
  ze spotkaniami; wydarzenia całodniowe z zasubskrybowanego kalendarza Garmin, które dublują trening,
  są pomijane.

Status treningu (wykonany / częściowo / nie zrobiony) wynika z nagrań z danego dnia, patrz Garmin Connect
powyżej. Dopóki źródło nie odpowie, pasek dnia i tydzień pokazują kreskę zamiast „wolne”.
Po 10 minutach bez dotyku (w nocy, 23–6, po 2) panel przechodzi w ciemny zegar: duża godzina, data i do czterech
linii tego, co się liczy (najbliższe spotkanie, trening, Cezar czeka, nieprzeczytana poczta). Obraz dryfuje o kilka
pikseli na minutę, a dotknięcie dowolnego miejsca budzi panel bez klikania w to, co pod spodem. Wyłącza go odznaczenie
„Zegar po bezczynności” w Ustawieniach; `?ambient=day|night` w adresie pokazuje go od razu.
W pasku u góry są dwa przyciski: księżyc / słońce przełącza dzień i noc (noc przyciemnia cały pulpit i zegar; bez
wyboru decyduje godzina 23–6, a ręczny wybór trwa do najbliższego świtu lub zmierzchu) oraz pełny ekran / wyjście z niego
(tylko tam, gdzie przeglądarka go udostępnia).
Poniżej 900 CSS px Pulpit przechodzi do jednej kolumny i przewija się jak strona. Zdarzenia panelu
(zwinięte: liczba i najnowsze z etykietą źródła, nowe rozwijają listę na 10 s) stoją w pasku u góry.

Gdy źródło nie jest świeże, sekcja pokazuje częstotliwość odświeżania, czas danych i osobno czas ostatniego
poprawnego pobrania przez panel, z dokładnością do sekund. Błąd nie przesuwa daty
ostatniego sukcesu. Świeżość jest sprawdzana względem bieżącego czasu renderu,
również gdy pomiar nadejdzie pomiędzy jednosekundowymi tickami zegara interfejsu.

Dotknięcie wiersza otwiera szczegół; osobny przycisk otwiera źródło. Widoczność sekcji
Pulpitu zapisuje się w localStorage (Ustawienia → Pulpit). Brak procentów postępu, ETA i danych dysku.

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
`calendar`, `calendarConnection`, `training`, `system`, `quotas`) dokładnie w kształcie API.
Czasy zapisuje się względem chwili zapytania: `"now"`, `"now-20m"`, `"now+1h30m"`
(ms, s, m, h, d). Dni kalendarzowe: `"today"`, `"today+2"`, `"today-1"` (data lokalna), a
`"today-1@22:10"` to ta godzina tego dnia. Scenariusze `training-*` pokazują dzień z interwałami,
po treningu, bez treningu i listę częściową. Zamiast odpowiedzi endpoint może mieć `{ "$error": 502 }` albo
`{ "$pending": true }` (ładowanie bez końca); brakujący endpoint odpowiada 503.
Plik jest czytany przy każdym zapytaniu, więc zmiany widać od razu, a błędy
kontraktu są zgłaszane ze ścieżką pola.

```powershell
just scenario offline                                  # UI na scenariuszu, adres w konsoli
just screenshots standard                              # output/screenshots/standard-*.png
just screenshots high-ram --pages pulpit,system --device medialove-14 --scale all
just screenshots standard --nav                        # keep the bottom navigation (hidden by default)
npm run scenario -- inbox --shot --query ambient=night # pierwszy ekran z zapytaniem w adresie (zegar nocny)
npm run scenario -- C:\temp\moj.json --shot           # dowolny plik
```

Ekrany pochodzą z `devices.json`: rozdzielczość fizyczna, przekątna, lista skalowań
Windows (pierwsze to główne) i dotyk. Rozmiar CSS, PPI i wartości do Chrome DevTools
(*Settings → Devices → Add custom device*) są wyliczane — `just devices` je wypisuje.
`--device <id>|all` (domyślnie pierwsze urządzenie) i `--scale <współczynnik>|primary|all`
wybierają ekrany; zrzuty mają fizyczną rozdzielczość, np. `standard-pulpit-medialove-14@1.5x.png`.
UI nie czyta tego pliku do układu — w Ustawieniach karta „Ekran” jedynie pokazuje,
któremu urządzeniu i skalowaniu odpowiada bieżący ekran.

### Monitor 14" (Secondary)

- **Identyfikator EDID**: P16 (producent YZA)
- **Rozdzielczość**: 1920 × 1080 @ 60 Hz
- **Pozycja**: X = 3440, Y = 0 (po prawej stronie głównego monitora)
- **Skala w Windows**: 150% (logiczny obszar roboczy 1280 × 720)
- **Orientacja**: Pozioma (Landscape)

Skrypt uruchamia Vite i API scenariusza na wolnych portach (nie dotyka usługi ani
prawdziwych źródeł). Te same pliki zasilają testy UI (`src/test-fixtures.ts`), a
`server/scenario.test.ts` sprawdza, że każdy z nich spełnia kontrakty.

## Zdarzenia

Zakładka „Zdarzenia” w dolnej nawigacji opisuje aktualne reguły w krótkiej tabeli:
warunek utworzenia oraz kiedy dany wpis może pojawić się ponownie. Pokazuje też
zasady zapisu historii i usuwania. Progi i czasy są współdzielone z detekcją zdarzeń.

Lista zdarzeń panelu rozwija się z „pigułki” na Pulpicie i przewija pionowo.
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

CI (`.github/workflows/check.yml`) przy każdym PR i pushu do `main` uruchamia
`npm ci`, testy i build na Ubuntu i Windows (tylko tam działa test DPAPI). Osobny
job robi zrzuty wszystkich scenariuszy i stron na urządzeniach z `devices.json`
(główne skalowanie, `standard` na wszystkich) i dołącza je do przebiegu jako
artefakt `screenshots-<commit>` (30 dni, około 27 MB), więc wygląd panelu można porównać
między commitami. W PR CI utrzymuje jeden komentarz z linkiem do
zrzutów najnowszego commita.


## Monitoring limitów AI (kontrakt V2)

Panel odczytuje `/panel/v2/quotas/live` z cezar-adapter przez istniejący prywatny
owner key. Po 404 wspiera starszy `/panel/v1/quotas/live`; przy innych błędach
zachowuje poprzednie dane jako offline. Wdrożenie: adapter przed panelem;
konfiguracja portu i usług nie zmienia się. Cezar nie wymaga aktualizacji.

Claude i Codex pokazują niezależne 5h/7d. Brak okna, wymagane logowanie i zachowany
stary pomiar mają osobne oznaczenia; reset nie tworzy sztucznego 0%. Panel pokazuje
czas pomiaru i próby, a szczegóły wyjaśniają powód. Świeża quota z nieznanym resetem
nadal jest pomiarem: nie rysujemy wtedy kreski tempa. AGY pokazuje dynamiczne
grupy/modelowe buckety subskrypcji, bez utożsamiania ich z Gemini API lub Vertex.
AGY bez wiarygodnego identyfikatora konta nie zachowuje historycznych grup po błędzie.

W **Ustawienia → Widoczność limitów AI** można ukryć każdą grupę zwróconą przez
AGY, w tym frontier i „Claude and GPT models”, oraz osobne limity Claude/Codex.
Grupy są dynamiczne, bez listy modeli w kodzie. Wybór zapisuje się w tej
przeglądarce, obejmuje pulpit i szczegóły, nie zmienia pomiarów. Nowe grupy są
domyślnie widoczne; ukryte grupy pozostają w ustawieniach, aby dało się je przywrócić.

W **Ustawienia → Warmup AI** są osobne przełączniki automatu Claude/Codex/Gemini i model.
Automat sprawdza stan co 30 s przez całą dobę: po potwierdzeniu zamkniętego okna
5h i braku aktywnej sesji CLI sam wysyła krótki warmup. Nie ustawia się godziny;
działa po kolejnych resetach, nie raz dziennie. Claude używa Haiku; Codex wymaga
podania modelu dostępnego w CLI. Krótkie, stałe prompty są pokazane w formularzu.
Przełącznik zaczyna obowiązywać po „Zapisz”; ustawienia trafiają przez backend
do owner-auth API adaptera, bez ujawniania klucza w przeglądarce. Zapis jest trwały,
działa bez restartu, nie uruchamia promptu i nie zeruje cooldownu. Już rozpoczęta
próba może się dokończyć. Stary/niedostępny adapter oznacza jawny brak ustawień.
Panel wymaga deklaracji `mode: on_reset` w statusie adaptera. Dawne pole `time`
jest ignorowane przez nowy adapter; zachowane są opt-in, model i cooldown.
Aktywny proces CLI (również bezczynny), brak wiarygodnych quota lub cooldown
mogą opóźnić próbę. Zmiana samego czasu zapisanego resetu nie uruchamia warmupu.

Każdy dostawca ma też przycisk **Uruchom warmup teraz**. Ręczne wywołanie używa
zapisanego modelu, działa przy wyłączonym automacie i jawnie wymusza próbę,
pomijając cooldown 5h oraz aktywne/już rozpoczęte okno. Nie zmienia ustawień
automatu ani nie resetuje lub zwiększa limitów dostawcy — wysłany prompt zużywa quota.
Gemini dotyczy wyłącznie grupy Gemini Models w Antigravity. Nadal obowiązują
kontrole modelu, sesji CLI, wiarygodności quota i blokada równoległych warmupów.
UI pokazuje trwanie próby oraz wynik; po błędzie można ponowić ręcznie.
Automatyczne próby nadal respektują dotychczasowe warunki i trwały cooldown,
także po ręcznej próbie zakończonej błędem.

`POST /api/quotas/warmup/:provider/run` wymaga tego samego Origin i JSON
`{"force":true}`. Backend wywołuje istniejący owner-auth endpoint adaptera
`POST /panel/v2/quotas/warmup/:provider` z `{"dryRun":false,"force":true}`.
Wymagana jest wersja adaptera obsługująca jawny tryb force; starszy adapter
zgłasza błąd, bez obchodzenia ograniczeń przez tymczasową zmianę ustawień.
Towarzysząca zmiana adaptera wraz z testami jest w
[cezar-adapter PR #24](https://github.com/metelskiwiktor/cezar-adapter/pull/24).
Desk Panel wymaga tej obsługi force po stronie adaptera; nie instaluje ani
nie wdraża jej automatycznie.
Zapis ustawień i odczyty quota/statusu nie wywołują warmupu. Ręczne wykonanie
ma osobny, pięciominutowy timeout na CLI i weryfikację; utrata odpowiedzi
nie potwierdza, że prompt nie został wykonany. Adapter zachowuje blokadę
do zakończenia próby.

Warmup jest kontrolowany w adapterze, domyślnie wyłączony. Nie jest
częścią pollingu UI. Status i ręczny dry-run: `npm run quota:warmup -- --status`
i `npm run quota:warmup -- Codex --dry-run` w katalogu istniejącej instalacji
adaptera. Wymaga jego prywatnej konfiguracji; skrypt nie startuje nowej usługi.
Opt-in, limity bezpieczeństwa i natywny warmup Claude na Windows przez ConPTY opisuje
[dokumentacja adaptera](https://github.com/metelskiwiktor/cezar-adapter/blob/feat/claude-warmup-windows/docs/claude-warmup-windows.md).

Weryfikacja: `just check`; `just screenshots quota-telemetry --pages pulpit
--device all --scale primary` sprawdza reauthentication, częściowy Codex i dynamiczne
AGY w istniejącym układzie. Screenshotów ani wyników lokalnych testów nie commitujemy.
Scenariusz `quota-settings` pokazuje nowe ustawienia i grupy jak na ekranie AGY:
`just screenshots quota-settings --pages pulpit,ustawienia --device all --scale primary`.
