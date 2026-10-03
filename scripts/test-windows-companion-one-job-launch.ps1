param(
  [Parameter(Mandatory = $true)]
  [string] $LauncherPath,

  [Parameter(Mandatory = $true)]
  [string] $CommandPath
)

$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $LauncherPath, [ref] $tokens, [ref] $parseErrors
) | Out-Null
if ($parseErrors.Count -ne 0) { throw 'The one-job PowerShell launcher does not parse.' }

$command = Get-Content -LiteralPath $CommandPath -Raw
if ($command -notmatch 'Start FetanAgent One-Job Operator\.ps1' -or
    $command -notmatch 'NoProfile' -or
    $command -notmatch 'exit /b %operator_result%') {
  throw 'The one-job double-click launcher differs from the reviewed command.'
}

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$fixtureRoot = Join-Path $tempRoot ("fetanagent-one-job-launch-test-" + [guid]::NewGuid().ToString('N'))
$fixtureFull = [System.IO.Path]::GetFullPath($fixtureRoot)
if (-not $fixtureFull.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fixtureFull -eq $tempRoot) {
  throw 'The fixture path escaped the intended temporary directory.'
}

try {
  $package = Join-Path $fixtureFull 'package'
  $dataRoot = Join-Path $fixtureFull 'data'
  $runtime = Join-Path $package 'runtime'
  $dist = Join-Path $package 'app\dist'
  $device = Join-Path $dataRoot 'device'
  $operator = Join-Path $dataRoot 'operator'
  foreach ($directory in @($runtime, $dist, $device, $operator)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $fixtureLauncher = Join-Path $package 'Start FetanAgent One-Job Operator.ps1'
  Copy-Item -LiteralPath $LauncherPath -Destination $fixtureLauncher
  $files = @(
    (Join-Path $runtime 'node.exe'),
    (Join-Path $dist 'one-job-operator-cli.js'),
    (Join-Path $device 'companion-primary.enrollment.json'),
    (Join-Path $fixtureFull 'archive.zip'),
    (Join-Path $fixtureFull 'archive.zip.sha256'),
    (Join-Path $fixtureFull 'verify.ps1'),
    (Join-Path $fixtureFull 'powershell.exe'),
    (Join-Path $fixtureFull 'observe.ps1'),
    (Join-Path $fixtureFull 'identity'),
    (Join-Path $fixtureFull 'known-hosts')
  )
  foreach ($path in $files) {
    [System.IO.File]::WriteAllText($path, 'fixture')
  }
  [System.IO.File]::WriteAllText((Join-Path $package 'RELEASE_SHA'), ('a' * 40))

  $document = [ordered]@{
    version = 2
    releaseTag = 'windows-companion-vfixture'
    archivePath = $files[3]
    checksumPath = $files[4]
    verifierScriptPath = $files[5]
    powershellExecutable = $files[6]
    processVerifierScriptPath = $files[7]
    connection = [ordered]@{
      identityFile = $files[8]
      knownHostsFile = $files[9]
      remoteHostIpv4 = '192.0.2.1'
      remoteUser = 'fetanagent-operator'
      remoteSshPort = 22
      remoteLoopbackPort = 743
    }
  }
  $documentPath = Join-Path $operator 'one-job-launch.json'
  [System.IO.File]::WriteAllText($documentPath, ($document | ConvertTo-Json -Depth 4))

  $result = @(& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
    -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $fixtureLauncher -CheckOnly -CheckDataRoot $dataRoot 2>&1)
  if ($LASTEXITCODE -ne 0 -or
      @($result).Count -ne 1 -or
      [string]$result[0] -ne 'Local one-job inputs are present. No connection or deposit was started.') {
    throw 'The local check-only path did not pass without invoking a runtime.'
  }

  $document.extra = 'unexpected'
  [System.IO.File]::WriteAllText($documentPath, ($document | ConvertTo-Json -Depth 4))
  $priorErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $failure = @(& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
      -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File $fixtureLauncher -CheckOnly -CheckDataRoot $dataRoot 2>&1)
  } finally {
    $ErrorActionPreference = $priorErrorAction
  }
  if ($LASTEXITCODE -ne 1 -or
      ((@($failure) -join ' ') -notmatch 'one-job operator is not ready or stopped') -or
      ((@($failure) -join ' ') -match 'unexpected|192\.0\.2\.1')) {
    throw 'The malformed local document did not fail with a redacted result.'
  }

  $priorErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $overrideFailure = @(& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
      -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File $fixtureLauncher -CheckDataRoot $dataRoot 2>&1)
  } finally {
    $ErrorActionPreference = $priorErrorAction
  }
  if ($LASTEXITCODE -ne 1 -or
      ((@($overrideFailure) -join ' ') -notmatch 'one-job operator is not ready or stopped')) {
    throw 'An alternate data root was accepted for a live one-job session.'
  }

  foreach ($checkArguments in @(
    @('-CheckOnly', '-PreviewConnection', '-CheckDataRoot', $dataRoot),
    @('-PreviewConnection', '-CheckDataRoot', $dataRoot)
  )) {
    $priorErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $previewFailure = @(& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $fixtureLauncher @checkArguments 2>&1)
    } finally {
      $ErrorActionPreference = $priorErrorAction
    }
    if ($LASTEXITCODE -ne 1 -or
        ((@($previewFailure) -join ' ') -notmatch 'one-job operator is not ready or stopped')) {
      throw 'Connection preview accepted conflicting modes or an alternate paired data root.'
    }
  }
} finally {
  if ((Test-Path -LiteralPath $fixtureFull -PathType Container) -and
      $fixtureFull.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      $fixtureFull -ne $tempRoot) {
    Remove-Item -LiteralPath $fixtureFull -Recurse -Force
  }
}

Write-Output 'WINDOWS_ONE_JOB_LAUNCH_LOCAL_CHECK_OK'
