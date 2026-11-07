# Pomiar użycia

Panel zbiera lokalnie dane o tym, jak długo i gdzie jest wyświetlany: fundament pod decyzję o pierwszej stronie nowego GUI.
Etap 1 (t-be2f1b56) to strony, pulpity, ambient, pełny czat i szczegóły. Etap 2 (t-01c8aa59) dodaje **ekspozycję obszarów**:
kafelków, limitów AI, zegara, stref dnia, chipów, powiadomień, nawigacji, sekcji Ustawień, treści podstron i szczegółów oraz
powłoki Wektora (opis niżej). Wnętrze Wektora (t-5b8f3c8b), liczniki akcji (t-eb618ffa) i epizody błędów (t-fbcda0d3) rozbudują ten
sam magazyn.

## Co jest mierzone

W każdej chwili liczy się **jeden główny widok** (`src/App.tsx`, `usageView`), w kolejności: ambient, pełny czat, szczegóły
(rodzaj: `task`, `event`, `quota`, `mail`, `workout`, `breakdown`, `system`), strona (`home`, `tasks`, …). Czat kompaktowy
i wskazywanie nie zastępują strony. Ukryta karta (`document.hidden`) wstrzymuje cały pomiar. Brak fokusu okna go nie wstrzymuje
(kiosk na drugim monitorze). Podgląd pionowy wstrzymuje pulpit pod spodem (`PollingContext`), mierzy tylko ramka.

- **Czas wyświetlania** (`ms`): pełny czas widoku, niezależny od interakcji.
- **Interakcja**: tylko zaufane zdarzenia przeglądarki: `pointerdown`, `keydown`, `wheel`, `touchmove`. Ruch wskaźnika, polling,
  przewijanie z kodu, odpowiedzi serwera i praca agentów jej nie liczą. Zapisywany jest tylko czas, nigdy treść ani klawisz.
- **Czas od ostatniej interakcji**: dla czasu po pierwszej interakcji sesji karty `ageIntegral` (s·s; średnia =
  `ageIntegral` / (`ms` − `noInteractionMs`) w sekundach) i `maxAgeMs`. Czas przed pierwszą interakcją sesji to osobno
  `noInteractionMs`. `visitsWithoutInteraction` liczy wizyty (od wejścia w widok do jego zmiany, ukrycia karty lub przerwy), w których
  nie było żadnej interakcji. Nie ma progu „aktywny/nieaktywny”.
- **Przerwa w obserwacji**: gdy między tykaniami zegara (co 5 s, `TICK_MS`) minie więcej niż 15 s (`GAP_MS`), np. po uśpieniu
  komputera, otwarty odcinek kończy się na ostatnim tyknięciu, a czasu przerwy nie doliczamy. Niewykrywalne przerwy
  i niezatwierdzony koniec odcinka po awarii przeglądarki są przyjętym ryzykiem (do 60 s najwyżej, tyle trwa bufor).
- **Kontekst**: widok, strona albo rodzaj szczegółów, **id** pulpitu (tylko na `home`, nigdy jego nazwa), losowe id przeglądarki
  (`localStorage`, `desk-panel.usage-browser`) i karty, rozmiar okna w krokach co 50 px. Zwykli klienci (także host Tailscale) są
  mierzeni tak samo; telefonu się nie wykrywa. Pulpit jest identyfikowany parą przeglądarka + id.

## Obszary (etap 2)

Obszar to oznaczony element strony (`data-usage-area`, lista zamknięta `USAGE_AREAS` w `src/usage-contract.ts`). Obszary mierzy się
**równolegle** i **osobno od głównych widoków**: czas obszaru nigdy nie wchodzi do `byView`, `byHour` ani `byPulpit`.

