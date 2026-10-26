param(
    [ValidateSet('START','END','STOP','RESTART','STATUS','RUN')][string]$Action='STATUS',
    [int]$DelaySeconds=2,
    [switch]$NoBuild
)

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

if ($Action -eq 'RESTART') {
    $workerScript = Join-Path $PSScriptRoot 'restart-detached.ps1'
    $buildArg = if ($NoBuild) { '-NoBuild' } else { '' }
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$workerScript`" -ProjectRoot `"$projectRoot`" -DelaySeconds $DelaySeconds $buildArg"
    
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
    if ($res.ReturnValue -eq 0) {
        Write-Host "Zaplanowano bezpieczny restart w tle (odpiety PID $($res.ProcessId))."
        Write-Host "Frontend zostanie skompilowany i usluga Desk-Panel zrestartowana."
        exit 0
    } else {
        Write-Warning "Nie udalo sie utworzyc procesu odpietego (kod $($res.ReturnValue)). Wykonuje restart standardowy..."
    }
}

& (Join-Path $PSScriptRoot 'Control-Service.ps1') -Manifest (Join-Path $PSScriptRoot 'services.json') -Id desk-panel -Action $Action
exit $LASTEXITCODE
