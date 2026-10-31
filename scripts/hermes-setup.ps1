# One-time, repeatable setup of Hermes as the Desk Panel chat engine. Changes only files outside Git:
#   ~/.hermes/.env           API server on loopback with a key (API_SERVER_*), a new key only when there is none
#   ~/.desk-panel/panel.env  DESK_HERMES_URL and DESK_HERMES_KEY (the same key) for the panel service
#   ~/.desk-panel/mcp-token  token of the panel's MCP tools (the panel makes the same file on first start)
#   ~/.hermes/config.yaml    mcp_servers.desk-panel pointing at http://127.0.0.1:<DESK_PORT>/api/mcp, and (when absent, or
#                            inserted under an existing parent section) tool_output, platform_toolsets.api_server,
#                            skills.platform_disabled.api_server, agent, provider_routing; UTF-8 without a BOM
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
# config.yaml is read and written as UTF-8 without a BOM: Get-Content -Raw decodes it as ANSI under PowerShell 5.1, and
# Set-Content -Encoding ASCII rewrites non-ASCII values. The script itself stays ASCII.
function Read-ConfigText([string]$Path) { if (Test-Path -LiteralPath $Path) { [System.IO.File]::ReadAllText($Path) } else { '' } }
function Write-ConfigText([string]$Path,[string]$Value) { [System.IO.File]::WriteAllText($Path,$Value,(New-Object System.Text.UTF8Encoding $false)) }
function Get-Newline([string]$Text) { if ($Text.Contains("`r`n")) { "`r`n" } else { "`n" } }
function Add-Block([string]$Text,[string]$Block,[string]$Newline) {
    if (!$Text) { return $Block }
    if ($Text.EndsWith("`n")) { return $Text+$Newline+$Block }
    return $Text+$Newline+$Newline+$Block
}
# A top-level section: header up to the next line that starts with a non-space character (or the end of the file).
function Find-Section([string]$Text,[string]$Name) {
    [regex]::Match($Text,'(?ms)^'+[regex]::Escape($Name)+':[ \t]*(?:#[^\r\n]*)?\r?\n(.*?)(?=^\S|\z)')
}
function Add-AfterPattern([string]$Text,[string]$Pattern,[string]$Insert,[int]$Start=0) {
    $m=([regex]$Pattern).Match($Text,$Start)
    if (!$m.Success) { return $null }
    $Text.Insert($m.Index+$m.Length,$Insert)
}

