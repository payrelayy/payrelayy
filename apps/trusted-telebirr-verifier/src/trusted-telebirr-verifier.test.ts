import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  canonicalTelebirrLivePilotObservationSignatureBytes,
  deriveTelebirrLivePilotReferenceBindingDigest,
  deriveTelebirrLivePilotReplayIdentity,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotObservationBody,
  digestTelebirrLivePilotReceiptFacts,
  digestTelebirrLivePilotReceiverName,
  type TelebirrLivePilotAssignmentBody,
  type TelebirrLivePilotFoundFacts,
  type TelebirrLivePilotObservationBody,
  type TelebirrLivePilotReceiptFacts,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
} from '@fetanagent/telebirr-verification-foundation';
import { deriveTelebirrLivePilotPolicyDigest } from '@fetanagent/telebirr-live-pilot-outcome-adapter';

import {
  createTrustedTelebirrVerifier,
  redactedTrustedTelebirrVerificationForLog,
  TrustedTelebirrVerifierUnavailableError,
  type TrustedTelebirrCompletionInput,
  type TrustedTelebirrVerifierDatabase,
} from './trusted-telebirr-verifier.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  customer: '22222222-2222-4222-8222-222222222222',
  owner: '88888888-8888-4888-8888-888888888888',
  player: '33333333-3333-4333-8333-333333333333',
  pilot: '44444444-4444-4444-8444-444444444444',
  receiver: '55555555-5555-4555-8555-555555555555',
  profile: '66666666-6666-4666-8666-666666666666',
  attempt: '77777777-7777-4777-8777-777777777777',
  lease: '99999999-9999-4999-8999-999999999999',
  completion: '12121212-1212-4121-8121-121212121212',
} as const;
const assessedAt = '2026-08-20T18:03:05.000Z';
const rawReference = 'SYNTH9XYZ1234';
const receiverName = 'Synthetic Pilot Receiver';
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const signatureDigest = (signature: string): string =>
  `sha256:${createHash('sha256').update(Buffer.from(signature, 'base64url')).digest('hex')}`;

function keyPair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }));
  return {
    privateKey: pair.privateKey,
    spki,
    digest: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  };
}

function p1363(privateKey: KeyObject, bytes: Uint8Array): string {
  return sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
}

function foundFacts(
  overrides: Partial<TelebirrLivePilotFoundFacts> = {},
): TelebirrLivePilotFoundFacts {
  return {
    lookupOutcome: 'found',
    evidenceSource: 'provider_receipt_lookup',
    layoutAttestation: 'recognized_layout_v1',
    providerFinalStatus: 'completed',
    canonicalReferencePresent: true,
    referenceMatch: 'matched',
    amountMinor: 2_500,
    currencyCode: 'ETB',
    receiverMatch: 'matched',
    creditedPartyNameDigest: digestTelebirrLivePilotReceiverName(receiverName)!,
    paymentMode: 'telebirr',
    paymentReason: 'send_money_to_registered_customer',
    paymentChannel: 'api_app',
    occurredAt: '2026-08-20T18:01:45.000Z',
    retrievedAt: '2026-08-20T18:03:00.000Z',
    ...overrides,
  };
}

function assignmentBody(): TelebirrLivePilotAssignmentBody {
  const referenceFingerprint = `hmac-sha256:${'2'.repeat(64)}`;
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assignmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    requestId: ids.request,
    jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    attemptNumber: 1,
    pilotRevisionId: ids.pilot,
    deviceId: 'synthetic-device-0001',
    keyId: 'synthetic-device-key-0001',
    leaseNonceDigest: sha('3'),
    challengeId: 'synthetic-challenge-0001',
    challengeDigest: sha('4'),
    rawReference,
    referenceFingerprint,
    referenceBindingProfile: TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
    referenceBindingDigest: deriveTelebirrLivePilotReferenceBindingDigest({
      rawReference,
      referenceFingerprint,
    })!,
    sourceProfile: 'telebirr_official_receipt_v1',
    receiverRevisionId: ids.receiver,
    receiverProfileId: ids.profile,
    receiverProfileDigest: sha('6'),
    receiverConfigurationDigest: sha('7'),
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: 'synthetic pilot receiver',
    expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(receiverName)!,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    factsNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    issuedAt: '2026-08-20T18:02:00.000Z',
    expiresAt: '2026-08-20T18:04:00.000Z',
  };
}

