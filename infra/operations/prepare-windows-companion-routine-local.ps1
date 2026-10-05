#requires -Version 7.0
# Creates only the local account-bound launcher document. It does not connect, activate the
# database runtime, open KemerBet, or start a deposit.
param(
  [Parameter(Mandatory = $true)]
  [string] $ReleaseDirectory,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')]
  [string] $PlatformAgentAccountId,

  [switch] $PlanOnly
)

$ErrorActionPreference = 'Stop'
$stage = 'input'
$documentCreated = $false
$documentPath = $null

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

try {
  if (-not $IsWindows) { throw 'Windows is required.' }
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
  $launcher = OrdinaryFile (Join-Path $installed 'Start FetanAgent Automatic Deposits.ps1')

  $stage = 'paired_device'
  $dataRoot = if (Test-Path -LiteralPath 'D:\' -PathType Container) {
    'D:\FetanAgent Companion'
  } else {
    Join-Path $env:LOCALAPPDATA 'FetanAgent Companion'
  }
  $dataRoot = OrdinaryDirectory $dataRoot
  $null = OrdinaryFile (Join-Path $dataRoot 'device\companion-primary.enrollment.json')
  $operatorDirectory = Join-Path $dataRoot 'operator'
  $documentPath = Join-Path $operatorDirectory 'routine-deposit-launch.json'
  if (Test-Path -LiteralPath $documentPath) {
    throw 'A routine-deposit launch document already exists.'
  }
  if (Test-Path -LiteralPath $operatorDirectory) {
    $null = OrdinaryDirectory $operatorDirectory
  }

  if ($PlanOnly) {
    'ROUTINE_DEPOSIT_LOCAL_PLAN_READY; no files changed and no deposit was started.'
    exit 0
  }

  $stage = 'local_document'
  if (-not (Test-Path -LiteralPath $operatorDirectory)) {
    New-Item -ItemType Directory -Path $operatorDirectory -ErrorAction Stop | Out-Null
  }
  $document = [ordered]@{
    version = 1
    releaseSha = $releaseSha
    platformAgentAccountId = $PlatformAgentAccountId
  }
  $json = ConvertTo-Json -InputObject $document -Compress
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
  $stream = [System.IO.File]::Open($documentPath, [System.IO.FileMode]::CreateNew)
  try { $stream.Write($bytes, 0, $bytes.Length) }
  finally { $stream.Dispose() }
  $documentCreated = $true

  $stage = 'launcher_check'
  $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $check = & $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $launcher -CheckOnly -CheckDataRoot $dataRoot
  if ($LASTEXITCODE -ne 0 -or @($check).Count -ne 1 -or
      @($check)[0] -cne
        'Local routine-deposit inputs are present. No browser, connection, or deposit was started.') {
    throw 'The installed routine-deposit launcher rejected the local inputs.'
  }
  'ROUTINE_DEPOSIT_LOCAL_INPUTS_READY; no connection or deposit was started.'
} catch {
  if ($documentCreated -and $documentPath -and (Test-Path -LiteralPath $documentPath -PathType Leaf)) {
    Remove-Item -LiteralPath $documentPath -Force -ErrorAction SilentlyContinue
  }
  [Console]::Error.WriteLine(
    "Routine-deposit local setup refused at $stage; no browser or deposit was started."
  )
  exit 1
}
