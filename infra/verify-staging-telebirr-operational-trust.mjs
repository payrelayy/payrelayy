import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const trustWorkflow = readFileSync(
  resolve(root, '.github/workflows/staging-telebirr-operational-keys.yml'),
  'utf8',
);
const androidWorkflow = readFileSync(
  resolve(root, '.github/workflows/android-telebirr-operational-release.yml'),
  'utf8',
);
const provisionSql = readFileSync(
  resolve(root, 'infra/sql/staging-telebirr-operational-signer-provision.sql'),
  'utf8',
);
const inspectSql = readFileSync(
  resolve(root, 'infra/sql/staging-telebirr-operational-signer-inspect.sql'),
  'utf8',
);
const androidBuild = readFileSync(
  resolve(root, 'android/telebirr-verifier/app/build.gradle.kts'),
  'utf8',
);
const localProvisioner = readFileSync(
  resolve(root, 'infra/operations/provision-telebirr-operational-secrets.ps1'),
  'utf8',
);

for (const workflow of [trustWorkflow, androidWorkflow]) {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(
    workflow,
    /pull_request:|pull_request_target:|push:|schedule:|workflow_call:/,
  );
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA.*GITHUB_SHA/s);
  assert.doesNotMatch(
    workflow,
    /SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE|service_role|repository_dispatch/i,
  );
}

assert.match(trustWorkflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(trustWorkflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(trustWorkflow, /provision-trust-only-no-pilot/);
assert.match(trustWorkflow, /openssl pkey -inform DER/g);
assert.match(trustWorkflow, /cmp --silent/);
assert.match(trustWorkflow, /private_live_reference_opening/);
assert.match(trustWorkflow, /PGSSLMODE: verify-full/);
assert.match(trustWorkflow, /PGSSLROOTCERT:/);
assert.match(trustWorkflow, /staging-telebirr-operational-signer-inspect\.sql/);
assert.match(trustWorkflow, /staging-telebirr-operational-signer-provision\.sql/);
assert.match(trustWorkflow, /\.financialFeatures == "disabled"/);
assert.match(trustWorkflow, /\.openPilot == "absent"/);
assert.deepEqual(
  [
    ...new Set(
      [...trustWorkflow.matchAll(/secrets\.([A-Z0-9_]+)/g)]
        .map((match) => match[1])
        .filter(Boolean),
    ),
  ].sort(),
  [
    'SUPABASE_CA_CERTIFICATE_PEM',
    'SUPABASE_DB_PASSWORD',
    'TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD',
    'TELEBIRR_ASSIGNMENT_SIGNER_PKCS8_BASE64',
    'TELEBIRR_BRIDGE_SERVER_SIGNER_PKCS8_BASE64',
    'TELEBIRR_DEVICE_STATE_RUNTIME_PASSWORD',
    'TELEBIRR_REFERENCE_OPENING_KEY_V1_BASE64',
  ],
);

assert.match(provisionSql, /begin transaction isolation level serializable;/);
assert.match(provisionSql, /pg_catalog\.pg_advisory_xact_lock/);
assert.match(provisionSql, /for update/);
assert.match(provisionSql, /count\(\*\) = 7/);
assert.match(provisionSql, /pilot\.status in \('draft', 'armed'\)/);
assert.match(provisionSql, /select count\(\*\) = 0 as no_open_pilot/);
assert.match(provisionSql, /insert into app\.private_live_telebirr_assignment_signers/);
assert.match(provisionSql, /ecdsa-p256-sha256/);
assert.match(provisionSql, /ieee-p1363-base64url/);
assert.match(provisionSql, /exact_safe_replay/);
assert.match(provisionSql, /revocation\.assignment_signer_id is null/);
assert.match(provisionSql, /'financialFeatures', 'disabled'/);
assert.match(provisionSql, /'openPilot', 'absent'/);
assert.match(provisionSql, /commit;/);
assert.equal(
  (provisionSql.match(/^\s*insert into /gim) ?? []).length,
  1,
  'Trust provisioning may insert only the one immutable assignment-signer row.',
);
assert.doesNotMatch(
  provisionSql,
  /^\s*(?:update|delete|truncate|alter|create|drop|grant|revoke)\b/im,
);
assert.doesNotMatch(provisionSql, /insert into app\.private_live_deposit_pilot/i);
assert.doesNotMatch(provisionSql, /insert into app\.feature_switches/i);

assert.match(inspectSql, /begin transaction isolation level serializable read only;/);
assert.match(inspectSql, /count\(\*\) = 7/);
assert.match(inspectSql, /pilot\.status in \('draft', 'armed'\)/);
assert.match(inspectSql, /revocation\.assignment_signer_id is null/);
assert.match(inspectSql, /rollback;/);
assert.doesNotMatch(
  inspectSql,
  /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|commit)\b/im,
);

assert.match(androidWorkflow, /build-pairing-only-no-money/);
assert.match(androidWorkflow, /fetanagentVerifierRuntimeMode=pairing_only/);
assert.doesNotMatch(androidWorkflow, /fetanagentVerifierRuntimeMode=evidence_only/);
assert.match(androidWorkflow, /ANDROID_TELEBIRR_SIGNING_KEYSTORE_BASE64/);
assert.match(androidWorkflow, /FETANAGENT_ANDROID_SIGNING_STORE_PASSWORD/);
assert.match(androidWorkflow, /FETANAGENT_ANDROID_SIGNING_KEY_PASSWORD/);
assert.match(androidWorkflow, /apksigner verify --verbose --print-certs/);
assert.match(androidWorkflow, /Verified using v2 scheme .*: true/);
assert.match(androidWorkflow, /retention-days: 14/);
assert.match(androidWorkflow, /Assignment polling and money movement are disabled/);

assert.match(androidBuild, /fetanagentVerifierRuntimeMode"\)\.orNull \?: "inert"/);
assert.match(androidBuild, /fetanagentVerifierSigningStoreFile/);
assert.match(androidBuild, /fetanagentVerifierSigningCertSha256/);
assert.match(androidBuild, /KeyStore\.getInstance\("PKCS12"\)/);
assert.match(androidBuild, /certificate\.checkValidity\(\)/);
assert.match(androidBuild, /Signature\.getInstance\("SHA256withRSA"\)/g);
assert.match(androidBuild, /verifier\.verify\(probeSignature\)/);
assert.match(androidBuild, /enableV1Signing = false/);
assert.match(androidBuild, /enableV2Signing = true/);
assert.match(androidBuild, /operationalSigning\?\.let/);

assert.match(localProvisioner, /Operational TeleBirr material already exists/);
assert.match(localProvisioner, /Rotation requires a separate reviewed operation/);
assert.match(localProvisioner, /New-P256KeyMaterial/g);
assert.match(localProvisioner, /Remove-Item -LiteralPath \$finalTemporaryRoot -Recurse -Force/);
assert.doesNotMatch(
  localProvisioner,
  /gh secret set [A-Z0-9_]+ --body|Write-(?:Host|Output).*PRIVATE|ConvertTo-SecureString -AsPlainText/i,
);

console.log(
  'staging TeleBirr operational trust verified: manual exact-target trust-only provisioning and signed pairing-only Android release',
);
