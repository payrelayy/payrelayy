import { CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA } from './normalizer.js';

const SYNTHETIC_DIGEST = `fixture-sha256:${'0'.repeat(64)}`;

function foundFixture(
  fixtureId: string,
  canonicalReference: string,
  overrides: {
    readonly providerIdentity?: 'MATCHED' | 'MISMATCHED' | 'UNKNOWN';
    readonly status?: 'COMPLETED' | 'PENDING' | 'FAILED' | 'UNKNOWN';
    readonly amountMinor?: number | null;
    readonly currencyCode?: 'ETB' | 'OTHER' | 'UNKNOWN';
    readonly receiverKey?: string | null;
    readonly paymentType?: 'SEND_MONEY' | 'OTHER' | 'UNKNOWN';
    readonly occurredAt?: string | null;
    readonly retrievedAt?: string | null;
  } = {},
): unknown {
  return Object.freeze({
    schema: CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA,
    fixtureId,
    providerCode: 'cbe_birr',
    lookupOutcome: 'found',
    evidenceSource: 'PROVIDER_RECEIPT_LOOKUP',
    providerIdentity: overrides.providerIdentity ?? 'MATCHED',
    transaction: Object.freeze({
      status: overrides.status ?? 'COMPLETED',
      canonicalReference,
      amountMinor: overrides.amountMinor === undefined ? 2_500 : overrides.amountMinor,
      currencyCode: overrides.currencyCode ?? 'ETB',
      receiverKey:
        overrides.receiverKey === undefined ? 'fixture-receiver-primary' : overrides.receiverKey,
      paymentType: overrides.paymentType ?? 'SEND_MONEY',
      occurredAt:
        overrides.occurredAt === undefined ? '2026-08-14T10:05:00.000Z' : overrides.occurredAt,
    }),
    retrieval: Object.freeze({
      retrievedAt:
        overrides.retrievedAt === undefined ? '2026-08-14T10:06:00.000Z' : overrides.retrievedAt,
      adapterVersion: 'fixture-adapter-v1',
      normalizationVersion: 'fixture-normalizer-v1',
      evidenceDigest: SYNTHETIC_DIGEST,
    }),
  });
}

function unavailableFixture(
  fixtureId: string,
  uncertainty: 'provider' | 'network' | 'parser',
): unknown {
  return Object.freeze({
    schema: CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA,
    fixtureId,
    providerCode: 'cbe_birr',
    lookupOutcome: 'unavailable',
    uncertainty,
  });
}

export const redactedCbeBirrAuthoritativeFixtureIds = Object.freeze({
  completed: 'completed',
  wrongReceiver: 'wrong-receiver',
  providerIdentityMismatch: 'provider-identity-mismatch',
  wrongAmount: 'wrong-amount',
  stale: 'stale',
  future: 'future',
  pending: 'pending',
  failed: 'failed',
  notFound: 'not-found',
  providerOutage: 'provider-outage',
  networkUncertain: 'network-uncertain',
  parserUncertain: 'parser-uncertain',
  malformed: 'malformed',
  layoutDrift: 'layout-drift',
  reused: 'reused',
  duplicateUnavailable: 'duplicate-unavailable',
});

/**
 * Stable offline-only responses. Every reference, receiver, timestamp, amount, and digest is a
 * synthetic test value. None is authoritative evidence or a usable provider identifier.
 */
export const redactedCbeBirrAuthoritativeFixtureResponses: Readonly<
  Record<keyof typeof redactedCbeBirrAuthoritativeFixtureIds, unknown>
> = Object.freeze({
  completed: foundFixture('completed', 'SYN-CBE-00000001'),
  wrongReceiver: foundFixture('wrong-receiver', 'SYN-CBE-00000002', {
    receiverKey: 'fixture-receiver-other',
  }),
  providerIdentityMismatch: foundFixture('provider-identity-mismatch', 'SYN-CBE-00000011', {
    providerIdentity: 'MISMATCHED',
  }),
  wrongAmount: foundFixture('wrong-amount', 'SYN-CBE-00000003', { amountMinor: 2_501 }),
  stale: foundFixture('stale', 'SYN-CBE-00000004', {
    occurredAt: '2026-08-14T09:59:59.999Z',
  }),
  future: foundFixture('future', 'SYN-CBE-00000005', {
    occurredAt: '2026-08-14T10:15:00.001Z',
    retrievedAt: '2026-08-14T10:15:00.001Z',
  }),
  pending: foundFixture('pending', 'SYN-CBE-00000006', { status: 'PENDING' }),
  failed: foundFixture('failed', 'SYN-CBE-00000007', { status: 'FAILED' }),
  notFound: Object.freeze({
    schema: CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA,
    fixtureId: 'not-found',
    providerCode: 'cbe_birr',
    lookupOutcome: 'not_found',
  }),
  providerOutage: unavailableFixture('provider-outage', 'provider'),
  networkUncertain: unavailableFixture('network-uncertain', 'network'),
  parserUncertain: unavailableFixture('parser-uncertain', 'parser'),
  malformed: Object.freeze({
    schema: CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA,
    fixtureId: 'malformed',
    providerCode: 'cbe_birr',
    lookupOutcome: 'found',
    evidenceSource: 'PROVIDER_RECEIPT_LOOKUP',
  }),
  layoutDrift: Object.freeze({
    schema: CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA,
    fixtureId: 'layout-drift',
    providerCode: 'cbe_birr',
    lookupOutcome: 'found',
    evidenceSource: 'PROVIDER_RECEIPT_LOOKUP',
    status: 'COMPLETED',
    transactionDetails: Object.freeze({
      canonicalReference: 'SYN-CBE-00000008',
      amountMinor: 2_500,
      currencyCode: 'ETB',
      receiverKey: 'fixture-receiver-primary',
      paymentType: 'SEND_MONEY',
      occurredAt: '2026-08-14T10:05:00.000Z',
    }),
    retrieval: Object.freeze({
      retrievedAt: '2026-08-14T10:06:00.000Z',
      adapterVersion: 'fixture-adapter-v1',
      normalizationVersion: 'fixture-normalizer-v1',
      evidenceDigest: SYNTHETIC_DIGEST,
    }),
  }),
  reused: foundFixture('reused', 'SYN-CBE-00000009'),
  duplicateUnavailable: foundFixture('duplicate-unavailable', 'SYN-CBE-00000010'),
});
