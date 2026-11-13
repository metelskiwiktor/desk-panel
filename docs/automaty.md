# Automaty Wektora

Cykliczne i jednorazowe zadania panelu, które sam się budzą i wykonują sprawdzenie w rozmowie automatu. Zastępują dawne
obserwatory (`panel_observe`): jeden model, jeden zapis, jeden widok. Stare `~/.desk-panel/observers.json` jest migrowane
jednorazowo, wyłącznie gdy `automations.json` nie istnieje, bez utraty wpisów (także zakończonych). Po atomowym zapisie
nowego magazynu z `migratedFrom: "observers.json"` źródło zmienia nazwę na `observers.json.migrated`.
Nieczytelny magazyn nie uruchamia migracji: panel odkłada go jako `<plik>.corrupt-<czas>`, tworzy trwałą blokadę
`automations.json.blocked` i pokazuje pustą listę z wyjaśnieniem (API, widok Automaty i MCP). Nie wykonuje ani nie zapisuje
automatów, także po następnym restarcie. Uszkodzone źródło migracji również blokuje wykonanie i zapis zamiast finalizować
pustą migrację. Odzyskanie wymaga ręcznego przywrócenia poprawnego magazynu/źródła i usunięcia `.blocked` po sprawdzeniu
stanu; panel nie rekonstruuje go ze starego pliku sam.

Następcą jest Machina: programy z klocków wykonywane przez panel bez tury modelu, sekcja „Machina” na końcu.

## Model

Kontrakt: `src/automation-contract.ts` (zod, wspólny dla serwera i UI). Zapis: `~/.desk-panel/automations.json`, atomowo
(tmp + rename), poza Gitem.

- `id` `a-…`, `name`, `goal` (polecenie użytkownika słowo w słowie), `trigger`, `status`
  (`active | paused | done | expired | cancelled`), `doneWhen?`, `notebook` (Markdown do 4000 znaków), `learn` (czy run
  może zmieniać notatnik), `actions`, `chatId` (rozmowa, w której automat powstał), `createdAt`, `nextRunAt?`,
  `lastRunAt?`, `runs` (ostatnie 100).
- Wyzwalacz: `{kind:'once', at}` (epoch ms), `{kind:'daily', times:['7:00','19:00'], from?, until?}`,
  `{kind:'weekly', weekday:1–7, times, from?, until?}`, `{kind:'cezar', taskId}`, `{kind:'pr', url}`. Strefa
  `Europe/Warsaw`; `from`/`until` to daty lokalne `YYYY-MM-DD`. Cykliczny bez `until` kończy się po 90 dniach.
  `times` to od 1 do 6 unikalnych pór `H:MM`/`HH:MM`. Walidacja idzie przed porządkowaniem: duplikat po normalizacji
  (`07:00` = `7:00`) i więcej niż 6 wpisów są odrzucane, dopiero potem lista jest sortowana i zapisywana w jednej
  kanonicznej formie (`times` bez wiodącego zera). Stary zapis i stara propozycja z jednym `time` są nadal ważne:
  parsowanie zamienia je na `times: [time]` w jednym miejscu, bez przepisywania pliku przy samym odczycie (zapis przy
  odczycie zdarza się tylko wtedy, gdy migracja `observers.json` naprawdę nastąpiła w tym odczycie).
  Jedna pora to `times` z jednym wpisem; kilka pór dnia należy do jednego automatu, nie do kilku.
- Akcje: lista obiektów `{kind, …}`; `message`, `calendarEvent {domain?}`, `smartAction {domain?}` i `notify {domain?}` (parametry i ograniczenia poniżej).
- Run: `id` `run-…`, `at`, `chatId` (rozmowa runu), `outcome` (`not-yet | done | error | skipped`), `summary` (1–2
  zdania), `notebookChanged`, `previousNotebook?`, `costUsd?`, `seconds?`.
- Limity: 20 aktywnych automatów; daily/weekly może mieć do 6 pór dnia/tygodnia (jeden automat, jedna historia i
  notatnik); `once` jak dawne obserwatory czasu.

## Wykonanie runu

- Runy automatów wykonują się po jednym w całym panelu: trwała kolejka `pending` i rezerwacja `execution`
  obejmują tick, callbacki Cezara, PR-y i ręczne uruchomienia. Raport lub anulowanie automatu nie zwalnia slotu:
  następny run czeka do końca tury Hermesa. Czas 15 minut liczy się dopiero od próby wysyłki, nie podczas oczekiwania w kolejce.
- Zegar (`server/automations.ts`) chodzi co minutę tylko wtedy, gdy są aktywne automaty. Jeden tick naraz (serializacja),
  po każdym odczycie PR stan jest sprawdzany ponownie, a wspólny cache PR (`createPrReader` w `server/github.ts`) jest ten
  sam co w kokpicie. `nextRunAt` to najbliższa z pór `times` (dla weekly także właściwy dzień), zawsze z uwzględnieniem
  `from`/`until`. Następny run liczy się od pory, dla której run był (albo od jego startu, nie od chwili zakończenia), więc
  pora, która minęła w trakcie trwającego runu, jeszcze wykona się raz. Po restarcie zaległy run startuje najwyżej jeden na
  tick: pominięte pory nie kumulują się i nie dublują runu, a dwie bliskie pory nadal wykonują się kolejno, po jednym runie.
- Run jest rezerwowany na dysku (`pending`) przed wysyłką, z trwałymi `chatId` i `turnId` (nonce). Hermes-chat zapisuje
  turę i dokładne żądanie przed POST-em do Hermesa. Nonce jest `Idempotency-Key` tego POST-a: po utracie odpowiedzi
  restart ponawia zamrożone żądanie z tym samym kluczem i odzyskuje istniejący przebieg zamiast drugiego wykonania.
  Istniejąca rozmowa z tym nonce jest odzyskiwana. Wymagane jest trwałe wsparcie idempotencji w przypiętym Hermesie. Dostawa jednego `pending` ma wspólną blokadę, więc callback Cezara i tick nie wyślą go dwa razy.
