#requires -Version 7.0
param(
  [Parameter(Mandatory = $true)][string] $ReleaseTag,
  [Parameter(Mandatory = $true)][string] $ReleaseSha,
  [Parameter(Mandatory = $true)][string] $ArchivePath,
  [Parameter(Mandatory = $true)][string] $ChecksumPath,
  [Parameter(Mandatory = $true)][string] $InstallationRoot,
  [Parameter(Mandatory = $true)][string] $DataRoot,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^sha256:[0-9a-f]{64}$')]
  [string] $ExpectedArchiveSha256,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^sha256:[0-9a-f]{64}$')]
  [string] $ExpectedInstallationTreeSha256
)

$ErrorActionPreference = 'Stop'
$stage = 'preflight'
$child = $null
$pipe = $null
$proved = $false
$managedEnvironment = @(
  'FETANAGENT_COMPANION_DATA_ROOT',
  'FETANAGENT_COMPANION_RELEASE_SHA',
  'FETANAGENT_COMPANION_LAUNCH_CHALLENGE',
  'FETANAGENT_COMPANION_LAUNCH_PIPE',
  'FETANAGENT_COMPANION_INSTALLATION_TREE_SHA256',
  'FETANAGENT_COMPANION_LAUNCH_PROCESS_ID',
  'FETANAGENT_COMPANION_LAUNCH_STARTED_AT',
  'FETANAGENT_COMPANION_LAUNCH_OBSERVED_AT'
)
$previousEnvironment = @{}

function OrdinaryFile([string] $Path) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The verified companion launch input is not an ordinary file.'
  }
  return $item.FullName
}

function OrdinaryDirectory([string] $Path) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The verified companion launch input is not an ordinary directory.'
  }
  return $item.FullName
}

