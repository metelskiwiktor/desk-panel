# Czat z agentem

Mapa frontendu, zasady zmian GUI i powtarzalne przepływy przeglądarkowe: [wektor-ui.md](wektor-ui.md).

Wektor ma też kartę wyboru dnia i godziny wizyty ZnanyLekarz oraz kartę zgody na nowe wydarzenie Google Calendar.
Przepływ i granice potwierdzeń opisują [znanylekarz.md](znanylekarz.md) i [calendar.md](calendar.md). Samo wywołanie narzędzia
niczego nie rezerwuje ani nie tworzy w Google; zapis jest osobnym kliknięciem użytkownika, powiązanym z zakończoną kartą
w jego rozmowie. Zmiana schematów narzędzi wymaga restartu Hermesa, nowe przewodniki działają w nowych rozmowach.

Okno rozmowy z agentem (**Wektor**) otwierane przyciskiem w pasku u góry pulpitu. Okno pisze **tylko do Hermesa** (zob.
[hermes.md](hermes.md)): nie ma przełącznika silników, nowe rozmowy startują na Hermesie niezależnie od zapamiętanego wyboru, a
na liście są tylko rozmowy Hermesa. Silnik **AGY** (Antigravity CLI, `agy`, opisany niżej) zostaje na serwerze; jego stare
rozmowy (bez pola `engine`) dalej tam są, tylko okno ich nie pokazuje. Agent wie, kim jest, czym jest
panel i skąd bierze dane. To, co użytkownik **wskaże** na pulpicie, dostaje razem z wiadomością (to podpowiedź, o co pyta); resztę
(kalendarz, poczta, Cezar, trening, limity, komputer) **czyta sam** z lokalnego API panelu, tylko przez GET.

## Jak się tego używa

- **Przestrzeń Wektora** (`src/ChatWindow.tsx`, `src/cockpit/`): pełny ekran przeglądarki, boczna historia i rozmowa
  wykorzystująca pozostałą szerokość. Historia jest przeszukiwana lokalnie po nazwie lub ID (bez odczytywania treści wszystkich
  rozmów), grupowana według ostatniej aktywności i zwijana przyciskiem. Jej prawą krawędź można przeciągać; szerokość jest
  zapamiętywana lokalnie. Separator obsługuje też strzałki (Shift przyspiesza), Home/End i dwuklik przywracający domyślną szerokość.
  Na małym ekranie historia otwiera się jako szuflada. Lista rozmów odświeża się co 30 s przy widocznej karcie, po powrocie do
  niej i po fokusie okna (`src/useChat.ts`), więc rozmowa zaczęta gdzie indziej (telefon, test) pojawia się sama.
  Wybranie rozmowy ją **kontynuuje**. Ostatnia rozmowa Hermesa jest pamiętana lokalnie również po przeładowaniu strony.
  Powrót do niedawno otwartej rozmowy pokazuje jej własny podgląd z pamięci bieżącego okna (do 8 rozmów i kokpitów;
  odczyty kart do 32). SSE i kokpit nadal odświeżają dane z serwera. Zgody i wysyłanie czekają na aktualny stan;
  wybór i zapis wizyty dodatkowo czekają na świeży odczyt jej karty. Podglądy nie trafiają do localStorage.
  Układ automatycznego kokpitu pozostaje zarezerwowany podczas odczytu następnej rozmowy, bez pokazywania poprzedniego taska.
- **Kokpit**: domyślnie automatyczny — zajmuje miejsce dopiero przy wizycie, jawnym monitorowaniu taska/PR-a lub błędzie
  odczytu. Ma też tryby pełny, skrócony i ukryty; wybór jest zapamiętywany. Szczegóły rozmowy (ID, rozpoczęcie i czas ostatniej
  wiadomości) można otworzyć przyciskiem po prawej nawet bez taska. Karty zgody są częścią rozmowy; kokpit mieści podglądy,
  metadane i wybór terminów na tle kalendarza. Na wąskim ekranie oraz w widoku kompaktowym są zakładki „Czat” / „Kokpit”.
- **Widoki i klawiatura**: minus przechodzi do kompaktowego, działającego czatu obok pulpitu, ikona rozwinięcia wraca do
  pełnego ekranu, a `×` ukrywa Wektora. `Alt+W` przełącza: ukryty → kompaktowy → pełny → ukryty. **Lewy Ctrl + lewy Alt**
  natychmiast przełącza wskazywanie włącz/wyłącz (obie kolejności klawiszy działają, autorepeat nie przełącza wielokrotnie).
  Puszczenie klawiszy nie wyłącza wskazywania; po jego zakończeniu Wektor zostaje po prawej w widoku kompaktowym.
  Wskazywanie i widok kompaktowy mają identyczne położenie i rozmiar: prawie pełną wysokość ekranu na komputerze i 72% na telefonie.
  Sam Ctrl, sam Alt i kombinacje Ctrl+C/V/A nie zmieniają widoku. Prawy Alt (AltGr) pozostaje do polskich znaków.
  Utrata fokusu czyści stan fizycznych klawiszy, bez zmiany przełącznika wskazywania. „Gotowe”, Esc i zamknięcie czatu kończą
  wskazywanie, a Alt+W je kończy i przełącza widok. Kliknięcia dodają
  kontekst do szkicu, nigdy same nie wysyłają wiadomości.
  `Esc` zamyka najpierw menu komend lub skillów, wskazywanie albo szufladę historii, potem ukrywa okno. Pełny ekran zatrzymuje fokus
  klawiatury w oknie; animacje respektują `prefers-reduced-motion`.
