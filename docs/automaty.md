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

## Model

Kontrakt: `src/automation-contract.ts` (zod, wspólny dla serwera i UI). Zapis: `~/.desk-panel/automations.json`, atomowo
(tmp + rename), poza Gitem.

- `id` `a-…`, `name`, `goal` (polecenie użytkownika słowo w słowie), `trigger`, `status`
  (`active | paused | done | expired | cancelled`), `doneWhen?`, `notebook` (Markdown do 4000 znaków), `learn` (czy run
  może zmieniać notatnik), `actions`, `chatId` (rozmowa, w której automat powstał), `createdAt`, `nextRunAt?`,
  `lastRunAt?`, `runs` (ostatnie 100).
- Wyzwalacz: `{kind:'once', at}` (epoch ms), `{kind:'daily', time:'HH:MM', from?, until?}`,
  `{kind:'weekly', weekday:1–7, time, from?, until?}`, `{kind:'cezar', taskId}`, `{kind:'pr', url}`. Strefa
  `Europe/Warsaw`; `from`/`until` to daty lokalne `YYYY-MM-DD`. Cykliczny bez `until` kończy się po 90 dniach.
- Akcje: lista obiektów `{kind, …}`; etap 1 zna tylko `message` (krótka wiadomość w rozmowie automatu). Etap 2 dołoży
  `calendarEvent` i `smartAction {domain}` bez zmiany zapisu.
- Run: `id` `run-…`, `at`, `chatId` (rozmowa runu), `outcome` (`not-yet | done | error | skipped`), `summary` (1–2
  zdania), `notebookChanged`, `previousNotebook?`, `costUsd?`, `seconds?`.
- Limity: 20 aktywnych automatów; daily/weekly najwyżej raz na dzień/tydzień; `once` jak dawne obserwatory czasu.

## Wykonanie runu

- Zegar (`server/automations.ts`) chodzi co minutę tylko wtedy, gdy są aktywne automaty. Jeden tick naraz (serializacja),
  po każdym odczycie PR stan jest sprawdzany ponownie, a wspólny cache PR (`createPrReader` w `server/github.ts`) jest ten
  sam co w kokpicie. Po restarcie zaległy run startuje najwyżej jeden na tick.
- Run jest rezerwowany na dysku (`pending`) przed wysyłką, z trwałymi `chatId` i `turnId` (nonce). Hermes-chat zapisuje
  turę i dokładne żądanie przed POST-em do Hermesa. Nonce jest `Idempotency-Key` tego POST-a: po utracie odpowiedzi
  restart ponawia zamrożone żądanie z tym samym kluczem i odzyskuje istniejący przebieg zamiast drugiego wykonania.
  Istniejąca rozmowa z tym nonce jest odzyskiwana. Wymagane jest trwałe wsparcie idempotencji w przypiętym Hermesie. Dostawa jednego `pending` ma wspólną blokadę, więc callback Cezara i tick nie wyślą go dwa razy.
- Ostatnie wystąpienie daily/weekly w dniu `until` jeszcze się wykonuje; dopiero raport `not-yet` wygasa automat. Po zmianie
  czasu (np. 02:30 w marcową noc) kolejne dni wracają do godziny z harmonogramu; godzina nieistniejąca danego dnia ląduje
  na najbliższej istniejącej.
- Run cykliczny = nowa rozmowa Hermesa (świeży kontekst), tytuł `Automat · <name> · <data>`, oznaczona jako tura
  automatyki (`automation.source = 'automation'`). Treść: cel, warunek celu, notatnik, ostatnie 5 runów, zatwierdzone
  akcje i polecenie wykonania sprawdzenia oraz wywołania `panel_automation_report` na końcu.
