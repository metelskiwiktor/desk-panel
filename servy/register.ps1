param([string]$Manifest=(Join-Path $PSScriptRoot 'services.json'),[switch]$Start)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Service.Common.ps1')
$context=Read-ServiceManifest $Manifest
if (!(Test-ServiceAdministrator)) {
    $line='-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Manifest "'+$context.Path+'"'
    if ($Start) { $line+=' -Start' }
    $p=Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $line -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    exit $p.ExitCode
}
$cli='C:\Program Files\Servy\servy-cli.exe'
if (!(Test-Path -LiteralPath $cli)) { throw 'Install official signed Servy first.' }
$names=@($context.Data.services.name)
if (@($names | Select-Object -Unique).Count -ne $names.Count) { throw 'Duplicate service names in manifest.' }
if (@($context.Data.services.id | Select-Object -Unique).Count -ne @($context.Data.services).Count) { throw 'Duplicate service IDs in manifest.' }
$powershell="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
foreach ($definition in $context.Data.services) {
    if ($definition.name -notmatch '^[A-Za-z0-9_-]+$' -or $definition.id -notmatch '^[A-Za-z0-9_-]+$') { throw 'Service names and IDs must use letters, digits, underscores or hyphens.' }
    if (!(Test-Path -LiteralPath (Join-Path $context.ProjectRoot $definition.script))) { throw "Missing launcher: $($definition.script)" }
    if (!(Test-Path -LiteralPath (Expand-ServicePath $definition.executable $context))) { throw "Missing executable for $($definition.id)" }
}
# Export includes credentials. Only Administrators and SYSTEM can access this staging folder.
$staging=Join-Path $env:ProgramData ('Servy\registration-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
    $identity=New-Object Security.Principal.SecurityIdentifier($sid)
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $staging -AclObject $acl
$backup=@{}
$running=@{}
$updated=@()
$credential=$null
function Invoke-RegistrationCli([string[]]$Arguments) {
    & $cli @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Servy command failed: $($Arguments[0]) (exit $LASTEXITCODE)." }
}
try {
    foreach ($definition in $context.Data.services) {
        $name=$definition.name
        $service=Get-Service -Name $name -ErrorAction SilentlyContinue
        $launch=Join-Path $context.ProjectRoot $definition.script
        $parameters='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$launch+'" -Action RUN'
        $logDir=Join-Path $PSScriptRoot ('logs\'+$name)
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        if ($service) {
            $original=Join-Path $staging ($name+'.original.json')
            Invoke-RegistrationCli @('export',"--name=$name",'--config=json',"--path=$original")
            $backup[$name]=$original
            $running[$name]=($service.Status -eq 'Running')
            $config=Get-Content -LiteralPath $original -Raw | ConvertFrom-Json
            $config.StartupType='Automatic'
            $config.Parameters=$parameters
            $config.StartupDirectory=$context.ProjectRoot
            $config.StdoutPath=Join-Path $logDir 'stdout.log'
            $config.StderrPath=Join-Path $logDir 'stderr.log'
            $modified=Join-Path $staging ($name+'.updated.json')
            $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $modified -Encoding UTF8
            if ($running[$name]) { Stop-Service -Name $name }
            $updated+=$name
            Invoke-RegistrationCli @('import','--config=json',"--path=$modified",'--install')
        } else {
            if (!$credential) {
                $credential=Get-Credential -Message 'Desk Panel: enter your Windows account password (not PIN). It is passed directly to Servy, never saved in the project.' -UserName "$env:COMPUTERNAME\$env:USERNAME"
                if (!$credential) { throw 'Credential entry cancelled.' }
                $env:SERVY_PASSWORD=$credential.GetNetworkCredential().Password
            }
            Invoke-RegistrationCli @('install',"--name=$name","--displayName=$name","--path=$powershell","--startupDir=$($context.ProjectRoot)","--params=$parameters",'--startupType=Automatic',"--user=$($credential.UserName)","--stdout=$(Join-Path $logDir 'stdout.log')","--stderr=$(Join-Path $logDir 'stderr.log')",'--enableSizeRotation','--rotationSize=10','--maxRotations=5','--enableHealth','--recoveryAction=RestartProcess','--recoveryOnCleanExit','--heartbeatInterval=10','--maxRestartAttempts=5','--stopTimeout=15')
        }
        if ($Start -or $running[$name]) { Start-Service -Name $name }
    }
    $catalog=Join-Path $PSScriptRoot 'registrations'
    New-Item -ItemType Directory -Path $catalog -Force | Out-Null
    @{manifest=$context.Path;services=$names} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $catalog ((Split-Path $context.ProjectRoot -Leaf)+'.json')) -Encoding UTF8
} catch {
    foreach ($name in $updated) {
        Stop-Service $name -ErrorAction SilentlyContinue
        & $cli import --config=json "--path=$($backup[$name])" --install
        if ($running[$name]) { Start-Service $name -ErrorAction Continue }
    }
    throw
} finally {
    Remove-Item Env:\SERVY_PASSWORD -ErrorAction SilentlyContinue
    $credential=$null
    # Explicit files only; never remove an arbitrary directory tree.
    Get-ChildItem -LiteralPath $staging -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    Remove-Item -LiteralPath $staging -Force
}
Get-Service -Name $names | Select-Object Name,Status,StartType
