import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
  CBE_BIRR_SHADOW_ADAPTER_VERSION,
  CBE_BIRR_SHADOW_COMPLETE_ARGUMENT_NAMES,
  CBE_BIRR_SHADOW_COMPLETE_PROCEDURE,
  CBE_BIRR_SHADOW_COMPLETE_PROCEDURE_SIGNATURE,
  CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
  CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS,
  CBE_BIRR_SHADOW_RETRY_ARGUMENT_NAMES,
  CBE_BIRR_SHADOW_RETRY_PROCEDURE,
  CBE_BIRR_SHADOW_RETRY_PROCEDURE_SIGNATURE,
  planCbeBirrAuthoritativeShadowSettlementCommand,
  redactedCbeBirrAuthoritativeShadowSettlementCommandForLog,
  type CbeBirrAuthoritativeShadowCompleteProcedureArguments,
  type CbeBirrAuthoritativeShadowSettlementCommand,
} from './cbe-birr-authoritative-shadow-settlement.js';

const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const leaseToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const foundationMigration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260814115713_cbe_birr_shadow_verification_foundation.sql',
    import.meta.url,
  ),
  'utf8',
);

const completeDecisionPairs = [
  ['would_reject', 'authoritative_receipt_not_found'],
  ['would_reject', 'receiver_mismatch'],
  ['would_reject', 'provider_status_failed'],
  ['would_review', 'amount_mismatch'],
  ['would_review', 'payment_stale'],
  ['would_review', 'payment_timestamp_future'],
  ['would_review', 'payment_fields_missing'],
  ['would_review', 'provider_status_pending'],
  ['would_review', 'payment_type_mismatch'],
  ['would_review', 'verification_review_required'],
  ['would_review', 'duplicate_check_unavailable'],
] as const;

const retryReasonCodes = [
  'authoritative_receipt_unavailable',
  'receipt_parse_uncertain',
  'provider_network_uncertain',
] as const;