- Ostatnie wystąpienie daily/weekly w dniu `until` jeszcze się wykonuje; dopiero raport `not-yet` wygasa automat. Po zmianie
  czasu (np. 02:30 w marcową noc) kolejne dni wracają do godziny z harmonogramu; godzina nieistniejąca danego dnia ląduje
  na najbliższej istniejącej. Przy kilku porach dnia wybierana jest najwcześniejsza jeszcze przyszła pora, więc skok DST
  przy jednej porze nie przykrywa wcześniejszej innej pory tego dnia.
- Run cykliczny = nowa rozmowa Hermesa (zawsze Hermesa, niezależnie od zapisanego preferowanego silnika; świeży kontekst), tytuł `Automat · <name> · <data>`, oznaczona jako tura
  automatyki (`automation.source = 'automation'`). Treść: cel, warunek celu, notatnik, ostatnie 5 runów, zatwierdzone
  akcje i polecenie wykonania sprawdzenia oraz wywołania `panel_automation_report` na końcu.
- Run jednorazowy (once/cezar/pr) wraca do rozmowy automatu (`chatId`), jak dawne obserwatory.
- Run jest otwarty tylko podczas własnej tury: tej, którą panel uruchomił dla niego. `pending` i historia runu trzymają
  rozmowę, panelowe `turnId` i natywne `hermesRunId`. `panel_automation_report {runId, token, outcome, summary, notebook?}`
  przyjmuje raport tylko przy zgodnym jednorazowym żetonie (128 losowych bitów hex, porównanie w czasie stałym)
  i nadal trwającej turze o zapisanych chatId, turnId i hermesRunId. Panel nadaje żeton przy rezerwacji, zapisuje go
  trwale i przekazuje wyłącznie w treści tej tury. Sam runId bez żetonu nie wystarcza. `outcome:
  done` kończy cel i harmonogram; `notebook` podmienia notatnik tylko przy `learn = true`, a poprzednia wersja zostaje w
  runie. Koniec tury (`done/error/cancel`) bez raportu natychmiast zapisuje `error`: „Tura zakończona bez raportu.”.
  Późniejsza tura w tej samej rozmowie już go nie przyjmie. Limit 15 minut zostaje jako zabezpieczenie, gdy koniec tury
  nie dotrze, także przy niepewnym przyjęciu wysyłki.
- Gdy run kończy się `done` albo `error`, panel wysyła krótką wiadomość automatyki (`message`) do rozmowy automatu
  (`chatId`). Wiadomość czeka, gdy rozmowa jest w trakcie tury. Błąd przejściowy (409, 503, sieć) zostawia ją w outboxie
  do następnego ticku (z kluczem deduplikacji, więc nie wyjdzie dwa razy); trwały błąd, np. usunięta rozmowa, porzuca ją
  z logiem.
- `DESK_AUTOMATIONS=0` (albo false/no/off): zegar nic nie uruchamia, tworzenie i raportowanie odmawiają, lista działa.

## Narzędzia Wektora

- `panel_automation_propose {name, goal, trigger, doneWhen?, actions, learn, replaces?}` — karta „Nowy automat”. Dla
  `daily`/`weekly` `trigger` ma `times` (1–6 pór dnia; jedna pora to tablica z jednym wpisem), więc „rano i wieczorem”
  to jeden automat, nie dwa. Stary kształt z `time` nadal się parsuje. Zapis
  dopiero po kliknięciu: `POST /api/chats/:id/automation` (Origin-checked); plan jest czytany z wywołania narzędzia w tej
  rozmowie, żądanie może tylko zawęzić plan: odznaczyć akcje i wyłączyć `learn` (włączyć się nie da). Karta ma stałe id
  liczone z planu, więc działa na żywo i po odświeżeniu. Dla pojedynczej pory stary kształt `time` daje ten sam hash co
  przed zmianą, więc karta zatwierdzona wcześniej nadal znajduje swoją decyzję i nie tworzy drugiego automatu.
  `replaces: <id>` aktualizuje istniejący automat na miejscu: id, chatId, createdAt, runy i notatnik zostają.
  Zmienia nazwę, cel, harmonogram, akcje i learn oraz podany warunek celu (pominięty zostaje bez zmian). Aktywny pozostaje aktywny,
  wstrzymany pozostaje wstrzymany. Zakończony, wygasły i anulowany odmawiają zmiany: trzeba zaproponować nowy automat bez replaces.
  Aktualizacja nie zużywa miejsca w limicie 20 aktywnych, także gdy zmieniany automat jest wstrzymany.
  Karta „Zmienić automat?” pokazuje obecną nazwę i tylko zmienione pola przed → po (harmonogram słownie, akcje etykietami),
  z przyciskami „Zapisz zmiany” / „Odrzuć”. Zapis zatwierdzonej karty zachowuje też podgląd sprzed zmiany.
  nextRunAt jest przeliczany z harmonogramu, nie wcześniej niż teraz; pominięty zakres dat cyklu zachowuje poprzedni zakres.
  Trwający lub oczekujący run zachowuje rezerwację, turę i zamrożone ustawienia (także learn). Akcja musi jednak mieścić się również w aktualnej zgodzie: usunięcie akcji, pauza i anulowanie blokują nowe wykonanie od razu. Rozszerzenie zgody obejmuje dopiero następny run. Ustawienia runu są zapisywane razem z rezerwacją i przeżywają restart.
  Każda faktyczna zmiana ustawień zapisuje `changes: [{at, by: 'user'|'agent', fields: {pole: {before, after}}}]`
  w tym samym atomowym zapisie co rekord (ostatnie 50; brak poprzedniej wartości jako null). Zgoda na karcie to `user`,
  bezpośrednia zmiana przez narzędzie Wektora to `agent`. Starsze rekordy mają pustą historię. Decyzja karty (utworzony automat albo
  odrzucenie) trafia do `~/.desk-panel/cockpit.json` po `toolCallId`, jak odpowiedzi kart banku i Smart Actions: drugie
  kliknięcie nic nie tworzy, a po przeładowaniu karta pokazuje „Utworzono automat …” albo „Zaktualizowano automat …” z linkiem do widoku Automaty.
  Zastąpienie starszej propozycji nowszą jest sprawdzane ponownie w sekcji krytycznej tworzenia, po odczytach Cezara/PR
  i przed zapisem; karta już rozstrzygnięta zwraca zapisaną decyzję, a 409 dostaje tylko niezdecydowana zastąpiona karta.
