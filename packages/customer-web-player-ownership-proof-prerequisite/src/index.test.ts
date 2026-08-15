import { describe, expect, expectTypeOf, it } from 'vitest';

import * as publicApi from './index.js';
import {
  CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
  CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT,
  CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION,
  CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS,
  evaluateCustomerWebPlayerOwnershipProofPrerequisites,
  redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog,
  type CustomerWebPlayerOwnershipProofBlockedResult,
  type CustomerWebPlayerOwnershipProofInvalidResult,
  type CustomerWebPlayerOwnershipProofPrerequisiteResult,
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
  contractVersion: CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION,
  platformCode: 'kemerbet' as const,
  requestOrigin: 'customer_web' as const,
  challengeProfile: 'unselected' as const,
  evidenceProfile: 'unselected' as const,
});

const disabledCapabilities = {
  challengeIssuanceAllowed: false,
  challengeDeliveryAllowed: false,
  evidenceAcceptanceAllowed: false,
  evidenceVerificationAllowed: false,
  evidencePersistenceAllowed: false,
  passwordAcceptanceAllowed: false,
  otpAcceptanceAllowed: false,
  recoveryCodeAcceptanceAllowed: false,
  providerSessionAcceptanceAllowed: false,
  staffReviewAllowed: false,
  ownershipAssociationAllowed: false,
  playerBindingAllowed: false,
  readyStatusAllowed: false,
  depositEligibilityAllowed: false,
  databaseAllowed: false,
  networkAllowed: false,
  schemaMutationAllowed: false,
  runtimeWiringAllowed: false,
  financialActionAllowed: false,
} as const;