- **Załączniki**: w polu wiadomości `Ctrl+V` wkleja obraz ze schowka, upuszczenie pliku na okno czatu go dodaje, a spinacz
  otwiera wybór plików. Przed wysłaniem widać miniatury obrazów albo chipy plików (nazwa, typ, rozmiar) z „Usuń załącznik”.
  Najwyżej 4 załączniki; obraz do 5 MB (PNG/JPEG/WebP/GIF), plik do 5 MB (TXT/MD/CSV/JSON), łącznie do 6 MB
  (limity plików liczone w MiB: 1 MB w interfejsie = 1 048 576 bajtów). Kompozytor pokazuje limity i przyczynę odmowy.
  Serwer sprawdza rzeczywiste bajty: sygnaturę PNG/JPEG/WebP/GIF oraz jej zgodność z deklarowanym MIME; SVG odrzuca
  także pod typem tekstowym. Tekst musi być poprawnym UTF-8 (bez zastępowania błędnych sekwencji).
  Całe żądanie do Hermesa po serializacji JSON musi mieć **mniej niż 9 000 000 bajtów**; serwer liczy również preambułę,
  kontekst, tekst i data URL obrazów, przed utrwaleniem oczekującej tury i przed wywołaniem Hermesa. Przekroczenie daje 413.
  Przekroczenie limitu albo obcy typ
  daje czytelny komunikat i nic nie jest wysyłane. PDF jest na liście wyboru, ale panel go jeszcze nie czyta: „PDF jeszcze
  nieobsługiwany” (Hermes odrzuca części plikowe, a w zależnościach nie ma czytnika). Obrazy idą do Hermesa w tej samej turze
  jako części `image_url` (data URL), a treść plików tekstowych — w części tekstowej z nagłówkiem nazwy (do 20 000 znaków na plik,
  nadmiar ucięty z informacją). Po wysłaniu wiadomość pokazuje miniatury (klik otwiera pełny obraz) i chipy (klik pobiera) nad
  tekstem, także po przeładowaniu i w kolejnych turach. Bajty leżą w `~/.desk-panel/chat-files/<id rozmowy>/<id pliku>.<rozszerzenie>`
  (poza Gitem), a rozmowa trzyma tylko odnośnik (id, nazwa, typ, rozmiar). `GET /api/chats/<id>/files/<fileId>` serwuje plik
  wyłącznie z jego rozmowy (walidacja id, `Content-Type` z białej listy, `Content-Disposition` dla nie-obrazów,
  `X-Content-Type-Options: nosniff`); usunięcie rozmowy, także tymczasowej, usuwa jej katalog.
  Rozmowa jest zajmowana przed pierwszym asynchronicznym zapisem; równoległa wysyłka dostaje 409.
  Każdy plik powstaje przez plik tymczasowy i atomowe rename. Wycofanie tury sprząta wyłącznie jej pliki, także po częściowym
  zapisie. Oczekująca tura utrwalona z `nonce` zachowuje pliki po błędzie startu Hermesa; ponowienie tego samego `nonce`
  (również utworzenia rozmowy po restarcie) używa tej samej rozmowy, zamrożonego żądania i plików.
- **Szkice**: tekst i wskazane elementy są zapisywane lokalnie osobno dla każdej rozmowy oraz dla nowej, jeszcze niewysłanej
  rozmowy (`src/chat-draft.ts`). Zmiana rozmowy ani widoku nie przenosi szkicu do innego czatu. Przyjęcie wiadomości przez
  serwer czyści tylko wysłany szkic; błąd go zachowuje. Stary wspólny szkic jest jednorazowo przenoszony do nowej rozmowy.
- **Rozmowa to gotowe komponenty assistant-ui**: `Thread` z ich rejestru shadcn (`src/components/thread.aui.tsx` i to, czego
  używa: markdown, wiersz narzędzia, grupa narzędzi, `src/components/ui/*`), skopiowany do repo i dopasowany: polskie
  etykiety, bez załączników, edycji, ponawiania i gałęzi (runtime panelu ich nie ma) i ze slotami na rzeczy panelu
  (`ComposerHeader`, `ComposerTop`, `ComposerExtra`, `UserMessageHeader`, `AssistantMessageFooter`, `composerInput`).
  Panel wpina w nie (`src/cockpit/Thread.tsx`): picker skillów `@`, chipy wskazanych elementów, kartę „Hermes nie odpowiada”,
  komunikaty o przebiegu, a karty skilli rejestruje jako „tool UI” po nazwie narzędzia (`display: 'standalone'`, więc nie
  chowają się w zwiniętej grupie). Zwykłe kroki narzędzi zwijają się w wiersz „N narzędzi”. Komponenty dodaje się przez
  `npx shadcn add https://r.assistant-ui.com/<nazwa>.json` (`components.json`: prefiks `tw`, alias `@/` → `src/`); po
  aktualizacji z rejestru trzeba ponownie nanieść zmiany opisane na górze `thread.aui.tsx`.
- **Karty w rozmowie**: narzędzia o znanych nazwach mają własne karty (`src/cockpit/cards.tsx`): rekonesans
  `@Zaimplementuj zadanie` (kroki, przeszukane pliki, typ UI/non-UI, prompt dla executora), **zgoda przed zleceniem na
  Cezarze** („Zleć na Cezarze”, „Edytuj prompt”, „Odrzuć”), nasłuchiwanie Cezara (pasek postępu i kroki worktree) i prośba
  Hermesa o zgodę na narzędzie. Inne narzędzia to zwijany wiersz.
- **Hermes niedostępny**: nad polem wiadomości karta „Hermes nie odpowiada” z przyciskiem „Ponów próbę” (pyta serwer
  jeszcze raz); szkic i wskazane elementy zostają, nic nie jest wysyłane.
- **Kontrakt kokpitu i Hermesa** (`src/cockpit-contract.ts`, `COCKPIT_TOOLS`): kokpit nie zgaduje, którego taska
  dotyczy rozmowa. Obserwuje task tylko po jawnym zdarzeniu w rozmowie, a liczy się ostatnie: zlecenie z karty
  (`panel_cezar_propose` + „Zleć”), wywołanie `panel_cezar_watch` z id taska, albo `panel_cockpit_clear` (koniec
  obserwowania). Id taska w tekście, w plikach czy w innych narzędziach nic nie zmienia. Rozstrzyga to `watchedTask` na
  serwerze, z rozmowy, jaką ma czat; okno nie podsuwa żadnego id. Z tej samej tabeli powstają opisy narzędzi MCP
  („co, kiedy, skutek”; `cockpitToolDescription`), a preambuła Hermesa (`cockpitRules()`) podaje tylko krótkie granice i
  nazwy narzędzi pogrupowane (karty, bez karty, tylko run automatu), żeby nie powtarzać całej tabeli w każdej sesji.
  Instrukcja i zachowanie się nie rozjeżdżają; nowe narzędzie kokpitu to nowy wiersz tabeli i test w `server/cockpit.test.ts`.
- **Skąd kokpit ma dane** (`server/cockpit.ts`, `GET /api/chats/:id/cockpit`, tylko odczyt): status, kroki worktree, tokeny, worktree (ścieżka w projekcie) i PR czyta z runu Cezara; tytuł, stan
  i checki CI PR-a z GitHub CLI (`gh pr view --json …`, bez powłoki, co 20 s, gdy coś trwa, co 5 min po rozstrzygnięciu;
  bez `gh` karta mówi, że checki są nieznane). REVIEW to zakończony run z otwartym PR-em, DONE po scaleniu. Okno pyta
  co 5 s, gdy task albo check trwa, inaczej co 30 s.
- **Zlecenie z karty** (`POST /api/chats/:id/dispatch`, Origin-checked): Hermes tylko proponuje (`panel_cezar_propose`);
  „Zleć na Cezarze” albo „Zleć z poprawkami” to panel wywołujący `cezarCreateRun` z promptem w wersji użytkownika, raz na
  kartę (drugie kliknięcie zwraca to samo). Odpowiedź (też „Odrzuć”) i powiązania (rozmowa → runy) panel trzyma
  w `~/.desk-panel/cockpit.json` (poza Gitem, same id i prompty), więc karta pokazuje decyzję także po restarcie.
