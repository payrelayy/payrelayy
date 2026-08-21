import { createHash, randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  armPilot,
  createPilotPrerequisites,
  type PilotPrerequisites,
  type PreparedPilot,
} from './private-live-money-pilot.suite.js';

type SqlValue = boolean | Date | number | string | readonly string[] | null;

export type TelebirrPilot = PreparedPilot & {
  readonly assignmentSignerId: string;
  readonly deviceEnrollmentId: string;
  readonly policyDigest: string;
  readonly receiverIdentityDigest: string;
  readonly receiverProfileId: string;
};

type ProofRow = {
  readonly candidate_reference_fingerprint: string;
  readonly id: string;
  readonly submitted_at: Date;
};

type StageRow = {
  readonly already_staged: boolean;
  readonly expires_at: Date;
  readonly pilot_revision_id: string;
  readonly private_live_deposit_pilot_proof_id: string;
  readonly verification_job_id: string;
};

type LeaseRow = {
  readonly assignment_id: string;
  readonly assignment_signer_id?: never;
  readonly attempt_number: number;
  readonly automatic_freshness_seconds: number;
  readonly candidate_reference_ciphertext: string;
  readonly candidate_reference_fingerprint: string;
  readonly candidate_reference_masked: string;
  readonly challenge_digest: string;
  readonly challenge_id: string;
  readonly deposit_policy_version: number;
  readonly deposit_policy_version_id: string;
  readonly eligibility_contract_version: string;
  readonly eligibility_decision_id: string;
  readonly eligibility_decision_version: number;
  readonly expires_at: Date;
  readonly lease_nonce_digest: string;
  readonly lease_token: string;
  readonly maximum_future_skew_seconds: number;
  readonly maximum_principal_amount_minor: string;
  readonly minimum_principal_amount_minor: string;
  readonly pilot_configuration_digest: string;
  readonly pilot_revision_id: string;
  readonly player_owner_customer_id: string;
  readonly policy_digest: string;
  readonly policy_version: string;
  readonly private_live_deposit_pilot_proof_id: string;
  readonly receiver_identity_digest: string;
  readonly replayed: boolean;
  readonly request_id: string;
  readonly selected_player_id: string;
  readonly source_profile: string;
  readonly verification_attempt_id: string;
  readonly verification_job_id: string;
};

type AssignmentRow = {
  readonly assignment_transcript_id: string;
  readonly replayed: boolean;
  readonly signed_at: Date;
  readonly verification_attempt_id: string;
};

type CompletionRow = {
  readonly already_completed: boolean;
  readonly deposit_intent_id: string | null;
  readonly deposit_payment_claim_id: string | null;
  readonly execution_job_id: string | null;
  readonly outcome_disposition: string;
  readonly outcome_reason_code: string;
  readonly settlement_created: boolean;
  readonly verification_outcome_id: string;
};

export type PreparedVerification = {
  readonly assignment: AssignmentRow;
  readonly lease: LeaseRow;
  readonly proof: ProofRow;
  readonly stage: StageRow;
};

export type CompletionOptions = {
  readonly assessedAt?: Date;
  readonly completionRequestKey?: string;
  readonly disposition: 'definite_reject' | 'review_required' | 'settlement_candidate';
  readonly occurredAt?: Date | null;
  readonly principalAmountMinor?: number | null;
  readonly protocolDisposition?: 'would_forward_signed_evidence' | 'would_review';
  readonly protocolReasonCode?: string;
  readonly reasonCode: string;
  readonly receiverIdentityDigest?: string | null;
  readonly replayIdentity?: string | null;
};

const lineageTables = [
  'private_live_telebirr_receiver_profiles',
  'private_live_telebirr_assignment_signers',
  'private_live_telebirr_assignment_signer_revocations',
  'private_live_telebirr_device_enrollments',
  'private_live_telebirr_device_revocations',
  'private_live_telebirr_verification_jobs',
  'private_live_telebirr_verification_attempts',
  'private_live_telebirr_assignment_transcripts',
  'private_live_telebirr_observation_transcripts',
  'private_live_telebirr_verification_outcomes',
  'private_live_telebirr_settlement_receipts',
] as const;

const lineageFunctions = [
  'app.private_live_telebirr_policy_digest(bigint,bigint)',
  'app.private_live_telebirr_eligibility_version(integer)',
  'app.stage_private_live_telebirr_verification_job(uuid,uuid)',
  'app.lease_next_private_live_telebirr_verification(uuid,text,uuid,integer)',
  'app.record_private_live_telebirr_assignment_transcript(uuid,uuid,uuid,text,text,text)',
  'app.complete_private_live_telebirr_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)',
] as const;

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function fingerprint(seed = randomUUID()): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function queryAsMigrationOwner<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  return (await client.query<T>(query, [...values])).rows;
}

