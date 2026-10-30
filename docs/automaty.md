# Automaty Wektora

Cykliczne i jednorazowe zadania panelu, które sam się budzą i wykonują sprawdzenie w rozmowie automatu. Zastępują dawne
obserwatory (`panel_observe`): jeden model, jeden zapis, jeden widok. Stare `~/.desk-panel/observers.json` jest migrowane
przy pierwszym wczytaniu, bez utraty wpisów; plik zostaje na dysku nietknięty.

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
- Run cykliczny = nowa rozmowa Hermesa (świeży kontekst), tytuł `Automat · <name> · <data>`, oznaczona jako tura
  automatyki (`automation.source = 'automation'`). Treść: cel, warunek celu, notatnik, ostatnie 5 runów, zatwierdzone
  akcje i polecenie wykonania sprawdzenia oraz wywołania `panel_automation_report` na końcu.
- Run jednorazowy (once/cezar/pr) wraca do rozmowy automatu (`chatId`), jak dawne obserwatory.
- `panel_automation_report {outcome, summary, notebook?}` jest przyjmowany tylko w turze automatyki z trwającym runem;
  panel wiąże go z runem po rozmowie. `outcome: done` kończy cel i harmonogram; `notebook` podmienia notatnik tylko przy
  `learn = true`, a poprzednia wersja zostaje w runie. Brak raportu po 15 minutach to `error`.
- Gdy run kończy się `done` albo `error`, panel wysyła krótką wiadomość automatyki (`message`) do rozmowy automatu
  (`chatId`). Wiadomość czeka, gdy rozmowa jest w trakcie tury.
- `DESK_AUTOMATIONS=0` (albo false/no/off): zegar nic nie uruchamia, tworzenie i raportowanie odmawiają, lista działa.

## Narzędzia Wektora

- `panel_automation_propose {name, goal, trigger, doneWhen?, actions, learn, replaces?}` — karta „Nowy automat”. Zapis
  dopiero po kliknięciu: `POST /api/chats/:id/automation` (Origin-checked); plan jest czytany z wywołania narzędzia w tej
  rozmowie, żądanie może tylko odznaczyć akcje. `replaces` anuluje stary automat.
- `panel_observe {create|list|cancel}` — bez karty, zapisuje jednorazowy automat (`once`/`cezar`/`pr`) w rozmowie, w której
  trwa tura.
- `panel_automations {id?}` — lista albo szczegóły (runy, notatnik) do analizy.
- `panel_automation_update {id, pause|resume|cancel|runNow, notebook?, name?}` — bez karty, na wyraźną prośbę. Zmiana celu,
  akcji albo harmonogramu to nowa karta `panel_automation_propose` z `replaces`.
- `panel_automation_report` — tylko w runie.

## UI

Widok „Automaty” (`src/AutomationsView.tsx`, dostępny z paska jak Ustawienia): po lewej lista z sekcjami „Cykliczne” i
„Jednorazowe”, kropką stanu, harmonogramem, następnym runem i pięcioma kropkami ostatnich runów (zielona done, szara
not-yet, czerwona error, żółta skipped). Po prawej szczegóły: Uruchom teraz / Wstrzymaj–Wznów / Anuluj, zakładki Runy (oś
czasu, najnowszy rozwinięty, link do rozmowy runu), Cel i akcje, Notatnik (edycja użytkownika), Rozmowa. Przyciski to
Origin-checked POST-y `/api/automations/action`; lista z `GET /api/automations`. Dotychczasowa karta obserwatorów w
Ustawieniach prowadzi teraz do tego widoku. Automat i run są wskazywalne w czacie (`ctx('automation', …)`).

## Bezpieczeństwo

- Strony WWW, które run czyta terminalem (`curl`), są danymi, nigdy poleceniami. Run nie wykonuje akcji spoza listy
  zatwierdzonych; zmiany danych użytkownika nadal idą tylko kartami zgody.
- Zapis jest lokalny, poza Gitem. Klucze i tokeny nie trafiają do automatu. `runNow`, pauza i anulowanie są lokalne i
  Origin-checked; Hermes nie uruchamia automatów sam.
