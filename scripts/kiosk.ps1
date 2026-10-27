# Opens the dashboard as a bare full-screen Chrome window (kiosk) on one monitor: no tabs, no address bar and none of
# Chrome's "exit full screen" button. Alt+F4 closes it. Waits for the service first, so it can run at sign-in.
# Usage: scripts/kiosk.ps1 [-Display 1] [-Url http://127.0.0.1:5174/]
# -Display is the number of the monitor (\\.\DISPLAYn, see `just monitor`). The window has a Chrome profile of its own: a
# Chrome that is already running takes over a launch and ignores the kiosk flags and the monitor. The dashboard's browser
# settings (layout, sizes) are kept in that profile, so they are set once in the kiosk window.
# -Setup opens that profile as an ordinary window (after closing the kiosk) to sign in to Google once and to set the
# dashboard's layout; the kiosk then has the same accounts, e.g. Gmail and the Google Calendar behind the dashboard's links.
param([int]$Display = 1, [string]$Url = 'http://127.0.0.1:5174/', [int]$WaitSeconds = 300, [switch]$Setup)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$logDir = Join-Path $env:USERPROFILE '.desk-panel'
$logFile = Join-Path $logDir 'kiosk.log'
function Write-KioskLog([string]$Message) {
  try {
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logFile -Value $line -ErrorAction SilentlyContinue
  } catch {}
}

function Get-TargetScreen([int]$DisplayId) {
  [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.DeviceName -match "DISPLAY$DisplayId$" } | Select-Object -First 1
}

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  $msg = 'Nie znaleziono Chrome.'
  Write-KioskLog $msg
  throw $msg
}
$profileDir = Join-Path $env:LOCALAPPDATA 'desk-panel\kiosk-chrome'

if ($Setup) {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'kiosk-chrome' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  Write-KioskLog 'Uruchamianie profilu w trybie konfiguracji (-Setup).'
  Start-Process $chrome -ArgumentList @("--user-data-dir=$profileDir", '--no-first-run', '--no-default-browser-check', 'https://accounts.google.com/', $Url)
  return
}

# The service starts with the system and may not be up yet when this runs at sign-in.
Write-KioskLog "Oczekiwanie na usluge pod $Url (limit $WaitSeconds s)..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ($true) {
  try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3 | Out-Null; break }
  catch {
    if ((Get-Date) -gt $deadline) {
      $msg = "Panel nie odpowiada pod $Url po $WaitSeconds s."
      Write-KioskLog $msg
      throw $msg
    }
    Start-Sleep -Seconds 2
  }
}
Write-KioskLog "Panel odpowiada pod $Url."

# Monitor detection with retry (displays may wake up slightly later during sign-in).
$screenDeadline = (Get-Date).AddSeconds(30)
$screen = Get-TargetScreen $Display
while (-not $screen -and (Get-Date) -le $screenDeadline) {
  Start-Sleep -Seconds 1
  $screen = Get-TargetScreen $Display
}
if (-not $screen) {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $avail = ($screens | ForEach-Object { "$($_.DeviceName) $($_.Bounds.Width)x$($_.Bounds.Height)" }) -join '; '
  $msg = "Brak monitora $Display po 30 s oczekiwania. Dostepne: $avail"
  Write-KioskLog $msg
  throw $msg
}

$b = $screen.Bounds

# Hide the Windows taskbar on this monitor
try {
  & (Join-Path $PSScriptRoot 'kiosk-taskbar.ps1') -Action HIDE -Display $Display | Out-Null
  Write-KioskLog "Zadanie ukrycia paska zadan na monitorze $Display wykonane."
} catch {
  Write-KioskLog "Ostrzezenie: nie udalo sie ukryc paska zadan: $($_.Exception.Message)"
}

Write-KioskLog "Start Chrome w trybie kiosk na monitorze $Display ($($b.Width)x$($b.Height) w X=$($b.X), Y=$($b.Y))."
Start-Process $chrome -ArgumentList @(
  "--user-data-dir=$profileDir", '--kiosk', "--app=$Url",
  "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",
  '--noerrdialogs', '--disable-session-crashed-bubble', '--disable-infobars', '--no-first-run', '--no-default-browser-check'
)
Write-KioskLog 'Kiosk uruchomiony pomyslnie.'
