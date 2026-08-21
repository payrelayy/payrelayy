import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_ATTEMPTS,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_PAIRS,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_TIMEOUT_MS,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY,
  type CbeBirrAuthoritativeReceiptTransportResult,
} from './index.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string | readonly string[],
      options: { readonly eager: true; readonly import: 'default'; readonly query: '?raw' },
    ): Record<string, unknown>;
  }
}

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested);
}

describe('public CBE Birr authoritative receipt transport policy', () => {
  it('publishes one immutable fixed route and bounded one-attempt policy', () => {
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY).toEqual({
      contractVersion: 1,
      policyVersion: 1,
      method: 'GET',
      scheme: 'https',
      host: 'cbepay1.cbe.com.et',
      port: 443,
      path: '/aureceipt',
      queryParameterOrder: ['TID', 'PH'],
      redirectPolicy: 'reject_all',
      timeoutMs: 5_000,
      minResponseBytes: 64,
      maxResponseBytes: 1_048_576,
      maxHeaderBytes: 8_192,
      maxHeaderPairs: 32,
      maxAttempts: 1,
      contentType: 'application/pdf',
      contentEncoding: 'identity',
      requiredBodyMagic: '%PDF-',
      tlsCertificateValidation: 'required',
      minimumTlsVersion: 'TLSv1.2',
      resolvedAddressPolicy: 'public_only',
    });
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_TIMEOUT_MS).toBe(5_000);
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES).toBe(64);
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES).toBe(1_048_576);
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION).toBe(1);
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_BYTES).toBe(8_192);
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_PAIRS).toBe(32);
    expect(CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_ATTEMPTS).toBe(1);
    expectDeeplyFrozen(CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY);
  });

  it('makes response attestation, adapter authority, claims, persistence, wiring, and finance literal false', () => {
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['responseContractAttested']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['receiptFieldParsingAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['authoritativeAdapterAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['evidenceClaimAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['duplicateClaimAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['databaseAccessAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['persistenceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['runtimeWiringAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['settlementAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['financialActionAllowed']
    >().toEqualTypeOf<false>();
  });
});

describe('dependency and runtime isolation', () => {
  it('depends only on the pure official-source policy', () => {
    const manifests = import.meta.glob('../package.json', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const manifest = JSON.parse(Object.values(manifests)[0]!) as Record<string, unknown>;
    expect(manifest.dependencies).toEqual({
      '@fetanagent/cbe-birr-official-source-policy': 'workspace:*',
    });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('is not imported or depended on by any other workspace package or source', () => {
    const dormantPackages = [
      '@fetanagent/cbe-birr-authoritative-receipt-transport',
      '@fetanagent/cbe-birr-authoritative-pdf-parser',
    ] as const;
    const dormantPackageDirectories = [
      'cbe-birr-authoritative-receipt-transport',
      'cbe-birr-authoritative-pdf-parser',
    ] as const;
    const manifests = import.meta.glob(
      [
        '../../../package.json',
        '../../../{apps,packages}/*/package.json',
        '!../../../packages/cbe-birr-authoritative-receipt-transport/package.json',
        '!../../../packages/cbe-birr-authoritative-pdf-parser/package.json',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    ) as Record<string, string>;
    expect(Object.keys(manifests).length).toBeGreaterThan(0);
    for (const source of Object.values(manifests)) {
      for (const packageName of dormantPackages) expect(source).not.toContain(packageName);
    }

    const workspaceSources = import.meta.glob(
      [
        '../../../**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
        '!../../../**/dist/**',
        '!../../../**/coverage/**',
        '!../../../**/node_modules/**',
        '!../../../.git/**',
        '!../../../packages/cbe-birr-authoritative-receipt-transport/**',
        '!../../../packages/cbe-birr-authoritative-pdf-parser/**',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    ) as Record<string, string>;
    const externalSources = Object.values(workspaceSources);
    expect(externalSources.length).toBeGreaterThan(0);
    for (const source of externalSources) {
      for (const packageName of dormantPackages) expect(source).not.toContain(packageName);
      for (const directoryName of dormantPackageDirectories)
        expect(source).not.toContain(directoryName);
      expect(source).not.toContain('retrieveCbeBirrAuthoritativeReceipt');
      expect(source).not.toContain('parseCbeBirrAuthoritativePdf');
    }

    const ownManifests = import.meta.glob(
      ['../package.json', '../../cbe-birr-authoritative-pdf-parser/package.json'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    ) as Record<string, string>;
    expect(Object.keys(ownManifests)).toHaveLength(2);
    for (const source of Object.values(ownManifests)) {
      const manifest = JSON.parse(source) as { readonly name?: unknown };
      const otherPackage = dormantPackages.find((packageName) => packageName !== manifest.name);
      expect(otherPackage).toBeDefined();
      expect(source).not.toContain(otherPackage!);
    }

    const importPattern = (packageName: string): RegExp =>
      new RegExp(
        `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*)['"][^'"\\r\\n]*${packageName.replace(
          /[.*+?^${}()|[\]\\]/gu,
          '\\$&',
        )}(?:['"]|/)`,
        'u',
      );
    const ownSourceBoundaries = [
      {
        forbiddenPackage: dormantPackageDirectories[1],
        sources: import.meta.glob('./**/*.{ts,tsx,mts,cts,js,mjs,cjs}', {
          eager: true,
          import: 'default',
          query: '?raw',
        }) as Record<string, string>,
      },
      {
        forbiddenPackage: dormantPackageDirectories[0],
        sources: import.meta.glob(
          '../../cbe-birr-authoritative-pdf-parser/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
          {
            eager: true,
            import: 'default',
            query: '?raw',
          },
        ) as Record<string, string>,
      },
    ] as const;
    for (const boundary of ownSourceBoundaries) {
      expect(Object.keys(boundary.sources).length).toBeGreaterThan(0);
      const forbiddenImport = importPattern(boundary.forbiddenPackage);
      for (const source of Object.values(boundary.sources))
        expect(source).not.toMatch(forbiddenImport);
    }
  });

  it('keeps the fake transport seam internal and the public entry point free of caller-selected network targets', () => {
    const modules = import.meta.glob('./*.ts', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const entry = Object.entries(modules).find(([path]) => path.endsWith('/index.ts'))?.[1];
    expect(entry).toBeDefined();
    expect(entry).not.toContain('retrieveCbeBirrAuthoritativeReceiptWithTransport');
    expect(entry).not.toContain('SensitiveCbeBirrAuthoritativeReceiptRequestPlan');
    expect(entry).not.toContain('createCbeBirrNodeHttpsTransport');

    const productionSources = Object.entries(modules).filter(
      ([path]) => !path.endsWith('.test.ts') && !path.endsWith('/test-helpers.ts'),
    );
    expect(productionSources.length).toBeGreaterThan(0);
    for (const [path, source] of productionSources) {
      expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);
      expect(source).not.toMatch(/from ['"](?:pg|postgres|@supabase|@fetanagent\/config)/u);
      expect(source).not.toMatch(/from ['"]@fetanagent\/(?:contracts|domain)/u);
      expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|child_process)/u);
      if (!path.endsWith('/node-https-transport.ts')) {
        expect(source).not.toMatch(/from ['"]node:(?:https|dns|net|tls)/u);
      }
    }
  });

  it('has one minimal lock importer and introduces no new external resolution', () => {
    const locks = import.meta.glob('../../../pnpm-lock.yaml', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>;
    const lock = Object.values(locks)[0]!;
    const importer = lock.match(
      /  packages\/cbe-birr-authoritative-receipt-transport:\r?\n(?<body>(?:    .*\r?\n|      .*\r?\n|        .*\r?\n)+?)(?=\r?\n  packages\/)/u,
    );
    expect(importer?.groups?.body).toBe(
      "    dependencies:\n      '@fetanagent/cbe-birr-official-source-policy':\n        specifier: workspace:*\n        version: link:../cbe-birr-official-source-policy\n".replaceAll(
        '\n',
        lock.includes('\r\n') ? '\r\n' : '\n',
      ),
    );
    expect(importer?.groups?.body).not.toContain('parse5');
  });
});
