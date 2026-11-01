# Przygotowanie zadania: „słoń i złota rybka”

Ten dokument opisuje przygotowanie **specyfikacji zadania**, a nie jego wykonanie. **Słoń** (przygotowujący agent)
zbiera decyzje użytkownika, pisze specyfikację i doprowadza ją do gotowości. **Złota rybka** (świeży recenzent
`opencode`) czyta wyłącznie tekst specyfikacji i wskazuje niejasności. Użytkownik podejmuje decyzje o zakresie i
oczekiwaniach. Zapis specyfikacji do zadania jest częścią przygotowania; realizacja, dispatch Cezara i zmiany API/UI
należą do innych kroków.

Jeśli specyfikacja jest już w zadaniu z listy, czytaj ją przez pełny odczyt zadania (nota i wszystkie komentarze), a nie
przez skrót z widoku listy. Skrót może pokazywać tylko ostatnie komentarze i gubić początek specyfikacji.

## Role i przebieg

- **Słoń** — przygotowuje: zbiera decyzje, pisze dziewięć sekcji, uruchamia rybkę, pokazuje użytkownikowi raport i
  poprawki, rozstrzyga uwagi i zapisuje gotowy komplet.
- **Złota rybka** — recenzuje: nowa sesja `opencode`, tylko odczyt repozytorium, wyłącznie tekst specyfikacji i osobna
  instrukcja roli. Nie wykonuje zadania, nie zapisuje plików i nie tworzy rozmów.
- **Użytkownik** — decyduje o zakresie i oczekiwaniach. Pytania o zakres lub oczekiwania wymagają jego odpowiedzi.

Przebieg: Słoń pisze szkic, uruchamia rybkę, pokazuje raport i swoje poprawki użytkownikowi, rozstrzyga uwagi, sprawdza
definicję gotowości i dopiero wtedy zapisuje specyfikację. Sugestie redakcyjne rybki nie blokują gotowości; uwagi
wpływające na zakres, zachowanie lub odbiór trzeba rozstrzygnąć.

## Szablon specyfikacji (kopiowalny)

Skopiuj poniższy blok i wypełnij wszystkie dziewięć sekcji. Puste pola i placeholdery nie są dozwolone; jeśli sekcja
naprawdę nic nie wnosi, napisz `brak` tylko tam, gdzie szablon na to pozwala.

```markdown
CEL:
[oczekiwana zmiana: co ma się stać, obserwowalne dla użytkownika]

ZAKRES:
[co dostarczamy: pliki, obszary, zachowania]

POZA ZAKRESEM:
[granice; osobne dalsze prace]

DECYZJE:
- YYYY-MM-DD — [treść decyzji] — źródło: [użytkownik/rozmowa/plik]
- Otwarte pytanie (YYYY-MM-DD): [pytanie] — [czego brakuje do decyzji]

WARUNKI ODBIORU:
1. [sprawdzalny wynik] — [metoda weryfikacji]
2. [sprawdzalny wynik] — [metoda weryfikacji]

WYKONAWCA:
[cezar | lokalnie | rozmowa]

REPO:
[konkretne repozytorium i jego lokalizacja dostępna wykonawcy; inne repozytorium to jawna osobna praca]

TRYB:
[analiza | implementacja]

ZAŁĄCZNIKI:
[ścieżki względem repo lub dostępna treść; jeśli brak: brak]
```

## Znaczenie dziewięciu sekcji

### CEL

Oczekiwana zmiana: co ma się stać i po czym użytkownik pozna, że się stało. Pisz zachowanie, nie implementację. Cel ma
być jednoznaczny i sprawdzalny razem z WARUNKAMI ODBIORU.

### ZAKRES

Co dostarczamy: pliki, obszary, zachowania i granice zmiany. Wymień rzeczy, które mają powstać lub się zmienić. Nie
zamieniaj ZAKRESU w plan implementacji; wskaż, co ma być dostarczone.

### POZA ZAKRESEM