- **Zastąpione karty zgody** (`supersededConsentCards` w `src/consent-cards.ts`, wspólnie dla okna i serwera): Wektor może
  zaproponować tę samą zmianę kilka razy w jednej rozmowie (np. regułę Inea poprawianą kolejno). Późniejsza propozycja
  tego samego rodzaju i celu zastępuje wcześniejszą: Smart Actions — to samo `id` reguły (nazwa tylko, gdy propozycja nie ma
  `id`); automat — ten sam `replaces` albo nowy automat o tej samej nazwie (po przycięciu i bez wielkości liter); karty
  konta (scalanie, masowe oznaczenie) — dowolna późniejsza karta tego samego rodzaju. Ten sam identyfikator karty liczy się
  raz, na ostatnim wystąpieniu, więc A → B → A zostawia A, a zastępuje B. Zastąpiona i jeszcze niezdecydowana karta nie ma
  przycisków i mówi „Zastąpiona nowszą propozycją niżej.”; karty już rozstrzygnięte się nie zmieniają. Serwer też odmawia
  wykonania takiej karty: `POST /api/chats/:id/bank-plan`, `/smart-rule` i `/automation` zwracają 409 z komunikatem, bo
  schowanie przycisków w oknie jest wygodą, a bezpieczeństwem jest ta kontrola po stronie serwera. Karta, na którą
  użytkownik już odpowiedział, zwraca swoją zapisaną odpowiedź także wtedy, gdy późniejsza propozycja ją zastąpiła
  (ponowienie po zgubionej odpowiedzi nie kończy się 409); 409 dostają tylko niezdecydowane zastąpione karty. Odpowiedzi
  na karty jednej rozmowy są wykonywane kolejno (jedna kolejka na rozmowę), a zastąpienie jest sprawdzane ponownie tuż
  przed zapisem: dla banku i Smart Actions po podglądzie, dla automatu w sekcji krytycznej tworzenia, po odczytach
  Cezara/PR i przed zapisem — po każdym `await`, więc wolna karta nie nadpisze nowszej.
- **Makieta i zrzuty**: `?cockpit=mock` w adresie gra cały przebieg bez serwera (`&hermes=down` bez Hermesa,
  `&cockpitSpeed=0.3` szybciej); `just screenshots standard --pages pulpit --open cockpit-approval` (także `cockpit`,
  `cockpit-recon`, `cockpit-watch`, `cockpit-review`). Prawdziwy przebieg na zastępczym Hermesie scenariusza, z runem
  i PR-em zmyślonymi przez scenariusz: `--open chat-dispatch`, `chat-dispatched`, `chat-review`.
- **Style**: powłoka, historia, kokpit i menu skillów mają wspólne style i tokeny w `src/cockpit/wektor.css`; istniejące karty
  i assistant-ui nadal używają Tailwind CSS v4 (`src/cockpit/cockpit.css`), bez nowej biblioteki: klasy z prefiksem `tw:`, bez preflight,
  utilities jako `!important`, skanowane tylko `src/cockpit`, `src/ChatWindow.tsx`, `src/components` i `src/lib`. Kolory
  shadcn (`background`, `muted`, `primary`…) są paletą panelu jako zmienne `--ck-…` (panel ma własne `--muted`), a wariant
  `dark:` działa w czacie zawsze; reszta panelu ma swoje style bez zmian.
- **Wskaż element**: Wektor przechodzi do widoku kompaktowego przy prawej krawędzi, a pulpit mieści się obok niego
  (górny pasek zawija się pod zegar). Każdy kliknięty element (mail, zadanie Cezara, spotkanie, trening albo cały
  kafelek: Poczta, Cezar, limity, pasek dnia, cała strefa „Najbliższe dni” i pojedynczy dzień w niej) trafia do wiadomości
  jako chip. Kliknięcie jeszcze raz zdejmuje go z kontekstu. W tym trybie kliknięcia **nie uruchamiają** niczego na pulpicie,
  z wyjątkiem elementów oznaczonych `data-pick-through` (menu pulpitów wirtualnych): można przełączyć pulpit i wskazać kafelek
  z innego. `Esc`, „Gotowe” lub strzałka w nagłówku kończą wskazywanie i pozostawiają czat w widoku kompaktowym.
  Cała strefa „Najbliższe dni” niesie w kontekście każdy widoczny dzień z jego wydarzeniami i treningami (pusty dzień bez
  pozycji), w zakresie zgodnym z rozmiarem: siedem dni albo pięć tygodni.
- **Wysyłanie**: `Enter` wysyła, `Shift+Enter` to nowa linia. Podczas odpowiedzi przycisk wysyłania zamienia się w „Zatrzymaj”.
- **Wybór skillów (`@`)**: wpisanie `@` w polu czatu otwiera listę skillów (`@Zaimplementuj zadanie`, `@Nasłuchuj Cezara`: tylko odczyt statusu taska). Wybranie skilla (`Enter`, `Tab` albo kliknięcie) zamienia wpisany token `@…` na podświetlony chip kontekstu z przyciskiem `×` (jak wskazany element pulpitu). Skill `@Zaimplementuj zadanie` robi rekonesans tylko do odczytu i proponuje zlecenie kartą zgody. Agent sam nie uruchamia Cezara: dopiero kliknięcie użytkownika wysyła z panelu `POST /api/chats/:id/dispatch`; backend odczytuje propozycję z tej rozmowy i zwraca powiązanie z taskiem.
- Rozmowę można usunąć (kosz, wymaga drugiego dotknięcia). Nazwę zmienia się w nagłówku rozmowy (Enter zapisuje, Esc anuluje, pusta lub niezmieniona się nie zapisuje); tak nadanej nazwy panel już nie nadpisuje.
- Wąski ekran (telefon przez Tailscale): pełny widok zajmuje cały ekran, kompaktowy i wskazywanie są u dołu.

## Automatyka

Turę Wektora zaczyna wiadomość użytkownika albo automatyka panelu. Tura automatyki jest w rozmowie oznaczona
(`automation: {source, reason}` na wiadomości, etykieta „Automatyka · Cezar” albo „Automatyka · Obserwator” i inny wygląd
niż wiadomość użytkownika w `src/cockpit/Thread.tsx`), w treści ma powód, a serwer loguje jej wysłanie. Wszystkie automatyki wyłącza
`DESK_AUTOMATIONS=0` (albo `false`, `no`, `off`) w `panel.env`; domyślnie są włączone. Tryb scenariusza nie tworzy
serwisu obserwatorów (ich karta w Ustawieniach czyta wiersze z fixtures), więc zrzuty ekranu nie wysyłają tur
automatycznych. Limity AI dalej nie wysyłają promptów, a agent nadal nie zleca Cezara sam: dispatch jest tylko z karty,
zapisy przez karty zgody.