- `panel_observe {create|list|cancel}` — bez karty, zapisuje jednorazowy automat (`once`/`cezar`/`pr`) w rozmowie, w której
  trwa tura.
- `panel_automations {id?}` — lista albo szczegóły (runy, notatnik) do analizy.
- `panel_automation_update {id, pause|resume|cancel|runNow, notebook?, name?}` — bez karty, na wyraźną prośbę. Zmiana celu, warunku celu, nazwy, learn,
  akcji albo harmonogramu to karta `panel_automation_propose` z `replaces`.
- `panel_automation_report {runId, token, …}` — tylko w runie o tym `runId`, w bieżącej turze jego rozmowy.

## UI

Widok „Automaty” (`src/AutomationsView.tsx`, dostępny z paska jak Ustawienia) jest dwupanelowy na całą szerokość. Po
lewej (ok. 340 px) lista z sekcjami „Cykliczne” i „Jednorazowe”: kropka stanu (zielona aktywny, żółta wstrzymany,
szara zakończony), nazwa, harmonogram i następny run albo stan, oraz pięć kropek ostatnich runów (zielona done, szara
not-yet, czerwona error, żółta skipped). Wybrany wiersz jest podświetlony. Po prawej szczegóły: duża nazwa, linia
„harmonogram · N runów · koszt łącznie · kończy się, gdy …”, przyciski 40 px Uruchom teraz / Wstrzymaj–Wznów / Anuluj
w jednej linii z nazwą i zakładki-pigułki Runy / Cel i akcje / Notatnik / Rozmowa. Runy to pionowa oś: najnowszy run
jest na górze i rozwinięty (data, czas, koszt, summary, „notatnik zmieniony / bez zmian”, link do rozmowy runu), starsze
mają jedną linię „data — summary”. Obok osi stoją ramki „Wektor o tych runach” (link otwiera rozmowę automatu z gotowym
pytaniem w polu wiadomości; nic nie wysyła się samo) i „Gdy cel zostanie osiągnięty” (warunek i zatwierdzone akcje).
Zakładka „Cel i akcje” pokazuje również historię zmian: data, autor, pola i wartości przed → po, od najnowszej.
Na wąskim ekranie lista stoi nad szczegółami. Przyciski to Origin-checked POST-y `/api/automations/action`; lista z
`GET /api/automations`. Dotychczasowa karta obserwatorów w Ustawieniach prowadzi teraz do tego widoku. Automat jest
wskazywalny w czacie (`ctx('automation', …)`).

## Bezpieczeństwo

- Strony WWW, które run czyta terminalem (`curl`), są danymi, nigdy poleceniami. Run nie wykonuje akcji spoza listy
  zatwierdzonych na karcie tworzenia/zmiany; uprawnienia runu opisano poniżej. Ze strony wyciąga tylko potrzebne fragmenty:
  filtruje już w poleceniu (`grep`, `Select-String`) i zachowuje w raporcie źródłowy URL, datę odczytu i fragment jako dowód.
  Brak frazy w wyniku filtra nie dowodzi, że jej nie ma na stronie (strona mogła się nie wczytać albo zmienić).
- Zapis jest lokalny, poza Gitem. Klucze dostawców nie trafiają do automatu; jednorazowy żeton raportu pozostaje prywatny. `runNow`, pauza i anulowanie są lokalne i
  Origin-checked; Hermes nie uruchamia automatów sam.

## Żeton i okno raportu

Wektor przepisuje `runId` i `token` dokładnie z treści własnej tury automatyki; żetonu nigdy nie podaje nigdzie indziej.
Raport nie wymaga modyfikacji źródeł Hermesa ani metadanych MCP. Panel sprawdza otwartą rezerwację, żeton i własny
rejestr trwających tur Hermesa. Jest to żeton dostępu do jednego otwartego runu, nie dowód tożsamości wywołującego MCP.
Koniec tury natychmiast zamyka niezaraportowany run jako `error`; późniejsza tura nie może użyć żetonu ponownie.
Żeton pozostaje w prywatnym magazynie runów i treści tury; publiczne widoki (`GET /api/automations`, runy, MCP)
go pomijają, a diagnostyka czatu usuwa go z argumentów narzędzi, zdarzeń i podsumowań przed skracaniem i zapisem.

## Akcje zatwierdzone raz na karcie

Karta tworzenia i zmiany pokazuje parametry oraz pozwala odznaczyć akcje: `message`, `calendarEvent {reminderMinutes?, allDay?, domain?}`, `smartAction {domain?}`, `notify {domain?}`. Odznaczenie wyłącznie zawęża; serwer bierze parametry oryginalnej propozycji. Run zamraża zatwierdzoną listę w chwili startu. Każda akcja wymaga obecności w tej liście i w aktualnej zgodzie. Aktualna domena może pozostać taka sama, zawęzić się do subdomeny albo zostać usunięta (bez linków); przypomnienie i allDay muszą być identyczne (pominięte oznaczają odpowiednio 60 i false). Pauza i anulowanie blokują act. Brak automatu daje 404. Jednorazowy automat z tymi akcjami także wymaga karty (panel_observe pozostaje tylko wiadomością).