Granice i osobne dalsze prace. Wypisz to, czego zadanie nie obejmuje, żeby wykonawca nie rozszerzył zmiany. Praca w innym
repozytorium albo osobny, późniejszy etap należy tutaj, nie do ZAKRESU.

### DECYZJE

Zapisane decyzje użytkownika, każda z datą w formacie `YYYY-MM-DD`, treścią i źródłem (użytkownik, rozmowa, plik). W
szkicu dodaj też **jawne otwarte pytania**: `Otwarte pytanie (YYYY-MM-DD): … — …`. Otwarte pytanie nie jest decyzją i
nie może udawać rozstrzygnięcia. Nie dopowiadaj brakującej decyzji; jeśli jej brak, zapisz pytanie i poczekaj na
odpowiedź użytkownika.

### WARUNKI ODBIORU

Numerowane pary: **sprawdzalny wynik + metoda weryfikacji**. Każdy punkt musi dać się sprawdzić po wykonaniu, np.
`1. Zadanie „Zamów kawę” istnieje na wskazanej liście — GET /api/todos i odczyt zadania.` Nie pisz „działa”, „jest
poprawne” ani „wygląda dobrze” bez metody. Warunki odbioru mają pierwszeństwo przed skrótami i ogólnikami.

### WYKONAWCA

Jedna wartość: `cezar`, `lokalnie` albo `rozmowa`. `cezar` oznacza dispatch przez Cezara, `lokalnie` — uruchomienie w
checkoutcie, `rozmowa` — wykonanie w rozmowie. Nie łącz kilku wykonawców w jednym zadaniu; jeśli potrzebni są dwaj,
podziel pracę na osobne zadania.

### REPO

Konkretne repozytorium i jego lokalizacja dostępna wykonawcy (ścieżka checkoutu albo adres, który wykonawca naprawdę
widzi). Inne repozytorium to **jawna osobna praca**, nie część tego zadania; nie zakładaj, że wykonawca ma dostęp do
sąsiedniego checkoutu.

### TRYB

Jedna wartość: `analiza` albo `implementacja`. `implementacja` oznacza wykonanie zmian bez osobnego runu analizy;
`analiza` oznacza najpierw analizę, bez implementacji. Jeśli użytkownik mówi „implementacja, bez analizy”, wpisz
`implementacja`.

### ZAŁĄCZNIKI

Ścieżki względem repozytorium albo dostępna treść, której wykonawca nie znajdzie w repo. Przy braku załączników wpisz
`brak`. Nie podawaj ścieżek spoza repo jako jedynego źródła, jeśli wykonawca ich nie widzi; opisz treść albo wskaż
plik w repo.

## Definicja gotowości

Zadanie jest gotowe do zapisania jako `gotowe`, gdy wszystkie punkty są spełnione:

- [ ] Wszystkie dziewięć sekcji jest wypełnionych; nie ma pustych pól ani placeholderów; `ZAŁĄCZNIKI: brak`, gdy nic
      nie ma.
- [ ] CEL opisuje oczekiwaną zmianę, a POZA ZAKRESEM wyznacza granice; cel i granice są jednoznaczne.
- [ ] DECYZJE zawierają zapisane decyzje użytkownika z datą `YYYY-MM-DD`, treścią i źródłem; otwarte pytania są jawne i
      nie udają decyzji.
- [ ] WARUNKI ODBIORU to numerowane pary „sprawdzalny wynik + metoda weryfikacji”; każdy wynik da się sprawdzić.
- [ ] ZAŁĄCZNIKI wskazują ścieżki względem repo albo dostępną treść; przy braku jest `brak`.
- [ ] Odbył się skuteczny przegląd rybki: raport istnieje i nie jest błędem, timeoutem ani brakiem raportu.
- [ ] Wszystkie uwagi wpływające na zakres, zachowanie lub odbiór są rozstrzygnięte; sugestie redakcyjne nie blokują.
- [ ] Nie dopowiedziano brakującej decyzji i nie pominięto wymaganego zachowania zwrotem „jeśli dostępne”.
- [ ] Słoń pokazał użytkownikowi raport i poprawki; pytania o zakres lub oczekiwania mają odpowiedzi.
- [ ] Szkic istniejącego zadania pozostaje w `przygotowanie`; nowe zadanie nie jest zapisane jako `gotowe` przed
      spełnieniem tej listy.