- **Widoczność** (`src/usage-dom.ts`, `isExposed`): obszar jest wystawiony, gdy jakakolwiek jego część jest w oknie (w podglądzie
  pionowym: w widocznym wycinku ramki), nie jest przycięta i nie jest w całości zakryta. Widoczną część sprawdza siatka 5×5 punktów
  przez `document.elementsFromPoint`; pierwszy punkt, w którym wierzchnim elementem (z pominięciem warstw `data-usage-dim`) jest
  obszar, wystarcza. Zwinięty (`display:none`, rozmiar 0, praca zwinięta w miesiącu), poza ekranem, w całości pod pełnym czatem
  albo oknem, w ukrytej karcie albo na wstrzymanym hoście obszar nie dostaje czasu. Częściowe zakrycie (kompaktowy czat, popover)
  nie pauzuje, przyciemnienie (`data-usage-dim` na tle okien dialogowych) też nie. Strona patrzy co 1 s (`SCAN_MS`) i od razu
  po zmianie widoku lub strony; czas obszaru jest liczony między dwoma spojrzeniami.
- **Podgląd pionowy**: host (`TabletPreview`) wysyła ramce co sekundę, przy przewijaniu i na jej prośbę wycinek, który pokazuje jego
  przewijane okno (`desk-panel:preview-viewport`, same-origin); ramka mierzy te same obszary tylko w tym wycinku, host pod spodem
  jest wstrzymany. Podgląd nie jest osobnym rodzajem obszaru ani nie ma osobnego oznaczenia.
- **Interakcja** (te same zaufane zdarzenia co w etapie 1) trafia tylko do najbliższego obszaru zawierającego cel zdarzenia
  (klawiatura: element z fokusem), nie zeruje obszarów nadrzędnych ani sąsiednich; zdarzenie poza obszarami nie trafia do żadnego,
  a obszar niewystawiony jej nie przyjmuje. Miary jak w etapie 1 liczone **osobno dla obszaru** (`AreaMeter`, `src/usage-areas.ts`: jeden
  `UsageMeter` na obszar): pierwsza interakcja i czas od ostatniej dotyczą obszaru w sesji karty; pauza nie nalicza ekspozycji, a
  czas od ostatniej interakcji płynie zegarowo i przeżywa pauzę. Każde wejście w obszar po pauzie to nowa wizyta.
- **Tożsamość**: odcinek ma `area`, `page` (strona pod spodem) i `pulpit` (tylko na `home`), dla kafelka `kind` + `tile` (id
  kafelka: dwa kafelki Zadań to `todo#1`, `todo#2`), dla szczegółów `source` (rodzaj kafelka, z którego kliknięto, tylko gdy wejście
  było z kafelka; z chipa, dzwonka czy czatu pole zostaje puste), dla powłoki Wektora `chat` (`full`, `compact`, `pointing`).
  Kafelek identyfikuje przeglądarka + pulpit + id. Limity AI mają techniczne id (`claude`, `codex`, `agy-` i skrót grupy;
  `src/usage-ids.ts`), bez nazw od dostawcy. Żadnych identyfikatorów rekordów (zadań, maili, rozmów, wydarzeń) ani tekstu.
- **Pokrycie i granice**: pasek dnia ma cztery obszary (data, trening, spotkania, odliczanie; w trybie kompaktowym chipy
  treningu i spotkań); dolna strefa dni (`days`); `chip-pc`, `chip-cezar`, `chip-gmail`; `bell` i `notifications` (lista);
  `clock` (zegar w pasku) i `ambient`; `nav`, `pulpits` (menu); `page-tasks|calendar|system|events|automations` (treść podstrony,
  element `main`) i `detail-*` (siedem rodzajów szczegółów, ten sam element `main`); sekcje Ustawień `settings-*`; `tile`; `wektor`
  (jedna powłoka, tryb jako kontekst). Puste komórki siatki, wnętrze Wektora i pojedyncze rekordy nie są obszarami. Obszary
  zagnieżdżone (np. `notifications` w `bell`-owym kontenerze, sekcje w stronie Ustawień) są mierzone oba, a interakcja trafia do
  najbliższego.

