param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')),
    [int]$DelaySeconds = 2,
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'

# Ensure node/npm are on PATH
if (Test-Path 'C:\nvm4w\nodejs') {
    $env:PATH = "C:\nvm4w\nodejs;$env:PATH"
}

$logDir = Join-Path $PSScriptRoot 'logs'
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir 'detached-restart.log'

function Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "[$ts] $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}

Log "Start detached restart worker (PID $PID, Delay: $DelaySeconds s, NoBuild: $NoBuild)"

if ($DelaySeconds -gt 0) {
    Start-Sleep -Seconds $DelaySeconds
}

Set-Location $ProjectRoot

if (!$NoBuild) {
    Log "Building frontend (npm.cmd run build)..."
    & npm.cmd run build *>> $logFile
    $buildCode = $LASTEXITCODE
    if ($buildCode -ne 0) {
        Log "Build failed with exit code $buildCode. Aborting restart to prevent serving broken dist."
        exit $buildCode
    }
    Log "Build finished successfully."
}

Log "Restarting service Desk-Panel..."
& (Join-Path $PSScriptRoot 'Control-Service.ps1') -Manifest (Join-Path $PSScriptRoot 'services.json') -Id desk-panel -Action RESTART *>> $logFile
$restartCode = $LASTEXITCODE
Log "Service restart finished with exit code $restartCode."

$retries = 10
while ($retries -gt 0) {
    $svc = Get-Service -Name 'Desk-Panel' -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Log "Verified Desk-Panel is Running."
        break
    }
    Start-Sleep -Seconds 1
    $retries--
}
exit $restartCode