Słoń nie zapisuje nowego zadania jako `gotowe` przed spełnieniem tej listy. Szkic istniejącego zadania zostaje w
`przygotowanie` do czasu spełnienia definicji. Zapis `gotowe` jest decyzją o gotowości do realizacji, nie o wykonaniu.

## Rybka: przegląd specyfikacji

### Co to jest skuteczny przegląd

Skuteczny przegląd to raport rybki, który ocenia sam tekst specyfikacji. Dla każdej uwagi raport podaje cztery pola:

- **Niejasność** — czego w specyfikacji nie da się jednoznacznie odczytać.
- **Niezapisane założenie** — co autor przyjął bez zapisanej decyzji.
- **Wpływ na wykonanie** — jak to zmienia zakres, zachowanie, koszt albo odbiór.
- **Pytanie** — pytanie do użytkownika, które pozwala rozstrzygnąć uwagę.

Jeśli nie ma uwag, raport mówi `brak uwag`. Błąd, timeout albo brak raportu **nie spełnia** definicji gotowości; to nie
jest skuteczny przegląd. Raport nie jest dowodem, że model wykonał zadanie; ocenia tylko specyfikację.

### Komenda i minimalna konfiguracja opencode

Uruchom w katalogu repozytorium. Plik `.ai/spec.md` zawiera wyłącznie tekst specyfikacji i leży poza Gitem. Poniższa
konfiguracja jest minimalna: model `openrouter/deepseek/deepseek-v4.1-flash-1017`, nowa sesja, tylko odczyt
repozytorium, bez zapisu, powłoki, delegacji i zewnętrznych MCP.

```json
{
  "model": "openrouter/deepseek/deepseek-v4.1-flash-1017",
  "small_model": "openrouter/deepseek/deepseek-v4.1-flash-1017",
  "permission": {
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "edit": "deny",
    "bash": "deny",
    "task": "deny",
    "webfetch": "deny",
    "websearch": "deny",
    "external_directory": "deny",
    "question": "deny",
    "todowrite": "deny",
    "skill": "deny"
  },
  "mcp": {}
}
```

To uprawnienia narzędzi `opencode`, **nie sandbox systemu operacyjnego**. Proces nadal działa z prawami użytkownika,
dlatego instrukcja roli zabrania czytania poświadczeń i danych prywatnych poza repozytorium. Ustawiaj
`OPENCODE_CONFIG_CONTENT` w środowisku uruchomienia; nie dziedzicz konfiguracji hosta z serwerami MCP.

Przykładowa, lokalna i powtarzalna komenda PowerShell (limit 10 minut):

