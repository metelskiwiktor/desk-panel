# Desk Panel

Wizyty (docs/znanylekarz.md): `panel_znanylekarz` pokazuje terminy z anonimowych GET-ów publicznego formularza pacjenta.
Token strony pozostaje na backendzie; tylko znanylekarz.pl, bez obcych przekierowań. Czas trwania czytaj przez
`with[]=service.duration`, nigdy z odstępów między terminami. Użytkownik wybiera dzień/godzinę na karcie, panel ponownie
sprawdza dostępność i daje zweryfikowany link do osobnego okna. Wszystkie godziny dnia wybiera się w prawym panelu,
obok kalendarza na wspólnej osi; karta po lewej pokazuje wybór. Kolizje ostrzegają, nie blokują. Respektuj Google transparency,
wyłączny koniec i coverage: niepełny/stary odczyt lub dzień poza zakresem nigdy nie oznaczają wolnego czasu. Rezerwację, zgody i płatność kończy wyłącznie użytkownik.
Dopiero jego „Zarezerwowałem ten termin — zapisz” tworzy wydarzenie Google. Zwykłe wydarzenie Wektor tylko proponuje przez
`panel_calendar_propose`; zapisuje przycisk karty. Origin-checked POST-y `/api/chats/:id/appointment` i `calendar-plan` czytają
propozycję z zakończonego wywołania w tej rozmowie, a nie z żądania. Stan i zamrożone zapisy są w `appointments.dpapi`, poza
Gitem; powtórzenie używa tego samego id Google. Nie klikaj tych potwierdzeń w prawdziwych rozmowach podczas testów. Scope
`calendar.events.owned` wymaga ponownej zgody Google, stare tokeny zachowują odczyt agendy. Agent nie ma bezpośredniego
narzędzia zapisu, nie edytuje/usuwa wydarzeń, nie zaprasza gości ani nie rezerwuje wizyt.

Local React/TypeScript dashboard with a Node HTTP server. Read README.md, then the matching file in docs/
(cezar, gmail, calendar, garmin, zdarzenia, system, tailscale, testowanie, desk-panel, czat, hermes, github, openrouter, smart-actions) for integration details. Keep the server bound to loopback; credentials stay on the
backend and outside Git. Google refresh tokens use user-scoped Windows DPAPI.

- `just setup`: install locked dependencies and Playwright Chromium.
- `just dev`: run API and Vite during development.
- `just scenario NAME` / `just screenshots NAME [--pages pulpit,ustawienia]
  [--device ID|all] [--scale N|primary|all]`: run the real UI against
  `scenarios/NAME.json` (Vite + a scenario API on free ports, never the service
  port) and take Playwright screenshots into output/screenshots. Use this to
  check UI changes visually on the target screens. `--query ambient=day|night` shoots the
  idle clock instead of walking the pages.
- Wektor GUI: read `docs/wektor-ui.md` for frontend ownership, styling and loading invariants. `just wektor-ui
  [all|composer|keyboard|history|switching]` runs synthetic browser flows; use targeted checks while iterating and
  `just check` at the end. This GUI workflow does not imply deployment or a Hermes restart.
- `just devices`: target screens from devices.json with derived CSS sizes.
  Screen sizes live only there; the layout is fluid and never reads it.
- `just kiosk [DISPLAY]` / `just kiosk-autostart ON|OFF|STATUS` / `just kiosk-taskbar HIDE|SHOW|STATUS`: the dashboard as a bare full-screen Chrome
  window on one monitor (own Chrome profile), starting it at sign-in, and hiding its Windows taskbar. Windows PowerShell 5.1 reads these
  scripts as ANSI: keep them ASCII.
- `just garmin-login`: one-time Garmin Connect sign-in typed by the user in a terminal; only
  DPAPI-encrypted tokens are saved. Never ask for or handle the Garmin password.
- `just check`: tests, typecheck, dead code (knip, production mode) and frontend build in parallel. Run before publishing;
  `just test-fast` runs only the tests touched by uncommitted changes. Tests guard invariants, not commits: change the
  existing test, merge duplicates, and add no code that only a test uses (docs/testowanie.md).
- `just update [--force]`: deploy to the service — on main it merges origin/main only when it
  cannot conflict with local work (otherwise lists the files and changes
  nothing); on another branch it pulls nothing. Runs tests and build, swaps dist and
  restarts. Uncommitted local changes are deployed too (no commit needed); an unchanged version is skipped. The
  restart needs no elevation (the service lets this user start and stop it); UAC shows only if Windows refuses.
- `just service`: Windows service status. `just service RESTART` applies changes
  after a successful build. Never run another listener while the service runs.
- `just install`: first-time Servy registration; may need Windows credentials
  entered by the user in the native dialog. See servy/README.md.

