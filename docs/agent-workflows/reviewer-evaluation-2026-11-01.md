# Kalibracja recenzentów — 31.10–1.11.2026

**Pozostawiamy review na agy `gemini-3.8-flash-high`.** W tym zestawie daje najlepszy uzasadniony kompromis jakości, niezawodności i limitu abonamentu. Nie zmieniono `.ai/cezar/workflows/desk-panel-task.yaml`. Wyniki ukończonych recenzji i wyniki dostarczenia poprawnego review są rozdzielone poniżej; brak werdyktu nigdy nie oznacza akceptacji.

## Modele i wykonanie

| Recenzent | Dokładny model / ustawienie | Runner |
| --- | --- | --- |
| Flash | `gemini-3.8-flash-high` | rzeczywisty `AgyCliRunner`, `allowedTools: [Read, Glob, Grep]` |
| Argon 4 | `gemini-4-argon-high` | ten sam runner; nazwę potwierdzono w `agy models`, high wybrano jawnie do porównania z Flash high |
| DeepSeek | `openrouter/deepseek/deepseek-v4.1-flash-1017` | OpenCode; także `small_model` przypięty do tego samego DeepSeeka |
| Codex | `gpt-6.1-sol`, `model_reasoning_effort="medium"` | natywny CLI, osobna ephemeral sesja, ignorowanie konfiguracji użytkownika |

Na OpenRouterze używano wyłącznie wskazanego DeepSeeka. Nie dispatchowano Cezara. Jego istniejący runner agy importowano z lokalnego źródła do samodzielnych, izolowanych recenzji, bez aktualizacji ani wdrażania Cezara. Na start utworzono na panelowej liście „Do zrobienia” zadanie `t-5d910048`: „Zaktualizować Cezara do najnowszej wersji i doprowadzić pełną suite testów do zieleni na Windows”, z opisem świadomego odłożenia 31.10, testów celowanych, zawieszenia Vitest około 16 min i dwóch problemów 0600 w private-mcp. Nie uznajemy pełnej suite Cezara za zieloną.

## Zestaw i zasady oceny

Seria główna: **3 paczki zawierające 17 znanych mechanizmów (8 P1, 9 P2) oraz 3 czyste kontrole, 4 recenzentów, 2 zaplanowane niezależne sesje na przypadek: 48 prób**. Każdy przypadek miał osobny statyczny detached worktree `C:/t/qNN`; recenzenci nie dostawali klucza błędów, prywatnych prób ani logów walidacji. Kolejność podstawowych prób była ustalona, w drugim powtórzeniu odwrócona; korekty metodologii i później dodane kontrole opisano jawnie niżej. To nie był losowy, zaślepiony eksperyment kliniczny.

| Diff | Punkt odniesienia | Treść |
| --- | --- | --- |
| q01 | `7c24f6523b2b8f7d96ff82724c4cbbc91d986767` | sześć cofniętych zabezpieczeń kart zgody: S1–S6 |
| q02 | `68f530d6de5e45f5e93630bfb9fc2b636714eb00` | pięć cofniętych zabezpieczeń kilku godzin automatu: T1–T5 |
| q03 | `a894df8f1827980bbd7b1ae7ddbaed7568bfaf23` | sześć regresji konfiguratora Hermesa: P1–P6 |
| q04 · czysty | wycinek `b9b70e2`, na bazie `68f530d` | opcjonalny root w `scripts/dependencies.mjs`, zachowane domyślne ścieżki |
| q08 · czysty | wycinek `b9b70e2`, snapshot całego `b9b70e2` | zanonimizowana prawdziwa fikstura `scripts/fixtures/opencode-step-finish.jsonl` |
| q09 · czysty | wycinek `b9b70e2`, snapshot całego `b9b70e2` | jeden test sumowania metryk z `scripts/executor-run.test.mjs`; kontrolowana baza to ten plik bez ostatniego testu |

