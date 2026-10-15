param(
    [Parameter(Mandatory=$true)][string]$Manifest,
    [Parameter(Mandatory=$true)][string]$Id,
    [ValidateSet('START','END','STOP','RESTART','STATUS','RUN')][string]$Action='STATUS'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Service.Common.ps1')
$context = Read-ServiceManifest $Manifest
$definitions = @($context.Data.services | Where-Object { $_.id -eq $Id })
if ($definitions.Count -ne 1) { throw "Unknown or duplicate service ID: $Id" }
$definition=$definitions[0]
if ($Action -eq 'RUN') {
    if ($context.Data.pathPrefix) {
        $prefix=@($context.Data.pathPrefix | ForEach-Object { Expand-ServicePath $_ $context }) -join ';'
        $env:PATH="$prefix;$env:PATH"
    }
    # Optional private settings outside Git (e.g. DESK_MAIL_ACCOUNTS); a missing file is skipped.
    $file=if ($definition.envFile) { Expand-ServicePath $definition.envFile $context }
    if ($file -and (Test-Path -LiteralPath $file)) {
        foreach ($line in Get-Content -LiteralPath $file) {
            $entry=$line.Trim()
            if ($entry -and !$entry.StartsWith('#') -and $entry.Contains('=')) {
                $parts=$entry -split '=',2
                [Environment]::SetEnvironmentVariable($parts[0].Trim(),$parts[1].Trim(),'Process')
            }
        }
    }
    if ($definition.environment) {
        foreach ($property in $definition.environment.PSObject.Properties) {
            [Environment]::SetEnvironmentVariable($property.Name,(Expand-ServicePath ([string]$property.Value) $context),'Process')
        }
    }
    if ($definition.environmentFrom) {
        foreach ($property in $definition.environmentFrom.PSObject.Properties) {
            $value=[Environment]::GetEnvironmentVariable([string]$property.Value,'Process')
            if (!$value) { throw "Missing environment variable: $($property.Value)" }
            [Environment]::SetEnvironmentVariable($property.Name,$value,'Process')
        }
    }
    Set-Location -LiteralPath (Expand-ServicePath $definition.workingDirectory $context)
    $executable=Expand-ServicePath $definition.executable $context
    $arguments=@($definition.arguments | ForEach-Object { Expand-ServicePath $_ $context })
    & $executable @arguments
    exit $LASTEXITCODE
}
if ($Action -eq 'STATUS') { Get-Service -Name $definition.name | Select-Object Name,Status,StartType; exit 0 }
if (!(Test-ServiceAdministrator)) {
    $powershell="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $argsLine='-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Manifest "'+$context.Path+'" -Id "'+$Id+'" -Action '+$Action
    $process=Start-Process $powershell -ArgumentList $argsLine -Verb RunAs -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Service operation failed (exit $($process.ExitCode))." }
} else {
    switch ($Action) {
        'START' { Start-Service -Name $definition.name }
        'END' { Stop-Service -Name $definition.name }
        'STOP' { Stop-Service -Name $definition.name }
        'RESTART' { Restart-Service -Name $definition.name }
    }
}
Get-Service -Name $definition.name | Select-Object Name,Status,StartType
