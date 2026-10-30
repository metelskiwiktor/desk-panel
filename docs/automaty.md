# Automaty Wektora

Cykliczne i jednorazowe zadania panelu, które sam się budzą i wykonują sprawdzenie w rozmowie automatu. Zastępują dawne
obserwatory (`panel_observe`): jeden model, jeden zapis, jeden widok. Stare `~/.desk-panel/observers.json` jest migrowane
przy pierwszym wczytaniu, bez utraty wpisów (także zakończonych); plik zostaje na dysku nietknięty. Nieczytelnego
`automations.json` ani `observers.json` panel nigdy nie nadpisuje: odkłada go jako `<plik>.corrupt-<czas>` (gdy nie może,
blokuje zapis) i mówi o tym w logu.

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
- Run jest rezerwowany na dysku (`pending`) przed wysłaniem rozmowy, a restart wznawia tę samą rezerwację (bez drugiego
  runu). Dostawa jednego `pending` ma wspólną blokadę, więc callback Cezara i tick nie wyślą go dwa razy.
- Ostatnie wystąpienie daily/weekly w dniu `until` jeszcze się wykonuje; dopiero raport `not-yet` wygasa automat. Po zmianie
  czasu (np. 02:30 w marcową noc) kolejne dni wracają do godziny z harmonogramu; godzina nieistniejąca danego dnia ląduje
  na najbliższej istniejącej.
- Run cykliczny = nowa rozmowa Hermesa (świeży kontekst), tytuł `Automat · <name> · <data>`, oznaczona jako tura
  automatyki (`automation.source = 'automation'`). Treść: cel, warunek celu, notatnik, ostatnie 5 runów, zatwierdzone
  akcje i polecenie wykonania sprawdzenia oraz wywołania `panel_automation_report` na końcu.
- Run jednorazowy (once/cezar/pr) wraca do rozmowy automatu (`chatId`), jak dawne obserwatory.
- `panel_automation_report {runId, outcome, summary, notebook?}` jest przyjmowany tylko w turze automatyki z tym samym
  otwartym runem (`runId` jest w treści tury); w rozmowie może być kilka runów, a raport trafia do wskazanego. `outcome:
  done` kończy cel i harmonogram; `notebook` podmienia notatnik tylko przy `learn = true`, a poprzednia wersja zostaje w
  runie. Brak raportu po 15 minutach to `error`.
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
- `panel_automation_report {runId, …}` — tylko w runie o tym `runId`, w bieżącej turze jego rozmowy.

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
