# Ukryte testy akceptacyjne wykonawcy — 31.10–1.11.2026

OpenCode z `openrouter/deepseek/deepseek-v4.1-flash-1017` przeszedł zwykły `just check` w trzech próbach, lecz ukrytą akceptację tylko w dwóch: **14/19 przypadków**, w tym **9/14 przypadków brzegowych i zgodności**. B2, czyli kilka godzin automatu, uzyskało 6/11. To pojedyncze wykonania trzech zadań, nie estymata ogólnej skuteczności modelu.

Kontynuacja [pierwszego pomiaru](executor-evaluation-2026-10-31.md). Implementował wyłącznie DeepSeek; orkiestrator uruchamiał kontrole i oceniał wyniki. Żadna implementacja z prób nie trafiła do produktu. Cezara nie aktualizowano, nie dispatchowano tasków i nie klikano rzeczywistych kart zgody.

## Metoda

Każdy wykonawca otrzymał brief opisujący zachowanie, zakres i zakazy, bez listy pułapek ani testów akceptacyjnych. H1: jedna dzienna/tygodniowa automatyzacja z maksymalnie sześcioma wybranymi godzinami, czytelne opisy i zachowanie istniejących automatów. H2: po przyjęciu wiadomości przez Hermes panel dalej śledzi ten sam run mimo błędu lokalnego zapisu, pokazuje odpowiedź i pozwala wysłać następną wiadomość. H3: nowe rozmowy bez jawnego silnika zaczynają się na Hermesie; jawne agy i silnik istniejącej rozmowy pozostają obsługiwane.

Briefy, testy i manifest są poza Gitem, w `C:/t/hcal/`. Manifest v2 zamrożono **przed pierwszym uruchomieniem wykonawcy**. W kontroli wstępnej poprawiono wyłącznie porównanie zapisu `7:00`/`07:00` na porównanie znaczenia czasu oraz sprecyzowano, że API przyjmuje `times: string[]`; po obejrzeniu implementacji nie zmieniano orakla. Testy sprawdzono na commitach referencyjnych i bazach. Referencje przeszły 11/11, 4/4 i 4/4; bazy odpowiednio 4/11, 1/4 i 2/4.

Akceptacja używa rzeczywistych modułów produktu, prywatnych magazynów tymczasowych i istniejącego mocka API Hermesa. Nie jest dowodem zachowania prawdziwego providera ani kliknięć w produkcyjnym panelu.

Wykonawca pracował w osobnym detached worktree, z własnym `node_modules` instalowanym przez rzeczywisty `executor-prepare.mjs` z bieżącego checkoutu. Uruchamiał go rzeczywisty `executor-run.mjs`: przypięty model główny i pomocniczy, stdin ignorowane, 20 min limitu całkowitego i 4 min bez wyjścia, bez commitów/pusha/dispatchu. Skrypty środowiska wywoływano przez ścieżkę absolutną, bez kopiowania ich do historycznego diffu. `VITEST_MAX_WORKERS=2`.

Kolejność: koniec pracy modelu → zapis diffu i metryk → oryginalny pełny `just check` → dopiero wtedy skopiowanie zamrożonego testu do worktree → akceptacja → usunięcie tego testu. Nie przekazano wykonawcy wyniku ukrytych testów ani rundy poprawek. Ślad narzędzi nie wykazuje odczytu prywatnych testów/manifestu przed ich wstawieniem ani czytania rozwiązania z historii Git. `git checkout -- server/automations.test.ts` w H1 cofał własną edycję bieżącego testu, nie pobierał historycznego rozwiązania.

## Wyniki

| Próba | Odpowiednik | Baza | Referencja | just check | Akceptacja | Brzegowe / zgodność | OpenCode / check [s] | USD |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| H1 | B2 · kilka godzin | `a894df8f1827980bbd7b1ae7ddbaed7568bfaf23` | `68f530d` | PASS | 6/11 | 3/8 | 527.1 / 130.0 | 0.216854 |
| H2 | B3 · zapis przyjętego runu | `798e19955368efe7e82a883781955fc4a898d668` | `a671953` | PASS | 4/4 | 3/3 | 118.1 / 124.5 | 0.015176 |
| H3 | B1 · domyślny Hermes | `26f26c4bcbf34d22c346117e60950c5939c22406` | `ddc5ad8` | PASS | 4/4 | 3/3 | 79.9 / 127.3 | 0.010566 |

Łączny koszt wykonawców: **0.242596 USD**, bez przygotowania testów. Brak rund poprawkowych po akceptacji. Czasy nie są czasami CPU; zwykłe testy i ukryta akceptacja były osobnymi etapami.

| Próba | Input | Output | Reasoning | Cache read | Total z OpenCode |
| --- | ---: | ---: | ---: | ---: | ---: |
| H1 | 1037381 | 21581 | 25764 | 10946560 | 12031286 |
| H2 | 56179 | 522 | 6189 | 907520 | 970410 |
| H3 | 40550 | 134 | 4737 | 520192 | 565613 |

Są to sumy rzeczywistych `step_finish`, łącznie z ponownie przetwarzanym kontekstem i cache; nie rozmiar jednego promptu. Cache write wynosił 0. Koszt pochodzi z USD raportowanego przez OpenCode; nie przeliczaliśmy tokenów według cennika ani nie uzgadnialiśmy tego z rachunkiem OpenRoutera.

## Co wykazały przypadki

