# Servy / Desk Panel

Samodzielna integracja z zainstalowanym Servy (`C:\Program Files\Servy`), bez
zależności od skryptów w sąsiednich projektach. Manifest `services.json` określa
Node.js, port i katalog aplikacji; ścieżki projektu są rozwiązywane względem niego.
Na innym komputerze dostosuj ścieżkę Node.js, jeśli nie używasz nvm4w.

Z katalogu projektu: `just install` (lub po buildzie `./servy/register.ps1 -Start`).
Skrypt poprosi o podniesienie uprawnień Windows. Nowa usługa wymaga hasła konta
Windows, nie PIN-u: wpisz je wyłącznie w systemowym oknie poświadczeń.
Wybierz to samo konto, na którym połączono Google Calendar — DPAPI wiąże token
z kontem. Hasło trafia bezpośrednio do Servy, nie do plików projektu ani logów.
Ponowna rejestracja zachowuje istniejące konto usługi.

Usługa `Desk-Panel` ma automatyczny opóźniony start, odzyskiwanie po awarii
i rotację logów (10 MB, do 5 plików). Serwuje zbudowany `dist` na
http://127.0.0.1:5174, także bez otwartej sesji terminala.

`just service` pokazuje stan, `just service RESTART` restartuje, a
`just service STOP` zatrzymuje. Zmiany wdrażasz przez `just update`:

1. Pobiera `origin/main`. Jeśli zdalne zmiany dotykają plików zmienionych lokalnie
   albo lokalne commity konfliktują ze zdalnymi, nic nie zaciąga — wypisuje pliki.
   W przeciwnym razie scala (lokalne niezacommitowane zmiany zostają na miejscu).
2. Gdy nic się nie zmieniło od ostatniego wdrożenia (commit + lokalne zmiany),
   kończy bez restartu. `just update --force` wdraża mimo to.
3. Przy zmianie `package-lock.json` zatrzymuje usługę i robi `npm ci`.
4. Testy, typecheck i build do `dist.next`; dopiero po sukcesie podmienia `dist`.
   Przy błędzie usługa dalej serwuje poprzedni frontend.
5. Restartuje usługę (okno UAC) i sprawdza, czy API odpowiada.

Wdrażane jest to, co jest w katalogu — razem z niezacommitowanymi zmianami.
Usługa uruchamia serwer z plików źródłowych, więc jej restart z innego powodu
(awaria, reboot) też użyje bieżącego kodu serwera. Instalator nie uruchamia dodatkowych serwerów Cezara ani
adaptera — panel toleruje ich późniejszy start.

Logi: `servy/logs/Desk-Panel/stdout.log` i `stderr.log` (ignorowane przez Git).
Do diagnostyki w terminalu: zatrzymaj usługę i użyj `just service RUN`.
Nie uruchamiaj dwóch serwerów jednocześnie na tym samym porcie.