Pierwsza automatyka — obserwator Cezara:

- Dotyczy tylko tasków zleconych z rozmowy: panel bierze `taskId` z zapisanych dispatchy (`~/.desk-panel/cockpit.json`,
  `cockpit.dispatched()`).
- Zdarzenia pochodzą z odczytów Cezara, których panel już dokonuje: aktywne z `sources.cezar().tasks`
  (`needs-input` = czeka na użytkownika), zakończone z `onFinished`. Nie ma nowego odpytywania; szczegóły jednego taska
  (krok, błąd, PR) czyta istniejący `cezarRun`.
- Jedno zdarzenie na task i stan: klucz `taskId|stan` (`input`, `done`, `failed`) jest zapisany w `cockpit.json`, więc
  ponowny odczyt i restart nie wysyłają go drugi raz.
- Po starcie panelu raportowane są tylko taski, które ten proces zobaczył jako aktywne; zakończone wcześniej, stare wpisy
  nie zalewają rozmów. Zakończony task, którego panel nie zdążył zobaczyć jako aktywnego, nie jest raportowany.
- Gdy rozmowa jest w trakcie tury, panel nie przerywa: zdarzenie czeka i jest wysyłane przy następnym odczycie, gdy
  rozmowa będzie wolna. Rozmowa usunięta albo silnik niedostępny są pomijane z wpisem w logu.
- Treść niesie id i tytuł taska, stan, krok, błąd (gdy nieudany) i PR, jeśli jest, i kończy się prośbą: podsumuj wynik,
  zaproponuj następny krok, nic nie zlecaj sam.
- Do Hermesa trafia jako zwykły tekst z prefiksem `[Automatyka · Cezar] <powód>`, a preambuła mówi, jak na taką turę
  odpowiadać.

Druga automatyka — automaty Wektora (`panel_observe`, `panel_automation_*`, `server/automations.ts`, widok Automaty):

- Wektor tworzy automaty cykliczne (`daily`/`weekly`) kartą zgody `panel_automation_propose` (zapis dopiero po kliknięciu,
  `POST /api/chats/:id/automation`, Origin-checked, plan z wywołania narzędzia w tej rozmowie) oraz jednorazowe
  (`once`/`cezar`/`pr`) bez karty przez `panel_observe`, na prośbę użytkownika. Stare obserwatory z `observers.json` migrują
  się przy wczytaniu do `~/.desk-panel/automations.json`. Decyzja karty jest trzymana w `~/.desk-panel/cockpit.json` po
  `toolCallId`: odpowiedź dwa razy tworzy automat raz, a po przeładowaniu karta pokazuje „Utworzono automat …” z linkiem
  do widoku Automaty.
- Run cykliczny to nowa rozmowa Hermesa (świeży kontekst, tytuł `Automat · <nazwa> · <data>`), oznaczona jako tura
  automatyki. Run jednorazowy wraca do rozmowy automatu. Treść runu niesie cel, warunek celu, notatnik, ostatnie runy i
  polecenie wywołania `panel_automation_report` na końcu.
- `panel_automation_report {runId, …}` jest przyjmowany tylko w turze automatyki z tym samym otwartym runem (id jest w
  treści tury); `done` kończy cel i harmonogram, a notatnik zmienia się tylko przy `learn = true` (poprzednia wersja zostaje
  w runie). Brak raportu po 15 minutach to błąd. Po `done`/`error` panel wysyła krótką wiadomość do rozmowy automatu.
- Zegar chodzi co minutę tylko przy aktywnych automatach, jeden tick naraz; po restarcie zaległy run idzie najwyżej raz.
  `DESK_AUTOMATIONS=0` blokuje tworzenie, raportowanie i runy, ale lista działa.
- Strony WWW run czyta terminalem jako dane, nie polecenia; akcje tylko zatwierdzone. Widok Automaty (`GET
  /api/automations`, `POST /api/automations/action` z Origin) jest dwupanelowy: lista z kropkami stanu i runów po lewej,
  szczegóły z osią runów (najnowszy rozwinięty) i ramkami Wektora/celu po prawej, plus notatnik i stany.
## Co widzi agent

Pierwsza wiadomość rozmowy zaczyna się od instrukcji (`preamble()` w `server/agent-chat.ts`: kim jest, czym jest Desk Panel,
że ma odpowiadać po polsku i zwięźle, jakie endpointy API panelu może czytać i jak). Kolejne wiadomości jej nie powtarzają: ten
sam proces `agy` pamięta rozmowę, więc **zmiana instrukcji dotyczy tylko nowych rozmów**. Wskazane elementy idą przed pytaniem:

```
[Kontekst: elementy pulpitu wskazane przez użytkownika]
1. Mail: Anna Nowak: Spotkanie w czwartek
   Od: Anna Nowak
   ...

[Wiadomość]
Zrób z tego zadanie na jutro.
```

### Co można wskazać

Element jest wskazywalny, jeśli ma atrybuty `data-ctx-*`. Dodaje je `ctx()` z `src/chat-context.ts`:

```tsx
<li {...ctx('mail', thread.id, `${thread.from}: ${thread.subject}`, 'Od: ...\nTemat: ...')}>
```

`ctx(kind, id, title, text?)`: `kind` to `mail | event | task | workout | tile | todoList | todo` (`task` to zadanie Cezara; `todoList` i `todo` to lista i zadanie z list, zob. [docs/zadania.md](zadania.md)); bez `text` agent dostaje to, co użytkownik widzi
w elemencie (`innerText`). Wskazywany jest **najbliższy** oznaczony element, więc wiersz poczty wygrywa z kafelkiem Poczta,
a kliknięcie w nagłówek kafelka wskazuje cały kafelek. Nowy rodzaj elementu to jedno `ctx()` w komponencie (plus rodzaj w
`contextKinds` w `src/chat-contract.ts`, jeśli nie pasuje żaden istniejący). Limity: do 10 elementów na wiadomość, 2000 znaków
tekstu na element (UI skraca do 1800).

## Jak to działa

```
ChatWindow ── useChat ── /api/chats… ── ChatService (server/agent-chat.ts) ── agy (proces na rozmowę)
   │            │  SSE: /api/chats/<id>/events                                    stdin/stdout: stream-json
   chat-context (wskazywanie)
```

- **Identyfikator rozmowy należy do panelu** (uuid); identyfikator rozmowy `agy` jest zapisany obok jako `agy`. Dzięki temu
  inny silnik niż `agy` nie wymagałby zmian w UI (zmiany byłyby po stronie serwera, zob. „Szwy do rozszerzania”): UI zna tylko `ChatMessage` z `src/chat-contract.ts` (tekst i kroki narzędzi
  w kolejności, status `streaming | done | error | stopped`).
