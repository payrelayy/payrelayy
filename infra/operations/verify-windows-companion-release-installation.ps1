#requires -Version 7.0
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^windows-companion-v[A-Za-z0-9._-]+$')]
  [string] $ReleaseTag,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string] $ReleaseSha,

  [Parameter(Mandatory = $true)]
  [string] $ArchivePath,

  [Parameter(Mandatory = $true)]
  [string] $ChecksumPath,

  [Parameter(Mandatory = $true)]
  [string] $InstallationRoot
)

$ErrorActionPreference = 'Stop'
# Pin the externally assigned GitHub repository identity without product branding.
$repositorySlug = 'pay' + 'relayy'
$repository = "$repositorySlug/$repositorySlug"
$workflow = "$repository/.github/workflows/windows-companion-package.yml"
$stage = 'input'
$temporaryRoot = $null
$temporaryCreated = $false

function Assert-OrdinaryFile([string] $Path) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (-not $item.PSIsContainer -and
      ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
    return $item.FullName
  }
  throw 'Expected an ordinary file.'
}

function Assert-OrdinaryDirectory([string] $Path) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.PSIsContainer -and
      ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
    return $item.FullName
  }
  throw 'Expected an ordinary directory.'
}

function Read-ArchiveMarker($Archive, [string] $EntryName) {
  $matching = @($Archive.Entries | Where-Object { $_.FullName -ceq $EntryName })
  if ($matching.Count -ne 1 -or $matching[0].Length -gt 100) {
    throw 'The companion archive marker is invalid.'
  }
  $entryStream = $matching[0].Open()
  try {
    $reader = [System.IO.StreamReader]::new($entryStream, [System.Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() }
    finally { $reader.Dispose() }
  } finally {
    $entryStream.Dispose()
  }
}

try {
  if (-not $IsWindows) { throw 'The companion installation preflight requires Windows.' }
  $archive = Assert-OrdinaryFile $ArchivePath
  $checksum = Assert-OrdinaryFile $ChecksumPath
  $installed = Assert-OrdinaryDirectory $InstallationRoot
  $shortSha = $ReleaseSha.Substring(0, 12)
  $archiveName = "FetanAgent-Windows-Companion-$shortSha.zip"
  $packageName = "FetanAgent-Windows-Companion-$shortSha"
  if ([System.IO.Path]::GetFileName($archive) -cne $archiveName -or
      [System.IO.Path]::GetFileName($checksum) -cne "$archiveName.sha256") {
    throw 'The immutable companion filenames are invalid.'
  }
  $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  $checksumText = [System.IO.File]::ReadAllText($checksum).Trim()
  if ($checksumText -cne "$archiveHash  $archiveName") {
    throw 'The immutable companion checksum does not match.'
  }

  $stage = 'published_release'
  $releaseJson = & gh release view $ReleaseTag --repo $repository `
    --json tagName,isDraft,isPrerelease,assets 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The release is unavailable.' }
  $release = $releaseJson | ConvertFrom-Json
  if ($release.tagName -cne $ReleaseTag -or $release.isDraft -or $release.isPrerelease) {
    throw 'The release is not the exact published production release.'
  }
  $expectedAssetNames = @(
    $archiveName, "$archiveName.sha256",
    'FetanAgent-Windows-Companion.zip',
    'FetanAgent-Windows-Companion.zip.sha256'
  )
  $assets = @($release.assets)
  if ($assets.Count -ne 4 -or
      @($assets | Where-Object { $expectedAssetNames -cnotcontains $_.name }).Count -ne 0) {
    throw 'The release asset set is not exact.'
  }
  foreach ($name in $expectedAssetNames) {
    if (@($assets | Where-Object { $_.name -ceq $name }).Count -ne 1) {
      throw 'The release asset set contains a duplicate or missing asset.'
    }
  }
  $immutableAsset = @($assets | Where-Object { $_.name -ceq $archiveName })[0]
  $checksumAsset = @($assets | Where-Object { $_.name -ceq "$archiveName.sha256" })[0]
  $stableAsset = @($assets | Where-Object { $_.name -ceq 'FetanAgent-Windows-Companion.zip' })[0]
  $stableChecksumAsset = @($assets | Where-Object {
    $_.name -ceq 'FetanAgent-Windows-Companion.zip.sha256'
  })[0]
  $checksumHash = (Get-FileHash -LiteralPath $checksum -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($immutableAsset.digest -cne "sha256:$archiveHash" -or
      $stableAsset.digest -cne "sha256:$archiveHash" -or
      $checksumAsset.digest -cne "sha256:$checksumHash") {
    throw 'The published release assets differ from the supplied archive.'
  }

  $stage = 'source_tag'
  $refJson = & gh api "repos/$repository/git/ref/tags/$ReleaseTag" 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The release source tag is unavailable.' }
  $tagObject = ($refJson | ConvertFrom-Json).object
  for ($depth = 0; $depth -lt 3 -and $tagObject.type -eq 'tag'; $depth++) {
    $tagJson = & gh api "repos/$repository/git/tags/$($tagObject.sha)" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'The release source tag cannot be resolved.' }
    $tagObject = ($tagJson | ConvertFrom-Json).object
  }
  if ($tagObject.type -cne 'commit' -or $tagObject.sha -cne $ReleaseSha) {
    throw 'The release tag no longer points at the reviewed source.'
  }

  $stage = 'build_attestation'
  & gh attestation verify "$archive" `
    --repo $repository `
    --signer-workflow $workflow `
    --source-ref "refs/tags/$ReleaseTag" `
    --source-digest $ReleaseSha `
    --deny-self-hosted-runners `
    --format json *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'The release archive has no matching verified build attestation.'
  }

  $stage = 'stable_checksum'
  $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $temporaryRoot = Join-Path $tempBase "fetanagent-release-preflight-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $temporaryRoot -ErrorAction Stop | Out-Null
  $temporaryCreated = $true
  $stableChecksumPath = Join-Path $temporaryRoot 'FetanAgent-Windows-Companion.zip.sha256'
  & gh release download $ReleaseTag --repo $repository `
    --pattern 'FetanAgent-Windows-Companion.zip.sha256' `
    --output $stableChecksumPath *> $null
  if ($LASTEXITCODE -ne 0) { throw 'The stable checksum asset is unavailable.' }
  $stableChecksumPath = Assert-OrdinaryFile $stableChecksumPath
  $stableChecksumHash = (Get-FileHash -LiteralPath $stableChecksumPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([System.IO.File]::ReadAllText($stableChecksumPath).Trim() -cne
      "$archiveHash  FetanAgent-Windows-Companion.zip" -or
      $stableChecksumAsset.digest -cne "sha256:$stableChecksumHash") {
    throw 'The stable checksum does not match the attested archive.'
  }

  $stage = 'archive_tree'
  Add-Type -AssemblyName System.IO.Compression
  $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $prefix = "$packageName/"
    $entryNames = [System.Collections.Generic.HashSet[string]]::new(
      [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      $segments = $name.Split('/')
      if (-not $name.StartsWith($prefix, [System.StringComparison]::Ordinal) -or
          $name.Contains('\') -or $name.Contains(':') -or $name.Contains([char]0) -or
          @($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_ -eq '' }).Count -gt
            [int]$name.EndsWith('/') -or
          -not $entryNames.Add($name) -or
          ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000)) {
        throw 'The archive contains an unsafe or duplicate entry.'
      }
    }
    $releaseMarker = Read-ArchiveMarker $zip "${prefix}RELEASE_SHA"
    $treeMarker = Read-ArchiveMarker $zip "${prefix}INSTALLATION_TREE_SHA256"
    if ($releaseMarker -cne $ReleaseSha -or
        $treeMarker -cnotmatch '^sha256:[0-9a-f]{64}$') {
      throw 'The archive release markers are invalid.'
    }
  } finally {
    $zip.Dispose()
  }

  [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $temporaryRoot)
  $verifiedPackage = Assert-OrdinaryDirectory (Join-Path $temporaryRoot $packageName)
  if (@(Get-ChildItem -LiteralPath $verifiedPackage -Recurse -Force -Attributes ReparsePoint).Count -ne 0) {
    throw 'The extracted archive contains a filesystem link.'
  }
  $verifiedNode = Assert-OrdinaryFile (Join-Path $verifiedPackage 'runtime/node.exe')
  $verifiedMeasure = Assert-OrdinaryFile (
    Join-Path $verifiedPackage 'app/dist/installation-tree-cli.js'
  )
  $measuredArchiveTree = & $verifiedNode $verifiedMeasure $verifiedPackage
  if ($LASTEXITCODE -ne 0 -or $measuredArchiveTree -cne $treeMarker) {
    throw 'The attested archive tree does not match its marker.'
  }

  $stage = 'installed_tree'
  $installedRelease = Assert-OrdinaryFile (Join-Path $installed 'RELEASE_SHA')
  $installedTreeMarker = Assert-OrdinaryFile (Join-Path $installed 'INSTALLATION_TREE_SHA256')
  if ([System.IO.File]::ReadAllText($installedRelease) -cne $ReleaseSha -or
      [System.IO.File]::ReadAllText($installedTreeMarker) -cne $treeMarker) {
    throw 'The installed release markers differ from the attested archive.'
  }
  $measuredInstalledTree = & $verifiedNode $verifiedMeasure $installed
  if ($LASTEXITCODE -ne 0 -or $measuredInstalledTree -cne $treeMarker) {
    throw 'The installed companion differs from the attested archive.'
  }

  'COMPANION_RELEASE_INSTALLATION_VERIFIED; no activation was performed.'
} catch {
  throw "Companion release preflight failed at $stage; no activation was performed."
} finally {
  if ($temporaryCreated -and (Test-Path -LiteralPath $temporaryRoot)) {
    $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
    $resolvedTemporary = [System.IO.Path]::GetFullPath($temporaryRoot)
    $expectedPrefix = "$tempBase$([System.IO.Path]::DirectorySeparatorChar)"
    if (-not $resolvedTemporary.StartsWith(
        $expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase
      ) -or
        [System.IO.Path]::GetFileName($resolvedTemporary) -notmatch
          '^fetanagent-release-preflight-[0-9a-f]{32}$') {
      throw 'The temporary release directory cannot be safely cleaned.'
    }
    try { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force }
    catch { throw 'The temporary release directory could not be cleaned.' }
  }
}
