import { createHash } from 'node:crypto';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY,
  CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION,
  CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT,
  CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION,
  CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST,
  CBE_BIRR_NORMALIZATION_OWNERSHIP_INVALID_RESULT,
  CBE_BIRR_NORMALIZATION_OWNERSHIP_REMAINING_BLOCKERS,
  CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY,
  CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION,
  evaluateCbeBirrNormalizationOwnership,
  redactedCbeBirrNormalizationOwnershipForLog,
  type CbeBirrNormalizationOwnershipBlockedResult,
  type CbeBirrNormalizationOwnershipResult,
} from './index.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { readonly eager: true; readonly import: 'default'; readonly query: '?raw' },
    ): Record<string, unknown>;
  }
}

const disabledCapabilityKeys = [
  'authoritativeProfileSelectionAllowed',
  'crossProfileCompatibilityAssumptionAllowed',
  'crossProfileTransformationReuseAllowed',
  'implicitVersionUpgradeAllowed',
  'normalizationExecutionAllowed',
  'runtimeWiringAllowed',
  'providerRequestAllowed',
  'financialClaimAllowed',
] as const;

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nestedValue of Object.values(value)) expectDeeplyFrozen(nestedValue);
}

function oneRawSource(modules: Record<string, unknown>): string {
  const values = Object.values(modules);
  expect(values).toHaveLength(1);
  expect(values[0]).toBeTypeOf('string');
  return values[0] as string;
}

function normalizedSourceAttestation(source: string): `sha256:${string}` {
  const canonicalSource = `${source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trimEnd()}\n`;
  return `sha256:${createHash('sha256').update(canonicalSource, 'utf8').digest('hex')}`;
}

function exactSourceSlice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error('The reviewed source boundary is unavailable.');
  return source.slice(start, end).trimEnd();
}

function submittedReferenceCaptureSource(source: string): string {
  return [
    exactSourceSlice(source, 'import { createCipheriv', 'import { types as nodeUtilTypes'),
    exactSourceSlice(source, 'const REFERENCE_PATTERN', 'const DIRECT_PROOF_REFERENCE_PATTERN'),
    exactSourceSlice(source, 'const SECRET_PATTERN', 'export const DEPOSIT_REFERENCE_KEY_VERSION'),
    exactSourceSlice(
      source,
      'export const DEPOSIT_REFERENCE_KEY_VERSION',
      'export const DEPOSIT_PROOF_REFERENCE_KEY_VERSION',
    ),
    exactSourceSlice(
      source,
      'export class DepositReferenceProtectionError',
      'function validReference',
    ),
    exactSourceSlice(source, 'function validReference', 'function validDepositProofReference'),
    exactSourceSlice(source, 'function exactNonce', 'function exactDataProperties'),
    exactSourceSlice(
      source,
      '/**\n * Protects a customer-entered CBE Birr reference',
      '/**\n * Protects a provider receipt reference',
    ),
  ].join('\n\n');
}