Mutacje zachowują funkcję dodaną przez dany commit, cofając konkretne zabezpieczenia wykryte w review. Nie są pełnym revert całego commitu. Pary przed/po i ich złożenie zweryfikowano prywatnymi próbami zachowania: q01 good 6/6, każda izolowana mutacja czerwona, złożenie 6/6 czerwonych; q02 good 6/6 (w tym zachowanie funkcji), pięć izolowanych błędów i pięć porażek w złożeniu; q03 wszystkie sześć mechanizmów potwierdzone na realnym Windows PowerShell 5.1, po wyodrębnieniu wyłącznie transformacji prywatnych plików YAML. Nigdy nie uruchamiano konfiguratora przeciw rzeczywistym ustawieniom użytkownika. Dla q08/q09 istniejący test parsera/CLI przeszedł 12/12; potwierdza to fiksturę i dodany test, nie stanowi testu live providera.

Wspólny prompt pochodzi z kroku `review` bieżącego workflow. Dla wszystkich modeli zmieniono tylko nieprawdziwe w tym eksperymencie zdanie „verify właśnie przeszedł” na neutralne „nie podano wyniku weryfikacji, nie uruchamiaj testów/komend”. Podstawiano opis celu oraz ścieżkę worktree. Dla danego przypadku model dostawał ten sam tekst i te same bajty `.ai/diff.patch`; prompty, snapshoty i diffy mają zapisane SHA-256. Zakaz edycji, natywnego terminala i wykonywania testów pozostał. Dostępne były kod, istniejące fikstury i dokumentacja; regresyjne testy w referencjach celowo nie były usuwane.

Ocena ręczna: trafienie wymaga wskazania tego samego mechanizmu i warunku jego wystąpienia. Samo „ryzyko wyścigu”, powtórzenie celu, ogólne żądanie testów lub dokumentacji nie daje punktu. Jeden akapit liczy dwa błędy tylko wtedy, gdy opisuje oba, np. utratę slotu oraz nadpisanie zmienionego harmonogramu. Powtórzenia objawu i wtórne rozbieżności dokumentacji nie zwiększają recall. Wagę P1/P2 orakla ustalono przed przeglądaniem odpowiedzi; nie podnosimy jej dlatego, że model użył P0.

### Korekty i wyłączone próby

- **Błąd orkiestratora w pierwszym briefie q03:** błędnie zezwalał na usunięcie `skills`, choć utrata tego toolsetu była zasianym błędem. Wszystkie osiem recenzji tej wersji wyłączono z rankingu, zachowując koszty i logi. Poprawiony brief wymaga zachowania istniejących możliwości Wektora, bez listy błędów; wszyscy czterej recenzenci otrzymali tę samą poprawioną wersję w dwóch nowych sesjach. Nie zmieniano mutacji ani orakla pod odpowiedzi.
- **Kontrole okazały się nie w pełni czyste:** q05 (`ddc5ad8`) ma rzeczywiście nieaktualny opis `PUT /api/chats/engine` w `docs/czat.md` oraz nagłówek `chat-hub.ts`. Takich trafień nie zaliczono jako fałszywych alarmów. q06 (`671af7f`) wywołał spór o timerowy retry zamiast `drain()`; pozostaje audytem, a nie udowodnioną czystą kontrolą. DeepSeek sprawdził też dokumentacyjny wycinek q07 z `b9b70e2`, zgłaszając rozbieżność między szablonem lokalnego briefu i promptem dispatchera; q07 pozostaje eksploracyjne, poza porównaniem modeli i bez punktów za TP/FP. Odpowiedzi zachowano, kontrolę q04 pozostawiono i dodano q08/q09. Dodawanie kontroli już po części wyników i ich mały rozmiar ograniczają siłę wniosku o FP.
- **Limit Codexa:** sześć prób drugiego powtórzenia pierwotnej serii przerwał limit 5h. Nie uznano ich za review. Po odnowieniu limitu uzupełniono sesje; wynik nie ukrywa kosztu ani niedostępności pierwszych wywołań. Wśród nich była też wyłączona stara wersja q03.
- **Odmowa agy:** Flash w drugim audytowym q06 próbował przez `.git` odczytać plik w głównym repo poza przypisanym worktree. Runner przerwał sesję. Nie obchodzono odmowy; oddzielne powtórzenie na dozwolonych źródłach dało werdykt. Pierwsza sesja pozostaje awarią wykonania, a nie `approve`.
- **Awarie DeepSeeka w serii 1.11:** q03/R1 i obie rundy q08/q09 nie dały poprawnego werdyktu. Były m.in. literalne `read_file` zamiast wywołania narzędzia, pusta odpowiedź i timeout bez wyjścia. Niezależny smoke odczytu działał. Nie zmieniano promptu ani adaptera, aby uzyskać korzystniejszy wynik; pokazujemy te próby jako E. Prawidłowe q03/R2 nadal pominęło przeciążenie `Regex.Match`.

