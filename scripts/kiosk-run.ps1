# What the sign-in task runs: kiosk.ps1 in a child process, so its exit code reaches kiosk.log even when it dies
# without a word (a native crash is 0xC0000005 = -1073741819), and a failed start is repeated.
# Usage: scripts/kiosk-run.ps1 [-Display P16] [-Attempts 3] [-RetryDelaySeconds 20]
param([string]$Display = 'P16', [int]$Attempts = 3, [int]$RetryDelaySeconds = 20)
. (Join-Path $PSScriptRoot 'kiosk-log.ps1')
$script = Join-Path $PSScriptRoot 'kiosk.ps1'

for ($try = 1; $try -le $Attempts; $try++) {
  Write-KioskLog "kiosk-run: proba $try/$Attempts."
  try {
    # Not Start-Process -Wait: that also waits for the Chrome the child starts, i.e. until the kiosk is closed.
    $p = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"", '-Display', $Display)
    $p.WaitForExit()
    $code = $p.ExitCode
  } catch {
    $code = -1
    Write-KioskLog "kiosk-run: nie udalo sie uruchomic kiosk.ps1: $($_.Exception.Message)"
  }
  Write-KioskLog "kiosk-run: kiosk.ps1 zakonczony kodem $code."
  if ($code -eq 0) { return }
  if ($try -lt $Attempts) { Start-Sleep -Seconds $RetryDelaySeconds }
}
Write-KioskLog "kiosk-run: kiosk nie wystartowal po $Attempts probach."
exit 1