describe('CBE Birr normalization ownership inventory', () => {
  it('returns one deeply frozen blocked inventory for the exact current metadata', () => {
    const result = evaluateCbeBirrNormalizationOwnership(
      CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST,
    );

    expect(CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION).toBe(1);
    expect(CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      submittedReferenceNormalizationVersion: null,
      submittedReferenceProtectionKeyVersion: 1,
      submittedReferenceSourceAttestation:
        'sha256:56a14b1b377a2d64de345ae03d390d0a01fa46f91a3af8017ed2137e74671195',
      fixtureSchemaLabel: 'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1',
      fixtureSchemaVersion: 1,
      fixtureNormalizerVersion: 1,
      fixtureAdapterLabel: 'fixture-adapter-v1',
      fixtureNormalizationLabel: 'fixture-normalizer-v1',
      fixtureNormalizerSourceAttestation:
        'sha256:362779764454f371171796cc7bf37e604732bad78694c10ebe0917afa8d3ea61',
      shadowSettlementContractVersion: 1,
      shadowSettlementNormalizationLabel: 'cbe-birr-normalization-v1',
    });
    expect(result).toBe(CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT);
    expect(result).toMatchObject({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'blocked',
      reasonCode: 'normalization_ownership_review_incomplete',
      authoritativeOwner: 'unassigned',
      jointReviewStatus: 'not_completed',
      remainingBlockers: [
        'lookup_reference_normalization_unreviewed',
        'receiver_lookup_normalization_unreviewed',
        'canonical_reference_normalization_unreviewed',
      ],
    });
    if (result.disposition !== 'blocked') throw new Error('expected blocked inventory');
    expect(result.remainingBlockers).toBe(CBE_BIRR_NORMALIZATION_OWNERSHIP_REMAINING_BLOCKERS);
    expect(result.profiles).toBe(CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY);
    expect(result.compatibility).toBe(CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY);
    expectDeeplyFrozen(CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST);
    expectDeeplyFrozen(result);

    const nullPrototypeRequest = Object.assign(
      Object.create(null),
      CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST,
    );
    expect(evaluateCbeBirrNormalizationOwnership(nullPrototypeRequest)).toBe(result);
  });

  it('records the three existing boundaries without assigning authoritative ownership', () => {
    expect(CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY).toEqual([
      {
        profileId: 'submitted_reference_capture',
        observedCodeBoundary: '@fetanagent/deposit-reference-protection',
        scope: 'submission_capture_protection_only',
        normalizationVersionLabel: null,
        versionStatus: 'normalization_version_absent',
        authoritativeOwner: 'unassigned',
        jointReviewStatus: 'not_completed',
        sourceAttestation:
          'sha256:56a14b1b377a2d64de345ae03d390d0a01fa46f91a3af8017ed2137e74671195',
        exactTransformations: [
          'reject_input_changed_by_trim',
          'require_5_to_128_ascii_alphanumeric_dot_underscore_or_hyphen_code_points',
          'map_ascii_lowercase_to_uppercase_with_string_to_upper_case',
        ],
        outputClass: 'uppercase_reference_inside_protection_boundary',
        authoritativeLookupEligible: false,
      },
      {
        profileId: 'offline_synthetic_fixture_reduction',
        observedCodeBoundary: '@fetanagent/cbe-birr-authoritative-fixtures',
        scope: 'offline_synthetic_fixture_only',
        normalizationVersionLabel: 'fixture-normalizer-v1',
        versionStatus: 'fixture_only_version',
        authoritativeOwner: 'unassigned',
        jointReviewStatus: 'not_completed',
        sourceAttestation:
          'sha256:362779764454f371171796cc7bf37e604732bad78694c10ebe0917afa8d3ea61',
        exactTransformations: [
          'reject_nonexact_shapes_accessors_proxies_extra_fields_and_unknown_values',
          'map_invalid_candidate_to_parser_unavailable',
          'map_exact_not_found_and_allowlisted_unavailable_uncertainty_to_safe_facts',
          'map_PROVIDER_API_PROVIDER_RECEIPT_LOOKUP_PROVIDER_ACCOUNT_ACTIVITY_to_lowercase_safe_facts',
          'map_MATCHED_MISMATCHED_UNKNOWN_provider_identity_to_lowercase_safe_facts',
          'map_COMPLETED_PENDING_FAILED_UNKNOWN_status_to_lowercase_safe_facts',
          'map_ETB_OTHER_UNKNOWN_currency_to_ETB_other_unknown',
          'map_SEND_MONEY_OTHER_UNKNOWN_payment_type_to_send_money_other_unknown',
          'validate_synthetic_canonical_reference_then_reduce_to_presence',
          'validate_positive_safe_integer_amount_or_null_then_preserve',
          'compare_synthetic_receiver_key_then_reduce_to_match_state',
          'preserve_only_exact_canonical_utc_timestamps',
          'allow_only_null_or_exact_fixture_adapter_normalization_and_digest_metadata_then_reduce_to_presence',
        ],
        outputClass: 'redacted_advisory_safe_facts',
        authoritativeLookupEligible: false,
      },
      {
        profileId: 'shadow_settlement_metadata_label',
        observedCodeBoundary: '@fetanagent/contracts',
        scope: 'advisory_shadow_settlement_metadata_only',
        normalizationVersionLabel: 'cbe-birr-normalization-v1',
        versionStatus: 'metadata_label_without_bound_normalizer',
        authoritativeOwner: 'unassigned',
        jointReviewStatus: 'not_completed',
        sourceAttestation: null,
        exactTransformations: [],
        outputClass: 'settlement_argument_label_only',
        authoritativeLookupEligible: false,
      },
    ]);
    expectDeeplyFrozen(CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY);
  });

  it('makes every cross-profile comparison and positive capability fail closed', () => {
    expect(CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY).toEqual([
      {
        leftProfileId: 'submitted_reference_capture',
        rightProfileId: 'offline_synthetic_fixture_reduction',
        status: 'not_established',
        equivalenceAllowed: false,
        transformationReuseAllowed: false,
      },
      {
        leftProfileId: 'submitted_reference_capture',
        rightProfileId: 'shadow_settlement_metadata_label',
        status: 'not_established',
        equivalenceAllowed: false,
        transformationReuseAllowed: false,
      },
      {
        leftProfileId: 'offline_synthetic_fixture_reduction',
        rightProfileId: 'shadow_settlement_metadata_label',
        status: 'not_established',
        equivalenceAllowed: false,
        transformationReuseAllowed: false,
      },
    ]);
    expectDeeplyFrozen(CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY);

    expectTypeOf<
      CbeBirrNormalizationOwnershipResult['authoritativeProfileSelectionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrNormalizationOwnershipResult['crossProfileCompatibilityAssumptionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrNormalizationOwnershipResult['crossProfileTransformationReuseAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrNormalizationOwnershipResult['implicitVersionUpgradeAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrNormalizationOwnershipBlockedResult['normalizationExecutionAllowed']
    >().toEqualTypeOf<false>();

    for (const result of [
      CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT,
      CBE_BIRR_NORMALIZATION_OWNERSHIP_INVALID_RESULT,
    ]) {
      for (const key of disabledCapabilityKeys) expect(result[key]).toBe(false);
      expect('ready' in result).toBe(false);
      expect('permitted' in result).toBe(false);
      expect('selectedProfile' in result).toBe(false);
    }
  });

  it('rejects unknown upgrades, extra material, accessors, and proxies without inspecting them', () => {
    let accessorReads = 0;
    let trapCalls = 0;
    const request = CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST;
    const accessorRequest = { ...request } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, 'fixtureNormalizationLabel', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'fixture-normalizer-v1';
      },
    });
    const hostileProxy = new Proxy(
      { ...request },
      {
        ownKeys() {
          trapCalls += 1;
          throw new Error('DO-NOT-ECHO-PROXY');
        },
      },
    );
    const revokedProxy = Proxy.revocable(
      { ...request },
      {
        getPrototypeOf() {
          trapCalls += 1;
          throw new Error('DO-NOT-ECHO-REVOKED');
        },
      },
    );
    revokedProxy.revoke();

    const invalidCandidates: unknown[] = [
      null,
      [],
      {},
      new Date(0),
      { ...request, submittedReferenceNormalizationVersion: 'v1' },
      { ...request, submittedReferenceProtectionKeyVersion: 2 },
      { ...request, submittedReferenceSourceAttestation: 'sha256:unreviewed' },
      { ...request, fixtureSchemaLabel: 'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V2' },
      { ...request, fixtureSchemaVersion: 2 },
      { ...request, fixtureNormalizerVersion: 2 },
      { ...request, fixtureAdapterLabel: 'fixture-adapter-v2' },
      { ...request, fixtureNormalizationLabel: 'fixture-normalizer-v2' },
      { ...request, fixtureNormalizerSourceAttestation: 'sha256:unreviewed' },
      { ...request, shadowSettlementContractVersion: 2 },
      { ...request, shadowSettlementNormalizationLabel: 'cbe-birr-normalization-v2' },
      { ...request, rawReference: 'DO-NOT-ECHO-REFERENCE' },
      { ...request, authoritativeProfileSelectionAllowed: true },
      Object.assign(Object.create({ inherited: true }), request),
      Object.assign({ extra: true }, request),
      accessorRequest,
      hostileProxy,
      revokedProxy.proxy,
    ];

    for (const candidate of invalidCandidates) {
      const result = evaluateCbeBirrNormalizationOwnership(candidate);
      expect(result).toBe(CBE_BIRR_NORMALIZATION_OWNERSHIP_INVALID_RESULT);
      expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO');
    }
    expect(accessorReads).toBe(0);
    expect(trapCalls).toBe(0);
  });

  it('emits only fixed summary metadata for logs', () => {
    const blockedProjection = redactedCbeBirrNormalizationOwnershipForLog(
      CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT,
    );
    expect(blockedProjection).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'blocked',
      reasonCode: 'normalization_ownership_review_incomplete',
      profileCount: 3,
      compatibilityPairCount: 3,
    });
    expectDeeplyFrozen(blockedProjection);

    const ordinaryClone = { ...CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT };
    const invalidProjection = redactedCbeBirrNormalizationOwnershipForLog(ordinaryClone);
    expect(invalidProjection).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'invalid_result',
      reasonCode: 'invalid_result',
    });
    expect(redactedCbeBirrNormalizationOwnershipForLog(new Proxy({}, {}))).toBe(invalidProjection);
    expectDeeplyFrozen(invalidProjection);
  });
});

