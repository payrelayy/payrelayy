import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { checkCbeBirrWorkerKeyProvisioning } from '../../packages/cbe-birr-worker-key-provisioning-check/dist/index.js';

const HEX_KEY = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CHILD_DOMAIN = 'fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr';

function unavailable() {
  throw new Error('CBE reference worker delivery is unavailable.');
}

function fingerprint(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalLine(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

/**
 * Derive only the CBE proof-opening child on an ephemeral protected runner. The API masters never
 * enter the delivered bundle. Callers must wipe the returned payload after SSH stdin closes.
 */
export function prepareCbeReferenceWorkerDelivery({
  rootProfileJson,
  encryptionMasterSecret,
  fingerprintMasterSecret,
}) {
  let encryptionMaster;
  let fingerprintMaster;
  let child;
  let payload;
  try {
    if (
      typeof rootProfileJson !== 'string' ||
      rootProfileJson.length > 4096 ||
      typeof encryptionMasterSecret !== 'string' ||
      !HEX_KEY.test(encryptionMasterSecret) ||
      typeof fingerprintMasterSecret !== 'string' ||
      !HEX_KEY.test(fingerprintMasterSecret) ||
      encryptionMasterSecret === fingerprintMasterSecret
    )
      unavailable();
    const root = JSON.parse(rootProfileJson);
    if (
      typeof root !== 'object' ||
      root === null ||
      Array.isArray(root) ||
      Object.keys(root).sort().join(',') !==
        'encryptionMasterFingerprint,fingerprintMasterFingerprint,version' ||
      root.version !== 2 ||
      typeof root.encryptionMasterFingerprint !== 'string' ||
      !DIGEST.test(root.encryptionMasterFingerprint) ||
      typeof root.fingerprintMasterFingerprint !== 'string' ||
      !DIGEST.test(root.fingerprintMasterFingerprint) ||
      root.encryptionMasterFingerprint === root.fingerprintMasterFingerprint
    )
      unavailable();

    encryptionMaster = Buffer.from(encryptionMasterSecret, 'hex');
    fingerprintMaster = Buffer.from(fingerprintMasterSecret, 'hex');
    const actualEncryptionId = Buffer.from(fingerprint(encryptionMaster).slice(7), 'hex');
    const actualFingerprintId = Buffer.from(fingerprint(fingerprintMaster).slice(7), 'hex');
    const expectedEncryptionId = Buffer.from(root.encryptionMasterFingerprint.slice(7), 'hex');
    const expectedFingerprintId = Buffer.from(root.fingerprintMasterFingerprint.slice(7), 'hex');
    try {
      if (
        !timingSafeEqual(actualEncryptionId, expectedEncryptionId) ||
        !timingSafeEqual(actualFingerprintId, expectedFingerprintId)
      )
        unavailable();
    } finally {
      actualEncryptionId.fill(0);
      actualFingerprintId.fill(0);
      expectedEncryptionId.fill(0);
      expectedFingerprintId.fill(0);
    }

    child = createHmac('sha256', encryptionMaster).update(CHILD_DOMAIN).digest();
    const keyId = fingerprint(child);
    const rootProfile = {
      encryptionMasterFingerprint: root.encryptionMasterFingerprint,
      fingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
      version: 2,
    };
    const workerProfile = {
      version: 1,
      providerCode: 'cbe_birr',
      purpose: 'deposit-proof-reference-opening',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      ciphertextProfileVersion: 2,
      encryptionKeyVersion: 2,
      keyId,
      rootEncryptionMasterFingerprint: root.encryptionMasterFingerprint,
      rootFingerprintMasterFingerprint: root.fingerprintMasterFingerprint,
    };
    const workerKey = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      purpose: 'deposit-proof-reference-opening',
      keyVersion: 2,
      keyId,
      keyHex: child.toString('hex'),
    };
    checkCbeBirrWorkerKeyProvisioning({
      approvedRootProfile: rootProfile,
      producerSecrets: { encryptionMasterSecret, fingerprintMasterSecret },
      workerKey,
      workerProfile,
    });
    const rootBytes = canonicalLine(rootProfile);
    const profileBytes = canonicalLine(workerProfile);
    const keyBytes = canonicalLine(workerKey);
    let pins;
    try {
      pins = {
        deploymentTarget: 'production',
        rootProfileSha256: digest(rootBytes),
        workerProfileSha256: digest(profileBytes),
        workerKeyId: keyId,
      };
      payload = Buffer.concat([rootBytes, profileBytes, keyBytes]);
    } finally {
      rootBytes.fill(0);
      profileBytes.fill(0);
      keyBytes.fill(0);
    }
    if (payload.byteLength > 12288) unavailable();
    const planDigest = digest(Buffer.from(JSON.stringify(pins), 'utf8'));
    return { pins: Object.freeze(pins), planDigest, payload };
  } catch {
    payload?.fill(0);
    unavailable();
  } finally {
    encryptionMaster?.fill(0);
    fingerprintMaster?.fill(0);
    child?.fill(0);
  }
}
