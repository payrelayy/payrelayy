import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION,
  TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION,
  TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION,
  planTelebirrAndroidObservation,
  redactedTelebirrAndroidObservationPlanForLog,
  type TelebirrAndroidObservationPlan,
  type TelebirrAndroidObservationPlannerInput,
} from './android-observation.js';
import {
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  normalizeSyntheticTelebirrOfficialReceipt,
  syntheticTelebirrOfficialReceiptFixtureContext,
  syntheticTelebirrOfficialReceiptFixtures,
  type TelebirrSafeReceiptEvidence,
} from './synthetic-official-receipt.js';

const digest = (character: string): string => `fixture-sha256:${character.repeat(64)}`;
const fingerprint = (character: string): string => `fixture-hmac-sha256:${character.repeat(64)}`;

const baselineEvidence = normalizeSyntheticTelebirrOfficialReceipt(
  syntheticTelebirrOfficialReceiptFixtures.completed,
  syntheticTelebirrOfficialReceiptFixtureContext,
);

interface InputOverrides {
  readonly assessedAt?: string;
  readonly expectedBinding?: Readonly<Record<string, unknown>>;
  readonly observation?: Readonly<Record<string, unknown>>;
  readonly trustedChecks?: Readonly<Record<string, unknown>>;
  readonly evidence?: TelebirrSafeReceiptEvidence;
}

function inputWith(overrides: InputOverrides = {}): TelebirrAndroidObservationPlannerInput {
  const expectedBinding = {
    jobId: 'fixture-job-0001',
    attemptNumber: 1,
    leaseNonceDigest: digest('1'),
    submittedReferenceFingerprint: fingerprint('2'),
    deviceId: 'fixture-device-0001',
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    parserVersion: TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION,
    normalizerVersion: TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION,
    leaseIssuedAt: '2026-08-20T18:02:00.000Z',
    leaseExpiresAt: '2026-08-20T18:04:00.000Z',
    ...overrides.expectedBinding,
  } as TelebirrAndroidObservationPlannerInput['expectedBinding'];

  return {
    contractVersion: 1,
    providerCode: 'telebirr',
    assessedAt: overrides.assessedAt ?? '2026-08-20T18:03:05.000Z',
    expectedBinding,
    observation: {
      contractVersion: 1,
      providerCode: 'telebirr',
      jobId: 'fixture-job-0001',
      attemptNumber: 1,
      leaseNonceDigest: digest('1'),
      submittedReferenceFingerprint: fingerprint('2'),
      deviceId: 'fixture-device-0001',
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
      parserVersion: TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION,
      normalizerVersion: TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION,
      observedAt: '2026-08-20T18:03:00.000Z',
      evidence: overrides.evidence ?? baselineEvidence,
      ...overrides.observation,
    },
    trustedChecks: {
      signature: 'valid',
      replay: 'clear',
      device: 'active',
      ...overrides.trustedChecks,
    },
  } as TelebirrAndroidObservationPlannerInput;
}

const allCapabilitiesDisabled = {
  transportAllowed: false,
  networkAllowed: false,
  databaseWriteAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
} as const;