describe('normalization inventory compatibility regressions', () => {
  it('pins the observed implementation facts without importing or composing their runtimes', () => {
    const protectionSource = oneRawSource(
      import.meta.glob('../../../packages/deposit-reference-protection/src/index.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const fixtureSource = oneRawSource(
      import.meta.glob('../../../packages/cbe-birr-authoritative-fixtures/src/normalizer.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const settlementSource = oneRawSource(
      import.meta.glob(
        '../../../packages/contracts/src/cbe-birr-authoritative-shadow-settlement.ts',
        {
          eager: true,
          import: 'default',
          query: '?raw',
        },
      ),
    );
    const inventorySource = oneRawSource(
      import.meta.glob('./normalization-ownership.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const submittedReferenceSource = submittedReferenceCaptureSource(protectionSource);

    expect(submittedReferenceSource).toContain('value === value.trim()');
    expect(submittedReferenceSource).toContain('const REFERENCE_PATTERN = /^[A-Za-z0-9._-]+$/u;');
    expect(submittedReferenceSource).toContain(
      'export const DEPOSIT_REFERENCE_MIN_CODE_POINTS = 5;',
    );
    expect(submittedReferenceSource).toContain(
      'export const DEPOSIT_REFERENCE_MAX_CODE_POINTS = 128;',
    );
    expect(submittedReferenceSource).toContain(
      'export const DEPOSIT_REFERENCE_KEY_VERSION = 1 as const;',
    );
    expect(submittedReferenceSource).toContain(
      'const normalizedReference = reference.toUpperCase();',
    );
    expect(normalizedSourceAttestation(submittedReferenceSource)).toBe(
      CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION,
    );

    expect(fixtureSource).toContain(
      'export const CBE_BIRR_AUTHORITATIVE_FIXTURE_NORMALIZER_VERSION = 1 as const;',
    );
    expect(fixtureSource).toContain(
      'export const CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA_VERSION = 1 as const;',
    );
    expect(fixtureSource).toContain("'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1' as const;");
    expect(fixtureSource).toContain("const FIXTURE_ADAPTER_VERSION = 'fixture-adapter-v1';");
    expect(fixtureSource).toContain(
      "const FIXTURE_NORMALIZATION_VERSION = 'fixture-normalizer-v1';",
    );
    expect(fixtureSource).toContain(
      'const SYNTHETIC_REFERENCE_PATTERN = /^SYN-CBE-[A-Z0-9]{8,24}$/;',
    );
    expect(fixtureSource).toContain('canonicalReferencePresent: canonicalReference !== null,');
    expect(fixtureSource).toContain(
      "return Object.freeze({ lookupOutcome: 'not_found' as const });",
    );
    expect(fixtureSource).toContain(
      "uncertainty !== 'provider' && uncertainty !== 'network' && uncertainty !== 'parser'",
    );
    expect(fixtureSource).toContain(
      '(!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0)',
    );
    expect(fixtureSource).toContain('amountMinor: amountMinor as number | null,');
    expect(fixtureSource).toContain("if (value === 'PROVIDER_API') return 'provider_api';");
    expect(fixtureSource).toContain("if (value === 'MATCHED') return 'matched';");
    expect(fixtureSource).toContain("? ('matched' as const)");
    expect(fixtureSource).toContain("if (value === 'COMPLETED') return 'completed';");
    expect(fixtureSource).toContain("if (value === 'ETB') return 'ETB';");
    expect(fixtureSource).toContain("if (value === 'SEND_MONEY') return 'send_money';");
    expect(fixtureSource).toContain('parsed.toISOString() === value');
    expect(fixtureSource).toContain('normalizationVersionPresent: normalizationVersion !== null,');
    expect(fixtureSource).toContain(
      '(adapterVersion !== null && adapterVersion !== FIXTURE_ADAPTER_VERSION)',
    );
    expect(fixtureSource).toContain(
      '(normalizationVersion !== null && normalizationVersion !== FIXTURE_NORMALIZATION_VERSION)',
    );
    expect(fixtureSource).toContain('!SYNTHETIC_DIGEST_PATTERN.test(evidenceDigest)');
    expect(normalizedSourceAttestation(fixtureSource)).toBe(
      CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION,
    );

    expect(settlementSource).toContain(
      'export const CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION = 1 as const;',
    );
    expect(settlementSource).toContain(
      "export const CBE_BIRR_SHADOW_NORMALIZATION_VERSION = 'cbe-birr-normalization-v1' as const;",
    );
    expect(settlementSource).toContain(
      'normalizationVersion: typeof CBE_BIRR_SHADOW_NORMALIZATION_VERSION',
    );

    const staticSpecifiers = Array.from(
      inventorySource.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
      (match) => match[1],
    ).filter((specifier): specifier is string => specifier !== undefined);
    expect(staticSpecifiers).toEqual(['node:util/types']);
    expect(inventorySource).not.toMatch(/\bimport\s*\(/u);
    expect(inventorySource).not.toMatch(/\brequire\s*\(/u);
    expect(inventorySource).not.toMatch(/\bfetch\s*\(/u);
    expect(inventorySource).not.toMatch(/\bprocess\s*\.\s*env\b/u);
    expect(inventorySource).not.toMatch(
      /\bcreate(?:Cipher|Decipher|Hash|Hmac|Sign|Verify)\w*\s*\(/u,
    );
    expect(inventorySource).not.toMatch(/\b(?:readFile|writeFile|connect|query)\s*\(/u);
  });
});
