import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  canonicalizeAgentPlatformAdapterManifest,
  defineAgentPlatformEnrollmentAdapter,
} from '@fetanagent/agent-platform-contracts';
import { describe, expect, it } from 'vitest';

import {
  KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
  KEMERBET_AGENT_LOGIN_URL,
  KEMERBET_AGENT_LOGIN_RETRY_URL,
  KEMERBET_ENROLLMENT_ADAPTER_DIGEST,
  KEMERBET_ENROLLMENT_ADAPTER_MANIFEST,
  KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS,
  KEMERBET_MAX_GENERATION_LIFETIME_SECONDS,
  KEMERBET_MAX_LOGIN_LIFETIME_SECONDS,
  KEMERBET_LOCAL_IDENTITY_ROOT_SELECTOR,
  KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION,
  KEMERBET_LOCAL_IDENTITY_VALUE_SELECTOR,
  KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR,
  KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR,
  KEMERBET_SESSION_POLICY,
  classifyKemerBetEnrollmentPage,
  kemerBetEnrollmentAdapter,
  parseKemerBetSessionGeneration,
} from './index.js';

describe('KemerBet enrollment page classification', () => {
  it.each([KEMERBET_AGENT_LOGIN_URL, KEMERBET_AGENT_LOGIN_RETRY_URL])(
    'allows credential input only on an exact login page: %s',
    (url) => {
      expect(classifyKemerBetEnrollmentPage(url)).toEqual({
        kind: 'login',
        reason: 'login_page',
        canonicalUrl: url,
        credentialInputAllowed: true,
        accountMutationAllowed: false,
        executionAllowed: false,
        financialActionAllowed: false,
        transferDisabled: true,
      });
    },
  );

  it('labels /agents as a candidate instead of authentication proof', () => {
    expect(classifyKemerBetEnrollmentPage(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL)).toEqual({
      kind: 'authenticated_candidate',
      reason: 'authenticated_page_candidate',
      canonicalUrl: KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
    });
  });

  it.each([
    ['not a url', 'invalid_url'],
    ['http://agentsystem.admindigi.com/login', 'disallowed_origin'],
    ['https://agentsystem.admindigi.com.evil.example/login', 'disallowed_origin'],
    ['https://user:pass@agentsystem.admindigi.com/login', 'embedded_credentials'],
    ['https://agentsystem.admindigi.com/login#captcha', 'fragment_not_allowed'],
    ['https://agentsystem.admindigi.com/login#', 'fragment_not_allowed'],
    ['https://agentsystem.admindigi.com/x/../login', 'non_canonical_url'],
    ['https://agentsystem.admindigi.com/x/%2e%2e/login', 'non_canonical_url'],
    ['https://agentsystem.admindigi.com\\login', 'non_canonical_url'],
    ['  https://agentsystem.admindigi.com/login  ', 'non_canonical_url'],
    ['https://agentsystem.admindigi.com:443/login', 'non_canonical_url'],
    ['https://agentsystem.admindigi.com/login?other=1', 'unsupported_route'],
    ['https://agentsystem.admindigi.com/agents?other=1', 'unsupported_route'],
    ['https://agentsystem.admindigi.com/payments/requests', 'unsupported_route'],
  ])('fails closed for %s', (url, reason) => {
    expect(classifyKemerBetEnrollmentPage(url)).toEqual({
      kind: 'unsupported',
      reason,
      canonicalUrl: null,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
    });
  });
});