```powershell
# Uruchom w katalogu repozytorium. .ai/spec.md zawiera tylko tekst specyfikacji (poza Gitem).
$config = @'
{"model":"openrouter/deepseek/deepseek-v4.1-flash-1017","small_model":"openrouter/deepseek/deepseek-v4.1-flash-1017","permission":{"read":"allow","glob":"allow","grep":"allow","list":"allow","edit":"deny","bash":"deny","task":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","question":"deny","todowrite":"deny","skill":"deny"},"mcp":{}}
'@
$role = @'
Jesteś recenzentem specyfikacji (złota rybka). Oceniasz wyłącznie tekst poniżej.
Masz dostęp tylko do odczytu repozytorium. Nie edytuj, nie uruchamiaj powłoki, nie deleguj, nie używaj MCP.
Nie czytaj poświadczeń, tokenów, panel.env, plików DPAPI ani danych prywatnych poza repozytorium.
Dla każdej uwagi podaj: Niejasność, Niezapisane założenie, Wpływ na wykonanie, Pytanie.
Jeśli nie ma uwag, napisz: brak uwag. Nie proponuj implementacji.
'@
$repo = (Get-Location).Path
$spec = Get-Content -Raw -LiteralPath .ai/spec.md
$prompt = "$role`n`n--- SPECYFIKACJA ---`n$spec"
$job = Start-Job -ScriptBlock {
  param($repo, $prompt, $config)
  $env:OPENCODE_CONFIG_CONTENT = $config
  Set-Location -LiteralPath $repo
  opencode run --format json --model openrouter/deepseek/deepseek-v4.1-flash-1017 --dir $repo -- $prompt
  if ($LASTEXITCODE -ne 0) { throw "opencode exit $LASTEXITCODE" }
} -ArgumentList $repo, $prompt, $config
if (-not (Wait-Job -Job $job -Timeout 600)) {
  Stop-Job -Job $job; Remove-Job -Job $job -Force
  throw 'Rybka: przekroczono limit 10 minut; przegląd nie jest skuteczny.'
}
$state = $job.State
$output = Receive-Job -Job $job
Remove-Job -Job $job -Force
$output | Set-Content -LiteralPath .ai/rybka-report.jsonl -Encoding utf8
if ($state -ne 'Completed') { throw "Rybka: błąd przebiegu ($state); przegląd nie jest skuteczny." }
if (-not (Test-Path -LiteralPath .ai/rybka-report.jsonl) -or (Get-Item .ai/rybka-report.jsonl).Length -eq 0) { throw 'Rybka: brak raportu; przegląd nie jest skuteczny.' }
```

Komenda nie używa `--continue`, `--session` ani `--fork` i nie dołącza rozmowy; `opencode run` zaczyna nową sesję.
Wiadomość to tekst specyfikacji plus osobna, jawna instrukcja roli recenzenta. Nie dodawaj plików, załączników
rozmowy ani wcześniejszego kontekstu.

### Kiedy uruchomić rybkę ponownie

- **Istotna zmiana celu lub zakresu po raporcie** wymaga nowej rybki. To nowy przegląd, bo zmieniło się to, co miało
  być oceniane.
- **Usunięcie wskazanego braku** albo **zmiana redakcyjna** nie wymaga automatycznie kolejnego płatnego przebiegu.
  Popraw specyfikację, rozstrzygnij uwagę i sprawdź definicję gotowości.
- **Błąd, timeout lub brak raportu** nie jest przeglądem; uruchom rybkę ponownie albo popraw warunki uruchomienia.
- Raport i poprawki pokaż użytkownikowi. Pytania o zakres lub oczekiwania wymagają odpowiedzi; sugestie redakcyjne
  nie blokują gotowości.

## Przykład fikcyjny: brak wskazanej listy

Poniższy przykład jest celowo niegotowy. W panelu istnieją trzy listy: „Dom”, „Praca” i „Do poprawy”. Szkic nie wskazuje,
na którą listę ma trafić zadanie.

### Szkic specyfikacji

```markdown
CEL:
Na liście zadań ma pojawić się zadanie „Zamów kawę” z notatką „Skończyły się ziarna”.

ZAKRES:
Jedno zadanie na liście zadań; bez zmian w API i UI.

POZA ZAKRESEM:
Nie zmieniaj innych list, nie twórz nowych list, nie zamawiaj kawy.

DECYZJE:
- 2026-11-01 — zadanie dodaje agent z `by: agent` — źródło: użytkownik.
- Otwarte pytanie (2026-11-01): na którą listę ma trafić zadanie? — użytkownik nie wskazał listy, a w panelu są listy
  „Dom”, „Praca” i „Do poprawy”.

WARUNKI ODBIORU:
1. Zadanie „Zamów kawę” istnieje na wskazanej liście z notatką „Skończyły się ziarna” — GET /api/todos i odczyt
   zadania.
2. Historia zadania zawiera komentarz zaczynający się od „spec:” — odczyt historii w GET /api/todos.

WYKONAWCA:
rozmowa