## Jak czytać limity, tokeny i czas

USD DeepSeeka to suma kosztu raportowanego przez OpenCode w `step_finish.cost`, także dla częściowych i nieudanych prób; nie jest uzgodniona z rachunkiem OpenRoutera. Nie odpytywano `/api/v1/activity` ani nie drukowano kluczy. Abonamentom nie przypisano fikcyjnej ceny USD.

Przy timeoutach ta suma może być niepełna: ostatni krok bez `step_finish` nie raportuje końcowego kosztu. Brak takiego zdarzenia nie dowodzi, że ostatnie żądanie było darmowe.

Przed i po sesji pobierano publiczne `/api/quotas`, czekając na nowsze `observedAt` po końcu. Zachowano daty obserwacji i resetów. W tabeli Δ są **punkty procentowe wykorzystania limitu**, nie procent pozostałego limitu ani pieniądze. Zsumowano tylko pary z tym samym resetem i niemalejącym licznikiem; reset, korekta licznika lub brak danych daje N/D, nigdy zero. Pokrycie pokazuje, ile par udało się zsumować. Surowe pary są w artefaktach poza Gitem.

To delty konta z opóźnieniem/zaokrągleniem providera, nie wyizolowany rachunek modelu: szczególnie Codex współdzielił konto z orkiestratorem i inną aktywnością. Wynik 0 pp nie dowodzi zerowego zużycia. Sesje agy prowadzono kolejno, bez nakładania Flash/Argon. Argon zużywa osobny `gemini-argon-wtu-weekly`: jego zerowe Δ zwykłych `gemini-5h` / `gemini-weekly` nie znaczy, że recenzja nie kosztuje limitu. Ten osobny tygodniowy licznik pokazano obok wymaganych 5h/7d.

Liczniki tokenów pochodzą z CLI/runnerów. Codex raportuje `input_tokens` z `cached_input_tokens`, agy własne input/output/cache i reasoning, OpenCode sumy kroków. Reasoning może być częścią output w danym formacie; nie należy dodawać kolumn bez uwzględnienia formatu ani traktować ich jako wspólnej taryfy. Są to tokeny kolejnych kroków, często wielokrotnie czytające kontekst. Czas dotyczy procesu modelu, bez oczekiwania na quota; obciążenie, cache, zmiana dnia i kolejność nie były w pełni kontrolowane.


## Recall według mechanizmu

| ID | Waga | Flash R1/R2 | Argon R1/R2 | DeepSeek R1/R2 | Codex R1/R2 |
| --- | --- | --- | --- | --- | --- |
| S1 · starsza smart-rule zapisuje po async preview | P1 | 1/1 | 1/1 | 1/1 | 1/1 |
| S2 · nowe automaty mają wspólny cel new | P2 | 1/1 | 1/1 | 1/1 | 1/1 |
| S3 · różne ID reguł kolidują przez nazwę | P2 | 1/1 | 1/1 | 1/1 | 1/1 |
| S4 · brak kolejności blokuje także ostatnią kartę A→B→A | P2 | 1/1 | 1/1 | 1/1 | 1/1 |
| S5 · guard automatu przed odczytami providerów | P1 | 1/1 | 1/1 | 1/1 | 1/1 |
| S6 · zatwierdzona karta przy ponowieniu dostaje 409 | P2 | 1/1 | 1/1 | 1/1 | 1/1 |
| T1 · normalizacja time→times zmienia ID karty | P1 | 1/1 | 1/1 | 1/1 | 1/1 |
| T2 · liczenie od końca runu pomija slot | P1 | 1/1 | 1/1 | 1/1 | 1/1 |
| T3 · migratedFrom / istnienie pliku powoduje zapis przy odczycie | P2 | 1/1 | 1/1 | 1/1 | 0/0 |
| T4 · dedupe / obcięcie zamiast walidacji godzin | P2 | 1/1 | 1/1 | 1/1 | 1/1 |
| T5 · koniec runu nadpisuje edytowany harmonogram | P1 | 1/1 | 1/1 | 1/1 | 1/1 |
| P1 · utrata toolsetu skills | P1 | 1/1 | 1/1 | E/1 | 1/1 |
| P2 · utrata memory i session_search | P1 | 1/1 | 1/1 | E/1 | 1/1 |
| P3 · istniejący rodzic blokuje brakujące api_server | P2 | 1/1 | 1/1 | E/1 | 0/1 |
| P4 · ASCII niszczy konfigurację Unicode | P1 | 1/1 | 1/1 | E/1 | 1/1 |
| P5 · offset Regex.Match staje się RegexOptions | P2 | 1/1 | 1/1 | E/0 | 1/1 |
| P6 · nagłówek YAML z komentarzem nierozpoznany | P2 | 1/1 | 1/1 | E/1 | 1/1 |

