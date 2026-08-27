import { describe, expect, it } from 'vitest';

import {
  AGENT_PLATFORM_CONTRACT_VERSION,
  ENROLLMENT_ONLY_CAPABILITY_POLICY,
  assertAgentSessionSnapshotAdvance,
  assertAgentSessionSnapshotAdvanceForManifest,
  assertAgentSessionTransition,
  canTransitionAgentSession,
  canonicalizeAgentPlatformAdapterManifest,
  defineAgentPlatformEnrollmentAdapter,
  parseAgentPlatformAdapterManifest,
  parseAgentPlatformSessionPolicy,
  parseAgentSessionGenerationForManifest,
  parseInitialAgentSessionSnapshot,
  parseAgentSessionGeneration,
  parseAgentSessionSnapshot,
  parseAgentSessionSnapshotForManifest,
} from './index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const secondDigest = `sha256:${'b'.repeat(64)}`;
const generationId = '018f62bc-0d9a-7c6e-8a90-0d8f30ba97d8';
const accountId = '8fb4daca-62c5-4e58-a6d5-5d4374de9b74';

const manifest = {
  schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
  adapterKind: 'enrollment' as const,
  platformCode: 'example_agent',
  displayName: 'Example Agent',
  adapterVersion: 'example-enrollment-v1',
  adapterDigest: digest,
  credentialInputUrls: [
    'https://agent.example.com/login',
    'https://agent.example.com/login?retry=1',
  ],
  authenticatedCandidateUrls: ['https://agent.example.com/agents'],
  allowedWebOrigins: ['https://agent.example.com'],
  capabilityPolicy: ENROLLMENT_ONLY_CAPABILITY_POLICY,
  requiredExternalBrokerSessionPolicy: {
    maxLoginLifetimeSeconds: 600,
    maxAuthenticatedLifetimeSeconds: 43_200,
    maxGenerationLifetimeSeconds: 43_800,
  },
};

const sessionPolicy = {
  schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
  platformCode: manifest.platformCode,
  adapterVersion: manifest.adapterVersion,
  adapterDigest: manifest.adapterDigest,
  maxLoginLifetimeSeconds: 600,
  maxAuthenticatedLifetimeSeconds: 43_200,
  maxGenerationLifetimeSeconds: 43_800,
};

const generation = {
  schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
  generationId,
  platformCode: 'example_agent',
  platformAgentAccountId: accountId,
  profileRevision: 3,
  encryptedProfileDigest: digest,
  profileEncryptionKeyRevision: 2,
  adapterVersion: 'example-enrollment-v1',
  adapterDigest: digest,
  createdAt: '2026-08-27T00:00:00.000Z',
  absoluteExpiresAt: '2026-08-27T12:00:00.000Z',
};

const proof = {
  schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
  generationId,
  platformAgentAccountId: accountId,
  identityProbeDigest: digest,
  sessionProbeDigest: secondDigest,
  verifiedAt: '2026-08-27T00:01:00.000Z',
  expiresAt: '2026-08-27T11:59:00.000Z',
  credentialInputLocked: true as const,
  financialActionAllowed: false as const,
  transferDisabled: true as const,
};

describe('agent platform adapter manifest', () => {
  it('accepts and freezes an enrollment-only manifest', () => {
    const parsed = parseAgentPlatformAdapterManifest(manifest);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.allowedWebOrigins)).toBe(true);
    expect(Object.isFrozen(parsed.credentialInputUrls)).toBe(true);
    expect(parsed.capabilityPolicy).toEqual(ENROLLMENT_ONLY_CAPABILITY_POLICY);
    expect(parsed.capabilityPolicy).toMatchObject({
      providedCapability: 'page_classification_only',
      profilePersistence: 'not_provided',
      profilePersistenceAuthority: 'external_broker',
      authenticationAttestation: 'not_provided',
      authenticationAttestationAuthority: 'external_broker',
    });
    expect(canonicalizeAgentPlatformAdapterManifest(parsed)).not.toContain(digest);
  });

  it('rejects expanded capabilities and unexpected fields', () => {
    expect(() =>
      parseAgentPlatformAdapterManifest({
        ...manifest,
        capabilityPolicy: {
          ...ENROLLMENT_ONLY_CAPABILITY_POLICY,
          transferAllowed: true,
        },
      }),
    ).toThrow('transferAllowed must be false');

    expect(() =>
      parseAgentPlatformAdapterManifest({ ...manifest, execute: () => undefined }),
    ).toThrow('unexpected or missing fields');
    expect(() =>
      parseAgentPlatformAdapterManifest({
        ...manifest,
        requiredExternalBrokerSessionPolicy: {
          ...manifest.requiredExternalBrokerSessionPolicy,
          maxGenerationLifetimeSeconds: 43_200,
        },
      }),
    ).toThrow('must equal login plus authenticated lifetime');
  });
});

