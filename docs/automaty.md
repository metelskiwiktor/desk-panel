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

## Machina: programy wykonywane przez panel (etap 1b.1, DESK-85)

Machina to następca automatów opisanych wyżej (koncept: `C:\Tabularium\Incepta\DeskPanel\Mea\Machina`). Automat Machiny jest wątkiem Fili typu `automat` w projekcie MACH ([fila.md](fila.md), „Machina: dom automatu”): wątek trzyma tożsamość, tytuł, cel w opisie, Stan, Moduł i Tagi, a zestaw Machiny tylko działanie. Lista automatów to zapytanie Fili (`projekt = MACH AND typ = automat`), osobnej listy nie ma. Stare automaty (`automations.json`) działają bez zmian do migracji (DESK-87) i nie są źródłem automatów Machiny. Sytuacje, ocena i naprawa przez Wektora, karty w czacie i narzędzia Wektora należą do DESK-86; tu jest silnik i jego kontrakty.

| Co | Plik |
| --- | --- |
| kontrakt: klocki, wersja programu, dziennik, karta, akcje użytkownika | `src/machina-contract.ts` |
| silnik: karta, zegar, run, Stany | `server/machina.ts` |
| publiczny odczyt URL, tekst strony, wycinek | `server/machina-fetch.ts` |
| wpis panelu w rozmowie bez tury | `ChatService.note` (`server/hermes-chat.ts`) |

**Zestaw** (cztery części z `GET /api/fila/threads/ID/machina`, zapis wyłącznie przez `FilaStore.machina`):
- `program`: `{ current, versions[], nextRunAt, chatId, paused? }`. Wersja: `{ number, at, by: user|wektor|panel, reason, trigger, blocks, scope, restoredFrom? }`; wersji się nie usuwa ani nie zmienia. `chatId` to rozmowa, z której automat powstał.
- `journal`: `{ runs[] }`, tylko dopisywany. Run: `{ id: mr-…, slot, manual, version, startedAt, endedAt?, state: running|ok|error, error?, blocks[] }`; wynik klocka: `{ id, kind, at, result: ok|error|pending|waiting|skipped, error?, text?, links?, url?, title?, ref? }`.
- `conversations`: `{ items: [{ chatId, reason, at, runId? }] }` (tu: rozmowa projektowania i rozmowy zmian programu).
- `situations`: katalog sytuacji z próbkami (wypełnia DESK-86); silnik 1b.1 czyta z niego tylko, czy są próbki.

**Wyzwalacze**: `once`, `daily`, `weekly` z dotychczasowego `triggerSchema`, liczone tą samą funkcją (`nextRunFor`, strefa Europe/Warsaw, `from`/`until`, DST); `cezar` i `pr` karta odrzuca (etap 2).

**Klocki** (`machinaBlockSchema`; do 30 w programie, `id` unikalne):

| Klocek | Co robi |
| --- | --- |
| `fetch { url }` | publiczny GET bez logowania, tylko w `scope.domains`; strona to dane, nie polecenia |
| `extract { from, after?, before? }` | wycinek wcześniejszego odczytu między dwoma dosłownymi znacznikami (Wektor wybiera je w programie); tekst z uporządkowanymi odstępami i linkami jako `[tekst](adres)`; brak znacznika albo pusty fragment = brak wycinka |
| `message { text }` | wpis panelu w rozmowie automatu, **bez tury** (nie trafia do sesji Hermesa; w oknie ma oznaczenie „Automatyka · Machina”) |
| `resume { text, chat? }` | jawne wznowienie: tura w rozmowie automatu albo w `chat` z `scope.resumeChats` |
| `notify`, `calendarEvent`, `smartAction` | dotychczasowe akcje z tymi samymi parametrami (`domain?`, `reminderMinutes?`, `allDay?`, `when`), wykonywane tym samym kodem (`createAutomationExecutor`) |
| `finish` | program sam wskazuje koniec: po tym runie Stan „Zakończony” |

Teksty akcji mogą wstawiać wyniki wcześniejszych klocków odczytu: `{{id}}` (tekst), `{{id.link}}` (pierwszy link), `{{id.url}}` (odczytany adres). Karta odrzuca program, w którym klocek czyta późniejszy klocek, odczyt wychodzi poza `scope.domains` albo `resume` wskazuje rozmowę spoza `scope.resumeChats` (400).