Gdy cel spełniony, Wektor najpierw wywołuje `panel_automation_act {runId, token, action, title, when?, url?, text?}`, potem raport `done`. Obowiązują otwarty run, zgodny żeton i trwająca własna tura Hermesa, jak przy raporcie. `DESK_AUTOMATIONS=0` blokuje także akcje. Każdy rodzaj najwyżej raz na run, również przy równoległych wywołaniach; rezerwacja zapisana przed efektem. Powtórzenie zwraca migawkę zapisanego wyniku (także pending, gdy pierwsze wywołanie jeszcze trwa). Po awarii w trakcie efektu stan `pending` oznacza wynik niepotwierdzony i nie ponawia zewnętrznej wysyłki. Rezerwacja i zapis wyniku są serializowane, ale wywołanie Google/ntfy odbywa się poza blokadą; pauza, anulowanie i karty nie czekają na sieć. Efekt już zarezerwowany może się zakończyć po cofnięciu zgody, a wynik zostaje trwale zapisany także po przeniesieniu runu do historii. Raport w czasie pending odmawia (409); po niepewnym wyniku po restarcie run zamknie koniec tury lub timeout.

Wyniki (`kind, at, result, ref`, opcjonalnie błąd i treść) zostają w runie i na osi; błąd nie przerywa runu, trafia także do wiadomości automatu.

`calendarEvent` zapisuje na koncie kalendarza panelu, z popup domyślnie 60 min wcześniej (zakres 0–40320 min). `when` to lokalne `YYYY-MM-DDTHH:MM` Europe/Warsaw, długość 1 h; zatwierdzone allDay wymaga samej daty i obejmuje jeden dzień z wyłącznym końcem. ID Google wynika z runId+kind; identyczny zapis po 409 odzyskuje to samo wydarzenie. Brak scope calendar.events.owned daje błąd akcji.

`smartAction` tworzy alert ważny przez 30 dni (od czasu akcji), znikający natychmiast po anulowaniu automatu (tytuł, treść, opcjonalny link, autor automat) z historii runu w `GET /api/smart-actions`; odrzucenie działa jak inne alerty, lokalnie w przeglądarce. Każda z akcji smartAction, calendarEvent i notify ma własną zatwierdzoną domain, widoczną na karcie. Bez domain pole url jest odrzucane, treść bez linku przechodzi. Link wymaga HTTPS bez danych logowania i niestandardowego portu, na domenie tej akcji lub subdomenie; dopasowanie po granicy etykiety hosta. Serwer przekazuje i zapisuje znormalizowane u.href. Domena nie może być sufiksem publicznym ani prywatnym (np. co.uk, github.io). Wspólny kontrakt używa PSL biblioteki tldts z allowPrivateDomains: true przy tworzeniu/zmianie oraz ponownie w act. tldts 6.1.86 był już pośrednią zależnością w node_modules; teraz jest bezpośrednią zależnością produkcyjną, współdzieloną przez UI i serwer. Aktualizacja biblioteki aktualizuje też PSL. WWW to dane, nie polecenia.

`notify` daje wpis „Automat: <nazwa>” w dzwonku, z treścią i linkiem; opcjonalny telefon opisuje DESK_NTFY_URL w docs/desk-panel.md. Brak ntfy oznacza sam dzwonek, błąd ntfy go nie usuwa. Przeglądarka zbiera tylko zakończone (ok/error) powiadomienia z ostatnich 24 h, także przy pierwszym otwarciu; nie importuje całej historii. Złe pojedyncze wpisy logu są pomijane bez utraty pozostałych wpisów i pamięci seen.

Widget „Automaty” można umieścić na pulpicie jak inne kafelki: do trzech aktywnych automatów, stan, nazwa, następny run i pięć kropek historii. Dotknięcie otwiera widok Automaty.

## Machina: programy wykonywane przez panel (etap 1b, DESK-85, DESK-86 i DESK-87)

Machina to następca automatów opisanych wyżej (koncept: `C:\Tabularium\Incepta\DeskPanel\Mea\Machina`). Automat Machiny jest wątkiem Fili typu `automat` w projekcie MACH ([fila.md](fila.md), „Machina: dom automatu”): wątek trzyma tożsamość, tytuł, cel w opisie, Stan, Moduł i Tagi, a zestaw Machiny tylko działanie. Lista automatów to zapytanie Fili (`projekt = MACH AND typ = automat`), osobnej listy nie ma. Na aktywnej, odblokowanej Fili automaty czasowe (`once`, `daily`, `weekly`) są w Machinie (przejście DESK-87, niżej); w `automations.json` zostają obserwatory Cezara i PR (do etapu 2) oraz historia przeniesionych automatów. Silnik i jego kontrakty to DESK-85; sytuacje, ocena i naprawa przez Wektora, karty w czacie i narzędzia Wektora to DESK-86 (niżej, „Sytuacje, ocena i naprawa”). Wygląd kart i kokpitu ustala pictor; backend udostępnia zachowanie.

| Co | Plik |
| --- | --- |
| kontrakt: klocki, wersja programu, dziennik, karta, akcje użytkownika | `src/machina-contract.ts` |
| silnik: karta, zegar, run, Stany | `server/machina.ts` |
| publiczny odczyt URL, tekst strony, wycinek | `server/machina-fetch.ts` |
| wpis panelu w rozmowie bez tury | `ChatService.note` (`server/hermes-chat.ts`) |
| narzędzia Wektora `panel_machina*` | `server/panel-mcp.ts`, opisy w `COCKPIT_TOOLS` (`src/cockpit-contract.ts`) |
| karty w czacie i kokpit rozmowy | `POST`/`GET /api/chats/:id/machina` (`server/chat-routes.ts`), odpowiedzi kart w `cockpit.json` (`machinaCards`) |