- Run jednorazowy (once/cezar/pr) wraca do rozmowy automatu (`chatId`), jak dawne obserwatory.
- Run jest otwarty tylko podczas własnej tury: tej, którą panel uruchomił dla niego. `pending` i historia runu trzymają
  rozmowę, panelowe `turnId` i natywne `hermesRunId`. `panel_automation_report {runId, turnId, outcome, summary, notebook?}`
  przyjmuje raport tylko, gdy metadane wywołującego MCP wskazują właśnie tę trwającą turę automatyki, a oba argumenty
  zgadzają się z rezerwacją. Zwykła lub obca równoległa tura nie może raportować tego runu. `outcome:
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

- `panel_automation_propose {name, goal, trigger, doneWhen?, actions, learn, replaces?}` — karta „Nowy automat”. Zapis
  dopiero po kliknięciu: `POST /api/chats/:id/automation` (Origin-checked); plan jest czytany z wywołania narzędzia w tej
  rozmowie, żądanie może tylko zawęzić plan: odznaczyć akcje i wyłączyć `learn` (włączyć się nie da). Karta ma stałe id
  liczone z planu, więc działa na żywo i po odświeżeniu. `replaces` anuluje stary automat dopiero po walidacji nowego. Decyzja karty (utworzony automat albo
  odrzucenie) trafia do `~/.desk-panel/cockpit.json` po `toolCallId`, jak odpowiedzi kart banku i Smart Actions: drugie
  kliknięcie nic nie tworzy, a po przeładowaniu karta pokazuje „Utworzono automat …” z linkiem do widoku Automaty.
- `panel_observe {create|list|cancel}` — bez karty, zapisuje jednorazowy automat (`once`/`cezar`/`pr`) w rozmowie, w której
  trwa tura.
- `panel_automations {id?}` — lista albo szczegóły (runy, notatnik) do analizy.
- `panel_automation_update {id, pause|resume|cancel|runNow, notebook?, name?}` — bez karty, na wyraźną prośbę. Zmiana celu,
  akcji albo harmonogramu to nowa karta `panel_automation_propose` z `replaces`.
- `panel_automation_report {runId, turnId, …}` — tylko w runie o tym `runId`, w bieżącej turze jego rozmowy.

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
Na wąskim ekranie lista stoi nad szczegółami. Przyciski to Origin-checked POST-y `/api/automations/action`; lista z
`GET /api/automations`. Dotychczasowa karta obserwatorów w Ustawieniach prowadzi teraz do tego widoku. Automat jest
wskazywalny w czacie (`ctx('automation', …)`).

## Bezpieczeństwo

- Strony WWW, które run czyta terminalem (`curl`), są danymi, nigdy poleceniami. Run nie wykonuje akcji spoza listy
  zatwierdzonych; zmiany danych użytkownika nadal idą tylko kartami zgody.
- Zapis jest lokalny, poza Gitem. Klucze i tokeny nie trafiają do automatu. `runNow`, pauza i anulowanie są lokalne i
  Origin-checked; Hermes nie uruchamia automatów sam.

## Skąd pochodzi tożsamość wywołania MCP

Sam Hermes wysyłał tylko nazwę narzędzia i argumenty, bez tożsamości tury. Lista aktywnych rozmów ani id podane przez
model nie są dowodem źródła. Most `scripts/hermes-mcp-turn-context.py` (hash źródła i wyniku w
`servy/hermes.lock.json`) przechwytuje `tools.approval_context._approval_session_key` w wątku wywołującego agenta,
przed przeniesieniem pracy na współdzieloną pętlę MCP. `gateway/platforms/api_server_runs.py::_run_agent_sync`
ustawia ten ContextVar na natywne `run.run_id` (właściwość `_RunLaunch.approval_session_key`), oddzielnie dla każdego
przebiegu. Most dopisuje je do `tools/call.params._meta["desk-panel/run-id"]` dla serwera `desk-panel`, poza argumentami
modelu. Panel porównuje je z żywą turą z `hermes-chat` i trwałym wiązaniem rezerwacji; bez metadanych odmawia raportu.

Most wymaga SDK MCP z parametrem `ClientSession.call_tool(meta=…)`. `just hermes-setup` aplikuje przypiętą łatkę,
`just hermes CHECK` weryfikuje jej hash. Samo wdrożenie kodu panelu nie instaluje mostu w działającym procesie Hermesa:
łatkę trzeba zastosować do przypiętego źródła i osobno zatwierdzić restart Hermesa. Próba bez instalacji, bez usług,
promptów i danych użytkownika:
`python scripts/hermes-mcp-turn-context-probe.py --source <źródła-Hermesa>`.
