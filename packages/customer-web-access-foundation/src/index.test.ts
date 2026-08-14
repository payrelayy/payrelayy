import { describe, expect, expectTypeOf, it } from 'vitest';

import * as foundation from './index.js';
import {
  CUSTOMER_WEB_ACCESS_BLOCKED_RESULT,
  CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION,
  CUSTOMER_WEB_ACCESS_INVALID_RESULT,
  CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE,
  evaluateCustomerWebAccessFoundation,
  redactedCustomerWebAccessFoundationForLog,
  type CustomerWebAccessFoundationBlockedResult,
  type CustomerWebAccessFoundationInvalidResult,
  type CustomerWebAccessFoundationResult,
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
  contractVersion: CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION,
  productProfile: CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE,
  surfaceMode: 'standalone_web_pwa_intent' as const,
  telegramRelationship: 'optional_link_without_identity_merge' as const,
  locale: 'en' as const,
  vocabularyProfile: 'neutral_customer_access' as const,
  accountAuthenticationIntent: 'email_password' as const,
  accountCreationIntent: 'self_service' as const,
  sessionIntent: 'persistent_until_explicit_sign_out_or_security_revocation' as const,
  emailIntent: 'recovery_confirmation_request_only' as const,
  additionalAuthenticationIntent: 'none_requested' as const,
});

const disabledCapabilities = {
  webRuntimeAllowed: false,
  pwaInstallationAllowed: false,
  serviceWorkerAllowed: false,
  networkAllowed: false,
  cookieAllowed: false,
  browserStorageAllowed: false,
  authProviderAllowed: false,
  accountCreationAllowed: false,
  credentialAcceptanceAllowed: false,
  passwordAcceptanceAllowed: false,
  emailCollectionAllowed: false,
  emailAuthenticationAllowed: false,
  recoveryEmailRequestAllowed: false,
  recoveryEmailConfirmationAllowed: false,
  sessionCreationAllowed: false,
  sessionPersistenceAllowed: false,
  telegramLinkingAllowed: false,
  telegramIdentityMergeAllowed: false,
  databaseAllowed: false,
  persistenceAllowed: false,
  runtimeWiringAllowed: false,
  platformActionAllowed: false,
  financialCapabilityAllowed: false,
} as const;

