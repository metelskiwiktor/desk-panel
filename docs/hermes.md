# Hermes Agent jako silnik czatu

Analiza problemów konkretnej rozmowy: [diagnostyka-czatu-wektora.md](diagnostyka-czatu-wektora.md).

Serwer panelu ma dwa silniki czatu: **Hermes** (Hermes Agent) i **AGY** (Antigravity CLI, zob. [czat.md](czat.md)). Okno
czatu (Wektor) pisze **tylko do Hermesa**: nie ma przełącznika silników, nowe rozmowy startują na Hermesie, a lista pokazuje
tylko rozmowy Hermesa (`useChat('hermes')`, `src/cockpit/live.ts`). AGY zostaje na serwerze: `POST /api/chats` z `engine: "agy"`
i jego stare rozmowy (bez pola `engine`) dalej działają, tylko okno ich nie pokazuje. Zapamiętany wybór silnika
(`~/.desk-panel/chat-settings.json`, `/api/chats/engine`) serwer dalej trzyma, ale okno go nie używa. Rozmowa należy do jednego
silnika na zawsze.

## Jak to działa

```
ChatWindow ── useChat ── /api/chats… ── ChatHub (server/chat-hub.ts)
                                         ├─ hermes: HermesChat (server/hermes-chat.ts) ── HermesClient (server/hermes-api.ts) ── Hermes API server (127.0.0.1:8642)
                                         │                                                                                        │ MCP (Streamable HTTP)
                                         │                                       /api/mcp (server/panel-mcp.ts) ◄────────────────┘
                                         └─ agy: ChatService (server/agent-chat.ts) ── agy (proces na rozmowę)
```

- **Tylko oficjalne, stale działające API.** Panel nie uruchamia CLI Hermesa na turę. Tura to `POST /v1/runs`
  (`{input, session_id}`), potem strumień SSE `GET /v1/runs/<run>/events`; zgoda `POST /v1/runs/<run>/approval`, stop
  `POST /v1/runs/<run>/cancel` (starszy serwer: `/stop`), stan przebiegu `GET /v1/runs/<run>`, historia
  `GET /api/sessions/<sesja>/messages?limit=500&offset=…` (Hermes 0.21+, strony od najnowszych; starszy: `/v1/sessions/<sesja>/messages`), zdrowie `GET /health`. Ścieżki i nazwy pól są w jednym miejscu (`HERMES_ROUTES` i
  `hermesEventOf` w `server/hermes-api.ts`); pola zdarzeń są czytane z kilku znanych wariantów nazw, bo rosły między wersjami.
- **Sesje Hermesa są kanoniczne.** `~/.desk-panel/hermes-chats/<id>.json` trzyma tylko mapowanie: id sesji Hermesa
  (`desk-panel-<id rozmowy>`, więc przebieg, który dotarł do Hermesa przed zapisem mapowania, i tak jest w tej sesji), id przebiegu
  każdej tury, to, co użytkownik napisał i wskazał (chipy), oraz jak tura się skończyła. Odpowiedzi i kroki narzędzi są tylko w
  Hermesie: po restarcie panelu okno czyta je z historii sesji. Pamięć, skills i narzędzia działają po stronie Hermesa tak, jak je
  skonfigurujesz (panel nie wyłącza niczego). Tury tej samej sesji napisane poza panelem (np. w CLI) są pokazywane na końcu rozmowy.
- **Pierwsza wiadomość sesji** zaczyna się od instrukcji `hermesPreamble()` (jak `preamble()` agy, ale z narzędziami panelu zamiast
  `curl`), potem blok `[Kontekst]` ze wskazanymi elementami i pytanie (`withContext`, ten sam co dla agy).
- **Strumień i odporność.** Delty tekstu, kroki narzędzi (z czasem trwania), prośby o zgodę, postęp (`notice` w wiadomości),
  koniec przebiegu. Gdy strumień się urwie, panel czyta stan przebiegu i łączy się ponownie z `Last-Event-ID` (zdarzenie o znanym id
  nie jest stosowane drugi raz; bez id strumień zaczyna od początku, więc pokazany fragment jest czyszczony zamiast dublowany). Po
  25 s ciszy panel sam pyta o stan przebiegu (rekonsyliacja). Na koniec ostateczna odpowiedź przebiegu wypełnia albo poprawia tekst
  ze strumienia (dostawca bez łatki strumieniowania daje 0 delt: odpowiedź i tak się pojawi, tylko bez pisania na żywo), a gdy
  i jej brak, panel bierze ją z historii sesji.
