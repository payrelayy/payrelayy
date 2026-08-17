import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
  CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT,
  CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION,
  CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS,
  CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE,
  evaluateCbeBirrAuthoritativeLookupPrerequisites,
  redactedCbeBirrAuthoritativeLookupPrerequisiteForLog,
  type CbeBirrAuthoritativeLookupBlockedResult,
  type CbeBirrAuthoritativeLookupInvalidResult,
  type CbeBirrAuthoritativeLookupPrerequisiteResult,
} from './index.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { readonly eager: true; readonly import: 'default'; readonly query: '?raw' },
    ): Record<string, unknown>;
  }
}

const sourceProfile = 'cbe_birr_official_receipt_lookup_v1' as const;

const validRequest = () => ({
  contractVersion: CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile,
  legacyMaterialShape: CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE,
});

const disabledCapabilities = {
  ciphertextAcceptanceAllowed: false,
  plaintextAcceptanceAllowed: false,
  keyMaterialAllowed: false,
  normalizationAllowed: false,
  metadataInferenceAllowed: false,
  metadataBackfillAllowed: false,
  sourcePermissionAllowed: false,
  decryptionAllowed: false,
  transportAllowed: false,
  providerRequestAllowed: false,
  leaseAcquisitionAllowed: false,
  protectedMaterialReturnAllowed: false,
  persistenceAllowed: false,
  schemaMutationAllowed: false,
  runtimeWiringAllowed: false,
  financialClaimAllowed: false,
} as const;

const disabledCapabilityKeys = Object.keys(disabledCapabilities);
const blockedKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'legacyMaterialShape',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'remainingBlockers',
  ...disabledCapabilityKeys,
];
const invalidKeys = [
  'contractVersion',
  'providerCode',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  ...disabledCapabilityKeys,
];

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