**Zakres odczytu** (`server/machina-fetch.ts`): każdy krok, pierwszy adres i każde przekierowanie, jest sprawdzany od nowa: tylko `https`, bez portu i danych logowania, nazwa (nie adres IP) w zatwierdzonej domenie albo jej subdomenie, a wszystkie adresy, na które nazwa wskazuje, muszą być publiczne (bez loopbacku, sieci prywatnych, link-local, CGNAT, multicastu, zakresów dokumentacyjnych i mapowanych). Połączenie idzie dokładnie na sprawdzony adres, więc nazwa nie może odpowiedzieć inaczej między sprawdzeniem a połączeniem. Naruszenie kończy odczyt błędem, a run nie wykonuje żadnego skutku. Własne wartości: 5 przekierowań, 15 s na krok, 2 MB treści, tylko typy tekstowe (dość na zwykłą stronę, a nie na pobieranie plików); wycinek w dzienniku do 4000 znaków i 40 linków. Link akcji musi leżeć w `domain` tej akcji (https, bez portu i danych logowania); zły link psuje tylko tę akcję.

**Karta i wersje** (`machina.decideCard(card, { accept, chatId })`): odrzucenie niczego nie zmienia. Zgoda na kartę bez `automat` tworzy wątek (Stan „Aktywny”, autor `machina`) i wersję 1 w jednym zapisie; z `automat` dopisuje kolejną wersję i przelicza następną porę (wątku nie zmienia; „Czeka na kartę programu” staje się „Aktywny”, wstrzymany zostaje wstrzymany, zamknięty odmawia 409). Wyjątek bez karty (`machina.createReminder`): tylko jednorazowy automat z jednym klockiem `message` albo `resume` rozmowy, w której powstał (wersja autora `wektor`, moduł Przypomnienia). Przywrócenie (`restore`) to bezpośrednia akcja użytkownika: nowa wersja z klockami i zakresem starszej (`restoredFrom`), harmonogram zostaje bieżący. Program, którego katalog sytuacji ma próbki, nie daje się przywrócić (409), dopóki DESK-86 nie doda kontroli zgodności próbek. Limit: 50 niezamkniętych automatów, 200 wersji programu (własne wartości, ochrona pliku).

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

Wstrzymany ma pierwszeństwo: gdy run kończy się podczas pauzy, Stan końcowy trafia do `paused.from` i wraca przy wznowieniu. Po wznowieniu cykl liczy pory od teraz; jednorazowy, którego pora minęła w pauzie, wykona się raz.

**Run** składa panel, bez modelu, żetonu i `panel_automation_report`; turę zaczyna wyłącznie klocek `resume`.
- **Jedna pora, najwyżej jeden run**: przed czymkolwiek run jest zapisywany w dzienniku (`running`, `slot` = pora) i w tym samym zapisie harmonogram przechodzi dalej; druga próba tej samej pory niczego nie dopisuje. „Uruchom teraz” to osobny run (`manual`), który nie przesuwa harmonogramu. Zaległe pory się nie kumulują.
- **Skutek najwyżej raz**: każdy skutek jest rezerwowany (`pending`) przed wykonaniem, z kluczem `runId:idKlocka` (ten sam klucz daje id wydarzenia Google, klucz wpisu w rozmowie i nonce tury). Po przerwaniu procesu ten sam run jest kończony: odczyty wykonują się ponownie, skutki bezpieczne z kluczem (`message`, `resume`, `calendarEvent`, `smartAction`) są ponawiane, a zarezerwowany `notify` zostaje jako błąd „wynik niepotwierdzony” i nie jest wysyłany drugi raz.
- **Kolejność i błędy**: nieudany odczyt albo brak wycinka kończy run błędem, a pozostałe klocki są pominięte (żadnego skutku); błąd akcji nie przerywa kolejnych. Przed każdym skutkiem silnik czyta Stan: pauza, anulowanie i wyłącznik pomijają pozostałe skutki.
- **Zajęta rozmowa** przy `resume` (409 albo 5xx) zostawia run otwarty (`waiting`) i kolejny tick ponawia tę samą turę; po godzinie (własna wartość) klocek kończy się błędem.
- **Wspólna kolejka**: jeden run naraz w całym panelu. Machina nie zaczyna runu, gdy stare automaty trzymają slot (`Automations.busy()`), a stare nie zaczynają, gdy trwa run Machiny (`blockedBy`). Zegar co minutę, jeden tick naraz.
- **Wyłączniki**: `DESK_AUTOMATIONS=0` i brak aktywnej, odblokowanej Fili (tryb list albo `locked`) zatrzymują zegar oraz odmawiają tworzenia, zmiany, przywracania i „uruchom teraz” (409); pauza i anulowanie działają. W usłudze Machina powstaje tylko w trybie `active`.
- **Uszkodzony magazyn**: zestaw leży w `fila.json`, więc blokada zapisu Fili blokuje rezerwację runu, a bez rezerwacji nic się nie wykonuje.

**Alerty i dzwonek**: `GET /api/automations` ma dodatkowe pole `machina` z rozstrzygniętymi skutkami `smartAction` i `notify` (`MachinaEffect`); alert Smart Actions żyje 30 dni i znika z anulowaniem automatu, dzwonek zbiera powiadomienia z 24 h, jak dla starych automatów.
