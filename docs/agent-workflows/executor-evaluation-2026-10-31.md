# Wykonawcy OpenCode — pomiar przed i po (31.10.2026)

Implementował wyłącznie OpenCode z modelem `openrouter/deepseek/deepseek-v4.1-flash-1017`; review wykonywał agy `gemini-3.8-flash-high` na zapisanym pliku diff. Orkiestrator przygotowywał próby, uruchamiał weryfikację i zbierał wyniki. Poprawki z prób nie weszły do produktu: odtwarzały istniejące już zmiany historyczne, a worktree były usuwane po ocenie.

## Metoda i zakres wniosku

Pięć zadań, po jednej parze prób na zadanie. Każda próba miała osobny detached worktree pod `C:/t/`, własne `node_modules` z `npm ci --prefer-offline --no-audit --no-fund` i tę samą bazę w obu wariantach. Nie udostępniano wykonawcy patcha rozwiązania; brief podawał zachowanie i kryteria. Dwa procesy prowadziły niezależne próby. `VITEST_MAX_WORKERS=2` ograniczał każdą weryfikację.

„Przed” używało promptu implementacji ze starego workflow (stan `68f530d`), z nadrzędnym zakazem commita/pusha i wskazanym zakresem. Instalator bazowy był już izolowany i headless — nie testowano ponownie starego destrukcyjnego prepare ani współdzielenia node_modules. „Po” uruchamiało rzeczywiste poprawione skrypty prepare/run z bieżącego checkoutu, z wypełnionym briefem: baza, dozwolone pliki, zakazy, jawna lista read-first z fiksturami, kryteria i plik podsumowania. Historycznych worktree nie zanieczyszczano kopiami nowego środowiska.

To porównanie zachowania wykonawcy i procesu lokalnego, nie dziesięć dispatchów Cezara. Żaden agent nie dispatchował zadania, nie publikował PR-a ani nie klikał prawdziwej karty zgody. Transport OpenCode i tryb odczytu agy sprawdzono osobno rzeczywistymi runnerami Cezara, bez tworzenia tasków. Jedna para na zadanie i różne obciążenie komputera nie pozwalają dowodzić statystycznej poprawy modelu ani czasu.

## Zadania i przypięte bazy

| Próba | Baza obu wariantów | Commit odniesienia | Zakres |
| --- | --- | --- | --- |
| B1 · domyślny silnik czatu | `26f26c4bcbf34d22c346117e60950c5939c22406` | `ddc5ad8` | `server/chat-hub.ts`, `server/hermes-chat.test.ts`, `docs/hermes.md` |
| B2 · kilka godzin automatu | `a894df8f1827980bbd7b1ae7ddbaed7568bfaf23` | `68f530d` | `server/automations.ts`, `server/hermes-chat.ts`, `server/panel-mcp.ts`, `src/automation-contract.ts`, `src/chat-contract.ts`, `src/cockpit-contract.ts`, `server/automations.test.ts`, `server/automations-regression.test.ts`, `server/automations-mcp.test.ts`, `server/hermes-chat.test.ts`, `src/automations.test.tsx`, `src/cockpit/automation-card.tsx`, `docs/automaty.md` |
| B3 · zapis po przyjęciu runu | `798e19955368efe7e82a883781955fc4a898d668` | `a671953` | `server/hermes-chat.ts`, `server/hermes-chat.test.ts`, `docs/hermes.md` |
| B4 · blokada update / scenario-stop | `3eaf763df4fadd83caaf73192ff113fdc7caf485` | `77e72c6` | `scripts/update.mjs`, `scripts/update.test.mjs`, `justfile`, `AGENTS.md`, `servy/README.md` |
| B5 · diagnoza EEXIST w teście | `ddc5ad8f64bca84f7027a3f47a28d1ab35aa2ef8` | `671af7f` | `server/hermes-chat.test.ts` |

Kryteria briefów (wspólne dla obu wariantów):