describe('CBE Birr authoritative lookup prerequisite contract', () => {
  it('returns the sole exact, ordered, deeply frozen blocked result for the exact request', () => {
    const result = evaluateCbeBirrAuthoritativeLookupPrerequisites(validRequest());

    expect(result).toBe(CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT);
    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      legacyMaterialShape: 'cbe_birr_shadow_protected_lookup_material_legacy',
      advisoryOnly: true,
      disposition: 'blocked',
      reasonCode: 'authoritative_lookup_prerequisites_incomplete',
      remainingBlockers: [
        'source_permission_unproven',
        'receiver_lookup_protection_metadata_absent',
        'receiver_lookup_key_provenance_unproven',
        'receiver_lookup_new_revision_and_fresh_provisioning_required',
        'receiver_lookup_metadata_inference_or_backfill_forbidden',
        'submitted_reference_encryption_and_fingerprint_subkeys_share_api_master_provisioning_root',
        'submitted_reference_independent_worker_decrypt_lifecycle_absent',
        'lookup_reference_normalization_unreviewed',
        'receiver_lookup_normalization_unreviewed',
        'canonical_reference_normalization_unreviewed',
        'prelease_prerequisite_gate_absent',
        'lease_boundary_returns_protected_material',
      ],
      ...disabledCapabilities,
    });
    expect(Object.keys(result)).toEqual(blockedKeys);
    expect(Reflect.ownKeys(result)).toEqual(blockedKeys);
    expect(CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT.remainingBlockers).toBe(
      CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS,
    );
    expectDeeplyFrozen(result);

    const nullPrototypeRequest = Object.assign(Object.create(null), validRequest());
    expect(evaluateCbeBirrAuthoritativeLookupPrerequisites(nullPrototypeRequest)).toBe(result);
    expect(evaluateCbeBirrAuthoritativeLookupPrerequisites(validRequest())).toBe(result);
  });

  it('makes no positive, ready, or permitted capability representable', () => {
    expectTypeOf<CbeBirrAuthoritativeLookupBlockedResult['advisoryOnly']>().toEqualTypeOf<true>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupBlockedResult['disposition']
    >().toEqualTypeOf<'blocked'>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupInvalidResult['disposition']
    >().toEqualTypeOf<'invalid_request'>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['ciphertextAcceptanceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['plaintextAcceptanceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['keyMaterialAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['normalizationAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['metadataInferenceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['metadataBackfillAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['sourcePermissionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['decryptionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['transportAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['providerRequestAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['leaseAcquisitionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['protectedMaterialReturnAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['persistenceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['schemaMutationAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['runtimeWiringAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeLookupPrerequisiteResult['financialClaimAllowed']
    >().toEqualTypeOf<false>();

    for (const result of [
      CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
      CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT,
    ]) {
      for (const key of disabledCapabilityKeys) {
        expect(result[key as keyof typeof result]).toBe(false);
      }
      expect('ready' in result).toBe(false);
      expect('permitted' in result).toBe(false);
      expect('selected' in result).toBe(false);
      expect('endpoint' in result).toBe(false);
    }
  });

  it('returns one separate exact, deeply frozen invalid constant for malformed values', () => {
    class CustomRequest {
      contractVersion = 1;
      providerCode = 'cbe_birr';
      sourceProfile = sourceProfile;
      legacyMaterialShape = CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE;
    }

    const customPrototype = Object.assign(Object.create({ inherited: true }), validRequest());
    const invalidCandidates: unknown[] = [
      undefined,
      null,
      false,
      1,
      'cbe_birr',
      () => validRequest(),
      [],
      [validRequest()],
      new Date(0),
      new Map(),
      new CustomRequest(),
      customPrototype,
      {},
      { ...validRequest(), contractVersion: 2 },
      { ...validRequest(), providerCode: 'other' },
      { ...validRequest(), sourceProfile: 'other' },
      { ...validRequest(), legacyMaterialShape: 'other' },
      { ...validRequest(), sourceProfile: new String(sourceProfile) },
      { ...validRequest(), extra: false },
    ];

    for (const candidate of invalidCandidates) {
      const result = evaluateCbeBirrAuthoritativeLookupPrerequisites(candidate);
      expect(result).toBe(CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT);
      expect(result).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        ...disabledCapabilities,
      });
      expect(Object.keys(result)).toEqual(invalidKeys);
      expect(Reflect.ownKeys(result)).toEqual(invalidKeys);
      expectDeeplyFrozen(result);
    }
    expect(CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT).not.toBe(
      CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
    );
  });

  it.each([
    'id',
    'receiverId',
    'transactionReference',
    'plaintext',
    'ciphertext',
    'verificationReferenceCiphertext',
    'keyVersion',
    'keyId',
    'kmsAlias',
    'kmsArn',
    'algorithm',
    'encryptionPurpose',
    'url',
    'host',
    'route',
    'credential',
    'authorization',
    'cookie',
    'callback',
    'lease',
    'leaseToken',
    'sql',
    'database',
    'dbPool',
    'metadata',
    'normalizationVersion',
  ])('rejects the non-contract field %s without echoing its value', (field) => {
    const candidate: Record<string, unknown> = { ...validRequest() };
    candidate[field] = 'DO-NOT-ECHO-SENSITIVE-VALUE';

    const result = evaluateCbeBirrAuthoritativeLookupPrerequisites(candidate);
    expect(result).toBe(CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT);
    expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO-SENSITIVE-VALUE');
  });

  it('rejects non-enumerable, symbol, and accessor fields without reading accessors', () => {
    let accessorReads = 0;
    const accessorRequest = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile,
    } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, 'legacyMaterialShape', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE;
      },
    });

    const nonEnumerableExpectedField = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableExpectedField, 'legacyMaterialShape', {
      configurable: true,
      enumerable: false,
      value: CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE,
      writable: true,
    });
    const nonEnumerableExtra = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableExtra, 'ciphertext', {
      enumerable: false,
      value: 'DO-NOT-ECHO-NONENUMERABLE',
    });
    const symbolRequest = validRequest() as Record<PropertyKey, unknown>;
    symbolRequest[Symbol('secret')] = 'DO-NOT-ECHO-SYMBOL';

    for (const candidate of [
      accessorRequest,
      nonEnumerableExpectedField,
      nonEnumerableExtra,
      symbolRequest,
    ]) {
      expect(evaluateCbeBirrAuthoritativeLookupPrerequisites(candidate)).toBe(
        CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT,
      );
    }
    expect(accessorReads).toBe(0);
  });

  it('rejects transparent, hostile, and revoked proxies without invoking traps', () => {
    let trapCalls = 0;
    const handler: ProxyHandler<object> = {
      get() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-GET-TRAP');
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-DESCRIPTOR-TRAP');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-PROTOTYPE-TRAP');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-KEYS-TRAP');
      },
    };
    const transparentProxy = new Proxy(validRequest(), {});
    const hostileProxy = new Proxy(validRequest(), handler);
    const revokedProxy = Proxy.revocable(validRequest(), handler);
    revokedProxy.revoke();

    for (const candidate of [transparentProxy, hostileProxy, revokedProxy.proxy]) {
      const result = evaluateCbeBirrAuthoritativeLookupPrerequisites(candidate);
      expect(result).toBe(CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT);
      expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO');
    }
    expect(trapCalls).toBe(0);
  });

  it('emits one exact deeply frozen safe projection for an ordinary blocked result', () => {
    const ordinaryResult = {
      ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
      remainingBlockers: [...CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS],
    };
    const projection = redactedCbeBirrAuthoritativeLookupPrerequisiteForLog(ordinaryResult);

    expect(projection).toEqual(CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT);
    expect(Object.keys(projection)).toEqual(blockedKeys);
    expect(projection).not.toBe(ordinaryResult);
    expectDeeplyFrozen(projection);
    expect(redactedCbeBirrAuthoritativeLookupPrerequisiteForLog(ordinaryResult)).toBe(projection);
  });

  it('returns one frozen invalid log constant for forged or hostile result values', () => {
    let accessorReads = 0;
    let trapCalls = 0;
    const accessorResult = {
      ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
    } as Record<string, unknown>;
    Object.defineProperty(accessorResult, 'remainingBlockers', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS;
      },
    });
    const accessorBlockers = [...CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS];
    Object.defineProperty(accessorBlockers, '0', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'source_permission_unproven';
      },
    });
    const symbolResult = {
      ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
    } as Record<PropertyKey, unknown>;
    symbolResult[Symbol('secret')] = 'DO-NOT-ECHO-SYMBOL';
    const hostileBlockerProxy = new Proxy([...CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS], {
      ownKeys() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-BLOCKER-PROXY');
      },
    });
    const revokedBlockerProxy = Proxy.revocable(
      [...CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS],
      {
        getPrototypeOf() {
          trapCalls += 1;
          throw new Error('DO-NOT-ECHO-REVOKED-BLOCKER');
        },
      },
    );
    revokedBlockerProxy.revoke();
    const hostileResultProxy = new Proxy(CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT, {
      ownKeys() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-RESULT-PROXY');
      },
    });
    const forgedResults: unknown[] = [
      null,
      [],
      {},
      CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT,
      { ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT, transportAllowed: true },
      { ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT, keyMaterialAllowed: true },
      { ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT, financialClaimAllowed: true },
      { ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT, reasonCode: 'ready' },
      {
        ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
        remainingBlockers: CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS.slice(1),
      },
      { ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT, remainingBlockers: accessorBlockers },
      {
        ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
        remainingBlockers: hostileBlockerProxy,
      },
      {
        ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
        remainingBlockers: revokedBlockerProxy.proxy,
      },
      {
        ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
        ciphertext: 'DO-NOT-ECHO-CIPHERTEXT',
      },
      accessorResult,
      symbolResult,
      hostileResultProxy,
    ];

    const projections = forgedResults.map(redactedCbeBirrAuthoritativeLookupPrerequisiteForLog);
    for (const projection of projections) {
      expect(projection).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'invalid_result',
        reasonCode: 'invalid_result',
      });
      expect(Object.keys(projection)).toEqual([
        'contractVersion',
        'providerCode',
        'advisoryOnly',
        'disposition',
        'reasonCode',
      ]);
      expectDeeplyFrozen(projection);
      expect(projection).toBe(projections[0]);
      expect(JSON.stringify(projection)).not.toContain('DO-NOT-ECHO');
    }
    expect(accessorReads).toBe(0);
    expect(trapCalls).toBe(0);
  });
});

