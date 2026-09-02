$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = 'D:\FetanAgent Companion'

if (-not (Test-Path -LiteralPath 'D:\' -PathType Container)) {
  $dataRoot = Join-Path $env:LOCALAPPDATA 'FetanAgent Companion'
}

$env:FETANAGENT_COMPANION_DATA_ROOT = $dataRoot
Set-Location -LiteralPath $workspaceRoot
pnpm --filter '@fetanagent/windows-companion' build
pnpm --filter '@fetanagent/windows-companion' start