describe('session generations and states', () => {
  it('accepts an immutable encrypted-profile generation binding', () => {
    const parsed = parseAgentSessionGeneration(generation);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.platformAgentAccountId).toBe(accountId);
    expect(parsed).not.toHaveProperty('credentials');
    expect(parsed).not.toHaveProperty('cookies');
  });

  it('rejects generation field expansion and invalid lifetimes', () => {
    expect(() => parseAgentSessionGeneration({ ...generation, cookies: [] })).toThrow(
      'unexpected or missing fields',
    );
    expect(() =>
      parseAgentSessionGeneration({
        ...generation,
        absoluteExpiresAt: generation.createdAt,
      }),
    ).toThrow('must be later than createdAt');
  });

  it('binds generation identity and maximum lifetime to a manifest session policy', () => {
    expect(parseAgentPlatformSessionPolicy(sessionPolicy)).toMatchObject({
      maxLoginLifetimeSeconds: 600,
      maxAuthenticatedLifetimeSeconds: 43_200,
      maxGenerationLifetimeSeconds: 43_800,
    });
    expect(() =>
      parseAgentSessionGenerationForManifest(generation, manifest, sessionPolicy),
    ).not.toThrow();
    expect(() =>
      parseAgentSessionGenerationForManifest(
        { ...generation, absoluteExpiresAt: '2026-08-27T12:10:00.000Z' },
        manifest,
        sessionPolicy,
      ),
    ).not.toThrow();
    expect(() =>
      parseAgentSessionGenerationForManifest(
        { ...generation, absoluteExpiresAt: '2026-08-27T12:10:00.001Z' },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('exceeds its maximum lifetime');
    expect(() =>
      parseAgentSessionGenerationForManifest(
        { ...generation, adapterDigest: secondDigest },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('does not match the adapter manifest');
  });

  it('keeps closed generations terminal and permits explicit recovery', () => {
    expect(canTransitionAgentSession('degraded', 'starting')).toBe(true);
    expect(canTransitionAgentSession('closed', 'starting')).toBe(false);
    expect(() => assertAgentSessionTransition('ready', 'login_required')).toThrow(
      'cannot transition',
    );
  });

  it('requires a bound proof for locked and ready states', () => {
    const snapshot = parseAgentSessionSnapshot({
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation,
      state: 'ready',
      stateRevision: 5,
      observedAt: '2026-08-27T00:02:00.000Z',
      firstAuthenticatedAt: proof.verifiedAt,
      authenticatedDeadline: generation.absoluteExpiresAt,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: proof,
    });

    expect(snapshot.state).toBe('ready');
    expect(snapshot.transferDisabled).toBe(true);
    expect(() => parseAgentSessionSnapshot({ ...snapshot, authenticationProof: null })).toThrow(
      'authenticationProof is required',
    );
    expect(() =>
      parseAgentSessionSnapshot({
        ...snapshot,
        authenticationProof: { ...proof, platformAgentAccountId: generationId },
      }),
    ).toThrow('ownership does not match');
  });

  it('requires a sealed revision-zero initial snapshot', () => {
    const initial = {
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation,
      state: 'sealed',
      stateRevision: 0,
      observedAt: generation.createdAt,
      firstAuthenticatedAt: null,
      authenticatedDeadline: null,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: null,
    };

    expect(parseInitialAgentSessionSnapshot(initial).state).toBe('sealed');
    expect(() => parseInitialAgentSessionSnapshot({ ...initial, state: 'starting' })).toThrow(
      'must be sealed revision zero',
    );
    expect(() => parseInitialAgentSessionSnapshot({ ...initial, stateRevision: 1 })).toThrow(
      'must be sealed revision zero',
    );
  });

  it('allows terminal observations after expiry without reviving authority', () => {
    const base = {
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation,
      stateRevision: 8,
      observedAt: '2026-08-27T12:00:00.001Z',
      firstAuthenticatedAt: null,
      authenticatedDeadline: null,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: null,
    };

    expect(parseAgentSessionSnapshot({ ...base, state: 'closing' }).state).toBe('closing');
    expect(parseAgentSessionSnapshot({ ...base, state: 'closed' }).state).toBe('closed');
    expect(() =>
      parseAgentSessionSnapshot({ ...base, state: 'login_required', credentialInputAllowed: true }),
    ).toThrow('only closing or closed');
    expect(() =>
      parseAgentSessionSnapshot({
        ...base,
        state: 'ready',
        authenticationProof: proof,
      }),
    ).toThrow('only closing or closed');
  });

  it('enforces immutable generations and exact compare-and-swap sequencing', () => {
    const previous = {
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation,
      state: 'login_required',
      stateRevision: 2,
      observedAt: '2026-08-27T00:01:00.000Z',
      firstAuthenticatedAt: null,
      authenticatedDeadline: null,
      credentialInputAllowed: true,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: null,
    };
    const next = {
      ...previous,
      state: 'authenticating',
      stateRevision: 3,
      observedAt: '2026-08-27T00:02:00.000Z',
      credentialInputAllowed: false,
    };

    expect(() => assertAgentSessionSnapshotAdvance(previous, next)).not.toThrow();
    expect(() =>
      assertAgentSessionSnapshotAdvance(previous, { ...next, stateRevision: 4 }),
    ).toThrow('increment by exactly one');
    expect(() =>
      assertAgentSessionSnapshotAdvance(previous, {
        ...next,
        generation: { ...generation, profileRevision: 4 },
      }),
    ).toThrow('cannot change its immutable generation');
  });

  it('derives exact login and authenticated deadlines from the manifest-bound policy', () => {
    const fullLifetimeGeneration = {
      ...generation,
      absoluteExpiresAt: '2026-08-27T12:10:00.000Z',
    };
    const authenticatedDeadline = '2026-08-27T12:01:00.000Z';
    const ready = {
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation: fullLifetimeGeneration,
      state: 'ready',
      stateRevision: 5,
      observedAt: '2026-08-27T00:02:00.000Z',
      firstAuthenticatedAt: proof.verifiedAt,
      authenticatedDeadline,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: { ...proof, expiresAt: authenticatedDeadline },
    };

    expect(
      parseAgentSessionSnapshotForManifest(ready, manifest, sessionPolicy).authenticatedDeadline,
    ).toBe(authenticatedDeadline);
    expect(() =>
      parseAgentSessionSnapshotForManifest(
        {
          ...ready,
          authenticatedDeadline: '2026-08-27T12:01:00.001Z',
          authenticationProof: { ...proof, expiresAt: '2026-08-27T12:01:00.001Z' },
        },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('does not match the immutable session policy');
    expect(() =>
      parseAgentSessionSnapshotForManifest(
        {
          ...ready,
          authenticationProof: { ...proof, expiresAt: '2026-08-27T12:01:00.001Z' },
        },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('authenticationProof is not valid');
    expect(() =>
      parseAgentSessionSnapshotForManifest(
        {
          ...ready,
          state: 'login_required',
          stateRevision: 2,
          observedAt: '2026-08-27T00:10:00.000Z',
          firstAuthenticatedAt: null,
          authenticatedDeadline: null,
          credentialInputAllowed: true,
          authenticationProof: null,
        },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('at or after login deadline');
    expect(() =>
      parseAgentSessionSnapshotForManifest(
        {
          ...ready,
          observedAt: '2026-08-27T00:10:00.000Z',
          firstAuthenticatedAt: '2026-08-27T00:10:00.000Z',
          authenticatedDeadline: fullLifetimeGeneration.absoluteExpiresAt,
          authenticationProof: {
            ...proof,
            verifiedAt: '2026-08-27T00:10:00.000Z',
            expiresAt: fullLifetimeGeneration.absoluteExpiresAt,
          },
        },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('must precede the login deadline');
  });

  it('assigns the authenticated binding once and rejects a sliding re-authentication lease', () => {
    const fullLifetimeGeneration = {
      ...generation,
      absoluteExpiresAt: '2026-08-27T12:10:00.000Z',
    };
    const previous = {
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation: fullLifetimeGeneration,
      state: 'authenticated_locked',
      stateRevision: 3,
      observedAt: '2026-08-27T00:02:00.000Z',
      firstAuthenticatedAt: '2026-08-27T00:01:00.000Z',
      authenticatedDeadline: '2026-08-27T12:01:00.000Z',
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: {
        ...proof,
        verifiedAt: '2026-08-27T00:01:00.000Z',
        expiresAt: '2026-08-27T12:01:00.000Z',
      },
    };
    const stableRefresh = {
      ...previous,
      state: 'ready',
      stateRevision: 4,
      observedAt: '2026-08-27T00:04:00.000Z',
      authenticationProof: {
        ...proof,
        verifiedAt: '2026-08-27T00:03:00.000Z',
        expiresAt: '2026-08-27T12:01:00.000Z',
      },
    };
    const slidingRefresh = {
      ...stableRefresh,
      firstAuthenticatedAt: '2026-08-27T00:02:00.000Z',
      authenticatedDeadline: '2026-08-27T12:02:00.000Z',
      authenticationProof: {
        ...proof,
        verifiedAt: '2026-08-27T00:03:00.000Z',
        expiresAt: '2026-08-27T12:02:00.000Z',
      },
    };

    expect(() =>
      assertAgentSessionSnapshotAdvanceForManifest(
        previous,
        stableRefresh,
        manifest,
        sessionPolicy,
      ),
    ).not.toThrow();
    expect(() =>
      assertAgentSessionSnapshotAdvanceForManifest(
        previous,
        slidingRefresh,
        manifest,
        sessionPolicy,
      ),
    ).toThrow('cannot change its authenticated lifetime binding');
  });

  it('requires the first authenticated binding to be created by the first proof', () => {
    const fullLifetimeGeneration = {
      ...generation,
      absoluteExpiresAt: '2026-08-27T12:10:00.000Z',
    };
    const previous = {
      schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
      generation: fullLifetimeGeneration,
      state: 'authenticating',
      stateRevision: 2,
      observedAt: '2026-08-27T00:00:30.000Z',
      firstAuthenticatedAt: null,
      authenticatedDeadline: null,
      credentialInputAllowed: false,
      accountMutationAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      transferDisabled: true,
      authenticationProof: null,
    };
    const next = {
      ...previous,
      state: 'authenticated_locked',
      stateRevision: 3,
      observedAt: '2026-08-27T00:02:00.000Z',
      firstAuthenticatedAt: '2026-08-27T00:01:00.000Z',
      authenticatedDeadline: '2026-08-27T12:01:00.000Z',
      authenticationProof: {
        ...proof,
        verifiedAt: '2026-08-27T00:01:00.000Z',
        expiresAt: '2026-08-27T12:01:00.000Z',
      },
    };

    expect(() =>
      assertAgentSessionSnapshotAdvanceForManifest(previous, next, manifest, sessionPolicy),
    ).not.toThrow();
    expect(() =>
      assertAgentSessionSnapshotAdvanceForManifest(
        previous,
        {
          ...next,
          firstAuthenticatedAt: '2026-08-27T00:00:59.000Z',
          authenticatedDeadline: '2026-08-27T12:00:59.000Z',
          authenticationProof: {
            ...next.authenticationProof,
            expiresAt: '2026-08-27T12:00:59.000Z',
          },
        },
        manifest,
        sessionPolicy,
      ),
    ).toThrow('must be assigned once by its first proof');
  });
});

describe('enrollment adapter surface', () => {
  it('validates every page result and rejects capability expansion', () => {
    const adapter = defineAgentPlatformEnrollmentAdapter({
      manifest,
      classifyPage: () => ({
        kind: 'login',
        reason: 'login_page',
        canonicalUrl: manifest.credentialInputUrls[0] ?? null,
        credentialInputAllowed: true,
        accountMutationAllowed: false,
        executionAllowed: false,
        financialActionAllowed: false,
        transferDisabled: true,
      }),
    });

    expect(adapter.classifyPage(manifest.credentialInputUrls[0] ?? '')).toMatchObject({
      kind: 'login',
      credentialInputAllowed: true,
    });
    expect(() =>
      defineAgentPlatformEnrollmentAdapter({
        manifest,
        classifyPage: adapter.classifyPage,
        execute: () => undefined,
      } as never),
    ).toThrow('unexpected or missing fields');
  });

  it('independently rejects cross-origin and undeclared supported results', () => {
    const crossOrigin = defineAgentPlatformEnrollmentAdapter({
      manifest,
      classifyPage: (rawUrl) => ({
        kind: 'login',
        reason: 'login_page',
        canonicalUrl: rawUrl,
        credentialInputAllowed: true,
        accountMutationAllowed: false,
        executionAllowed: false,
        financialActionAllowed: false,
        transferDisabled: true,
      }),
    });

    expect(() => crossOrigin.classifyPage('https://evil.example/steal')).toThrow(
      'origin is not allowed',
    );
    expect(() => crossOrigin.classifyPage('https://agent.example.com/other')).toThrow(
      'URL is not declared',
    );
    expect(() => crossOrigin.classifyPage('https://agent.example.com/x/../login')).toThrow(
      'credential-free HTTPS URL',
    );
  });
});
