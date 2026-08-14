import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE,
  CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT,
  CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
  CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT,
  CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
  evaluateCbeBirrOfficialSourcePolicy,
  redactedCbeBirrOfficialSourcePolicyResultForLog,
  type CbeBirrOfficialSourcePolicyBlockedResult,
  type CbeBirrOfficialSourcePolicyInvalidResult,
  type CbeBirrOfficialSourcePolicyResult,
} from './index.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { readonly eager: true; readonly import: 'default'; readonly query: '?raw' },
    ): Record<string, unknown>;
  }
}

const validRequest = () => ({
  contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile: CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
});

const blockedKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'advisoryOnly',
  'disposition',
  'evidenceSource',
  'reasonCode',
  'transportAllowed',
  'decryptionAllowed',
  'leaseAcquisitionAllowed',
  'providerRequestAllowed',
];

const invalidKeys = [
  'contractVersion',
  'providerCode',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'transportAllowed',
  'decryptionAllowed',
  'leaseAcquisitionAllowed',
  'providerRequestAllowed',
];

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nestedValue of Object.values(value)) expectDeeplyFrozen(nestedValue);
}

describe('CBE Birr official source policy', () => {
  it('returns the one exact deeply frozen blocked decision for the exact request', () => {
    const result = evaluateCbeBirrOfficialSourcePolicy(validRequest());

    expect(result).toBe(CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT);
    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      advisoryOnly: true,
      disposition: 'blocked',
      evidenceSource: 'provider_receipt_lookup',
      reasonCode: 'source_permission_unproven',
      transportAllowed: false,
      decryptionAllowed: false,
      leaseAcquisitionAllowed: false,
      providerRequestAllowed: false,
    });
    expect(Object.keys(result)).toEqual(blockedKeys);
    expect(Reflect.ownKeys(result)).toEqual(blockedKeys);
    expectDeeplyFrozen(result);

    const nullPrototypeRequest = Object.assign(Object.create(null), validRequest());
    expect(evaluateCbeBirrOfficialSourcePolicy(nullPrototypeRequest)).toBe(result);
    expect(evaluateCbeBirrOfficialSourcePolicy(validRequest())).toBe(result);
  });

  it('makes no positive capability or selection representable in the result type', () => {
    expectTypeOf<CbeBirrOfficialSourcePolicyBlockedResult['advisoryOnly']>().toEqualTypeOf<true>();
    expectTypeOf<CbeBirrOfficialSourcePolicyResult['transportAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrOfficialSourcePolicyResult['decryptionAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['leaseAcquisitionAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['providerRequestAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyBlockedResult['disposition']
    >().toEqualTypeOf<'blocked'>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyInvalidResult['disposition']
    >().toEqualTypeOf<'invalid_request'>();

    for (const result of [
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT,
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT,
    ]) {
      expect('selected' in result).toBe(false);
      expect('permitted' in result).toBe(false);
      expect('endpoint' in result).toBe(false);
    }
    expect(CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT.advisoryOnly).toBe(true);
  });

  it('returns one separate exact deeply frozen invalid constant for ordinary malformed values', () => {
    class CustomRequest {
      contractVersion = 1;
      providerCode = 'cbe_birr';
      sourceProfile = CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
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
      new CustomRequest(),
      customPrototype,
      {},
      { ...validRequest(), contractVersion: 2 },
      { ...validRequest(), providerCode: 'other' },
      { ...validRequest(), sourceProfile: 'other' },
      { ...validRequest(), sourceProfile: new String(CBE_BIRR_OFFICIAL_SOURCE_PROFILE) },
      { ...validRequest(), extra: false },
    ];

    const results = invalidCandidates.map(evaluateCbeBirrOfficialSourcePolicy);
    for (const result of results) {
      expect(result).toBe(CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT);
      expect(result).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        transportAllowed: false,
        decryptionAllowed: false,
        leaseAcquisitionAllowed: false,
        providerRequestAllowed: false,
      });
      expect(Object.keys(result)).toEqual(invalidKeys);
      expect(Reflect.ownKeys(result)).toEqual(invalidKeys);
      expectDeeplyFrozen(result);
    }
    expect(CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT).not.toBe(
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT,
    );
  });

  it.each([
    'url',
    'URL',
    'host',
    'path',
    'query',
    'header',
    'headers',
    'auth',
    'authorization',
    'token',
    'cookie',
    'credential',
    'credentials',
    'secret',
    'phone',
    'reference',
    'ciphertext',
    'keyVersion',
    'decryptor',
    'callback',
    'lease',
    'job',
    'approved',
    'permission',
  ])('rejects the non-contract field %s instead of accepting connection material', (field) => {
    const candidate: Record<string, unknown> = { ...validRequest() };
    candidate[field] = 'DO-NOT-ECHO-SENSITIVE-VALUE';

    expect(evaluateCbeBirrOfficialSourcePolicy(candidate)).toBe(
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT,
    );
    expect(JSON.stringify(evaluateCbeBirrOfficialSourcePolicy(candidate))).not.toContain(
      'DO-NOT-ECHO-SENSITIVE-VALUE',
    );
  });

  it('rejects non-enumerable, symbol, and accessor fields without reading accessors', () => {
    let accessorReads = 0;
    const accessorRequest = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
    } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, 'sourceProfile', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
      },
    });

    const nonEnumerableExpectedField = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableExpectedField, 'sourceProfile', {
      configurable: true,
      enumerable: false,
      value: CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
      writable: true,
    });
    const nonEnumerableExtra = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableExtra, 'secret', {
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
      expect(evaluateCbeBirrOfficialSourcePolicy(candidate)).toBe(
        CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT,
      );
    }
    expect(accessorReads).toBe(0);
  });

  it('rejects transparent, hostile, and revoked proxies without invoking any traps', () => {
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
      const result = evaluateCbeBirrOfficialSourcePolicy(candidate);
      expect(result).toBe(CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT);
      expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO');
    }
    expect(trapCalls).toBe(0);
  });

  it('emits one exact frozen safe log projection for an ordinary blocked result', () => {
    const ordinaryResult = { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT };
    const projection = redactedCbeBirrOfficialSourcePolicyResultForLog(ordinaryResult);

    expect(projection).toEqual(CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT);
    expect(Object.keys(projection)).toEqual(blockedKeys);
    expectDeeplyFrozen(projection);
    expect(redactedCbeBirrOfficialSourcePolicyResultForLog(ordinaryResult)).toBe(projection);
  });

  it('returns one exact frozen invalid log constant for forged or hostile result values', () => {
    let accessorReads = 0;
    let trapCalls = 0;
    const accessorResult = {
      ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT,
    } as Record<string, unknown>;
    Object.defineProperty(accessorResult, 'evidenceSource', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE;
      },
    });
    const symbolResult = {
      ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT,
    } as Record<PropertyKey, unknown>;
    symbolResult[Symbol('secret')] = 'DO-NOT-ECHO-SYMBOL';
    const proxyResult = new Proxy(CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, {
      ownKeys() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-PROXY');
      },
    });
    const revokedResult = Proxy.revocable(
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT },
      {
        getPrototypeOf() {
          trapCalls += 1;
          throw new Error('DO-NOT-ECHO-REVOKED');
        },
      },
    );
    revokedResult.revoke();
    const forgedResults: unknown[] = [
      null,
      [],
      {},
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT,
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, transportAllowed: true },
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, decryptionAllowed: true },
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, leaseAcquisitionAllowed: true },
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, providerRequestAllowed: true },
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, reasonCode: 'permitted' },
      { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT, endpoint: 'DO-NOT-ECHO-ENDPOINT' },
      accessorResult,
      symbolResult,
      proxyResult,
      revokedResult.proxy,
    ];

    const projections = forgedResults.map(redactedCbeBirrOfficialSourcePolicyResultForLog);
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

describe('dependency and runtime boundary', () => {
  it('declares no package dependencies', () => {
    const manifests = import.meta.glob('../package.json', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const manifestRaw = Object.values(manifests)[0];
    expect(manifestRaw).toBeTypeOf('string');
    const manifest = JSON.parse(manifestRaw!) as Record<string, unknown>;

    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it('has only the proxy detector runtime import and no execution-capable APIs', () => {
    const modules = import.meta.glob('./index.ts', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const source = Object.values(modules)[0];
    expect(source).toBeTypeOf('string');

    const staticSpecifiers = Array.from(
      source!.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
      (match) => match[1],
    ).filter((specifier): specifier is string => specifier !== undefined);
    expect(staticSpecifiers).toEqual(['node:util/types']);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bnew\s+URL\s*\(/u);
    expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);

    const forbiddenImportFragments = [
      'http',
      'https',
      'crypto',
      'config',
      'pg',
      'postgres',
      'worker',
      'sql',
      'fs',
    ];
    for (const specifier of staticSpecifiers) {
      for (const fragment of forbiddenImportFragments) {
        expect(specifier.toLowerCase()).not.toContain(fragment);
      }
    }
  });
});