REPO:
przyklad-repo, lokalizacja: C:\projekty\przyklad-repo (dostępna wykonawcy).

TRYB:
implementacja

ZAŁĄCZNIKI:
brak
```

### Raport rybki

Rybka odpowiada na szkic:

```text
Raport rybki (skrót):
- Niejasność: specyfikacja mówi „lista zadań”, ale nie wskazuje listy docelowej; w panelu są co najmniej trzy listy
  („Dom”, „Praca”, „Do poprawy”).
- Niezapisane założenie: autor zakłada, że wystarczy dowolna lista zadań; to nie jest zapisana decyzja.
- Wpływ na wykonanie: bez listy nie da się wykonać ZAKRESU ani sprawdzić WARUNKU ODBIORU 1; wybór listy zmienia
  zachowanie i odbiór.
- Pytanie: Na którą listę ma trafić zadanie „Zamów kawę”?
```

### Powód niegotowości

Szkic nie spełnia definicji gotowości: decyzja o liście docelowej nie jest zapisana, a bez niej zakres i pierwszy
warunek odbioru są niejednoznaczne. To nie jest sugestia redakcyjna; to uwaga wpływająca na zakres, zachowanie i
odbiór, więc blokuje gotowość. Słoń pokazuje raport i swoje poprawki użytkownikowi i czeka na odpowiedź na pytanie o
listę.

### Uzupełnienie po odpowiedzi użytkownika

Użytkownik odpowiada: „Lista Dom.” Słoń usuwa otwarte pytanie i dopisuje decyzję; nazywa też listę w CEL i ZAKRESIE:

```markdown
CEL:
Na liście „Dom” ma pojawić się zadanie „Zamów kawę” z notatką „Skończyły się ziarna”.

ZAKRES:
Jedno zadanie na liście „Dom”; bez zmian w API i UI.

POZA ZAKRESEM:
Nie zmieniaj innych list, nie twórz nowych list, nie zamawiaj kawy.

DECYZJE:
- 2026-11-01 — zadanie dodaje agent z `by: agent` — źródło: użytkownik.
- 2026-11-01 — lista docelowa: „Dom” — źródło: użytkownik (odpowiedź w rozmowie).

WARUNKI ODBIORU:
1. Zadanie „Zamów kawę” istnieje na liście „Dom” z notatką „Skończyły się ziarna” — GET /api/todos i odczyt zadania.
2. Historia zadania zawiera komentarz zaczynający się od „spec:” — odczyt historii w GET /api/todos.

WYKONAWCA:
rozmowa

REPO:
przyklad-repo, lokalizacja: C:\projekty\przyklad-repo (dostępna wykonawcy).

TRYB:
implementacja