## Dane i zapis

Przeglądarka tnie czas na **odcinki** (`src/usage-meter.ts`, czysta klasa z wstrzykiwanym zegarem): przy zmianie widoku,
na granicy każdej pełnej godziny (godziny epoki są pełnymi godzinami także w Europe/Warsaw), przy przerwie i co 60 s
(`FLUSH_MS`, także przy ukryciu karty i zamknięciu przez `fetch` z `keepalive`). Niewysłane odcinki czekają (do 500) i są
ponawiane. `POST /api/usage` (Origin-checked, loopback albo host Tailscale, do 100 odcinków) przyjmuje wyłącznie odcinki
zgodne ze ściśle zwalidowanym schematem `src/usage-contract.ts`: stałe enumy, losowe id i liczby, żadnych pól tekstowych.
Odcinek starszy niż 48 h lub z przyszłości jest odrzucany.

Magazyn (`server/usage.ts`) jest w `~/.desk-panel/usage`, poza Gitem, bez szyfrowania DPAPI (nie ma tu sekretów ani treści):

| Plik | Zawartość | Retencja |
| --- | --- | --- |
| `details-RRRR-MM-DD.ndjson` | przyjęte odcinki dnia (Europe/Warsaw) | 90 dni (`DETAIL_DAYS`), czyszczone przy starcie i co 6 h |
| `summary-RRRR-MM-DD.json` | sumy godzinowe dnia i liczba bajtów dziennika, które obejmują | bezterminowo |

Obszary to osobny rodzaj rekordu w tym samym magazynie: `POST /api/usage` przyjmuje `{ slices, areas }` (razem do 100, co najmniej
jeden; odpowiedź dla `slices` bez zmian, przy `areas` dochodzi klucz `areas`), a `server/usage.ts` zapisuje je w
`areas-details-DATA.ndjson` i `areas-summary-DATA.json` (retencja i odbudowa jak wyżej). Kolejka przeglądarki mieści 2000 odcinków
(równoległych obszarów jest kilkanaście, więc ok. kilkaset odcinków na godzinę), co minutę wysyła do 5 paczek po 100. Stara
historia (pliki bez `areas-`) czyta się jak dotąd.

Odcinek ma unikalne id (`sesja:numer`), więc ponowna wysyłka nie podwaja sum. Sumy dnia powstają z dziennika: podsumowanie
niezgodne z dziennikiem (awaria między zapisami) jest przebudowywane przy następnym odczycie lub zapisie, a przed usunięciem
dziennika podsumowanie jest zapisane. Awaria zapisu daje `503` na ten jeden `POST` i nie wpływa na panel; przeglądarka ponawia.

**Izolacja**: tylko usługa (`server/index.ts`) dostaje magazyn. Serwer scenariuszy, podglądy PR i testy nie przekazują
`usage`, więc `POST /api/usage` przyjmuje i porzuca dane (`204`), a prawdziwa historia nie jest dotykana.
Wyłączenie: nie ma osobnego przełącznika; pomiar nie jest uruchamiany bez `UsageSinkContext` (`src/main.tsx`).

## Odczyt i eksport

`just usage-export [OD] [DO]` (daty `RRRR-MM-DD`, domyślnie ostatnie 7 dni; `node scripts/usage-export.mjs`) czyta z działającej
usługi `GET /api/usage/summary?from=&to=` (tylko loopback, nigdy przez host Tailscale) i drukuje JSON:
`rows` (godzina po godzinie: `date`, `hour`, `browser`, `view`, `page`/`detail`, `pulpit`, `ms`, `entries`,
`visitsWithoutInteraction`, `noInteractionMs`, `ageIntegral`, `maxAgeMs`) oraz zbiorcze `byView`, `byHour`, `byPulpit`
(`przeglądarka/id pulpitu`, tylko `home`) ze średnim czasem od interakcji w sekundach (`meanAgeS`). Dni i godziny są w Europe/Warsaw.
Wektor nie ma do tego narzędzia MCP.

