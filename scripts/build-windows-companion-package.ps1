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

$nodeExecutable = (node -p 'process.execPath').Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
  throw 'Could not resolve the exact Node.js executable used by this build.'
}
$nodeVersion = (node -p 'process.version').Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') {
  throw 'Could not resolve the exact Node.js version used by this build.'
}
$nodeLicense = Join-Path (Split-Path -Parent $nodeExecutable) 'LICENSE'
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $packageRoot 'runtime\node.exe')
if (Test-Path -LiteralPath $nodeLicense -PathType Leaf) {
  Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $packageRoot 'runtime\LICENSE')
} else {
  # Some preinstalled Windows runtimes omit the adjacent license. Fetch only the license text
  # from the exact official source tag; never substitute or download another executable.
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" `
    -OutFile (Join-Path $packageRoot 'runtime\LICENSE') -TimeoutSec 30
}
if ((Get-Item -LiteralPath (Join-Path $packageRoot 'runtime\LICENSE')).Length -lt 1000) {
  throw 'The Node.js redistribution license is missing or incomplete.'
}
Set-Content -LiteralPath (Join-Path $packageRoot 'runtime\VERSION') -Value $nodeVersion -Encoding ascii
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