ZAŁĄCZNIKI:
brak
```

To usunięcie wskazanego braku, nie zmiana celu. Zgodnie z zasadami nie wymaga automatycznie nowej rybki; wystarczy
poprawiona specyfikacja i przejście definicji gotowości.

### Przejście checklisty na przykładzie

| Punkt definicji gotowości | Jak spełnia go uzupełniony przykład |
| --- | --- |
| Wszystkie dziewięć sekcji wypełnione | CEL, ZAKRES, POZA ZAKRESEM, DECYZJE, WARUNKI ODBIORU, WYKONAWCA, REPO, TRYB i ZAŁĄCZNIKI są wypełnione; ZAŁĄCZNIKI to `brak`. |
| Cel i granice | CEL mówi o zadaniu na liście „Dom”; POZA ZAKRESEM wyklucza inne listy, nowe listy i zamówienie kawy. |
| Zapisane decyzje użytkownika | DECYZJE mają datę 2026-11-01, treść i źródło (użytkownik); po odpowiedzi otwarte pytanie zastąpiono decyzją o liście „Dom”. |
| Mierzalne kryteria z metodami | WARUNKI ODBIORU 1–2 to pary wynik + metoda (GET /api/todos i odczyt historii). |
| Dostępne załączniki | ZAŁĄCZNIKI: `brak`; przykład nie potrzebuje plików. |
| Skuteczny przegląd rybki | Raport wskazał niejasność, niezapisane założenie, wpływ i pytanie; nie był błędem, timeoutem ani brakiem raportu. |
| Rozstrzygnięcie uwag | Uwaga o liście docelowej została rozstrzygnięta decyzją użytkownika; nie ma innych uwag wpływających na zakres, zachowanie lub odbiór. |
| Bez dopowiadania i „jeśli dostępne” | Lista jest zapisaną decyzją użytkownika; w przykładzie nie ma zwrotu „jeśli dostępne”. |
| Raport i poprawki użytkownikowi | Słoń pokazał raport i uzupełnienie; pytanie o listę ma odpowiedź użytkownika. |
| Szkic istniejącego / nowe zadanie | To nowe zadanie; nie jest zapisane jako `gotowe` przed spełnieniem checklisty. |

Ten przykład jest fikcyjny i statyczny: nie uruchamia modelu, nie tworzy rozmowy i nie zapisuje niczego w panelu. Służy
do sprawdzenia szablonu, definicji gotowości i sposobu pokazania raportu, nie do zastąpienia prawdziwego przeglądu.

## Zapis specyfikacji do zadania

### Adres i Origin

Zanim wyślesz jakąkolwiek zmianę, sprawdź:

- [server/index.ts](../../server/index.ts) — gdzie serwer słucha: port z `DESK_PORT` (domyślnie 5174), wiązanie
  `127.0.0.1`; `DESK_ALLOWED_HOST` to opcjonalna nazwa Tailscale, a nie adres do lokalnego POST.
- [server/app.ts](../../server/app.ts) — reguła `Origin`: `POST /api/todos/action` wymaga nagłówka `Origin` równego
  adresowi panelu (`ownOrigin`), inaczej odpowiada `403`.
- [docs/zadania.md](../zadania.md) — kontrakt `POST /api/todos/action`, pola akcji, kształt `GET /api/todos` i limity.

Dla lokalnego zapisu używaj `http://127.0.0.1:5174` (albo portu z `DESK_PORT`) i nagłówka `Origin` o tej samej
wartości. `GET /api/todos` jest odczytem i nie wymaga `Origin`.

### Wybór listy

Wykonaj `GET /api/todos` i odczytaj listy oraz ich `id`. Wybierz **jednoznacznie** listę wskazaną przez użytkownika.
Jeśli kilka list pasuje do wskazania albo użytkownik nie wskazał listy, zapytaj; nie wybieraj po cichu i nie twórz nowej
listy. `createList` nie jest częścią przygotowania. Przy kilku pasujących listach lub braku wskazanej listy pytaj, bez
cichego wyboru i bez cichego tworzenia.

### Tytuł, notatka i komentarze

Tytuł nazywa rezultat, nie proces: np. `Filtr ukończonych na liście Dom`. Notatka jest krótka: streszcza cel i
odsyła do wersji specyfikacji w komentarzach, np. `Cel: dodać filtr ukończonych na liście Dom; pełna specyfikacja w
komentarzach, wersja v1.` Nie wklejaj całej specyfikacji do notatki.

Pierwszy komentarz ze specyfikacją zaczyna się od `spec: <autor>` (np. `spec: słoń`). Wszystkie części mają nagłówek
`Specyfikacja vN — i/N`. Przykład pierwszej części:

```text
spec: słoń

Specyfikacja v1 — 1/3

CEL:
...
```

Kolejne części zaczynają się od nagłówka:

```text
Specyfikacja v1 — 2/3

...
```

Podział prowadź po akapitach albo liniach i zachowaj cały tekst. Nie skracaj, nie streszczaj i nie zmieniaj kolejności.
Każda część z nagłówkiem ma najwyżej 2000 znaków, a całe ciało JSON żądania najwyżej 4096 bajtów UTF-8. Sprawdzaj oba
limity: polskie znaki w UTF-8 mogą zająć więcej niż jeden bajt, więc jeśli JSON przekracza 4096 bajtów, podziel na
mniejsze części nawet przy tekście krótszym niż 2000 znaków. W PowerShell policz bajty przez
`[Text.Encoding]::UTF8.GetByteCount($json)`, w Node przez `Buffer.byteLength($json, 'utf8')`.