- **Restart panelu w trakcie odpowiedzi**: tura zapisana jako trwająca jest po starcie śledzona dalej (stan przebiegu, ponowny
  strumień), bez wysyłania czegokolwiek ponownie. **Restart Hermesa**: przebieg, którego Hermes już nie zna (404), kończy się
  komunikatem; to, co Hermes zdążył zapisać, jest w historii sesji.
- **Idempotencja**: każdy szkic ma `nonce`; ta sama wiadomość wysłana ponownie (np. po przekroczeniu czasu żądania) nie zaczyna drugiej
  tury (`ChatHub` pamięta wynik przez 10 min, a mapowanie Hermesa trzyma `nonce` tury na stałe).
- **Karty Cezara:** identyfikator wywołania w strumieniu może być samą nazwą narzędzia. Karta pozostaje nieaktywna, aż panel powiąże ją z wywołaniem z historii sesji; identyfikator karty zawiera również id odpowiedzi. Serwer sprawdza to ponownie przy decyzji. Dawny zapis decyzji wiąże się z kartą tylko przy jednym dokładnym dopasowaniu promptu; przy niejednoznaczności nowe decyzje są blokowane do diagnostyki. Równoczesne odpowiedzi na tę samą kartę są łączone w jednym procesie; brak potwierdzenia z Cezara po przekroczeniu czasu nadal wymaga sprawdzenia przed ponowieniem.
- Karta pokazuje workflow oraz domyślne wartości odczytane z konfiguracji Cezara; użytkownik może wybrać runner i model z listy. Dla runnerów obsługujących `/api/v1/models` lista pochodzi z katalogu Cezara; AGY nie ma tam katalogu, więc panel pokazuje bieżące presety `gemini-3.8-flash-low`, `-medium`, `-high`. Bez wyboru panel nie narzuca swojego modelu ani runnera: Cezar rozstrzyga je według konfiguracji workflow. Wybrane jawnie wartości są zachowane przy decyzji; nie są dowodem modelu faktycznie obsługującego przebieg. API zlecenia Cezara nie ma osobnego pola poziomu rozumowania.
- Instrukcja Wektora zabrania mu samodzielnie naprawiać stan i restartować usługi. Jest to instrukcja modelu, nie techniczna izolacja procesu Hermesa; nie należy traktować jej jako zabezpieczenia przed dostępem do plików lub powłoki.
- Instrukcja każe mu też pracować z dowodów, bo model flash zgadywał: ścieżki, hashe i id tylko z wyników narzędzi (najpierw
  wyszukanie, potem odczyt), wywołania zależne dopiero po wyniku, zawężone wyniki, przyczyna błędu tylko taka, jaką widać (ucięte
  wyjście Cezara mówi to wprost; Wektor wymyślił kiedyś asercję testu), błąd środowiska zgłaszany, nie obchodzony, i żadnych
  zmian kodu w repozytoriach (desk-panel kartą, inne projekty opisem do zlecenia w Cezarze). Przykład z diagnozą:
  [diagnostyka-czatu-wektora.md](diagnostyka-czatu-wektora.md). Preambuła trafia tylko do pierwszej wiadomości sesji: starsze
  rozmowy działają według instrukcji, z którymi się zaczęły.
