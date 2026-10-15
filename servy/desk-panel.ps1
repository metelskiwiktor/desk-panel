param([ValidateSet('START','END','STOP','RESTART','STATUS','RUN')][string]$Action='STATUS')
& (Join-Path $PSScriptRoot 'Control-Service.ps1') -Manifest (Join-Path $PSScriptRoot 'services.json') -Id desk-panel -Action $Action
exit $LASTEXITCODE
