import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE,
  CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
  CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT,
  CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT,
  CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
  evaluateCbeBirrOfficialSourcePolicy,
  redactedCbeBirrOfficialSourcePolicyResultForLog,
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

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested);
}

describe('CBE Birr official source policy v2', () => {
  it('defines one exact offline-only request profile while leaving live transport absent', () => {
    const result = evaluateCbeBirrOfficialSourcePolicy(validRequest());

    expect(result).toBe(CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT);
    expect(result).toEqual({
      contractVersion: 2,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      advisoryOnly: true,
      disposition: 'offline_profile_defined',
      evidenceSource: 'provider_receipt_lookup',
      reasonCode: 'live_transport_absent',
      requestProfile: {
        method: 'GET',
        scheme: 'https',
        host: 'cbepay1.cbe.com.et',
        port: 443,
        path: '/aureceipt',
        queryParameterOrder: ['TID', 'PH'],
        redirectPolicy: 'reject_all',
      },
      transportAllowed: false,
      providerRequestAllowed: false,
      decryptionAllowed: false,
      leaseAcquisitionAllowed: false,
      databaseAccessAllowed: false,
      persistenceAllowed: false,
      runtimeWiringAllowed: false,
      evidenceClaimAllowed: false,
      financialActionAllowed: false,
    });
    expect('requestProfile' in result && result.requestProfile).toBe(
      CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE,
    );
    expectDeeplyFrozen(result);
  });

  it('makes every live, durable, claim, runtime, and financial capability literal false', () => {
    expectTypeOf<CbeBirrOfficialSourcePolicyResult['transportAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['providerRequestAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['databaseAccessAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<CbeBirrOfficialSourcePolicyResult['persistenceAllowed']>().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['runtimeWiringAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['evidenceClaimAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrOfficialSourcePolicyResult['financialActionAllowed']
    >().toEqualTypeOf<false>();
  });

  it('rejects malformed, extra, accessor, proxy, and older-version requests without echoing them', () => {
    let accessorReads = 0;
    const accessor = { contractVersion: 2, providerCode: 'cbe_birr' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'sourceProfile', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
      },
    });
    const candidates: unknown[] = [
      null,
      {},
      { ...validRequest(), contractVersion: 1 },
      { ...validRequest(), extra: 'DO-NOT-ECHO' },
      accessor,
      new Proxy(validRequest(), {}),
    ];

    for (const candidate of candidates) {
      const result = evaluateCbeBirrOfficialSourcePolicy(candidate);
      expect(result).toBe(CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT);
      expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO');
    }
    expect(accessorReads).toBe(0);
    expectDeeplyFrozen(CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT);
  });

  it('revalidates results into a fixed allowlisted redacted log shape', () => {
    const projection = redactedCbeBirrOfficialSourcePolicyResultForLog({
      ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT,
      requestProfile: {
        ...CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE,
        queryParameterOrder: ['TID', 'PH'],
      },
    });
    expect(projection).toEqual(CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT);
    expectDeeplyFrozen(projection);

    const forged = redactedCbeBirrOfficialSourcePolicyResultForLog({
      ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT,
      transportAllowed: true,
      secret: 'DO-NOT-ECHO',
    });
    expect(forged).toEqual({
      contractVersion: 2,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'invalid_result',
      reasonCode: 'invalid_result',
    });
    expect(JSON.stringify(forged)).not.toContain('DO-NOT-ECHO');
  });
});

describe('dependency and runtime boundary', () => {
  it('pins only parse5 8.0.1 as the static parser dependency', () => {
    const manifests = import.meta.glob('../package.json', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const manifest = JSON.parse(Object.values(manifests)[0]!) as Record<string, unknown>;
    expect(manifest.dependencies).toEqual({ parse5: '8.0.1' });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('contains no network, environment, filesystem, database, or dynamic-loader API', () => {
    const modules = import.meta.glob('./*.ts', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const sources = Object.entries(modules).filter(([path]) => !path.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const [, source] of sources) {
      expect(source).not.toMatch(/\bimport\s*\(/u);
      expect(source).not.toMatch(/\brequire\s*\(/u);
      expect(source).not.toMatch(/\bfetch\s*\(/u);
      expect(source).not.toMatch(/SyntheticFixtureTransport/u);
      expect(source).not.toMatch(/\.\s*(?:load|fetch|request)\s*\(/u);
      expect(source).not.toMatch(/readonly\s+(?:load|fetch|request)\s*:\s*\([^;]*\)\s*=>/u);
      expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);
      expect(source).not.toMatch(/\b(?:readFile|writeFile|connect|query)\s*\(/u);
      expect(source).not.toMatch(/from ['"](?:node:)?(?:http|https|fs|net|tls|pg|postgres)/u);
    }
  });
});
