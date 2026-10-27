# Starts the kiosk window (scripts/kiosk.ps1) when this Windows user signs in: a scheduled task of the user, no elevation.
# Usage: scripts/kiosk-autostart.ps1 [-Action ON|OFF|STATUS] [-Display 1]
param([ValidateSet('ON', 'OFF', 'STATUS')][string]$Action = 'STATUS', [int]$Display = 1)
$ErrorActionPreference = 'Stop'
$name = 'Desk Panel kiosk'
$script = Join-Path $PSScriptRoot 'kiosk.ps1'

switch ($Action) {
  'ON' {
    $run = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Display $Display"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $trigger.Delay = 'PT20S'
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $name -Action $run -Trigger $trigger -Settings $settings -Force | Out-Null
    "Wlaczono: kiosk startuje 20 s po zalogowaniu na monitorze $Display."
  }
  'OFF' {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; 'Wylaczono autostart kiosku.' } else { 'Autostart kiosku nie byl wlaczony.' }
  }
  'STATUS' {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) { "Wlaczony ($($task.State))." } else { 'Wylaczony.' }
  }
}