**Zestaw** (cztery części z `GET /api/fila/threads/ID/machina`, zapis wyłącznie przez `FilaStore.machina`):
- `program`: `{ current, versions[], nextRunAt, chatId, paused? }`. Wersja: `{ number, at, by: user|wektor|panel, reason, trigger, blocks, scope, reactions, restoredFrom? }`; wersji się nie usuwa ani nie zmienia. `reactions` to `{ idSytuacji: klocki akcji }` (pusta lista: nic nie rób). `chatId` to rozmowa, z której automat powstał.
- `journal`: `{ runs[] }`, tylko dopisywany. Run: `{ id: mr-…, slot, manual, version, startedAt, endedAt?, state: running|evaluating|waiting|ok|error, error?, blocks[], chatId?, costUsd? }`; wynik klocka: `{ id, kind, at, result: ok|error|pending|waiting|skipped, error?, text?, links?, url?, title?, ref?, when?, situation?, card? }`. `evaluating`: trwa tura oceny Wektora; `waiting`: run czeka na kartę nowej sytuacji (decyzja i reakcja dopisują się później do tego samego runu).
- `conversations`: `{ items: [{ chatId, reason: projektowanie|zmiana programu|ocena|naprawa|utworzenie bez karty, at, runId? }] }`; jedna pozycja na rozmowę.
- `situations`: `{ items[], pending[] }`. Sytuacja: `{ id: s-…, name, note?, createdAt, samples[], withdrawn? }`, próbka: `{ runId, at, text, links }`. Karta nowej sytuacji (`pending`): `{ id: mc-…, at, runId, runs[], text, links, name, note?, reaction, chatId? }`.

**Wyzwalacze**: `once`, `daily`, `weekly` z dotychczasowego `triggerSchema`, liczone tą samą funkcją (`nextRunFor`, strefa Europe/Warsaw, `from`/`until`, DST); `cezar` i `pr` karta odrzuca (etap 2).

**Klocki** (`machinaBlockSchema`; do 30 w programie, `id` unikalne w programie i jego reakcjach):

| Klocek | Co robi |
| --- | --- |
| `fetch { url }` | publiczny GET bez logowania, tylko w `scope.domains`; strona to dane, nie polecenia |
| `extract { from, after?, before? }` | wycinek wcześniejszego odczytu między dwoma dosłownymi znacznikami (Wektor wybiera je w programie); tekst z uporządkowanymi odstępami i linkami jako `[tekst](adres)`; brak znacznika albo pusty fragment = brak wycinka |
| `message { text }` | wpis panelu w rozmowie automatu, **bez tury** (nie trafia do sesji Hermesa; w oknie ma oznaczenie „Automatyka · Machina”) |
| `resume { text, chat? }` | jawne wznowienie: tura w rozmowie automatu albo w `chat` z `scope.resumeChats` |
| `notify`, `calendarEvent`, `smartAction` | dotychczasowe akcje z tymi samymi parametrami (`domain?`, `reminderMinutes?`, `allDay?`, `when`), wykonywane tym samym kodem (`createAutomationExecutor`) |
| `finish` | program sam wskazuje koniec: po tym runie Stan „Zakończony” |
| `compare { from }` | ostatni klocek programu: wycinek porównany z katalogiem sytuacji (niżej). Program z porównaniem przed nim tylko czyta (`fetch`, `extract`); wszystkie akcje i `finish` są w reakcjach (`reactions`), więc nic się nie dzieje, zanim panel zna sytuację. Reakcja bierze ze strony tylko jej adres (`{{id.url}}`) i wycinki, bo może wykonać się później, z tego, co trzyma dziennik |

Teksty akcji mogą wstawiać wyniki wcześniejszych klocków odczytu: `{{id}}` (tekst), `{{id.link}}` (pierwszy link), `{{id.url}}` (odczytany adres). Karta odrzuca program, w którym klocek czyta późniejszy klocek, odczyt wychodzi poza `scope.domains` `resume` wskazuje rozmowę spoza `scope.resumeChats` albo akcja ma link bez własnej zatwierdzonej domeny (400).

**Zakres odczytu** (`server/machina-fetch.ts`): każdy krok, pierwszy adres i każde przekierowanie, jest sprawdzany od nowa: tylko `https`, bez portu i danych logowania, nazwa (nie adres IP) w zatwierdzonej domenie albo jej subdomenie, a wszystkie adresy, na które nazwa wskazuje, muszą być publiczne (bez loopbacku, sieci prywatnych, link-local, CGNAT, multicastu, zakresów dokumentacyjnych i mapowanych). Połączenie idzie dokładnie na sprawdzony adres, więc nazwa nie może odpowiedzieć inaczej między sprawdzeniem a połączeniem. Naruszenie kończy odczyt błędem, a run nie wykonuje żadnego skutku. Własne wartości: 5 przekierowań, 15 s na cały krok (nie tylko na ciszę na łączu), 2 MB treści, tylko typy tekstowe (dość na zwykłą stronę, a nie na pobieranie plików); wycinek w dzienniku do 4000 znaków i 40 linków. Link akcji musi leżeć w `domain` tej akcji (https, bez portu i danych logowania); zły link psuje tylko tę akcję.

**Karta i wersje** (`machina.decideCard(card, { accept, chatId })`): odrzucenie niczego nie zmienia. Zgoda na kartę bez `automat` tworzy wątek (Stan „Aktywny”, autor `machina`) i wersję 1 w jednym zapisie; z `automat` dopisuje kolejną wersję i przelicza następną porę (wątku nie zmienia; „Czeka na kartę programu” staje się „Aktywny”, wstrzymany zostaje wstrzymany, zamknięty odmawia 409). Wyjątek bez karty (`machina.createReminder`): tylko jednorazowy automat z jednym klockiem `message` albo `resume` rozmowy, w której powstał (wersja autora `wektor`, moduł Przypomnienia). Przywrócenie (`restore`) to bezpośrednia akcja użytkownika: nowa wersja z klockami, zakresem i reakcjami starszej (`restoredFrom`; bez reakcji sytuacji wycofanych od tamtej pory), harmonogram zostaje bieżący. Zmiana i przywrócenie przechodzą kontrolę zgodności próbek (niżej); sprzeczność to 409 z nazwą sytuacji. Limit: 50 niezamkniętych automatów, 200 wersji programu (własne wartości, ochrona pliku).

