---
name: przygotuj-zadanie
description: >-
  Przygotuj lub dopracuj specyfikację zadania z listy w procesie „słoń i złota rybka”,
  sprawdź jej gotowość i zapisz ustalenia. Przygotowanie, nie wykonanie ani dispatch Cezara.
---

# Przygotuj zadanie

Skill dla lokalnych agentów w repo. **Słoń** zbiera z użytkownikiem decyzje i pisze specyfikację;
**złota rybka** sprawdza jej jednoznaczność w świeżej sesji opencode, bez historii rozmowy.

Otwórz [dokument procesu](../../docs/agent-workflows/przygotuj-zadanie.md): zawiera jedyny szablon, znaczenie pól,
definicję gotowości, konfigurację rybki, przykład i sekwencję zapisu. Nie kopiuj szablonu do skilla.

1. Przeczytaj pełną treść istniejącego zadania, ustal cel, granice i decyzje użytkownika, potem pokaż specyfikację.
2. Przeprowadź przegląd rybki według dokumentu; pokaż raport i poprawki użytkownikowi, rozstrzygnij uwagi.
3. Sprawdź definicję gotowości i zapisz kompletną specyfikację na wskazanej liście; zakończ komentarzem o brakach
   struktury zadania albo ich braku.

Nie implementuj przygotowywanego zadania, nie dispatchuj Cezara i nie otwieraj PR-a. Braki struktury zapisuj,
ale nie zmieniaj z ich powodu API/UI. WYKONAWCA wskazuje przyszłego wykonawcę, a `gotowe` gotowość do realizacji;
żadne z nich nie oznacza zgody na uruchomienie ani zakończenia zadania.
