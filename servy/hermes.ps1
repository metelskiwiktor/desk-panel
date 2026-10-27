param(
    [ValidateSet('START','STOP','RESTART','STATUS','RUN','CHECK')][string]$Action='STATUS'
)
# Hermes Agent API server as its own Windows service (Servy), beside Desk-Panel. The panel only talks to it over
# loopback HTTP; neither waits for the other at start, so they can start in any order after a reboot.
# Windows PowerShell 5.1 reads this file as ANSI: keep it ASCII.
$ErrorActionPreference='Stop'
$manifest=Join-Path $PSScriptRoot 'hermes.json'

if ($Action -eq 'CHECK') {
    $lock=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'hermes.lock.json') -Raw | ConvertFrom-Json
    $definition=(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).services[0]
    $port=$definition.environment.API_SERVER_PORT
    $problems=0
    $exe=$definition.executable.Replace('${UserProfile}',$env:USERPROFILE)
    if (Test-Path -LiteralPath $exe) {
        $version=(& $exe --version 2>&1 | Out-String).Trim()
        if ($version -match [regex]::Escape($lock.hermes)) { Write-Host "Hermes: $version (pinned $($lock.hermes))" }
        else { Write-Warning "Hermes version '$version' differs from the pinned $($lock.hermes) (servy/hermes.lock.json)."; $problems++ }
    } else { Write-Warning "Hermes not found at $exe. Install it or change 'executable' in servy/hermes.json."; $problems++ }
    & (Join-Path $PSScriptRoot '..\scripts\hermes-stream-patch.ps1') -Action CHECK
    if ($LASTEXITCODE -ne 0) { $problems++ }
    try {
        $health=Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        Write-Host "API server: http://127.0.0.1:$port answers ($($health | ConvertTo-Json -Compress))"
    } catch { Write-Warning "API server on 127.0.0.1:$port does not answer: $($_.Exception.Message)"; $problems++ }
    Get-Service -Name $definition.name -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType
    exit $problems
}

& (Join-Path $PSScriptRoot 'Control-Service.ps1') -Manifest $manifest -Id hermes -Action $Action
exit $LASTEXITCODE