- **Proces na rozmowę**: `agy --output-format stream-json --input-format stream-json [--conversation <id>] -p ''`. Wiadomość to
  linia `{"event":"user","message":{"content":"…"}}` na stdin. Proces obsługuje wiele tur. Po 10 minutach bezczynności
  serwis zamyka stdin (proces kończy się sam); kolejna wiadomość uruchamia `agy --conversation <id>`, a rozmowa toczy się dalej
  z pamięcią (sprawdzone na prawdziwym `agy`).
- **Zdarzenia z `agy`** (jedna linia JSON na zdarzenie): `init` (daje `conversation_id`), `step_update` (`step_type`:
  `user_input | agent_response | tool | system_message`, `state`: `ACTIVE | DONE`, `text_delta`, `tool_name`,
  `tool_info.{name,parameters,output}`) i `result` (`status`: `SUCCESS | ERROR`, `response`, `error`). Odpowiedź składa się
  ze strumienia; puste kroki „myślenia” znikają; `result.response` wypełnia odpowiedź, gdy strumień nie dał tekstu.
- **Strumień do przeglądarki**: `GET /api/chats/<id>/events` (SSE). Najpierw jedno zdarzenie `state` (cała rozmowa), potem
  `update` (podsumowanie i zmieniona wiadomość), łączone co ok. 40 ms. `EventSource` sam się łączy ponownie i dostaje `state`
  od nowa, więc nic nie ginie po przerwie.
- **Zapis**: `~/.desk-panel/chats/<id>.json` (zapisy jednej rozmowy są szeregowane; plik ma `engine: "agy"`, a plik bez tego pola, sprzed Hermesa, dostaje je przy wczytaniu, reszta bez zmian). Wiadomość „w trakcie” z poprzedniego
  uruchomienia panelu jest po starcie oznaczana jako przerwana. Katalog roboczy agenta: `~/.desk-panel/agent`.
- **Model i reasoning**: każdy proces dostaje `--model`. Domyślnie `gemini-3.8-flash-medium` (Gemini 3.8 Flash, Medium); zmienia go
  `DESK_AGY_MODEL` (lista identyfikatorów: `agy models`). Poziom reasoningu jest częścią identyfikatora modelu (`-low|-medium|-high`),
  więc `--effort` (`low|medium|high|xhigh|max`) jest dodawany tylko wtedy, gdy ustawiono `DESK_AGY_EFFORT`. Zmienne
  (jak `DESK_AGY_BIN`, np. w `panel.env`) obowiązują po restarcie usługi i dotyczą każdego nowo uruchamianego procesu `agy`, także
  wznowień starych rozmów: model nie jest zapisany w rozmowie.
- `agy` jest szukany w `DESK_AGY_BIN`, potem w `%LOCALAPPDATA%\agy\bin\agy.exe`, `~/.agy/bin`, `~/.local/bin`. Przy zatrzymaniu
  lub zamknięciu serwisu proces i jego dzieci są kończone (`taskkill /T` na Windows).

### Agent czyta dane panelu sam

Instrukcja mówi agentowi, że ma powłokę i może pobierać dane z API panelu pod adresem usługi (`DEFAULT_PANEL_URL` albo opcja
`panelUrl`; `server/index.ts` podaje `127.0.0.1:<DESK_PORT>`). Nie dostaje surowego JSON-a dla UI (czasy w milisekundach UTC,
identyfikatory, adresy, całe opisy), tylko **widoki dla agenta**: `GET /api/agent/<widok>` zwraca krótki tekst po polsku z czasem
lokalnym (`server/agent-views.ts`, jeden moduł, widoki są czystymi funkcjami nad `PanelSources`, więc działają też w trybie
scenariusza):

| Widok | Parametry | Co w nim jest |
| --- | --- | --- |
| `calendar` | `from`, `to` (RRRR-MM-DD, włącznie; domyślnie dziś i sześć dni, najwyżej 42), `opisy=1` | wydarzenia z dniem tygodnia, godzinami, miejscem; całodniowe jako zakres dni |
| `training` | `from`, `to`, `kroki=1` | plan Garmin, zaplanowane treningi i zapisane aktywności z zakresu |
| `cezar` | | liczniki, zadania aktywne i zakończone, niezarchiwizowane (do 40, każde zakończone z `id=projekt/uuid` do akcji poniżej) |
| `mail` | `limit` (1–50, domyślnie 10) | nieprzeczytane z 30 dni: nadawca, temat, początek; bez treści |
| `quotas`, `system` | | limity AI z resetami w czasie lokalnym; CPU i RAM |
| `todos` | `list` (id lub fragment nazwy), `ukonczone=1`, `stan` (id stanu) | listy zadań z id, stanem PL, blokadą, powiązaniami i ostatnimi 3 komentarzami; ukończone domyślnie tylko policzone, jawny stan wybiera też terminalne (zob. [docs/zadania.md](zadania.md)) |
| `bank` | `from`, `to` (domyślnie ostatnie 30 dni, najwyżej 400), `ruch` (wydatek, przychód, rozliczenie, przełożenie), `kategoria` (także źródło), `etykieta`, `strona` (fragment nazwy), `nieprzypisane=1` | saldo, przychody, wydatki i netto, wydatki według kategorii i przychody według źródła, salda rozliczeń z każdą stroną z całej zapisanej historii, operacje z ruchem, kategorią albo źródłem, drugą stroną, etykietami, cyklicznością, opisem, „do przypisania” i podpowiedzią albo wyborem (zob. [docs/bank.md](bank.md)) |