- **B1 · domyślny silnik czatu:** New API-created chats must default to Hermes regardless of a persisted agy engine preference; an explicit engine agy request must still work. Update the existing tests and the relevant documentation. Preserve existing conversations and their engines.
- **B2 · kilka godzin automatu:** Support one daily or weekly automation running at up to six distinct local HH:mm times per day, so morning and evening need one automation. Add contract validation, scheduling, agent tool contract/instructions and concise labels; cover with tests and document. Legacy single-time records and cards must load unchanged and preserve proposal/card IDs; reject invalid/duplicate/empty/over-limit time sets; preserve DST/timezone handling, once/moment behavior. On completion schedule from the slot the run was due for (a passed slot during the run must run once); editing schedule during a run preserves the newly computed nextRunAt. Do not add providers or direct unapproved actions. This is a backend/contract task; no real GUI or confirmation clicks.
- **B3 · zapis po przyjęciu runu:** Fix the chat being stuck busy when Hermes accepts a run but persisting the local turn fails. Continue following the accepted run and settle normally without sending a second Hermes run. Preserve pending attachments/retry semantics, emit an honest save error, add a regression test covering the save failure and eventual completion. Update owning documentation if behavior changes.
- **B4 · blokada update / scenario-stop:** Prevent Windows just update dist swap while scenario servers are running; explain PID and how to stop them. Add just scenario-stop for leftover node scenario processes and document it. Test refusal without stopping/restarting a real service. Keep PowerShell 5.1 commands ASCII and unrelated node processes safe. Non-Windows updates retain existing behavior. Do not actually run update, service commands or kill real scenario processes in this test.
- **B5 · diagnoza EEXIST w teście:** Diagnose and fix an intermittent failure in the attachment save-failure test: mkdir of `<id>.json.tmp` can fail EEXIST while a background save of a previously finished turn is still using that temporary path. Reproduce or provide concrete ordering evidence. Keep the real save-failure assertion and production persistence semantics intact. Use a bounded, robust wait/coordination (not an unconditional long sleep or disabling the test). Change only the test, no production code.

## Wyniki przed i po

Czas OpenCode obejmuje wszystkie jego wywołania w próbie; czas check to suma pełnych `just check`. Czas końcowego review jest osobny. Nie są to czasy CPU ani estymaty. Koszt to suma USD z rzeczywistych `step_finish` wykonawcy, bez review w abonamencie agy i bez budowy samego środowiska.

| Próba | Wariant | just check: pierwszy / końcowy | Review końcowy | Rundy po pierwszym wywołaniu | Poza zakresem (pliki) | OpenCode / check / review [s] | Koszt DeepSeek [USD] |
| --- | --- | --- | --- | ---: | ---: | --- | ---: |
| B1 · domyślny silnik czatu | przed | PASS / PASS | 0 · approve | 1† | 0 | 175.1 / 310.0 / 161.2 | 0.020566 |
| B1 · domyślny silnik czatu | po | PASS / PASS | 0 · approve | 0 | 0 | 123.1 / 128.7 / 157.9 | 0.026054 |
| B2 · kilka godzin automatu | przed | PASS / PASS | 0 · approve | 1† | 0 | 751.9 / 298.8 / 348.5 | 0.100500 |
| B2 · kilka godzin automatu | po | PASS / PASS | 0 · approve | 0 | 0 | 556.3 / 132.2 / 307.7 | 0.260178 |
| B3 · zapis po przyjęciu runu | przed | PASS / PASS | 0 · approve | 0 | 0 | 307.4 / 134.2 / 382.7 | 0.105058 |
| B3 · zapis po przyjęciu runu | po | PASS / PASS | 0 · approve | 0 | 0 | 213.8 / 130.5 / 387.3 | 0.078616 |
| B4 · blokada update / scenario-stop | przed | PASS / PASS | 0 · approve | 0 | 0 | 156.7 / 107.8 / 187.5 | 0.046333 |
| B4 · blokada update / scenario-stop | po | PASS / PASS | 0 · approve | 0 | 0 | 189.5 / 111.6 / 241.0 | 0.044193 |
| B5 · diagnoza EEXIST w teście | przed | PASS / PASS | 0 · approve | 0 | 0 | 191.8 / 124.9 / 173.3 | 0.019671 |
| B5 · diagnoza EEXIST w teście | po | PASS / PASS | 0 · approve | 0 | 0 | 328.1 / 125.1 / 239.4 | 0.025853 |

