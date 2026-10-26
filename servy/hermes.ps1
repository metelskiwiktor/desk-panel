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
    if (!$lock.provider.ref) { Write-Warning "Provider $($lock.provider.name) is not pinned yet (provider.ref in servy/hermes.lock.json)." }
    if ($lock.streamingPatch.required) {
        if (!$lock.streamingPatch.file -or !$lock.streamingPatch.sha256) {
            Write-Warning 'Streaming patch is not recorded (streamingPatch in servy/hermes.lock.json): answers may arrive without live text.'
        } else {
            $patched=Join-Path (Join-Path $env:USERPROFILE '.hermes') $lock.streamingPatch.file
            if (!(Test-Path -LiteralPath $patched)) { Write-Warning "Patched provider file missing: $patched"; $problems++ }
            elseif ((Get-FileHash -LiteralPath $patched -Algorithm SHA256).Hash -ne $lock.streamingPatch.sha256.ToUpper()) { Write-Warning "Provider file differs from the pinned patch: $patched"; $problems++ }
            else { Write-Host 'Streaming patch: present and matches the pin.' }
        }
    }
    try {
        $health=Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        Write-Host "API server: http://127.0.0.1:$port answers ($($health | ConvertTo-Json -Compress))"
    } catch { Write-Warning "API server on 127.0.0.1:$port does not answer: $($_.Exception.Message)"; $problems++ }
    Get-Service -Name $definition.name -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType
    exit $problems
}

& (Join-Path $PSScriptRoot 'Control-Service.ps1') -Manifest $manifest -Id hermes -Action $Action
exit $LASTEXITCODE
