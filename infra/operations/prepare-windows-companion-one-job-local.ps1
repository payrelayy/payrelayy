#requires -Version 7.0
# Prepare the paired Windows host without opening SSH or activating execution.
# Supply FETANAGENT_OPERATOR_HOST_IPV4 from the independently verified production host.
# -PlanOnly performs all release and local-input checks without creating files.
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^windows-companion-v[0-9]+\.[0-9]+\.[0-9]+$')]
  [string] $ReleaseTag,

  [Parameter(Mandatory = $true)]
  [string] $ReleaseDirectory,

  [switch] $PlanOnly
)

$ErrorActionPreference = 'Stop'
$stage = 'input'

function OrdinaryFile([string] $Path) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (-not ($item -is [System.IO.FileInfo]) -or
      ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'An ordinary file is required.'
  }
  return $item.FullName
}

function OrdinaryDirectory([string] $Path) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (-not ($item -is [System.IO.DirectoryInfo]) -or
      ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'An ordinary directory is required.'
  }
  return $item.FullName
}

function PinnedSource([string] $ScriptPath, [string] $ContractPath, [string] $ConstantName) {
  $source = OrdinaryFile $ScriptPath
  $contract = Get-Content -LiteralPath (OrdinaryFile $ContractPath) -Raw
  $pattern = "const $ConstantName = '([0-9a-f]{64})';"
  $matched = [regex]::Match($contract, $pattern)
  if (-not $matched.Success -or
      (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        $matched.Groups[1].Value) {
    throw 'A reviewed local preflight differs from the compiled contract.'
  }
  return $source
}

try {
  if (-not $IsWindows) { throw 'Windows is required.' }
  $stage = 'pinned_host'
  $hostIpv4 = $env:FETANAGENT_OPERATOR_HOST_IPV4
  $parsedHost = $null
  if (-not [System.Net.IPAddress]::TryParse($hostIpv4, [ref] $parsedHost) -or
      $parsedHost.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
      $parsedHost.ToString() -cne $hostIpv4) {
    throw 'The pinned host is unavailable.'
  }

  $stage = 'installed_release'
  $releaseRoot = OrdinaryDirectory $ReleaseDirectory
  $installParent = OrdinaryDirectory (Join-Path $releaseRoot 'install')
  $installedRoots = @(Get-ChildItem -LiteralPath $installParent -Directory)
  if ($installedRoots.Count -ne 1) { throw 'The installed package is not singular.' }
  $installed = OrdinaryDirectory $installedRoots[0].FullName
  $releaseSha = [System.IO.File]::ReadAllText((OrdinaryFile (Join-Path $installed 'RELEASE_SHA')))
  $treeDigest = [System.IO.File]::ReadAllText(
    (OrdinaryFile (Join-Path $installed 'INSTALLATION_TREE_SHA256'))
  )
  if ($releaseSha -cnotmatch '^[0-9a-f]{40}$' -or
      $treeDigest -cnotmatch '^sha256:[0-9a-f]{64}$' -or
      [System.IO.Path]::GetFileName($installed) -cne
        "FetanAgent-Windows-Companion-$($releaseSha.Substring(0, 12))") {
    throw 'The installed release markers are invalid.'
  }
  $archive = OrdinaryFile (Join-Path $releaseRoot (
    "FetanAgent-Windows-Companion-$($releaseSha.Substring(0, 12)).zip"
  ))
  $checksum = OrdinaryFile "$archive.sha256"
  $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([System.IO.File]::ReadAllText($checksum).Trim() -cne
      "$archiveHash  $([System.IO.Path]::GetFileName($archive))") {
    throw 'The archive checksum is invalid.'
  }

  $stage = 'reviewed_sources'
  $repositoryRoot = OrdinaryDirectory (Join-Path $PSScriptRoot '..\..')
  $sourcePreflight = PinnedSource `
    (Join-Path $repositoryRoot 'infra\operations\verify-windows-companion-release-installation.ps1') `
    (Join-Path $repositoryRoot 'packages\agent-platform-companion-activation-issuer\src\release-measurement.ts') `
    'PREFLIGHT_SOURCE_SHA256'
  $sourceProcessCheck = PinnedSource `
    (Join-Path $repositoryRoot 'infra\operations\inspect-guarded-windows-companion-process.ps1') `
    (Join-Path $repositoryRoot 'packages\agent-platform-companion-activation-issuer\src\guarded-process-observation.ts') `
    'SCRIPT_SHA256'
  $powershellExecutable = OrdinaryFile (Get-Command pwsh -ErrorAction Stop).Source
  $launcher = OrdinaryFile (Join-Path $installed 'Start FetanAgent One-Job Operator.ps1')

  $stage = 'local_identity'
  $sshRoot = OrdinaryDirectory (Join-Path $env:USERPROFILE '.ssh')
  $identity = OrdinaryFile (Join-Path $sshRoot 'fetanagent_operator_ed25519')
  $knownHosts = OrdinaryFile (Join-Path $sshRoot 'known_hosts')
  & ssh-keygen -F $hostIpv4 -f $knownHosts *> $null
  if ($LASTEXITCODE -ne 0) { throw 'The host key is not pinned.' }

  $stage = 'paired_enrollment'
  $dataRoot = if (Test-Path -LiteralPath 'D:\' -PathType Container) {
    'D:\FetanAgent Companion'
  } else {
    Join-Path $env:LOCALAPPDATA 'FetanAgent Companion'
  }
  $dataRoot = OrdinaryDirectory $dataRoot
  $null = OrdinaryFile (Join-Path $dataRoot 'device\companion-primary.enrollment.json')
  $operatorDirectory = Join-Path $dataRoot 'operator'
  $documentPath = Join-Path $operatorDirectory 'one-job-launch.json'
  if ((Test-Path -LiteralPath $operatorDirectory) -or
      (Test-Path -LiteralPath $documentPath)) {
    throw 'A local operator configuration already exists.'
  }
  $reviewedDirectory = Join-Path $releaseRoot 'reviewed-operations'
  if (Test-Path -LiteralPath $reviewedDirectory) {
    throw 'The reviewed script target already exists.'
  }

  $stage = 'release_preflight'
  $preflight = & $powershellExecutable -NoProfile -NonInteractive -File $sourcePreflight `
    -ReleaseTag $ReleaseTag -ReleaseSha $releaseSha -ArchivePath $archive `
    -ChecksumPath $checksum -InstallationRoot $installed `
    -ExpectedArchiveSha256 "sha256:$archiveHash" `
    -ExpectedInstallationTreeSha256 $treeDigest
  if ($LASTEXITCODE -ne 0 -or
      @($preflight).Count -ne 1 -or
      @($preflight)[0] -cne 'COMPANION_RELEASE_INSTALLATION_VERIFIED; no activation was performed.') {
    throw 'The installed release preflight failed.'
  }
  if ($PlanOnly) {
    'ONE_JOB_LOCAL_PLAN_READY; no files changed.'
    exit 0
  }

  $stage = 'reviewed_copy'
  New-Item -ItemType Directory -Path $reviewedDirectory -ErrorAction Stop | Out-Null
  $reviewedPreflight = Join-Path $reviewedDirectory (
    [System.IO.Path]::GetFileName($sourcePreflight)
  )
  $reviewedProcessCheck = Join-Path $reviewedDirectory (
    [System.IO.Path]::GetFileName($sourceProcessCheck)
  )
  Copy-Item -LiteralPath $sourcePreflight -Destination $reviewedPreflight -ErrorAction Stop
  Copy-Item -LiteralPath $sourceProcessCheck -Destination $reviewedProcessCheck -ErrorAction Stop
  if ((Get-FileHash -LiteralPath $reviewedPreflight -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $sourcePreflight -Algorithm SHA256).Hash -or
      (Get-FileHash -LiteralPath $reviewedProcessCheck -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $sourceProcessCheck -Algorithm SHA256).Hash) {
    throw 'The reviewed script copy differs from source.'
  }

  $stage = 'local_document'
  $document = [ordered]@{
    version = 2
    releaseTag = $ReleaseTag
    archivePath = $archive
    checksumPath = $checksum
    verifierScriptPath = $reviewedPreflight
    powershellExecutable = $powershellExecutable
    processVerifierScriptPath = $reviewedProcessCheck
    connection = [ordered]@{
      identityFile = $identity
      knownHostsFile = $knownHosts
      remoteHostIpv4 = $hostIpv4
      remoteUser = 'fetanagent-operator'
      remoteSshPort = 22
      remoteLoopbackPort = 743
    }
  }
  $json = ConvertTo-Json -InputObject $document -Depth 5 -Compress
  if ([System.Text.Encoding]::UTF8.GetByteCount($json) -gt 8192) {
    throw 'The local operator document is too large.'
  }
  New-Item -ItemType Directory -Path $operatorDirectory -ErrorAction Stop | Out-Null
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
  $stream = [System.IO.File]::Open($documentPath, [System.IO.FileMode]::CreateNew)
  try { $stream.Write($bytes, 0, $bytes.Length) }
  finally { $stream.Dispose() }

  $stage = 'launcher_check'
  $check = & $powershellExecutable -NoProfile -NonInteractive -File $launcher -CheckOnly
  if ($LASTEXITCODE -ne 0 -or
      @($check).Count -ne 1 -or
      @($check)[0] -cne 'Local one-job inputs are present. No connection or deposit was started.') {
    throw 'The installed launcher rejected the local inputs.'
  }
  'ONE_JOB_LOCAL_INPUTS_READY; no session or deposit was started.'
} catch {
  [Console]::Error.WriteLine(
    "Local one-job setup refused at $stage; no operator session was opened."
  )
  exit 1
}
