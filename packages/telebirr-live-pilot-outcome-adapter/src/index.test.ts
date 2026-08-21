import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { validatedAuthoritativeDepositProofOutcomeCandidate } from '@fetanagent/contracts';
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
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotObservationBody,
  digestTelebirrLivePilotReceiptFacts,
  digestTelebirrLivePilotReceiverName,
  type TelebirrLivePilotAssignmentBody,
  type TelebirrLivePilotDeviceEnrollment,
  type TelebirrLivePilotFoundFacts,
  type TelebirrLivePilotObservationBody,
  type TelebirrLivePilotReceiptFacts,
  type TelebirrLivePilotSignedAssignment,
  type TelebirrLivePilotSignedObservation,
  type TelebirrLivePilotTrustedAssignmentSigner,
  type TelebirrLivePilotVerificationInput,
} from '@fetanagent/telebirr-verification-foundation';

import {
  adaptTelebirrLivePilotOutcome,
  deriveTelebirrLivePilotDatabaseSnapshotDigest,
  deriveTelebirrLivePilotPolicyDigest,
  redactedTelebirrLivePilotOutcomeForLog,
  type TelebirrLivePilotOutcomeAdapterInput,
} from './index.js';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  customer: '22222222-2222-4222-8222-222222222222',
  ownerCustomer: '88888888-8888-4888-8888-888888888888',
  playerAccount: '33333333-3333-4333-8333-333333333333',
  pilot: '44444444-4444-4444-8444-444444444444',
  receiver: '55555555-5555-4555-8555-555555555555',
  receiverProfile: '66666666-6666-4666-8666-666666666666',
  snapshot: '77777777-7777-4777-8777-777777777777',
} as const;
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const protocolFingerprint = (character: string): string => `hmac-sha256:${character.repeat(64)}`;
const rawReference = 'SYNTH9XYZ1234';
const receiverName = 'Synthetic Pilot Receiver';
const assessedAt = '2026-08-20T18:03:05.000Z';

