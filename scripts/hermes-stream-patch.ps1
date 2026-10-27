# Verify or apply the pinned Hermes host patch without touching auth or service state.
# Windows PowerShell 5.1 reads this file as ANSI: keep it ASCII.
param(
    [ValidateSet('CHECK','APPLY')][string]$Action='CHECK',
    [string]$HermesSource=$(if ($env:DESK_HERMES_SOURCE) { $env:DESK_HERMES_SOURCE } else { Join-Path $env:USERPROFILE '.hermes\hermes-agent' }),
    [string]$ProviderSource=$(if ($env:DESK_HERMES_PROVIDER_SOURCE) { $env:DESK_HERMES_PROVIDER_SOURCE } else { Join-Path $env:USERPROFILE '.hermes\plugins\antigravity-oauth' })
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$lock=Get-Content -LiteralPath (Join-Path $root 'servy\hermes.lock.json') -Raw | ConvertFrom-Json

function Git-Head([string]$Path) {
    if (!(Test-Path -LiteralPath (Join-Path $Path '.git'))) { throw "Not a Git checkout: $Path" }
    $value=(& git -C $Path rev-parse HEAD 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Cannot read Git HEAD: $Path" }
    return $value
}
function Normalized-Hash([string]$Path) {
    $value=[IO.File]::ReadAllText($Path).Replace("`r`n","`n")
    $bytes=[Text.Encoding]::UTF8.GetBytes($value)
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return (-join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })) }
    finally { $sha.Dispose() }
}

try {
    if (!$lock.hermesRef -or !$lock.provider.ref -or !$lock.streamingPatch.file -or !$lock.streamingPatch.sha256 -or !$lock.streamingPatch.target -or !$lock.streamingPatch.baseSha256 -or !$lock.streamingPatch.resultSha256) { throw 'Incomplete Hermes streaming lock.' }
    $patch=Join-Path $root $lock.streamingPatch.file
    if (!(Test-Path -LiteralPath $patch) -or (Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash -ne $lock.streamingPatch.sha256) { throw 'Streaming patch file missing or hash mismatch.' }
    if ((Git-Head $HermesSource) -ne $lock.hermesRef) { throw 'Hermes source commit differs from lock.' }
    if ((Git-Head $ProviderSource) -ne $lock.provider.ref) { throw 'Provider commit differs from lock.' }
    $providerChanges=(& git -C $ProviderSource status --porcelain --untracked-files=all | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $providerChanges) { throw 'Provider checkout is not clean.' }
    $target=Join-Path $HermesSource $lock.streamingPatch.target
    if (!(Test-Path -LiteralPath $target)) { throw 'Hermes patch target missing.' }
    $hash=Normalized-Hash $target
    if ($hash -eq $lock.streamingPatch.resultSha256) { Write-Host 'Streaming patch: verified.'; exit 0 }
    if ($Action -ne 'APPLY') { throw 'Hermes streaming patch is not applied or the target differs from lock.' }
    if ($hash -ne $lock.streamingPatch.baseSha256) { throw 'Hermes patch target is not the pinned unmodified file.' }
    & git -C $HermesSource apply --check --unidiff-zero --ignore-whitespace $patch
    if ($LASTEXITCODE -ne 0) { throw 'Streaming patch does not apply cleanly.' }
    & git -C $HermesSource apply --unidiff-zero --ignore-whitespace $patch
    if ($LASTEXITCODE -ne 0 -or (Normalized-Hash $target) -ne $lock.streamingPatch.resultSha256) { throw 'Streaming patch application failed verification.' }
    Write-Host 'Streaming patch: applied and verified.'
    exit 0
} catch {
    Write-Warning $_.Exception.Message
    exit 1
}
