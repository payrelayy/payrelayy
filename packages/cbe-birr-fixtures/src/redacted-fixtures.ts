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

function statusFixture(
  status: string,
  reference: string,
  amountMinor: number,
  occurredAt: string,
): string {
  return [
    'schema=CBE_BIRR_DRY_RUN_V1',
    'provider=cbe_birr',
    `status=${status}`,
    `canonical_reference=${reference}`,
    `amount_minor=${amountMinor}`,
    'receiver_key=fixture-receiver-primary',
    `occurred_at=${occurredAt}`,
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

export interface RedactedCbeBirrFixtureTimeline {
  readonly assessedAt: Date;
  readonly expectedAmountMinor: number;
  readonly openedAt: Date;
  readonly paymentDeadlineAt: Date;
}

/**
 * Build wholly synthetic fixture timestamps relative to the dry-run intent under review. This
 * keeps a fresh scenario fresh for a newly opened intent without introducing provider data.
 */
export function createRedactedCbeBirrFixtureLookup(
  timeline: RedactedCbeBirrFixtureTimeline,
): CbeBirrFixtureLookup {
  const assessedTime = timeline.assessedAt.getTime();
  const openedTime = timeline.openedAt.getTime();
  const paymentDeadlineTime = timeline.paymentDeadlineAt.getTime();
  if (
    !Number.isFinite(assessedTime) ||
    !Number.isFinite(openedTime) ||
    !Number.isFinite(paymentDeadlineTime) ||
    openedTime >= paymentDeadlineTime ||
    !Number.isSafeInteger(timeline.expectedAmountMinor) ||
    timeline.expectedAmountMinor < 1 ||
    timeline.expectedAmountMinor >= Number.MAX_SAFE_INTEGER
  ) {
    return { lookup: () => ({ kind: 'unavailable' }) };
  }

  const latestFreshTime = Math.min(assessedTime, paymentDeadlineTime);
  const freshTime = new Date(
    Math.max(openedTime, openedTime + Math.floor((latestFreshTime - openedTime) / 2)),
  ).toISOString();
  const staleTime = new Date(openedTime - 1).toISOString();
  const futureTime = new Date(assessedTime + 6 * 60 * 1_000).toISOString();
  const fixtureResponses: Readonly<Record<string, CbeBirrFixtureLookupResponse>> = {
    [redactedCbeBirrFixtureIds.valid]: {
      kind: 'found',
      redactedReceipt: completedFixture(
        'FX-00000001',
        timeline.expectedAmountMinor,
        'fixture-receiver-primary',
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.wrongReceiver]: {
      kind: 'found',
      redactedReceipt: completedFixture(
        'FX-00000002',
        timeline.expectedAmountMinor,
        'fixture-receiver-other',
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.wrongAmount]: {
      kind: 'found',
      redactedReceipt: completedFixture(
        'FX-00000003',
        timeline.expectedAmountMinor + 1,
        'fixture-receiver-primary',
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.stale]: {
      kind: 'found',
      redactedReceipt: completedFixture(
        'FX-00000004',
        timeline.expectedAmountMinor,
        'fixture-receiver-primary',
        staleTime,
      ),
    },
    [redactedCbeBirrFixtureIds.future]: {
      kind: 'found',
      redactedReceipt: completedFixture(
        'FX-00000005',
        timeline.expectedAmountMinor,
        'fixture-receiver-primary',
        futureTime,
      ),
    },
    [redactedCbeBirrFixtureIds.pending]: {
      kind: 'found',
      redactedReceipt: statusFixture(
        'pending',
        'FX-00000006',
        timeline.expectedAmountMinor,
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.failed]: {
      kind: 'found',
      redactedReceipt: statusFixture(
        'failed',
        'FX-00000007',
        timeline.expectedAmountMinor,
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.malformed]: {
      kind: 'found',
      redactedReceipt: 'redacted fixture layout deliberately malformed\n',
    },
    [redactedCbeBirrFixtureIds.unknown]: {
      kind: 'found',
      redactedReceipt: statusFixture(
        'awaiting_settlement',
        'FX-00000008',
        timeline.expectedAmountMinor,
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.duplicate]: {
      kind: 'found',
      redactedReceipt: completedFixture(
        'FX-00000009',
        timeline.expectedAmountMinor,
        'fixture-receiver-primary',
        freshTime,
      ),
    },
    [redactedCbeBirrFixtureIds.unavailable]: { kind: 'unavailable' },
  };

  return {
    lookup(fixtureId) {
      return fixtureResponses[fixtureId] ?? { kind: 'missing' };
    },
  };
}

/** A stable baseline used only by package-level fixture regression tests. */
export const redactedCbeBirrFixtureLookup = createRedactedCbeBirrFixtureLookup({
  assessedAt: new Date('2026-08-09T10:10:00.000Z'),
  expectedAmountMinor: 2500,
  openedAt: new Date('2026-08-09T10:00:00.000Z'),
  paymentDeadlineAt: new Date('2026-08-09T11:00:00.000Z'),
});
