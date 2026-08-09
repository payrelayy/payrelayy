import type {
  CbeBirrFixtureLookup,
  CbeBirrFixtureLookupResponse,
} from './cbe-birr-fixture-verifier.js';

/**
 * These are wholly synthetic test artifacts. Their values are placeholders, not receipts,
 * transaction references, account numbers, phone numbers, holder names, or production evidence.
 */
function completedFixture(
  reference: string,
  amountMinor: number,
  receiverKey: string,
  occurredAt: string,
): string {
  return [
    'schema=CBE_BIRR_DRY_RUN_V1',
    'provider=cbe_birr',
    'status=completed',
    `canonical_reference=${reference}`,
    `amount_minor=${amountMinor}`,
    `receiver_key=${receiverKey}`,
    `occurred_at=${occurredAt}`,
    '',
  ].join('\n');
}

function statusFixture(status: string, reference: string): string {
  return [
    'schema=CBE_BIRR_DRY_RUN_V1',
    'provider=cbe_birr',
    `status=${status}`,
    `canonical_reference=${reference}`,
    'amount_minor=2500',
    'receiver_key=fixture-receiver-primary',
    'occurred_at=2026-08-09T10:10:00.000Z',
    '',
  ].join('\n');
}

export const redactedCbeBirrFixtureIds = {
  valid: 'valid-completed',
  wrongReceiver: 'wrong-receiver',
  wrongAmount: 'wrong-amount',
  stale: 'stale-completed',
  future: 'future-completed',
  pending: 'pending-status',
  failed: 'failed-status',
  malformed: 'malformed-layout',
  unknown: 'unknown-status',
  duplicate: 'duplicate-reference',
  unavailable: 'unavailable-source',
} as const;

const fixtureResponses: Readonly<Record<string, CbeBirrFixtureLookupResponse>> = {
  [redactedCbeBirrFixtureIds.valid]: {
    kind: 'found',
    redactedReceipt: completedFixture(
      'FX-00000001',
      2500,
      'fixture-receiver-primary',
      '2026-08-09T10:10:00.000Z',
    ),
  },
  [redactedCbeBirrFixtureIds.wrongReceiver]: {
    kind: 'found',
    redactedReceipt: completedFixture(
      'FX-00000002',
      2500,
      'fixture-receiver-other',
      '2026-08-09T10:10:00.000Z',
    ),
  },
  [redactedCbeBirrFixtureIds.wrongAmount]: {
    kind: 'found',
    redactedReceipt: completedFixture(
      'FX-00000003',
      2600,
      'fixture-receiver-primary',
      '2026-08-09T10:10:00.000Z',
    ),
  },
  [redactedCbeBirrFixtureIds.stale]: {
    kind: 'found',
    redactedReceipt: completedFixture(
      'FX-00000004',
      2500,
      'fixture-receiver-primary',
      '2026-08-09T09:59:59.999Z',
    ),
  },
  [redactedCbeBirrFixtureIds.future]: {
    kind: 'found',
    redactedReceipt: completedFixture(
      'FX-00000005',
      2500,
      'fixture-receiver-primary',
      '2026-08-09T10:16:00.000Z',
    ),
  },
  [redactedCbeBirrFixtureIds.pending]: {
    kind: 'found',
    redactedReceipt: statusFixture('pending', 'FX-00000006'),
  },
  [redactedCbeBirrFixtureIds.failed]: {
    kind: 'found',
    redactedReceipt: statusFixture('failed', 'FX-00000007'),
  },
  [redactedCbeBirrFixtureIds.malformed]: {
    kind: 'found',
    redactedReceipt: 'redacted fixture layout deliberately malformed\n',
  },
  [redactedCbeBirrFixtureIds.unknown]: {
    kind: 'found',
    redactedReceipt: statusFixture('awaiting_settlement', 'FX-00000008'),
  },
  [redactedCbeBirrFixtureIds.duplicate]: {
    kind: 'found',
    redactedReceipt: completedFixture(
      'FX-00000009',
      2500,
      'fixture-receiver-primary',
      '2026-08-09T10:10:00.000Z',
    ),
  },
  [redactedCbeBirrFixtureIds.unavailable]: { kind: 'unavailable' },
};

/** A local lookup only; it intentionally has no network, provider, database, or filesystem work. */
export const redactedCbeBirrFixtureLookup: CbeBirrFixtureLookup = {
  lookup(fixtureId) {
    return fixtureResponses[fixtureId] ?? { kind: 'missing' };
  },
};
