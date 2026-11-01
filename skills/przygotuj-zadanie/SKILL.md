---
name: przygotuj-zadanie
description: Przygotowanie specyfikacji zadania w procesie „słoń i złota rybka”: zebranie decyzji użytkownika, napisanie dziewięciu sekcji, przegląd rybki i zapis gotowej specyfikacji do zadania. To przygotowanie, nie wykonanie — skill nie realizuje zadania, nie dispatchuje Cezara i nie zmienia API/UI.
---

# Przygotowanie zadania („słoń i złota rybka”)

Ten skill służy do **przygotowania zadania**, nie do jego wykonania. Słoń (przygotowujący agent) zbiera decyzje, pisze
specyfikację i doprowadza ją do gotowości; złota rybka (świeży recenzent) czyta sam tekst specyfikacji i wskazuje
niejasności. Skill nie realizuje przygotowanego zadania, nie dispatchuje Cezara i nie zmienia API/UI.

Pełny szablon, znaczenie dziewięciu sekcji, definicja gotowości, komenda i konfiguracja rybki, przykład fikcyjny oraz
instrukcja zapisu do zadania są w dokumencie:
[docs/agent-workflows/przygotuj-zadanie.md](../../docs/agent-workflows/przygotuj-zadanie.md). **Nie kopiuj szablonu**
tutaj; otwórz dokument i pracuj na jego treści.

## Kiedy używać

- Użytkownik chce przygotować zadanie do realizacji przez Cezara, lokalnie albo w rozmowie.
- Zadanie ma wiele decyzji, kilka repozytoriów albo wymaga sprawdzenia, czy specyfikacja jest jednoznaczna.
- Istniejące zadanie ma szkic specyfikacji i trzeba go uzupełnić, zachowując je w `przygotowanie`.

Nie używaj tego skilla do wykonywania zadania ani do dispatchu Cezara. Zapis specyfikacji do zadania jest częścią
przygotowania; realizacja i dispatch należą do innych kroków.

## Role

- **Słoń** — agent przygotowujący: zbiera decyzje od użytkownika, pisze specyfikację, uruchamia rybkę, pokazuje
  raport i poprawki użytkownikowi, rozstrzyga uwagi i zapisuje gotowy komplet.
- **Złota rybka** — świeży recenzent `opencode` z modelem `openrouter/deepseek/deepseek-v4.1-flash-1017`, nowa sesja,
  tylko odczyt repozytorium. Dostaje wyłącznie tekst specyfikacji i osobną instrukcję roli recenzenta. Wskazuje
  niejasność, niezapisane założenie, wpływ na wykonanie i pytanie. To nie jest wykonawca.

## Przebieg

1. Ustal, czy zadanie już istnieje. Szkic istniejącego zadania zostaw w `przygotowanie`; nowego nie oznaczaj jako
   `gotowe` przed spełnieniem definicji gotowości.
2. Zbierz od użytkownika decyzje potrzebne do dziewięciu sekcji. Nie dopowiadaj brakującej decyzji i nie pomijaj
   wymaganego zachowania zwrotem „jeśli dostępne”.
3. Napisz specyfikację według szablonu z dokumentu.
4. Uruchom rybkę komendą i konfiguracją z dokumentu: nowa sesja, tylko tekst specyfikacji plus osobna instrukcja roli,
   limit 10 minut. Błąd, timeout albo brak raportu nie jest skutecznym przeglądem.
5. Pokaż użytkownikowi raport rybki oraz swoje poprawki. Pytania o zakres lub oczekiwania wymagają odpowiedzi
   użytkownika; sugestie redakcyjne nie blokują gotowości.
6. Rozstrzygnij wszystkie uwagi wpływające na zakres, zachowanie lub odbiór. Istotna zmiana celu lub zakresu po
   raporcie wymaga nowej rybki; usunięcie wskazanego braku lub zmiana redakcyjna nie wymaga automatycznie kolejnego
   płatnego przebiegu.
7. Sprawdź definicję gotowości z dokumentu. Dopiero po jej spełnieniu zapisz specyfikację sekwencją z dokumentu i
   ustaw `setStatus gotowe`.
8. Dodaj końcowy komentarz o strukturze: konkretne braki ujawnione przez przygotowanie albo `brak`. Ten komentarz nie
   zmienia API/UI.

## Granice

- Przygotowanie, nie wykonanie: nie realizuj zadania, nie dispatchuj Cezara, nie otwieraj PR-a.
- Nie zmieniaj API/UI tylko dlatego, że przygotowanie ujawniło braki struktury; zapisz je w komentarzu.
- `gotowe` oznacza gotowość do realizacji, nie zakończenie zadania, nie zgodę na Cezara i nie wynik jego runu.
- Sekrety, poświadczenia i dane prywatne poza repozytorium nie są czytane przez rybkę.
