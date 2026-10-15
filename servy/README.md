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
`just service STOP` zatrzymuje. Po zmianach kodu użyj `just check`, potem
`just service RESTART`. Instalator nie uruchamia dodatkowych serwerów Cezara ani
adaptera — panel toleruje ich późniejszy start.

Logi: `servy/logs/Desk-Panel/stdout.log` i `stderr.log` (ignorowane przez Git).
Do diagnostyki w terminalu: zatrzymaj usługę i użyj `just service RUN`.
Nie uruchamiaj dwóch serwerów jednocześnie na tym samym porcie.