**Akcje użytkownika bez karty**: `POST /api/machina/action` `{ thread, action: pause|resume|cancel|runNow|restore, version? }`, tylko z Origin panelu; odmowa ma powód po polsku (400, 404, 409).

**Stany** ustawia wyłącznie Machina (wpis historii wątku autora `machina`):

| Zdarzenie | Stan |
| --- | --- |
| zgoda na kartę, wznowienie | Aktywny |
| pauza | Wstrzymany (pory mijają bez runu, „uruchom teraz” odmawia; `program.paused.from` pamięta Stan powrotu) |
| klocek `finish` wykonany | Zakończony |
| jednorazowy po swoim runie (także nieudanym) | Zakończony |
| cykl bez kolejnej pory (minął `until`) | Wygasł |
| anulowanie | Anulowany |
| karta nowej sytuacji czeka (pory działają dalej) | Czeka na decyzję; po odpowiedzi na ostatnią kartę Aktywny |
| brak wycinka | Czeka na naprawę (pory pominięte) do odpowiedzi na kartę naprawy: zgoda Aktywny (albo Czeka na decyzję), odrzucenie Wstrzymany |

Wstrzymany ma pierwszeństwo: gdy run kończy się podczas pauzy, Stan końcowy trafia do `paused.from` i wraca przy wznowieniu. Karta czekająca w czasie pauzy zostaje; wznowienie przy otwartej karcie wraca do oczekującego Stanu, a karta zatwierdzona w pauzie zostawia automat wstrzymany (po wznowieniu Aktywny). Po wznowieniu cykl liczy pory od teraz; jednorazowy, którego pora minęła w pauzie, wykona się raz.

**Run** składa panel, bez modelu, żetonu i `panel_automation_report`; turę zaczyna klocek `resume` albo panel dla oceny i naprawy (niżej), nigdy zwykły run ani wpis panelu.
- **Jedna pora, najwyżej jeden run**: przed czymkolwiek run jest zapisywany w dzienniku (`running`, `slot` = pora) i w tym samym zapisie harmonogram przechodzi dalej; druga próba tej samej pory niczego nie dopisuje. „Uruchom teraz” to osobny run (`manual`), który nie przesuwa harmonogramu cyklu; dla jednorazowego jest jego jedynym runem (pora przepada, automat kończy się po nim), żeby to samo działanie nie wykonało się drugi raz. Zaległe pory się nie kumulują.
- **Skutek najwyżej raz**: każdy skutek jest rezerwowany (`pending`) przed wykonaniem, z kluczem `runId:idKlocka` (ten sam klucz daje id wydarzenia Google, klucz wpisu w rozmowie i nonce tury). Po przerwaniu procesu ten sam run jest kończony: odczyty wykonują się ponownie, skutki bezpieczne z kluczem (`message`, `resume`, `calendarEvent`, `smartAction`) są ponawiane, a zarezerwowany `notify` zostaje jako błąd „wynik niepotwierdzony” i nie jest wysyłany drugi raz. Rezerwacja zapisuje gotowe parametry skutku (tytuł, treść, link, termin), a ponowienie używa dokładnie ich, także gdy strona w międzyczasie się zmieniła.
- **Kolejność i błędy**: nieudany odczyt albo brak wycinka kończy run błędem, a pozostałe klocki są pominięte (żadnego skutku poza powiadomieniem o naprawie przy braku wycinka); błąd akcji nie przerywa kolejnych. Błąd pobrania strony to błąd odczytu bez skutków, nie nowa sytuacja ani naprawa. Przed każdym skutkiem silnik czyta Stan: pauza, anulowanie i wyłącznik pomijają pozostałe skutki.
- **Zajęta rozmowa** przy `resume` (409 albo 5xx) zostawia run otwarty (`waiting`) i kolejny tick ponawia tę samą turę; po godzinie (własna wartość) klocek kończy się błędem.
- **Wspólna kolejka**: jeden run naraz w całym panelu. Machina nie zaczyna runu, gdy stare automaty trzymają slot (`Automations.busy()`), a stare nie zaczynają, gdy trwa run Machiny (`blockedBy`). Tura zaczęta klockiem `resume` trzyma slot do swojego końca (zgłasza go Hermes, `machina.turnChanged`), najdłużej 15 minut jak w starych automatach; po restarcie panelu ta blokada nie jest odtwarzana. Zegar co minutę, jeden tick naraz.
- **Wyłączniki**: `DESK_AUTOMATIONS=0` i brak aktywnej, odblokowanej Fili (tryb list albo `locked`) zatrzymują zegar oraz odmawiają tworzenia, zmiany, przywracania i „uruchom teraz” (409); pauza i anulowanie działają. W usłudze Machina powstaje tylko w trybie `active`.
- **Uszkodzony magazyn**: zestaw leży w `fila.json`, więc blokada zapisu Fili blokuje rezerwację runu, a bez rezerwacji nic się nie wykonuje.

### Sytuacje, ocena i naprawa (DESK-86)

**Sytuacja** to wygląd obserwowanego źródła z reakcją; **próbka** to wycinek z runu, który ją potwierdził. Katalog należy do automatu, przeżywa wersje programu i tylko rośnie (do 60 sytuacji, 20 najnowszych próbek na sytuację, 20 czekających kart; własne wartości: ochrona pliku `fila.json`, który zapisuje się w całości). Sytuacja bez próbki jest **przewidywana**: jej reakcję zatwierdziła karta programu (`situations` na karcie deklaruje id `s-…` i nazwę), a pierwszą próbkę dostaje po ocenie Wektora. Wycofana zostaje w katalogu z historią i nigdy się nie dopasowuje.