### Sekwencja zapisu

Wykonaj kroki po kolei; każda zmiana ma `by: "agent"`:

1. `GET /api/todos` — odczyt list, wybór listy użytkownika i sprawdzenie miejsca w historii.
2. `POST /api/todos/action` z `addTask`:

   ```json
   {"action":"addTask","list":"l-…","title":"…","note":"…","by":"agent"}
   ```

   Odpowiedź zawiera `task.id`; zapisz je na czas całej sekwencji.
3. `POST /api/todos/action` z `addComment` dla każdej części specyfikacji:

   ```json
   {"action":"addComment","task":"t-…","text":"…","by":"agent"}
   ```

4. `GET /api/todos` — potwierdź, że są wszystkie części i że tekst jest kompletny.
5. `POST /api/todos/action` z `setStatus`:

   ```json
   {"action":"setStatus","task":"t-…","status":"gotowe","by":"agent"}
   ```

6. `POST /api/todos/action` z osobnym `addComment` o strukturze:

   ```json
   {"action":"addComment","task":"t-…","text":"Struktura: …","by":"agent"}
   ```

7. `GET /api/todos` — końcowe potwierdzenie stanu i komentarzy.

Nie ustawiaj `gotowe` przed potwierdzeniem kompletu w kroku 4. Jeśli krok 4 wykaże brak części, wróć do dodawania
komentarzy; nie przechodź do `setStatus`.

### Błąd częściowy i wznowienie

Błąd częściowy (np. `4xx`/`5xx` przy `addComment`) **przerywa sekwencję** i nie ustawia `gotowe`. Przed wznowieniem
odczytaj `GET /api/todos`, znajdź zadanie po `task.id` zapisanym po `addTask` i sprawdź, które części już są w historii.
Wznów od pierwszej brakującej części; nie wywołuj ponownie `addTask`. Jeśli nie masz `task.id`, znajdź zadanie po
tytule i liście, ale nie twórz drugiego zadania.

### Limit historii 200 wpisów

Historia zadania ma limit 200 wpisów; każdy komentarz i każda zmiana statusu dopisuje wpis. Przed zapisem policz
`history.length` i zaplanuj komplet: komentarze ze specyfikacją + `setStatus` + komentarz o strukturze. Jeśli komplet nie
mieści się w limicie bez wypchnięcia istniejącej historii, zatrzymaj zapis i zapytaj użytkownika. **Nie usuwaj
historii.**

### Nowa rewizja

Nowa rewizja to **pełny komplet** komentarzy z nowym numerem wersji (`v2`, `v3`…) i nowym `i/N`. Nie edytuj starych
komentarzy i nie udawaj, że zostały zmienione; stara wersja zostaje w historii. Nowa wersja zaczyna się od nowa, z
własnym `spec: <autor>` w pierwszym komentarzu.

### Końcowy komentarz o strukturze

Po `setStatus gotowe` dodaj osobny komentarz o strukturze. Opisz **konkretne braki ujawnione przez przygotowanie**
(np. „brakowało decyzji o liście docelowej”, „nie było metody weryfikacji”) albo napisz `Struktura: brak`. Ten komentarz
jest informacyjny: **nie zmienia API/UI** i nie uruchamia implementacji. Nie zmieniaj API ani UI tylko dlatego, że
przygotowanie ujawniło braki struktury.

### Co znaczy „gotowe”

Status `gotowe` („Gotowe do realizacji”) oznacza **gotowość do realizacji**. Nie oznacza zakończenia zadania, zgody na
Cezara ani wyniku runu Cezara. Nie traktuj go jako wykonania. Zakończenie, zgoda i wynik runu to osobne zdarzenia,
które mogą nigdy nie nastąpić albo nastąpić później.
