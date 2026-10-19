import { createHash, createHmac } from 'node:crypto';

import type { CbeBirrNoMoneyAssessment } from '@fetanagent/cbe-birr-authoritative-receipt-transport/no-money';
import type {
  CbeBirrReceiverLookupKeyCustodyConfig,
  CbeBirrWorkerKeyCustodyConfig,
} from '@fetanagent/cbe-birr-worker-key-custody';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';
import { deriveCbeBirrReceiverLookupChildKey } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-provisioning';
import { prepareCbeBirrReceiverRotation } from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-rotation';
import { describe, expect, it, vi } from 'vitest';

import {
  CbeBirrNoMoneyCandidateUnavailableError,
  READ_CBE_BIRR_NO_MONEY_CANDIDATE_SQL,
  assessCbeBirrCandidateNoMoney,
} from './cbe-birr-no-money-candidate.js';

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const proofId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const receiverRevisionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const rotationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reference = 'SYNTHCBE1234';
const phone = '251900000001';
const referenceMaster = 'a'.repeat(64);
const referenceFingerprintMaster = 'b'.repeat(64);
const receiverMaster = 'c'.repeat(64);
const receiverFingerprintMaster = 'd'.repeat(64);
const keyId = (hex: string) =>
  `sha256:${createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')}`;
const referenceChild = createHmac('sha256', Buffer.from(referenceMaster, 'hex'))
  .update('fetanagent:deposit-proof-reference:encryption-key:v2\nprovider:cbe_birr', 'utf8')
  .digest('hex');
const protectedReference = protectDepositProofReference(
  {
    provider: 'cbe_birr',
    reference,
    secrets: {
      encryptionSecret: referenceMaster,
      fingerprintSecret: referenceFingerprintMaster,
    },
  },
  { nonce: () => Buffer.from('000102030405060708090a0b', 'hex') },
);
const referenceCustody: CbeBirrWorkerKeyCustodyConfig = {
  enabled: true,
  deploymentTarget: 'production',
  key: {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    purpose: 'deposit-proof-reference-opening',
    keyVersion: 2,
    keyId: keyId(referenceChild),
    keyHex: referenceChild,
  },
  approvedRootProfile: {
    version: 2,
    encryptionMasterFingerprint: keyId(referenceMaster),
    fingerprintMasterFingerprint: keyId(referenceFingerprintMaster),
  },
  workerProfile: {
    version: 1,
    providerCode: 'cbe_birr',
    purpose: 'deposit-proof-reference-opening',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    ciphertextProfileVersion: 2,
    encryptionKeyVersion: 2,
    keyId: keyId(referenceChild),
    rootEncryptionMasterFingerprint: keyId(referenceMaster),
    rootFingerprintMasterFingerprint: keyId(referenceFingerprintMaster),
  },
};
const preparedReceiver = prepareCbeBirrReceiverRotation({
  receiverRevisionId,
  receiverVersion: 3,
  receiverPhone: phone,
  referenceSecrets: {
    encryptionSecret: 'e'.repeat(64),
    fingerprintSecret: 'f'.repeat(64),
  },
  lookupSecrets: {
    encryptionSecret: receiverMaster,
    fingerprintSecret: receiverFingerprintMaster,
  },
});
const receiverChild = deriveCbeBirrReceiverLookupChildKey({
  receiverRevisionId,
  receiverVersion: 3,
  encryptionSecret: receiverMaster,
});
const receiverCustody: CbeBirrReceiverLookupKeyCustodyConfig = {
  enabled: true,
  deploymentTarget: 'production',
  key: receiverChild,
  approvedRootProfile: {
    version: 2,
    purpose: 'cbe_birr_receiver_lookup',
    encryptionMasterFingerprint: keyId(receiverMaster),
    fingerprintMasterFingerprint: keyId(receiverFingerprintMaster),
  },
  workerProfile: {
    version: 1,
    providerCode: 'cbe_birr',
    purpose: 'receiver-lookup-opening',
    receiverRevisionId,
    receiverVersion: 3,
    keyId: receiverChild.keyId,
    rootEncryptionMasterFingerprint: keyId(receiverMaster),
    rootFingerprintMasterFingerprint: keyId(receiverFingerprintMaster),
  },
};
const control = {
  contractVersion: 1,
  providerCode: 'cbe_birr',
  providerRequest: 'allow_one',
  incidentStop: 'closed',
} as const;
const assessment: CbeBirrNoMoneyAssessment = {
  contractVersion: 1,
  providerCode: 'cbe_birr',
  advisoryOnly: true,
  sourceContractAttested: false,
  runtimeWiringAllowed: false,
  claimAllowed: false,
  financialActionAllowed: false,
  disposition: 'receipt_consistent_advisory',
  reasonCode: 'receipt_consistent_advisory',
  principalAmountMinor: '11200',
};