function keyPair(): {
  readonly privateKey: KeyObject;
  readonly spki: Buffer;
  readonly digest: string;
} {
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
  const referenceFingerprint = protocolFingerprint('2');
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
    receiverProfileId: ids.receiverProfile,
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

interface Fixture {
  readonly input: TelebirrLivePilotOutcomeAdapterInput;
  readonly signerSpki: Buffer;
  readonly deviceSpki: Buffer;
}

function fixture(facts: TelebirrLivePilotReceiptFacts = foundFacts()): Fixture {
  const signer = keyPair();
  const device = keyPair();
  const assignmentSource = assignmentBody();
  const assignment = signedAssignment(assignmentSource, signer.privateKey);
  const observationSource = observationBody(assignmentSource, facts);
  const observation = signedObservation(observationSource, device.privateKey);
  const trustedAssignmentSigner: TelebirrLivePilotTrustedAssignmentSigner = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    signerKeyId: assignment.signerKeyId,
    publicKeySpkiSha256: signer.digest,
    signatureAlgorithm: 'ecdsa-p256-sha256',
    state: 'active',
    validFrom: '2026-08-20T17:00:00.000Z',
    validUntil: '2026-08-21T17:00:00.000Z',
  };
  const deviceEnrollment: TelebirrLivePilotDeviceEnrollment = {
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
    receiverProfileId: ids.receiverProfile,
    receiverProfileDigest: assignmentSource.receiverProfileDigest,
    receiverConfigurationDigest: assignmentSource.receiverConfigurationDigest,
  };
  const verificationInput: TelebirrLivePilotVerificationInput = {
    contractVersion: 1,
    providerCode: 'telebirr',
    protocolMode: 'live_private_pilot_v1',
    assessedAt,
    trustedAssignmentSigner,
    trustedRequestBinding: {
      assignmentId: assignmentSource.assignmentId,
      requestId: ids.request,
      jobId: assignmentSource.jobId,
      attemptNumber: 1,
      pilotRevisionId: ids.pilot,
      deviceId: assignmentSource.deviceId,
      keyId: assignmentSource.keyId,
      referenceFingerprint: assignmentSource.referenceFingerprint,
      receiverRevisionId: ids.receiver,
      receiverProfileId: ids.receiverProfile,
      receiverProfileDigest: assignmentSource.receiverProfileDigest,
      receiverConfigurationDigest: assignmentSource.receiverConfigurationDigest,
      expectedReceiverNameDigest: assignmentSource.expectedReceiverNameDigest,
    },
    deviceEnrollment,
    signedAssignment: assignment,
    signedObservation: observation,
    serverComputedReplayIdentities: [],
  };
  const policy = {
    state: 'available' as const,
    providerCode: 'telebirr' as const,
    checkedAt: assessedAt,
    policyVersion: 'telebirr_private_pilot_policy_v1',
    currencyCode: 'ETB' as const,
    minimumPrincipalAmountMinor: '2500',
    maximumPrincipalAmountMinor: '2500000',
    automaticFreshnessSeconds: 3600,
    maximumFutureSkewSeconds: 300,
    allowedTransactionType: 'send_money' as const,
    acceptedSource: 'telebirr_official_receipt' as const,
    acceptedSourceProfile: 'telebirr_official_receipt_v1',
    acceptedAdapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    acceptedParserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    acceptedNormalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  };
  const databaseFacts = {
    receiverAtOccurredAt: {
      state: 'exact' as const,
      providerCode: 'telebirr' as const,
      resolvedForOccurredAt: '2026-08-20T18:01:45.000Z',
      revisionId: ids.receiver,
      identityDigest: assignmentSource.expectedReceiverNameDigest,
      matchBasis: 'exact_full_name' as const,
      effectiveFrom: '2026-08-20T17:00:00.000Z',
      effectiveUntil: null,
    },
    currentPolicy: policy,
    currentEligibility: {
      state: 'eligible' as const,
      selectedPlayerId: 'SYNTHETIC_PLAYER_01',
      checkedAt: assessedAt,
      decisionVersion: 'kemerbet_player_eligibility_v1',
    },
    duplicateState: {
      state: 'unused' as const,
      providerCode: 'telebirr' as const,
      canonicalReferenceFingerprint: '2'.repeat(64),
      checkedAt: assessedAt,
    },
  };
  const authority = {
    submittingCustomerId: ids.customer,
    submittingCustomerMembershipState: 'included' as const,
    submittingCustomerCurrentState: 'active' as const,
    submittingCustomerSnapshotState: 'exact' as const,
    ownerCustomerId: ids.ownerCustomer,
    playerAccountId: ids.playerAccount,
    playerMembershipState: 'included' as const,
    ownerCustomerBindingState: 'exact' as const,
    ownerCustomerCurrentState: 'active' as const,
    ownerCustomerSnapshotState: 'exact' as const,
  };
  const snapshotMaterial = {
    snapshotId: ids.snapshot,
    capturedAt: assessedAt,
    authority,
    facts: databaseFacts,
  };
  return {
    signerSpki: signer.spki,
    deviceSpki: device.spki,
    input: {
      contractVersion: 1,
      providerCode: 'telebirr',
      protocolMode: 'live_private_pilot_v1',
      assessedAt,
      trustedRequest: {
        proofRequestId: ids.request,
        submittingCustomerId: ids.customer,
        submittingCustomerMembershipState: 'included',
        submittingCustomerCurrentState: 'active',
        submittingCustomerSnapshotState: 'exact',
        playerAccountId: ids.playerAccount,
        selectedPlayerId: 'SYNTHETIC_PLAYER_01',
        providerCode: 'telebirr',
        referenceFingerprint: '2'.repeat(64),
        submittedAt: '2026-08-20T18:02:30.000Z',
        pilotRevisionId: ids.pilot,
        pilotConfigurationDigest: sha('9'),
        receiverRevisionId: ids.receiver,
        policyVersion: policy.policyVersion,
        databaseSnapshotId: ids.snapshot,
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
        ownerCustomerId: ids.ownerCustomer,
        playerMembershipState: 'included',
        ownerCustomerBindingState: 'exact',
        ownerCustomerCurrentState: 'active',
        ownerCustomerSnapshotState: 'exact',
        playerAccountId: ids.playerAccount,
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
        profileId: ids.receiverProfile,
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
      trustedDatabaseSnapshot: {
        ...snapshotMaterial,
        snapshotDigest: deriveTelebirrLivePilotDatabaseSnapshotDigest(snapshotMaterial)!,
      },
      verificationInput,
    },
  };
}

function adapt(value: Fixture) {
  return adaptTelebirrLivePilotOutcome(value.input, value.signerSpki, value.deviceSpki);
}

function withAuthority(
  value: Fixture,
  authorityOverrides: Partial<Fixture['input']['trustedDatabaseSnapshot']['authority']>,
  requestOverrides: Partial<Fixture['input']['trustedRequest']> = {},
  playerOverrides: Partial<Fixture['input']['trustedPlayer']> = {},
): Fixture {
  const authority = {
    ...value.input.trustedDatabaseSnapshot.authority,
    ...authorityOverrides,
  };
  const snapshotMaterial = {
    snapshotId: value.input.trustedDatabaseSnapshot.snapshotId,
    capturedAt: value.input.trustedDatabaseSnapshot.capturedAt,
    authority,
    facts: value.input.trustedDatabaseSnapshot.facts,
  };
  return {
    ...value,
    input: {
      ...value.input,
      trustedRequest: { ...value.input.trustedRequest, ...requestOverrides },
      trustedPlayer: { ...value.input.trustedPlayer, ...playerOverrides },
      trustedDatabaseSnapshot: {
        ...snapshotMaterial,
        snapshotDigest: deriveTelebirrLivePilotDatabaseSnapshotDigest(snapshotMaterial)!,
      },
    },
  };
}

describe('TeleBirr live-pilot outcome adapter', () => {
  it('shares the exact static policy-binding digest vector with the SQL receiver profile', () => {
    const policy = {
      state: 'available',
      providerCode: 'telebirr',
      checkedAt: '2026-08-20T18:03:00.000Z',
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

    expect(deriveTelebirrLivePilotPolicyDigest(policy)).toBe(
      'sha256:c3dfbfa1f7caf08d9be09edebdb670bc2395fe79ebd4971374c965c2a751416e',
    );
    expect(
      deriveTelebirrLivePilotPolicyDigest({
        ...policy,
        checkedAt: '2026-08-20T18:04:59.999Z',
      }),
    ).toBe('sha256:c3dfbfa1f7caf08d9be09edebdb670bc2395fe79ebd4971374c965c2a751416e');
  });

  it('emits only a validated advisory settlement candidate for an exact cross-customer proof', () => {
    const outcome = adapt(fixture());
    expect(outcome).toMatchObject({
      providerCode: 'telebirr',
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
      principalAmountMinor: '2500',
      currencyCode: 'ETB',
      receiverMatchBasis: 'exact_full_name',
      advisoryOnly: true,
      sqlAuthorizationAllowed: false,
      databaseReadAllowed: false,
      databaseWriteAllowed: false,
      persistenceAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      blindRetryAllowed: false,
    });
    expect(validatedAuthoritativeDepositProofOutcomeCandidate(outcome)).toEqual(outcome);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(
      Object.isFrozen(
        outcome && 'canonicalReference' in outcome ? outcome.canonicalReference : null,
      ),
    ).toBe(true);
  });

  it('also permits an exact same-customer proof without requiring submitter/owner equality', () => {
    const value = fixture();
    const sameCustomer = withAuthority(
      value,
      { ownerCustomerId: value.input.trustedRequest.submittingCustomerId },
      {},
      { ownerCustomerId: value.input.trustedRequest.submittingCustomerId },
    );
    expect(adapt(sameCustomer)).toMatchObject({
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
    });
  });

  it('fails swapped, excluded, inactive, and drifted customer authority closed', () => {
    const value = fixture();
    const candidates = [
      {
        ...value,
        input: {
          ...value.input,
          trustedRequest: {
            ...value.input.trustedRequest,
            submittingCustomerId: value.input.trustedPlayer.ownerCustomerId,
          },
        },
      },
      {
        ...value,
        input: {
          ...value.input,
          trustedPlayer: {
            ...value.input.trustedPlayer,
            ownerCustomerId: value.input.trustedRequest.submittingCustomerId,
          },
        },
      },
      withAuthority(
        value,
        { submittingCustomerMembershipState: 'excluded' },
        { submittingCustomerMembershipState: 'excluded' },
      ),
      withAuthority(
        value,
        { submittingCustomerCurrentState: 'inactive' },
        { submittingCustomerCurrentState: 'inactive' },
      ),
      withAuthority(
        value,
        { submittingCustomerSnapshotState: 'stale' },
        { submittingCustomerSnapshotState: 'stale' },
      ),
      withAuthority(
        value,
        { playerMembershipState: 'excluded' },
        {},
        { playerMembershipState: 'excluded' },
      ),
      withAuthority(
        value,
        { ownerCustomerBindingState: 'mismatched' },
        {},
        { ownerCustomerBindingState: 'mismatched' },
      ),
      withAuthority(
        value,
        { ownerCustomerCurrentState: 'inactive' },
        {},
        { ownerCustomerCurrentState: 'inactive' },
      ),
      withAuthority(
        value,
        { ownerCustomerSnapshotState: 'stale' },
        {},
        { ownerCustomerSnapshotState: 'stale' },
      ),
    ];
    for (const candidate of candidates) {
      expect(adapt(candidate)).toMatchObject({
        disposition: 'review_required',
        reasonCode: 'database_facts_unbound',
      });
    }
  });

  it('derives the principal only from the signed observation and never accepts a request amount', () => {
    const value = fixture(foundFacts({ amountMinor: 2_501 }));
    expect(adapt(value)).toMatchObject({
      disposition: 'settlement_candidate',
      principalAmountMinor: '2501',
    });
    expect(
      adaptTelebirrLivePilotOutcome(
        { ...value.input, trustedRequest: { ...value.input.trustedRequest, amountMinor: 999_999 } },
        value.signerSpki,
        value.deviceSpki,
      ),
    ).toBeUndefined();
  });

  it('keeps an authenticated but unattested provider 404 in review', () => {
    const outcome = adapt(
      fixture({
        lookupOutcome: 'review_required',
        reviewReason: 'provider_not_found_unattested',
        retrievedAt: '2026-08-20T18:03:00.000Z',
      }),
    );
    expect(outcome).toMatchObject({
      disposition: 'review_required',
      reasonCode: 'source_uncertain',
    });
  });

  it.each([
    [foundFacts({ referenceMatch: 'mismatched' }), 'reference_mismatch'],
    [
      foundFacts({
        receiverMatch: 'mismatched',
        creditedPartyNameDigest: digestTelebirrLivePilotReceiverName('Synthetic Other Receiver')!,
      }),
      'receiver_mismatch',
    ],
    [foundFacts({ providerFinalStatus: 'failed' }), 'receipt_failed'],
  ] as const)('maps an exact signed definite mismatch to rejection', (facts, reasonCode) => {
    expect(adapt(fixture(facts))).toMatchObject({ disposition: 'definite_reject', reasonCode });
  });

  it.each([
    [foundFacts({ providerFinalStatus: 'pending' }), 'receipt_pending'],
    [foundFacts({ providerFinalStatus: 'unknown' }), 'receipt_status_unknown'],
    [foundFacts({ receiverMatch: 'unknown', creditedPartyNameDigest: null }), 'source_uncertain'],
    [foundFacts({ amountMinor: null, currencyCode: 'unknown' }), 'source_uncertain'],
    [foundFacts({ amountMinor: 2_500_001 }), 'amount_out_of_range'],
  ] as const)('maps signed uncertainty or policy limits to review', (facts, reasonCode) => {
    expect(adapt(fixture(facts))).toMatchObject({ disposition: 'review_required', reasonCode });
  });

  it('fails the independent policy and database snapshot bindings closed', () => {
    const value = fixture();
    expect(
      adapt({
        ...value,
        input: {
          ...value.input,
          trustedPolicy: { ...value.input.trustedPolicy, policyDigest: sha('0') },
        },
      }),
    ).toMatchObject({ disposition: 'review_required', reasonCode: 'database_facts_unbound' });
    expect(
      adapt({
        ...value,
        input: {
          ...value.input,
          trustedDatabaseSnapshot: {
            ...value.input.trustedDatabaseSnapshot,
            snapshotDigest: sha('1'),
          },
        },
      }),
    ).toMatchObject({ disposition: 'review_required', reasonCode: 'database_facts_unbound' });
  });

  it('never settles a cryptographically invalid observation', () => {
    const value = fixture();
    const signedObservation = value.input.verificationInput.signedObservation;
    const outcome = adapt({
      ...value,
      input: {
        ...value.input,
        verificationInput: {
          ...value.input.verificationInput,
          signedObservation: {
            ...signedObservation,
            signature: `${signedObservation.signature.startsWith('A') ? 'B' : 'A'}${signedObservation.signature.slice(1)}`,
          },
        },
      },
    });
    expect(outcome).toMatchObject({
      disposition: 'review_required',
      reasonCode: 'source_uncertain',
    });
  });

  it('does not invoke accessors and rejects transparent and hostile proxies', () => {
    const value = fixture();
    let getterCalls = 0;
    const accessor = Object.defineProperty({ ...value.input }, 'trustedRequest', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return value.input.trustedRequest;
      },
    });
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile');
        },
      },
    );
    expect(
      adaptTelebirrLivePilotOutcome(accessor, value.signerSpki, value.deviceSpki),
    ).toBeUndefined();
    expect(getterCalls).toBe(0);
    expect(
      adaptTelebirrLivePilotOutcome(new Proxy(value.input, {}), value.signerSpki, value.deviceSpki),
    ).toBeUndefined();
    expect(
      adaptTelebirrLivePilotOutcome(hostile, value.signerSpki, value.deviceSpki),
    ).toBeUndefined();
    expect(
      adaptTelebirrLivePilotOutcome(value.input, new Proxy(value.signerSpki, {}), value.deviceSpki),
    ).toBeUndefined();
  });

  it('returns a frozen, fixed-key log projection with no sensitive bindings', () => {
    const outcome = adapt(fixture());
    const log = redactedTelebirrLivePilotOutcomeForLog(outcome);
    expect(Object.keys(log)).toEqual([
      'contractVersion',
      'providerCode',
      'safeFactsOnly',
      'disposition',
      'reasonCode',
      'advisoryOnly',
      'sqlAuthorizationAllowed',
      'transportAllowed',
      'networkAllowed',
      'databaseReadAllowed',
      'databaseWriteAllowed',
      'persistenceAllowed',
      'claimAllowed',
      'settlementAllowed',
      'enqueueAllowed',
      'executionAllowed',
      'financialActionAllowed',
      'blindRetryAllowed',
    ]);
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain(ids.request);
    expect(serialized).not.toContain('SYNTHETIC_PLAYER_01');
    expect(serialized).not.toContain(rawReference);
    expect(serialized).not.toContain('1234');
    expect(Object.isFrozen(log)).toBe(true);
  });
});
