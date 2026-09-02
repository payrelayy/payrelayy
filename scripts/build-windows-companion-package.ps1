param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $ReleaseSha,

  [Parameter(Mandatory = $true)]
  [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
$env:CI = 'true'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutputParent = [System.IO.Path]::GetFullPath($OutputDirectory)
$packageRoot = Join-Path $resolvedOutputParent "FetanAgent-Windows-Companion-$($ReleaseSha.Substring(0, 12))"
$zipPath = "$packageRoot.zip"

if (Test-Path -LiteralPath $packageRoot -PathType Container) {
  throw "Package directory already exists: $packageRoot"
}
if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
  throw "Package archive already exists: $zipPath"
}

New-Item -ItemType Directory -Path $resolvedOutputParent -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'runtime') -Force | Out-Null

Push-Location -LiteralPath $workspaceRoot
try {
  $checkedOutSha = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $checkedOutSha -ne $ReleaseSha) {
    throw 'The release SHA does not match the checked-out source.'
  }
  git diff --quiet HEAD -- apps/windows-companion packages/agent-platform-contracts packages/agent-platform-kemerbet pnpm-lock.yaml scripts/build-windows-companion-package.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Release inputs contain uncommitted changes.' }

  pnpm --filter '@fetanagent/windows-companion...' run build
  if ($LASTEXITCODE -ne 0) { throw 'Windows companion build failed.' }

  pnpm --filter '@fetanagent/windows-companion...' run test
  if ($LASTEXITCODE -ne 0) { throw 'Windows companion tests failed.' }

  pnpm --filter '@fetanagent/windows-companion' deploy --prod --legacy (Join-Path $packageRoot 'app')
  if ($LASTEXITCODE -ne 0) { throw 'Windows companion production deployment failed.' }
} finally {
  Pop-Location
}

$nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$nodeLicense = Join-Path (Split-Path -Parent $nodeExecutable) 'LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) {
  throw 'Use the official Node.js distribution, including its LICENSE, to build a redistributable package.'
}
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $packageRoot 'runtime\node.exe')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $packageRoot 'runtime\LICENSE')
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'apps\windows-companion\release\Start FetanAgent Companion.vbs') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'apps\windows-companion\release\README.txt') -Destination $packageRoot
Set-Content -LiteralPath (Join-Path $packageRoot 'RELEASE_SHA') -Value $ReleaseSha -Encoding ascii -NoNewline

Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = "$zipPath.sha256"
Set-Content -LiteralPath $checksumPath -Value "$hash  $([System.IO.Path]::GetFileName($zipPath))" -Encoding ascii

[pscustomobject]@{
  Archive = $zipPath
  Checksum = $checksumPath
  ReleaseSha = $ReleaseSha
}
