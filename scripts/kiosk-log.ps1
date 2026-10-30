# Log of the kiosk start-up, shared by kiosk.ps1 and kiosk-run.ps1 (dot-sourced; ASCII only for PS 5.1).
# %USERPROFILE%\.desk-panel\kiosk.log, rotated to kiosk.log.1 above 256 KB.
$script:KioskLogDir = Join-Path $env:USERPROFILE '.desk-panel'
$script:KioskLogFile = Join-Path $script:KioskLogDir 'kiosk.log'
function Write-KioskLog([string]$Message) {
  try {
    if (-not (Test-Path -LiteralPath $script:KioskLogDir)) { New-Item -ItemType Directory -Path $script:KioskLogDir -Force | Out-Null }
    $file = Get-Item -LiteralPath $script:KioskLogFile -ErrorAction SilentlyContinue
    if ($file -and $file.Length -gt 262144) { Move-Item -LiteralPath $script:KioskLogFile -Destination "$($script:KioskLogFile).1" -Force -ErrorAction SilentlyContinue }
    $line = "[{0}] [pid {1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $PID, $Message
    Add-Content -LiteralPath $script:KioskLogFile -Value $line -ErrorAction SilentlyContinue
  } catch {}
}