Nagłówek kalendarza i treningu mówi, jaki jest dziś i z kiedy są dane; źródło bez danych daje wiersz „brak danych (status: …)”, nie
pustą listę. `cezar` z parametrem `id` (narzędzie `panel_cezar`) zwraca domyślnie status, błąd główny, kroki do dokończenia i krótki
ogon wyniku (linie błędów i koniec testów); pełny wynik jednego kroku dopiero z `krok`. Błędny zakres to `400` z tekstem, nieznany widok `404`. Zakres dni liczy się w strefie źródła (także w dniu zmiany
czasu). Odczyty GET nie wymagają `Origin`, więc zwykłe `curl.exe` działa; w PowerShellu `curl` to alias, dlatego instrukcja podaje
`curl.exe`, a adres w cudzysłowie (jest w nim `&`). Zakres danych jest ten sam co w UI. Zwykłe trasy JSON (`/api/calendar` itd.) zostają
dla UI, a instrukcja każe agentowi ich nie używać. Do panelu agent ma słać tylko GET, z dwoma wyjątkami opisanymi w instrukcji. (1) Na prośbę użytkownika może zmieniać **zakończone zadania
Cezara** (`archive`, `unarchive`, `read`, `unread`) przez `POST /api/cezar/action` z nagłówkiem `Origin` równym adresowi panelu i ciałem
`{"id":"projekt/uuid","action":"archive"}` (id z widoku `cezar`; odpowiedź `{"ok":true}`). Archiwizacja jest odwracalna, a zadań nie da się
usunąć. (2) **Listy zadań użytkownika** (`POST /api/todos/action`, tak samo z `Origin`; akcje i zasady w [docs/zadania.md](zadania.md)): agent tworzy listy, dodaje zadania z `"by":"agent"`, zaznacza je i przenosi. Samo „zadanie” oznacza zadanie z listy, a Cezar tylko wtedy, gdy użytkownik go nazwie albo wskaże jego kafelek. Inne zapisy (`POST` poczty, czat) są technicznie możliwe, bo `Origin` chroni przeglądarkę, a nie `curl`, więc ogranicza agenta
wyłącznie instrukcja. Oznaczeń operacji bankowych (`POST /api/bank/labels/action`) agent nie zmienia wcale: instrukcja mu tego
zabrania, choć technicznie mógłby to zrobić `curl`-em, jak każdy zapis.

**Dane banku a dostawca modelu.** Widok `bank` daje agentowi saldo, operacje (dzień, kwota, czysta nazwa sprzedawcy albo
kontrahenta, tytuł przelewu z zamaskowanymi numerami) i oznaczenia użytkownika (kategorie, osoby po imieniu, komentarze). Bez pełnych
numerów rachunków i telefonów: widok nie zna identyfikatorów osób, a na koniec maskuje każdy ciąg co najmniej 9 cyfr. Wszystko, co agent
odczyta, trafia jednak do dostawcy modelu, z którego korzysta `agy` (jak poczta i kalendarz). `agy` działa bez piaskownicy jako ten sam
użytkownik Windows, więc technicznie mógłby odszyfrować także pliki DPAPI panelu; ogranicza go tylko instrukcja. Pytaj agenta o konto,
gdy to Ci odpowiada. **Nowe pole lub widok, który agent ma znać,
dopisz zarówno do `agent-views.ts`, jak i do instrukcji.**

**Koszt odpowiedzi.** Zdarzenie `result` z `agy` niesie `usage` dla całej tury (suma wszystkich wywołań modelu): serwis zapisuje je przy
wiadomości agenta jako `usage` (`ChatUsage` w kontrakcie: `input`, `output`, `thinking`, `cached`, plus liczba wywołań modelu `calls` i
poleceń `tools`). `input` to tokeny czytane świeżo, `cached` to dodatkowo odczyt z cache'u promptu, a `thinking` jest częścią `output`.
Widać to w `GET /api/chats/<id>`; UI tego jeszcze nie pokazuje. Przy pomiarach liczy się głównie liczba wywołań modelu w turze:
każde czyta całą dotychczasową rozmowę (sam `agy` dokłada ok. 8 tys. tokenów już w pierwszym wywołaniu), więc tura z pobraniem danych
i kilkoma poleceniami kosztuje dziesiątki tysięcy tokenów wejścia. Pomiar (pytanie „co mam w przyszłym tygodniu?”, `gemini-3.8-flash-medium`, po jednym przebiegu): z surowym JSON-em i bez opisu
kształtu 9 wywołań modelu, 8 poleceń i ≈91 tys. tokenów wejścia (≈37 s); po dopisaniu zasad oszczędzania do instrukcji 7 wywołań,
6 poleceń i ≈86 tys.; z widokami dla agenta 4 wywołania, 3 polecenia (po jednym na źródło) i ≈38 tys. (≈16 s). Ostatni pomiar szedł
na danych scenariusza (na żywo wcześniejsze), więc porównanie jest przybliżone, ale kierunek jest wyraźny: agent przestał zgadywać
kształt odpowiedzi i przeliczać czasy.

### Znane właściwości `agy`

- W trybie `-p` agent ma powłokę (`run_command`) i **nie pyta o zgodę**. Katalog roboczy to `~/.desk-panel/agent`, ale to nie jest
  piaskownica. Projekt jest hobbystyczny i zabezpieczenia świadomie odłożono; zmieni się to, gdy panel wyjdzie poza własny komputer.
- **Uprawnienia**: tryb bez interakcji nie może pytać o zgodę, więc narzędzie, które jej wymaga (np. `read_file` poza katalogiem roboczym), jest
  automatycznie odmawiane, a **cała tura kończy się bez odpowiedzi** (wynik `SUCCESS`, pusta odpowiedź, `denied_actions`). Dlatego Launcher dodaje
  `--dangerously-skip-permissions` (`agyPermissionArgs`; jak `run_command`, który i tak działał bez pytania). Zmienia to tylko argumenty uruchomienia,
  nigdy ustawień `agy`; `DESK_AGY_SKIP_PERMISSIONS=0` (albo `false`, `no`, `off`) wyłącza flagę, wtedy odmowy wracają i widać je w oknie oraz w `denied`.
- `-p` zjada następny token, stąd `-p ''` na końcu argumentów. Pomoc drukuje na stderr. Zamknięcie stdin kończy proces.
- Każda wiadomość zużywa limit konta `agy`. Po pierwszej zakończonej odpowiedzi panel raz w tle prosi agy o krótką polską nazwę rozmowy (bez narzędzi: nazewnik uruchamia agy bez `--dangerously-skip-permissions`, więc odmawia on każdego narzędzia, nawet gdy pierwsza odpowiedź cytuje obcy tekst, np. maila; z limitem 20 s); model wybiera `DESK_AGY_TITLE_MODEL`, a domyślnie `DESK_AGY_MODEL`. Przy błędzie zostaje nazwa z pierwszej wiadomości. Użytkownik może zmienić nazwę w nagłówku; jego nazwa nie jest nadpisywana. Poza tym wywołaniem turę zaczyna wiadomość użytkownika albo automatyka panelu (zob. „Automatyka”).

## Szwy do rozszerzania

Dwa miejsca, w których czat można zmieniać, nie ruszając reszty. Opisane przez role, nie przez układ plików.

**Silnik agenta (`Launcher` / `AgentProcess`).** Serwis czatu (`createAgentChat`) nie uruchamia `agy` sam: dostaje `Launcher`, który
zwraca `AgentProcess` (zapis linii, zamknięcie stdin, zabicie, odbiór linii i wyjścia). Podmienia się go w testach i w trybie
scenariusza. Co to daje przy innym silniku:

- UI i API nie zmieniają się: znają tylko `ChatService` i `ChatMessage`.
- **Format zdarzeń `agy` (stream-json) nie jest za szwem**, tylko wewnątrz serwisu: to on zamienia `step_update`/`result` na
  `ChatMessage`. Silnik z innym protokołem musi albo mówić tym samym protokołem (adapter w `Launcher`), albo wymaga uogólnienia
  tego tłumaczenia w serwisie. Pierwsze jest tańsze.
