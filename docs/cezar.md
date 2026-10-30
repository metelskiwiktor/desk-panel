# Cezar i limity AI

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
- Dashboard pokazuje najpierw zadania czekające na Ciebie i w toku (do kilku, resztę zbiera „i N więcej”), a pod nimi
  zakończone i jeszcze niezarchiwizowane. Zakładka Zadania zawiera dostępne aktywne grupy, bez historii.
- **Zakończone zadania** (`done` i `failed`, do 30 ostatnich z 30 dni, najnowsze pierwsze) panel czyta z lekkiego
  `/api/v1/workspace/dashboard/overview` (strony po 20 wierszy, około 8 KB, zamiast 1,1 MB pełnej listy runów) co 30 s,
  a szczegóły zadania (potwierdzenie odczytu `seenAt`, gałąź, workflow, model, diff, link do PR) z pojedynczego runu,
  z pamięcią podręczną (przeczytane 10 min, nieprzeczytane 1 min). Znika z dashboardu dopiero zarchiwizowane zadanie
  (`archived`). Nieprzeczytane (bez `seenAt`) mają znacznik „nowe”. Przesunięcie wiersza w dowolną stronę archiwizuje
  zadanie w Cezarze (z cofnięciem przez 6 s), a otwarcie szczegółów oznacza je jako przeczytane. Starsze niż 30 dni
  zostają w Cezarze.
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
Odczyty to GET do konkretnych projekcji; rozpoczęcie OAuth, akcje poczty i akcje na zakończonych zadaniach Cezara to POST
z kontrolą Origin (ochrona CSRF) i walidowanym, małym JSON-em. Do Cezara panel zapisuje:
1. `POST /api/cezar/action` z `{id, action}`, gdzie akcja to `archive`, `unarchive`, `read` albo `unread` na jednym runie (odpowiednie `POST …/runs/:id/archive`, `/read`, `/unread` Cezara).
2. `POST /api/cezar/runs` z `{title, task, workflow?, runner?, model?, steps?, todoId?}` (Origin-checked): zleca nowe zadanie w projekcie `desk-panel` na Cezarze (domyślnie workflow `desk-panel-task`, runner `agy`, model `gemini-3.8-flash-medium`) i zwraca `{ok: true, id, url}`. `steps` (`{ krok: { runner?, model? } }`) idzie do Cezara jako `stepOverrides` i wygrywa z wykonawcą przypiętym w workflow, tylko dla tego zadania; karta zlecenia ustawia go przy przypiętych krokach. Workflow `desk-panel-task` wykonuje implementację w worktree Cezara, weryfikuje `just check`, otwiera gotowy PR, dopisuje komentarz ze zdjęciami Przed/Po (`scripts/pr-screenshots.mjs`, fail-soft), a automatyzacja `pull_request.opened` uruchamia automatyczny `pr-review` na `agy` (`gemini-3.8-flash-medium`).
Private api-client Cezara nie jest publikowany: integracja waliduje dokumentowany
podzbiór kontraktu bez importów do sąsiedniego checkoutu.

`todoId` łączy task Cezara z zadaniem listy panelu. Po udanym dispatchu z karty panel dopina do zadania linki Cezara i rozmowy,
ustawia „W realizacji” z autorem `panel`; błąd powiązania nie psuje zlecenia. `todoId` zostaje też w zapisie dispatchu
(`~/.desk-panel/cockpit.json`), więc gdy odczyt zakończonych zadań Cezara pokaże PR, panel dopina link `pr` — także bez otwartego
czatu i bez nowego odpytywania. Stan zadania pozostaje niezależny od taska Cezara i PR-a, bez dalszych automatycznych przejść
([zadania.md](zadania.md)).

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