function candidateRow() {
  return {
    candidate_id: candidateId,
    proof_request_id: proofId,
    reference_ciphertext: protectedReference.ciphertext,
    reference_masked: protectedReference.masked,
    reference_profile_version: 2,
    reference_encryption_key_version: 2,
    receiver_revision_id: receiverRevisionId,
    receiver_version: 3,
    receiver_rotation_request_id: rotationId,
    receiver_lookup_ciphertext: preparedReceiver.lookup.ciphertext,
    receiver_lookup_masked: preparedReceiver.lookup.masked,
    receiver_lookup_profile_version: 2,
    receiver_lookup_encryption_key_version: 2,
    instruction_issued_at: new Date('2026-10-19T14:00:00.000Z'),
    instruction_expires_at: new Date('2026-10-19T15:00:00.000Z'),
    proof_submitted_at: new Date('2026-10-19T14:05:00.000Z'),
    receiver_active_at_submission: true,
  };
}

describe('CBE-only no-money candidate adapter', () => {
  it('opens one bound proof and returns only an advisory result', async () => {
    const query = vi.fn(async () => ({ rows: [candidateRow()] }));
    const observed: string[] = [];
    const result = await assessCbeBirrCandidateNoMoney(
      { query },
      candidateId,
      referenceCustody,
      receiverCustody,
      control,
      async (rawReference, receiver, child, profile, root, instruction, requestControl) => {
        observed.push(rawReference);
        expect(receiver).toMatchObject({
          receiverRevisionId,
          receiverVersion: 3,
          ciphertext: preparedReceiver.lookup.ciphertext,
        });
        expect(child).toBe(receiverChild);
        expect(profile).toBe(receiverCustody.workerProfile);
        expect(root).toBe(receiverCustody.approvedRootProfile);
        expect(instruction).toEqual({
          issuedAt: '2026-10-19T14:00:00.000Z',
          expiresAt: '2026-10-19T15:00:00.000Z',
          submittedAt: '2026-10-19T14:05:00.000Z',
          receiverRevisionActiveAtSubmission: true,
        });
        expect(requestControl).toBe(control);
        return assessment;
      },
    );
    expect(query).toHaveBeenCalledExactlyOnceWith(READ_CBE_BIRR_NO_MONEY_CANDIDATE_SQL, [
      candidateId,
    ]);
    expect(observed).toEqual([reference]);
    expect(result).toEqual({
      candidateId,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      sourceContractAttested: false,
      claimAllowed: false,
      financialActionAllowed: false,
      disposition: 'receipt_consistent_advisory',
      reasonCode: 'receipt_consistent_advisory',
      principalAmountMinor: '11200',
    });
    expect(JSON.stringify(result)).not.toContain(reference);
    expect(JSON.stringify(result)).not.toContain(phone);
    expect(JSON.stringify(result)).not.toContain(protectedReference.ciphertext);
  });

  it('fails before SQL without both production custody profiles and a closed one-fetch control', async () => {
    const query = vi.fn(async () => ({ rows: [candidateRow()] }));
    for (const [proof, receiver, requestControl] of [
      [{ enabled: false }, receiverCustody, control],
      [referenceCustody, { enabled: false }, control],
      [referenceCustody, receiverCustody, { ...control, incidentStop: 'open' }],
      [referenceCustody, receiverCustody, { ...control, providerRequest: 'disabled' }],
    ] as const) {
      await expect(
        assessCbeBirrCandidateNoMoney(
          { query },
          candidateId,
          proof as CbeBirrWorkerKeyCustodyConfig,
          receiver as CbeBirrReceiverLookupKeyCustodyConfig,
          requestControl as typeof control,
        ),
      ).rejects.toBeInstanceOf(CbeBirrNoMoneyCandidateUnavailableError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('never opens a mismatched receiver revision or malformed proof and refuses unsafe results', async () => {
    const observed: string[] = [];
    const assessor = async (rawReference: string) => {
      observed.push(rawReference);
      return assessment;
    };
    for (const row of [
      { ...candidateRow(), receiver_version: 4 },
      {
        ...candidateRow(),
        reference_ciphertext: protectedReference.ciphertext.replace('v2', 'v1'),
      },
      { ...candidateRow(), receiver_active_at_submission: false },
      { ...candidateRow(), extra: reference },
    ]) {
      await expect(
        assessCbeBirrCandidateNoMoney(
          { query: async () => ({ rows: [row] }) },
          candidateId,
          referenceCustody,
          receiverCustody,
          control,
          assessor,
        ),
      ).rejects.toBeInstanceOf(CbeBirrNoMoneyCandidateUnavailableError);
    }
    expect(observed).toEqual([]);
    const accessorRow = candidateRow();
    Object.defineProperty(accessorRow, 'reference_ciphertext', {
      enumerable: true,
      get: () => protectedReference.ciphertext,
    });
    await expect(
      assessCbeBirrCandidateNoMoney(
        { query: async () => ({ rows: [accessorRow] }) },
        candidateId,
        referenceCustody,
        receiverCustody,
        control,
        assessor,
      ),
    ).rejects.toBeInstanceOf(CbeBirrNoMoneyCandidateUnavailableError);
    expect(observed).toEqual([]);
    await expect(
      assessCbeBirrCandidateNoMoney(
        { query: async () => ({ rows: [candidateRow()] }) },
        candidateId,
        referenceCustody,
        receiverCustody,
        control,
        async () =>
          ({ ...assessment, financialActionAllowed: true }) as unknown as CbeBirrNoMoneyAssessment,
      ),
    ).rejects.toBeInstanceOf(CbeBirrNoMoneyCandidateUnavailableError);
  });
});