`1` = ten sam mechanizm wskazany w ukończonym review; `0` = pominięty; `E` = brak ważnego review. Wiersze dotyczą mechanizmów, nie liczby akapitów: jedna uwaga może wskazać dwa błędy, a powtórzone opisy jednego błędu liczą się raz.

## Zestawienie

| Recenzent | Ważne / zaplanowane | Trafienia / 34 | P1 / 16 | P2 / 18 | Recall po ważnym review | Waga 2:1, dostarczenie | FP (w tym blokujące) | Czas wszystkich prób [s] |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| flash | 12/12 | 34/34 (100.0%) | 16/16 | 18/18 | 100.0% (34/34) | 100.0% | 0 (0) | 1354.2 |
| argon | 12/12 | 34/34 (100.0%) | 16/16 | 18/18 | 100.0% (34/34) | 100.0% | 1 (1) | 2563.4 |
| deepseek | 7/12 | 27/34 (79.4%) | 13/16 | 14/18 | 96.4% (27/28) | 80.0% | 1 (0) | 884.5 |
| codex | 12/12 | 31/34 (91.2%) | 16/16 | 15/18 | 91.2% (31/34) | 94.0% | 0 (0) | 372.3 |

W dostarczeniu błędy wykonania nie dają trafienia; warunkowy recall wyłącza ich nieodczytane mechanizmy. Wagi P1=2, P2=1 zamrożono przed review; łącznie 50 punktów w dwóch powtórzeniach. P0 nadane przez recenzenta nie zmienia wagi orakla. Czas obejmuje zaplanowane procesy recenzji, bez oczekiwania na odświeżenie quota i bez wyłączonych prób.

## Koszt i limity — seria główna

| Recenzent | USD | Suma Δ 5h [pp] / pokrycie | Suma Δ 7d [pp] / pokrycie | Suma Δ Argon WTU weekly [pp] / pokrycie |
| --- | ---: | --- | --- | --- |
| flash | N/D (abonament) | 6.2997 / 12/12 | 1.7999 / 12/12 | — |
| argon | N/D (abonament) | 0.0000 / 12/12 | 0.0000 / 12/12 | 42.3641 / 12/12 |
| deepseek | 0.128434 | — | — | — |
| codex | N/D (abonament) | 22.0000 / 8/12 | 6.0000 / 12/12 | — |

## Rejestr prób głównych