- **Koszt kontekstu.** Wszystko, co zwróci narzędzie, zostaje w rozmowie i jest wysyłane ponownie przy każdym wywołaniu modelu
  (w rozmowie z 28.10.2026 wyniki narzędzi stanowiły 300 z 374 tys. znaków historii). Dlatego:
  - `TERMINAL_CWD` Hermesa to `~/.desk-panel/agent`, poza repozytoriami. Hermes dokleja `AGENTS.md` katalogu do wyniku narzędzia
    przy pierwszym dotknięciu katalogu, ale tylko wewnątrz katalogu roboczego. Przy `AndroidStudioProjects` jedna rozmowa
    dostała tak ok. 57 tys. znaków: `desk-panel\AGENTS.md` z głównego checkoutu i z worktree'ów oraz 29 tys. z `cezar\AGENTS.md`.
    API serwer Hermesa nie ma przełącznika `skip_context_files`, więc steruje tym tylko katalog roboczy.
  - `tool_output` w `config.yaml` (dopisuje `just hermes-setup`): wyjście terminala do 16 tys. znaków, z początkiem i końcem
    (wyniki testów są na końcu), `read_file` do 400 linii, linia do 600 znaków. Wartości domyślne Hermesa to 50 tys., 2000 i 2000.
  - `skills.creation_nudge_interval: 0` (też `just hermes-setup`): bez tego co 10 wywołań narzędzi Hermes po turze przegląda
    ją w tle (kilka kolejnych wywołań agy na tym samym limicie) i zapisuje lub łata skill. 28.10.2026 utworzył tak skill `cezar`,
    kopię „Zaimplementuj zadanie”, która rozjechałaby się z panelem przy pierwszej zmianie. Instrukcje skilli są w panelu
    (`src/chat-contract.ts`); co Hermes zmienił sam, zapisuje `%LOCALAPPDATA%\hermes\skills\.curator_ledger.jsonl`.
  - `agent.max_turns: 40` i `agent.budget_warning_ratio: 0.5` (też `just hermes-setup`): tura kończy się po 40 wywołaniach
    modelu, potem Hermes prosi go jeszcze raz, bez narzędzi, o podsumowanie, a przebieg kończy jako `failed` z tym
    podsumowaniem w `output`. Panel pokazuje je wtedy z wyjaśnieniem i podpowiedzią „dalej”. Przy 20. wywołaniu Hermes dokleja
    do wyniku narzędzia „iteration budget checkpoint”, na co skill „Zaimplementuj zadanie” wysyła rekonesans. Domyślnie
    limitu praktycznie nie ma; 28.10.2026 dyspozytor zrobił 87 wywołań narzędzi w 9 minut, w tym jedno wywołanie modelu na
    277 s z 36 narzędziami naraz. Przy limicie 30 następna próba skończyła się bez karty.
  - Kompresja historii Hermesa włącza się dopiero przy 50% okna modelu, czego przy oknie gemini-flash rozmowy panelu nie osiągają.
    Nie jest przestawiona, bo streszczenie to kolejne wywołanie agy.
  Zmiana katalogu lub limitów działa po restarcie usługi Hermesa (`just hermes RESTART`); Servy czyta manifest i `hermes.env`
  przy każdym starcie.
- **Limity czasu**: każde żądanie do Hermesa ma 15 s (zdrowie 3 s), połączenie strumienia 15 s; cała tura najwyżej 15 min
  (`DESK_HERMES_TURN_TIMEOUT_MS`), potem przebieg jest anulowany, a tura kończy się błędem. Nic nie czeka bez końca: zatrzymanie,
  na które Hermes nie odpowie w 10 s, kończy turę po stronie panelu.
- **Zawieszony model**: 6 min (`DESK_HERMES_SILENCE_MS`) bez żadnego zdarzenia, gdy nie działa narzędzie i nie czeka zgoda, przerywa
  turę z komunikatem, że model nie odpowiedział. To dłużej, niż provider `antigravity-oauth` czeka na jedno wywołanie (300 s), więc
  wywołanie na pewno zawisło. Hermes ponawia je jeszcze dwa razy z całą historią w świeżym procesie agy. 28.10.2026 każda próba
  zawisła tak samo i trzy próby wypełniły cały 15-minutowy limit tury w ciszy. Szybkie błędy modelu („stale”, źle sformatowane
  wywołanie narzędzia) kończą się w sekundy, więc te ponowienia działają dalej. Od pierwszej minuty ciszy wiadomość pokazuje, od ilu
  minut model nie odpowiada i kiedy panel przerwie turę.

### Zgody i wolne narzędzia

Hermes pyta o zgodę przed niebezpiecznymi poleceniami (np. powłoka). Okno pokazuje kartę „Agent prosi o zgodę” z narzędziem, poleceniem i
czasem oczekiwania oraz przyciskami **Zezwól** / **Odmów** (`POST /api/chats/<id>/approval`, `{approvalId, decision}`; id jest
sprawdzane, a prośba już rozstrzygnięta albo nieaktualna daje `409` bez wołania Hermesa). Panel wysyła zgodę jednorazową (`once`),
nigdy „na sesję” ani „zawsze”. Narzędzie, które działa ponad 20 s, pokazuje czas i zdanie, że to bywa wolne i że można zatrzymać.