function migrationReasonCodesFor(outcome: 'would_reject' | 'would_review'): string[] {
  const functionBody = foundationMigration.match(
    /create function app\.is_valid_cbe_birr_shadow_outcome\([\s\S]*?as \$\$(?<body>[\s\S]*?)\$\$;/u,
  )?.groups?.body;
  if (functionBody === undefined) {
    throw new Error(
      'The CBE Birr shadow outcome validator is missing from the foundation migration.',
    );
  }

  const reasonBlock = functionBody.match(
    new RegExp(`p_outcome = '${outcome}' and p_reason_code in \\((?<reasons>[\\s\\S]*?)\\)`, 'u'),
  )?.groups?.reasons;
  if (reasonBlock === undefined) {
    throw new Error(`The ${outcome} reason allowlist is missing from the foundation migration.`);
  }

  return Array.from(reasonBlock.matchAll(/'([^']+)'/gu), (match) => match[1]!);
}

// @ts-expect-error A review reason can never be paired with a reject outcome.
const impossibleCompleteTuple: CbeBirrAuthoritativeShadowCompleteProcedureArguments = [
  jobId,
  leaseToken,
  1,
  'would_reject',
  'payment_fields_missing',
  null,
  null,
  CBE_BIRR_SHADOW_ADAPTER_VERSION,
  CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
];
void impossibleCompleteTuple;

function leaseReceipt(attemptNumber = 3): unknown {
  return {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    jobId,
    leaseToken,
    attemptNumber,
  };
}

function attemptPlan(disposition: unknown, outcome: unknown, reasonCode: unknown): unknown {
  return {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    disposition,
    decision: { contractVersion: 1, outcome, reasonCode },
  };
}

function assertClosedCommandType(command: CbeBirrAuthoritativeShadowSettlementCommand): void {
  if (command.disposition === 'complete_advisory') {
    const canonicalReferenceFingerprint: null = command.arguments[5];
    const workerDecisionDigest: null = command.arguments[6];
    expect(canonicalReferenceFingerprint).toBeNull();
    expect(workerDecisionDigest).toBeNull();
    return;
  }

  const retryAfterSeconds: 300 = command.arguments[4];
  expect(retryAfterSeconds).toBe(300);
}

describe('CBE Birr authoritative shadow settlement-command planner', () => {
  it('pins exact procedure signatures, ordered argument names, versions, and retry policy', () => {
    expect(CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION).toBe(1);
    expect(CBE_BIRR_SHADOW_COMPLETE_PROCEDURE).toBe(
      'app.complete_cbe_birr_shadow_verification_job',
    );
    expect(CBE_BIRR_SHADOW_COMPLETE_PROCEDURE_SIGNATURE).toBe(
      'app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)',
    );
    expect(CBE_BIRR_SHADOW_COMPLETE_ARGUMENT_NAMES).toEqual([
      'p_job_id',
      'p_lease_token',
      'p_attempt_number',
      'p_outcome',
      'p_reason_code',
      'p_canonical_reference_fingerprint',
      'p_worker_decision_digest',
      'p_adapter_version',
      'p_normalization_version',
    ]);
    expect(CBE_BIRR_SHADOW_RETRY_PROCEDURE).toBe('app.retry_cbe_birr_shadow_verification_job');
    expect(CBE_BIRR_SHADOW_RETRY_PROCEDURE_SIGNATURE).toBe(
      'app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)',
    );
    expect(CBE_BIRR_SHADOW_RETRY_ARGUMENT_NAMES).toEqual([
      'p_job_id',
      'p_lease_token',
      'p_attempt_number',
      'p_error_code',
      'p_retry_after_seconds',
    ]);
    expect(CBE_BIRR_SHADOW_ADAPTER_VERSION).toBe('cbe-birr-shadow-worker-v1');
    expect(CBE_BIRR_SHADOW_NORMALIZATION_VERSION).toBe('cbe-birr-normalization-v1');
    expect(CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS).toBe(300);
    expect(CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS).toBeGreaterThanOrEqual(1);
    expect(CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS).toBeLessThanOrEqual(3600);
    expect(Object.isFrozen(CBE_BIRR_SHADOW_COMPLETE_ARGUMENT_NAMES)).toBe(true);
    expect(Object.isFrozen(CBE_BIRR_SHADOW_RETRY_ARGUMENT_NAMES)).toBe(true);
  });

  it('keeps static parity with the checked-in foundation migration', () => {
    expect(foundationMigration).toContain(CBE_BIRR_SHADOW_COMPLETE_PROCEDURE_SIGNATURE);
    expect(foundationMigration).toContain(CBE_BIRR_SHADOW_RETRY_PROCEDURE_SIGNATURE);
    expect(foundationMigration).toMatch(
      /create function app\.complete_cbe_birr_shadow_verification_job\(\s*p_job_id uuid,\s*p_lease_token uuid,\s*p_attempt_number integer,\s*p_outcome text,\s*p_reason_code text,\s*p_canonical_reference_fingerprint text,\s*p_worker_decision_digest text,\s*p_adapter_version text,\s*p_normalization_version text\s*\)/u,
    );
    expect(foundationMigration).toMatch(
      /create function app\.retry_cbe_birr_shadow_verification_job\(\s*p_job_id uuid,\s*p_lease_token uuid,\s*p_attempt_number integer,\s*p_error_code text,\s*p_retry_after_seconds integer\s*\)/u,
    );
    expect(foundationMigration).toMatch(
      /p_error_code not in \(\s*'authoritative_receipt_unavailable',\s*'receipt_parse_uncertain',\s*'provider_network_uncertain'\s*\)/u,
    );
    expect(foundationMigration).toContain('p_retry_after_seconds not between 1 and 3600');
    expect(foundationMigration).toContain(
      'max_attempts integer not null default 5 check (max_attempts = 5)',
    );
    expect(foundationMigration).toContain("p_adapter_version !~ '^[a-z0-9][a-z0-9._-]*$'");
    expect(foundationMigration).toContain("p_normalization_version !~ '^[a-z0-9][a-z0-9._-]*$'");

    const completeRejectReasonCodes = completeDecisionPairs
      .filter(([outcome]) => outcome === 'would_reject')
      .map(([, reasonCode]) => reasonCode);
    const completeReviewReasonCodes = completeDecisionPairs
      .filter(([outcome]) => outcome === 'would_review')
      .map(([, reasonCode]) => reasonCode);
    const migrationRejectReasonCodes = migrationReasonCodesFor('would_reject');
    const migrationReviewReasonCodes = migrationReasonCodesFor('would_review');

    expect(migrationRejectReasonCodes).toEqual([
      ...completeRejectReasonCodes,
      'provider_reference_reused',
    ]);
    expect(new Set(migrationReviewReasonCodes)).toEqual(
      new Set([...completeReviewReasonCodes, ...retryReasonCodes]),
    );
    expect(migrationReviewReasonCodes).toHaveLength(
      completeReviewReasonCodes.length + retryReasonCodes.length,
    );
    expect(foundationMigration).toMatch(
      /p_outcome = 'would_verify' and p_reason_code = 'shadow_checks_passed'/u,
    );

    const versionPattern = /^[a-z0-9][a-z0-9._-]*$/u;
    for (const version of [
      CBE_BIRR_SHADOW_ADAPTER_VERSION,
      CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
    ]) {
      expect(version.length).toBeGreaterThanOrEqual(1);
      expect(version.length).toBeLessThanOrEqual(96);
      expect(version).toMatch(versionPattern);
    }
  });

  it.each(completeDecisionPairs)(
    'reconstructs %s/%s into the exact advisory completion tuple',
    (outcome, reasonCode) => {
      const command = planCbeBirrAuthoritativeShadowSettlementCommand(
        leaseReceipt(),
        attemptPlan('complete_advisory', outcome, reasonCode),
      );

      expect(command).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'complete_advisory',
        procedure: CBE_BIRR_SHADOW_COMPLETE_PROCEDURE,
        arguments: [
          jobId,
          leaseToken,
          3,
          outcome,
          reasonCode,
          null,
          null,
          'cbe-birr-shadow-worker-v1',
          'cbe-birr-normalization-v1',
        ],
      });
      expect(command).not.toBeNull();
      expect(Object.isFrozen(command)).toBe(true);
      expect(Object.isFrozen(command?.arguments)).toBe(true);
      assertClosedCommandType(command!);
    },
  );

  it.each(retryReasonCodes)(
    'reconstructs %s into the exact deterministic retry tuple',
    (reasonCode) => {
      const plan = attemptPlan('retry_candidate', 'would_review', reasonCode);
      const command = planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt(2), plan);
      const replay = planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt(2), plan);

      expect(command).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'retry_candidate',
        procedure: CBE_BIRR_SHADOW_RETRY_PROCEDURE,
        arguments: [jobId, leaseToken, 2, reasonCode, 300],
      });
      expect(replay).toEqual(command);
      expect(Object.isFrozen(command)).toBe(true);
      expect(Object.isFrozen(command?.arguments)).toBe(true);
      assertClosedCommandType(command!);
    },
  );

  it('accepts only canonical UUIDs and bounded integer attempt numbers', () => {
    for (const attemptNumber of [1, 2, 3, 4, 5]) {
      expect(
        planCbeBirrAuthoritativeShadowSettlementCommand(
          leaseReceipt(attemptNumber),
          attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing'),
        ),
      ).not.toBeNull();
    }

    const customPrototypeLease = Object.assign(Object.create({ inherited: true }), leaseReceipt());
    const invalidLeaseReceipts = [
      { ...(leaseReceipt() as object), contractVersion: 2 },
      { ...(leaseReceipt() as object), providerCode: 'other' },
      { ...(leaseReceipt() as object), extra: 'not-allowlisted' },
      customPrototypeLease,
      { ...(leaseReceipt() as object), jobId: 'not-a-uuid' },
      { ...(leaseReceipt() as object), jobId: jobId.toUpperCase() },
      { ...(leaseReceipt() as object), jobId: '00000000-0000-0000-0000-000000000000' },
      { ...(leaseReceipt() as object), leaseToken: 'not-a-uuid' },
      { ...(leaseReceipt() as object), leaseToken: '22222222-2222-4222-7222-222222222222' },
      { ...(leaseReceipt() as object), attemptNumber: 0 },
      { ...(leaseReceipt() as object), attemptNumber: 6 },
      { ...(leaseReceipt() as object), attemptNumber: 1.5 },
      { ...(leaseReceipt() as object), attemptNumber: Number.NaN },
      { ...(leaseReceipt() as object), attemptNumber: Number.POSITIVE_INFINITY },
      { ...(leaseReceipt() as object), attemptNumber: '1' },
    ];

    for (const candidate of invalidLeaseReceipts) {
      expect(
        planCbeBirrAuthoritativeShadowSettlementCommand(
          candidate,
          attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing'),
        ),
      ).toBeNull();
    }
  });

  it('rejects verifying, reused-reference, mismatched, and non-allowlisted decisions', () => {
    const invalidPlans = [
      attemptPlan('complete_advisory', 'would_verify', 'shadow_checks_passed'),
      attemptPlan('complete_advisory', 'would_reject', 'provider_reference_reused'),
      attemptPlan('complete_advisory', 'would_reject', 'payment_fields_missing'),
      attemptPlan('complete_advisory', 'would_review', 'receiver_mismatch'),
      attemptPlan('complete_advisory', 'would_review', 'provider_network_uncertain'),
      attemptPlan('complete_advisory', 'would_review', 'receipt_parse_uncertain'),
      attemptPlan('retry_candidate', 'would_review', 'payment_fields_missing'),
      attemptPlan('retry_candidate', 'would_reject', 'provider_status_failed'),
      attemptPlan('retry_candidate', 'would_review', 'unknown_reason'),
      attemptPlan('unknown_disposition', 'would_review', 'payment_fields_missing'),
      {
        ...(attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing') as object),
        contractVersion: 2,
      },
      {
        ...(attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing') as object),
        providerCode: 'other',
      },
      {
        ...(attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing') as object),
        advisoryOnly: false,
      },
    ];

    for (const plan of invalidPlans) {
      expect(planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt(), plan)).toBeNull();
    }
  });

  it('rejects extra fields, symbols, accessors, custom prototypes, and proxies without traps', () => {
    let leaseAccessorReads = 0;
    let planAccessorReads = 0;
    let decisionAccessorReads = 0;
    let proxyTrapCalls = 0;

    const accessorLease = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      leaseToken,
      attemptNumber: 1,
    } as Record<string, unknown>;
    Object.defineProperty(accessorLease, 'jobId', {
      enumerable: true,
      get() {
        leaseAccessorReads += 1;
        return jobId;
      },
    });

    const accessorPlan = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'complete_advisory',
    } as Record<string, unknown>;
    Object.defineProperty(accessorPlan, 'decision', {
      enumerable: true,
      get() {
        planAccessorReads += 1;
        return {
          contractVersion: 1,
          outcome: 'would_review',
          reasonCode: 'payment_fields_missing',
        };
      },
    });

    const accessorDecision = {
      contractVersion: 1,
      outcome: 'would_review',
    } as Record<string, unknown>;
    Object.defineProperty(accessorDecision, 'reasonCode', {
      enumerable: true,
      get() {
        decisionAccessorReads += 1;
        return 'payment_fields_missing';
      },
    });
    const planWithAccessorDecision = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'complete_advisory',
      decision: accessorDecision,
    };

    const symbolLease = leaseReceipt() as Record<PropertyKey, unknown>;
    symbolLease[Symbol('secret')] = 'hidden';
    const symbolPlan = attemptPlan(
      'complete_advisory',
      'would_review',
      'payment_fields_missing',
    ) as Record<PropertyKey, unknown>;
    symbolPlan[Symbol('secret')] = 'hidden';
    const extraPlan = {
      ...(attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing') as object),
      rawReference: 'RAW-REFERENCE-123',
    };
    const extraDecisionPlan = attemptPlan(
      'complete_advisory',
      'would_review',
      'payment_fields_missing',
    ) as { decision: Record<string, unknown> };
    extraDecisionPlan.decision.rawReference = 'RAW-REFERENCE-123';
    class HostilePlan {
      contractVersion = 1;
      providerCode = 'cbe_birr';
      advisoryOnly = true;
      disposition = 'complete_advisory';
      decision = {
        contractVersion: 1,
        outcome: 'would_review',
        reasonCode: 'payment_fields_missing',
      };
    }
    const proxyLease = new Proxy(leaseReceipt() as object, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('RAW-PROXY-SECRET');
      },
    });
    const proxyPlan = new Proxy(
      attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing') as object,
      {
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error('RAW-PROXY-SECRET');
        },
      },
    );
    const proxyDecisionPlan = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'complete_advisory',
      decision: new Proxy(
        { contractVersion: 1, outcome: 'would_review', reasonCode: 'payment_fields_missing' },
        {
          ownKeys() {
            proxyTrapCalls += 1;
            throw new Error('RAW-PROXY-SECRET');
          },
        },
      ),
    };

    const validPlan = attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing');
    for (const candidate of [null, [], {}, accessorLease, symbolLease, proxyLease]) {
      expect(planCbeBirrAuthoritativeShadowSettlementCommand(candidate, validPlan)).toBeNull();
    }
    for (const candidate of [
      null,
      [],
      {},
      accessorPlan,
      planWithAccessorDecision,
      symbolPlan,
      extraPlan,
      extraDecisionPlan,
      new HostilePlan(),
      proxyPlan,
      proxyDecisionPlan,
    ]) {
      expect(planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt(), candidate)).toBeNull();
    }

    expect(leaseAccessorReads).toBe(0);
    expect(planAccessorReads).toBe(0);
    expect(decisionAccessorReads).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  it('rejects transparent and revoked proxies at every planner input boundary', () => {
    const validLease = leaseReceipt() as Record<string, unknown>;
    const validPlan = attemptPlan(
      'complete_advisory',
      'would_review',
      'payment_fields_missing',
    ) as Record<string, unknown> & { decision: Record<string, unknown> };
    expect(planCbeBirrAuthoritativeShadowSettlementCommand(validLease, validPlan)).not.toBeNull();

    const transparentLease = new Proxy(validLease, {});
    const transparentPlan = new Proxy(validPlan, {});
    const transparentDecisionPlan = {
      ...validPlan,
      decision: new Proxy(validPlan.decision, {}),
    };
    expect(planCbeBirrAuthoritativeShadowSettlementCommand(transparentLease, validPlan)).toBeNull();
    expect(planCbeBirrAuthoritativeShadowSettlementCommand(validLease, transparentPlan)).toBeNull();
    expect(
      planCbeBirrAuthoritativeShadowSettlementCommand(validLease, transparentDecisionPlan),
    ).toBeNull();

    let revokedProxyTrapCalls = 0;
    const revokedHandler: ProxyHandler<object> = {
      ownKeys() {
        revokedProxyTrapCalls += 1;
        throw new Error('A revoked proxy trap must not run.');
      },
      getPrototypeOf() {
        revokedProxyTrapCalls += 1;
        throw new Error('A revoked proxy trap must not run.');
      },
    };
    const revokedLease = Proxy.revocable(validLease, revokedHandler);
    const revokedPlan = Proxy.revocable(validPlan, revokedHandler);
    const revokedDecision = Proxy.revocable(validPlan.decision, revokedHandler);
    const revokedDecisionPlan = { ...validPlan, decision: revokedDecision.proxy };
    revokedLease.revoke();
    revokedPlan.revoke();
    revokedDecision.revoke();

    expect(
      planCbeBirrAuthoritativeShadowSettlementCommand(revokedLease.proxy, validPlan),
    ).toBeNull();
    expect(
      planCbeBirrAuthoritativeShadowSettlementCommand(validLease, revokedPlan.proxy),
    ).toBeNull();
    expect(
      planCbeBirrAuthoritativeShadowSettlementCommand(validLease, revokedDecisionPlan),
    ).toBeNull();
    expect(revokedProxyTrapCalls).toBe(0);
  });

  it('never copies raw provider, receiver, payload, URL, credential, or thrown values', () => {
    const sensitiveValues = [
      'RAW-REFERENCE-123',
      '+251900000000',
      '<html>provider payload</html>',
      'https://provider.invalid/private',
      'Bearer provider-secret',
    ];
    const rawPlan = {
      ...(attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing') as object),
      rawReference: sensitiveValues[0],
      receiver: sensitiveValues[1],
      payload: sensitiveValues[2],
      receiptUrl: sensitiveValues[3],
      credential: sensitiveValues[4],
    };
    const hostilePlan = new Proxy(rawPlan, {
      ownKeys() {
        throw new Error(sensitiveValues[4]);
      },
    });
    const serialized = JSON.stringify([
      planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt(), rawPlan),
      planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt(), hostilePlan),
    ]);

    expect(serialized).toBe('[null,null]');
    for (const sensitiveValue of sensitiveValues) expect(serialized).not.toContain(sensitiveValue);
  });

  it.each(completeDecisionPairs)(
    'redacts a valid complete_advisory %s/%s completion to exact safe log fields',
    (outcome, reasonCode) => {
      const disposition = 'complete_advisory' as const;
      const command = planCbeBirrAuthoritativeShadowSettlementCommand(
        leaseReceipt(4),
        attemptPlan(disposition, outcome, reasonCode),
      );
      const projection = redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(command);

      expect(projection).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition,
        attemptNumber: 4,
        outcome,
        reasonCode,
      });
      expect(Object.keys(projection)).toEqual([
        'contractVersion',
        'providerCode',
        'advisoryOnly',
        'disposition',
        'attemptNumber',
        'outcome',
        'reasonCode',
      ]);
      expect(Object.isFrozen(projection)).toBe(true);
    },
  );

  it.each(retryReasonCodes)(
    'redacts an ordinary valid %s retry command to exact safe deterministic log fields',
    (reasonCode) => {
      const planned = planCbeBirrAuthoritativeShadowSettlementCommand(
        leaseReceipt(2),
        attemptPlan('retry_candidate', 'would_review', reasonCode),
      );
      expect(planned).not.toBeNull();
      const ordinaryCommand = { ...planned!, arguments: [...planned!.arguments] };

      const projection = redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(ordinaryCommand);

      expect(projection).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'retry_candidate',
        attemptNumber: 2,
        outcome: 'would_review',
        reasonCode,
        retryAfterSeconds: 300,
      });
      expect(Object.keys(projection)).toEqual([
        'contractVersion',
        'providerCode',
        'advisoryOnly',
        'disposition',
        'attemptNumber',
        'outcome',
        'reasonCode',
        'retryAfterSeconds',
      ]);
      expect(Object.isFrozen(projection)).toBe(true);
    },
  );

  it('returns one frozen constant projection for malformed or forged command values', () => {
    const validComplete = planCbeBirrAuthoritativeShadowSettlementCommand(
      leaseReceipt(),
      attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing'),
    );
    const validRetry = planCbeBirrAuthoritativeShadowSettlementCommand(
      leaseReceipt(),
      attemptPlan('retry_candidate', 'would_review', 'receipt_parse_uncertain'),
    );
    expect(validComplete).not.toBeNull();
    expect(validRetry).not.toBeNull();

    const completeArguments: unknown[] = [...validComplete!.arguments];
    const retryArguments: unknown[] = [...validRetry!.arguments];
    const invalidCommands = [
      null,
      [],
      {},
      { ...validComplete, contractVersion: 2 },
      { ...validComplete, providerCode: 'other' },
      { ...validComplete, advisoryOnly: false },
      { ...validComplete, disposition: 'retry_candidate' },
      { ...validComplete, procedure: CBE_BIRR_SHADOW_RETRY_PROCEDURE },
      { ...validComplete, arguments: [...completeArguments, 'extra'] },
      { ...validComplete, arguments: completeArguments.with(0, 'not-a-uuid') },
      { ...validComplete, arguments: completeArguments.with(2, 6) },
      { ...validComplete, arguments: completeArguments.with(3, 'would_verify') },
      { ...validComplete, arguments: completeArguments.with(3, 'would_reject') },
      { ...validComplete, arguments: completeArguments.with(4, 'provider_reference_reused') },
      { ...validComplete, arguments: completeArguments.with(4, 'receiver_mismatch') },
      { ...validComplete, arguments: completeArguments.with(5, 'a'.repeat(64)) },
      { ...validComplete, arguments: completeArguments.with(6, 'b'.repeat(64)) },
      { ...validComplete, arguments: completeArguments.with(7, 'caller-adapter-v9') },
      { ...validComplete, arguments: completeArguments.with(8, 'caller-normalization-v9') },
      { ...validRetry, procedure: CBE_BIRR_SHADOW_COMPLETE_PROCEDURE },
      { ...validRetry, arguments: retryArguments.with(3, 'payment_fields_missing') },
      { ...validRetry, arguments: retryArguments.with(4, 301) },
      { ...validRetry, rawReference: 'RAW-REFERENCE-123' },
    ];

    const projections = invalidCommands.map((command) =>
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(command),
    );
    for (const projection of projections) {
      expect(projection).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'invalid_command',
      });
      expect(Object.keys(projection)).toEqual([
        'contractVersion',
        'providerCode',
        'advisoryOnly',
        'disposition',
      ]);
      expect(Object.isFrozen(projection)).toBe(true);
      expect(projection).toBe(projections[0]);
    }
  });

  it('redacts accessors, symbols, proxies, and hostile tuples without reading traps', () => {
    let commandAccessorReads = 0;
    let tupleAccessorReads = 0;
    let proxyTrapCalls = 0;
    const validCommand = planCbeBirrAuthoritativeShadowSettlementCommand(
      leaseReceipt(),
      attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing'),
    );
    expect(validCommand).not.toBeNull();

    const accessorCommand = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'complete_advisory',
      procedure: CBE_BIRR_SHADOW_COMPLETE_PROCEDURE,
    } as Record<string, unknown>;
    Object.defineProperty(accessorCommand, 'arguments', {
      enumerable: true,
      get() {
        commandAccessorReads += 1;
        return validCommand!.arguments;
      },
    });

    const accessorTuple = [...validCommand!.arguments];
    Object.defineProperty(accessorTuple, '0', {
      enumerable: true,
      get() {
        tupleAccessorReads += 1;
        return jobId;
      },
    });
    const commandWithAccessorTuple = { ...validCommand, arguments: accessorTuple };

    const symbolCommand = { ...validCommand } as Record<PropertyKey, unknown>;
    symbolCommand[Symbol('secret')] = 'RAW-SYMBOL-SECRET';
    const symbolTuple = [...validCommand!.arguments] as Record<PropertyKey, unknown> & unknown[];
    symbolTuple[Symbol('secret')] = 'RAW-SYMBOL-SECRET';
    const commandWithSymbolTuple = { ...validCommand, arguments: symbolTuple };

    const proxyCommand = new Proxy(validCommand!, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('RAW-PROXY-SECRET');
      },
    });
    const proxyTuple = new Proxy([...validCommand!.arguments], {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('RAW-PROXY-SECRET');
      },
    });
    const commandWithProxyTuple = { ...validCommand, arguments: proxyTuple };

    const projections = [
      accessorCommand,
      commandWithAccessorTuple,
      symbolCommand,
      commandWithSymbolTuple,
      proxyCommand,
      commandWithProxyTuple,
    ].map((command) => redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(command));

    expect(projections.every((projection) => projection.disposition === 'invalid_command')).toBe(
      true,
    );
    expect(commandAccessorReads).toBe(0);
    expect(tupleAccessorReads).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  it('redacts transparent and revoked proxies at every log-projection boundary', () => {
    const planned = planCbeBirrAuthoritativeShadowSettlementCommand(
      leaseReceipt(),
      attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing'),
    );
    expect(planned).not.toBeNull();
    const plainCommand = { ...planned!, arguments: [...planned!.arguments] };
    expect(
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(plainCommand).disposition,
    ).toBe('complete_advisory');

    const transparentCommand = new Proxy(plainCommand, {});
    const transparentTupleCommand = {
      ...plainCommand,
      arguments: new Proxy([...plainCommand.arguments], {}),
    };
    expect(
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(transparentCommand).disposition,
    ).toBe('invalid_command');
    expect(
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(transparentTupleCommand)
        .disposition,
    ).toBe('invalid_command');

    let revokedProxyTrapCalls = 0;
    const revokedHandler: ProxyHandler<object> = {
      ownKeys() {
        revokedProxyTrapCalls += 1;
        throw new Error('A revoked proxy trap must not run.');
      },
      getPrototypeOf() {
        revokedProxyTrapCalls += 1;
        throw new Error('A revoked proxy trap must not run.');
      },
    };
    const revokedCommand = Proxy.revocable(plainCommand, revokedHandler);
    const revokedTuple = Proxy.revocable([...plainCommand.arguments], revokedHandler);
    const revokedTupleCommand = { ...plainCommand, arguments: revokedTuple.proxy };
    revokedCommand.revoke();
    revokedTuple.revoke();

    expect(
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(revokedCommand.proxy).disposition,
    ).toBe('invalid_command');
    expect(
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(revokedTupleCommand).disposition,
    ).toBe('invalid_command');
    expect(revokedProxyTrapCalls).toBe(0);
  });

  it('never logs identifiers, tuples, procedures, versions, SQL, or caller-provided secrets', () => {
    const command = planCbeBirrAuthoritativeShadowSettlementCommand(
      leaseReceipt(),
      attemptPlan('complete_advisory', 'would_review', 'payment_fields_missing'),
    );
    expect(command).not.toBeNull();
    const rawCommand = {
      ...command,
      rawReference: 'RAW-REFERENCE-123',
      receiver: '+251900000000',
      receiptUrl: 'https://provider.invalid/private',
      credential: 'Bearer provider-secret',
      sql: 'select secret from private_table',
    };
    const serialized = JSON.stringify([
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(command),
      redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(rawCommand),
    ]);

    for (const sensitiveValue of [
      jobId,
      leaseToken,
      CBE_BIRR_SHADOW_COMPLETE_PROCEDURE,
      CBE_BIRR_SHADOW_COMPLETE_PROCEDURE_SIGNATURE,
      CBE_BIRR_SHADOW_ADAPTER_VERSION,
      CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
      'RAW-REFERENCE-123',
      '+251900000000',
      'https://provider.invalid/private',
      'Bearer provider-secret',
      'select secret from private_table',
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
    expect(serialized).not.toContain('arguments');
    expect(serialized).not.toContain('procedure');
  });
});