† B1 i B2 miały dodatkowe wywołanie po technicznym błędzie uprawnień runnera review, nie po uwadze do kodu. W B1 zmieniło tylko ignorowane podsumowanie; w B2 wykonawca podczas ponownej kontroli poprawił przesuwanie harmonogramu po spóźnionym starcie i dołożył testy. Początkowy błąd agy (pusty wynik mimo exit 0) oraz powtórzenia nie są dowodem słabości kodowania DeepSeeka. Końcowy B2 oceniono ponownie na statycznym diffie po obu wykonaniach; dopiero ten werdykt jest tu uznany. Dwie wcześniejsze próby rozruchowe przerwano i wyłączono z tabeli. Dlatego różnicy czasu/kosztu B1/B2 nie należy przypisywać samemu briefowi.

| Tokeny wykonawcy | Wejście bez cache | Wyjście | Rozumowanie | Cache read / write | Total raportowany |
| --- | ---: | ---: | ---: | --- | ---: |
| B1 · domyślny silnik czatu · przed | 81 378 | 3282 | 5772 | 975 488 / 0 | 1 065 920 |
| B1 · domyślny silnik czatu · po | 85 355 | 5447 | 8093 | 1 709 056 / 0 | 1 807 951 |
| B2 · kilka godzin automatu · przed | 193 331 | 24 904 | 45 936 | 9 665 408 / 0 | 9 929 511 |
| B2 · kilka godzin automatu · po | 1 264 338 | 24 466 | 29 348 | 12 746 368 / 0 | 14 064 520 |
| B3 · zapis po przyjęciu runu · przed | 506 818 | 8138 | 24 972 | 3 056 384 / 0 | 3 596 312 |
| B3 · zapis po przyjęciu runu · po | 384 314 | 7679 | 12 754 | 2 902 912 / 0 | 3 307 659 |
| B4 · blokada update / scenario-stop · przed | 192 932 | 1448 | 19 992 | 1 509 632 / 0 | 1 724 004 |
| B4 · blokada update / scenario-stop · po | 174 982 | 1303 | 20 736 | 1 574 144 / 0 | 1 771 165 |
| B5 · diagnoza EEXIST w teście · przed | 84 510 | 616 | 6528 | 902 656 / 0 | 994 310 |
| B5 · diagnoza EEXIST w teście · po | 84 316 | 1094 | 12 754 | 1 632 384 / 0 | 1 730 548 |

`total` OpenCode obejmuje również cache i rozumowanie; to suma ramek, nie liczba unikalnych tokenów tekstu. Końcowe uznane review agy: 1 670 073 tokenów `total_tokens` i 10 589 216 `cache_read_tokens`; CLI nie podało kosztu USD, więc koszt agy to **N/D**, nie 0. Nie wliczono tu odrzuconych/diagnostycznych wywołań recenzenta.

## Co wynika z pomiaru

- Pełny check pierwszego podejścia: przed 5/5, po 5/5. Końcowy check i poprawny werdykt approve: przed 5/5, po 5/5. To obserwacje dla tych briefów; same zielone testy i review nie dowodzą braku błędów.
- Zmiany poza listą dozwolonych plików: przed 0, po 0. Nie odtworzono wycięcia pamięci Wektora. Żaden executor nie zrobił commita ani pusha (HEAD sprawdzano względem przypiętej bazy). Taki wynik małej próby nie gwarantuje przyszłej zgodności.
- B2 przed: przed pierwszą edycją odczytywano testy backendu, ale test UI sprawdzano grepem; nie odczytano wtedy `src/test-fixtures.ts` ani `scenarios/standard.json` (próby rg z wildcardem nie odczytały tych danych). B2 po: przed pierwszą edycją odczytano `src/test-fixtures.ts` w całości oraz 110 linii sekcji automatów w `scenarios/standard.json`; odczytywano także test UI i kontrakt. W śladzie read-first po nadal brak pełnego odczytu wskazanego `server/hermes-chat.test.ts` przed pierwszą edycją; samo polecenie nie egzekwuje całej listy. Potwierdzono poprawę odczytu wspólnych fikstur, nie pełną zgodność ze wszystkimi instrukcjami.
- B5 przed rozpoznało, że stan „finished” w pamięci wyprzedza zapis, i użyło istniejącego `service.drain()` zamiast przypadkowego sleep/retry. To poprawna diagnoza na danych testowych. Znane ryzyko wyścigów pozostaje powodem osobnego kryterium red→green i review, a nie pretekstem do nowych osi refaktoru.
- Koszt porównywanych wywołań DeepSeek: przed 0.292127 USD, po 0.434895 USD. Różnica zawiera wskazany narzut rozruchowy i zmienną wielkość/cache kontekstu; nie jest czystym efektem nowego promptu. Samo pierwsze wykonanie w wariancie przed kosztowało 0.236125 USD. Wynik nie potwierdza spadku kosztu ani wzrostu skuteczności: oba warianty mają komplet zielonych końcowych ocen przy małej próbie.

