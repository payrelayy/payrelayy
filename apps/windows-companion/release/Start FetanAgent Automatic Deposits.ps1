param(
  [switch] $CheckOnly,
  [string] $CheckDataRoot,
  [string] $NoMoneyPreflightPlayerId,
  [int] $NoMoneyPreflightAmountMinor
)

$ErrorActionPreference = 'Stop'

try {
  $preflightPlayerProvided = $PSBoundParameters.ContainsKey('NoMoneyPreflightPlayerId')
  $preflightAmountProvided = $PSBoundParameters.ContainsKey('NoMoneyPreflightAmountMinor')
  if ($preflightPlayerProvided -ne $preflightAmountProvided -or
      ($CheckOnly -and $preflightPlayerProvided)) {
    throw 'A complete no-money preflight is required for this mode.'
  }
  if ($preflightPlayerProvided -and (
      $NoMoneyPreflightPlayerId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
      $NoMoneyPreflightAmountMinor -lt 2500 -or
      $NoMoneyPreflightAmountMinor -gt 2500000)) {
    throw 'The no-money preflight target is invalid.'
  }
  if ($CheckDataRoot -and (-not $CheckOnly -or
      -not [System.IO.Path]::IsPathRooted($CheckDataRoot))) {
    throw 'A check-only directory was used for execution.'
  }
  foreach ($name in @(
    'INTERNAL_COMPANION_EXECUTION_V2_ENABLED',
    'INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED',
    'FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID',
    'FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID',
    'FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID',
    'FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR',
    'INTERNAL_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID',
    'INTERNAL_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR',
    'NODE_OPTIONS',
    'NODE_PATH'
  )) {
    if ([Environment]::GetEnvironmentVariable($name, 'Process') -ne $null) {
      throw 'An ambient protected-launch setting is not allowed.'
    }
  }

  $packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $node = Join-Path $packageRoot 'runtime\node.exe'
  $entry = Join-Path $packageRoot 'app\dist\routine-deposit-launcher-cli.js'
  $releaseMarker = Join-Path $packageRoot 'RELEASE_SHA'
  $treeMarker = Join-Path $packageRoot 'INSTALLATION_TREE_SHA256'
  foreach ($path in @($node, $entry, $releaseMarker, $treeMarker)) {
    $file = Get-Item -LiteralPath $path -ErrorAction Stop
    if (-not ($file -is [System.IO.FileInfo]) -or
        ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw 'The extracted package is incomplete.'
    }
  }
  $releaseSha = (Get-Content -LiteralPath $releaseMarker -Raw).Trim()
  $treeDigest = (Get-Content -LiteralPath $treeMarker -Raw).Trim()
  if ($releaseSha -cnotmatch '^[0-9a-f]{40}$' -or
      $treeDigest -cnotmatch '^sha256:[0-9a-f]{64}$') {
    throw 'The extracted package identity is invalid.'
  }

  if ($CheckDataRoot) {
    $dataRoot = $CheckDataRoot
  } elseif (Test-Path -LiteralPath 'D:\' -PathType Container) {
    $dataRoot = 'D:\FetanAgent Companion'
  } else {
    if (-not $env:LOCALAPPDATA) { throw 'The Windows data root is unavailable.' }
    $dataRoot = Join-Path $env:LOCALAPPDATA 'FetanAgent Companion'
  }
  $enrollment = Get-Item -LiteralPath (
    Join-Path $dataRoot 'device\companion-primary.enrollment.json'
  ) -ErrorAction Stop
  if (-not ($enrollment -is [System.IO.FileInfo]) -or
      ($enrollment.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'The companion is not paired.'
  }

  $documentPath = Join-Path $dataRoot 'operator\routine-deposit-launch.json'
  $documentFile = Get-Item -LiteralPath $documentPath -ErrorAction Stop
  if (-not ($documentFile -is [System.IO.FileInfo]) -or
      ($documentFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
      $documentFile.Length -lt 2 -or $documentFile.Length -gt 1024) {
    throw 'The local routine-deposit launch document is unavailable.'
  }
  $document = Get-Content -LiteralPath $documentPath -Raw -Encoding UTF8
  $parsed = $document | ConvertFrom-Json
  $required = @('version', 'releaseSha', 'platformAgentAccountId')
  $names = @($parsed.PSObject.Properties.Name)
  if ($parsed.version -ne 1 -or $names.Count -ne $required.Count -or
      @($required | Where-Object { $_ -notin $names }).Count -ne 0 -or
      $parsed.releaseSha -cne $releaseSha -or
      $parsed.platformAgentAccountId -cnotmatch
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw 'The local routine-deposit launch document is invalid.'
  }
  $canonicalDocument = ConvertTo-Json -InputObject ([ordered]@{
    version = 1
    releaseSha = [string]$parsed.releaseSha
    platformAgentAccountId = [string]$parsed.platformAgentAccountId
  }) -Compress
  if ($document -cne $canonicalDocument) {
    throw 'The local routine-deposit launch document is not canonical.'
  }

  if ($CheckOnly) {
    Write-Output 'Local routine-deposit inputs are present. No browser, connection, or deposit was started.'
    exit 0
  }

  $env:FETANAGENT_COMPANION_DATA_ROOT = $dataRoot
  $env:FETANAGENT_COMPANION_RELEASE_SHA = $releaseSha
  $env:FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID =
    $parsed.platformAgentAccountId
  if ($preflightPlayerProvided) {
    $env:FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_PLAYER_ID = $NoMoneyPreflightPlayerId
    $env:FETANAGENT_COMPANION_ROUTINE_PREFLIGHT_AMOUNT_MINOR =
      [string]$NoMoneyPreflightAmountMinor
  }
  & $node $entry
  if ($LASTEXITCODE -ne 0) { throw 'The protected routine-deposit session stopped.' }
  if ($preflightPlayerProvided) {
    Write-Output 'The no-money preflight session ended. No transfer was authorized.'
  } else {
    Write-Output 'The protected routine-deposit session ended. Review any unfinished attempt before restarting.'
  }
  exit 0
} catch {
  [Console]::Error.WriteLine(
    'Automatic Deposits did not start or stopped closed. Review the Owner status and any unfinished attempt before restarting.'
  )
  exit 1
}