describe('dependency and production-source boundary', () => {
  it('declares only the pure Stage 1E policy workspace dependency', () => {
    const manifestRaw = oneRawSource(
      import.meta.glob('../package.json', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;

    expect(manifest.dependencies).toEqual({
      '@fetanagent/cbe-birr-official-source-policy': 'workspace:*',
    });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it('imports only the Stage 1E policy, trap-free proxy detector, and pure inventory module', () => {
    const source = oneRawSource(
      import.meta.glob('./index.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const staticSpecifiers = Array.from(
      source.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
      (match) => match[1],
    ).filter((specifier): specifier is string => specifier !== undefined);

    expect(staticSpecifiers).toEqual([
      '@fetanagent/cbe-birr-official-source-policy',
      'node:util/types',
      './normalization-ownership.js',
    ]);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);
    expect(source).not.toMatch(/\bcreate(?:Cipher|Decipher|Hash|Hmac|Sign|Verify)\w*\s*\(/u);
    expect(source).not.toMatch(/\b(?:readFile|writeFile|open|connect|query)\s*\(/u);

    const forbiddenImportFragments = [
      'http',
      'crypto',
      'config',
      'pg',
      'postgres',
      'database',
      'worker',
      'sql',
      'fs',
      'app',
    ];
    for (const specifier of staticSpecifiers) {
      for (const fragment of forbiddenImportFragments) {
        expect(specifier.toLowerCase()).not.toContain(fragment);
      }
    }
  });
});

describe('read-only repository prerequisite regressions', () => {
  it('pins the receiver legacy ciphertext shape, missing metadata, and immutable revision', () => {
    const coreMigration = oneRawSource(
      import.meta.glob(
        '../../../supabase/migrations/20260807235833_core_identity_and_configuration.sql',
        {
          eager: true,
          import: 'default',
          query: '?raw',
        },
      ),
    );
    const receiverTable = /create table app\.receiver_accounts \(([\s\S]*?)\n\);/u.exec(
      coreMigration,
    )?.[1];
    expect(receiverTable).toBeTypeOf('string');
    expect(receiverTable).toContain('verification_reference_ciphertext text,');
    const receiverColumnBlock = receiverTable!.split(/\n\s{2}constraint\b/u)[0]!;
    const receiverColumnNames = Array.from(
      receiverColumnBlock.matchAll(/^\s{2}([a-z][a-z0-9_]*)\s+/gmu),
      (match) => match[1],
    );
    expect(receiverColumnNames).toEqual([
      'id',
      'provider_id',
      'version',
      'account_holder_name',
      'account_reference_ciphertext',
      'verification_reference_ciphertext',
      'account_reference_masked',
      'instructions',
      'status',
      'active_from',
      'retired_at',
      'created_by_admin_id',
      'created_at',
      'updated_at',
    ]);
    expect(
      receiverColumnNames.filter((name) => name?.startsWith('verification_reference_')),
    ).toEqual(['verification_reference_ciphertext']);

    const immutableFunction =
      /create function app\.enforce_receiver_account_revision_immutable\(\)([\s\S]*?)\$\$;/u.exec(
        coreMigration,
      )?.[1];
    expect(immutableFunction).toBeTypeOf('string');
    expect(immutableFunction).toContain(
      'new.verification_reference_ciphertext is distinct from old.verification_reference_ciphertext',
    );
    expect(immutableFunction).toContain(
      'Receiver account revisions are immutable. Create a new version instead.',
    );
    expect(coreMigration).toMatch(
      /create trigger receiver_accounts_immutable_revision\s+before update on app\.receiver_accounts[\s\S]*?execute function app\.enforce_receiver_account_revision_immutable\(\);/u,
    );
  });

  it('pins the current mutating lease and its protected-material return boundary', () => {
    const shadowMigration = oneRawSource(
      import.meta.glob(
        '../../../supabase/migrations/20260814115713_cbe_birr_shadow_verification_foundation.sql',
        {
          eager: true,
          import: 'default',
          query: '?raw',
        },
      ),
    );
    const leaseFunction =
      /create function app\.lease_cbe_birr_shadow_verification_job\(([\s\S]*?)(?=\ncreate function app\.complete_cbe_birr_shadow_verification_job\()/u.exec(
        shadowMigration,
      )?.[1];
    expect(leaseFunction).toBeTypeOf('string');

    const returnShape = /returns table \(([\s\S]*?)\)\s+language plpgsql/u.exec(
      leaseFunction!,
    )?.[1];
    expect(returnShape).toBeTypeOf('string');
    const returnedFields = Array.from(
      returnShape!.matchAll(/^\s*([a-z][a-z0-9_]*)\s+\w+/gmu),
      (m) => m[1],
    );
    expect(returnedFields).toEqual([
      'job_id',
      'deposit_intent_id',
      'deposit_submission_id',
      'attempt_number',
      'lease_token',
      'lease_expires_at',
      'submitted_reference_ciphertext',
      'submitted_reference_key_version',
      'receiver_verification_reference_ciphertext',
      'receiver_account_id',
      'receiver_account_version',
      'expected_amount_minor',
      'currency_code',
      'opened_at',
      'payment_deadline_at',
      'verifier_version',
    ]);
    expect(leaseFunction).toMatch(
      /update app\.cbe_birr_shadow_verification_jobs shadow_job\s+set status = 'leased',\s+attempt_count = shadow_job\.attempt_count \+ 1,\s+lease_token = resolved_lease_token,/u,
    );
    expect(leaseFunction).toContain('submission.submitted_reference_ciphertext,');
    expect(leaseFunction).toContain('submission.reference_encryption_key_version,');
    expect(leaseFunction).toContain('receiver_account.verification_reference_ciphertext,');
    expect(leaseFunction).not.toContain('authoritative_lookup_prerequisites_incomplete');
  });

  it('pins distinct shared protection roots and treats uppercasing as submission-only behavior', () => {
    const apiSource = oneRawSource(
      import.meta.glob('../../../apps/api/src/postgres-telegram-player-action-runtime.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const protectionSource = oneRawSource(
      import.meta.glob('../../../packages/deposit-reference-protection/src/index.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const profileSource = oneRawSource(
      import.meta.glob('../../../packages/config/src/deposit-reference-profile.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    expect(protectionSource).toContain('const normalizedReference = reference.toUpperCase();');
    expect(protectionSource).toContain(
      "encryptionMaster = Buffer.from(secrets.encryptionSecret, 'hex');",
    );
    expect(protectionSource).toContain(
      "fingerprintMaster = Buffer.from(secrets.fingerprintSecret, 'hex');",
    );
    expect(protectionSource).toContain("createHmac('sha256', encryptionMaster)");
    expect(protectionSource).toContain("createHmac('sha256', fingerprintMaster)");
    expect(protectionSource).toContain('secrets.encryptionSecret === secrets.fingerprintSecret');
    expect(protectionSource).toContain('fetanagent:deposit-reference:encryption-key:v1');
    expect(protectionSource).toContain('fetanagent:deposit-reference:fingerprint-key:v1');
    expect(protectionSource.match(/reference\.toUpperCase\(\)/gu)).toHaveLength(1);
    expect(apiSource).toContain(
      "import { protectCbeBirrDepositReference } from '@fetanagent/deposit-reference-protection';",
    );
    expect(apiSource).not.toContain('reference.toUpperCase()');
    expect(profileSource).toContain('timingSafeEqual(actualEncryption, expectedEncryption)');
    expect(profileSource).toContain('timingSafeEqual(actualFingerprint, expectedFingerprint)');
    expect(profileSource).toContain('version !== CBE_DEPOSIT_REFERENCE_KEY_VERSION');
    expect(apiSource).not.toContain('cbe_birr_official_receipt_lookup_v1');
    expect(apiSource).not.toContain('@fetanagent/cbe-birr-official-source-policy');
    expect(protectionSource).not.toMatch(/authoritative|provider_receipt_lookup/iu);
  });

  it('keeps later migrations from silently satisfying receiver or lease blockers', () => {
    const migrationModules = import.meta.glob('../../../supabase/migrations/*.sql', {
      eager: true,
      import: 'default',
      query: '?raw',
    });
    const migrations = Object.entries(migrationModules)
      .map(([path, source]) => {
        expect(source).toBeTypeOf('string');
        return { path: path.replaceAll('\\', '/'), source: source as string };
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    expect(migrations.length).toBeGreaterThan(0);

    const coreMigrationName = '20260807235833_core_identity_and_configuration.sql';
    const foundationMigrationName = '20260814115713_cbe_birr_shadow_verification_foundation.sql';
    const laterThanCore = migrations.filter(
      ({ path }) => path.split('/').at(-1)! > coreMigrationName,
    );
    const laterThanFoundation = migrations.filter(
      ({ path }) => path.split('/').at(-1)! > foundationMigrationName,
    );

    for (const { source } of laterThanCore) {
      const ddlSource = source.replace(/--[^\r\n]*/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
      expect(ddlSource).not.toMatch(
        /\b(?:create|drop)\s+table(?:\s+if\s+(?:not\s+)?exists)?\s+(?:only\s+)?app\.receiver_accounts\b/iu,
      );
      const receiverAlterStatements = Array.from(
        ddlSource.matchAll(
          /\balter\s+table(?:\s+if\s+exists)?\s+(?:only\s+)?app\.receiver_accounts\b[^;]*;/giu,
        ),
        (match) => match[0],
      );
      for (const statement of receiverAlterStatements) {
        expect(statement).not.toMatch(/\bverification_reference_[a-z0-9_]+\b/iu);
        const changedColumnNames = [
          ...Array.from(
            statement.matchAll(
              /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z][a-z0-9_]*)/giu,
            ),
            (match) => match[1],
          ),
          ...Array.from(
            statement.matchAll(/\brename\s+column\s+([a-z][a-z0-9_]*)\s+to\s+([a-z][a-z0-9_]*)/giu),
            (match) => [match[1], match[2]],
          ).flat(),
        ].filter((name): name is string => name !== undefined);
        expect(
          changedColumnNames.filter((name) =>
            /(?:verification|lookup|cipher|encrypt|decrypt|key|kms|envelope|protection|provenance|purpose|algorithm|lifecycle|rotation|metadata|handle)/iu.test(
              name,
            ),
          ),
        ).toEqual([]);
      }
      expect(ddlSource).not.toMatch(
        /\b(?:create(?:\s+or\s+replace)?|alter|drop)\s+function\s+app\.enforce_receiver_account_revision_immutable\b/iu,
      );
      expect(ddlSource).not.toMatch(
        /\b(?:create|alter|drop)\s+trigger\s+receiver_accounts_immutable_revision\b/iu,
      );
    }

    for (const { source } of laterThanFoundation) {
      const ddlSource = source.replace(/--[^\r\n]*/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
      expect(ddlSource).not.toMatch(
        /\b(?:create(?:\s+or\s+replace)?|alter|drop)\s+function\s+app\.lease_cbe_birr_shadow_verification_job\b/iu,
      );
      const cbeBirrBoundaryNames = Array.from(
        ddlSource.matchAll(
          /\b(?:create(?:\s+or\s+replace)?|alter|drop)\s+(?:function|table|view|type)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:app\.)?([a-z][a-z0-9_]*)/giu,
        ),
        (match) => match[1],
      ).filter(
        (name): name is string =>
          name !== undefined &&
          name.toLowerCase().includes('cbe_birr') &&
          /(?:authoritative.*lookup|lookup.*authoritative|lease|prelease|prerequisite|opaque.*handle)/u.test(
            name.toLowerCase(),
          ),
      );
      expect(cbeBirrBoundaryNames).toEqual([]);
    }
  });

  it('has no production app, config, infrastructure, or workflow wiring', () => {
    const packageSpecifier = '@fetanagent/cbe-birr-authoritative-lookup-prerequisite';
    const productionCodeModules = {
      ...import.meta.glob('../../../apps/**/*.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../../packages/config/**/*.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    };
    const productionCodeEntries = Object.entries(productionCodeModules).filter(
      ([path]) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(path),
    );
    expect(productionCodeEntries.length).toBeGreaterThan(0);
    for (const [, sourceCandidate] of productionCodeEntries) {
      expect(sourceCandidate).toBeTypeOf('string');
      const source = (sourceCandidate as string)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*\/\/.*$/gmu, '')
        .replace(/\s+\/\/\s.*$/gmu, '');
      const moduleSpecifiers = [
        ...Array.from(
          source.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
          (match) => match[1],
        ),
        ...Array.from(
          source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
          (match) => match[1],
        ),
      ];
      expect(moduleSpecifiers).not.toContain(packageSpecifier);
    }

    const manifestModules = {
      ...import.meta.glob('../../../apps/*/package.json', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../../packages/config/package.json', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    };
    expect(Object.keys(manifestModules).length).toBeGreaterThan(0);
    for (const manifestCandidate of Object.values(manifestModules)) {
      expect(manifestCandidate).toBeTypeOf('string');
      const manifest = JSON.parse(manifestCandidate as string) as Record<string, unknown>;
      for (const dependencyKey of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        const dependencies = manifest[dependencyKey] as Record<string, unknown> | undefined;
        expect(dependencies?.[packageSpecifier]).toBeUndefined();
      }
      const scripts = manifest.scripts as Record<string, unknown> | undefined;
      expect(Object.values(scripts ?? {})).not.toContainEqual(
        expect.stringContaining(packageSpecifier),
      );
    }

    const operationalModules = {
      ...import.meta.glob('../../../infra/**/*.{mjs,yaml,yml,sh}', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../../.github/workflows/*.{yaml,yml}', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    };
    expect(Object.keys(operationalModules).length).toBeGreaterThan(0);
    for (const [path, sourceCandidate] of Object.entries(operationalModules)) {
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(path)) continue;
      expect(sourceCandidate).toBeTypeOf('string');
      const executableSource = (sourceCandidate as string)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*(?:#|\/\/).*$/gmu, '')
        .replace(/\s+(?:#|\/\/)\s.*$/gmu, '');
      expect(executableSource).not.toContain(packageSpecifier);
    }
  });
});