W próbach takie wywołania trwały 53–68 s. Panel ogranicza to tak, że **dane panelu nie wymagają powłoki**: Hermes czyta je narzędziami
MCP `panel_*` (bez zgody, krótka odpowiedź tekstowa, bez surowego JSON-a), a instrukcja każe nie używać do tego `curl`. Zgody
zostają dla tego, co faktycznie ich wymaga.

### Narzędzia panelu (MCP)

`POST /api/mcp` (`server/panel-mcp.ts`): minimalny serwer MCP (Streamable HTTP, odpowiedzi JSON; `initialize`, `ping`,
`tools/list`, `tools/call`). Narzędzia są wąskimi adapterami do widoków dla agenta z [czat.md](czat.md) — ten sam tekst, ten sam
zakres co UI — z argumentami sprawdzanymi schematem przed wykonaniem:

| Narzędzie | Odpowiada |
| --- | --- |
| `panel_calendar`, `panel_training` | `from`, `to` (RRRR-MM-DD), `opisy` / `kroki` |
| `panel_znanylekarz` | karta wyboru terminu: profile, service, mode, opcjonalnie address, firstVisit, from/to; tylko anonimowy odczyt; rezerwuje użytkownik w osobnym oknie, a Google zapisuje jego potwierdzenie na karcie ([znanylekarz.md](znanylekarz.md)) |
| `panel_calendar_propose` | propozycja nowego wydarzenia: title, start, end, opcjonalnie location/description; karta zgody, bez zapisu narzędziem ([calendar.md](calendar.md)) |
| `panel_cezar` | opcjonalny `id` (`projekt/uuid`): bez argumentów lista zadań, z `id` szczegóły, kroki i błędy zadania; z `id` i `krok` (np. `verify`) wynik kroku: dla sprawdzeń linie błędów bez stosu i przechodzących testów, z ostrzeżeniem, gdy Cezar uciął wyjście (zapisuje tylko jego początek); dla kroku agenta (np. `analysis`) cały jego raport z `.ai/cezar/runs/<id>.ndjson` (do 24 tys. znaków), bo `summary` przebiegu trzyma tylko ostatnie 4000 |
| `panel_quotas`, `panel_system`, `panel_time` | bez argumentów |
| `panel_mail` | `limit` 1–50 |
| `panel_todos` | `list`, `ukonczone`, `stan` (id stanu); stan PL, blokada, powiązania i ostatnie 3 komentarze |
| `panel_bank` | `from`, `to`, `ruch`, `kategoria`, `etykieta`, `strona`, `nieprzypisane` (numery zamaskowane, jak w widoku) |
| `panel_todo_action` | jedna akcja list zadań (`todoActionSchema`), w tym setStatus, setBlocked, addComment, link i unlink; `by` wymuszone na `agent` ([zadania.md](zadania.md)) |
| `panel_cezar_action` | `archive`/`unarchive`/`read`/`unread` zakończonego zadania Cezara |
| `panel_recon_report` | `files` (ścieżka, notatka, `new` dla pliku do utworzenia), `kind` (UI/non-UI), `scenario`, `prompt`: karta rekonesansu; plików, których nie ma w repo (bez `new`), nie przyjmuje; wynik podaje `recon` (r-…, pamiętany 6 h, do restartu panelu) |
| `panel_cezar_propose` | `title`, `prompt`, `recon`, `workflow`, `todoId`: karta „Zlecić na Cezarze?”, tylko z `recon` znanym panelowi i tym samym promptem co rekonesans; zleca panel po kliknięciu użytkownika, nie narzędzie |

Karta odrzuconego wywołania mówi, dlaczego panel go nie przyjął, i nie ma „Zleć”; `POST /api/chats/:id/dispatch` też jej
odmawia (409). O przyjęciu decyduje tekst odpowiedzi (`CARD_SHOWN`, `cardRefusal` w `src/cockpit-contract.ts`), bo część
odczytana z historii sesji ma tekst, a nie flagę błędu. Po co: model flash wysłał rekonesans i propozycję w jednej paczce z
wyszukiwaniami, więc zlecenie powstało, zanim zobaczył choćby jeden wynik.
| `panel_cezar_watch` | `id` (`projekt/uuid`): stan taska jako JSON (status, kroki, postęp, tokeny, PR); karta na żywo, kokpit obserwuje ten task |
| `panel_cockpit_clear` | bez argumentów: kokpit rozmowy przestaje obserwować task |