## Zmiany środowiska na podstawie prób i kontroli

Instrukcja użycia i kontrakt środowiska są w [desk-panel-task.md](desk-panel-task.md), a brief w [executor-brief.md](executor-brief.md). Ważne wnioski: instalacja musi być własna i powtarzalna; zero exit code nie zastępuje końca tury ani werdyktu; fikstura parsera musi pochodzić z prawdziwego strumienia (zewnętrzne `step_finish`, wewnętrzne `step-finish`); diff obejmuje także śledzone workflow pod `.ai/`; powtórzenie finalizacji nie może ponownie przepisywać historii.

Cezar nie wznawia sesji OpenCode między krokami. `fix` i `address` dostają pełne `{{task}}` i plik podsumowania, a nie obietnicę zachowanej pamięci. Review ma `allowedTools: [Read, Glob, Grep]`, co uruchamia tryb odczytu runnera Cezara, oraz zakaz natywnych komend i tworzenia plików. W eksploracyjnej recenzji prompt-only agy utworzyło dwa repozytoria pomocnicze w Temp; tej recenzji nie uznano za zatwierdzenie. Guard nie cofa efektu, o którym provider powie dopiero po wykonaniu.

Budowa środowiska nie jest jedną z pięciu prób: pierwsze wykonanie DeepSeek przekroczyło limit 20 min (1200,5 s, 0.164892 USD); krótka runda napraw i korekta promptów kosztowały odpowiednio 0.069757 i 0.035895 USD. Limit zachował diff i zakończył własne procesy; timeout nie jest dowodem zakleszczenia modelu.

## Weryfikacja integracji i publikacja

- Środowisko Desk Panel: targeted tests i typecheck, rzeczywisty smoke CLI (5 s, niepuste tokeny i koszt), loader Cezara bez problemów (21 węzłów / 8 kroków), pełne `just check` (131,3 s) oraz rzeczywisty review przez `AgyCliRunner` z `allowedTools` (210,3 s, approve bez uwag). Wszystkie te próby bez dispatchu taska.
- Cezar: `551379da` na main; stdin serwera OpenCode zamykane od razu, dwa testy regresji wykazano red→green. 27 testów OpenCode i typecheck przeszły; node:test: 40 PASS / 2 SKIP; build i test paczki: 17 PASS / 0 SKIP. Dwa błędy Unixowego trybu 0600 w private-mcp potwierdzono również na niezmienionym checkoutcie. Pełny Vitest wykazał wiele błędów Windows, nie zakończył się po ok. 16 min i został przerwany — pełna suite **nie jest zielona**.
- Cezar wdrożony z czystego `C:/t/cenv` przez `CEZAR_REPO` i `just deploy`, bez aktywnych tasków; Servy restart zakończył się poprawnie. W instalacji zarządzanej `0.15.2+local` potwierdzono `this.child.stdin.end()` w zbudowanym pliku. Worktree wdrożeniowe usunięto po instalacji.
- Końcowy `just check` w głównym checkoucie: PASS (129.8 s), `git diff --check`: PASS. Wszystkie utworzone worktree prób, implementacji środowiska i wdrożenia usunięto. Zmiany środowiska i raport trafiają razem na main; patche prób nie są częścią publikacji.

Surowe logi, briefy, patche i metryki pozostają poza Gitem w `C:/t/dpb`. Skrócone ścieżki prób: `bsmall/bfeature/brace/bscript/bdiagnosis` i `asmall/afeature/arace/ascript/adiagnosis`. SHA-256 manifestu zamrożonych plików środowiska: `d5795ab0ff8b42c7dc5ddf457cf0537a7159811beef37cba2a5d1e3a4655aab4`.