const disabledCapabilityKeys = Object.keys(disabledCapabilities);
const blockedKeys = [
  'contractVersion',
  'productProfile',
  'surfaceMode',
  'telegramRelationship',
  'locale',
  'vocabularyProfile',
  'accountAuthenticationIntent',
  'accountCreationIntent',
  'sessionIntent',
  'emailIntent',
  'additionalAuthenticationIntent',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  ...disabledCapabilityKeys,
];
const invalidKeys = [
  'contractVersion',
  'productProfile',
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

describe('customer web access foundation', () => {
  it('returns the sole exact frozen blocked result for the reviewed product decisions', () => {
    expect(Object.keys(validRequest())).toHaveLength(11);
    const result = evaluateCustomerWebAccessFoundation(validRequest());

    expect(result).toBe(CUSTOMER_WEB_ACCESS_BLOCKED_RESULT);
    expect(result).toEqual({
      contractVersion: 1,
      productProfile: 'fetanagent_customer_web_access_foundation_v1',
      surfaceMode: 'standalone_web_pwa_intent',
      telegramRelationship: 'optional_link_without_identity_merge',
      locale: 'en',
      vocabularyProfile: 'neutral_customer_access',
      accountAuthenticationIntent: 'email_password',
      accountCreationIntent: 'self_service',
      sessionIntent: 'persistent_until_explicit_sign_out_or_security_revocation',
      emailIntent: 'recovery_confirmation_request_only',
      additionalAuthenticationIntent: 'none_requested',
      advisoryOnly: true,
      disposition: 'blocked',
      reasonCode: 'customer_web_access_runtime_not_implemented',
      ...disabledCapabilities,
    });
    expect(Object.keys(result)).toEqual(blockedKeys);
    expect(Reflect.ownKeys(result)).toEqual(blockedKeys);
    expectDeeplyFrozen(result);

    const nullPrototypeRequest = Object.assign(Object.create(null), validRequest());
    expect(evaluateCustomerWebAccessFoundation(nullPrototypeRequest)).toBe(result);
    expect(evaluateCustomerWebAccessFoundation(validRequest())).toBe(result);
  });

  it('keeps intent distinct from runtime readiness and every capability false-only', () => {
    type CapabilityKey = keyof typeof disabledCapabilities;

    expectTypeOf<CustomerWebAccessFoundationResult[CapabilityKey]>().toEqualTypeOf<false>();
    expectTypeOf<CustomerWebAccessFoundationBlockedResult['advisoryOnly']>().toEqualTypeOf<true>();
    expectTypeOf<
      CustomerWebAccessFoundationBlockedResult['disposition']
    >().toEqualTypeOf<'blocked'>();
    expectTypeOf<
      CustomerWebAccessFoundationInvalidResult['disposition']
    >().toEqualTypeOf<'invalid_request'>();
    expectTypeOf<
      CustomerWebAccessFoundationBlockedResult['additionalAuthenticationIntent']
    >().toEqualTypeOf<'none_requested'>();
    expectTypeOf<
      CustomerWebAccessFoundationBlockedResult['accountAuthenticationIntent']
    >().toEqualTypeOf<'email_password'>();
    expectTypeOf<
      CustomerWebAccessFoundationBlockedResult['accountCreationIntent']
    >().toEqualTypeOf<'self_service'>();

    expect(disabledCapabilityKeys).toHaveLength(23);
    for (const result of [CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, CUSTOMER_WEB_ACCESS_INVALID_RESULT]) {
      for (const key of disabledCapabilityKeys) {
        expect(result[key as keyof typeof result]).toBe(false);
      }
      expect('ready' in result).toBe(false);
      expect('permitted' in result).toBe(false);
      expect('authenticated' in result).toBe(false);
      expect('session' in result).toBe(false);
    }
  });

  it('returns one separate exact deeply frozen invalid result for malformed values', () => {
    class CustomRequest {
      contractVersion = 1;
      productProfile = CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE;
      surfaceMode = 'standalone_web_pwa_intent';
      telegramRelationship = 'optional_link_without_identity_merge';
      locale = 'en';
      vocabularyProfile = 'neutral_customer_access';
      accountAuthenticationIntent = 'email_password';
      accountCreationIntent = 'self_service';
      sessionIntent = 'persistent_until_explicit_sign_out_or_security_revocation';
      emailIntent = 'recovery_confirmation_request_only';
      additionalAuthenticationIntent = 'none_requested';
    }

    const customPrototype = Object.assign(Object.create({ inherited: true }), validRequest());
    const invalidCandidates: unknown[] = [
      undefined,
      null,
      false,
      1,
      'standalone_web',
      () => validRequest(),
      [],
      [validRequest()],
      new Date(0),
      new Map(),
      new CustomRequest(),
      customPrototype,
      {},
      { ...validRequest(), contractVersion: 2 },
      { ...validRequest(), productProfile: 'other' },
      { ...validRequest(), surfaceMode: 'embedded' },
      { ...validRequest(), telegramRelationship: 'required' },
      { ...validRequest(), locale: 'am' },
      { ...validRequest(), vocabularyProfile: 'non_neutral' },
      { ...validRequest(), accountAuthenticationIntent: 'unsupported_authentication' },
      { ...validRequest(), accountCreationIntent: 'administrator_provisioned' },
      { ...validRequest(), sessionIntent: 'browser_default' },
      { ...validRequest(), emailIntent: 'login_and_marketing' },
      { ...validRequest(), additionalAuthenticationIntent: 'required' },
      { ...validRequest(), extra: false },
    ];

    for (const candidate of invalidCandidates) {
      const result = evaluateCustomerWebAccessFoundation(candidate);
      expect(result).toBe(CUSTOMER_WEB_ACCESS_INVALID_RESULT);
      expect(result).toEqual({
        contractVersion: 1,
        productProfile: 'fetanagent_customer_web_access_foundation_v1',
        advisoryOnly: true,
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        ...disabledCapabilities,
      });
      expect(Object.keys(result)).toEqual(invalidKeys);
      expect(Reflect.ownKeys(result)).toEqual(invalidKeys);
      expectDeeplyFrozen(result);
    }
    expect(CUSTOMER_WEB_ACCESS_INVALID_RESULT).not.toBe(CUSTOMER_WEB_ACCESS_BLOCKED_RESULT);
  });

  it.each([
    'email',
    'emailAddress',
    'password',
    'credential',
    'accessToken',
    'refreshToken',
    'recoveryToken',
    'confirmationCode',
    'cookie',
    'session',
    'sessionId',
    'storageKey',
    'telegramUserId',
    'telegramChatId',
    'customerId',
    'database',
    'sql',
    'provider',
    'featureSwitch',
    'financialAction',
  ])('rejects the non-contract field %s without echoing its value', (field) => {
    const candidate: Record<string, unknown> = { ...validRequest() };
    candidate[field] = 'DO-NOT-ECHO-CUSTOMER-MATERIAL';

    const result = evaluateCustomerWebAccessFoundation(candidate);
    expect(result).toBe(CUSTOMER_WEB_ACCESS_INVALID_RESULT);
    expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO-CUSTOMER-MATERIAL');
  });

  it('rejects non-enumerable, symbol, and accessor fields without reading accessors', () => {
    let accessorReads = 0;
    const accessorRequest = {
      contractVersion: 1,
      productProfile: CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE,
      surfaceMode: 'standalone_web_pwa_intent',
      telegramRelationship: 'optional_link_without_identity_merge',
      locale: 'en',
      vocabularyProfile: 'neutral_customer_access',
      accountAuthenticationIntent: 'email_password',
      accountCreationIntent: 'self_service',
      sessionIntent: 'persistent_until_explicit_sign_out_or_security_revocation',
      emailIntent: 'recovery_confirmation_request_only',
    } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, 'additionalAuthenticationIntent', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'none_requested';
      },
    });

    const nonEnumerableExpectedField = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableExpectedField, 'additionalAuthenticationIntent', {
      configurable: true,
      enumerable: false,
      value: 'none_requested',
      writable: true,
    });
    const nonEnumerableExtra = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerableExtra, 'password', {
      enumerable: false,
      value: 'DO-NOT-ECHO-NONENUMERABLE',
    });
    const symbolRequest = validRequest() as Record<PropertyKey, unknown>;
    symbolRequest[Symbol('token')] = 'DO-NOT-ECHO-SYMBOL';

    for (const candidate of [
      accessorRequest,
      nonEnumerableExpectedField,
      nonEnumerableExtra,
      symbolRequest,
    ]) {
      expect(evaluateCustomerWebAccessFoundation(candidate)).toBe(
        CUSTOMER_WEB_ACCESS_INVALID_RESULT,
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
      const result = evaluateCustomerWebAccessFoundation(candidate);
      expect(result).toBe(CUSTOMER_WEB_ACCESS_INVALID_RESULT);
      expect(JSON.stringify(result)).not.toContain('DO-NOT-ECHO');
    }
    expect(trapCalls).toBe(0);
  });

  it('emits one exact frozen safe log projection for an ordinary blocked result', () => {
    const ordinaryResult = { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT };
    const projection = redactedCustomerWebAccessFoundationForLog(ordinaryResult);

    expect(projection).toEqual(CUSTOMER_WEB_ACCESS_BLOCKED_RESULT);
    expect(Object.keys(projection)).toEqual(blockedKeys);
    expect(projection).not.toBe(ordinaryResult);
    expectDeeplyFrozen(projection);
    expect(redactedCustomerWebAccessFoundationForLog(ordinaryResult)).toBe(projection);
  });

  it('returns one exact frozen invalid log constant for forged or hostile result values', () => {
    let accessorReads = 0;
    let trapCalls = 0;
    const accessorResult = {
      ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT,
    } as Record<string, unknown>;
    Object.defineProperty(accessorResult, 'sessionIntent', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'persistent_until_explicit_sign_out_or_security_revocation';
      },
    });
    const symbolResult = {
      ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT,
    } as Record<PropertyKey, unknown>;
    symbolResult[Symbol('email')] = 'DO-NOT-ECHO-SYMBOL';
    const hostileProxy = new Proxy(CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, {
      ownKeys() {
        trapCalls += 1;
        throw new Error('DO-NOT-ECHO-PROXY');
      },
    });
    const revokedProxy = Proxy.revocable(
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT },
      {
        getPrototypeOf() {
          trapCalls += 1;
          throw new Error('DO-NOT-ECHO-REVOKED');
        },
      },
    );
    revokedProxy.revoke();
    const forgedResults: unknown[] = [
      null,
      [],
      {},
      CUSTOMER_WEB_ACCESS_INVALID_RESULT,
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, webRuntimeAllowed: true },
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, sessionPersistenceAllowed: true },
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, recoveryEmailRequestAllowed: true },
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, telegramLinkingAllowed: true },
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, financialCapabilityAllowed: true },
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, reasonCode: 'ready' },
      { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT, email: 'DO-NOT-ECHO-EMAIL' },
      accessorResult,
      symbolResult,
      hostileProxy,
      revokedProxy.proxy,
    ];

    const projections = forgedResults.map(redactedCustomerWebAccessFoundationForLog);
    for (const projection of projections) {
      expect(projection).toEqual({
        contractVersion: 1,
        productProfile: 'fetanagent_customer_web_access_foundation_v1',
        advisoryOnly: true,
        disposition: 'invalid_result',
        reasonCode: 'invalid_result',
      });
      expect(Object.keys(projection)).toEqual([
        'contractVersion',
        'productProfile',
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
  it('exports only the fixed pure contract surface at runtime', () => {
    expect(Object.keys(foundation).sort()).toEqual(
      [
        'CUSTOMER_WEB_ACCESS_BLOCKED_RESULT',
        'CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION',
        'CUSTOMER_WEB_ACCESS_INVALID_RESULT',
        'CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE',
        'evaluateCustomerWebAccessFoundation',
        'redactedCustomerWebAccessFoundationForLog',
      ].sort(),
    );
  });

  it('declares no package dependencies', () => {
    const manifestRaw = oneRawSource(
      import.meta.glob('../package.json', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;

    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it('has only trap-free proxy detection and no web, auth, persistence, or financial API', () => {
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

    expect(staticSpecifiers).toEqual(['node:util/types']);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bnew\s+URL\s*\(/u);
    expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);
    expect(source).not.toMatch(/\bprocess\s*\.\s*getBuiltinModule\b/u);
    expect(source).not.toMatch(/\b(?:WebSocket|XMLHttpRequest|EventSource)\b/u);
    expect(source).not.toMatch(
      /\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB|caches)\s*[.\[]/u,
    );
    expect(source).not.toMatch(
      /\b(?:createClient|signIn|signUp|setSession|refreshSession|query|connect|open)\s*\(/u,
    );
    expect(source).not.toMatch(/\b(?:readFile|writeFile|createServer|createConnection)\s*\(/u);
    expect(source).not.toMatch(
      /\b(?:http|https|crypto|postgres|supabase|service_role|anon_key):/iu,
    );
  });

  it('is not imported or invoked by production apps, config, infrastructure, or workflows', () => {
    const packageSpecifier = '@fetanagent/customer-web-access-foundation';
    const forbiddenWiringTokens = [
      packageSpecifier,
      'packages/customer-web-access-foundation',
      'customer-web-access-foundation',
    ];
    const productionCodeModules = {
      ...import.meta.glob('../../../apps/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../../packages/config/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
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
      for (const moduleSpecifier of moduleSpecifiers) {
        for (const forbiddenToken of forbiddenWiringTokens) {
          expect(moduleSpecifier).not.toContain(forbiddenToken);
        }
      }
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
        for (const [dependencyName, dependencyValue] of Object.entries(dependencies ?? {})) {
          for (const forbiddenToken of forbiddenWiringTokens) {
            expect(`${dependencyName}\n${String(dependencyValue)}`).not.toContain(forbiddenToken);
          }
        }
      }
      const scripts = manifest.scripts as Record<string, unknown> | undefined;
      for (const script of Object.values(scripts ?? {})) {
        for (const forbiddenToken of forbiddenWiringTokens) {
          expect(String(script)).not.toContain(forbiddenToken);
        }
      }
    }

    const operationalModules = {
      ...import.meta.glob(
        '../../../infra/**/*.{mjs,cjs,js,ts,tsx,jsx,json,toml,conf,html,css,sql,env,yaml,yml,sh}',
        {
          eager: true,
          import: 'default',
          query: '?raw',
        },
      ),
      ...import.meta.glob('../../../infra/**/Dockerfile*', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../../infra/**/Caddyfile*', {
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
        .replace(/<!--[\s\S]*?-->/gu, '')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*(?:#|\/\/|--).*$/gmu, '')
        .replace(/\s+(?:#|\/\/|--)\s.*$/gmu, '');
      for (const forbiddenToken of forbiddenWiringTokens) {
        expect(executableSource).not.toContain(forbiddenToken);
      }
    }
  });
});