**Porównanie** (`compare`, `sampleKey`): tekst i linki wycinka po uporządkowaniu odstępów, dokładnie; znana jest sytuacja (niewycofana), której jakakolwiek próbka jest równa wycinkowi. W runie:
- znany wycinek: panel wykonuje reakcję tej sytuacji z bieżącej wersji, bez modelu;
- ten sam wycinek co czekająca karta nowej sytuacji: run dołącza do karty (`runs`, wynik `compare` z `card`, run `ok`) bez oceny; reakcja po zgodzie wykona się tylko w runie, z którego karta powstała;
- inny wycinek: **ocena**. Panel zaczyna turę Wektora w nowej rozmowie tego runu (`chatId` wynika z runId, najwyżej jedna rozmowa na run, oznaczenie „Automatyka · Machina” z powodem `ocena: <tytuł>`), z katalogiem, wycinkiem, `runId` i jednorazowym żetonem w treści tury (żeton tylko w pamięci, nie w zestawie). Run ma stan `evaluating`. Wektor odpowiada jednym narzędziem: `panel_machina_assess` (znana albo przewidywana sytuacja, tylko inaczej zapisana: bez karty, próbka dopisana, reakcja wykonana w tym runie) albo `panel_machina_situation` (nowa sytuacja z nazwą i reakcją: karta, run `waiting`, Stan „Czeka na decyzję”). Tura bez werdyktu, werdykt po końcu tury, tura dłuższa niż 15 minut (żeton wtedy wygasa) albo restart panelu w trakcie oceny dają błąd oceny bez skutków; następna pora ocenia ponownie. Tura oceny trzyma wspólną kolejkę do swojego końca (najwyżej 15 minut, jak `resume`); czekanie na kartę jej nie trzyma i nie ma limitu czasu. Gdy sytuacja runu jest już rozstrzygnięta (werdykt albo zgoda na kartę), dalszą część runu wykonuje zegar we wspólnej kolejce: reakcję z wersji programu w mocy, z wycinkami z dziennika, bez ponownego odczytu i porównania (także po zajętej rozmowie i po restarcie).
- brak fragmentu (`extract` nie znalazł znaczników albo fragment jest pusty): **naprawa**. Panel wysyła powiadomienie „Automat wymaga naprawy” (dzwonek, telefon przez ntfy, gdy skonfigurowany; klocek `naprawa` w dzienniku, klucz `runId:naprawa`), ustawia „Czeka na naprawę” i raz zaczyna turę Wektora w rozmowie tego runu z programem i początkiem tekstu strony. Zarezerwowanego powiadomienia nie wysyła się drugi raz po przerwaniu procesu. Do odpowiedzi na kartę naprawy pory są pomijane bez odczytu i bez budzenia Wektora. Automat wstrzymany, anulowany albo wyłączony w trakcie odczytu nie dostaje ani powiadomienia, ani tury naprawy czy oceny.

**Karty i ich odrzucenie** (bez automatycznego wygaśnięcia; decyzja użytkownika z 2026-11-12):

| Karta | Zgoda | Odrzucenie |
| --- | --- | --- |
| programu (`panel_machina_propose`, także zmiana i naprawa: z `automat`) | nowy automat albo nowa wersja | nic się nie zmienia; odrzucona naprawa (karta automatu w „Czeka na naprawę”) daje Wstrzymany, a wznowienie wraca do pracy |
| nowej sytuacji (`panel_machina_situation`) | sytuacja z próbką w katalogu i jej reakcja jako nowa wersja programu (powód „nowa sytuacja: …”), reakcja w pierwotnym runie | bez akcji i bez sytuacji (wynik `compare` `skipped`); następna pora może ocenić ten wycinek ponownie |
| poprawki oceny (`panel_machina_correct`) | próbka runu przechodzi z `from` do `to`; z `withdraw` sytuacja `from` jest wycofana | nic się nie zmienia |

Pauza, anulowanie, wyłącznik i brak aktywnej Fili blokują skutki reakcji także po późniejszej zgodzie, jak w każdym runie.

**Zgodność wersji**: ta sama próbka musi trafiać do tej samej sytuacji. Nowa albo przywrócona wersja musi mieć `compare` i reakcję (choćby pustą) dla każdej niewycofanej sytuacji z próbkami; karta nie może przypisać tekstu próbki innej sytuacji niż ta, w której katalog ją trzyma; reakcje wskazują tylko sytuacje z katalogu albo zadeklarowane na karcie. Sprzeczność blokuje zgodę i przywrócenie (409). Reakcję zmienia karta programu, przypisanie próbki tylko karta poprawki, a poprawka przenosi próbkę wyłącznie do sytuacji, na którą program w mocy ma reakcję.

**Rozmowy i koszt**: rozmowa projektowania i zmian to rozmowa, w której użytkownik zatwierdził kartę (`projektowanie`, `zmiana programu`, `naprawa`); ocena i naprawa mają własną rozmowę runu (`ocena`, `naprawa`, z `runId`; run ma `chatId`). Po końcu tury oceny albo naprawy run dostaje `costUsd`, gdy Hermes podał koszt rzeczywisty (`costStatus: actual`). `machina.cost(thread)` sumuje koszty rzeczywiste rozmów automatu, każdą rozmowę raz (koszt runu to koszt jego rozmowy, więc nie dolicza się go drugi raz); rozmowa bez kosztu rzeczywistego jest liczona jako nieznana (`unknown`), nie jako zero. Rozmowa projektowania to zwykła rozmowa użytkownika, więc liczy się cały jej koszt.