function signedAssignment(
  body: TelebirrLivePilotAssignmentBody,
  privateKey: KeyObject,
): TelebirrLivePilotSignedAssignment {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrLivePilotAssignmentBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    signerKeyId: 'synthetic-server-key-0001',
    body,
    signature: p1363(privateKey, canonicalTelebirrLivePilotAssignmentSignatureBytes(body)!),
  };
}

function observationBody(
  assignment: TelebirrLivePilotAssignmentBody,
  facts: TelebirrLivePilotReceiptFacts,
): TelebirrLivePilotObservationBody {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assignmentId: assignment.assignmentId,
    requestId: assignment.requestId,
    jobId: assignment.jobId,
    attemptNumber: assignment.attemptNumber,
    pilotRevisionId: assignment.pilotRevisionId,
    deviceId: assignment.deviceId,
    keyId: assignment.keyId,
    leaseNonceDigest: assignment.leaseNonceDigest,
    challengeId: assignment.challengeId,
    challengeDigest: assignment.challengeDigest,
    assignmentBodyDigest: digestTelebirrLivePilotAssignmentBody(assignment)!,
    referenceFingerprint: assignment.referenceFingerprint,
    referenceBindingDigest: assignment.referenceBindingDigest,
    sourceProfile: assignment.sourceProfile,
    receiverRevisionId: assignment.receiverRevisionId,
    receiverProfileId: assignment.receiverProfileId,
    receiverProfileDigest: assignment.receiverProfileDigest,
    receiverConfigurationDigest: assignment.receiverConfigurationDigest,
    receiverNameNormalizerVersion: assignment.receiverNameNormalizerVersion,
    expectedReceiverNameDigest: assignment.expectedReceiverNameDigest,
    adapterVersion: assignment.adapterVersion,
    parserVersion: assignment.parserVersion,
    factsNormalizerVersion: assignment.factsNormalizerVersion,
    sourceDocumentDigest: sha('5'),
    normalizedFactsDigest: digestTelebirrLivePilotReceiptFacts(facts)!,
    observedAt: '2026-08-20T18:03:00.000Z',
    facts,
  };
}

