#requires -Version 7.0
$ErrorActionPreference = 'Stop'

$preflight = Join-Path $PSScriptRoot '../infra/operations/verify-windows-companion-release-installation.ps1'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "fetanagent-claim-binding-test-$([guid]::NewGuid().ToString('N'))"
$releaseSha = 'a' * 40
$archiveName = "FetanAgent-Windows-Companion-$($releaseSha.Substring(0, 12)).zip"
$archivePath = Join-Path $tempRoot $archiveName
$checksumPath = "$archivePath.sha256"
$installationRoot = Join-Path $tempRoot 'installed'
$treeDigest = "sha256:$('b' * 64)"
$global:fetanagentClaimTestReleaseMode = 'block'
$global:fetanagentClaimTestGhCalls = @()

# A real CLI invocation here would indicate that the requested archive claim was not
# checked before any external release or attestation lookup.
function global:gh {
  $global:fetanagentClaimTestGhCalls += "$($args[0]) $($args[1])"
  if ($global:fetanagentClaimTestReleaseMode -eq 'block') {
    throw 'The claim-binding test reached an external release lookup.'
  }
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'release' -and $args[1] -eq 'view') {
    return $global:fetanagentClaimTestReleaseJson
  }
  if ($args[0] -eq 'api') {
    return $global:fetanagentClaimTestTagJson
  }
  if ($args[0] -eq 'attestation' -and $args[1] -eq 'verify') {
    return '{}'
  }
  if ($args[0] -eq 'release' -and $args[1] -eq 'download') {
    $outputIndex = [Array]::IndexOf($args, '--output')
    if ($outputIndex -lt 0 -or $outputIndex + 1 -ge $args.Count) {
      throw 'The synthetic release download is invalid.'
    }
    [IO.File]::WriteAllText($args[$outputIndex + 1], $global:fetanagentClaimTestStableChecksumText)
    return
  }
  throw 'The claim-binding test reached an unexpected external lookup.'
}

try {
  New-Item -ItemType Directory -Path $installationRoot -Force | Out-Null
  [IO.File]::WriteAllBytes($archivePath, [byte[]]@(1, 2, 3))
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($checksumPath, "$archiveHash  $archiveName")

  try {
    & $preflight -ReleaseTag 'windows-companion-v-test' -ReleaseSha $releaseSha `
      -ArchivePath $archivePath -ChecksumPath $checksumPath `
      -InstallationRoot $installationRoot `
      -ExpectedArchiveSha256 "sha256:$('0' * 64)" `
      -ExpectedInstallationTreeSha256 $treeDigest | Out-Null
    throw 'The preflight accepted an archive outside the prepared request.'
  } catch {
    if ($_.Exception.Message -cne
      'Companion release preflight failed at input; no activation was performed.') {
      throw 'The archive claim did not fail before any external lookup.'
    }
  }

  try {
    & $preflight -ReleaseTag 'windows-companion-v-test' -ReleaseSha $releaseSha `
      -ArchivePath $archivePath -ChecksumPath $checksumPath `
      -InstallationRoot $installationRoot `
      -ExpectedArchiveSha256 "sha256:$archiveHash" `
      -ExpectedInstallationTreeSha256 $treeDigest | Out-Null
    throw 'The synthetic release unexpectedly passed the preflight.'
  } catch {
    if ($_.Exception.Message -cne
      'Companion release preflight failed at published_release; no activation was performed.') {
      throw 'The matching archive claim did not reach the external release boundary.'
    }
  }

  # Simulate only the already-verified release metadata so the preflight reaches
  # the archive-tree comparison. This test never calls the real GitHub CLI.
  [IO.File]::Delete($archivePath)
  $packageName = "FetanAgent-Windows-Companion-$($releaseSha.Substring(0, 12))"
  $zip = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($item in @(
      @{ Name = "$packageName/RELEASE_SHA"; Value = $releaseSha },
      @{ Name = "$packageName/INSTALLATION_TREE_SHA256"; Value = "sha256:$('c' * 64)" }
    )) {
      $entry = $zip.CreateEntry($item.Name)
      $stream = $entry.Open()
      try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($item.Value)
        $stream.Write($bytes, 0, $bytes.Length)
      } finally {
        $stream.Dispose()
      }
    }
  } finally {
    $zip.Dispose()
  }
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($checksumPath, "$archiveHash  $archiveName")
  $checksumHash = (Get-FileHash -LiteralPath $checksumPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $global:fetanagentClaimTestStableChecksumText = "$archiveHash  FetanAgent-Windows-Companion.zip"
  $stableChecksumHash = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($global:fetanagentClaimTestStableChecksumText))
  ).ToLowerInvariant()
  $global:fetanagentClaimTestReleaseJson = @{
    tagName = 'windows-companion-v-test'
    isDraft = $false
    isPrerelease = $false
    assets = @(
      @{ name = $archiveName; digest = "sha256:$archiveHash" },
      @{ name = "$archiveName.sha256"; digest = "sha256:$checksumHash" },
      @{ name = 'FetanAgent-Windows-Companion.zip'; digest = "sha256:$archiveHash" },
      @{ name = 'FetanAgent-Windows-Companion.zip.sha256'; digest = "sha256:$stableChecksumHash" }
    )
  } | ConvertTo-Json -Depth 6 -Compress
  $global:fetanagentClaimTestTagJson = @{ object = @{ type = 'commit'; sha = $releaseSha } } |
    ConvertTo-Json -Depth 4 -Compress
  $global:fetanagentClaimTestReleaseMode = 'synthetic'
  try {
    & $preflight -ReleaseTag 'windows-companion-v-test' -ReleaseSha $releaseSha `
      -ArchivePath $archivePath -ChecksumPath $checksumPath `
      -InstallationRoot $installationRoot `
      -ExpectedArchiveSha256 "sha256:$archiveHash" `
      -ExpectedInstallationTreeSha256 $treeDigest | Out-Null
    throw 'The preflight accepted an installation tree outside the prepared request.'
  } catch {
    if ($_.Exception.Message -cne
      'Companion release preflight failed at archive_tree; no activation was performed.') {
      throw "The tree claim did not fail before archive extraction or launch: $($_.Exception.Message); calls $($global:fetanagentClaimTestGhCalls -join ', ')"
    }
  }

  'Companion archive and tree claim binding passed without external release access.'
} finally {
  $base = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
  $resolved = [IO.Path]::GetFullPath($tempRoot)
  $prefix = "$base$([IO.Path]::DirectorySeparatorChar)"
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notmatch '^fetanagent-claim-binding-test-[0-9a-f]{32}$') {
    throw 'The claim-binding test directory cannot be safely cleaned.'
  }
  if (Test-Path -LiteralPath $resolved) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