Opisy narzędzi kokpitu (co, kiedy, skutek), także wizyty i propozycji wydarzenia Google, i ich reguły w preambule pochodzą z jednej tabeli `COCKPIT_TOOLS` w
`src/cockpit-contract.ts` (kontrakt kokpitu, zob. [czat.md](czat.md)).

Nie ma narzędzi do poczty, oznaczeń banku, zgód bankowych ani zlecania tasków Cezara (zleca okno czatu, gdy użytkownik kliknie kartę).
Okno rozpoznaje karty po nazwie narzędzia z przedrostkiem serwera (`mcp__desk_panel__panel_…` albo `mcp_desk-panel_panel_…`). Dostęp: tylko adresy loopback (nazwa Tailscale
dostaje `403`), żądanie z nagłówkiem `Origin` (przeglądarka) dostaje `403`, a bez tokenu `Authorization: Bearer <~/.desk-panel/mcp-token>`
dostaje `401`. Token tworzy panel przy pierwszym starcie (albo `DESK_MCP_TOKEN`) i `just hermes-setup`; leży poza Gitem.

### Hermes niedostępny

`GET /api/chats` zwraca też `engines` (`[{engine, available, error?}]`, zdrowie Hermesa sprawdzane najwyżej co 5 s) i `engine`
(preferowany). Gdy Hermes nie działa, okno pokazuje komunikat z powodem, **szkic i wskazane elementy zostają**, wysyłanie jest
wyłączone, a przyciski to „Przełącz na AGY” i „Sprawdź ponownie” (okno samo sprawdza co 15 s). Nie ma cichego przełączenia na AGY.
Wiadomość, której Hermes nie przyjął, nie trafia do rozmowy (`503` z powodem). Rozmowa Hermesa otwarta przy wyłączonym Hermesie
pokazuje pytania, a przy odpowiedziach „Nie można teraz wczytać odpowiedzi z sesji Hermesa…” — wrócą, gdy Hermes wstanie.

## Model

Od 28.10.2026 Hermes Wektora działa na **DeepSeek V4.1 Flash przez OpenRouter** (`model.provider: openrouter`,
`model.default: deepseek/deepseek-v4.1-flash-1017`, `base_url: https://openrouter.ai/api/v1` w obu `config.yaml`). Klucz
`OPENROUTER_API_KEY` wpisuje użytkownik w `~/.hermes/.env` i w `%LOCALAPPDATA%\hermes\.env` (tę kopię czyta usługa); ma limit wydatków
ustawiony w OpenRouter. Agent widzi pocztę, kalendarz i skróty z banku, więc `provider_routing.models.<model>.data_collection: deny`:
OpenRouter kieruje żądania tylko do dostawców, którzy nie trenują na danych. Serwer API Hermesa stosuje `provider_routing` tylko per
model, ogólne ustawienie nie wystarcza; `just hermes-setup` dopisuje wpis dla bieżącego modelu. Model zmienia się w configu bez
restartu (Hermes czyta go przy każdym przebiegu); powrót do agy: `provider: antigravity-oauth`, `base_url: agy://local`,
`default: gemini-3.8-flash-medium`. Codex i Claude zostają dla Cezara.

Ten sam klucz ma też OpenCode (`~/.local/share/opencode/auth.json`, wpis `openrouter`; Cezar działa na koncie użytkownika, więc
jego runner `opencode` go czyta), żeby taski Cezara mogły iść na DeepSeeku: `~/.config/opencode/opencode.jsonc` pokazuje z
OpenRoutera tylko `deepseek/deepseek-v4-pro-0813` i `deepseek/deepseek-v4.1-flash-1017` (`whitelist`, z `data_collection: deny`),
a karta zlecenia ma je w liście modeli runnera `opencode`. Przy wymianie klucza zmień go we wszystkich czterech miejscach (dwa
`.env` Hermesa, `panel.env`, ten `auth.json`). W `desk-panel-task` kroki implement/fix/address i review mają wykonawcę z workflow,
więc wybór DeepSeeka dotyczy tam tylko pozostałych kroków; w `analysis`, `implement` i `quick-task` obowiązuje cały run.