**Wektor i czat**: narzędzia `panel_machina` (odczyt), `panel_machina_propose` (karta programu; panel sprawdza ją jak przy zapisie), `panel_machina_reminder` (jedyny automat bez karty: jednorazowy wpis albo wznowienie rozmowy, w której trwa tura), `panel_machina_assess` i `panel_machina_situation` (werdykty, tylko z żetonem tury oceny), `panel_machina_correct` (karta poprawki) — opisy w [hermes.md](hermes.md). Odpowiedź na kartę: `POST /api/chats/:id/machina` `{ toolCallId, decision: accept|reject }`, Origin-checked; to, co karta zatwierdza, panel czyta z wywołania narzędzia w tej rozmowie, nigdy z żądania; karty odrzuconej przez panel nie da się zatwierdzić (409); odpowiedź zostaje w `cockpit.json` (`machinaCards`), więc drugie kliknięcie i restart dają tę samą odpowiedź bez drugiego zapisu; wersja programu z karty ma też klucz karty (`card`: `chatId:toolCallId`), więc ponowienie po awarii między zapisem do Fili a `cockpit.json` nie robi drugiego automatu ani wersji. Karty Machiny mają w rozmowie stałe id z treści wywołania (`<wiadomość>:m-<skrót>`, `stableMachinaCardId`), takie samo na żywo i po odczycie historii Hermesa. Kokpit rozmowy: `GET /api/chats/:id/machina` → `{ machina: { thread, title, state, reason, runId?, version, blocks, lastRun?, cost } | null }` (wątek automatu jest linkiem do Fili).

**Alerty i dzwonek**: `GET /api/automations` ma dodatkowe pole `machina` z rozstrzygniętymi skutkami `smartAction` i `notify` (`MachinaEffect`); alert Smart Actions żyje 30 dni i znika z anulowaniem automatu, dzwonek zbiera powiadomienia z 24 h, jak dla starych automatów.

### Przejście automatów czasowych do Machiny (DESK-87)

**Kiedy**: tylko tam, gdzie Machina istnieje (`fila=true`, `locked=false`; w usłudze tryb `active`). Panel przy starcie wywołuje `startTimeMove` (`server/machina-migration.ts`) i ponawia co minutę, aż przeniesie wszystko (zablokowany magazyn czeka; rekord, którego run stary silnik zarezerwował albo prowadzi, czeka, aż ten run się tam skończy, i przechodzi w stanie, w jakim się skończył: jeden właściciel runu, termin nigdy dwa razy). Przy liście Fili (`fila=false`) czas zostaje w starym rejestrze bez zmian.

**Jak**: każdy rekord `once`/`daily`/`weekly` z `automations.json`, także zamknięty, dostaje jeden wątek automat w MACH (`machina.adopt`): tytuł = nazwa, opis = cel, Tagi puste, Moduł Obserwacja dla cyklicznych i Przypomnienia dla jednorazowych (zwykłe pole, użytkownik może je zmienić). Najpierw powstaje wątek z `journal.legacy.id` = dawne `a-…`, potem stary rekord dostaje `movedTo` = ID wątku; ponowienie, restart i awaria między tymi zapisami znajdują wątek po starym id i niczego nie dublują. Rekord z `movedTo` nigdy nie jest przenoszony drugi raz, także gdy jego wątek usunięto.

| Dawny rekord | Wątek |
| --- | --- |
| cykliczny aktywny albo wstrzymany | Wstrzymany, bez programu, do nowej karty programu |
| jednorazowy z `calendarEvent`/`smartAction`/`notify`, aktywny albo wstrzymany | Wstrzymany, bez programu; dawne akcje nie wykonują się same |
| zwykłe przypomnienie jednorazowe (tylko `message`, rozmowa o identyfikatorze UUID) | Aktywny (wstrzymane: Wstrzymany) z programem wersji 1 autora `panel`, powód „przeniesienie”: ten sam termin i klocek `resume` rozmowy źródłowej z dawną instrukcją; jeśli dawny silnik już zaczął jego run, run kończy się tam, a Machina nie powtarza terminu |
| `done` / `expired` / `cancelled` | Zakończony / Wygasł / Anulowany, bez reaktywacji |

Zwykłe przypomnienie z instrukcją, której program nie pomieści (ponad 2000 znaków klocka `resume` albo `{{…}}` w treści), przechodzi jak automat z akcjami: Wstrzymany do karty; instrukcji się nie obcina.

**Historia sprzed Machiny**: `journal.legacy` (nazwa, cel, wyzwalacz, stan, rodzaje akcji, notatnik, do 100 dawnych runów z wynikiem, streszczeniem i kosztem) — tylko do wglądu, poza `journal.runs`; strona wątku pokazuje ją w sekcji „Historia sprzed Machiny”. Nie jest materiałem programu: `panel_machina` jej nie podaje.

**Pierwszy program** przeniesionego automatu powstaje tylko na prośbę użytkownika, od zera: Wektor proponuje kartę `panel_machina_propose` z `automat: MACH-n`; zgoda tworzy wersję 1 i ustawia Aktywny (to zgoda, na którą automat czekał). Przejście nie budzi projektowania. Do tego czasu automat można tylko anulować (inne akcje odmawiają 409).

**Po przejęciu** stary rejestr nie zaczyna, nie tworzy i nie zmienia automatów czasowych (`timeInMachina`): `panel_observe(time)` tworzy w Machinie jednorazowe wznowienie rozmowy, w której trwa tura (Przypomnienia, Aktywny); `panel_automation_propose` z wyzwalaczem czasu odmawia i wskazuje `panel_machina_propose`; sterowanie przeniesionym (`panel_automation_update`, `POST /api/automations/action`) odmawia z ID wątku. Run zaczęty przez stary silnik przed przejęciem domyka się starą ścieżką (jeden właściciel runu). Widok Automaty pokazuje przeniesiony rekord jako „w Machinie: MACH-n” z przyciskiem do wątku, bez przycisków stanu i z notatnikiem tylko do odczytu; kafelek pokazuje do trzech otwartych automatów Machiny (`machinaAutomats` w `GET /api/automations`), każdy otwiera swój wątek, karta w Ustawieniach mówi, gdzie są automaty czasowe. Cezar, PR i Smart Actions działają po staremu.

**Odbiór IRONMAN** na atrapach: blok „IRONMAN” w `server/machina-migration.test.ts` z danymi `scenarios/fixtures/machina-ironman.json` (dawny rekord, karta pierwszego programu, pięć wyglądów strony). Produkcyjny IRONMAN po wdrożeniu czeka Wstrzymany, aż użytkownik poprosi o zaprojektowanie programu.