function signedObservation(
  body: TelebirrLivePilotObservationBody,
  privateKey: KeyObject,
): TelebirrLivePilotSignedObservation {
  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    transcriptVersion: TELEBIRR_LIVE_PILOT_OBSERVATION_TRANSCRIPT_VERSION,
    bodyDigestAlgorithm: 'sha256',
    bodyDigest: digestTelebirrLivePilotObservationBody(body)!,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    signatureEncoding: 'ieee-p1363-base64url',
    body,
    signature: p1363(privateKey, canonicalTelebirrLivePilotObservationSignatureBytes(body)!),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fixture(facts: TelebirrLivePilotReceiptFacts = foundFacts()) {
  const signer = keyPair();
  const device = keyPair();
  const assignmentSource = assignmentBody();
  const assignment = signedAssignment(assignmentSource, signer.privateKey);
  const observation = signedObservation(
    observationBody(assignmentSource, facts),
    device.privateKey,
  );
  const policy = {
    state: 'available',
    providerCode: 'telebirr',
    checkedAt: assessedAt,
    policyVersion: 'telebirr_private_pilot_policy_v1',
    currencyCode: 'ETB',
    minimumPrincipalAmountMinor: '2500',
    maximumPrincipalAmountMinor: '2500000',
    automaticFreshnessSeconds: 3600,
    maximumFutureSkewSeconds: 300,
    allowedTransactionType: 'send_money',
    acceptedSource: 'telebirr_official_receipt',
    acceptedSourceProfile: 'telebirr_official_receipt_v1',
    acceptedAdapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    acceptedParserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    acceptedNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  };
  const databaseAuthority = {
    submittingCustomerId: ids.customer,
    submittingCustomerMembershipState: 'included',
    submittingCustomerCurrentState: 'active',
    submittingCustomerSnapshotState: 'exact',
    ownerCustomerId: ids.owner,
    playerAccountId: ids.player,
    playerMembershipState: 'included',
    ownerCustomerBindingState: 'exact',
    ownerCustomerCurrentState: 'active',
    ownerCustomerSnapshotState: 'exact',
  };
  const databaseFacts = {
    receiverAtOccurredAt: {
      state: facts.lookupOutcome === 'found' ? 'exact' : 'unavailable',
      providerCode: 'telebirr',
      resolvedForOccurredAt: facts.lookupOutcome === 'found' ? facts.occurredAt : null,
      revisionId: facts.lookupOutcome === 'found' ? ids.receiver : null,
      identityDigest:
        facts.lookupOutcome === 'found' ? assignmentSource.expectedReceiverNameDigest : null,
      matchBasis: facts.lookupOutcome === 'found' ? 'exact_full_name' : null,
      effectiveFrom: facts.lookupOutcome === 'found' ? '2026-08-20T17:00:00.000Z' : null,
      effectiveUntil: null,
    },
    currentPolicy: policy,
    currentEligibility: {
      state: 'eligible',
      selectedPlayerId: 'SYNTHETIC_PLAYER_01',
      checkedAt: assessedAt,
      decisionVersion: 'kemerbet_player_eligibility_v1',
    },
    duplicateState: {
      state: 'unused',
      providerCode: 'telebirr',
      canonicalReferenceFingerprint: '2'.repeat(64),
      checkedAt: assessedAt,
    },
  };
  const authority = {
    contractVersion: 1,
    capturedAt: assessedAt,
    authorityStateDigest: sha('a'),
    verificationAttemptId: ids.attempt,
    leaseTokenAccepted: true,
    attempt: {
      assignmentId: assignmentSource.assignmentId,
      requestId: assignmentSource.requestId,
      jobId: assignmentSource.jobId,
      attemptNumber: assignmentSource.attemptNumber,
      leaseNonceDigest: assignmentSource.leaseNonceDigest,
      challengeId: assignmentSource.challengeId,
      challengeDigest: assignmentSource.challengeDigest,
      issuedAt: assignmentSource.issuedAt,
      expiresAt: assignmentSource.expiresAt,
    },
    trustedAssignmentSigner: {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      signerKeyId: assignment.signerKeyId,
      publicKeySpkiSha256: signer.digest,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      state: 'active',
      validFrom: '2026-08-20T17:00:00.000Z',
      validUntil: '2026-08-21T17:00:00.000Z',
    },
    deviceEnrollment: {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      enrollmentId: 'synthetic-enrollment-0001',
      deviceId: assignmentSource.deviceId,
      keyId: assignmentSource.keyId,
      publicKeySpkiSha256: device.digest,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      state: 'active',
      validFrom: '2026-08-20T17:00:00.000Z',
      validUntil: '2026-08-21T17:00:00.000Z',
      pilotRevisionId: ids.pilot,
      receiverRevisionId: ids.receiver,
      receiverProfileId: ids.profile,
      receiverProfileDigest: assignmentSource.receiverProfileDigest,
      receiverConfigurationDigest: assignmentSource.receiverConfigurationDigest,
    },
    trustedRequestBinding: {
      assignmentId: assignmentSource.assignmentId,
      requestId: assignmentSource.requestId,
      jobId: assignmentSource.jobId,
      attemptNumber: assignmentSource.attemptNumber,
      pilotRevisionId: ids.pilot,
      deviceId: assignmentSource.deviceId,
      keyId: assignmentSource.keyId,
      referenceFingerprint: assignmentSource.referenceFingerprint,
      receiverRevisionId: ids.receiver,
      receiverProfileId: ids.profile,
      receiverProfileDigest: assignmentSource.receiverProfileDigest,
      receiverConfigurationDigest: assignmentSource.receiverConfigurationDigest,
      expectedReceiverNameDigest: assignmentSource.expectedReceiverNameDigest,
    },
    assignmentTranscript: {
      assignmentBodyDigest: assignment.bodyDigest,
      assignmentSignatureDigest: signatureDigest(assignment.signature),
      referenceBindingDigest: assignmentSource.referenceBindingDigest,
      signedAt: assignmentSource.issuedAt,
    },
    replayIdentities: [],
    existingCompletion: null,
    trustedRequest: {
      proofRequestId: ids.request,
      submittingCustomerId: ids.customer,
      submittingCustomerMembershipState: 'included',
      submittingCustomerCurrentState: 'active',
      submittingCustomerSnapshotState: 'exact',
      playerAccountId: ids.player,
      selectedPlayerId: 'SYNTHETIC_PLAYER_01',
      providerCode: 'telebirr',
      referenceFingerprint: '2'.repeat(64),
      submittedAt: '2026-08-20T18:02:30.000Z',
      pilotRevisionId: ids.pilot,
      pilotConfigurationDigest: sha('9'),
      receiverRevisionId: ids.receiver,
      policyVersion: policy.policyVersion,
      databaseSnapshotId: ids.attempt,
    },
    trustedPilot: {
      contractVersion: 1,
      revisionId: ids.pilot,
      configurationDigest: sha('9'),
      state: 'armed',
      validFrom: '2026-08-20T17:00:00.000Z',
      validUntil: '2026-08-20T20:00:00.000Z',
    },
    trustedPlayer: {
      ownerCustomerId: ids.owner,
      playerMembershipState: 'included',
      ownerCustomerBindingState: 'exact',
      ownerCustomerCurrentState: 'active',
      ownerCustomerSnapshotState: 'exact',
      playerAccountId: ids.player,
      selectedPlayerId: 'SYNTHETIC_PLAYER_01',
      eligibilityState: 'eligible',
      eligibilityDecisionVersion: 'kemerbet_player_eligibility_v1',
    },
    trustedProvider: {
      providerCode: 'telebirr',
      state: 'active',
      source: 'telebirr_official_receipt',
      sourceProfile: 'telebirr_official_receipt_v1',
      adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
      parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
      normalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    },
    trustedReference: {
      providerCode: 'telebirr',
      protectionProfileVersion: 2,
      encryptionKeyVersion: 2,
      ciphertext: `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(11)}`,
      fingerprint: '2'.repeat(64),
      masked: '***1234',
    },
    trustedReceiver: {
      providerCode: 'telebirr',
      revisionId: ids.receiver,
      revisionVersion: 1,
      profileId: ids.profile,
      profileDigest: assignmentSource.receiverProfileDigest,
      configurationDigest: assignmentSource.receiverConfigurationDigest,
      identityDigest: assignmentSource.expectedReceiverNameDigest,
      expectedReceiverNameDigest: assignmentSource.expectedReceiverNameDigest,
      matchBasis: 'exact_full_name',
    },
    trustedPolicy: {
      providerCode: 'telebirr',
      policyVersion: policy.policyVersion,
      policyDigest: deriveTelebirrLivePilotPolicyDigest(policy)!,
    },
    databaseAuthority,
    databaseFacts,
  };
  return {
    signer,
    device,
    assignment,
    observation,
    authority,
    request: {
      contractVersion: 1 as const,
      verificationAttemptId: ids.attempt,
      leaseToken: ids.lease,
      completionRequestKey: ids.completion,
      signedAssignment: assignment,
      signedObservation: observation,
    },
  };
}

function successfulCompletion() {
  return {
    verification_outcome_id: '10101010-1010-4010-8010-101010101010',
    outcome_disposition: 'settlement_candidate',
    outcome_reason_code: 'exact_proof_match',
    deposit_intent_id: '20202020-2020-4020-8020-202020202020',
    deposit_payment_claim_id: '30303030-3030-4030-8030-303030303030',
    execution_job_id: '40404040-4040-4040-8040-404040404040',
    settlement_created: true,
    already_completed: false,
  };
}

function nonSettlementCompletion(input: TrustedTelebirrCompletionInput, alreadyCompleted = false) {
  return {
    verification_outcome_id: '10101010-1010-4010-8010-101010101010',
    outcome_disposition: input.disposition,
    outcome_reason_code: input.reasonCode,
    deposit_intent_id: null,
    deposit_payment_claim_id: null,
    execution_job_id: null,
    settlement_created: false,
    already_completed: alreadyCompleted,
  };
}

function persistedCompletion(input: TrustedTelebirrCompletionInput) {
  const { verificationAttemptId: _attemptId, leaseToken: _leaseToken, ...persisted } = input;
  return persisted;
}

function databaseFor(
  authorities: readonly unknown[],
  loadGuard: (leaseToken: string) => void = () => undefined,
) {
  let index = 0;
  const complete = vi.fn(async (input: TrustedTelebirrCompletionInput) =>
    input.disposition === 'settlement_candidate'
      ? successfulCompletion()
      : nonSettlementCompletion(input),
  );
  const database: TrustedTelebirrVerifierDatabase = {
    async loadAuthority(_attemptId, leaseToken) {
      loadGuard(leaseToken);
      return authorities[Math.min(index++, authorities.length - 1)];
    },
    complete,
  };
  return { database, complete };
}

function verifierFor(value: ReturnType<typeof fixture>, authorities = [value.authority]) {
  const database = databaseFor(authorities);
  return {
    ...database,
    verifier: createTrustedTelebirrVerifier(database.database, {
      assignmentSigners: [
        { keyId: value.assignment.signerKeyId, publicKeySpkiDer: value.signer.spki },
      ],
      devices: [{ keyId: value.assignment.body.keyId, publicKeySpkiDer: value.device.spki }],
    }),
  };
}

describe('trusted TeleBirr verifier', () => {
  it('uses two matching server snapshots and completes only the exact signed settlement candidate', async () => {
    const value = fixture();
    const { verifier, complete } = verifierFor(value);
    await expect(verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
      status: 'settled',
      alreadyCompleted: false,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    const completion = complete.mock.calls[0]?.[0];
    expect(completion).toMatchObject({
      verificationAttemptId: ids.attempt,
      leaseToken: ids.lease,
      completionRequestKey: ids.completion,
      observationBodyDigest: value.observation.bodyDigest,
      observationSignatureDigest: signatureDigest(value.observation.signature),
      replayIdentity: deriveTelebirrLivePilotReplayIdentity(value.assignment, value.observation),
      sourceDocumentDigest: value.observation.body.sourceDocumentDigest,
      normalizedFactsDigest: value.observation.body.normalizedFactsDigest,
      protocolDisposition: 'would_forward_signed_evidence',
      protocolReasonCode: 'signed_evidence_verified',
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
      receiptPrincipalAmountMinor: '2500',
      receiverIdentityDigest: value.assignment.body.expectedReceiverNameDigest,
    });
  });

  it('rejects malformed, noncanonical, wrong-curve, or cross-role pins at construction', () => {
    const value = fixture();
    const database = databaseFor([value.authority]).database;
    const p384 = Buffer.from(
      generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({
        format: 'der',
        type: 'spki',
      }),
    );
    const invalidSignerPins = [
      Buffer.alloc(91, 9),
      Buffer.concat([value.signer.spki, Buffer.from([0])]),
      p384,
    ];
    for (const invalidSignerPin of invalidSignerPins) {
      expect(() =>
        createTrustedTelebirrVerifier(database, {
          assignmentSigners: [
            { keyId: value.assignment.signerKeyId, publicKeySpkiDer: invalidSignerPin },
          ],
          devices: [{ keyId: value.assignment.body.keyId, publicKeySpkiDer: value.device.spki }],
        }),
      ).toThrow(TrustedTelebirrVerifierUnavailableError);
    }

    for (const pins of [
      {
        assignmentSigners: [
          { keyId: value.assignment.signerKeyId, publicKeySpkiDer: value.signer.spki },
        ],
        devices: [{ keyId: value.assignment.signerKeyId, publicKeySpkiDer: value.device.spki }],
      },
      {
        assignmentSigners: [
          { keyId: value.assignment.signerKeyId, publicKeySpkiDer: value.signer.spki },
        ],
        devices: [{ keyId: value.assignment.body.keyId, publicKeySpkiDer: value.signer.spki }],
      },
      {
        assignmentSigners: [
          { keyId: value.assignment.signerKeyId, publicKeySpkiDer: value.signer.spki },
          { keyId: 'assignment-signer-key-alias', publicKeySpkiDer: value.signer.spki },
        ],
        devices: [{ keyId: value.assignment.body.keyId, publicKeySpkiDer: value.device.spki }],
      },
    ]) {
      expect(() => createTrustedTelebirrVerifier(database, pins)).toThrow(
        TrustedTelebirrVerifierUnavailableError,
      );
    }
  });

  it('does not complete bad assignment/device signatures or a missing configured pin', async () => {
    for (const mutate of [
      (value: ReturnType<typeof fixture>) => {
        (value.request.signedAssignment as { signature: string }).signature = `${'A'.repeat(85)}B`;
      },
      (value: ReturnType<typeof fixture>) => {
        (value.request.signedObservation as { signature: string }).signature = `${'A'.repeat(85)}B`;
      },
    ]) {
      const value = fixture();
      mutate(value);
      value.authority.assignmentTranscript.assignmentSignatureDigest = signatureDigest(
        value.request.signedAssignment.signature,
      );
      const { verifier, complete } = verifierFor(value);
      await expect(verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
        status: 'not_settled',
      });
      expect(complete).not.toHaveBeenCalled();
    }

    const value = fixture();
    const database = databaseFor([value.authority]);
    const unrelated = keyPair();
    const verifier = createTrustedTelebirrVerifier(database.database, {
      assignmentSigners: [
        { keyId: value.assignment.signerKeyId, publicKeySpkiDer: unrelated.spki },
      ],
      devices: [{ keyId: value.assignment.body.keyId, publicKeySpkiDer: value.device.spki }],
    });
    await expect(verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
      status: 'not_settled',
    });
    expect(database.complete).not.toHaveBeenCalled();
  });

  it('fails swapped submitter/owner authority and stale or revoked signer/device state closed', async () => {
    const mutations: Array<(authority: ReturnType<typeof fixture>['authority']) => void> = [
      (authority) => {
        (authority.trustedRequest as { submittingCustomerId: string }).submittingCustomerId =
          ids.owner;
      },
      (authority) => {
        (authority.trustedPlayer as { ownerCustomerId: string }).ownerCustomerId = ids.customer;
      },
      (authority) => {
        authority.trustedRequest.submittingCustomerSnapshotState = 'stale';
        authority.databaseAuthority.submittingCustomerSnapshotState = 'stale';
      },
      (authority) => {
        authority.trustedAssignmentSigner.state = 'revoked';
      },
      (authority) => {
        authority.deviceEnrollment.state = 'revoked';
      },
      (authority) => {
        authority.deviceEnrollment.validUntil = '2026-08-20T18:03:00.000Z';
      },
    ];
    for (const mutate of mutations) {
      const value = fixture();
      const authority = clone(value.authority);
      mutate(authority);
      authority.authorityStateDigest = sha('b');
      const { verifier, complete } = verifierFor(value, [authority]);
      await expect(verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
        status: 'not_settled',
      });
      expect(complete).not.toHaveBeenCalled();
    }
  });

  it('refuses replay, lease/token mismatch, transcript mismatch, and second-read snapshot drift', async () => {
    const replayed = fixture();
    const replayAuthority = clone(replayed.authority);
    (replayAuthority as { replayIdentities: string[] }).replayIdentities = [
      deriveTelebirrLivePilotReplayIdentity(replayed.assignment, replayed.observation)!,
    ];
    const replayRuntime = verifierFor(replayed, [replayAuthority]);
    await expect(replayRuntime.verifier.verifyAndComplete(replayed.request)).resolves.toEqual({
      status: 'not_settled',
      disposition: 'invalid',
      reasonCode: 'trusted_evidence_invalid',
    });
    expect(replayRuntime.complete).not.toHaveBeenCalled();

    const mismatch = fixture();
    const mismatchedAuthority = clone(mismatch.authority);
    mismatchedAuthority.attempt.leaseNonceDigest = sha('f');
    const mismatchRuntime = verifierFor(mismatch, [mismatchedAuthority]);
    await expect(
      mismatchRuntime.verifier.verifyAndComplete(mismatch.request),
    ).rejects.toBeInstanceOf(TrustedTelebirrVerifierUnavailableError);
    expect(mismatchRuntime.complete).not.toHaveBeenCalled();

    const wrongLease = fixture();
    const guardedDatabase = databaseFor([wrongLease.authority], (leaseToken) => {
      if (leaseToken !== ids.lease) throw new Error('sensitive token detail');
    });
    const wrongLeaseVerifier = createTrustedTelebirrVerifier(guardedDatabase.database, {
      assignmentSigners: [
        {
          keyId: wrongLease.assignment.signerKeyId,
          publicKeySpkiDer: wrongLease.signer.spki,
        },
      ],
      devices: [
        { keyId: wrongLease.assignment.body.keyId, publicKeySpkiDer: wrongLease.device.spki },
      ],
    });
    await expect(
      wrongLeaseVerifier.verifyAndComplete({
        ...wrongLease.request,
        leaseToken: '98989898-9898-4989-8989-989898989898',
      }),
    ).rejects.toThrow('The trusted TeleBirr verifier is unavailable.');
    expect(guardedDatabase.complete).not.toHaveBeenCalled();

    const drifted = fixture();
    const second = clone(drifted.authority);
    second.authorityStateDigest = sha('b');
    const driftRuntime = verifierFor(drifted, [drifted.authority, second]);
    await expect(driftRuntime.verifier.verifyAndComplete(drifted.request)).resolves.toEqual({
      status: 'not_settled',
      disposition: 'invalid',
      reasonCode: 'trusted_evidence_invalid',
    });
    expect(driftRuntime.complete).not.toHaveBeenCalled();
  });

  it('durably completes authenticated review/reject outcomes without settlement fields', async () => {
    for (const [facts, disposition, reasonCode] of [
      [
        {
          lookupOutcome: 'review_required' as const,
          reviewReason: 'provider_unavailable' as const,
          retrievedAt: assessedAt,
        },
        'review_required',
        'source_unavailable',
      ],
      [foundFacts({ referenceMatch: 'mismatched' }), 'definite_reject', 'reference_mismatch'],
    ] as const) {
      const value = fixture(facts);
      const { verifier, complete } = verifierFor(value);
      await expect(verifier.verifyAndComplete(value.request)).resolves.toEqual({
        status: 'completed_without_settlement',
        verificationOutcomeId: '10101010-1010-4010-8010-101010101010',
        disposition,
        reasonCode,
        alreadyCompleted: false,
      });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0]?.[0]).toMatchObject({
        disposition,
        reasonCode,
        receiptPrincipalAmountMinor: null,
        occurredAt: null,
        receiverIdentityDigest: null,
      });
    }
  });

  it('replays an exact lost settlement ACK from stored inputs after duplicate facts change', async () => {
    const value = fixture();
    value.authority.capturedAt = '2026-08-20T18:02:30.000Z';
    value.authority.databaseFacts.currentPolicy.checkedAt = value.authority.capturedAt;
    value.authority.databaseFacts.currentEligibility.checkedAt = value.authority.capturedAt;
    value.authority.databaseFacts.duplicateState.checkedAt = value.authority.capturedAt;
    const runtime = verifierFor(value);
    runtime.complete.mockImplementation(async (input) =>
      runtime.complete.mock.calls.length > 1
        ? { ...successfulCompletion(), already_completed: true }
        : successfulCompletion(),
    );

    await expect(runtime.verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
      status: 'settled',
      alreadyCompleted: false,
    });
    const firstCompletion = runtime.complete.mock.calls[0]?.[0];
    expect(firstCompletion).toBeDefined();
    (value.authority as { existingCompletion: unknown }).existingCompletion = persistedCompletion(
      firstCompletion!,
    );
    value.authority.authorityStateDigest = sha('c');
    value.authority.capturedAt = assessedAt;
    value.authority.databaseFacts.currentPolicy.checkedAt = assessedAt;
    value.authority.databaseFacts.currentEligibility.checkedAt = assessedAt;
    value.authority.databaseFacts.duplicateState.checkedAt = assessedAt;
    value.authority.databaseFacts.duplicateState.state = 'reused';

    await expect(runtime.verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
      status: 'settled',
      alreadyCompleted: true,
    });
    expect(runtime.complete).toHaveBeenCalledTimes(2);
    expect(runtime.complete.mock.calls[1]?.[0]).toEqual(firstCompletion);
  });

  it('never replays stored completion after current pilot, device, or signer authority is lost', async () => {
    const seed = fixture();
    const seededRuntime = verifierFor(seed);
    await seededRuntime.verifier.verifyAndComplete(seed.request);
    const stored = persistedCompletion(seededRuntime.complete.mock.calls[0]![0]);

    for (const mutate of [
      (authority: ReturnType<typeof fixture>['authority']) => {
        authority.trustedPilot.state = 'stopped';
      },
      (authority: ReturnType<typeof fixture>['authority']) => {
        authority.deviceEnrollment.state = 'revoked';
      },
      (authority: ReturnType<typeof fixture>['authority']) => {
        authority.trustedAssignmentSigner.state = 'revoked';
      },
      (authority: ReturnType<typeof fixture>['authority']) => {
        authority.deviceEnrollment.validUntil = assessedAt;
      },
    ]) {
      const value = fixture();
      (value.authority as { existingCompletion: unknown }).existingCompletion = stored;
      value.authority.authorityStateDigest = sha('d');
      mutate(value.authority);
      const runtime = verifierFor(value);
      await expect(runtime.verifier.verifyAndComplete(value.request)).resolves.toMatchObject({
        status: 'not_settled',
      });
      expect(runtime.complete).not.toHaveBeenCalled();
    }
  });

  it('keeps cross-attempt replay and duplicate-reference evidence non-settling', async () => {
    const duplicate = fixture();
    duplicate.authority.databaseFacts.duplicateState.state = 'reused';
    duplicate.authority.authorityStateDigest = sha('e');
    const duplicateRuntime = verifierFor(duplicate);
    await expect(duplicateRuntime.verifier.verifyAndComplete(duplicate.request)).resolves.toEqual({
      status: 'completed_without_settlement',
      verificationOutcomeId: '10101010-1010-4010-8010-101010101010',
      disposition: 'definite_reject',
      reasonCode: 'duplicate_reference_reused',
      alreadyCompleted: false,
    });
    expect(duplicateRuntime.complete.mock.calls[0]?.[0]).toMatchObject({
      disposition: 'definite_reject',
      receiptPrincipalAmountMinor: null,
      occurredAt: null,
      receiverIdentityDigest: null,
    });
  });

  it('uses constant safe errors and fixed-key logs with no secret-bearing material', async () => {
    const value = fixture();
    const { verifier } = verifierFor(value);
    const result = await verifier.verifyAndComplete(value.request);
    const projection = redactedTrustedTelebirrVerificationForLog(result);
    const serialized = JSON.stringify(projection);
    for (const forbidden of [
      rawReference,
      ids.lease,
      ids.customer,
      ids.owner,
      value.assignment.signature,
      value.observation.signature,
      value.authority.trustedReference.ciphertext,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(projection)).toEqual([
      'verifierVersion',
      'status',
      'disposition',
      'reasonCode',
      'alreadyCompleted',
    ]);

    let errorMessage = '';
    try {
      await verifier.verifyAndComplete({ ...value.request, leaseToken: 'not-a-token' });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    expect(errorMessage).toBe('The trusted TeleBirr verifier is unavailable.');
    expect(errorMessage).not.toContain(rawReference);
  });
});
