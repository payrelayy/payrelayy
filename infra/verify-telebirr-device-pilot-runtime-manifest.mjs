import assert from 'node:assert/strict';

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
  'TeleBirr assignment runtime manifest verified: exact armed-pilot bindings, independent name normalization, and no permissive fields.',
);
