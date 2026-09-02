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

  # The isolated pnpm layout contains Windows junctions, including links back into
  # the source workspace. ZIP archives do not preserve those dependencies. A
  # hoisted deployment materializes the complete runtime graph as ordinary files.
  pnpm --config.node-linker=hoisted --filter '@fetanagent/windows-companion' deploy --prod --legacy (Join-Path $packageRoot 'app')
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

if (@(Get-ChildItem -LiteralPath $packageRoot -Recurse -Force -Attributes ReparsePoint).Count -ne 0) {
  throw 'The portable package must not contain filesystem links or junctions.'
}

Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal

# Test the actual archive, not the pre-ZIP directory whose junctions could still
# resolve against the build machine. This import does not open Chrome or connect
# to KemerBet; it proves that the extracted runtime can resolve every entry import.
$verificationRoot = Join-Path $resolvedOutputParent "archive-verification-$($ReleaseSha.Substring(0, 12))"
if (Test-Path -LiteralPath $verificationRoot) {
  throw 'The archive verification directory already exists.'
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $verificationRoot
$extractedPackage = Join-Path $verificationRoot (Split-Path -Leaf $packageRoot)
if ((Get-Content -LiteralPath (Join-Path $extractedPackage 'RELEASE_SHA') -Raw).Trim() -ne $ReleaseSha) {
  throw 'The extracted archive release identity is invalid.'
}
if (@(Get-ChildItem -LiteralPath $extractedPackage -Recurse -Force -Attributes ReparsePoint).Count -ne 0) {
  throw 'The extracted archive must contain only self-contained runtime files.'
}
Push-Location -LiteralPath (Join-Path $extractedPackage 'app')
try {
  $portableSmoke = @'
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = realpathSync(process.cwd()) + sep;
for (const name of ['@fetanagent/agent-platform-kemerbet', '@fetanagent/agent-platform-contracts', 'playwright-core', './dist/index.js']) {
  const url = import.meta.resolve(name);
  assert(realpathSync(fileURLToPath(url)).startsWith(root), 'Runtime dependency escaped the extracted package.');
  await import(url);
}
console.log('WINDOWS_COMPANION_PORTABLE_IMPORT_OK');
'@
  & (Join-Path $extractedPackage 'runtime\node.exe') --input-type=module --eval $portableSmoke
  if ($LASTEXITCODE -ne 0) { throw 'The extracted Windows companion could not load its runtime dependencies.' }
} finally {
  Pop-Location
}

$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = "$zipPath.sha256"
Set-Content -LiteralPath $checksumPath -Value "$hash  $([System.IO.Path]::GetFileName($zipPath))" -Encoding ascii

[pscustomobject]@{
  Archive = $zipPath
  Checksum = $checksumPath
  ReleaseSha = $ReleaseSha
}