| Recenzent | Diff / runda | Wynik | s | Input / output / reasoning / cache read | USD albo Δ 5h / 7d [pp] |
| --- | --- | --- | ---: | --- | --- |
| flash | q01/1 | OK | 173.8 | 108658 / 17681 / 15544 / 1050533 | 0.7552 / 0.2158 |
| flash | q01/2 | OK | 243.6 | 288979 / 23725 / 21071 / 2449680 | 1.6313 / 0.4661 |
| flash | q02/1 | OK | 155.3 | 84864 / 19688 / 18608 / 567310 | 0.6000 / 0.1714 |
| flash | q02/2 | OK | 159.9 | 107434 / 21744 / 20418 / 419272 | 0.6452 / 0.1843 |
| flash | q03/1 | OK | 95.0 | 49422 / 12415 / 11360 / 46726 | 0.2904 / 0.0830 |
| flash | q03/2 | OK | 83.4 | 62952 / 12094 / 11240 / 155931 | 0.3475 / 0.0993 |
| flash | q04/1 | OK | 102.2 | 95931 / 8179 / 7710 / 406716 | 0.4437 / 0.1268 |
| flash | q04/2 | OK | 85.9 | 92970 / 8217 / 7546 / 335418 | 0.4189 / 0.1197 |
| flash | q08/1 | OK | 80.6 | 69927 / 6800 / 6021 / 292400 | 0.3329 / 0.0951 |
| flash | q08/2 | OK | 59.7 | 78899 / 5256 / 4455 / 227604 | 0.3198 / 0.0914 |
| flash | q09/1 | OK | 70.8 | 52350 / 8736 / 8573 / 97659 | 0.2645 / 0.0756 |
| flash | q09/2 | OK | 44.0 | 68435 / 4706 / 4543 / 81268 | 0.2502 / 0.0715 |
| argon | q01/1 | OK | 245.2 | 244484 / 19690 / 16801 / 1787576 | 0.0000 / 0.0000 (WTU 5.7641) |
| argon | q01/2 | OK | 316.8 | 299940 / 10301 / 6894 / 1464530 | 0.0000 / 0.0000 (WTU 6.8741) |
| argon | q02/1 | OK | 348.9 | 374951 / 18731 / 15401 / 1709629 | 0.0000 / 0.0000 (WTU 8.3494) |
| argon | q02/2 | OK | 175.2 | 305980 / 14768 / 12683 / 527019 | 0.0000 / 0.0000 (WTU 5.4156) |
| argon | q03/1 | OK | 292.0 | 78138 / 24728 / 22645 / 232830 | 0.0000 / 0.0000 (WTU 2.8456) |
| argon | q03/2 | OK | 267.2 | 49692 / 23319 / 21725 / 125770 | 0.0000 / 0.0000 (WTU 2.3010) |
| argon | q04/1 | OK | 174.6 | 64095 / 13884 / 13006 / 266835 | 0.0000 / 0.0000 (WTU 1.9580) |
| argon | q04/2 | OK | 184.1 | 63992 / 14618 / 13718 / 269882 | 0.0000 / 0.0000 (WTU 2.0077) |
| argon | q08/1 | OK | 167.2 | 77653 / 13209 / 12112 / 268356 | 0.0000 / 0.0000 (WTU 2.0948) |
| argon | q08/2 | OK | 159.4 | 73546 / 13244 / 12266 / 313110 | 0.0000 / 0.0000 (WTU 2.0722) |
| argon | q09/1 | OK | 129.8 | 46920 / 11448 / 10854 / 120395 | 0.0000 / 0.0000 (WTU 1.4690) |
| argon | q09/2 | OK | 103.0 | 43262 / 8778 / 8233 / 75873 | 0.0000 / 0.0000 (WTU 1.2126) |
| deepseek | q01/1 | OK | 82.2 | 85642 / 2230 / 14142 / 768000 | 0.024974 |
| deepseek | q01/2 | OK | 47.4 | 47893 / 691 / 5772 / 233216 | 0.011761 |
| deepseek | q02/1 | OK | 68.8 | 58092 / 1432 / 4111 / 210176 | 0.012670 |
| deepseek | q02/2 | OK | 45.7 | 71881 / 1523 / 7612 / 346112 | 0.017301 |
| deepseek | q03/1 | E | 7.0 | 9882 / 28 / 370 / 0 | 0.001721 |
| deepseek | q03/2 | OK | 166.0 | 105855 / 1463 / 14936 / 294592 | 0.026601 |
| deepseek | q04/1 | OK | 20.5 | 20762 / 227 / 1470 / 25600 | 0.004209 |
| deepseek | q04/2 | OK | 22.9 | 14356 / 555 / 2136 / 60672 | 0.003950 |
| deepseek | q08/1 | E | 6.5 | 10187 / 1 / 30 / 0 | 0.001547 |
| deepseek | q08/2 | E | 7.8 | 10187 / 22 / 477 / 0 | 0.001827 |
| deepseek | q09/1 | E | 290.9 | 31048 / 251 / 5265 / 27131 | 0.008048 |
| deepseek | q09/2 | E | 118.8 | 45667 / 277 / 11082 / 52728 | 0.013824 |
| codex | q01/1 | OK | 41.9 | 390415 / 1116 / 194 / 317696 | 4.0000 / 1.0000 |
| codex | q01/2 | OK | 62.8 | 639579 / 1197 / 165 / 546432 | 5.0000 / 1.0000 |
| codex | q02/1 | OK | 45.3 | 327839 / 1207 / 391 / 265344 | 3.0000 / 1.0000 |
| codex | q02/2 | OK | 47.5 | 463415 / 982 / 153 / 380928 | 3.0000 / 1.0000 |
| codex | q03/1 | OK | 32.6 | 151880 / 766 / 258 / 110336 | N/D / 1.0000 |
| codex | q03/2 | OK | 33.1 | 150673 / 692 / 172 / 108672 | N/D / 0.0000 |
| codex | q04/1 | OK | 15.3 | 125490 / 346 / 15 / 100608 | 1.0000 / 0.0000 |
| codex | q04/2 | OK | 18.6 | 126060 / 303 / 17 / 102016 | N/D / 0.0000 |
| codex | q08/1 | OK | 17.1 | 138291 / 342 / 0 / 81280 | 2.0000 / 0.0000 |
| codex | q08/2 | OK | 16.0 | 130209 / 389 / 0 / 93312 | N/D / 0.0000 |
| codex | q09/1 | OK | 22.8 | 184726 / 380 / 30 / 139648 | 2.0000 / 0.0000 |
| codex | q09/2 | OK | 19.3 | 141416 / 367 / 39 / 114432 | 2.0000 / 1.0000 |

