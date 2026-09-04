[CmdletBinding()]
param(
  [Parameter()]
  [ValidatePattern('^[A-Za-z0-9_-]{1,64}$')]
  [string]$EnvironmentName = 'staging'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$secretNames = @(
  'COMPANION_SERVER_SIGNER_PKCS8_BASE64',
  'COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD'
)

$variableNames = @(
  'COMPANION_SERVER_SIGNER_ID',
  'COMPANION_SERVER_SIGNER_KEY_ID',
  'COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64',
  'COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64URL',
  'COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256',
  'COMPANION_SERVER_SIGNER_VALID_FROM',
  'COMPANION_SERVER_SIGNER_VALID_UNTIL',
  'COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V1_BASE64'
)

function Invoke-Gh {
  param([Parameter(Mandatory)][string[]]$Arguments)

  & gh @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI operation failed: gh $($Arguments[0])"
  }
}

function Set-EnvironmentSecret {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value
  )

  $Value | & gh secret set $Name --env $EnvironmentName
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set encrypted GitHub environment secret $Name."
  }
}

function Set-EnvironmentVariable {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value
  )

  Invoke-Gh -Arguments @('variable', 'set', $Name, '--env', $EnvironmentName, '--body', $Value)
}

function ConvertTo-Base64Url {
  param([Parameter(Mandatory)][byte[]]$Bytes)

  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-Sha256Identifier {
  param([Parameter(Mandatory)][byte[]]$Bytes)

  return 'sha256:' + [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData($Bytes)
  ).ToLowerInvariant()
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI is unavailable.'
}

$existingSecrets = @(
  (Invoke-Gh -Arguments @('secret', 'list', '--env', $EnvironmentName, '--json', 'name')) |
    ConvertFrom-Json | ForEach-Object { $_.name }
)
$existingVariables = @(
  (Invoke-Gh -Arguments @('variable', 'list', '--env', $EnvironmentName, '--json', 'name')) |
    ConvertFrom-Json | ForEach-Object { $_.name }
)
$conflicts = @(
  $secretNames | Where-Object { $_ -in $existingSecrets }
  $variableNames | Where-Object { $_ -in $existingVariables }
)
if ($conflicts.Count -ne 0) {
  throw "Companion operational material already exists: $($conflicts -join ', '). Rotation requires a separate reviewed operation."
}

$installedSecrets = [Collections.Generic.List[string]]::new()
$installedVariables = [Collections.Generic.List[string]]::new()
$buffers = [Collections.Generic.List[byte[]]]::new()

try {
  $key = [Security.Cryptography.ECDsa]::Create(
    [Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
  )
  try {
    $privateKey = $key.ExportPkcs8PrivateKey()
    $publicKey = $key.ExportSubjectPublicKeyInfo()
  }
  finally {
    $key.Dispose()
  }
  $buffers.Add($privateKey)
  $buffers.Add($publicKey)
  if ($publicKey.Length -ne 91) {
    throw 'The generated companion P-256 SPKI encoding was not canonical.'
  }

  $runtimePasswordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $buffers.Add($runtimePasswordBytes)
  $signerId = [Guid]::NewGuid().ToString()
  $signerKeyId = 'companion-server-staging-v1'
  $publicKeyDigest = Get-Sha256Identifier -Bytes $publicKey
  $validFrom = [DateTimeOffset]::UtcNow.AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $validUntil = [DateTimeOffset]::UtcNow.AddYears(2).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $manifest = [ordered]@{
    contractVersion = 1
    deploymentTarget = 'staging'
    pairingOnly = $true
    moneyMovementAllowed = $false
    serverSignerId = $signerId
    serverSignerKeyId = $signerKeyId
    serverSignerPublicKeySpkiSha256 = $publicKeyDigest
  } | ConvertTo-Json -Compress
  $manifestBytes = [Text.Encoding]::UTF8.GetBytes($manifest)
  $buffers.Add($manifestBytes)

  $secretValues = [ordered]@{
    COMPANION_SERVER_SIGNER_PKCS8_BASE64 = [Convert]::ToBase64String($privateKey)
    COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD = [Convert]::ToHexString(
      $runtimePasswordBytes
    ).ToLowerInvariant()
  }
  $variableValues = [ordered]@{
    COMPANION_SERVER_SIGNER_ID = $signerId
    COMPANION_SERVER_SIGNER_KEY_ID = $signerKeyId
    COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64 = [Convert]::ToBase64String($publicKey)
    COMPANION_SERVER_SIGNER_PUBLIC_SPKI_BASE64URL = ConvertTo-Base64Url -Bytes $publicKey
    COMPANION_SERVER_SIGNER_PUBLIC_SPKI_SHA256 = $publicKeyDigest
    COMPANION_SERVER_SIGNER_VALID_FROM = $validFrom
    COMPANION_SERVER_SIGNER_VALID_UNTIL = $validUntil
    COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_V1_BASE64 = [Convert]::ToBase64String($manifestBytes)
  }

  foreach ($entry in $secretValues.GetEnumerator()) {
    Set-EnvironmentSecret -Name $entry.Key -Value $entry.Value
    $installedSecrets.Add($entry.Key)
  }
  foreach ($entry in $variableValues.GetEnumerator()) {
    Set-EnvironmentVariable -Name $entry.Key -Value $entry.Value
    $installedVariables.Add($entry.Key)
  }

  [pscustomobject]@{
    signerKeyId = $signerKeyId
    signerPublicKeySpkiSha256 = $publicKeyDigest
    encryptedSecretsInstalled = $installedSecrets.Count
    publicVariablesInstalled = $installedVariables.Count
    calendarShutdown = $false
    moneyMoved = $false
  } | ConvertTo-Json -Compress
}
catch {
  foreach ($name in $installedVariables) {
    & gh variable delete $name --env $EnvironmentName 2>$null
  }
  foreach ($name in $installedSecrets) {
    & gh secret delete $name --env $EnvironmentName 2>$null
  }
  throw
}
finally {
  foreach ($buffer in $buffers) {
    if ($null -ne $buffer -and $buffer.Length -gt 0) {
      [Array]::Clear($buffer, 0, $buffer.Length)
    }
  }
  $privateKey = $null
  $runtimePasswordBytes = $null
}