| Przypadek | Zachowanie sprawdzane po pracy | Wynik |
| --- | --- | --- |
| H1-C1 | ID wcześniej istniejącej karty z `time` pozostaje takie samo | FAIL |
| H1-C2 | Stary zapis pojedynczej godziny ładuje się i uruchamia automat | PASS |
| H1-C3 | Sam odczyt starego zapisu nie przepisuje pliku | FAIL |
| H1-C4 | Znacznik przeszłej migracji nie uruchamia kolejnego zapisu; bajty i mtime bez zmian | FAIL |
| H1-C5 | Sześć wybranych godzin pozostaje jednym automatem | PASS |
| H1-C6 | Odrzucenie pustej listy, równoważnych duplikatów i ponad sześciu godzin | FAIL |
| H1-C7 | Czytelne opisy godzin dziennych i tygodniowych | PASS |
| H1-C8 | Najbliższe przyszłe wystąpienie spośród kilku godzin | PASS |
| H1-C9 | Slot, który minął podczas wcześniejszego runu, wykonuje się raz | FAIL |
| H1-C10 | Zmiana harmonogramu podczas runu zachowuje nowe `nextRunAt` | PASS |
| H1-C11 | Tygodniowy harmonogram, DST i jednorazowy run zachowują działanie | PASS |
| H2-C1 | Błąd zapisu po przyjęciu nie zatrzymuje odpowiedzi i następnej wiadomości | PASS |
| H2-C2 | Przyjęta tura nie jest ponownie wysyłana do Hermesa | PASS |
| H2-C3 | Przyjęte załączniki trafiają do tego runu i pozostają dostępne w rozmowie | PASS |
| H2-C4 | Błąd przed przyjęciem zwalnia rozmowę; ponowienie nonce działa | PASS |
| H3-C1 | Brak engine oznacza Hermes mimo zapisanej preferencji agy | PASS |
| H3-C2 | Jawne agy i wcześniejsza rozmowa agy zachowują silnik | PASS |
| H3-C3 | Powtórzone utworzenie z tym samym nonce daje jedną rozmowę i run | PASS |
| H3-C4 | Niedostępny Hermes daje 503 bez cichego agy | PASS |

Jedna pozycja oznacza jeden nazwany przypadek Vitest, czasem grupujący kilka powiązanych asercji, np. walidację lub DST. „Brzegowe / zgodność” wyłącza podstawowe zachowania H1-C5/C7/C8, H2-C1 i H3-C1. Nie zwiększano liczby przypadków przez liczenie każdej asercji osobno.

H1-C6 zakończył się na asercji duplikatów, nie na trzech niezależnych porażkach walidacji. Brief nie określał jawnie polityki powtórzonych godzin; ich scalanie jest możliwą interpretacją wyboru godzin. Dlatego tego wyniku nie traktujemy jako jednoznacznego złamania jawnej specyfikacji. Po wyłączeniu samego C6 wynik wynosi **H1: 6/10, razem 14/18**. Surowy wynik zamrożonego orakla pozostaje 14/19, bez zmieniania testu po pracy modelu.

W H1 zmiana normalizacji zmieniła hash starej karty. Odczyt normalizował i zapisywał magazyn, a `migratedFrom` nie był traktowany jako zapis przeszłego zdarzenia. Walidacja scalała równoważne godziny zamiast je odrzucać. Zakończenie runu liczyło następną godzinę od końca, więc slot w trakcie runu przepadał. Przejście H1-C10 oznacza zachowanie wymagania, nie dowód, że model sam odkrył nową pułapkę.

Względem zamrożonego orakla: na 12 przypadków czerwonych w bazach wykonawca zazielenił 9. Z 7 zielonych bazowo zachował 5, a 2 stały się czerwone (H1-C1 i opisany wyżej H1-C6). Przypadki odczytu bez zapisu były czerwone już w bazie; nie przypisujemy wykonawcy stworzenia całego wcześniejszego problemu ani nie twierdzimy, że wszystkie dodatkowe oczekiwania orakla wynikały wprost z krótkiego briefu. Wynik pokazuje spełnienie prywatnego orakla bez znajomości jego testów, nie wszystkie możliwe zachowania produktu. Opisów w dokumentacji i narzędziach H1 nie oceniał ten zestaw automatycznie.

## Zakres i wniosek

H1 i H2 pozostały w opisanym obszarze i czytały istniejące testy przed zmianami. H3 dodatkowo poprawiło jeden komentarz `engine` w `src/chat-contract.ts`, poza literalną listą plików briefu; to **1 plik poza listą**, bez zmiany zachowania poza celem. Nie uznajemy tego za wycięcie pamięci ani instrukcji Wektora. H3 czytało testy poleceniami PowerShell, dlatego samo zliczenie narzędzia `read` dałoby błędny wniosek, że nie czytało fikstur. H1 czytało testy automatów, ale ślad nie potwierdza odczytu wspólnego `scenarios/standard.json` przed pierwszą edycją.

Rekomendacja: zwykły brief powinien podawać zachowanie, granice i istniejące kontrakty do przeczytania. Niezależna akceptacja musi obejmować zgodność zapisów, tożsamość kart, idempotencję i przeploty czasowe; nie wolno utożsamiać zielonych testów dopisanych przez wykonawcę z niezależną akceptacją. W tej próbie proste zadanie i naprawa przyjętego runu poradziły sobie bez listy pułapek; funkcja z migracją i harmonogramem jej nie zastąpiła. Nie zmieniono produkcyjnego workflow na podstawie trzech pojedynczych prób.

Surowe ślady, briefy z hashami SHA-256, zamrożony manifest v2, kontrole baz/referencji, diffy i raporty Vitest: `C:/t/hcal/manifest.json`, `logs/`, `runs/H1–H3/`, `summary.json`. Worktree służące próbom usunięto po zachowaniu tych artefaktów; prywatne testy i logi pozostają poza Gitem. Pełna suite Cezara nadal nie jest potwierdzona jako zielona; odłożoną aktualizację zapisano jako zadanie panelu `t-5d910048`.