Wybór z trzech testów na tym samym zestawie (skill „Zaimplementuj zadanie”, prawdziwy panel, każdy model po razie): zadanie już zrobione
(PR niezmergowany), rozmowa o „zadaniach jako większym bycie” i obawa o podział zużycia, gdzie trzeba było odkryć, że `splitFor` nie ma
wywołania produkcyjnego. DeepSeek V4.1 Flash wypadł najlepiej za swoją cenę (0,015–0,04 USD za zlecenie, 1–2 min), Qwen 3.8 Max
równie trafnie, ale do 14 min i 0,57 USD, GLM 5.3 nierówno. Gemini 3.8 Flash przez agy powielił zrobione zadanie i przeoczył martwy
kod; Claude Sonnet i Opus przez agy myślały najlepiej, ale jedno zlecenie brało 4–8% tygodniowej puli Claude & GPT (agy słabo
cache'uje Claude'a). Szacunek kosztu w sesji Hermesa (`estimated_cost_usd`) zaniżał rachunek OpenRouter mniej więcej o połowę:
wydatki sprawdzaj w OpenRouter.

## Instalacja i uruchamianie (Windows)

Panel i Hermes to **dwie osobne usługi Servy**; żadna nie czeka na drugą przy starcie, więc kolejność po restarcie komputera jest
dowolna (panel pokazuje „Hermes niedostępny”, dopóki Hermes nie wstanie; narzędzia MCP odpowiadają, gdy wstanie panel).

1. **Zainstaluj Hermes Agent i provider `antigravity-oauth` z commitów w `servy/hermes.lock.json`** (provider jest potrzebny
   tylko do modeli agy; model domyślny idzie przez OpenRouter, zob. „Model”). Oba katalogi muszą być
   checkoutami Git: domyślnie `~/.hermes/hermes-agent` i `~/.hermes/plugins/antigravity-oauth`. Inne lokalizacje można wskazać
   zmiennymi `DESK_HERMES_SOURCE` i `DESK_HERMES_PROVIDER_SOURCE` w środowisku uruchamiającym skrypty. Provider musi być czysty.
   Nie używaj tymczasowych katalogów prób (PoC) jako docelowej instalacji.
2. `just hermes-setup` — idempotentne, niczego nie uruchamia i nie drukuje kluczy: włącza API server na `127.0.0.1:8642` z kluczem w
   `~/.hermes/.env` (nowy tylko, gdy go brak), wpisuje `DESK_HERMES_URL` i `DESK_HERMES_KEY` do `~/.desk-panel/panel.env`, tworzy
   `~/.desk-panel/mcp-token` i dopisuje `mcp_servers.desk-panel` do `~/.hermes/config.yaml` (gdy jest już inne `mcp_servers`, mówi,
   co dopisać ręcznie). Najpierw sprawdza commity i skrót łatki, a następnie stosuje ją do przypiętego źródła Hermesa (ponowienie
   jest bezpieczne); przy niezgodności kończy się błędem przed zmianą konfiguracji. Sprawdza, czy `hermes` leży tam, gdzie oczekuje
   `servy/hermes.json` (`executable`). Zainstalowany program musi korzystać z tego checkoutu; skrypt nie sprawdza ścieżki importu
   uruchomionego procesu.
3. Próba na pierwszym planie: `just hermes RUN` (Ctrl+C kończy), w drugim terminalu `just hermes CHECK` (wersja, łatka, `/health`).
4. Usługa: `just hermes-install` (Servy, start automatyczny, odzyskiwanie po awarii, logi w `servy/logs/Desk-Panel-Hermes`;
   okno poświadczeń Windows jak przy `just install`; to samo konto co panel). Potem `just hermes STATUS|START|STOP|RESTART`.
5. Panel: `just service RESTART` (czyta nowe `panel.env`). W oknie czatu przełącznik pokazuje Hermesa z zieloną kropką.

Konfiguracja usługi Hermesa jest w `servy/hermes.json` (`arguments: ["gateway"]` uruchamia gateway z API serverem; sprawdź
`hermes gateway --help` w swojej wersji), prywatne zmienne w `~/.desk-panel/hermes.env` (generowany przez `just hermes-setup` z `HERMES_GATEWAY_LOCK_DIR`), klucze w `~/.hermes/.env` oraz `%LOCALAPPDATA%\hermes\.env`.