Obszary są osobnym zbiorem w tym samym wyniku i nie wchodzą do sum powyżej: `areaRows` (godzina po godzinie: `date`, `hour`,
`browser`, `area`, `page`, `pulpit`, `kind`, `tile`, `source`, `chat`, `ms`, `entries`, `visitsWithoutInteraction`,
`noInteractionMs`, `ageIntegral`, `maxAgeMs`), `byArea` (`tile:<rodzaj>` albo obszar), `byAreaHour` (`GG/obszar`) i `byAreaTile`
(`przeglądarka/pulpit/id kafelka`, tylko kafelki), każdy ze średnim czasem od interakcji `meanAgeS`. Czasy obszarów nakładają
się w czasie: ich suma w godzinie może przekroczyć godzinę.

Przykład porównania: `byHour` pokazuje, w których godzinach panel jest wyświetlany; `byView` ile czasu spędza ambient, czat,
szczegóły i każda strona; `byPulpit`, który pulpit jest otwarty najdłużej.

## Katalog pokrycia

| Pomiar | Wspólny dla wszystkich | Tylko w danej funkcji |
| --- | --- | --- |
| Czas widoku, wejścia, interakcje | strony, pulpity, ambient, pełny czat, szczegóły | — |
| Ekspozycja i interakcje obszarów (równolegle, osobno od widoków) | kafelki i limity AI, zegar, ambient, pasek dnia (data, trening, spotkania, odliczanie), dolna strefa dni, chipy PC/Cezar/Gmail, dzwonek i lista, nawigacja, menu pulpitów, sekcje Ustawień, treść podstron, szczegóły (z kafelkiem źródłowym), powłoka Wektora (tryb jako kontekst) | wnętrze Wektora: t-5b8f3c8b; liczniki akcji: t-eb618ffa |
| Błędy i niedostępność | — | t-fbcda0d3 |

## Testy

`src/usage-meter.test.ts` (przebieg z kontrolowanym zegarem), `server/usage.test.ts` (restart, ponowne przyjęcie, retencja,
awaria zapisu, brak treści, rekordy obszarów i zgodność ze starą historią), `server/usage-route.test.ts` (trasa) (izolacja
scenariusza, Origin). Obszary: `src/usage-areas.test.ts` (równoległy czas, pauza, niezależny czas od interakcji, brak wpływu na
główne widoki, ścisły kontrakt), `src/usage-dom.test.tsx` (widoczność: zwinięcie, poza ekranem, zakrycie pełne i częściowe,
przyciemnienie, wycinek podglądu; źródło szczegółów; techniczne id; równoległy czas w stronie z zegarem).

`just usage-ui` (`scripts/usage-ui.ts`, ok. 2 min) to przebieg Playwright na prawdziwych zdarzeniach przeglądarki, na
magazynie w katalogu tymczasowym (`startScenario(..., usage)`; zwykłe scenariusze magazynu nie dostają): równoległa ekspozycja,
kółko myszy nad jednym kafelkiem, pełny i kompaktowy czat, ukryta karta, miesiąc zwijający kafelki, strony i sekcje Ustawień,
podgląd pionowy z przewijaniem. Nie jest częścią `just check` (jak `just wektor-ui`).

## Znacznik przyszłego okna

Kafelek limitu AI pokazuje, gdzie okno będzie o następnej 10:00 (czas lokalny): niebieska przerywana kreska na pasku i podpis
`jutro 10:00 · 62,5%` obok `reset za …`. Prognoza liczy się z nominalnej długości okna i terminu resetu; okno kończące się
przed 10:00 nie dostaje kreski ani podpisu. To pomoc w planowaniu, nie osobny pomiar.