describe('TeleBirr Android observation advisory planner', () => {
  it('pins the protocol, parser, and normalizer versions', () => {
    expect(TELEBIRR_ANDROID_OBSERVATION_CONTRACT_VERSION).toBe(1);
    expect(TELEBIRR_ANDROID_OBSERVATION_PARSER_VERSION).toBe('telebirr-official-receipt-parser-v1');
    expect(TELEBIRR_ANDROID_OBSERVATION_NORMALIZER_VERSION).toBe(
      'telebirr-official-receipt-normalizer-v1',
    );
  });

  it('would forward one exactly bound safe observation without granting any capability', () => {
    const plan = planTelebirrAndroidObservation(inputWith());

    expect(plan).toEqual({
      contractVersion: 1,
      providerCode: 'telebirr',
      sourceProfile: 'telebirr_official_receipt_v1',
      advisoryOnly: true,
      disposition: 'would_forward_safe_observation',
      reasonCode: 'observation_bound',
      ...allCapabilitiesDisabled,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expectTypeOf(plan).toMatchTypeOf<TelebirrAndroidObservationPlan>();
  });

  it.each([
    ['jobId', 'fixture-job-0002'],
    ['attemptNumber', 2],
    ['leaseNonceDigest', digest('3')],
    ['submittedReferenceFingerprint', fingerprint('4')],
    ['deviceId', 'fixture-device-0002'],
  ] as const)('fails an exact %s binding mismatch closed', (field, value) => {
    expect(
      planTelebirrAndroidObservation(inputWith({ observation: { [field]: value } })),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'binding_mismatch',
      ...allCapabilitiesDisabled,
    });
  });

  it.each([
    ['sourceProfile', 'telebirr_official_receipt_v2', 'source_profile_mismatch'],
    ['parserVersion', 'telebirr-official-receipt-parser-v2', 'parser_version_mismatch'],
    ['normalizerVersion', 'telebirr-official-receipt-normalizer-v2', 'normalizer_version_mismatch'],
  ] as const)('fails %s incompatibility closed', (field, value, reasonCode) => {
    expect(
      planTelebirrAndroidObservation(inputWith({ observation: { [field]: value } })),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it.each([
    [{ device: 'revoked' }, 'device_revoked'],
    [{ device: 'offline' }, 'device_unavailable'],
    [{ device: 'unknown' }, 'device_unavailable'],
    [{ signature: 'invalid' }, 'signature_invalid'],
    [{ signature: 'unavailable' }, 'signature_unavailable'],
    [{ replay: 'replayed' }, 'replay_detected'],
    [{ replay: 'unavailable' }, 'replay_check_unavailable'],
  ] as const)('fails trusted check %j closed', (trustedChecks, reasonCode) => {
    expect(planTelebirrAndroidObservation(inputWith({ trustedChecks }))).toMatchObject({
      disposition: 'would_review',
      reasonCode,
      ...allCapabilitiesDisabled,
    });
  });

  it('treats the exact lease expiry boundary as expired', () => {
    expect(
      planTelebirrAndroidObservation(inputWith({ assessedAt: '2026-08-20T18:04:00.000Z' })),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'lease_expired' });
  });

  it.each([
    {
      label: 'before lease issue',
      expectedBinding: { leaseIssuedAt: '2026-08-20T18:03:01.000Z' },
      observation: {},
    },
    {
      label: 'at lease expiry',
      expectedBinding: {},
      observation: {
        observedAt: '2026-08-20T18:04:00.000Z',
        evidence: { ...baselineEvidence, retrievedAt: '2026-08-20T18:04:00.000Z' },
      },
    },
    {
      label: 'too far ahead of assessment',
      expectedBinding: { leaseExpiresAt: '2026-08-20T18:20:00.000Z' },
      observation: {
        observedAt: '2026-08-20T18:08:05.001Z',
        evidence: { ...baselineEvidence, retrievedAt: '2026-08-20T18:08:05.001Z' },
      },
    },
  ])('fails $label observation time closed', ({ expectedBinding, observation }) => {
    expect(
      planTelebirrAndroidObservation(inputWith({ expectedBinding, observation })),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'observation_time_invalid' });
  });

  it('fails provider, network, parser, or device uncertainty closed', () => {
    for (const uncertainty of ['provider', 'network', 'parser', 'device'] as const) {
      expect(
        planTelebirrAndroidObservation(
          inputWith({ evidence: { lookupOutcome: 'unavailable', uncertainty } }),
        ),
      ).toMatchObject({ disposition: 'would_review', reasonCode: 'receipt_unavailable' });
    }
  });

  it('allows an exactly bound not-found observation to be forwarded only as safe evidence', () => {
    expect(
      planTelebirrAndroidObservation(inputWith({ evidence: { lookupOutcome: 'not_found' } })),
    ).toMatchObject({
      disposition: 'would_forward_safe_observation',
      reasonCode: 'observation_bound',
      ...allCapabilitiesDisabled,
    });
  });

  it('requires exact retrieval binding and complete provenance for found evidence', () => {
    if (baselineEvidence.lookupOutcome !== 'found') throw new Error('fixture invariant');

    const wrongRetrieval = {
      ...baselineEvidence,
      retrievedAt: '2026-08-20T18:02:59.999Z',
    } as const;
    const incompleteProvenance = {
      ...baselineEvidence,
      provenance: { ...baselineEvidence.provenance, evidenceDigestPresent: false },
    } as const;

    for (const evidence of [wrongRetrieval, incompleteProvenance]) {
      expect(planTelebirrAndroidObservation(inputWith({ evidence }))).toMatchObject({
        disposition: 'would_review',
        reasonCode: 'receipt_provenance_incomplete',
      });
    }
  });

  it('rejects malformed shapes, extras, accessors, proxies, and untrusted check values', () => {
    const getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({}, 'contractVersion', {
      enumerable: true,
      get: getter,
    });
    const proxy = new Proxy(inputWith(), {});
    const extra = { ...inputWith(), rawReference: 'hidden' };
    const badCheck = inputWith({ trustedChecks: { signature: 'caller_says_valid' } });

    for (const candidate of [accessor, proxy, extra, badCheck]) {
      expect(planTelebirrAndroidObservation(candidate)).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        ...allCapabilitiesDisabled,
      });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('projects only a revalidated fixed plan without opaque bindings or receipt facts', () => {
    const plan = planTelebirrAndroidObservation(inputWith());
    const projection = redactedTelebirrAndroidObservationPlanForLog(plan);
    const serialized = JSON.stringify(projection);

    expect(projection).toEqual(plan);
    expect(serialized).not.toContain('fixture-job');
    expect(serialized).not.toContain('fixture-device');
    expect(serialized).not.toContain('fixture-sha256');
    expect(serialized).not.toContain('amountMinor');

    expect(
      redactedTelebirrAndroidObservationPlanForLog({ ...plan, networkAllowed: true }),
    ).toMatchObject({ disposition: 'invalid_request', ...allCapabilitiesDisabled });
  });
});
