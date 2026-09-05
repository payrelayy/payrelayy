import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildTelebirrAssignmentRuntimeManifest } from './build-telebirr-assignment-runtime-manifest.mjs';

const ids = {
  pilot: '11111111-1111-4111-8111-111111111111',
  profile: '22222222-2222-4222-8222-222222222222',
  receiver: '33333333-3333-4333-8333-333333333333',
  signer: '44444444-4444-4444-8444-444444444444',
};
const environment = {
  TELEBIRR_ASSIGNMENT_SIGNER_ID: ids.signer,
  TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID: 'assignment-key-v1',
  TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256: `sha256:${'a'.repeat(64)}`,
  TELEBIRR_REFERENCE_OPENING_KEY_ID: `sha256:${'b'.repeat(64)}`,
};
const input = {
  schemaVersion: 1,
  pilotRevisionId: ids.pilot,
  receiverRevisionId: ids.receiver,
  receiverProfileId: ids.profile,
  receiverProfileDigest: `sha256:${'c'.repeat(64)}`,
  receiverConfigurationDigest: `sha256:${'d'.repeat(64)}`,
  receiverNameNormalizerVersion: 'telebirr-credited-party-name-normalizer-v1',
  expectedReceiverNameDigest:
    'sha256:a09b907cb46c3c6c99e89854541fbef7727ebe04aea9fa8ddcf289b6d8ee77f1',
  receiverAccountHolderNameSnapshot: '  PILOT\tReceiver  ',
  assignmentSignerId: ids.signer,
  assignmentSignerKeyId: environment.TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID,
  assignmentSignerPublicKeySpkiSha256: environment.TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256,
};

const manifest = buildTelebirrAssignmentRuntimeManifest(input, environment);
assert.deepEqual(manifest, {
  contractVersion: 1,
  providerCode: 'telebirr',
  assignmentSignerId: ids.signer,
  assignmentSignerKeyId: environment.TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID,
  assignmentSignerPublicKeySpkiSha256: environment.TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_SHA256,
  referenceOpeningKeyId: environment.TELEBIRR_REFERENCE_OPENING_KEY_ID,
  receiverManifest: {
    contractVersion: 1,
    providerCode: 'telebirr',
    pilotRevisionId: ids.pilot,
    receiverRevisionId: ids.receiver,
    receiverProfileId: ids.profile,
    receiverProfileDigest: input.receiverProfileDigest,
    receiverConfigurationDigest: input.receiverConfigurationDigest,
    receiverNameNormalizerVersion: 'telebirr-credited-party-name-normalizer-v1',
    expectedReceiverNameNormalized: 'pilot receiver',
    expectedReceiverNameDigest: input.expectedReceiverNameDigest,
  },
});

const scratch = mkdtempSync(join(tmpdir(), 'fetanagent-assignment-runtime-manifest-'));
try {
  const inputPath = join(scratch, 'input.json');
  const outputPath = join(scratch, 'manifest.json');
  const builderPath = fileURLToPath(
    new URL('./build-telebirr-assignment-runtime-manifest.mjs', import.meta.url),
  );
  writeFileSync(inputPath, JSON.stringify(input), { encoding: 'utf8', mode: 0o600 });
  const result = spawnSync(process.execPath, [builderPath, inputPath, outputPath], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bytes = readFileSync(outputPath);
  assert.equal(bytes.includes(0x0a), false, 'runtime manifest must not contain LF bytes');
  assert.equal(bytes.includes(0x0d), false, 'runtime manifest must not contain CR bytes');
  assert.equal(
    bytes.toString('utf8'),
    JSON.stringify(manifest),
    'runtime manifest must be exact canonical JSON with no line terminator',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

for (const changed of [
  { ...input, receiverAccountHolderNameSnapshot: 'another receiver' },
  { ...input, assignmentSignerId: '55555555-5555-4555-8555-555555555555' },
  { ...input, unexpected: true },
]) {
  assert.throws(
    () => buildTelebirrAssignmentRuntimeManifest(changed, environment),
    /runtime manifest input is unavailable/u,
  );
}

console.log(
  'TeleBirr assignment runtime manifest verified: exact armed-pilot bindings, canonical no-newline bytes, independent name normalization, and no permissive fields.',
);