describe('KemerBet enrollment adapter manifest', () => {
  it('binds the reviewed canonical manifest to its digest', () => {
    const canonical = canonicalizeAgentPlatformAdapterManifest(
      KEMERBET_ENROLLMENT_ADAPTER_MANIFEST,
    );
    const digest = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;

    expect(digest).toBe(KEMERBET_ENROLLMENT_ADAPTER_DIGEST);
    expect(canonical).toContain(KEMERBET_AGENT_LOGIN_RETRY_URL);
    expect(canonical).toContain(KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL);
    expect(KEMERBET_ENROLLMENT_ADAPTER_MANIFEST.capabilityPolicy).toMatchObject({
      providedCapability: 'page_classification_only',
      profilePersistence: 'not_provided',
      profilePersistenceAuthority: 'external_broker',
      authenticationAttestation: 'not_provided',
      authenticationAttestationAuthority: 'external_broker',
      accountLookupAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferAllowed: false,
    });
  });

  it('conforms to the exact enrollment-only adapter surface', () => {
    expect(() => defineAgentPlatformEnrollmentAdapter(kemerBetEnrollmentAdapter)).not.toThrow();
    expect(Object.keys(kemerBetEnrollmentAdapter).sort()).toEqual(['classifyPage', 'manifest']);
  });

  it('does not import or expose an existing execution boundary', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('Wallet/PlayerEPOSDeposit');
    expect(source).not.toContain('submitOnceAfterFence');
    expect(source).not.toContain('createKemerBetDepositBrowser');
    expect(source).not.toMatch(/from ["'][^"']*(?:apps\/executor|deposit-browser)[^"']*["']/u);
  });
});

describe('KemerBet session policy', () => {
  const generation = {
    schemaVersion: 1 as const,
    generationId: '018f62bc-0d9a-7c6e-8a90-0d8f30ba97d8',
    platformCode: KEMERBET_ENROLLMENT_ADAPTER_MANIFEST.platformCode,
    platformAgentAccountId: '8fb4daca-62c5-4e58-a6d5-5d4374de9b74',
    profileRevision: 1,
    encryptedProfileDigest: `sha256:${'a'.repeat(64)}`,
    profileEncryptionKeyRevision: 1,
    adapterVersion: KEMERBET_ENROLLMENT_ADAPTER_MANIFEST.adapterVersion,
    adapterDigest: KEMERBET_ENROLLMENT_ADAPTER_DIGEST,
    createdAt: '2026-08-27T00:00:00.000Z',
    absoluteExpiresAt: '2026-08-27T12:10:00.000Z',
  };

  it('binds ten-minute login plus full twelve-hour authentication retention', () => {
    expect(KEMERBET_MAX_LOGIN_LIFETIME_SECONDS).toBe(600);
    expect(KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS).toBe(43_200);
    expect(KEMERBET_MAX_GENERATION_LIFETIME_SECONDS).toBe(43_800);
    expect(KEMERBET_SESSION_POLICY).toMatchObject({
      maxLoginLifetimeSeconds: 600,
      maxAuthenticatedLifetimeSeconds: 43_200,
      maxGenerationLifetimeSeconds: 43_800,
    });
    expect(parseKemerBetSessionGeneration(generation).absoluteExpiresAt).toBe(
      '2026-08-27T12:10:00.000Z',
    );
    expect(() =>
      parseKemerBetSessionGeneration({
        ...generation,
        absoluteExpiresAt: '2026-08-27T12:10:00.001Z',
      }),
    ).toThrow('exceeds its maximum lifetime');
  });
});

describe('KemerBet local identity selector contract', () => {
  it('pins the local-only identity and signed-out markers to the reviewed selector file', () => {
    const selectorContract = JSON.parse(
      readFileSync(
        new URL('../../../infra/config/kemerbet-selector-contract.v2.json', import.meta.url),
        'utf8',
      ),
    ) as {
      readonly signedInAgentIdentity: {
        readonly root: string;
        readonly value: { readonly selector: string; readonly source: string };
      };
      readonly sessionFailure: { readonly captcha: string; readonly signInForm: string };
    };

    expect(KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION).toBe(1);
    expect({
      root: KEMERBET_LOCAL_IDENTITY_ROOT_SELECTOR,
      value: { selector: KEMERBET_LOCAL_IDENTITY_VALUE_SELECTOR, source: 'text' },
      sessionFailure: {
        captcha: KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR,
        signInForm: KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR,
      },
    }).toEqual({
      ...selectorContract.signedInAgentIdentity,
      sessionFailure: selectorContract.sessionFailure,
    });
  });
});