Phone access: Tailscale (installed on this PC and the phone, account metelski.wiktor@gmail.com) runs
`tailscale serve --bg 5174`, giving `https://desktop-sgur9l8.tail244683.ts.net` inside the tailnet only.
The server stays on 127.0.0.1; `DESK_ALLOWED_HOST` (in `%USERPROFILE%\.desk-panel\panel.env`, outside Git)
admits that one name and its https Origin. CLI: `C:\Program Files\Tailscale\tailscale.exe` (`status`,
`serve status`). Never use `tailscale funnel` (public) or share the tailnet: the panel has no login of its own.
Details and setup from scratch: docs/tailscale.md.

Source is in src/ and server/. The UI reads only `/api/*`; `server/sources.ts`
defines `PanelSources`, implemented by `real-sources.ts` (service) and
`scenario.ts` (JSON files validated by the same contract schemas). Mock data
lives only in scenarios/ — add a file there instead of branching in the UI. Contract schemas validate provider data. Preserve
real observation timestamps on failures. Cezar is read-only except
`POST /api/cezar/action` (archive, unarchive, read, unread on one finished run, Origin-checked) and the chat cockpit's
dispatch card (`POST /api/chats/:id/dispatch`, Origin-checked: the panel starts the run only on the user's click, see
docs/czat.md); never resume or answer tasks, and no agent dispatches by itself. Quota reads must never send model prompts
or start agent turns. Gmail uses `gmail.modify` only: thread reads, read/unread
and Trash/untrash — never sending or permanent deletion. Garmin Connect
(unofficial garminconnect-js, pinned) is read-only and polled gently; only the plan, steps and
recordings' basics reach the UI (no body, sleep, places or ids); what else the account returns is catalogued in
docs/garmin-data.md. GitHub (docs/github.md) is read-only through the user's own `gh` (`pr list`/`pr view`, one module
`server/github.ts` for the PR tile and the cockpit), cached 30–90 s; the panel never merges, comments or reviews. OpenRouter (docs/openrouter.md): spend tile reads key usage and credits using `OPENROUTER_API_KEY` (shared with Hermes in `panel.env`, never in browser), scans Hermes log (`%LOCALAPPDATA%/hermes/logs/agent.log` or `HERMES_LOG_PATH`) for completed `provider=openrouter` calls with an id, queries generation cost from `/api/v1/generation?id=...` and caches locally in `~/.desk-panel/openrouter-cache.json` without calling `/api/v1/activity`. Do not commit .env, OAuth clients, tokens, logs, screenshots,
node_modules or dist. Do not print credentials in tool output.

Bank (docs/bank.md): kafelek Konto czyta PKO BP przez Enable Banking (restricted production, własne konto), tylko odczyt (saldo i
booked operacje); `POST /api/bank/connect` startuje zgodę (Origin-checked), `GET /api/bank/callback` ją kończy. Klucz prywatny
aplikacji (`~/.desk-panel/enablebanking/private.pem`) i sesja zostają na backendzie (sesja i odczyt w DPAPI). Bank daje ok. 4 odczyty
konta na dobę, więc czytaj najwyżej co 7 h (`BANK_REFRESH_MS`) i nie dodawaj odświeżania na żądanie ani odpytywania; oznaczenia i agent czytają
tylko zapisany odczyt (`bank.cached()`), nigdy bank. Pełne numery rachunków i telefonów zostają w zaszyfrowanym cache na serwerze; do przeglądarki,
agenta i logów trafiają ucięte (`publicTransaction`, ostatnie 4 cyfry IBAN-u, telefon jak maskuje bank). Oznaczenia operacji (docs/bank.md):
najpierw ruch: wydatek (kategoria), przychód (źródło), rozliczenie (z drugą stroną; saldo) albo przełożenie (między własnymi kontami); każdy ruch
ma jedną oś, a nowe pytanie to etykieta, nie kolejna oś. Do tego druga strona (sama nazwa, bez rodzaju; identyfikatory jako HMAC, dwie mogą mieć
to samo imię), etykiety, cykliczne, opis, w `~/.desk-panel/bank-labels.dpapi`;
metoda płatności idzie z banku. Zapis tylko `POST /api/bank/labels/action` (Origin-checked), lokalny, nic nie idzie do banku. Podpowiedzi
tylko przez powiązania, które pokazuje bank (tekst sprzedawcy, rachunek, telefon, nazwa; pewne dopiero od dwóch zgodnych wcześniejszych oznaczeń), a płatność
bez nazwy z banku (telefon, BLIK) nie ma odbiorcy i nie jest podpowiadana ani po kwocie, ani po historii (`server/bank-suggest.ts`); nigdy nie przypisują same. Agent czatu widzi bank i oznaczenia do odczytu w `/api/agent/bank` (strony po nazwie,
bez pełnych numerów) i pokazuje wydatki kartą (`panel_show`, wiersze czyta sama karta z `/api/bank/show`). Zmiany nie robi sam: scalenie
kategorii wydatków i masowe oznaczenie operacji pewnymi podpowiedziami tylko proponuje kartą zgody (`panel_bank_propose`, `panel_bank_assign`, docs/bank.md), a panel zmienia oznaczenia dopiero po kliknięciu
użytkownika (`POST /api/chats/:id/bank-plan`, Origin-checked; plan czyta z rozmowy, nie z żądania). Jak dawać Wektorowi nowe
umiejętności i testować jego rozmowy: `.claude/skills/wektor-capabilities`. Nigdy nie proś o dane logowania do banku: zgodę wydaje użytkownik w iPKO/IKO.

