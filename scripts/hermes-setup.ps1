# One-time, repeatable setup of Hermes as the Desk Panel chat engine. Changes only files outside Git:
#   ~/.hermes/.env           API server on loopback with a key (API_SERVER_*), a new key only when there is none
#   ~/.desk-panel/panel.env  DESK_HERMES_URL and DESK_HERMES_KEY (the same key) for the panel service
#   ~/.desk-panel/mcp-token  token of the panel's MCP tools (the panel makes the same file on first start)
#   ~/.hermes/config.yaml    mcp_servers.desk-panel pointing at http://127.0.0.1:<DESK_PORT>/api/mcp
# It never prints a key or a token, starts nothing and registers nothing: see docs/hermes.md for the next steps.
# Windows PowerShell 5.1 reads this file as ANSI: keep it ASCII.
param([int]$PanelPort=5174,[int]$HermesPort=8642)
$ErrorActionPreference='Stop'

function New-Secret { $bytes=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); -join ($bytes | ForEach-Object { '{0:x2}' -f $_ }) }
function Read-EnvFile([string]$Path) {
    $values=[ordered]@{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in Get-Content -LiteralPath $Path) {
            $entry=$line.Trim()
            if ($entry -and !$entry.StartsWith('#') -and $entry.Contains('=')) { $parts=$entry -split '=',2; $values[$parts[0].Trim()]=$parts[1].Trim() }
        }
    }
    $values
}
# Sets keys in a KEY=value file, keeping every other line as it is.
function Set-EnvValues([string]$Path,[hashtable]$Values) {
    $lines=@(); if (Test-Path -LiteralPath $Path) { $lines=@(Get-Content -LiteralPath $Path) }
    foreach ($key in $Values.Keys) {
        $found=$false
        for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\s*$([regex]::Escape($key))\s*=") { $lines[$i]="$key=$($Values[$key])"; $found=$true } }
        if (!$found) { $lines+="$key=$($Values[$key])" }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    Set-Content -LiteralPath $Path -Value $lines -Encoding ASCII
}

# Fail before changing configuration if the pinned sources or patch do not match.
& (Join-Path $PSScriptRoot 'hermes-stream-patch.ps1') -Action APPLY
if ($LASTEXITCODE -ne 0) { throw 'Hermes streaming patch setup failed. See the warning above.' }

$hermesHome=Join-Path $env:USERPROFILE '.hermes'
$panelHome=Join-Path $env:USERPROFILE '.desk-panel'
New-Item -ItemType Directory -Force -Path $hermesHome,$panelHome,(Join-Path $panelHome 'agent') | Out-Null

# 1. Version pin.
& (Join-Path $PSScriptRoot '..\servy\hermes.ps1') -Action CHECK | Out-Null
$lock=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\servy\hermes.lock.json') -Raw | ConvertFrom-Json
$hermes=Get-Command hermes -ErrorAction SilentlyContinue
if ($hermes) {
    Write-Host "hermes: $($hermes.Source)"
    $manifestExe=(Join-Path $env:USERPROFILE '.local\bin\hermes.exe')
    if ($hermes.Source -ne $manifestExe) { Write-Warning "servy/hermes.json expects $manifestExe; change 'executable' there to $($hermes.Source) before registering the service." }
} else { Write-Warning "hermes is not on PATH. Install Hermes $($lock.hermes) first (docs/hermes.md)." }

# 2. API server on loopback, with a key.
$hermesEnvFile=Join-Path $hermesHome '.env'
$hermesEnv=Read-EnvFile $hermesEnvFile
$key=$hermesEnv['API_SERVER_KEY']
if (!$key) { $key=New-Secret; Write-Host 'API_SERVER_KEY: generated (not shown).' } else { Write-Host 'API_SERVER_KEY: kept (not shown).' }
Set-EnvValues $hermesEnvFile @{ API_SERVER_ENABLED='true'; API_SERVER_HOST='127.0.0.1'; API_SERVER_PORT="$HermesPort"; API_SERVER_KEY=$key }

# 3. The panel service gets the same key; the browser never does.
Set-EnvValues (Join-Path $panelHome 'panel.env') @{ DESK_HERMES_URL="http://127.0.0.1:$HermesPort"; DESK_HERMES_KEY=$key }
Write-Host 'panel.env: DESK_HERMES_URL and DESK_HERMES_KEY set.'

# 4. The panel's MCP tools for Hermes.
$tokenFile=Join-Path $panelHome 'mcp-token'
if (!(Test-Path -LiteralPath $tokenFile) -or (Get-Content -LiteralPath $tokenFile -Raw).Trim().Length -lt 32) {
    Set-Content -LiteralPath $tokenFile -Value (New-Secret) -Encoding ASCII -NoNewline
}
$token=(Get-Content -LiteralPath $tokenFile -Raw).Trim()
$config=Join-Path $hermesHome 'config.yaml'
$text=if (Test-Path -LiteralPath $config) { Get-Content -LiteralPath $config -Raw } else { '' }
$block="  desk-panel:`n    url: `"http://127.0.0.1:$PanelPort/api/mcp`"`n    headers:`n      Authorization: `"Bearer $token`"`n    timeout: 60`n"
if ($text -match '(?m)^\s+desk-panel:\s*$') {
    Write-Host 'config.yaml: mcp_servers.desk-panel already present (left as it is).'
} elseif ($text -notmatch '(?m)^mcp_servers:') {
    Add-Content -LiteralPath $config -Value "`nmcp_servers:`n$block" -Encoding ASCII
    Write-Host 'config.yaml: added mcp_servers.desk-panel.'
} else {
    Write-Warning "config.yaml already has mcp_servers: add 'desk-panel' under it by hand (url http://127.0.0.1:$PanelPort/api/mcp, header Authorization: Bearer <contents of $tokenFile>)."
}
# Shorter tool results: whatever a tool returns stays in the conversation and goes out again with every model call.
# Terminal output keeps its head and tail (a test runner's failures are at the end).
$text=if (Test-Path -LiteralPath $config) { Get-Content -LiteralPath $config -Raw } else { '' }
if ($text -match '(?m)^tool_output:') {
    Write-Host 'config.yaml: tool_output already present (left as it is).'
} else {
    Add-Content -LiteralPath $config -Value "`ntool_output:`n  max_bytes: 16000`n  max_lines: 400`n  max_line_length: 600`n" -Encoding ASCII
    Write-Host 'config.yaml: added tool_output limits.'
}
# No skills written by Hermes itself: every 10 tool calls it would review the turn in the background (more model calls
# on the same quota) and save a skill that copies the panel's own instructions and goes stale when they change.
$text=Get-Content -LiteralPath $config -Raw
if ($text -match '(?m)^skills:') {
    Write-Host 'config.yaml: skills already present (left as it is).'
} else {
    Add-Content -LiteralPath $config -Value "`nskills:`n  creation_nudge_interval: 0`n" -Encoding ASCII
    Write-Host 'config.yaml: turned off background skill creation.'
}
# A turn ends after 30 model calls (Hermes then asks once more for a summary, without tools): a dispatcher that kept
# searching made 87 tool calls in nine minutes. The panel's skills fit in about 20.
$text=Get-Content -LiteralPath $config -Raw
if ($text -match '(?m)^agent:') {
    Write-Host 'config.yaml: agent already present (left as it is; the panel expects max_turns: 30).'
} else {
    Add-Content -LiteralPath $config -Value "`nagent:`n  max_turns: 30`n" -Encoding ASCII
    Write-Host 'config.yaml: agent.max_turns set to 30.'
}

# 5. Lock directory and hermes.env for Servy / Windows
$lockDir=if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'hermes\locks' } else { Join-Path $hermesHome 'locks' }
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
Set-EnvValues $hermesEnvFile @{ HERMES_GATEWAY_LOCK_DIR=$lockDir }
Set-EnvValues (Join-Path $panelHome 'hermes.env') @{
    HERMES_GATEWAY_LOCK_DIR=$lockDir
    API_SERVER_ENABLED='true'
    API_SERVER_HOST='127.0.0.1'
    API_SERVER_PORT="$HermesPort"
    # Outside the repositories: Hermes appends a directory's AGENTS.md to a tool result only inside its working directory.
    TERMINAL_CWD=(Join-Path $panelHome 'agent')
}
if ($env:LOCALAPPDATA) {
    $localHermes=Join-Path $env:LOCALAPPDATA 'hermes'
    New-Item -ItemType Directory -Force -Path $localHermes | Out-Null
    Copy-Item $hermesEnvFile (Join-Path $localHermes '.env') -Force
    if (Test-Path -LiteralPath $config) { Copy-Item $config (Join-Path $localHermes 'config.yaml') -Force }
}

Write-Host ''
Write-Host 'Next (docs/hermes.md): just hermes RUN (foreground try), then just hermes-install (service), just hermes CHECK, and just service RESTART for the panel.'
