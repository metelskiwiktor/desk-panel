# Opens the dashboard as a bare full-screen Chrome window (kiosk) on one monitor: no tabs, no address bar and none of
# Chrome's "exit full screen" button. Alt+F4 closes it. Waits for the service first, so it can run at sign-in.
# Usage: scripts/kiosk.ps1 [-Display 1] [-Url http://127.0.0.1:5174/]
# -Display is the number of the monitor (\\.\DISPLAYn, see `just monitor`). The window has a Chrome profile of its own: a
# Chrome that is already running takes over a launch and ignores the kiosk flags and the monitor. The dashboard's browser
# settings (layout, sizes) are kept in that profile, so they are set once in the kiosk window.
# -Setup opens that profile as an ordinary window (after closing the kiosk) to sign in to Google once and to set the
# dashboard's layout; the kiosk then has the same accounts, e.g. Gmail and the Google Calendar behind the dashboard's links.
param([int]$Display = 1, [string]$Url = 'http://127.0.0.1:5174/', [int]$WaitSeconds = 180, [switch]$Setup)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$screens = [System.Windows.Forms.Screen]::AllScreens
$screen = $screens | Where-Object { $_.DeviceName -match "DISPLAY$Display$" } | Select-Object -First 1
if (-not $screen) {
  throw ("Brak monitora $Display. Dostepne: " + (($screens | ForEach-Object { "$($_.DeviceName) $($_.Bounds.Width)x$($_.Bounds.Height)" }) -join '; '))
}

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Nie znaleziono Chrome.' }
$profileDir = Join-Path $env:LOCALAPPDATA 'desk-panel\kiosk-chrome'

if ($Setup) {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'kiosk-chrome' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  Start-Process $chrome -ArgumentList @("--user-data-dir=$profileDir", '--no-first-run', '--no-default-browser-check', 'https://accounts.google.com/', $Url)
  return
}

# The service starts with the system and may not be up yet when this runs at sign-in.
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ($true) {
  try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3 | Out-Null; break }
  catch { if ((Get-Date) -gt $deadline) { throw "Panel nie odpowiada pod $Url." }; Start-Sleep -Seconds 2 }
}

$b = $screen.Bounds
Start-Process $chrome -ArgumentList @(
  "--user-data-dir=$profileDir", '--kiosk', "--app=$Url",
  "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",
  '--noerrdialogs', '--disable-session-crashed-bubble', '--disable-infobars', '--no-first-run', '--no-default-browser-check'
)
