function Read-ServiceManifest([string]$Path) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $manifest = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
    $root = [IO.Path]::GetFullPath((Join-Path (Split-Path $resolved) $manifest.projectRoot))
    @{ Data=$manifest; Path=$resolved; ProjectRoot=$root; ProjectsRoot=(Split-Path $root); UserProfile=$env:USERPROFILE }
}
function Expand-ServicePath([string]$Value, $Context) {
    $Value.Replace('${ProjectRoot}',$Context.ProjectRoot).Replace('${ProjectsRoot}',$Context.ProjectsRoot).Replace('${UserProfile}',$Context.UserProfile)
}
function Test-ServiceAdministrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