async function expectFailureAtSavepoint(
  client: Client,
  query: string,
  values: readonly SqlValue[],
  expected: RegExp | string,
): Promise<void> {
  const savepoint = `expected_telebirr_lineage_failure_${fingerprint().slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  let failure: unknown;
  try {
    await client.query(query, [...values]);
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  expect(failure).toBeInstanceOf(Error);
  if (expected instanceof RegExp) expect(errorMessage(failure)).toMatch(expected);
  else expect(errorMessage(failure)).toContain(expected);
}

async function resolveTelebirrBoundary(
  client: Client,
  prerequisites: PilotPrerequisites,
): Promise<PilotPrerequisites> {
  let boundary = await client.query<{
    readonly payment_provider_id: string;
    readonly receiver_account_id: string;
    readonly receiver_account_version: number;
  }>(`
    select provider.id as payment_provider_id,
           receiver.id as receiver_account_id,
           receiver.version as receiver_account_version
      from app.payment_providers provider
      join app.receiver_accounts receiver
        on receiver.provider_id = provider.id
       and receiver.status = 'active'
     where provider.code = 'telebirr'
       and provider.status = 'active'
  `);

  if (boundary.rows.length === 0) {
    await client.query(`
      insert into app.receiver_accounts (
        provider_id,
        version,
        account_holder_name,
        account_reference_ciphertext,
        verification_reference_ciphertext,
        account_reference_masked,
        instructions
      )
      select provider.id,
             coalesce((
               select max(receiver.version) + 1
                 from app.receiver_accounts receiver
                where receiver.provider_id = provider.id
             ), 1),
             'Synthetic TeleBirr Private Pilot Receiver',
             'synthetic-telebirr-private-pilot-account-ciphertext',
             'synthetic-telebirr-private-pilot-verification-ciphertext',
             '****7001',
             jsonb_build_object('customer_message', 'Synthetic SQL fixture only')
        from app.payment_providers provider
       where provider.code = 'telebirr'
         and provider.status = 'active'
    `);
    boundary = await client.query(`
      select provider.id as payment_provider_id,
             receiver.id as receiver_account_id,
             receiver.version as receiver_account_version
        from app.payment_providers provider
        join app.receiver_accounts receiver
          on receiver.provider_id = provider.id
         and receiver.status = 'active'
       where provider.code = 'telebirr'
         and provider.status = 'active'
    `);
  }

  expect(boundary.rows).toHaveLength(1);
  return {
    ...prerequisites,
    paymentProviderId: boundary.rows[0]!.payment_provider_id,
    receiverAccountId: boundary.rows[0]!.receiver_account_id,
    receiverAccountVersion: boundary.rows[0]!.receiver_account_version,
  };
}

export async function prepareTelebirrPilot(
  client: Client,
  ownerAdminId: string,
  options: {
    readonly maximumPerDepositMinor?: number;
    readonly maximumPerPlayerMinor?: number;
    readonly maximumAggregateMinor?: number;
  } = {},
): Promise<TelebirrPilot> {
  const prerequisites = await resolveTelebirrBoundary(
    client,
    await createPilotPrerequisites(client),
  );
  const requestKey = randomUUID();
  const activeFrom = new Date(Date.now() - 30_000);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
  const maximumPerDepositMinor = options.maximumPerDepositMinor ?? 2_500_000;
  const maximumPerPlayerMinor = options.maximumPerPlayerMinor ?? 2_500_000;
  const maximumAggregateMinor = options.maximumAggregateMinor ?? 12_500_000;

  const prepared = await queryAsMigrationOwner<{ readonly pilot_revision_id: string }>(
    client,
    `select app.prepare_private_live_deposit_pilot(
       $1::uuid,
       $2::uuid,
       array['telebirr']::text[],
       $3::text[],
       array[$4::uuid]::uuid[],
       2500::bigint,
       $5::bigint,
       $6::bigint,
       $7::bigint,
       5::smallint,
       $8::timestamptz,
       $9::timestamptz
     ) as pilot_revision_id`,
    [
      ownerAdminId,
      requestKey,
      prerequisites.playerIds,
      prerequisites.submittingCustomerId,
      maximumPerDepositMinor,
      maximumPerPlayerMinor,
      maximumAggregateMinor,
      activeFrom,
      expiresAt,
    ],
  );
  expect(prepared).toHaveLength(1);

  const manifest = await client.query<{ readonly configuration_digest: string }>(
    `select configuration_digest
       from app.private_live_deposit_pilot_revisions
      where id = $1::uuid`,
    [prepared[0]!.pilot_revision_id],
  );
  const pilot: PreparedPilot = {
    ...prerequisites,
    activeFrom,
    configurationDigest: manifest.rows[0]!.configuration_digest,
    expiresAt,
    pilotRevisionId: prepared[0]!.pilot_revision_id,
    requestKey,
  };
  await armPilot(client, ownerAdminId, pilot);

  const activated = await client.query<{ readonly feature_key: string }>(`
    update app.feature_switches
       set mode = case
         when feature_key = 'cbe_birr_authoritative_verification' then 'disabled'::app.feature_mode
         else 'live'::app.feature_mode
       end
     where feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification'
     )
    returning feature_key
  `);
  expect(activated.rows).toHaveLength(5);

  const policy = await client.query<{
    readonly id: string;
    readonly maximum_amount_minor: string;
    readonly minimum_amount_minor: string;
    readonly policy_digest: string;
    readonly version: number;
  }>(
    `select policy.id,
            policy.version,
            greatest(policy.minimum_amount_minor, 2500::bigint)::text
              as minimum_amount_minor,
            least(policy.maximum_amount_minor, $1::bigint)::text
              as maximum_amount_minor,
            app.private_live_telebirr_policy_digest(
              greatest(policy.minimum_amount_minor, 2500::bigint),
              least(policy.maximum_amount_minor, $1::bigint)
            ) as policy_digest
       from app.deposit_policy_versions policy
      where policy.status = 'active'`,
    [maximumPerDepositMinor],
  );
  expect(policy.rows).toHaveLength(1);

  const receiverProfileId = randomUUID();
  const receiverIdentityDigest = digest('a');
  await client.query(
    `insert into app.private_live_telebirr_receiver_profiles (
       id,
       pilot_revision_id,
       payment_provider_id,
       receiver_account_id,
       receiver_account_version,
       pilot_configuration_digest,
       receiver_profile_digest,
       receiver_configuration_digest,
       receiver_identity_digest,
       expected_receiver_name_digest,
       deposit_policy_version_id,
       deposit_policy_version,
       minimum_principal_amount_minor,
       maximum_principal_amount_minor,
       policy_digest,
       valid_from,
       valid_until
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text,
       $7::text, $8::text, $9::text, $9::text, $10::uuid, $11::integer,
       $12::bigint, $13::bigint, $14::text, $15::timestamptz, $16::timestamptz
     )`,
    [
      receiverProfileId,
      pilot.pilotRevisionId,
      pilot.paymentProviderId,
      pilot.receiverAccountId,
      pilot.receiverAccountVersion,
      pilot.configurationDigest,
      digest('b'),
      digest('c'),
      receiverIdentityDigest,
      policy.rows[0]!.id,
      policy.rows[0]!.version,
      policy.rows[0]!.minimum_amount_minor,
      policy.rows[0]!.maximum_amount_minor,
      policy.rows[0]!.policy_digest,
      new Date(Date.now() - 5_000),
      pilot.expiresAt,
    ],
  );

  const assignmentSignerId = randomUUID();
  await client.query(
    `insert into app.private_live_telebirr_assignment_signers (
       id, signer_key_id, public_key_spki_sha256, valid_from, valid_until
     ) values ($1::uuid, $2::text, $3::text, $4::timestamptz, $5::timestamptz)`,
    [
      assignmentSignerId,
      `sql-signer-${fingerprint().slice(0, 16)}`,
      digest('d'),
      pilot.activeFrom,
      pilot.expiresAt,
    ],
  );

  const deviceEnrollmentId = randomUUID();
  await client.query(
    `insert into app.private_live_telebirr_device_enrollments (
       id, pilot_revision_id, receiver_profile_id, device_id, key_id,
       public_key_spki_sha256, valid_from, valid_until
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
       $7::timestamptz, $8::timestamptz
     )`,
    [
      deviceEnrollmentId,
      pilot.pilotRevisionId,
      receiverProfileId,
      `sql-device-${fingerprint().slice(0, 16)}`,
      `sql-device-key-${fingerprint().slice(0, 16)}`,
      digest('e'),
      new Date(Date.now() - 5_000),
      pilot.expiresAt,
    ],
  );

  return {
    ...pilot,
    assignmentSignerId,
    deviceEnrollmentId,
    policyDigest: policy.rows[0]!.policy_digest,
    receiverIdentityDigest,
    receiverProfileId,
  };
}

async function createLiveProof(
  client: Client,
  pilot: TelebirrPilot,
  playerIndex = 0,
  options: { readonly fingerprint?: string; readonly submittedAt?: Date } = {},
): Promise<ProofRow> {
  const referenceFingerprint = options.fingerprint ?? fingerprint();
  const submittedAt = options.submittedAt ?? new Date();
  const proof = await client.query<ProofRow>(
    `insert into app.private_live_deposit_pilot_proofs (
       pilot_revision_id,
       submitting_customer_id,
       player_account_id,
       payment_provider_id,
       provider_code_snapshot,
       origin_channel,
       input_kind,
       candidate_reference_ciphertext,
       candidate_reference_fingerprint,
       candidate_reference_masked,
       reference_encryption_key_version,
       reference_profile_version,
       submitted_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'telebirr', 'customer_web',
       'direct_transaction_id', $5::text, $6::text, $7::text, 2, 2,
       $8::timestamptz
     )
     returning id, candidate_reference_fingerprint, submitted_at`,
    [
      pilot.pilotRevisionId,
      pilot.submittingCustomerId,
      pilot.playerAccountIds[playerIndex]!,
      pilot.paymentProviderId,
      `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${referenceFingerprint.slice(0, 11)}`,
      referenceFingerprint,
      `***${referenceFingerprint.slice(0, 4).toUpperCase()}`,
      submittedAt,
    ],
  );
  expect(proof.rows).toHaveLength(1);
  return proof.rows[0]!;
}

async function stageProof(client: Client, proofId: string, requestKey = randomUUID()) {
  const staged = await client.query<StageRow>(
    `select *
       from app.stage_private_live_telebirr_verification_job($1::uuid, $2::uuid)`,
    [proofId, requestKey],
  );
  expect(staged.rows).toHaveLength(1);
  return { requestKey, row: staged.rows[0]! };
}

async function leaseJob(
  client: Client,
  pilot: TelebirrPilot,
  requestKey = randomUUID(),
): Promise<{ readonly requestKey: string; readonly row: LeaseRow }> {
  const lease = await client.query<LeaseRow>(
    `select *
       from app.lease_next_private_live_telebirr_verification(
         $1::uuid, 'sql-lineage-worker-01', $2::uuid, 120
       )`,
    [pilot.deviceEnrollmentId, requestKey],
  );
  expect(lease.rows).toHaveLength(1);
  return { requestKey, row: lease.rows[0]! };
}

async function recordAssignment(
  client: Client,
  pilot: TelebirrPilot,
  lease: LeaseRow,
  digests: {
    readonly body?: string;
    readonly referenceBinding?: string;
    readonly signature?: string;
  } = {},
): Promise<{ readonly digests: Required<typeof digests>; readonly row: AssignmentRow }> {
  const exactDigests = {
    body: digests.body ?? `sha256:${fingerprint()}`,
    referenceBinding: digests.referenceBinding ?? `sha256:${fingerprint()}`,
    signature: digests.signature ?? `sha256:${fingerprint()}`,
  };
  const assignment = await client.query<AssignmentRow>(
    `select *
       from app.record_private_live_telebirr_assignment_transcript(
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
       )`,
    [
      lease.verification_attempt_id,
      lease.lease_token,
      pilot.assignmentSignerId,
      exactDigests.body,
      exactDigests.signature,
      exactDigests.referenceBinding,
    ],
  );
  expect(assignment.rows).toHaveLength(1);
  return { digests: exactDigests, row: assignment.rows[0]! };
}

export async function prepareVerification(
  client: Client,
  pilot: TelebirrPilot,
  playerIndex = 0,
  proofOptions: { readonly fingerprint?: string; readonly submittedAt?: Date } = {},
): Promise<PreparedVerification> {
  const proof = await createLiveProof(client, pilot, playerIndex, proofOptions);
  const stage = (await stageProof(client, proof.id)).row;
  const lease = (await leaseJob(client, pilot)).row;
  expect(lease.verification_job_id).toBe(stage.verification_job_id);
  const assignment = (await recordAssignment(client, pilot, lease)).row;
  return { assignment, lease, proof, stage };
}

export async function completeVerification(
  client: Client,
  pilot: TelebirrPilot,
  prepared: PreparedVerification,
  options: CompletionOptions,
): Promise<{
  readonly completionRequestKey: string;
  readonly digests: {
    readonly assessment: string;
    readonly evidence: string;
    readonly normalizedFacts: string;
    readonly observationBody: string;
    readonly observationSignature: string;
    readonly sourceDocument: string;
  };
  readonly row: CompletionRow;
  readonly replayIdentity: string | null;
  readonly times: {
    readonly assessedAt: Date;
    readonly observedAt: Date;
    readonly retrievedAt: Date;
  };
}> {
  const assessedAt = options.assessedAt ?? new Date();
  const observedAt = new Date(assessedAt.getTime() - 1);
  const retrievedAt = new Date(assessedAt.getTime() - 1);
  const completionRequestKey = options.completionRequestKey ?? randomUUID();
  const exactDigests = {
    assessment: `sha256:${fingerprint()}`,
    evidence: `sha256:${fingerprint()}`,
    normalizedFacts: `sha256:${fingerprint()}`,
    observationBody: `sha256:${fingerprint()}`,
    observationSignature: `sha256:${fingerprint()}`,
    sourceDocument: `sha256:${fingerprint()}`,
  };
  const settlement = options.disposition === 'settlement_candidate';
  const replayIdentity =
    options.replayIdentity === undefined
      ? settlement
        ? `sha256:${fingerprint()}`
        : null
      : options.replayIdentity;
  const completion = await client.query<CompletionRow>(
    `select *
       from app.complete_private_live_telebirr_verification(
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
         $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
         $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
         $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
       )`,
    [
      prepared.lease.verification_attempt_id,
      prepared.lease.lease_token,
      completionRequestKey,
      exactDigests.observationBody,
      exactDigests.observationSignature,
      replayIdentity,
      exactDigests.sourceDocument,
      exactDigests.normalizedFacts,
      observedAt,
      options.protocolDisposition ??
        (settlement ? 'would_forward_signed_evidence' : 'would_review'),
      options.protocolReasonCode ??
        (settlement ? 'signed_evidence_verified' : 'receipt_requires_review'),
      exactDigests.assessment,
      assessedAt,
      options.disposition,
      options.reasonCode,
      exactDigests.evidence,
      retrievedAt,
      options.principalAmountMinor === undefined
        ? settlement
          ? 2500
          : null
        : options.principalAmountMinor,
      options.occurredAt === undefined
        ? settlement
          ? prepared.proof.submitted_at
          : null
        : options.occurredAt,
      options.receiverIdentityDigest === undefined
        ? settlement
          ? pilot.receiverIdentityDigest
          : null
        : options.receiverIdentityDigest,
    ],
  );
  expect(completion.rows).toHaveLength(1);
  return {
    completionRequestKey,
    digests: exactDigests,
    replayIdentity,
    row: completion.rows[0]!,
    times: { assessedAt, observedAt, retrievedAt },
  };
}

function completionReplayValues(
  pilot: TelebirrPilot,
  prepared: PreparedVerification,
  completed: Awaited<ReturnType<typeof completeVerification>>,
  disposition: string,
  reasonCode: string,
): readonly SqlValue[] {
  const settlement = disposition === 'settlement_candidate';
  return [
    prepared.lease.verification_attempt_id,
    prepared.lease.lease_token,
    completed.completionRequestKey,
    completed.digests.observationBody,
    completed.digests.observationSignature,
    completed.replayIdentity,
    completed.digests.sourceDocument,
    completed.digests.normalizedFacts,
    completed.times.observedAt,
    settlement ? 'would_forward_signed_evidence' : 'would_review',
    settlement ? 'signed_evidence_verified' : 'receipt_requires_review',
    completed.digests.assessment,
    completed.times.assessedAt,
    disposition,
    reasonCode,
    completed.digests.evidence,
    completed.times.retrievedAt,
    settlement ? 2500 : null,
    settlement ? prepared.proof.submitted_at : null,
    settlement ? pilot.receiverIdentityDigest : null,
  ];
}

export function registerPrivateLiveTelebirrProofLineageSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('private live TeleBirr proof-first verification lineage', () => {
    it('is dormant, RLS-sealed, ungranted, dry-run-disconnected, and shares the policy vector', async () => {
      const client = getClient();
      const relations = await client.query<{
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
      }>(
        `select relation.relname,
                relation.relrowsecurity,
                relation.relforcerowsecurity
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'app'
            and relation.relname = any($1::text[])
          order by relation.relname`,
        [[...lineageTables]],
      );
      expect(relations.rows.map((row) => row.relname).sort()).toEqual([...lineageTables].sort());
      expect(relations.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(
        true,
      );

      const policies = await client.query<{ readonly count: number }>(
        `select count(*)::integer as count
           from pg_policy policy
           join pg_class relation on relation.oid = policy.polrelid
           join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'app'
            and relation.relname = any($1::text[])`,
        [[...lineageTables]],
      );
      expect(policies.rows).toEqual([{ count: 0 }]);

      const relationGrants = await client.query<{ readonly count: number }>(
        `select count(*)::integer as count
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join lateral aclexplode(
             coalesce(relation.relacl, acldefault('r', relation.relowner))
           ) privilege
          where namespace.nspname = 'app'
            and relation.relname = any($1::text[])
            and privilege.grantee <> relation.relowner`,
        [[...lineageTables]],
      );
      expect(relationGrants.rows).toEqual([{ count: 0 }]);

      const routines = await client.query<{
        readonly direct_grants: number;
        readonly is_security_definer: boolean;
        readonly owner_control_execute: boolean;
        readonly owner_control_runtime_execute: boolean;
        readonly public_execute: boolean;
        readonly safe_search_path: boolean;
        readonly signature: string;
        readonly trusted_verifier_execute: boolean;
        readonly trusted_verifier_runtime_execute: boolean;
      }>(
        `select routine.oid::regprocedure::text as signature,
                routine.prosecdef as is_security_definer,
                coalesce(routine.proconfig, '{}'::text[])
                  @> array['search_path=pg_catalog']::text[] as safe_search_path,
                has_function_privilege('public', routine.oid, 'EXECUTE') as public_execute,
                has_function_privilege(
                  'fetanagent_owner_control', routine.oid, 'EXECUTE'
                ) as owner_control_execute,
                has_function_privilege(
                  'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
                ) as owner_control_runtime_execute,
                has_function_privilege(
                  'fetanagent_trusted_telebirr_verifier', routine.oid, 'EXECUTE'
                ) as trusted_verifier_execute,
                has_function_privilege(
                  'fetanagent_trusted_telebirr_verifier_runtime', routine.oid, 'EXECUTE'
                ) as trusted_verifier_runtime_execute,
                (
                  select count(*)::integer
                    from aclexplode(coalesce(
                      routine.proacl,
                      acldefault('f', routine.proowner)
                    )) privilege
                   where privilege.grantee <> routine.proowner
                ) as direct_grants
           from unnest($1::text[]) requested(signature)
           join pg_proc routine on routine.oid = to_regprocedure(requested.signature)
          order by signature`,
        [[...lineageFunctions]],
      );
      expect(routines.rows).toHaveLength(lineageFunctions.length);
      expect(
        routines.rows.every((row) => {
          const isGuardedCompletion = row.signature === lineageFunctions.at(-1);
          return (
            row.is_security_definer &&
            row.safe_search_path &&
            !row.public_execute &&
            !row.owner_control_execute &&
            !row.owner_control_runtime_execute &&
            row.trusted_verifier_execute === isGuardedCompletion &&
            row.trusted_verifier_runtime_execute === isGuardedCompletion &&
            row.direct_grants === (isGuardedCompletion ? 1 : 0)
          );
        }),
      ).toBe(true);

      const dryRunForeignKeys = await client.query<{ readonly count: number }>(
        `
        select count(*)::integer as count
          from pg_constraint constraint_row
          join pg_class source on source.oid = constraint_row.conrelid
          join pg_namespace source_namespace on source_namespace.oid = source.relnamespace
          join pg_class target on target.oid = constraint_row.confrelid
         where constraint_row.contype = 'f'
           and source_namespace.nspname = 'app'
           and source.relname = any($1::text[])
           and target.relname in (
             'deposit_proof_requests',
             'telegram_dry_run_deposit_proof_receipts',
             'customer_web_dry_run_deposit_proof_receipts'
           )
      `,
        [[...lineageTables]],
      );
      expect(dryRunForeignKeys.rows).toEqual([{ count: 0 }]);

      const vector = await client.query<{
        readonly digest: string;
        readonly eligibility_version: string;
      }>(`
        select app.private_live_telebirr_policy_digest(2500, 2500000) as digest,
               app.private_live_telebirr_eligibility_version(1) as eligibility_version
      `);
      expect(vector.rows).toEqual([
        {
          digest: 'sha256:c3dfbfa1f7caf08d9be09edebdb670bc2395fe79ebd4971374c965c2a751416e',
          eligibility_version: 'kemerbet_player_eligibility_v1',
        },
      ]);

      const rows = await client.query<{ readonly count: number }>(
        `select sum(row_count)::integer as count
           from (
             select count(*)::integer as row_count
               from app.private_live_telebirr_verification_jobs
             union all
             select count(*)::integer
               from app.private_live_telebirr_verification_outcomes
             union all
             select count(*)::integer
               from app.private_live_telebirr_settlement_receipts
           ) counts`,
      );
      expect(rows.rows).toEqual([{ count: 0 }]);
    });

    it('preserves the historical amount-first intent trigger path while the pilot is disabled', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const prerequisites = await createPilotPrerequisites(client);
        const intent = await client.query<{
          readonly customer_id: string;
          readonly expected_amount_minor: string;
          readonly freshness_window_seconds: number;
          readonly private_live_telebirr_outcome_id: string | null;
          readonly status: string;
        }>(
          `insert into app.deposit_intents (
             customer_id,
             platform_id,
             player_account_id,
             payment_provider_id,
             receiver_account_id,
             expected_amount_minor
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
           returning customer_id,
                     expected_amount_minor,
                     freshness_window_seconds,
                     private_live_telebirr_outcome_id,
                     status`,
          [
            prerequisites.ownerCustomerId,
            prerequisites.platformId,
            prerequisites.playerAccountIds[0]!,
            prerequisites.paymentProviderId,
            prerequisites.receiverAccountId,
          ],
        );
        expect(intent.rows).toHaveLength(1);
        expect(intent.rows[0]).toMatchObject({
          customer_id: prerequisites.ownerCustomerId,
          expected_amount_minor: '2500',
          private_live_telebirr_outcome_id: null,
          status: 'intake_received',
        });
        expect(intent.rows[0]!.freshness_window_seconds).toBeGreaterThanOrEqual(60);
      });
    });

    it('stages only live proofs and enforces exact lease, transcript, expiry, and revocation replay', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());

        const decision = await client.query<{ readonly id: string }>(
          `select id
             from app.player_deposit_eligibility_decisions
            where player_account_id = $1::uuid
            order by decision_version desc
            limit 1`,
          [pilot.playerAccountIds[0]!],
        );
        const dryProofId = randomUUID();
        await client.query(
          `insert into app.deposit_proof_requests (
             id, submitting_customer_id, origin_channel, platform_id, player_account_id,
             player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version
           ) values (
             $1::uuid, $2::uuid, 'customer_web', $3::uuid, $4::uuid, $5::uuid,
             $6::uuid, 'telebirr', $7::text, $8::text, '***DRY1', 2, 2
           )`,
          [
            dryProofId,
            pilot.submittingCustomerId,
            pilot.platformId,
            pilot.playerAccountIds[0]!,
            decision.rows[0]!.id,
            pilot.paymentProviderId,
            `v2.telebirr.${'D'.repeat(16)}.${'E'.repeat(22)}.${'F'.repeat(11)}`,
            fingerprint(),
          ],
        );
        await expectFailureAtSavepoint(
          client,
          `select * from app.stage_private_live_telebirr_verification_job($1::uuid, $2::uuid)`,
          [dryProofId, randomUUID()],
          /proof is unavailable/u,
        );

        const proof = await createLiveProof(client, pilot);
        const stageRequestKey = randomUUID();
        const firstStage = (await stageProof(client, proof.id, stageRequestKey)).row;
        expect(firstStage).toMatchObject({
          already_staged: false,
          pilot_revision_id: pilot.pilotRevisionId,
          private_live_deposit_pilot_proof_id: proof.id,
        });
        const stageReplay = (await stageProof(client, proof.id, stageRequestKey)).row;
        expect(stageReplay).toMatchObject({
          already_staged: true,
          verification_job_id: firstStage.verification_job_id,
        });
        await expectFailureAtSavepoint(
          client,
          `select * from app.stage_private_live_telebirr_verification_job($1::uuid, $2::uuid)`,
          [proof.id, randomUUID()],
          /staging replay conflicts/u,
        );

        const leaseRequestKey = randomUUID();
        const firstLease = (await leaseJob(client, pilot, leaseRequestKey)).row;
        expect(firstLease).toMatchObject({
          automatic_freshness_seconds: 3600,
          candidate_reference_fingerprint: proof.candidate_reference_fingerprint,
          eligibility_contract_version: 'kemerbet_player_eligibility_v1',
          eligibility_decision_version: 1,
          maximum_future_skew_seconds: 300,
          pilot_revision_id: pilot.pilotRevisionId,
          player_owner_customer_id: pilot.ownerCustomerId,
          policy_digest: pilot.policyDigest,
          policy_version: 'telebirr_private_pilot_policy_v1',
          receiver_identity_digest: pilot.receiverIdentityDigest,
          replayed: false,
          selected_player_id: pilot.playerIds[0],
          source_profile: 'telebirr_official_receipt_v1',
          verification_job_id: firstStage.verification_job_id,
        });
        const leaseReplay = (await leaseJob(client, pilot, leaseRequestKey)).row;
        expect(leaseReplay).toMatchObject({
          lease_token: firstLease.lease_token,
          replayed: true,
          verification_attempt_id: firstLease.verification_attempt_id,
        });

        const firstAssignment = await recordAssignment(client, pilot, firstLease);
        expect(firstAssignment.row.replayed).toBe(false);
        const assignmentReplay = await recordAssignment(
          client,
          pilot,
          firstLease,
          firstAssignment.digests,
        );
        expect(assignmentReplay.row).toMatchObject({
          assignment_transcript_id: firstAssignment.row.assignment_transcript_id,
          replayed: true,
        });
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.record_private_live_telebirr_assignment_transcript(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
             )`,
          [
            firstLease.verification_attempt_id,
            randomUUID(),
            pilot.assignmentSignerId,
            firstAssignment.digests.body,
            firstAssignment.digests.signature,
            firstAssignment.digests.referenceBinding,
          ],
          /transcript authority is unavailable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.record_private_live_telebirr_assignment_transcript(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
             )`,
          [
            firstLease.verification_attempt_id,
            firstLease.lease_token,
            pilot.assignmentSignerId,
            digest('f'),
            firstAssignment.digests.signature,
            firstAssignment.digests.referenceBinding,
          ],
          /transcript replay conflicts/u,
        );

        const expiredCompletionAt = new Date(firstLease.expires_at.getTime() + 1_000);
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, null,
               $6::text, $7::text, $8::timestamptz, 'would_review',
               'receipt_requires_review', $9::text, $10::timestamptz,
               'review_required', 'source_uncertain', $11::text,
               $10::timestamptz, null, null, null
             )`,
          [
            firstLease.verification_attempt_id,
            firstLease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            expiredCompletionAt,
            digest('5'),
            expiredCompletionAt,
            digest('6'),
          ],
          /completion lineage is invalid/u,
        );

        const deviceAssessedAt = new Date();
        const deviceObservedAt = new Date(deviceAssessedAt.getTime() - 1);
        await client.query(
          `insert into app.private_live_telebirr_device_revocations (
             device_enrollment_id, revoked_at, reason_code
           ) values ($1::uuid, clock_timestamp(), 'owner_revoked')`,
          [pilot.deviceEnrollmentId],
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.lease_next_private_live_telebirr_verification(
               $1::uuid, 'sql-lineage-worker-01', $2::uuid, 120
             )`,
          [pilot.deviceEnrollmentId, leaseRequestKey],
          /lease authority is unavailable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.record_private_live_telebirr_assignment_transcript(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
             )`,
          [
            firstLease.verification_attempt_id,
            firstLease.lease_token,
            pilot.assignmentSignerId,
            firstAssignment.digests.body,
            firstAssignment.digests.signature,
            firstAssignment.digests.referenceBinding,
          ],
          /transcript authority is unavailable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, null,
               $6::text, $7::text, $8::timestamptz, 'would_review',
               'receipt_requires_review', $9::text, $10::timestamptz,
               'review_required', 'source_uncertain', $11::text,
               $10::timestamptz, null, null, null
             )`,
          [
            firstLease.verification_attempt_id,
            firstLease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            deviceObservedAt,
            digest('5'),
            deviceAssessedAt,
            digest('6'),
          ],
          /completion lineage is invalid/u,
        );

        const transcript = await client.query<{
          readonly assignment_body_digest: string;
          readonly assignment_signature_digest: string;
          readonly signer_key_id_snapshot: string;
          readonly signer_public_key_spki_sha256_snapshot: string;
        }>(
          `select assignment_body_digest,
                  assignment_signature_digest,
                  signer_key_id_snapshot,
                  signer_public_key_spki_sha256_snapshot
             from app.private_live_telebirr_assignment_transcripts
            where id = $1::uuid`,
          [firstAssignment.row.assignment_transcript_id],
        );
        expect(transcript.rows).toHaveLength(1);
        expect(transcript.rows[0]).toMatchObject({
          assignment_body_digest: firstAssignment.digests.body,
          assignment_signature_digest: firstAssignment.digests.signature,
        });
        expect(transcript.rows[0]!.signer_key_id_snapshot).toMatch(/^sql-signer-/u);
        expect(transcript.rows[0]!.signer_public_key_spki_sha256_snapshot).toBe(digest('d'));

        await expectFailureAtSavepoint(
          client,
          `update app.private_live_telebirr_verification_attempts
              set leased_by = 'mutated-worker'
            where id = $1::uuid`,
          [firstLease.verification_attempt_id],
          /append-only/u,
        );
        await expectFailureAtSavepoint(
          client,
          `truncate table app.private_live_telebirr_assignment_transcripts`,
          [],
          /cannot truncate/u,
        );
      });
    });

    it('retains review and reject as amount-free outcomes that cannot settle', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const reviewPrepared = await prepareVerification(client, pilot, 0);
        const review = await completeVerification(client, pilot, reviewPrepared, {
          disposition: 'review_required',
          reasonCode: 'source_uncertain',
        });
        expect(review.row).toMatchObject({
          already_completed: false,
          deposit_intent_id: null,
          deposit_payment_claim_id: null,
          execution_job_id: null,
          outcome_disposition: 'review_required',
          outcome_reason_code: 'source_uncertain',
          settlement_created: false,
        });

        const replay = await client.query<CompletionRow>(
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
               $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
               $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
             )`,
          [
            ...completionReplayValues(
              pilot,
              reviewPrepared,
              review,
              'review_required',
              'source_uncertain',
            ),
          ],
        );
        expect(replay.rows).toHaveLength(1);
        expect(replay.rows[0]).toMatchObject({
          already_completed: true,
          settlement_created: false,
          verification_outcome_id: review.row.verification_outcome_id,
        });
        const wrongLeaseReplayValues = [
          ...completionReplayValues(
            pilot,
            reviewPrepared,
            review,
            'review_required',
            'source_uncertain',
          ),
        ];
        wrongLeaseReplayValues[1] = randomUUID();
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
               $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
               $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
             )`,
          wrongLeaseReplayValues,
          /completion lineage is unavailable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
               $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
               $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
             )`,
          [
            ...completionReplayValues(
              pilot,
              reviewPrepared,
              review,
              'review_required',
              'source_ambiguous',
            ),
          ],
          /completion replay conflicts/u,
        );

        const rejectPrepared = await prepareVerification(client, pilot, 1);
        const rejected = await completeVerification(client, pilot, rejectPrepared, {
          disposition: 'definite_reject',
          protocolReasonCode: 'reference_mismatch',
          reasonCode: 'reference_mismatch',
        });
        expect(rejected.row).toMatchObject({
          deposit_intent_id: null,
          outcome_disposition: 'definite_reject',
          outcome_reason_code: 'reference_mismatch',
          settlement_created: false,
        });

        const forbidden404 = await prepareVerification(client, pilot, 2);
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, null,
               $6::text, $7::text, clock_timestamp(), 'would_review',
               'reference_not_found', $8::text, clock_timestamp(),
               'definite_reject', 'reference_mismatch', $9::text,
               clock_timestamp(), null, null, null
             )`,
          [
            forbidden404.lease.verification_attempt_id,
            forbidden404.lease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            digest('5'),
            digest('6'),
          ],
          /completion request is invalid/u,
        );

        const signerRevoked = await prepareVerification(client, pilot, 3);
        const signerAssessedAt = new Date();
        const signerObservedAt = new Date(signerAssessedAt.getTime() - 1);
        await client.query(
          `insert into app.private_live_telebirr_assignment_signer_revocations (
             assignment_signer_id, revoked_at, reason_code
           ) values ($1::uuid, clock_timestamp(), 'owner_revoked')`,
          [pilot.assignmentSignerId],
        );
        const revokedAssignment = await client.query<{
          readonly assignment_body_digest: string;
          readonly assignment_signature_digest: string;
          readonly reference_binding_digest: string;
        }>(
          `select assignment_body_digest,
                  assignment_signature_digest,
                  reference_binding_digest
             from app.private_live_telebirr_assignment_transcripts
            where verification_attempt_id = $1::uuid`,
          [signerRevoked.lease.verification_attempt_id],
        );
        expect(revokedAssignment.rows).toHaveLength(1);
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.record_private_live_telebirr_assignment_transcript(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
             )`,
          [
            signerRevoked.lease.verification_attempt_id,
            signerRevoked.lease.lease_token,
            pilot.assignmentSignerId,
            revokedAssignment.rows[0]!.assignment_body_digest,
            revokedAssignment.rows[0]!.assignment_signature_digest,
            revokedAssignment.rows[0]!.reference_binding_digest,
          ],
          /transcript authority is unavailable/u,
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, null,
               $6::text, $7::text, $8::timestamptz, 'would_review',
               'receipt_requires_review', $9::text, $10::timestamptz,
               'review_required', 'source_uncertain', $11::text,
               $10::timestamptz, null, null, null
             )`,
          [
            signerRevoked.lease.verification_attempt_id,
            signerRevoked.lease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            signerObservedAt,
            digest('5'),
            signerAssessedAt,
            digest('6'),
          ],
          /completion lineage is invalid/u,
        );

        const financialRows = await client.query<{
          readonly intents: number;
          readonly receipts: number;
          readonly settlement_outcomes: number;
        }>(`
          select (
                   select count(*)::integer
                     from app.deposit_intents
                    where private_live_telebirr_outcome_id is not null
                 ) as intents,
                 (
                   select count(*)::integer
                     from app.private_live_telebirr_settlement_receipts
                 ) as receipts,
                 (
                   select count(*)::integer
                     from app.private_live_telebirr_verification_outcomes
                    where disposition = 'settlement_candidate'
                 ) as settlement_outcomes
        `);
        expect(financialRows.rows).toEqual([{ intents: 0, receipts: 0, settlement_outcomes: 0 }]);
      });
    });

    it('atomically settles a cross-customer receipt and rolls back duplicates, windows, and caps', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId(), {
          maximumAggregateMinor: 12_500,
          maximumPerDepositMinor: 2_500,
          maximumPerPlayerMinor: 2_500,
        });
        expect(pilot.submittingCustomerId).not.toBe(pilot.ownerCustomerId);
        const ownerAllowlist = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count
             from app.private_live_deposit_pilot_customers
            where pilot_revision_id = $1::uuid
              and customer_id = $2::uuid`,
          [pilot.pilotRevisionId, pilot.ownerCustomerId],
        );
        expect(ownerAllowlist.rows).toEqual([{ count: 0 }]);

        const first = await prepareVerification(client, pilot, 0);
        const settled = await completeVerification(client, pilot, first, {
          disposition: 'settlement_candidate',
          reasonCode: 'exact_proof_match',
        });
        expect(settled.row).toMatchObject({
          already_completed: false,
          outcome_disposition: 'settlement_candidate',
          outcome_reason_code: 'exact_proof_match',
          settlement_created: true,
        });
        expect(settled.row.deposit_intent_id).toEqual(expect.any(String));
        expect(settled.row.deposit_payment_claim_id).toEqual(expect.any(String));
        expect(settled.row.execution_job_id).toEqual(expect.any(String));

        const exactLineage = await client.query<{
          readonly intent_matches_active_policy: boolean;
          readonly intent_customer_id: string;
          readonly outcome_owner_customer_id: string;
          readonly outcome_submitting_customer_id: string;
          readonly pilot_layers_enforce_narrower_policy: boolean;
          readonly reservation_owner_customer_id: string;
          readonly reservation_submitting_customer_id: string;
          readonly settled_amount: string;
        }>(
          `select intent.customer_id as intent_customer_id,
                  outcome.player_owner_customer_id_snapshot as outcome_owner_customer_id,
                  outcome.submitting_customer_id as outcome_submitting_customer_id,
                  reservation.player_owner_customer_id_snapshot
                    as reservation_owner_customer_id,
                  reservation.submitting_customer_id
                    as reservation_submitting_customer_id,
                  outcome.principal_amount_minor::text as settled_amount,
                  intent.deposit_policy_version_id = policy.id
                    and intent.deposit_policy_version = policy.version
                    and intent.minimum_amount_minor = policy.minimum_amount_minor
                    and intent.maximum_amount_minor = policy.maximum_amount_minor
                    and intent.freshness_window_seconds = policy.freshness_window_seconds
                    and intent.payment_deadline_at = intent.opened_at
                      + pg_catalog.make_interval(
                          secs => policy.freshness_window_seconds
                        ) as intent_matches_active_policy,
                  profile.minimum_principal_amount_minor = greatest(
                    policy.minimum_amount_minor,
                    pilot.minimum_amount_minor
                  )
                    and profile.maximum_principal_amount_minor = least(
                      policy.maximum_amount_minor,
                      pilot.maximum_per_deposit_minor
                    )
                    and (
                      profile.minimum_principal_amount_minor
                        > policy.minimum_amount_minor
                      or profile.maximum_principal_amount_minor
                        < policy.maximum_amount_minor
                    )
                    and profile.automatic_freshness_seconds = 3600
                    and outcome.principal_amount_minor
                      between profile.minimum_principal_amount_minor
                      and profile.maximum_principal_amount_minor
                    and outcome.occurred_at >= proof.submitted_at
                      - pg_catalog.make_interval(
                          secs => profile.automatic_freshness_seconds
                        )
                    and outcome.occurred_at <= proof.submitted_at
                      + pg_catalog.make_interval(
                          secs => profile.maximum_future_skew_seconds
                        )
                    and reservation.amount_minor
                      between profile.minimum_principal_amount_minor
                      and profile.maximum_principal_amount_minor
                    as pilot_layers_enforce_narrower_policy
             from app.private_live_telebirr_verification_outcomes outcome
             join app.deposit_intents intent on intent.id = outcome.deposit_intent_id
             join app.private_live_deposit_pilot_reservations reservation
               on reservation.deposit_intent_id = intent.id
             join app.private_live_deposit_pilot_proofs proof
               on proof.id = reservation.private_live_deposit_pilot_proof_id
             join app.private_live_deposit_pilot_revisions pilot
               on pilot.id = outcome.pilot_revision_id
             join app.private_live_telebirr_receiver_profiles profile
               on profile.id = outcome.receiver_profile_id
             join app.deposit_policy_versions policy
               on policy.id = intent.deposit_policy_version_id
              and policy.version = intent.deposit_policy_version
            where outcome.id = $1::uuid`,
          [settled.row.verification_outcome_id],
        );
        expect(exactLineage.rows).toEqual([
          {
            intent_customer_id: pilot.ownerCustomerId,
            intent_matches_active_policy: true,
            outcome_owner_customer_id: pilot.ownerCustomerId,
            outcome_submitting_customer_id: pilot.submittingCustomerId,
            pilot_layers_enforce_narrower_policy: true,
            reservation_owner_customer_id: pilot.ownerCustomerId,
            reservation_submitting_customer_id: pilot.submittingCustomerId,
            settled_amount: '2500',
          },
        ]);

        const replay = await client.query<CompletionRow>(
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
               $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
               $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
             )`,
          [
            ...completionReplayValues(
              pilot,
              first,
              settled,
              'settlement_candidate',
              'exact_proof_match',
            ),
          ],
        );
        expect(replay.rows[0]).toMatchObject({
          already_completed: true,
          deposit_intent_id: settled.row.deposit_intent_id,
          deposit_payment_claim_id: settled.row.deposit_payment_claim_id,
          execution_job_id: settled.row.execution_job_id,
          settlement_created: true,
        });

        await expectFailureAtSavepoint(
          client,
          `insert into app.private_live_deposit_pilot_proofs (
             pilot_revision_id, submitting_customer_id, player_account_id,
             payment_provider_id, provider_code_snapshot, origin_channel, input_kind,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version
           ) values (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'telebirr', 'customer_web',
             'direct_transaction_id', $5::text, $6::text, '***DUP1', 2, 2
           )`,
          [
            pilot.pilotRevisionId,
            pilot.submittingCustomerId,
            pilot.playerAccountIds[1]!,
            pilot.paymentProviderId,
            `v2.telebirr.${'G'.repeat(16)}.${'H'.repeat(22)}.${'I'.repeat(11)}`,
            first.proof.candidate_reference_fingerprint,
          ],
          /private_live_deposit_pilot_proofs_provider_reference_key/u,
        );

        const secondSamePlayer = await prepareVerification(client, pilot, 0);
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, clock_timestamp(),
               'would_forward_signed_evidence', 'signed_evidence_verified',
               $9::text, clock_timestamp(), 'settlement_candidate',
               'exact_proof_match', $10::text, clock_timestamp(), 2500,
               $11::timestamptz, $12::text
             )`,
          [
            secondSamePlayer.lease.verification_attempt_id,
            secondSamePlayer.lease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            digest('5'),
            digest('6'),
            digest('7'),
            secondSamePlayer.proof.submitted_at,
            pilot.receiverIdentityDigest,
          ],
          /reservation budget is exhausted/u,
        );
        const rolledBack = await client.query<{
          readonly legacy_rows: number;
          readonly observations: number;
          readonly outcomes: number;
        }>(
          `select (
                   select count(*)::integer
                     from app.private_live_telebirr_observation_transcripts
                    where verification_attempt_id = $1::uuid
                 ) as observations,
                 (
                   select count(*)::integer
                     from app.private_live_telebirr_verification_outcomes
                    where verification_attempt_id = $1::uuid
                 ) as outcomes,
                 (
                   select count(*)::integer
                     from app.deposit_intents
                    where private_live_telebirr_outcome_id in (
                      select id
                        from app.private_live_telebirr_verification_outcomes
                       where verification_attempt_id = $1::uuid
                    )
                 ) as legacy_rows`,
          [secondSamePlayer.lease.verification_attempt_id],
        );
        expect(rolledBack.rows).toEqual([{ legacy_rows: 0, observations: 0, outcomes: 0 }]);

        const outsideWindow = await prepareVerification(client, pilot, 1);
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, clock_timestamp(),
               'would_forward_signed_evidence', 'signed_evidence_verified',
               $9::text, clock_timestamp(), 'settlement_candidate',
               'exact_proof_match', $10::text, clock_timestamp(), 2500,
               $11::timestamptz, $12::text
             )`,
          [
            outsideWindow.lease.verification_attempt_id,
            outsideWindow.lease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            digest('5'),
            digest('6'),
            digest('7'),
            new Date(outsideWindow.proof.submitted_at.getTime() - 3_600_001),
            pilot.receiverIdentityDigest,
          ],
          /settlement candidate is not authorized/u,
        );

        const duplicateEvidence = await prepareVerification(client, pilot, 2);
        await client.query(
          `insert into app.provider_payment_evidence (
             payment_provider_id,
             canonical_reference_ciphertext,
             canonical_reference_fingerprint,
             canonical_reference_masked,
             reference_encryption_key_version,
             evidence_source,
             amount_minor,
             currency_code,
             occurred_at,
             matched_receiver_account_id,
             matched_receiver_account_version,
             evidence_digest,
             adapter_version,
             normalization_version,
             retrieved_at
           ) values (
             $1::uuid, $2::text, $3::text, $4::text, 2,
             'provider_receipt_lookup', 2500, 'ETB', $5::timestamptz,
             $6::uuid, $7::integer, $8::text, 'duplicate-fixture-v1',
             'duplicate-fixture-v1', $5::timestamptz
           )`,
          [
            pilot.paymentProviderId,
            duplicateEvidence.lease.candidate_reference_ciphertext,
            duplicateEvidence.proof.candidate_reference_fingerprint,
            duplicateEvidence.lease.candidate_reference_masked,
            duplicateEvidence.proof.submitted_at,
            pilot.receiverAccountId,
            pilot.receiverAccountVersion,
            `duplicate-evidence-${fingerprint()}`,
          ],
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, clock_timestamp(),
               'would_forward_signed_evidence', 'signed_evidence_verified',
               $9::text, clock_timestamp(), 'settlement_candidate',
               'exact_proof_match', $10::text, clock_timestamp(), 2500,
               $11::timestamptz, $12::text
             )`,
          [
            duplicateEvidence.lease.verification_attempt_id,
            duplicateEvidence.lease.lease_token,
            randomUUID(),
            digest('1'),
            digest('2'),
            digest('3'),
            digest('4'),
            digest('5'),
            digest('6'),
            digest('7'),
            duplicateEvidence.proof.submitted_at,
            pilot.receiverIdentityDigest,
          ],
          /settlement candidate is not authorized/u,
        );

        const receipt = await client.query<{ readonly count: number }>(
          `select count(*)::integer as count
             from app.private_live_telebirr_settlement_receipts`,
        );
        expect(receipt.rows).toEqual([{ count: 1 }]);

        await queryAsMigrationOwner(
          client,
          `select app.stop_private_live_deposit_pilot(
             $1::uuid, $2::uuid, 'pilot_complete'
           )`,
          [getOwnerAdminId(), pilot.pilotRevisionId],
        );
        await expectFailureAtSavepoint(
          client,
          `select *
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
               $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
               $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
             )`,
          [
            ...completionReplayValues(
              pilot,
              first,
              settled,
              'settlement_candidate',
              'exact_proof_match',
            ),
          ],
          /completion lineage is invalid/u,
        );
      });
    });
  });
}
