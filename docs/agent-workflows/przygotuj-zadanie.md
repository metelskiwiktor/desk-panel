# Przygotowanie zadania: „słoń i złota rybka”

Proces dla lokalnych agentów w repo: **słoń** zbiera decyzje użytkownika, pisze specyfikację i doprowadza ją do
gotowości; **złota rybka** recenzuje samą specyfikację w świeżej sesji opencode, bez historii rozmowy i bez wykonania
zadania. Użytkownik rozstrzyga pytania o zakres i oczekiwania. Zapis specyfikacji należy do przygotowania;
implementacja, dispatch Cezara, zmiany API/UI oraz menu `@` Wektora są poza tym procesem.

Istniejące zadanie czytaj w całości: `panel_todos` z `zadanie=<id t-…>` albo
`GET /api/agent/todos?zadanie=…`; skrót wskazania/listy może zgubić początek specyfikacji
([zadania.md](../zadania.md#agent-czatu)). Specyfikacja opisuje potrzebę i odbiór; współistnieje z późniejszym
[briefem wykonawcy](executor-brief.md), nie zastępuje jego formatu ani workflow.

## Szablon i znaczenie pól

Skopiuj blok i zastąp objaśnienia treścią; zachowaj wszystkie dziewięć sekcji.

```markdown
CEL:
[oczekiwana, obserwowalna zmiana dla użytkownika]

ZAKRES:
[co dostarczamy: pliki, obszary, zachowania]

POZA ZAKRESEM:
[granice i osobne dalsze prace]

DECYZJE:
- YYYY-MM-DD — [treść decyzji] — źródło: [użytkownik/rozmowa/plik]
- Otwarte pytanie (YYYY-MM-DD): [brakująca decyzja] — [wpływ; tylko w szkicu]

WARUNKI ODBIORU:
1. [sprawdzalny wynik] — [metoda weryfikacji]

WYKONAWCA:
[jedna wartość: cezar / lokalnie / rozmowa]

REPO:
[konkretne repozytorium i lokalizacja dostępna wykonawcy; inne repo to jawna osobna praca]

TRYB:
[analiza / implementacja]

ZAŁĄCZNIKI:
[ścieżki względem repo lub dostępna treść; przy braku: brak]
```

`cezar` wskazuje wykonawcę w workflow Cezara, `lokalnie` pracę w checkoucie, `rozmowa` wykonanie w rozmowie;
wybierz jedną wartość, ale nie uruchamiaj wykonania podczas przygotowania. `analiza` zamawia ustalenia,
`implementacja` zmiany. Nie zakładaj dostępu do sąsiedniego repo ani prywatnego pliku jako jedynego załącznika.

## Definicja gotowości

Przed zapisem `gotowe` sprawdź:

- [ ] Dziewięć sekcji wypełniono bez placeholderów; wykonawca, repo i tryb są jednoznaczne, załączniki dostępne
      (albo `ZAŁĄCZNIKI: brak`).
- [ ] CEL i granice są określone, decyzje użytkownika mają datę `YYYY-MM-DD`, treść i źródło.
- [ ] Każdy numerowany warunek odbioru ma sprawdzalny wynik i metodę; wymagania nie pominięto przez „jeśli dostępne”.
- [ ] Istnieje skuteczny raport rybki, pokazany użytkownikowi wraz z poprawkami.
- [ ] Rozstrzygnięto wszystkie uwagi wpływające na zakres, zachowanie lub odbiór; pytania o zakres/oczekiwania mają
      odpowiedzi użytkownika, a brakującej decyzji nie dopowiedziano. Sugestie redakcyjne nie blokują gotowości.

Szkic istniejącego zadania pozostaje w `przygotowanie`; nowego nie oznaczaj `gotowe` przed spełnieniem checklisty.
`gotowe` oznacza gotowość do realizacji, nie zakończenie, zgodę na Cezara ani wynik jego runu.

## Rybka: konfiguracja i przegląd

Raport dla każdej uwagi podaje **niejasność, niezapisane założenie, wpływ na wykonanie i pytanie**; przy braku uwag
mówi „brak uwag”. Błąd, timeout, pusty/niekompletny raport nie spełnia definicji gotowości. Słoń ocenia treść raportu,
pokazuje go i poprawki użytkownikowi. Istotna zmiana celu/zakresu po raporcie wymaga nowej rybki; usunięcie wskazanego
braku lub korekta redakcyjna nie wymaga automatycznie kolejnego płatnego przebiegu.

Poniższa komenda dla PowerShell + Node.js + opencode działa z katalogu repo. `.ai/spec.md` zawiera wyłącznie tekst
specyfikacji, a raporty pozostają w ignorowanym `.ai/`, poza Gitem. Rola jest osobnym promptem agenta, a jedyną
wiadomością użytkownika jest specyfikacja; nie przekazuj historii ani flag `--continue`, `--session`, `--fork`.
Proces ma limit 10 minut, dopuszcza tylko odczyt repo, blokuje zapis/powłokę/delegację i wyłącza odziedziczone MCP.
To uprawnienia narzędzi, **nie sandbox OS**: proces nadal działa z prawami użytkownika.

Konfiguracje OpenCode są scalane: puste `mcp: {}` nie wyłącza serwerów hosta. Dlatego komenda najpierw odczytuje
rozwiązaną konfigurację do pamięci (bez jej drukowania), wyłącza każdy MCP i sprawdza wynik przed startem modelu;
nie otwiera plików uwierzytelnienia. Zasady konfiguracji: [OpenCode](https://opencode.ai/docs/config/),
[uprawnienia](https://opencode.ai/docs/permissions/), [agenci](https://opencode.ai/docs/agents/).

```powershell
# Tylko do późniejszej lokalnej próby; nie uruchamiaj w runie wykonawcy Cezara.
@'
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const model = 'openrouter/deepseek/deepseek-v4.1-flash-1017';
const spec = fs.readFileSync('.ai/spec.md', 'utf8').replace(/^\uFEFF/, '');
if (!spec.trim()) throw Error('Brak specyfikacji');
const env = { ...process.env, OPENCODE_DISABLE_CLAUDE_CODE: 'true',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  OPENCODE_DISABLE_AUTOUPDATE: 'true' };
// Nie dziedzicz inline config hosta; zachowaj jego standardową konfigurację dostawcy.
delete env.OPENCODE_CONFIG_CONTENT;
const resolved = () => JSON.parse(execFileSync('opencode', ['debug', 'config', '--pure'],
  { env, encoding: 'utf8', windowsHide: true }));
const host = resolved();
const permission = Object.fromEntries(Object.keys(host.permission || {}).map(k => [k, 'deny']));
Object.assign(permission, { '*': 'deny', read: { '*': 'allow', '**/.env*': 'deny',
  '**/auth.json': 'deny', '**/panel.env': 'deny', '**/*token*': 'deny',
  '**/*.dpapi': 'deny', '**/private.pem': 'deny' }, glob: 'allow', grep: 'allow', list: 'allow',
  external_directory: 'deny' });
const agent = 'rybka-' + process.pid;
const role = 'Recenzujesz specyfikację, nie wykonujesz jej. Przeczytaj zasady repo w AGENTS.md i README.md. ' +
  'Czytaj tylko repo, bez poświadczeń, tokenów, panel.env, DPAPI ani prywatnych danych poza repo. ' +
  'Nie zapisuj plików/danych, nie używaj powłoki, delegacji ani MCP. ' +
  'Dla każdej uwagi podaj: Niejasność, Niezapisane założenie, Wpływ na wykonanie, Pytanie; ' +
  'przy braku uwag napisz: brak uwag.';
const config = { model, small_model: model, permission,
  mcp: Object.fromEntries(Object.keys(host.mcp || {}).map(k => [k, { enabled: false }])),
  agent: { [agent]: { mode: 'primary', description: 'Niezależny przegląd specyfikacji',
    model, prompt: role, permission } } };
env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
if (Object.values(resolved().mcp || {}).some(m => m.enabled !== false)) throw Error('MCP nadal aktywne');
const rawPath = '.ai/rybka-report.jsonl';
const out = fs.openSync(rawPath, 'w'), err = fs.openSync('.ai/rybka-stderr.log', 'w');
const child = spawn('opencode', ['run', '--pure', '--agent', agent, '--model', model,
  '--format', 'json', spec], { env, stdio: ['ignore', out, err], windowsHide: true });
let timedOut = false;
const timer = setTimeout(() => {
  if (child.exitCode !== null) return;
  timedOut = true;
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
    { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}, 600000);
child.on('error', () => { process.exitCode = 1; });
child.on('close', code => {
  clearTimeout(timer); fs.closeSync(out); fs.closeSync(err);
  const events = fs.readFileSync(rawPath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const report = events.filter(e => e.type === 'text').map(e => e.part?.text || '').join('\n').trim();
  if (timedOut || code !== 0 || events.some(e => e.type === 'error') || !report) {
    console.error('Rybka: błąd, timeout lub brak raportu; zadanie nie jest gotowe.');
    process.exitCode = 1; return;
  }
  fs.writeFileSync('.ai/rybka-report.md', report, 'utf8');
  console.log('Raport: .ai/rybka-report.md — oceń jego kompletność i pokaż użytkownikowi.');
});
'@ | node -
```

Nie przedstawiaj samego JSONL z metadanymi jako skutecznego raportu. W tym zadaniu komendę i konfigurację oceniamy
przez lekturę, bez wywołań dostawców, tworzenia rozmów ani zapisów do panelu. Rzeczywista lokalna próba na specyfikacji
pilotażu 2 nastąpi po scaleniu i jest poza warunkami odbioru tego zadania.

## Przykład statyczny: brak wskazanej listy

W panelu są listy „Dom”, „Praca” i „Do poprawy”; poniższy szkic celowo nie wskazuje docelowej listy:

```markdown
CEL: Na liście zadań ma pojawić się „Zamów kawę” z notatką „Skończyły się ziarna”.
ZAKRES: Jedno zadanie na liście; bez zmian API/UI.
POZA ZAKRESEM: Inne listy, tworzenie list, zamawianie kawy.
DECYZJE:
- 2026-11-01 — zadanie dodaje agent z by: agent — źródło: użytkownik.
WARUNKI ODBIORU:
1. „Zamów kawę” istnieje na wskazanej liście z notatką „Skończyły się ziarna” — GET /api/todos.
WYKONAWCA: rozmowa
REPO: przyklad-repo, C:\projekty\przyklad-repo (dostępne wykonawcy).
TRYB: implementacja
ZAŁĄCZNIKI: brak
```

Oczekiwane pytania rybki: „Na którą listę ma trafić zadanie: Dom, Praca czy Do poprawy?” i „Czy wybór listy jest
decyzją użytkownika?”. Niejasność: brak listy; niezapisane założenie: dowolna lista wystarczy; wpływ: nie da się
jednoznacznie wykonać zakresu ani sprawdzić kryterium 1. To blokada gotowości, nie uwaga redakcyjna.

Po odpowiedzi użytkownika „Lista Dom” słoń pokazuje poprawki:

- CEL i ZAKRES: zadanie trafia na listę „Dom”.
- DECYZJE: `2026-11-01 — lista docelowa: Dom — źródło: użytkownik (odpowiedź w rozmowie)`.
- Warunek 1: zadanie z podaną notatką istnieje na liście „Dom” — `GET /api/todos` i kontrola id listy.

Pozostałe sekcje pozostają bez zmian; tę konkretną uwagę rozstrzygnięto bez dopowiadania decyzji. Przejście
checklisty: są wszystkie pola, określone granice, datowane decyzje, mierzalny wynik z metodą i `ZAŁĄCZNIKI: brak`;
pytanie użytkownika ma odpowiedź, usunięcie wskazanego braku nie wymaga automatycznie nowej rybki. Przykład i raport
są fikcyjne — w rzeczywistym zadaniu warunek skutecznego przeglądu wymaga rzeczywistego raportu, nie tego przykładu.
Ocena przez lekturę nie wywołuje modelu, nie tworzy rozmów i niczego nie zapisuje; wynik oceny wpisz do podsumowania
wykonawcy, bez przedstawiania go jako dowodu próby modelu.

## Zapis specyfikacji

Przed POST sprawdź adres/wiązanie/port w [server/index.ts](../../server/index.ts), regułę `Origin` w
[server/app.ts](../../server/app.ts) i kontrakt oraz limity w [zadania.md](../zadania.md#zapis-i-dostęp).
Lokalnie domyślnie adres i Origin to `http://127.0.0.1:5174`; nie zakładaj portu bez sprawdzenia.

1. `GET /api/todos`: wybierz jednoznacznie listę wskazaną przez użytkownika. Przy kilku pasujących listach lub
   braku wskazanej listy pytaj, bez cichego wyboru i tworzenia listy.
2. Tytuł ma nazywać rezultat; krótka notatka streszcza cel i wskazuje wersję pełnej specyfikacji w komentarzach.
3. Podziel pełną specyfikację po akapitach/liniach, zachowując tekst i kolejność. Pierwszy komentarz zaczyna
   `spec: <autor>` (np. `spec: Codex`, gdy autorem jest Codex); każda część ma `Specyfikacja vN — i/N`.
   Sprawdź **oba** limity: 2000 znaków z nagłówkiem oraz 4096 bajtów UTF-8 całego JSON-a żądania
   (`Buffer.byteLength(json, 'utf8')` lub `[Text.Encoding]::UTF8.GetByteCount($json)`).
4. Sprawdź miejsce w historii: najwyżej 200 wpisów, licząc nowe komentarze, zmiany statusu i komentarz o strukturze.
   Jeśli zapis wypchnąłby historię, zatrzymaj się i zapytaj; nie usuwaj jej.
5. Wykonaj sekwencję poniżej; każda zmiana ma `by: agent`.

| Krok | Żądanie i wymagane pola |
| --- | --- |
| Utworzenie | POST /api/todos/action: `{action:"addTask", list, title, note, by:"agent"}`; zachowaj zwrócone `task.id` |
| Specyfikacja | Kolejne POST: `{action:"addComment", task, text, by:"agent"}` dla każdej części |
| Kontrola kompletu | GET /api/todos: sprawdź obecność i pełną treść wszystkich części w kolejności |
| Gotowość | POST: `{action:"setStatus", task, status:"gotowe", by:"agent"}` dopiero po kontroli kompletu |
| Struktura | Osobny POST: `{action:"addComment", task, text:"Struktura: …", by:"agent"}` |
| Potwierdzenie | Końcowy GET /api/todos: stan i wszystkie komentarze |

Przy istniejącym zadaniu zachowaj jego id, pozostaw szkic w `przygotowanie` i dopisz pełną nową wersję; nie wykonuj
ponownie `addTask`. Notatkę z numerem aktualnej wersji zmienia `updateTask` z `by: agent`.

**Błąd częściowy przerywa sekwencję**, bez ustawiania `gotowe`. Przed wznowieniem odczytaj `GET /api/todos`, id zadania
i już zapisane części; wznów od brakującej części, bez powtarzania `addTask`. Jeśli id się nie zachowało, odszukaj
zadanie na wskazanej liście; nie twórz duplikatu. Przy błędzie po ustawieniu `gotowe` odczytaj stan i dokończ brakujący
krok, nie traktuj sekwencji jako zakończonej.

Nowa rewizja to pełny komplet oznaczony nową wersją, z własnym `spec: <autor>` w pierwszej części; stare komentarze
pozostają bez zmian. Końcowy komentarz opisuje **braki struktury zadania** ujawnione przy przygotowaniu (np. brak
osobnego pola na wersjonowaną specyfikację) albo `Struktura: brak`; to obserwacja, nie rozszerzenie prac o API/UI.
Zapisana specyfikacja trafia do wykonawcy w późniejszym zleceniu — samo przygotowanie i status `gotowe` go nie uruchamiają.