## Fałszywe alarmy na czystych kontrolach

| Recenzent | Ważne recenzje kontroli / 6 | FP / ważne recenzje | Blokujące FP |
| --- | --- | --- | --- |
| flash | 6/6 | 0/6 | 0 |
| argon | 6/6 | 0/6 | 0 |
| deepseek | 2/6 | 1/2 | 0 |
| codex | 6/6 | 0/6 | 0 |

## Koszt poza rankingiem

| Grupa | Wywołania | Suma s | USD DeepSeek | Flash Δ 5h / 7d [pp] | Argon Δ WTU weekly [pp] | Codex Δ 5h / 7d [pp] |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Błędny brief q03 v1 | 8 | 863.1 | 0.020012 | 0.7407 / 0.2116 | 7.4376 | 2.0000 / 1.0000 |
| Limit Codexa | 6 | 16.9 | 0.000000 | N/D / N/D | N/D | 0.0000 / 0.0000 |
| Odmowa Flash q06 | 1 | 145.8 | 0.000000 | 0.5877 / 0.1679 | N/D | N/D / N/D |
| Audyt q05/q06 | 16 | 3066.6 | 0.093865 | 5.4863 / 1.5675 | 30.2311 | 10.0000 / 0.0000 |
| Eksploracyjne q07 (tylko DeepSeek) | 2 | 230.5 | 0.031374 | N/D / N/D | N/D | N/D / N/D |

Suma raportowanego kosztu DeepSeeka przy budowie prywatnych mutacji, prób akceptacyjnych i adaptera odczytu (poza review i poza trzema wykonaniami): **0.616010 USD**. Zawiera niedokończone pierwsze generowanie adaptera (limit długości), poprawkę oraz korektę testu porównującego zapis godziny. Smoke transportu i odczyty quota są diagnostyką, nie pozycjami rankingu. Powyższe delty abonamentów mają te same ograniczenia i niepełne pokrycie co seria główna; N/D nie jest zerowym kosztem.

## Ocena jakości i wybór

Codex dwa razy pominął T3 (zapis przy odczycie); w pierwszej nowej recenzji q03 pominął P3 (istniejący rodzic bez `api_server`), w drugiej go znalazł. DeepSeek po prawidłowym zakończeniu q03/R2 pominął P5 (`RegexOptions` zamiast offsetu). Brak review q03/R1 nie jest dowodem, że model przeczytał i przeoczył sześć błędów — jest brakiem dostarczenia kontroli. Flash i Argon należy oceniać po pełnej tabeli, wraz z dodatkowymi fałszywymi alarmami, nie po samej liczbie uwag.

