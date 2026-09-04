[CmdletBinding()]
param(
  [Parameter()]
  [ValidatePattern('^[A-Za-z0-9_-]{1,64}$')]
  [string]$EnvironmentName = 'staging',

  [Parameter()]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$KeytoolPath = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$secretNames = @(
  'TELEBIRR_ASSIGNMENT_SIGNER_PKCS8_BASE64',
  'TELEBIRR_BRIDGE_SERVER_SIGNER_PKCS8_BASE64',
  'TELEBIRR_REFERENCE_OPENING_KEY_V1_BASE64',
  'TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD',
  'TELEBIRR_DEVICE_STATE_RUNTIME_PASSWORD',
  'ANDROID_TELEBIRR_SIGNING_KEYSTORE_BASE64',
  'ANDROID_TELEBIRR_SIGNING_STORE_PASSWORD',
  'ANDROID_TELEBIRR_SIGNING_KEY_PASSWORD'
)

$variableNames = @(
  'TELEBIRR_ASSIGNMENT_SIGNER_ID',
  'TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID',
  'TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_BASE64',
  'TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256',
  'TELEBIRR_ASSIGNMENT_SIGNER_VALID_FROM',
  'TELEBIRR_ASSIGNMENT_SIGNER_VALID_UNTIL',
  'TELEBIRR_BRIDGE_SERVER_SIGNER_KEY_ID',
  'TELEBIRR_BRIDGE_SERVER_SIGNER_PUBLIC_SPKI_BASE64',
  'TELEBIRR_BRIDGE_SERVER_SIGNER_PUBLIC_SPKI_SHA256',
  'TELEBIRR_REFERENCE_OPENING_KEY_ID',
  'TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_V1_BASE64',
  'ANDROID_TELEBIRR_SIGNING_KEY_ALIAS',
  'ANDROID_TELEBIRR_SIGNING_CERT_SHA256'
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

function New-P256KeyMaterial {
  $key = [Security.Cryptography.ECDsa]::Create(
    [Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
  )
  try {
    $privateKey = $key.ExportPkcs8PrivateKey()
    $publicKey = $key.ExportSubjectPublicKeyInfo()
    if ($publicKey.Length -ne 91) {
      throw 'The generated P-256 SPKI encoding was not canonical.'
    }
    return [pscustomobject]@{
      PrivateKey = $privateKey
      PublicKey = $publicKey
    }
  }
  finally {
    $key.Dispose()
  }
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
  throw "Operational TeleBirr material already exists: $($conflicts -join ', '). Rotation requires a separate reviewed operation."
}

$temporaryName = 'fetanagent-telebirr-operational-' + [Guid]::NewGuid().ToString('N')
$systemTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$temporaryRoot = Join-Path $systemTemporaryRoot $temporaryName
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
$temporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
if (
  -not $temporaryRoot.StartsWith(
    $systemTemporaryRoot + '\',
    [StringComparison]::OrdinalIgnoreCase
  ) -or
  (Split-Path -Leaf $temporaryRoot) -ne $temporaryName
) {
  throw 'The operational-key temporary path failed validation.'
}

$installedSecrets = [Collections.Generic.List[string]]::new()
$installedVariables = [Collections.Generic.List[string]]::new()
$buffers = [Collections.Generic.List[byte[]]]::new()
$androidStorePassword = $null

try {
  $assignment = New-P256KeyMaterial
  $bridge = New-P256KeyMaterial
  $buffers.Add($assignment.PrivateKey)
  $buffers.Add($assignment.PublicKey)
  $buffers.Add($bridge.PrivateKey)
  $buffers.Add($bridge.PublicKey)

  $openingKey = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $buffers.Add($openingKey)
  $openingKeyId = Get-Sha256Identifier -Bytes $openingKey
  $openingDocument = [ordered]@{
    contractVersion = 1
    providerCode = 'telebirr'
    purpose = 'private_live_reference_opening'
    keyVersion = 1
    keyId = $openingKeyId
    keyHex = [Convert]::ToHexString($openingKey).ToLowerInvariant()
  } | ConvertTo-Json -Compress
  $openingDocumentBytes = [Text.Encoding]::UTF8.GetBytes($openingDocument)
  $buffers.Add($openingDocumentBytes)

  $androidAlias = 'fetanagent-telebirr-verifier-v1'
  $androidStorePassword = [Convert]::ToHexString(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  ).ToLowerInvariant()
  $androidKeystorePath = Join-Path $temporaryRoot 'fetanagent-telebirr-verifier-v1.p12'
  & $KeytoolPath -genkeypair `
    -keystore $androidKeystorePath `
    -storetype PKCS12 `
    -alias $androidAlias `
    -keyalg RSA `
    -keysize 3072 `
    -sigalg SHA256withRSA `
    -validity 3650 `
    -dname 'CN=FetanAgent TeleBirr Verifier, O=FetanAgent, C=ET' `
    -storepass $androidStorePassword `
    -keypass $androidStorePassword `
    -noprompt 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $androidKeystorePath -PathType Leaf)) {
    throw 'Android release-keystore generation failed.'
  }

  $androidCertificatePath = Join-Path $temporaryRoot 'android-signing-certificate.der'
  & $KeytoolPath -exportcert `
    -keystore $androidKeystorePath `
    -storetype PKCS12 `
    -alias $androidAlias `
    -storepass $androidStorePassword `
    -file $androidCertificatePath 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $androidCertificatePath -PathType Leaf)) {
    throw 'Android signing-certificate export failed.'
  }

  $androidKeystore = [IO.File]::ReadAllBytes($androidKeystorePath)
  $androidCertificate = [IO.File]::ReadAllBytes($androidCertificatePath)
  $buffers.Add($androidKeystore)
  $buffers.Add($androidCertificate)

  $assignmentKeyId = 'telebirr-assignment-staging-v1'
  $bridgeKeyId = 'telebirr-bridge-staging-v1'
  $assignmentDigest = Get-Sha256Identifier -Bytes $assignment.PublicKey
  $bridgeDigest = Get-Sha256Identifier -Bytes $bridge.PublicKey
  $androidCertificateDigest = Get-Sha256Identifier -Bytes $androidCertificate
  $assignmentSignerId = [Guid]::NewGuid().ToString()
  $validFrom = [DateTimeOffset]::UtcNow.AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $validUntil = [DateTimeOffset]::UtcNow.AddYears(2).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $bridgeManifest = [ordered]@{
    contractVersion = 1
    providerCode = 'telebirr'
    serverSignerKeyId = $bridgeKeyId
    serverSigningPublicKeySpkiSha256 = $bridgeDigest
    assignmentSigningPublicKeySpkiSha256 = $assignmentDigest
  } | ConvertTo-Json -Compress

  $secretValues = [ordered]@{
    TELEBIRR_ASSIGNMENT_SIGNER_PKCS8_BASE64 = [Convert]::ToBase64String($assignment.PrivateKey)
    TELEBIRR_BRIDGE_SERVER_SIGNER_PKCS8_BASE64 = [Convert]::ToBase64String($bridge.PrivateKey)
    TELEBIRR_REFERENCE_OPENING_KEY_V1_BASE64 = [Convert]::ToBase64String($openingDocumentBytes)
    TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD = [Convert]::ToHexString(
      [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    ).ToLowerInvariant()
    TELEBIRR_DEVICE_STATE_RUNTIME_PASSWORD = [Convert]::ToHexString(
      [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    ).ToLowerInvariant()
    ANDROID_TELEBIRR_SIGNING_KEYSTORE_BASE64 = [Convert]::ToBase64String($androidKeystore)
    ANDROID_TELEBIRR_SIGNING_STORE_PASSWORD = $androidStorePassword
    ANDROID_TELEBIRR_SIGNING_KEY_PASSWORD = $androidStorePassword
  }
  $variableValues = [ordered]@{
    TELEBIRR_ASSIGNMENT_SIGNER_ID = $assignmentSignerId
    TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID = $assignmentKeyId
    TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_BASE64 = [Convert]::ToBase64String($assignment.PublicKey)
    TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256 = $assignmentDigest
    TELEBIRR_ASSIGNMENT_SIGNER_VALID_FROM = $validFrom
    TELEBIRR_ASSIGNMENT_SIGNER_VALID_UNTIL = $validUntil
    TELEBIRR_BRIDGE_SERVER_SIGNER_KEY_ID = $bridgeKeyId
    TELEBIRR_BRIDGE_SERVER_SIGNER_PUBLIC_SPKI_BASE64 = [Convert]::ToBase64String($bridge.PublicKey)
    TELEBIRR_BRIDGE_SERVER_SIGNER_PUBLIC_SPKI_SHA256 = $bridgeDigest
    TELEBIRR_REFERENCE_OPENING_KEY_ID = $openingKeyId
    TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_V1_BASE64 = [Convert]::ToBase64String(
      [Text.Encoding]::UTF8.GetBytes($bridgeManifest)
    )
    ANDROID_TELEBIRR_SIGNING_KEY_ALIAS = $androidAlias
    ANDROID_TELEBIRR_SIGNING_CERT_SHA256 = $androidCertificateDigest
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
    assignmentSignerKeyId = $assignmentKeyId
    assignmentSignerPublicKeySpkiSha256 = $assignmentDigest
    bridgeServerSignerKeyId = $bridgeKeyId
    bridgeServerSignerPublicKeySpkiSha256 = $bridgeDigest
    androidSigningCertificateSha256 = $androidCertificateDigest
    referenceOpeningKeyId = $openingKeyId
    encryptedSecretsInstalled = $installedSecrets.Count
    publicVariablesInstalled = $installedVariables.Count
    temporaryDirectoryRemoved = $true
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
  $androidStorePassword = $null

  if (Test-Path -LiteralPath $temporaryRoot) {
    $finalTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
    if (
      -not $finalTemporaryRoot.StartsWith(
        $systemTemporaryRoot + '\',
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      (Split-Path -Leaf $finalTemporaryRoot) -ne $temporaryName
    ) {
      throw 'Refusing to remove an unverified temporary path.'
    }
    Remove-Item -LiteralPath $finalTemporaryRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $temporaryRoot) {
    throw 'The operational-key temporary directory was not removed.'
  }
}