const disabledCapabilityKeys = Object.keys(disabledCapabilities);
const requestKeys = [
  'contractVersion',
  'platformCode',
  'requestOrigin',
  'challengeProfile',
  'evidenceProfile',
];
const blockedKeys = [
  ...requestKeys,
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'remainingBlockers',
  ...disabledCapabilityKeys,
];
const invalidKeys = [
  'contractVersion',
  'platformCode',
  'requestOrigin',
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

describe('customer-web Player-ID ownership-proof prerequisite contract', () => {
  it('returns the sole ordered and deeply frozen blocked result for the exact request', () => {
    const result = evaluateCustomerWebPlayerOwnershipProofPrerequisites(validRequest());

    expect(result).toBe(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT);
    expect(result).toEqual({
      contractVersion: 2,
      platformCode: 'kemerbet',
      requestOrigin: 'customer_web',
      challengeProfile: 'unselected',
      evidenceProfile: 'unselected',
      advisoryOnly: true,
      disposition: 'blocked',
      reasonCode: 'customer_web_player_ownership_proof_prerequisites_incomplete',
      remainingBlockers: [
        'authoritative_platform_control_signal_unproven',
        'challenge_profile_unselected',
        'challenge_delivery_path_unselected',
        'evidence_profile_unselected',
        'evidence_freshness_replay_attempt_and_abuse_policy_unreviewed',
        'verification_adapter_absent',
        'neutral_staff_proof_review_capability_absent',
        'ownership_conflict_recovery_and_reassignment_policy_unreviewed',
        'deposit_eligibility_promotion_boundary_absent',
      ],
      ...disabledCapabilities,
    });
    expect(Object.keys(result)).toEqual(blockedKeys);
    expect(Reflect.ownKeys(result)).toEqual(blockedKeys);
    expect(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT.remainingBlockers).toBe(
      CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS,
    );
    expectDeeplyFrozen(result);

    const nullPrototypeRequest = Object.assign(Object.create(null), validRequest());
    expect(evaluateCustomerWebPlayerOwnershipProofPrerequisites(nullPrototypeRequest)).toBe(result);
    expect(evaluateCustomerWebPlayerOwnershipProofPrerequisites(validRequest())).toBe(result);
  });

  it('makes no permitted or ready capability representable', () => {
    type DisabledCapabilityKey = keyof typeof disabledCapabilities;

    expect(disabledCapabilityKeys).toHaveLength(19);
    expectTypeOf<
      CustomerWebPlayerOwnershipProofBlockedResult['advisoryOnly']
    >().toEqualTypeOf<true>();
    expectTypeOf<
      CustomerWebPlayerOwnershipProofBlockedResult['disposition']
    >().toEqualTypeOf<'blocked'>();
    expectTypeOf<
      CustomerWebPlayerOwnershipProofInvalidResult['disposition']
    >().toEqualTypeOf<'invalid_request'>();
    expectTypeOf<
      CustomerWebPlayerOwnershipProofPrerequisiteResult[DisabledCapabilityKey]
    >().toEqualTypeOf<false>();

    for (const key of disabledCapabilityKeys) {
      expect(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT).toHaveProperty(key, false);
      expect(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT).toHaveProperty(key, false);
    }
  });

  it('uses one fixed, exact, deeply frozen invalid singleton without input echo', () => {
    const secret = 'do-not-echo-password-otp-session-or-proof';
    const candidates: unknown[] = [
      undefined,
      null,
      true,
      1,
      'request',
      Symbol('request'),
      [],
      new Date(),
      {},
      { ...validRequest(), contractVersion: 1 },
      { ...validRequest(), platformCode: 'other' },
      { ...validRequest(), requestOrigin: 'telegram' },
      { ...validRequest(), challengeProfile: 'selected' },
      { ...validRequest(), evidenceProfile: 'selected' },
      { ...validRequest(), password: secret },
    ];

    for (const candidate of candidates) {
      const result = evaluateCustomerWebPlayerOwnershipProofPrerequisites(candidate);
      expect(result).toBe(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT);
      expect(JSON.stringify(result)).not.toContain(secret);
    }

    expect(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT).toEqual({
      contractVersion: 2,
      platformCode: 'kemerbet',
      requestOrigin: 'customer_web',
      advisoryOnly: true,
      disposition: 'invalid_request',
      reasonCode: 'invalid_request',
      ...disabledCapabilities,
    });
    expect(Object.keys(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT)).toEqual(invalidKeys);
    expect(Reflect.ownKeys(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT)).toEqual(
      invalidKeys,
    );
    expectDeeplyFrozen(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT);
  });

  it('rejects extra, symbol, non-enumerable, accessor, and custom-prototype request shapes', () => {
    const extra = { ...validRequest(), extra: 'not-allowed' };
    const withSymbol = { ...validRequest(), [Symbol('extra')]: true };
    const nonEnumerable = validRequest() as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });
    const customPrototype = Object.assign(Object.create({ inherited: true }), validRequest());
    let getterCalls = 0;
    const accessor = { ...validRequest() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'challengeProfile', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('must not read accessor');
      },
    });

    for (const candidate of [extra, withSymbol, nonEnumerable, customPrototype, accessor]) {
      expect(() => evaluateCustomerWebPlayerOwnershipProofPrerequisites(candidate)).not.toThrow();
      expect(evaluateCustomerWebPlayerOwnershipProofPrerequisites(candidate)).toBe(
        CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT,
      );
    }
    expect(getterCalls).toBe(0);
  });

  it('rejects transparent, hostile, and revoked proxies without invoking any user-controlled trap', () => {
    let trapCalls = 0;
    const trap = () => {
      trapCalls += 1;
      throw new Error('proxy trap must not run');
    };
    const transparentProxy = new Proxy(validRequest(), {});
    const hostileProxy = new Proxy(validRequest(), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    const revocable = Proxy.revocable(validRequest(), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    revocable.revoke();

    for (const candidate of [transparentProxy, hostileProxy, revocable.proxy]) {
      expect(() => evaluateCustomerWebPlayerOwnershipProofPrerequisites(candidate)).not.toThrow();
      expect(evaluateCustomerWebPlayerOwnershipProofPrerequisites(candidate)).toBe(
        CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT,
      );
    }
    expect(trapCalls).toBe(0);
  });

  it('returns one fixed redacted blocked projection only after exact revalidation', () => {
    const first = redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(
      CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
    );
    const second = redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog({
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      remainingBlockers: [...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS],
    });

    expect(first).toBe(second);
    expect(first).not.toBe(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT);
    expect(first).toEqual(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT);
    expect(Object.keys(first)).toEqual(blockedKeys);
    expect(Reflect.ownKeys(first)).toEqual(blockedKeys);
    expectDeeplyFrozen(first);
  });

  it('fails log projection closed for altered, hostile, or sensitive candidates without echo', () => {
    const secret = 'never-log-provider-session-or-proof';
    const invalidProjection = redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(null);
    const alteredBlockers = {
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      remainingBlockers: [
        ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS.slice(0, -1),
        'changed',
      ],
    };
    const extra = {
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      providerSession: secret,
    };
    const symbol = {
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      [Symbol('proof')]: secret,
    };
    let getterCalls = 0;
    const accessor = {
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'reasonCode', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('must not read accessor');
      },
    });

    for (const candidate of [alteredBlockers, extra, symbol, accessor]) {
      const projection = redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(candidate);
      expect(projection).toBe(invalidProjection);
      expect(JSON.stringify(projection)).not.toContain(secret);
    }
    expect(getterCalls).toBe(0);
    expect(invalidProjection).toEqual({
      contractVersion: 2,
      platformCode: 'kemerbet',
      requestOrigin: 'customer_web',
      advisoryOnly: true,
      disposition: 'invalid_result',
      reasonCode: 'invalid_result',
    });
    expectDeeplyFrozen(invalidProjection);
  });

  it('fails log projection closed for transparent, nested, hostile, and revoked proxies without traps', () => {
    let trapCalls = 0;
    const trap = () => {
      trapCalls += 1;
      throw new Error('proxy trap must not run');
    };
    const transparentResultProxy = new Proxy(
      CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      {},
    );
    const hostileResultProxy = new Proxy(CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    const blockerProxy = new Proxy([...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS], {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    const nestedProxy = {
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      remainingBlockers: blockerProxy,
    };
    const transparentNestedProxy = {
      ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT,
      remainingBlockers: new Proxy([...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS], {}),
    };
    const revocable = Proxy.revocable(
      { ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT },
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        has: trap,
        ownKeys: trap,
      },
    );
    revocable.revoke();
    const invalidProjection = redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(null);

    for (const candidate of [
      transparentResultProxy,
      hostileResultProxy,
      transparentNestedProxy,
      nestedProxy,
      revocable.proxy,
    ]) {
      expect(() =>
        redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(candidate),
      ).not.toThrow();
      expect(redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(candidate)).toBe(
        invalidProjection,
      );
    }
    expect(trapCalls).toBe(0);
  });

  it('pins the exact public runtime exports and a dependency-free package manifest', () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        'CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT',
        'CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT',
        'CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION',
        'CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS',
        'evaluateCustomerWebPlayerOwnershipProofPrerequisites',
        'redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog',
      ].sort(),
    );

    const manifestSource = oneRawSource(
      import.meta.glob('../package.json', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const manifest = JSON.parse(manifestSource) as Record<string, unknown>;
    expect(manifest).toEqual({
      name: '@fetanagent/customer-web-player-ownership-proof-prerequisite',
      version: '0.1.0',
      private: true,
      type: 'module',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
      },
      scripts: {
        build: 'tsc -p tsconfig.json',
        test: 'vitest run --passWithNoTests',
      },
    });
    for (const key of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      expect(manifest[key]).toBeUndefined();
    }
  });

  it('contains no database, network, schema, runtime, or provider implementation', () => {
    const source = oneRawSource(
      import.meta.glob('./index.ts', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    );
    const executableSource = source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '')
      .replace(/\s+\/\/\s.*$/gmu, '');
    const moduleSpecifiers = Array.from(
      executableSource.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
      (match) => match[1],
    );

    expect(moduleSpecifiers).toEqual(['node:util/types']);
    expect(executableSource).not.toMatch(/\bimport\s*\(/u);
    expect(executableSource).not.toMatch(/\brequire\s*\(/u);
    expect(executableSource).not.toMatch(/\b(?:fetch|WebSocket)\s*\(/u);
    expect(executableSource).not.toMatch(/\bnew\s+URL\s*\(/u);
    expect(executableSource).not.toMatch(/\b(?:XMLHttpRequest|EventSource)\b/u);
    expect(executableSource).not.toMatch(/\bprocess\.env\b/u);
    expect(executableSource).not.toMatch(/\bprocess\s*\.\s*getBuiltinModule\b/u);
    expect(executableSource).not.toMatch(/\b(?:globalThis\s*\.\s*)?crypto\b/u);
    expect(executableSource).not.toMatch(
      /\b(?:readFile|writeFile|appendFile|open|createReadStream|createWriteStream)\s*\(/u,
    );
    expect(executableSource).not.toMatch(/\b(?:pg|postgres|supabase)\b/iu);
    expect(executableSource).not.toMatch(/\b(?:insert|update|delete|select|alter|create)\s+/iu);
  });

  it('has no production app, package, config, infrastructure, or workflow wiring', () => {
    const packageSpecifier = '@fetanagent/customer-web-player-ownership-proof-prerequisite';
    const forbiddenWiringTokens = [
      packageSpecifier,
      'packages/customer-web-player-ownership-proof-prerequisite',
      'customer-web-player-ownership-proof-prerequisite',
    ];
    const productionCodeModules = {
      ...import.meta.glob('../../../apps/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    };
    const productionCodeEntries = Object.entries(productionCodeModules).filter(
      ([path]) =>
        !path.includes('/customer-web-player-ownership-proof-prerequisite/') &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(path),
    );
    expect(productionCodeEntries.length).toBeGreaterThan(0);
    for (const [, sourceCandidate] of productionCodeEntries) {
      expect(sourceCandidate).toBeTypeOf('string');
      const source = (sourceCandidate as string)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*\/\/.*$/gmu, '')
        .replace(/\s+\/\/\s.*$/gmu, '');
      for (const forbiddenToken of forbiddenWiringTokens) {
        expect(source).not.toContain(forbiddenToken);
      }
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
      ...import.meta.glob('../../*/package.json', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
    };
    for (const [path, manifestCandidate] of Object.entries(manifestModules)) {
      if (path.includes('/customer-web-player-ownership-proof-prerequisite/')) continue;
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
      ...import.meta.glob('../../../Dockerfile*', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob('../../../Caddyfile*', {
        eager: true,
        import: 'default',
        query: '?raw',
      }),
      ...import.meta.glob(
        '../../../scripts/**/*.{mjs,cjs,js,ts,tsx,jsx,json,toml,conf,html,css,sql,env,yaml,yml,sh}',
        {
          eager: true,
          import: 'default',
          query: '?raw',
        },
      ),
      ...import.meta.glob(
        '../../../supabase/**/*.{mjs,cjs,js,ts,tsx,jsx,json,toml,conf,html,css,sql,env,yaml,yml,sh}',
        {
          eager: true,
          import: 'default',
          query: '?raw',
        },
      ),
      ...import.meta.glob('../../../apps/**/*.{json,toml,conf,html,css,sql,env,yaml,yml,sh}', {
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
      if (path.includes('/customer-web-player-ownership-proof-prerequisite/')) continue;
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

  it('has no ownership-proof migration or database boundary', () => {
    const migrationModules = import.meta.glob('../../../supabase/migrations/*.sql', {
      eager: true,
      import: 'default',
      query: '?raw',
    });
    expect(Object.keys(migrationModules).length).toBeGreaterThan(0);

    for (const sourceCandidate of Object.values(migrationModules)) {
      expect(sourceCandidate).toBeTypeOf('string');
      const ddlSource = (sourceCandidate as string)
        .replace(/--[^\r\n]*/gu, '')
        .replace(/\/\*[\s\S]*?\*\//gu, '');
      expect(ddlSource).not.toMatch(
        /\b(?:create(?:\s+or\s+replace)?|alter|drop)\s+(?:function|table|view|type)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:app\.)?[a-z0-9_]*(?:ownership_proof|ownership_challenge|ownership_evidence)[a-z0-9_]*\b/iu,
      );
    }
  });
});