$text=Read-ConfigText $config
$nl=Get-Newline $text
$block="  desk-panel:$nl    url: `"http://127.0.0.1:$PanelPort/api/mcp`"$nl    headers:$nl      Authorization: `"Bearer $token`"$nl    timeout: 60$nl"
if ($text -match '(?m)^\s+desk-panel:\s*$') {
    Write-Host 'config.yaml: mcp_servers.desk-panel already present (left as it is).'
} elseif ($text -notmatch '(?m)^mcp_servers:') {
    $text=Add-Block $text "mcp_servers:$nl$block" $nl
    Write-ConfigText $config $text
    Write-Host 'config.yaml: added mcp_servers.desk-panel.'
} else {
    Write-Warning "config.yaml already has mcp_servers: add 'desk-panel' under it by hand (url http://127.0.0.1:$PanelPort/api/mcp, header Authorization: Bearer <contents of $tokenFile>)."
}
# Shorter tool results: whatever a tool returns stays in the conversation and goes out again with every model call.
# Terminal output keeps its head and tail (a test runner's failures are at the end).
$text=Read-ConfigText $config
$nl=Get-Newline $text
if ($text -match '(?m)^tool_output:') {
    Write-Host 'config.yaml: tool_output already present (left as it is).'
} else {
    $text=Add-Block $text "tool_output:$nl  max_bytes: 16000$nl  max_lines: 400$nl  max_line_length: 600$nl" $nl
    Write-ConfigText $config $text
    Write-Host 'config.yaml: added tool_output limits.'
}
# Only what the panel's chat needs on the API-server surface: the panel's MCP tools, terminal, files (read/search, with
# write/patch in the same toolset), web search/extract, vision, browser, skills (Wektor reads skills such as hermes-agent
# with skill_view; without the toolset Hermes suppresses the whole catalogue), and memory and session_search (Wektor keeps
# the user's preferences). Not delegate_task, execute_code, native cron, TTS or image generation: unused in the measured
# turns and their schemas cost every model call. An explicit list is also an allowlist for MCP servers, so `desk-panel`
# has to be named (docs/hermes.md).
$apiToolsets=@('desk-panel','terminal','file','web','vision','browser','skills','memory','session_search')
$text=Read-ConfigText $config
$nl=Get-Newline $text
$section=Find-Section $text 'platform_toolsets'
if ($section.Success) {
    if ($section.Groups[1].Value -match '(?m)^[ \t]{2}api_server:') {
        Write-Host 'config.yaml: platform_toolsets.api_server already present (left as it is).'
    } else {
        $block="  api_server:$nl"+(($apiToolsets | ForEach-Object { "    - $_" }) -join $nl)+"$nl"
        $text=Add-AfterPattern $text '(?m)^platform_toolsets:[ \t]*(?:#[^\r\n]*)?\r?\n' $block
        Write-ConfigText $config $text
        Write-Host "config.yaml: platform_toolsets.api_server = $($apiToolsets -join ', ')."
    }
} else {
    $block="platform_toolsets:$nl  api_server:$nl"+(($apiToolsets | ForEach-Object { "    - $_" }) -join $nl)+"$nl"
    $text=Add-Block $text $block $nl
    Write-ConfigText $config $text
    Write-Host "config.yaml: platform_toolsets.api_server = $($apiToolsets -join ', ')."
}
# No skills written by Hermes itself: every 10 tool calls it would review the turn in the background (more model calls
# on the same quota) and save a skill that copies the panel's own instructions and goes stale when they change. The
# `skills` toolset stays on so Wektor can read skills (skill_view); skill_manage is part of that toolset, but the nudge is
# off so Hermes does not create or patch skills by itself. Skills the panel never uses are hidden for api_server so the
# catalogue stays small; `hermes-agent` is essential (Hermes never lets it be disabled).
$disabledSkills=@(
    'airtable','apple-notes','apple-reminders','architecture-diagram','arxiv','ascii-video','baoyu-infographic','box',
    'claude-code','claude-design','codex','computer-use','design-md','document-to-action-items','docx','dogfood',
    'email-inbox-triage','findmy','gif-search','google-workspace','hermes-agent-skill-authoring','himalaya','humanizer',
    'imessage','inspecting-hermes-desktop-dom','llm-wiki','manim-video','maps','meeting-action-items','notion','obsidian',
    'opencode','p5js','pdf','popular-web-designs','powerpoint','requesting-code-review','sdlc-review','simplify-code',
    'songsee','songwriting-and-ai-music','spike','teams-meeting-pipeline','weekly-review-planning','xlsx','xurl','youtube-content'
)
$text=Read-ConfigText $config
$nl=Get-Newline $text
$skills=Find-Section $text 'skills'
if ($skills.Success) {
    $skillsBody=$skills.Groups[1].Value
    if ($skillsBody -match '(?m)^[ \t]{2}platform_disabled:') {
        if ($skillsBody -match '(?m)^[ \t]{4}api_server:') {
            Write-Host 'config.yaml: skills.platform_disabled.api_server already present (left as it is).'
        } else {
            $block="    api_server:$nl"+(($disabledSkills | ForEach-Object { "      - $_" }) -join $nl)+"$nl"
            $text=Add-AfterPattern $text '(?m)^[ \t]{2}platform_disabled:[ \t]*(?:#[^\r\n]*)?\r?\n' $block $skills.Index
            Write-ConfigText $config $text
            Write-Host "config.yaml: skills.platform_disabled.api_server hides $($disabledSkills.Count) unused skills."
        }
    } else {
        $block="  platform_disabled:$nl    api_server:$nl"+(($disabledSkills | ForEach-Object { "      - $_" }) -join $nl)+"$nl"
        $text=Add-AfterPattern $text '(?m)^skills:[ \t]*(?:#[^\r\n]*)?\r?\n' $block $skills.Index
        Write-ConfigText $config $text
        Write-Host "config.yaml: skills.platform_disabled.api_server hides $($disabledSkills.Count) unused skills."
    }
} else {
    $block="skills:$nl  creation_nudge_interval: 0$nl  platform_disabled:$nl    api_server:$nl"+(($disabledSkills | ForEach-Object { "      - $_" }) -join $nl)+"$nl"
    $text=Add-Block $text $block $nl
    Write-ConfigText $config $text
    Write-Host "config.yaml: turned off background skill creation; skills.platform_disabled.api_server hides $($disabledSkills.Count) unused skills."
}
# A turn ends after 40 model calls (Hermes then asks once more for a summary, without tools): a dispatcher that kept
# searching made 87 tool calls in nine minutes. At half of it a tool result carries a checkpoint notice, which the
# "Zaimplementuj zadanie" skill answers by sending its recon.
$text=Read-ConfigText $config
$nl=Get-Newline $text
if ($text -match '(?m)^agent:') {
    Write-Host 'config.yaml: agent already present (left as it is; the panel expects max_turns: 40, budget_warning_ratio: 0.5).'
} else {
    $text=Add-Block $text "agent:$nl  max_turns: 40$nl  budget_warning_ratio: 0.5$nl" $nl
    Write-ConfigText $config $text
    Write-Host 'config.yaml: agent.max_turns 40, budget_warning_ratio 0.5.'
}
# The agent reads the user's mail, calendar and bank summaries: through OpenRouter only to hosts that do not train on them.
# The API server applies provider_routing only per model (provider_routing.models.<id>), so the current model gets its entry.
$text=Read-ConfigText $config
$nl=Get-Newline $text
$model=if ($text -match '(?m)^  default:\s*(\S+)') { $Matches[1] } else { $null }
if ($text -match '(?m)^provider_routing:') {
    Write-Host "config.yaml: provider_routing already present (left as it is; the panel expects data_collection: deny under models.$model)."
} elseif ($model) {
    $text=Add-Block $text "provider_routing:$nl  data_collection: deny$nl  models:$nl    ${model}:$nl      data_collection: deny$nl" $nl
    Write-ConfigText $config $text
    Write-Host "config.yaml: provider_routing data_collection deny for $model."
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
