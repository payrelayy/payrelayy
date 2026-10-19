import { prepareCbeReferenceWorkerDelivery } from './cbe-reference-worker-delivery.mjs';

try {
  if (process.platform !== 'linux') throw new Error();
  const delivery = prepareCbeReferenceWorkerDelivery({
    rootProfileJson: process.env.DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON,
    encryptionMasterSecret: process.env.DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET,
    fingerprintMasterSecret: process.env.DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET,
  });
  try {
    process.stdout.write(`production_cbe_reference_key_pin_plan=${delivery.planDigest}\n`);
  } finally {
    delivery.payload.fill(0);
  }
} catch {
  process.stderr.write('Production CBE reference key plan is unavailable.\n');
  process.exitCode = 1;
}