| Zmienna (panel.env) | Domyślnie | Znaczenie |
| --- | --- | --- |
| `DESK_HERMES_URL` | `http://127.0.0.1:8642` | adres API servera; tylko `http` na loopback, bez danych logowania |
| `DESK_HERMES_KEY` | brak | `API_SERVER_KEY` Hermesa, wysyłany jako `Bearer`; tylko na backendzie |
| `DESK_HERMES_TURN_TIMEOUT_MS` | `900000` | najdłuższa tura |
| `DESK_HERMES_SILENCE_MS` | `360000` | cisza (bez narzędzia i zgody), po której tura jest przerywana jako zawieszony model |
| `DESK_MCP_TOKEN` | plik `mcp-token` | token narzędzi panelu dla Hermesa |

## Bezpieczeństwo

- Hermes i panel słuchają tylko na `127.0.0.1`. Klucz Hermesa nie trafia do przeglądarki, odpowiedzi API, dziennika czatu ani
  komunikatów błędów (test sprawdza, że odrzucony klucz nie jest cytowany).
- Telefon przez Tailscale widzi czat jak dotąd (te same trasy z kontrolą `Origin`), ale nie `/api/mcp`.
- Wszystko, co Hermes przeczyta narzędziami, trafia do dostawcy modelu, z którego korzysta (jak w agy). Hermes ma własne narzędzia
  (np. powłokę) — panel ich nie ogranicza; ogranicza je konfiguracja Hermesa i zgody.
- Usunięcie rozmowy w panelu usuwa mapowanie; sesja zostaje w Hermesie (jego historia, jego pamięć).

## Testy

- `server/hermes-chat.test.ts` — z atrapą API Hermesa po prawdziwym HTTP/SSE (`server/hermes-mock.ts`): strumień, narzędzia, druga tura w tej
  samej sesji, odtworzenie po restarcie panelu z historii sesji, zerwany strumień z `Last-Event-ID` i bez id, brak delt, cisza
  (rekonsyliacja przez stan przebiegu), zgoda i odmowa, stop, Hermes niedostępny, restart panelu i Hermesa w trakcie tury, limit
  czasu, `409`, preferencja i `nonce` w `ChatHub`, migracja starych rozmów agy.
- `server/panel-mcp.test.ts` — dostęp (token, `Origin`, nazwa Tailscale), protokół MCP, narzędzia na danych scenariusza, walidacja
  argumentów; trasy `/api/chats` z silnikami i zgodą.
- `src/chat.test.tsx` — domyślny Hermes, plakietki silnika (stare rozmowy = AGY), zapamiętany wybór AGY, przełączenie w otwartej
  rozmowie, Hermes niedostępny (szkic zostaje, ręczne AGY), ponowienie z tym samym `nonce`, karta zgody i czas wolnego narzędzia.
- `just scenario NAME` i `just screenshots NAME --open chat` używają tej samej atrapy (Hermes odpowiada ze skryptu; wiadomość ze słowem
  „zgoda” pokazuje prośbę o zgodę). `--open chat-answer` fotografuje skończoną turę z krokiem narzędzia, `--open chat-approval` kartę
  zgody, a `--hermes down` okno przy wyłączonym Hermesie.
- `server/hermes-lock.test.ts` — `servy/hermes.lock.json`: pełne commity Hermesa i providera, prawdziwy SHA-256 pliku łatki, łatka
  zmienia tylko bramkę strumienia w pliku `target` i tylko dla `antigravity-oauth` na `api_server`.
- Testów na prawdziwym Hermesie w repozytorium nie ma (wymagają działającej instalacji i klucza); po instalacji sprawdź ręcznie:
  `just hermes CHECK`, jedna tura z narzędziem `panel_calendar`, prośba o zgodę (np. polecenie powłoki), stop, restart panelu w trakcie
  odpowiedzi.

## Ograniczenia

- Podstawowe `/health`, `/v1/runs`, delty i zakończenie sprawdzono na izolowanym Hermesie z przypiętym providerem i AGY. Nie jest to
  dowód dla każdej ścieżki narzędzi i zgód; gdy kształt API się zmieni, poprawka to `HERMES_ROUTES` / `hermesEventOf` / `historyOf`
  w `server/hermes-api.ts` i atrapa.
- Historia z sesji nie zawiera próśb o zgodę ani czasów narzędzi: po restarcie panelu widać tekst i narzędzia, bez kart zgody.
- Gdy Hermes skompresuje albo rozdzieli sesję (nowe id), panel przyjmuje id sesji podane przez Hermesa w odpowiedzi przebiegu.