- Zapisane rozmowy trzymają identyfikator rozmowy `agy` (`agy`), więc inny silnik oznacza też decyzję, co zrobić z wznawianiem.

**Agent skryptowy (tryb scenariusza).** Odtwarza zdarzenia `agy` i przechodzi przez ten sam serwis i zapis. Skutek: **każda
zmiana w protokole zdarzeń albo w tym, co serwis czyta z `agy`, musi iść w parze ze zmianą agenta skryptowego**, inaczej
`just scenario` i zrzuty ekranu przestaną pokazywać czat zgodnie z prawdziwym. Podobnie nowy rodzaj kroku (np. nowe narzędzie
w UI) warto dodać do skryptu, żeby dało się go zobaczyć bez `agy` i bez zużywania limitu. Test serwisu ma własnego fałszywego
agenta (`FakeAgent`), który też trzeba utrzymać zgodnie z protokołem.

## Diagnostyka rozmów (dla analizy przez człowieka lub innego agenta)

Praktyczna procedura, źródła Hermesa, ograniczenia i przykład rzeczywistej analizy: [diagnostyka-czatu-wektora.md](diagnostyka-czatu-wektora.md).

Rozmowy w `~/.desk-panel/chats` są lekkie: tylko to, co widać w oknie (plus `usage`). Diagnostyka leży **osobno** w
`~/.desk-panel/chat-logs` (`server/chat-log.ts`), więc czytanie rozmów jej nie ciągnie, a analizujący agent nie zaśmieca sobie kontekstu:

- **`README.md`**: opis formatów, zapisywany przy starcie usługi. Czytaj go pierwszy.
- **`turns.jsonl`**: jedna krótka linia na zakończoną turę (pytanie, model, status i `error`, co zakończyło turę: `result`/`exit`/`stop`,
  `emptyAnswer`, `lastStep`, `denied` (narzędzia zablokowane przez tryb bez interakcji), wynik agy, tokeny, wywołania modelu, lista narzędzi z kodem wyjścia, rozmiarem wyniku i `error`). Od tego zacznij
  pytania typu „z czym agent ma problem”, „które narzędzia zawodzą”, „ile kosztują tury”.
- **`<id rozmowy>.jsonl`**: surowy ślad jednej rozmowy: każde zdarzenie z `agy` (linie dłuższe niż 16 000 znaków skrócone), plus to, co zrobił
  serwis (`spawn` z pełnym poleceniem i modelem, `sent`, `stop`, `idle`, `exit` z powodem, `finish`, `chat-deleted`). Otwieraj tylko dla tury
  wybranej z `turns.jsonl` i filtruj po polu `turn`; pliki są ograniczone do 4 MB, a starsze niż 30 dni usuwane przy starcie.

Dziennik zawiera prywatne treści (poczta, kalendarz, polecenia agenta), leży poza Gitem i **nie znika razem z usuniętą rozmową**
(usunięta, zepsuta rozmowa jest najciekawsza do analizy). Zapis nigdy nie psuje czatu: błędy dziennika są połykane. Tura, w której agent
skończył bez żadnego tekstu (status `done`, brak odpowiedzi), jest w oknie błędem „Agent zakończył bez odpowiedzi.” (z widocznymi narzędziami; gdy `agy` zgłosił `denied_actions`, komunikat podaje zablokowane narzędzie, a nieudane narzędzie pokazuje powód), a w
`turns.jsonl` ma `emptyAnswer: true` i `lastStep`, czyli gdzie agent skończył. Zmieniając sposób czytania zdarzeń `agy`, zmień też to, co dziennik
z nich bierze (`record()` w serwisie czatu) i opis w `LOG_README`.

## API

Wszystko poza odczytem wymaga nagłówka `Origin` równego adresowi panelu (jak akcje Gmaila i Cezara), inaczej `403`.

| Trasa | Działanie |
| --- | --- |
| `GET /api/chats` | `{ chats: ChatSummary[], engines, engine }` (każda rozmowa ma `engine`; `engines` mówi, który silnik przyjmie wiadomość) |
| `POST /api/chats` | nowa rozmowa z pierwszą wiadomością `{ text, context, files?, engine?, nonce? }` → `201 { id }` |
| `PUT /api/chats/engine` | `{ engine: "hermes" \| "agy" }`: silnik nowych rozmów |
| `GET /api/chats/<id>` | cała rozmowa |
| `PATCH /api/chats/<id>` | `{ title }` |
| `DELETE /api/chats/<id>` | usuwa rozmowę, kończy jej proces i usuwa katalog plików |
| `POST /api/chats/<id>/messages` | `{ text, context, files?, nonce? }` → `202`; `409`, gdy agent jeszcze odpowiada; `503`, gdy silnik rozmowy nie działa |
| `GET /api/chats/<id>/files/<fileId>` | bajty załącznika tej rozmowy; inna rozmowa albo ścieżka poza id → `404` |
| `POST /api/chats/<id>/approval` | `{ approvalId, decision: "approve" \| "deny" }`: odpowiedź na prośbę o zgodę (tylko Hermes); `409`, gdy nieaktualna |
| `POST /api/chats/<id>/stop` | zatrzymuje odpowiedź |
| `GET /api/chats/<id>/events` | strumień SSE |

Turę automatyki zaczyna tylko serwer (metoda `sendAutomation` w hubie czatu, `server/chat-automation.ts`); HTTP nie
przyjmuje pola `automation` — `POST /api/chats…` dalej przyjmuje wyłącznie wiadomości użytkownika.

Bez usługi czatu (np. testy serwera bez `agy`) trasy odpowiadają `503`, a UI pokazuje „Czat jest niedostępny”.

## Próbowanie bez `agy`

`just scenario NAME` uruchamia czat z atrapą Hermesa (`server/hermes-mock.ts`) i ze **skryptowym agentem** agy (`server/scenario-chat.ts`): te same zdarzenia co `agy`
(krok narzędzia, potem odpowiedź słowo po słowie), odpowiedź wypisuje wskazane elementy. Nie zużywa limitu, a rozmowy trafiają do
katalogu tymczasowego, który znika razem ze scenariuszem. Dev server proxy (`vite.config.ts`) zachowuje nagłówek `Host`
strony, żeby sprawdzanie `Origin` działało też w trybie deweloperskim.

## Testy

- `server/agent-chat.test.ts`: serwis i trasy na zdarzeniach w kształcie prawdziwego `agy` (fałszywy proces).
- `server/hermes-chat.test.ts`, `server/panel-mcp.test.ts`: silnik Hermes, oba silniki razem, migracja starych rozmów (zob. [hermes.md](hermes.md)).
- `src/chat.test.tsx`: renderer Markdown, wskazywanie (najbliższy element, limity, znaczniki), okno, strumień, zatrzymanie,
  usuwanie, brak usługi.

