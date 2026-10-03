param(
  [switch] $CheckOnly,
  [switch] $PreviewConnection,
  [string] $CheckDataRoot
)

$ErrorActionPreference = 'Stop'

try {
  if ($CheckOnly -and $PreviewConnection) { throw 'Conflicting check modes.' }
  if ($CheckDataRoot -and (-not $CheckOnly -or
      -not [System.IO.Path]::IsPathRooted($CheckDataRoot))) {
    throw 'A check-only directory was used for execution.'
  }
  $packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $node = Join-Path $packageRoot 'runtime\node.exe'
  $entry = Join-Path $packageRoot 'app\dist\one-job-operator-cli.js'
  $releaseMarker = Join-Path $packageRoot 'RELEASE_SHA'

  foreach ($path in @($node, $entry, $releaseMarker)) {
    $file = Get-Item -LiteralPath $path -ErrorAction Stop
    if (-not ($file -is [System.IO.FileInfo]) -or
        ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw 'Incomplete package.'
    }
  }

  $releaseSha = (Get-Content -LiteralPath $releaseMarker -Raw).Trim()
  if ($releaseSha -cnotmatch '^[0-9a-f]{40}$') { throw 'Invalid release.' }

  if ($CheckDataRoot) {
    $dataRoot = $CheckDataRoot
  } elseif (Test-Path -LiteralPath 'D:\' -PathType Container) {
    $dataRoot = 'D:\FetanAgent Companion'
  } else {
    if (-not $env:LOCALAPPDATA) { throw 'Missing Windows data root.' }
    $dataRoot = Join-Path $env:LOCALAPPDATA 'FetanAgent Companion'
  }
  $enrollment = Join-Path $dataRoot 'device\companion-primary.enrollment.json'
  if (-not (Test-Path -LiteralPath $enrollment -PathType Leaf)) {
    throw 'The companion is not paired.'
  }

  $documentPath = Join-Path $dataRoot 'operator\one-job-launch.json'
  $documentFile = Get-Item -LiteralPath $documentPath -ErrorAction Stop
  if (-not ($documentFile -is [System.IO.FileInfo]) -or
      ($documentFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
      $documentFile.Length -lt 2 -or $documentFile.Length -gt 8192) {
    throw 'The local operator document is unavailable.'
  }
  $document = Get-Content -LiteralPath $documentPath -Raw -Encoding UTF8
  $parsed = $document | ConvertFrom-Json
  $required = @(
    'version', 'releaseTag', 'archivePath', 'checksumPath',
    'verifierScriptPath', 'powershellExecutable',
    'processVerifierScriptPath', 'connection'
  )
  $names = @($parsed.PSObject.Properties.Name)
  if ($parsed.version -ne 2 -or $names.Count -ne $required.Count -or
      @($required | Where-Object { $_ -notin $names }).Count -ne 0) {
    throw 'The local operator document is invalid.'
  }
  $connectionNames = @($parsed.connection.PSObject.Properties.Name)
  $requiredConnection = @(
    'identityFile', 'knownHostsFile', 'remoteHostIpv4',
    'remoteUser', 'remoteSshPort', 'remoteLoopbackPort'
  )
  if ($connectionNames.Count -ne $requiredConnection.Count -or
      @($requiredConnection | Where-Object { $_ -notin $connectionNames }).Count -ne 0) {
    throw 'The local operator connection is invalid.'
  }

  foreach ($path in @(
    $parsed.archivePath, $parsed.checksumPath,
    $parsed.verifierScriptPath, $parsed.powershellExecutable,
    $parsed.processVerifierScriptPath,
    $parsed.connection.identityFile, $parsed.connection.knownHostsFile
  )) {
    if (-not ($path -is [string]) -or
        -not [System.IO.Path]::IsPathRooted($path)) {
      throw 'A local operator input is invalid.'
    }
    $file = Get-Item -LiteralPath $path -ErrorAction Stop
    if (-not ($file -is [System.IO.FileInfo]) -or
        ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw 'A local operator input is unavailable.'
    }
  }

  if ($CheckOnly) {
    Write-Output 'Local one-job inputs are present. No connection or deposit was started.'
    exit 0
  }

  $env:FETANAGENT_COMPANION_DATA_ROOT = $dataRoot
  $env:FETANAGENT_COMPANION_RELEASE_SHA = $releaseSha
  $operatorArguments = @()
  if ($PreviewConnection) { $operatorArguments = @('--preview-connection') }
  $document | & $node $entry @operatorArguments
  if ($LASTEXITCODE -ne 0) { throw 'The one-job operator stopped.' }
  if ($PreviewConnection) {
    Write-Output 'The protected connection preview passed. No activation or deposit was started.'
    exit 0
  }
  Write-Output 'The one-job operator finished. Check the Owner page for the final result.'
  exit 0
} catch {
  [Console]::Error.WriteLine(
    'The one-job operator is not ready or stopped. Check the exact job before starting another session.'
  )
  exit 1
}