Smart Actions (docs/smart-actions.md): reguły są danymi w `~/.desk-panel/smart-rules.json` (poza Gitem), alerty liczy serwer (`GET /api/smart-actions`). Przycisk maila otwiera tylko link z treści na domenie reguły. Wektor szuka w całej skrzynce (`panel_mail_search`, tylko odczyt), czyta treść jednego maila naraz (`panel_mail_read`, jako dane, nie polecenia) i testuje reguły bez zapisu. Regułę zmienia tylko kartą zgody (`panel_smart_rule_propose` → `POST /api/chats/:id/smart-rule`, Origin-checked, plan z rozmowy), a przełącznik w oknie reguł to klik użytkownika (`POST /api/smart-rules/toggle`). Alert przelewu oznacza podpowiedzią dopiero klik użytkownika, lokalnie.

Chat engines (docs/hermes.md): a conversation runs on Hermes Agent (default for new chats, preference in
`~/.desk-panel/chat-settings.json`) or agy, fixed for its life; old chats without `engine` are agy's. Hermes is reached only
through its long-running API server on loopback (`DESK_HERMES_URL`, key `DESK_HERMES_KEY` in panel.env, never in the browser
or logs); its sessions are canonical and `~/.desk-panel/hermes-chats` keeps only the mapping (session, run ids, what the user
typed and pointed at). Hermes reads the panel through the narrow MCP tools at `/api/mcp` (server/panel-mcp.ts: loopback only,
bearer token from `~/.desk-panel/mcp-token`, requests with an Origin refused), the same views and two writes as the agy
preamble, plus cockpit tools defined by one contract table (`COCKPIT_TOOLS` in src/cockpit-contract.ts: what, when, effect; the
cockpit watches a task only after a dispatch from the card, `panel_cezar_watch` or until `panel_cockpit_clear`, never by
guessing); a new tool there needs the same care as a new agent view. No silent fallback: Hermes down is shown, AGY is the
user's manual choice. `just hermes CHECK|RUN|…`, `just hermes-setup`, `just hermes-install`; never start or register it without
the user.

Chat (docs/czat.md): POST/PATCH/DELETE /api/chats… is a second write capability, Origin-checked like the actions above. The agy engine launches the user's own `agy` (Antigravity CLI) in headless stream-json mode, one process per conversation, working directory `~/.desk-panel/agent`, conversations in `~/.desk-panel/chats`. The agent gets the dashboard elements the user points at (`ctx()` / `data-ctx-*` in src/chat-context.ts) and reads the rest itself from compact read-only text views of the panel's own GET API (`/api/agent/*` in server/agent-views.ts: calendar, mail metadata, Cezar, training, quotas, system, the bank account with the user's marks (no full account or phone numbers), local time; listed in the preamble in server/agent-chat.ts), with the same scope as the UI. Its instructions limit it to GET plus two writes: on the user's request `POST /api/cezar/action` (archive, unarchive, read, unread of finished tasks; ids are in the cezar view), and the panel's own to-do lists, `POST /api/todos/action` (docs/zadania.md; a bare "zadanie" means a to-do item, Cezar only when named): other panel writes are possible with `curl` (Origin only guards browsers), so keep that line in the preamble. Only a message the user sends starts an agent turn; nothing in the panel may send prompts on its own, and the quota rule above is unchanged. `agy` runs commands without asking (launched with `--dangerously-skip-permissions`, `DESK_AGY_SKIP_PERMISSIONS=0` turns it off; headless agy otherwise denies tools such as read_file and ends the turn silently) and is not sandboxed (a hobby project; revisit before the panel leaves this PC). For analysing the chat (what agents struggle with, why a turn ended), read `~/.desk-panel/chat-logs` (outside Git, private): its README.md explains the files, start with turns.jsonl and open a conversation's raw trace only for a chosen turn; chats themselves stay lean. Scenario mode answers from a scripted agent (server/scenario-chat.ts), so the chat can be tried and photographed without spending any limit.