## Dalsze kroki (jeszcze nie zrobione)

Notatki pozostają planowane (`/notatka` jest nieaktywna). Skille panelu działają pod `@`, a komendy rozmowy pod `/` (opis poniżej).

Akcje trwającego runu automatu wykonuje panel_automation_act tylko w granicach jednorazowej zgody na karcie tworzenia/zmiany automatu; wyjątek dla wydarzenia Google i alertu Smart Actions opisuje [Automaty](automaty.md#akcje-zatwierdzone-raz-na-karcie). Zwykła rozmowa nadal tylko proponuje wydarzenie kartą.


## Komendy, archiwum i rozmowy tymczasowe

Wpisanie `/` na początku pola otwiera menu nad kompozytorem, z sekcjami „Rozmowa” i „Zrób z tego”. Tekst filtruje prefiksy identyfikatorów komend; ↑↓ jawnie wybiera pozycję. Enter wykonuje tylko dokładnie wpisaną
komendę lub pozycję wybraną strzałką, kliknięcie wykonuje wskazaną pozycję. Samo `/` lub niepełny prefiks z Enterem
pozostaje w polu. Esc zamyka menu; Enter wysyła wtedy tekst (także znaną komendę) jako zwykłą wiadomość.
`/nowa` otwiera nowy czat, `/tymczasowa` nowy tymczasowy, `/archiwizuj` archiwizuje bieżący zapisany czat. Bez bieżącej
rozmowy oraz w trybie tymczasowym archiwizacja jest wyłączona. `/notatka` jest widoczna, nieaktywna, z etykietą „później”.
`/nowa` i `/tymczasowa` w aktywnym trybie tymczasowym wymagają potwierdzenia inline przed usunięciem treści.
`/zadanie` i `/automat` są nieaktywne bez bieżącej zapisanej rozmowy oraz w trybie tymczasowym.
`/zadanie` rozwija prośbę o zadanie na liście panelu (nie Cezara), `/automat` prośbę o propozycję automatu z kartą zgody.
Wybór i Enter/kliknięcie są działaniem użytkownika: prośba jest wysyłana jak jego zwykła wiadomość. Jeżeli trwa odpowiedź
lub odświeżanie, pozostaje w polu do wysłania. Same renderowanie i otwarcie menu nie wysyłają tury.
Skille pozostają pod `@`. W AGY istnieje natywne rozwijanie `/nazwa` do skilla przez CLI; panel wcześniej nie miał takiego
pickera (wzmianka w dawnych „Dalszych krokach” była planem). Okno obsługuje tylko Hermesa i przechwytuje wyłącznie znane
komendy panelu; API i proces AGY pozostają bez zmian. Nieznany tekst `/…` jest zwykłą wiadomością.

`/koszt` dopisuje wyłącznie lokalną odpowiedź panelu w tej rozmowie, bez wysłania wiadomości, modelu i dodatkowego kosztu.
Czyta `items[].usage` z GET bieżącej rozmowy: tokeny zakończonych runów Hermesa, zapisane przy turach mapowania. Podaje
liczbę tur objętych danymi; brak danych lub częściowe dane są jawne. Kwotę USD pokazuje wyłącznie przy pełnym pokryciu
jawnym `cost_usd` ze statusem `cost_status: actual` z runów (także dla kwoty 0); szacunek, brak statusu i status unknown
nie dają kwoty. Stare zapisy bez potwierdzenia rzeczywistego kosztu też jej nie dają. Przypięty Hermes zwraca w usage tylko liczniki tokenów. Nie wycenia tokenów według cennika.
Cache kafelka OpenRouter (`server/openrouter.ts`, [openrouter.md](openrouter.md)) zachowuje generację, model, dzień i koszt,
ale nie powiązanie z sesją/runem, więc nie wolno przypisać sumy dnia tej rozmowie. `/koszt` nie czyta logów użytkownika,
nie odpytuje OpenRoutera ani `/api/v1/activity`. Lokalna odpowiedź nie jest zapisywana w historii serwera i znika przy zmianie rozmowy.

Historia ma zakładki „Rozmowy” i „Archiwum · N”. Licznik obejmuje całe archiwum, wyszukiwanie wyłącznie bieżącą zakładkę.
Przycisk przy wierszu pozwala archiwizować/przywracać; jest widoczny po hoverze/fokusie, stale na ekranie dotykowym i zawsze
osiągalny Tabem. Origin-checked PATCH `/api/chats/:id` przyjmuje opcjonalne `title`, `archived: boolean` i `temporary: false`
(co najmniej jedno pole). Hermes zapisuje `archived` i `archivedAt` w mapowaniu; stare pliki bez pól oznaczają aktywną rozmowę.
Archiwizacja nie usuwa ani nie przerywa runu. Przy pierwszym odczycie czatu po starcie (lazy load) i co 24 h tylko nieaktywne rozmowy o tytule zaczynającym
się dokładnie od `[test]` i ostatniej aktywności sprzed co najmniej 7 dni trafiają do archiwum. Bieżąca tura jest pomijana.
Ręczne przywrócenie zapisuje `keepUnarchived: true` i trwale wyłącza autoarchiwizację tej rozmowy, także po restarcie.
Zwykły automat ani jego run nie są samodzielnym powodem archiwizacji; podlegają wyłącznie tej samej regule `[test]`.

Rozmowa tymczasowa jest wyborem nowej rozmowy; pierwsza wiadomość tworzy ją przez POST z `temporary: true`. Ma przerywane
ramki i baner z „Zachowaj rozmowę”. Serwer wyklucza ją z listy, a klient także z aktualizacji SSE i ostatniej rozmowy w
localStorage. Szkic tymczasowy jest tylko w pamięci okna przeglądarki, bez zapisu w localStorage. Przełączenie, nowa rozmowa, ukrycie lub odmontowanie okna sprząta mapowanie; opuszczenie strony wysyła best-effort DELETE
z `?temporary=1`. Serwer usuwa nim wyłącznie nadal tymczasową rozmowę; dla zachowanej lub brakującej zwraca 200 bez zmian.
Błąd DELETE nie blokuje przełączenia; jeśli żądanie nie dotarło do serwera, osierocony plik czeka na lazy load po restarcie.
Restart serwera sprząta osierocone mapowania. „Zachowaj” zdejmuje flagę przez PATCH i rozmowa trafia do zwykłej historii;
przed pierwszą wiadomością zmienia jedynie tryb nowego czatu. Szczegóły sprzątania sesji i ograniczenie pamięci: [hermes.md](hermes.md#rozmowy-tymczasowe).