Fałszywy alarm DeepSeeka na q04/R1 to P3 do niezmienionego komentarza „scripts and tests read it as such”, bez wykazanego defektu. Dla nieukończonych q08/q09 nie wolno wpisywać „zero FP na czystym diffie”: nie ma ważnej recenzji. Niezasadna dodatkowa uwaga Argona o dopisywaniu `mcp_servers.desk-panel` pod istniejącą sekcją dotyczy zachowania niezmienionego w diffie i jawnie opisanego jako ręczna instrukcja (`docs/hermes.md:228–229`); to FP, a nie kolejny wykryty zasiany mechanizm. Pozostałe konkretne niezasadne uwagi, jeżeli wystąpiły, są wskazane przy końcowej tabeli. W kilku odpowiedziach Flash/Argon/DeepSeek oznaczały problemy jako P0 bez dowodu katastrofalnego skutku — severity wymaga oceny człowieka.

Rekomendacja:

- **Zwykłe zadania:** pozostawić Flash high jako obowiązujący reviewer. DeepSeek jest tani jako opcjonalny pierwszy przegląd, ale w tej konfiguracji nie dostarczył ważnej recenzji w części prób; sam exit 0 / `stop` nie wystarcza. Każda pusta odpowiedź, odmowa, timeout lub brak końcowego markera musi kończyć krok błędem albo uruchamiać niezależny review, nigdy przepuszczać kodu.
- **Wyścigi, migracje i bezpieczeństwo:** Flash high wraz z niezależnymi testami zachowania/red→green, w tym przeplotami i zgodnością zapisów. Jeśli potrzebny jest drugi model, Codex medium daje szybkie spojrzenie z innej rodziny, ale jego pominięcia T3/P3 wykluczają traktowanie go jako gwarancji kompletności. Argon 4 high nie uzasadnił w tym zestawie wyższego kosztu tygodniowego lepszym pokryciem niż Flash.
- **Tani pierwszy + drugi:** możliwy DeepSeek → Flash dla ryzykownej zmiany lub po awarii pierwszego etapu, z pełnym drugim review również po `approve` pierwszego. To rekomendacja procesu, nie przetestowana sekwencja poprawek. Ocenialiśmy niezależne przeglądy tego samego diffu; ich suma nie jest dowodem skuteczności pipeline po automatycznej poprawce. Wyniki nie uzasadniają dokładania dwóch recenzji do każdej prostej zmiany.

To mały zestaw regresji z istniejącymi testami i komentarzami, często ujawniającymi usunięte zabezpieczenie w samym diffie. Dwa powtórzenia nie są dwoma niezależnymi repozytoriami; wysoki recall nie dowodzi wykrywania nowych klas błędów. Czyste kontrole są prostsze od paczek błędów, a część kontroli wymieniono po audycie. DeepSeek jest również wykonawcą: to badanie nie mierzy korelacji błędów jego nowej implementacji i jej późniejszego self-review. Nie ma podstaw do ogólnego rankingu modeli ani do zmiany modelu produkcyjnego na podstawie samych cen/tokenów. W szczególności nie należy ukrywać problemów dostępności DeepSeeka za warunkowym recall.

## Artefakty i publikacja

Prywatny zestaw i surowe logi: `C:/t/rcal/`. `frozen-cases.json` i zachowana wersja v1 zawierają SHA-256 diffów/promptów i przypięte HEAD; `consent/`, `schedule/`, `powershell/` zawierają orakle oraz próby good/isolated/combined; `reviews/` i `attempts/` zachowują wszystkie sesje, także wyłączone/nieudane; `scores.json` zawiera ręczne mapowanie uwag na mechanizmy; `readonly-audit.json` i `cases/` zachowują kontrolę niezmienności i źródła diffów. Do Gita trafiają tylko raporty, link kontynuacji w poprzednim raporcie i wiersz mapy `AGENTS.md`. Worktree prób usunięto po zachowaniu artefaktów.

Oddzielny wynik wykonawcy: [ukryta akceptacja](executor-hidden-acceptance-2026-11-01.md) — zwykły `just check` 3/3, prywatne przypadki 14/19. Ten pomiar nie wdraża Cezara ani nie zmienia pamięci i instrukcji Wektora.