function Set-ManagedEnvironment([string] $Name, [string] $Value) {
  if (-not $previousEnvironment.ContainsKey($Name)) {
    $previousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

try {
  if (-not $IsWindows) { throw 'A Windows interactive session is required.' }
  if ([Environment]::GetEnvironmentVariable('INTERNAL_COMPANION_EXECUTION_V2_ENABLED', 'Process') -or
      [Environment]::GetEnvironmentVariable('FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID', 'Process')) {
    throw 'This local proof launcher cannot start financial execution.'
  }
  if ([Environment]::GetEnvironmentVariable('FETANAGENT_COMPANION_LAUNCH_CHALLENGE', 'Process') -or
      [Environment]::GetEnvironmentVariable('FETANAGENT_COMPANION_LAUNCH_PIPE', 'Process')) {
    throw 'A launch challenge is already present.'
  }

  $installation = OrdinaryDirectory $InstallationRoot
  $data = OrdinaryDirectory $DataRoot
  $node = OrdinaryFile (Join-Path $installation 'runtime/node.exe')
  $entry = OrdinaryFile (Join-Path $installation 'app/dist/index.js')
  $proofVerifier = OrdinaryFile (Join-Path $installation 'app/dist/launch-proof-verify-cli.js')
  $treeVerifier = OrdinaryFile (Join-Path $installation 'app/dist/installation-tree-cli.js')
  $treeMarker = OrdinaryFile (Join-Path $installation 'INSTALLATION_TREE_SHA256')
  OrdinaryFile (Join-Path $data 'device/companion-primary.enrollment.json') | Out-Null
  OrdinaryFile (Join-Path $data 'identity/kemerbet-primary.binding.json') | Out-Null

  & (Join-Path $PSScriptRoot 'verify-windows-companion-release-installation.ps1') `
    -ReleaseTag $ReleaseTag -ReleaseSha $ReleaseSha `
    -ArchivePath $ArchivePath -ChecksumPath $ChecksumPath `
    -InstallationRoot $installation `
    -ExpectedArchiveSha256 $ExpectedArchiveSha256 `
    -ExpectedInstallationTreeSha256 $ExpectedInstallationTreeSha256 *> $null
  if ($LASTEXITCODE -ne 0) { throw 'The independent archive and installation proof failed.' }
  if ([IO.File]::ReadAllText($treeMarker) -cne $ExpectedInstallationTreeSha256) {
    throw 'The installed tree marker differs from the prepared activation request.'
  }
  $expectedTree = $ExpectedInstallationTreeSha256

  # Do not start a second copy over an existing companion session. This operation
  # neither stops that session nor signs an execution handoff.
  $sameEntry = [regex]::Escape($entry)
  $existing = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match $sameEntry })
  if ($existing.Count -ne 0) { throw 'A companion process is already running.' }

  $stage = 'launch'
  $challengeBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $challenge = [Convert]::ToBase64String($challengeBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  [Array]::Clear($challengeBytes, 0, $challengeBytes.Length)
  $pipeName = "fetanagent-companion-launch-$([guid]::NewGuid().ToString('N'))"
  $pipePath = "\\.\pipe\$pipeName"
  $pipe = [IO.Pipes.NamedPipeServerStream]::new(
    $pipeName, [IO.Pipes.PipeDirection]::In, 1,
    [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous
  )
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_DATA_ROOT' $data
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_RELEASE_SHA' $ReleaseSha
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_LAUNCH_CHALLENGE' $challenge
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_LAUNCH_PIPE' $pipePath
  $child = Start-Process -FilePath $node -ArgumentList "`"$entry`"" `
    -WorkingDirectory $installation -PassThru -WindowStyle Hidden
  [Environment]::SetEnvironmentVariable('FETANAGENT_COMPANION_LAUNCH_CHALLENGE', $null, 'Process')
  [Environment]::SetEnvironmentVariable('FETANAGENT_COMPANION_LAUNCH_PIPE', $null, 'Process')

  $stage = 'handshake'
  $connect = $pipe.WaitForConnectionAsync()
  if (-not $connect.Wait([TimeSpan]::FromMinutes(10)) -or $child.HasExited) {
    throw 'The paired companion did not complete a live process handshake.'
  }
  $reader = [IO.StreamReader]::new($pipe, [Text.Encoding]::UTF8)
  $read = $reader.ReadLineAsync()
  if (-not $read.Wait([TimeSpan]::FromSeconds(10))) {
    throw 'The local launch proof was not delivered.'
  }
  $line = $read.Result
  if ([Text.Encoding]::UTF8.GetByteCount($line) -gt 2048) {
    throw 'The local launch proof is oversized.'
  }
  $proof = $line | ConvertFrom-Json -AsHashtable -Depth 8
  if ($null -eq $proof -or $null -eq $proof.body) {
    throw 'The local launch proof is invalid.'
  }

  $stage = 'process_check'
  $observed = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"
  if ($child.HasExited -or $null -eq $observed -or
      -not [string]::Equals($observed.ExecutablePath, $node, [StringComparison]::OrdinalIgnoreCase) -or
      $observed.CommandLine -notmatch $sameEntry -or
      $proof.body.processId -ne $child.Id) {
    throw 'The live process differs from the verified launch.'
  }
  $started = [DateTimeOffset]::Parse($proof.body.startedAt)
  $observedAt = [DateTimeOffset]::Parse($proof.body.observedAt)
  $osStarted = [DateTimeOffset]::new($child.StartTime.ToUniversalTime())
  $now = [DateTimeOffset]::UtcNow
  if ([Math]::Abs(($started - $osStarted).TotalSeconds) -gt 5 -or
      $observedAt -lt $started -or $observedAt -gt $now.AddSeconds(5) -or
      $observedAt -lt $now.AddMinutes(-2)) {
    throw 'The live process proof is not fresh.'
  }
  $measuredTree = (& $node $treeVerifier $installation).Trim()
  if ($LASTEXITCODE -ne 0 -or $measuredTree -cne $expectedTree) {
    throw 'The installed release changed during launch.'
  }

  $stage = 'signature_check'
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_LAUNCH_CHALLENGE' $challenge
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_INSTALLATION_TREE_SHA256' $expectedTree
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_LAUNCH_PROCESS_ID' ([string]$child.Id)
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_LAUNCH_STARTED_AT' ([string]$proof.body.startedAt)
  Set-ManagedEnvironment 'FETANAGENT_COMPANION_LAUNCH_OBSERVED_AT' ([string]$proof.body.observedAt)
  $verification = $line | & $node $proofVerifier 2>$null
  if ($LASTEXITCODE -ne 0 -or $verification -cne 'COMPANION_LOCAL_LAUNCH_PROOF_VERIFIED') {
    throw 'The paired certificate did not verify the process proof.'
  }
  if ($child.HasExited) { throw 'The proved companion process already stopped.' }
  $proved = $true
  'COMPANION_VERIFIED_LAUNCH_OBSERVED; this launch did not activate execution.'
} catch {
  throw "Verified companion launch failed at $stage; no execution was activated."
} finally {
  foreach ($name in $managedEnvironment) {
    if ($previousEnvironment.ContainsKey($name)) {
      [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
  }
  if ($null -ne $pipe) { $pipe.Dispose() }
  if (-not $proved -and $null -ne $child -and -not $child.HasExited) {
    # Only this script's newly created no-money child may be stopped on a failed proof.
    $child.Kill()
  }
}
