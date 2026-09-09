import { createHash, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { prepareTelebirrPilot } from './private-live-telebirr-proof-lineage.suite.js';

const verifierGroup = 'fetanagent_telebirr_shadow_verifier';
const verifierRuntime = 'fetanagent_telebirr_shadow_verifier_runtime';
const authorityFunction =
  'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)';
const completionFunction =
  'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)';
const stagedEvidenceFunction = 'app.load_next_private_telebirr_shadow_staged_evidence()';
const quarantineFunction =
  'app.quarantine_private_telebirr_shadow_staged_evidence(uuid,uuid,text,text)';
const captureFunction =
  'app.capture_telegram_telebirr_shadow_proof(uuid,text,text,text,text,text,smallint,smallint,text)';
const statusFunction = 'app.get_owner_telebirr_shadow_verification_status(uuid)';

const shadowTables = [
  'private_telebirr_shadow_assignment_transcripts',
  'private_telebirr_shadow_device_evidence_staging',
  'private_telebirr_shadow_evidence_quarantine',
  'private_telebirr_shadow_proof_requests',
  'private_telebirr_shadow_verification_attempts',
  'private_telebirr_shadow_verification_outcomes',
  'telegram_telebirr_shadow_proof_receipts',
] as const;

type ShadowLeaseRow = {
  readonly verification_attempt_id: string;
  readonly lease_token: string;
  readonly job_id: string;
  readonly attempt_number: number;
  readonly request_id: string;
  readonly assignment_id: string;
  readonly lease_nonce_digest: string;
  readonly challenge_id: string;
  readonly challenge_digest: string;
  readonly issued_at: Date;
  readonly expires_at: Date;
  readonly pilot_revision_id: string;
  readonly device_enrollment_id: string;
  readonly device_id: string;
  readonly device_key_id: string;
  readonly receiver_revision_id: string;
  readonly receiver_profile_id: string;
  readonly receiver_profile_digest: string;
  readonly receiver_configuration_digest: string;
  readonly candidate_reference_fingerprint: string;
  readonly replayed: boolean;
};

type ShadowCompletionRow = {
  readonly already_completed: boolean;
  readonly deposit_intent_id: string | null;
  readonly deposit_payment_claim_id: string | null;
  readonly execution_job_id: string | null;
  readonly outcome_disposition: string;
  readonly outcome_reason_code: string;
  readonly settlement_created: boolean;
  readonly verification_outcome_id: string;
};

type ShadowCaptureRow = {
  readonly proof_status: string;
  readonly provider_code: string;
  readonly request_replayed: boolean;
  readonly shadow_proof_request_id: string;
  readonly shadow_verification_job_id: string;
  readonly submitted_at: Date;
};

type ShadowPersistedRow = {
  readonly assignment_signature: string;
  readonly assignment_signature_digest: string;
  readonly replayed: boolean;
  readonly signed_at: Date;
};

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function signature(byte: number): { readonly digest: string; readonly encoded: string } {
  const bytes = Buffer.alloc(64, byte);
  try {
    return {
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      encoded: bytes.toString('base64url'),
    };
  } finally {
    bytes.fill(0);
  }
}

async function createTelegramShadowInbound(
  client: Client,
  customerId: string,
  ownerAdminId: string,
): Promise<string> {
  const seed = randomUUID().replaceAll('-', '');
  const telegramUserId = BigInt(`9${seed.slice(0, 14).replace(/[a-f]/gu, '7')}`).toString();
  const identity = await client.query<{ readonly id: string }>(
    `insert into app.customer_identities (
       customer_id, identity_kind, external_subject, status
     ) values ($1::uuid, 'telegram', $2::text, 'active')
     returning id`,
    [customerId, telegramUserId],
  );
  const identityId = identity.rows[0]!.id;
  await client.query(
    `insert into app.telegram_identities (
       customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
     ) values ($1::uuid, $2::bigint, $2::bigint, 'en')`,
    [identityId, telegramUserId],
  );
  await client.query(`insert into app.bot_conversations (telegram_identity_id) values ($1::uuid)`, [
    identityId,
  ]);

  const admission = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [`update:${telegramUserId}`, identityId, `hmac-sha256-v1:${'a'.repeat(64)}`],
  );
  const tokenDigest = `sha256-v1:${createHash('sha256')
    .update(`shadow-invite:${seed}`, 'utf8')
    .digest('hex')}`;
  await client.query(
    `insert into app.telegram_beta_invites (
       token_digest, expires_at, issued_by_admin_id, created_at
     ) values (
       $1::text, clock_timestamp() + interval '1 hour',
       $2::uuid, clock_timestamp() - interval '10 minutes'
     )`,
    [tokenDigest, ownerAdminId],
  );
  const redeemed = await client.query<{ readonly token_digest: string }>(
    `update app.telegram_beta_invites
        set status = 'redeemed',
            redeemed_telegram_user_id = $2::bigint,
            redeemed_private_chat_id = $2::bigint,
            redeemed_customer_id = $3::uuid,
            redeemed_customer_identity_id = $4::uuid,
            redeemed_inbound_event_id = $5::uuid,
            redeemed_at = clock_timestamp() - interval '5 minutes'
      where token_digest = $1::text and status = 'active'
      returning token_digest`,
    [tokenDigest, telegramUserId, customerId, identityId, admission.rows[0]!.id],
  );
  expect(redeemed.rows).toHaveLength(1);

  const inbound = await client.query<{ readonly id: string }>(
    `insert into app.inbound_events (
       channel, external_event_id, customer_identity_id, payload_digest
     ) values ('telegram', $1::text, $2::uuid, $3::text)
     returning id`,
    [`shadow-proof:${seed}`, identityId, `hmac-sha256-v1:${'b'.repeat(64)}`],
  );
  return inbound.rows[0]!.id;
}

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

async function expectFailure(
  client: Client,
  query: string,
  values: readonly unknown[],
  expected: RegExp,
): Promise<void> {
  const savepoint = `shadow_expected_failure_${randomUUID().replaceAll('-', '')}`;
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
  expect(failure instanceof Error ? failure.message : String(failure)).toMatch(expected);
}

export function registerTelebirrShadowVerificationSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('no-money TeleBirr shadow-verification boundary', () => {
    it('creates a dormant non-settable runtime identity with no financial-role membership', async () => {
      const client = getClient();
      const roles = await client.query<{
        readonly rolbypassrls: boolean;
        readonly rolcanlogin: boolean;
        readonly rolconnlimit: number;
        readonly rolcreatedb: boolean;
        readonly rolcreaterole: boolean;
        readonly rolinherit: boolean;
        readonly rolname: string;
        readonly rolreplication: boolean;
        readonly rolsuper: boolean;
      }>(`
        select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
               rolreplication, rolbypassrls, rolconnlimit
          from pg_roles
         where rolname in ('${verifierGroup}', '${verifierRuntime}')
         order by rolname
      `);
      expect(roles.rows).toEqual([
        {
          rolname: verifierGroup,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 2,
        },
        {
          rolname: verifierRuntime,
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolconnlimit: 1,
        },
      ]);

      const membership = await client.query<{
        readonly admin_option: boolean;
        readonly group_role: string;
        readonly inherit_option: boolean;
        readonly member_role: string;
        readonly set_option: boolean;
      }>(`
        select granted.rolname as group_role, member.rolname as member_role,
               membership.inherit_option, membership.set_option, membership.admin_option
          from pg_auth_members membership
          join pg_roles granted on granted.oid = membership.roleid
          join pg_roles member on member.oid = membership.member
         where granted.rolname in ('${verifierGroup}', '${verifierRuntime}')
            or member.rolname in ('${verifierGroup}', '${verifierRuntime}')
         order by group_role, member_role
      `);
      expect(membership.rows).toEqual([
        {
          group_role: verifierGroup,
          member_role: verifierRuntime,
          inherit_option: true,
          set_option: false,
          admin_option: false,
        },
      ]);

      const financialMembership = await client.query<{ readonly memberships: number }>(`
        select count(*)::integer as memberships
          from pg_auth_members membership
          join pg_roles granted on granted.oid = membership.roleid
          join pg_roles member on member.oid = membership.member
         where member.rolname in ('${verifierGroup}', '${verifierRuntime}')
           and granted.rolname in (
             'fetanagent_deposit_executor', 'fetanagent_verification_settlement',
             'fetanagent_trusted_telebirr_verifier', 'fetanagent_telebirr_assignment_broker',
             'fetanagent_telebirr_device_state'
           )
      `);
      expect(financialMembership.rows).toEqual([{ memberships: 0 }]);
    });

    it('grants exactly four hardened shadow routines and no table access', async () => {
      const client = getClient();
      const functions = await client.query<{
        readonly hardened: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and has_function_privilege('${verifierGroup}', routine.oid, 'EXECUTE')
         order by signature
      `);
      expect(functions.rows).toEqual(
        [authorityFunction, completionFunction, stagedEvidenceFunction, quarantineFunction]
          .sort()
          .map((signature) => ({ signature, hardened: true })),
      );

      const baseObjectAccess = await client.query<{ readonly access_count: number }>(`
        select count(*)::integer as access_count
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
           and (
             has_table_privilege(
               '${verifierRuntime}', relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
             )
             or has_any_column_privilege(
               '${verifierRuntime}', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
             )
             or (relation.relkind = 'S' and has_sequence_privilege(
               '${verifierRuntime}', relation.oid, 'USAGE,SELECT,UPDATE'
             ))
           )
      `);
      expect(baseObjectAccess.rows).toEqual([{ access_count: 0 }]);

      const forbidden = await client.query<{ readonly allowed: boolean }>(`
        select has_function_privilege(
                 '${verifierRuntime}',
                 'app.complete_private_live_telebirr_verification(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text,timestamptz,text,text,text,timestamptz,bigint,timestamptz,text)',
                 'EXECUTE'
               )
               or has_function_privilege(
                 '${verifierRuntime}',
                 'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)',
                 'EXECUTE'
               ) as allowed
      `);
      expect(forbidden.rows).toEqual([{ allowed: false }]);
    });

    it('keeps all shadow rows append-only, forced-RLS, and structurally separate', async () => {
      const client = getClient();
      const relations = await client.query<{
        readonly delete_trigger: boolean;
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
        readonly truncate_trigger: boolean;
        readonly update_trigger: boolean;
      }>(
        `
        select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity,
               exists (
                 select 1 from pg_trigger trigger
                  where trigger.tgrelid = relation.oid and not trigger.tgisinternal
                    and (trigger.tgtype & 8) = 8
               ) as delete_trigger,
               exists (
                 select 1 from pg_trigger trigger
                  where trigger.tgrelid = relation.oid and not trigger.tgisinternal
                    and (trigger.tgtype & 16) = 16
               ) as update_trigger,
               exists (
                 select 1 from pg_trigger trigger
                  where trigger.tgrelid = relation.oid and not trigger.tgisinternal
                    and (trigger.tgtype & 32) = 32
               ) as truncate_trigger
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relname = any($1::text[])
         order by relation.relname
      `,
        [shadowTables],
      );
      expect(relations.rows).toEqual(
        shadowTables.map((relname) => ({
          relname,
          relrowsecurity: true,
          relforcerowsecurity: true,
          delete_trigger: true,
          update_trigger: true,
          truncate_trigger: true,
        })),
      );

      const forbiddenColumns = await client.query<{ readonly column_count: number }>(
        `
        select count(*)::integer as column_count
          from information_schema.columns
         where table_schema = 'app'
           and table_name = any($1::text[])
           and column_name in (
             'deposit_intent_id', 'deposit_payment_claim_id', 'reservation_id',
             'settlement_id', 'execution_job_id', 'platform_agent_account_id',
             'kemerbet_action_id'
           )
      `,
        [shadowTables],
      );
      expect(forbiddenColumns.rows).toEqual([{ column_count: 0 }]);
    });

    it('pins the capture, aggregate-status, and completion contracts without money authority', async () => {
      const client = getClient();
      const catalog = await client.query<{
        readonly capture_hardened: boolean;
        readonly capture_player_only: boolean;
        readonly capture_result: string;
        readonly completion_result: string;
        readonly status_hardened: boolean;
        readonly status_owner_only: boolean;
        readonly status_result: string;
      }>(
        `
        select
          capture.prosecdef
            and capture.proconfig = array['search_path=pg_catalog']::text[]
            as capture_hardened,
          has_function_privilege('fetanagent_player_actions', capture.oid, 'EXECUTE')
            and not has_function_privilege('public', capture.oid, 'EXECUTE')
            and not has_function_privilege('${verifierGroup}', capture.oid, 'EXECUTE')
            as capture_player_only,
          lower(pg_get_function_result(capture.oid)) as capture_result,
          status.prosecdef
            and status.proconfig = array['search_path=pg_catalog']::text[]
            as status_hardened,
          has_function_privilege('fetanagent_owner_control', status.oid, 'EXECUTE')
            and not has_function_privilege('public', status.oid, 'EXECUTE')
            and not has_function_privilege('${verifierGroup}', status.oid, 'EXECUTE')
            as status_owner_only,
          lower(pg_get_function_result(status.oid)) as status_result,
          lower(pg_get_function_result(completion.oid)) as completion_result
        from pg_proc capture, pg_proc status, pg_proc completion
       where capture.oid = $1::regprocedure
         and status.oid = $2::regprocedure
         and completion.oid = $3::regprocedure
      `,
        [captureFunction, statusFunction, completionFunction],
      );
      expect(catalog.rows).toEqual([
        {
          capture_hardened: true,
          capture_player_only: true,
          capture_result:
            'table(shadow_proof_request_id uuid, shadow_verification_job_id uuid, provider_code text, proof_status text, submitted_at timestamp with time zone, request_replayed boolean)',
          status_hardened: true,
          status_owner_only: true,
          status_result:
            'table(contract_version smallint, verification_mode text, pilot_state text, switch_mode text, shadow_mode_ready boolean, proof_count bigint, claimable_proof_count bigint, active_assignment_count bigint, staged_evidence_count bigint, completed_count bigint, would_verify_count bigint, would_review_count bigint, would_reject_count bigint, quarantined_count bigint, checked_at timestamp with time zone)',
          completion_result:
            'table(verification_outcome_id uuid, outcome_disposition text, outcome_reason_code text, deposit_intent_id uuid, deposit_payment_claim_id uuid, execution_job_id uuid, settlement_created boolean, already_completed boolean)',
        },
      ]);

      const definitions = await client.query<{
        readonly completion: string;
        readonly capture: string;
      }>(
        `
        select lower(pg_get_functiondef($1::regprocedure)) as completion,
               lower(pg_get_functiondef($2::regprocedure)) as capture
      `,
        [completionFunction, captureFunction],
      );
      const completion = definitions.rows[0]?.completion ?? '';
      const capture = definitions.rows[0]?.capture ?? '';
      for (const forbiddenWrite of [
        'insert into app.deposit_intents',
        'insert into app.deposit_payment_claims',
        'insert into app.deposit_execution',
        'insert into app.provider_payment_evidence',
        'insert into app.private_live_telebirr_verification_outcomes',
        'update app.deposit_',
        'delete from app.deposit_',
        'kemerbet',
      ]) {
        expect(completion).not.toContain(forbiddenWrite);
        expect(capture).not.toContain(forbiddenWrite);
      }
      expect(completion).toContain('null::uuid');
      expect(completion).toContain('false');
      expect(completion).toContain('app.private_telebirr_shadow_evidence_quarantine');
      expect(capture).toContain('insert into app.private_telebirr_shadow_proof_requests');
      expect(capture).toContain("'shadow_no_money'");

      const proofStatus = await client.query<{
        readonly accepted_constraint: boolean;
        readonly column_default: string;
      }>(`
        select column_default,
               exists (
                 select 1 from pg_constraint catalog_constraint
                  where catalog_constraint.conrelid = 'app.private_telebirr_shadow_proof_requests'::regclass
                    and catalog_constraint.contype = 'c'
                    and pg_get_constraintdef(catalog_constraint.oid) like '%proof_status%verification_queued%'
               ) as accepted_constraint
          from information_schema.columns
         where table_schema = 'app'
           and table_name = 'private_telebirr_shadow_proof_requests'
           and column_name = 'proof_status'
      `);
      expect(proofStatus.rows).toEqual([
        { column_default: "'verification_queued'::text", accepted_constraint: true },
      ]);
    });

    it('locks and rechecks the same seven exact gates at every shadow write', async () => {
      const client = getClient();
      const mutatingFunctions = [
        captureFunction,
        'app.lease_private_telebirr_shadow_assignment(uuid,text,uuid,integer)',
        'app.persist_private_telebirr_shadow_assignment_signature(uuid,uuid,uuid,text,text,text,text)',
        'app.stage_private_telebirr_shadow_device_evidence(uuid,text,text,text,jsonb,jsonb)',
        completionFunction,
        quarantineFunction,
      ];
      const readFunctions = [stagedEvidenceFunction, authorityFunction];
      const transitionFunctions = [...mutatingFunctions, ...readFunctions];
      const postLockTimeBoundaries = new Map([
        [
          captureFunction,
          { timestamp: 'captured_at', finalCheck: 'captured_at >= profile.valid_until' },
        ],
        [
          'app.lease_private_telebirr_shadow_assignment(uuid,text,uuid,integer)',
          { timestamp: 'now_at', finalCheck: 'or now_at >= proof.expires_at' },
        ],
        [
          'app.persist_private_telebirr_shadow_assignment_signature(uuid,uuid,uuid,text,text,text,text)',
          {
            timestamp: 'now_at',
            finalCheck: 'where revocation.assignment_signer_id = signer.id',
          },
        ],
        [
          'app.stage_private_telebirr_shadow_device_evidence(uuid,text,text,text,jsonb,jsonb)',
          { timestamp: 'now_at', finalCheck: 'or now_at >= attempt.expires_at' },
        ],
        [completionFunction, { timestamp: 'now_at', finalCheck: 'or now_at >= proof.expires_at' }],
      ]);
      const definitions = await client.query<{
        readonly definition: string;
        readonly signature: string;
      }>(
        `
        select requested.signature,
               lower(pg_get_functiondef(requested.signature::regprocedure)) as definition
          from unnest($1::text[]) requested(signature)
         order by requested.signature
      `,
        [transitionFunctions],
      );
      expect(definitions.rows).toHaveLength(transitionFunctions.length);
      for (const row of definitions.rows) {
        if (mutatingFunctions.includes(row.signature)) {
          expect(row.definition, row.signature).toContain(
            'app.require_private_telebirr_shadow_mode_ready',
          );
          const assertionIndex = row.definition.indexOf(
            'app.require_private_telebirr_shadow_mode_ready',
          );
          const firstWriteIndex = row.definition.search(
            /\b(?:insert into|update|delete from) app\.(?:private_telebirr_shadow|telegram_telebirr_shadow)/u,
          );
          expect(firstWriteIndex, row.signature).toBeGreaterThan(assertionIndex);

          const timeBoundary = postLockTimeBoundaries.get(row.signature);
          if (timeBoundary) {
            expect(row.definition, row.signature).toMatch(
              new RegExp(
                `\\b${timeBoundary.timestamp}\\s+(?:timestamptz|timestamp with time zone)\\s*;`,
                'u',
              ),
            );
            expect(row.definition, row.signature).not.toMatch(
              new RegExp(
                `\\b${timeBoundary.timestamp}\\s+(?:timestamptz|timestamp with time zone)\\s*:=`,
                'u',
              ),
            );

            const refreshPattern = new RegExp(
              `\\b${timeBoundary.timestamp}\\s*:=\\s*pg_catalog\\.date_trunc\\(`,
              'gu',
            );
            expect(row.definition.match(refreshPattern) ?? [], row.signature).toHaveLength(2);

            const finalRefreshIndex = row.definition.lastIndexOf(
              `${timeBoundary.timestamp} := pg_catalog.date_trunc(`,
            );
            const finalBlockingBoundaryIndex = Math.max(
              row.definition.lastIndexOf('pg_advisory_xact_lock'),
              row.definition.lastIndexOf('for share'),
              row.definition.lastIndexOf('for update'),
              row.definition.lastIndexOf('app.require_private_telebirr_shadow_mode_ready'),
            );
            const finalCheckIndex = row.definition.lastIndexOf(timeBoundary.finalCheck);
            expect(finalRefreshIndex, row.signature).toBeGreaterThan(finalBlockingBoundaryIndex);
            expect(finalCheckIndex, row.signature).toBeGreaterThan(finalRefreshIndex);
            expect(firstWriteIndex, row.signature).toBeGreaterThan(finalCheckIndex);
          }

          if (row.signature === quarantineFunction) {
            const attemptLockIndex = row.definition.indexOf('for update of attempt');
            const outcomeReferenceIndex = row.definition.indexOf(
              'app.private_telebirr_shadow_verification_outcomes',
              attemptLockIndex,
            );
            const outcomeCheckIndex = row.definition.lastIndexOf(
              'if exists (',
              outcomeReferenceIndex,
            );
            expect(
              row.definition.slice(0, attemptLockIndex),
              'quarantine must not snapshot outcomes before waiting for the attempt lock',
            ).not.toContain('private_telebirr_shadow_verification_outcomes');
            expect(attemptLockIndex).toBeGreaterThanOrEqual(0);
            expect(outcomeCheckIndex).toBeGreaterThan(attemptLockIndex);
            expect(assertionIndex).toBeGreaterThan(outcomeCheckIndex);
            expect(firstWriteIndex).toBeGreaterThan(assertionIndex);
          }
        } else {
          expect(row.definition, row.signature).toContain(
            'app.private_telebirr_shadow_mode_is_ready',
          );
        }
      }

      const gate = await client.query<{ readonly definition: string }>(`
        select lower(pg_get_functiondef(
          'app.private_telebirr_shadow_mode_is_ready(uuid)'::regprocedure
        )) as definition
      `);
      const definition = gate.rows[0]?.definition ?? '';
      for (const feature of [
        'payment_verification',
        'deposit_execution',
        'withdrawal_validation',
        'withdrawal_collection',
        'cbe_birr_authoritative_verification',
        'telebirr_authoritative_verification',
      ]) {
        expect(definition).toContain(`'${feature}'`);
      }
      expect(definition).toContain('count(*) = 6');
      expect(definition).toContain("feature_switch.mode = 'disabled'");
      expect(definition).toContain("feature_switch.settings = '{}'::jsonb");
      expect(definition).toContain("pilot_switch.mode = 'dry_run'");
      expect(definition).toContain("pilot.status = 'armed'");
      expect(definition).toContain("'configuration_digest'");
      expect(definition).toContain('clock_timestamp() < pilot.expires_at');

      const lockGate = await client.query<{ readonly definition: string }>(`
        select lower(pg_get_functiondef(
          'app.require_private_telebirr_shadow_mode_ready(uuid)'::regprocedure
        )) as definition
      `);
      const lockDefinition = lockGate.rows[0]?.definition ?? '';
      for (const feature of [
        'payment_verification',
        'deposit_execution',
        'withdrawal_validation',
        'withdrawal_collection',
        'cbe_birr_authoritative_verification',
        'telebirr_authoritative_verification',
        'private_live_deposit_pilot',
      ]) {
        expect(lockDefinition).toContain(`'${feature}'`);
      }
      expect(lockDefinition).toMatch(/order by feature_switch\.feature_key\s+for share/u);
      expect(lockDefinition).toContain('get diagnostics locked_switch_count = row_count');
      expect(lockDefinition).toMatch(
        /from app\.private_live_deposit_pilot_revisions pilot[\s\S]*for share/u,
      );
      expect(lockDefinition).toContain('locked_switch_count <> 7');
      expect(lockDefinition).toContain('app.private_telebirr_shadow_mode_is_ready');
      const helperAccess = await client.query<{ readonly executable: boolean }>(`
        select has_function_privilege(
          'public', 'app.require_private_telebirr_shadow_mode_ready(uuid)', 'EXECUTE'
        ) as executable
      `);
      expect(helperAccess.rows).toEqual([{ executable: false }]);
    });

    it('preserves public broker/device signatures and hides the renamed live implementations', async () => {
      const client = getClient();
      const publicContracts = await client.query<{
        readonly argument_types: string;
        readonly hardened: boolean;
        readonly result_type: string;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               pg_get_function_identity_arguments(routine.oid) as argument_types,
               lower(pg_get_function_result(routine.oid)) as result_type,
               routine.prosecdef
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened
          from pg_proc routine
         where routine.oid in (
           'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)'::regprocedure,
           'app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)'::regprocedure,
           'app.stage_private_telebirr_device_evidence(uuid,text,text,text,jsonb,jsonb)'::regprocedure
         )
         order by signature
      `);
      expect(publicContracts.rows).toHaveLength(3);
      expect(publicContracts.rows.every((row) => row.hardened)).toBe(true);
      expect(publicContracts.rows.map((row) => row.signature).sort()).toEqual(
        [
          'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)',
          'app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)',
          'app.stage_private_telebirr_device_evidence(uuid,text,text,text,jsonb,jsonb)',
        ].sort(),
      );
      expect(publicContracts.rows.map((row) => row.argument_types)).toEqual(
        expect.arrayContaining([
          'p_device_enrollment_id uuid, p_leased_by text, p_lease_request_key uuid, p_lease_seconds integer',
          'p_verification_attempt_id uuid, p_lease_token uuid, p_assignment_signer_id uuid, p_assignment_body_digest text, p_proposed_assignment_signature text, p_proposed_assignment_signature_digest text, p_reference_binding_digest text',
          'p_device_enrollment_id uuid, p_request_body_digest text, p_assignment_body_digest text, p_observation_body_digest text, p_signed_assignment jsonb, p_signed_observation jsonb',
        ]),
      );
      expect(
        Object.fromEntries(publicContracts.rows.map((row) => [row.signature, row.result_type])),
      ).toEqual({
        'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)':
          'table(verification_attempt_id uuid, lease_token uuid, job_id uuid, attempt_number integer, request_id uuid, assignment_id uuid, lease_nonce_digest text, challenge_id uuid, challenge_digest text, issued_at timestamp with time zone, expires_at timestamp with time zone, pilot_revision_id uuid, device_enrollment_id uuid, device_id text, device_key_id text, device_public_key_spki_sha256 text, receiver_revision_id uuid, receiver_profile_id uuid, receiver_profile_digest text, receiver_configuration_digest text, expected_receiver_name_digest text, receiver_name_normalizer_version text, source_profile text, adapter_version text, parser_version text, facts_normalizer_version text, candidate_reference_ciphertext text, candidate_reference_fingerprint text, reference_encryption_key_version smallint, reference_profile_version smallint, replayed boolean)',
        'app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)':
          'table(assignment_signature text, assignment_signature_digest text, signed_at timestamp with time zone, replayed boolean)',
        'app.stage_private_telebirr_device_evidence(uuid,text,text,text,jsonb,jsonb)':
          'table(outcome text, reason_code text, replayed boolean)',
      });

      const internalAccess = await client.query<{ readonly executable: boolean }>(`
        select exists (
          select 1
            from unnest(array[
              'app.lease_private_live_telebirr_assignment_broker_before_shadow(uuid,text,uuid,integer)',
              'app.persist_live_tbirr_assignment_sig_internal(uuid,uuid,uuid,text,text,text,text)',
              'app.stage_live_tbirr_device_evidence_internal(uuid,text,text,text,jsonb,jsonb)'
            ]::text[]) requested(signature)
           where has_function_privilege(
             'fetanagent_telebirr_assignment_broker', requested.signature, 'EXECUTE'
           ) or has_function_privilege(
             'fetanagent_telebirr_device_state', requested.signature, 'EXECUTE'
           ) or has_function_privilege('public', requested.signature, 'EXECUTE')
        ) as executable
      `);
      expect(internalAccess.rows).toEqual([{ executable: false }]);

      const brokerWrapper = await client.query<{ readonly definition: string }>(`
        select lower(pg_get_functiondef(
          'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)'::regprocedure
        )) as definition
      `);
      expect(brokerWrapper.rows[0]?.definition ?? '').toMatch(
        /if not app\.private_telebirr_shadow_mode_is_ready\(enrollment\.pilot_revision_id\) then\s+return;\s+end if;/u,
      );
    });

    it('keeps disabled broker polling idle without creating a live or shadow attempt', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const switchedOff = await client.query<{ readonly feature_key: string }>(`
          update app.feature_switches
             set mode = 'disabled'::app.feature_mode,
                 settings = '{}'::jsonb
           where feature_key in (
             'private_live_deposit_pilot', 'payment_verification',
             'deposit_execution', 'withdrawal_validation', 'withdrawal_collection',
             'cbe_birr_authoritative_verification', 'telebirr_authoritative_verification'
           )
           returning feature_key
        `);
        expect(switchedOff.rows).toHaveLength(7);

        const before = await client.query<{
          readonly live_attempts: string;
          readonly shadow_attempts: string;
        }>(`
          select (select count(*)::text
                    from app.private_live_telebirr_verification_attempts) as live_attempts,
                 (select count(*)::text
                    from app.private_telebirr_shadow_verification_attempts) as shadow_attempts
        `);
        const lease = await client.query<ShadowLeaseRow>(
          `select * from app.lease_private_live_telebirr_assignment_broker(
             $1::uuid, 'sql-shadow-idle-poll-01', $2::uuid, 120
           )`,
          [pilot.deviceEnrollmentId, randomUUID()],
        );
        expect(lease.rows).toEqual([]);

        const after = await client.query<{
          readonly live_attempts: string;
          readonly shadow_attempts: string;
        }>(`
          select (select count(*)::text
                    from app.private_live_telebirr_verification_attempts) as live_attempts,
                 (select count(*)::text
                    from app.private_telebirr_shadow_verification_attempts) as shadow_attempts
        `);
        expect(after.rows).toEqual(before.rows);
      });
    });

    it('captures and replays one Telegram proof only into the isolated shadow lineage', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const ownerAdminId = getOwnerAdminId();
        const pilot = await prepareTelebirrPilot(client, ownerAdminId);
        const gates = await client.query<{ readonly feature_key: string }>(
          `update app.feature_switches
              set mode = case
                    when feature_key = 'private_live_deposit_pilot'
                      then 'dry_run'::app.feature_mode
                    else 'disabled'::app.feature_mode
                  end,
                  settings = case
                    when feature_key = 'private_live_deposit_pilot'
                      then jsonb_build_object(
                        'contract_version', 1,
                        'pilot_revision_id', $1::uuid,
                        'configuration_digest', $2::text
                      )
                    else '{}'::jsonb
                  end
            where feature_key in (
              'private_live_deposit_pilot', 'payment_verification',
              'deposit_execution', 'withdrawal_validation', 'withdrawal_collection',
              'cbe_birr_authoritative_verification', 'telebirr_authoritative_verification'
            )
            returning feature_key`,
          [pilot.pilotRevisionId, pilot.configurationDigest],
        );
        expect(gates.rows).toHaveLength(7);

        const inboundEventId = await createTelegramShadowInbound(
          client,
          pilot.submittingCustomerId,
          ownerAdminId,
        );
        const fingerprint = createHash('sha256')
          .update(`captured-shadow-proof:${randomUUID()}`, 'utf8')
          .digest('hex');
        const parameters = [
          inboundEventId,
          pilot.playerIds[0]!,
          'telebirr',
          `v2.telebirr.${'C'.repeat(16)}.${'D'.repeat(22)}.${fingerprint.slice(0, 11)}`,
          fingerprint,
          `***${fingerprint.slice(0, 4).toUpperCase()}`,
          2,
          2,
          `hmac-sha256-v1:${'c'.repeat(64)}`,
        ] as const;
        await client.query('set local role fetanagent_player_actions');
        const captured = await client.query<ShadowCaptureRow>(
          `select * from app.capture_telegram_telebirr_shadow_proof(
             $1::uuid, $2::text, $3::text, $4::text, $5::text,
             $6::text, $7::smallint, $8::smallint, $9::text
           )`,
          [...parameters],
        );
        const replayed = await client.query<ShadowCaptureRow>(
          `select * from app.capture_telegram_telebirr_shadow_proof(
             $1::uuid, $2::text, $3::text, $4::text, $5::text,
             $6::text, $7::smallint, $8::smallint, $9::text
           )`,
          [...parameters],
        );
        await client.query('reset role');

        expect(captured.rows).toHaveLength(1);
        expect(captured.rows[0]).toMatchObject({
          provider_code: 'telebirr',
          proof_status: 'verification_queued',
          request_replayed: false,
        });
        expect(replayed.rows).toEqual([{ ...captured.rows[0]!, request_replayed: true }]);
        const lineage = await client.query<{
          readonly dry_receipts: string;
          readonly event_processed: boolean;
          readonly live_receipts: string;
          readonly shadow_proofs: string;
          readonly shadow_receipts: string;
        }>(
          `select inbound_event.processed_at is not null as event_processed,
                  (select count(*)::text
                     from app.telegram_telebirr_shadow_proof_receipts receipt
                    where receipt.origin_inbound_event_id = inbound_event.id) as shadow_receipts,
                  (select count(*)::text
                     from app.private_telebirr_shadow_proof_requests proof
                    where proof.id = $2::uuid) as shadow_proofs,
                  (select count(*)::text
                     from app.telegram_live_deposit_request_receipts receipt
                    where receipt.origin_inbound_event_id = inbound_event.id) as live_receipts,
                  (select count(*)::text
                     from app.telegram_dry_run_deposit_proof_receipts receipt
                    where receipt.origin_inbound_event_id = inbound_event.id) as dry_receipts
             from app.inbound_events inbound_event
            where inbound_event.id = $1::uuid`,
          [inboundEventId, captured.rows[0]!.shadow_proof_request_id],
        );
        expect(lineage.rows).toEqual([
          {
            event_processed: true,
            shadow_receipts: '1',
            shadow_proofs: '1',
            live_receipts: '0',
            dry_receipts: '0',
          },
        ]);
      });
    });

    it('leases, preserves the first signature, stages, and completes idempotently with no ledger delta', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const gates = await client.query<{ readonly feature_key: string }>(
          `update app.feature_switches
              set mode = case
                    when feature_key = 'private_live_deposit_pilot'
                      then 'dry_run'::app.feature_mode
                    else 'disabled'::app.feature_mode
                  end,
                  settings = case
                    when feature_key = 'private_live_deposit_pilot'
                      then jsonb_build_object(
                        'contract_version', 1,
                        'pilot_revision_id', $1::uuid,
                        'configuration_digest', $2::text
                      )
                    else '{}'::jsonb
                  end
            where feature_key in (
              'private_live_deposit_pilot', 'payment_verification',
              'deposit_execution', 'withdrawal_validation', 'withdrawal_collection',
              'cbe_birr_authoritative_verification', 'telebirr_authoritative_verification'
            )
            returning feature_key`,
          [pilot.pilotRevisionId, pilot.configurationDigest],
        );
        expect(gates.rows).toHaveLength(7);

        const before = await client.query<{ readonly snapshot: Readonly<Record<string, number>> }>(`
          select jsonb_build_object(
            'intents', (select count(*) from app.deposit_intents),
            'claims', (select count(*) from app.deposit_payment_claims),
            'jobs', (select count(*) from app.deposit_jobs),
            'attempts', (select count(*) from app.deposit_execution_attempts),
            'evidence', (select count(*) from app.provider_payment_evidence),
            'reconciliations', (select count(*) from app.execution_reconciliations),
            'live_proofs', (select count(*) from app.private_live_deposit_pilot_proofs),
            'live_attempts', (select count(*) from app.private_live_telebirr_verification_attempts),
            'live_outcomes', (select count(*) from app.private_live_telebirr_verification_outcomes)
          ) as snapshot
        `);

        const fingerprint = createHash('sha256')
          .update(`shadow-proof:${randomUUID()}`, 'utf8')
          .digest('hex');
        const submittedAt = new Date();
        const proof = await client.query<{ readonly id: string }>(
          `insert into app.private_telebirr_shadow_proof_requests (
             pilot_revision_id, submitting_customer_id, player_account_id,
             payment_provider_id, receiver_profile_id, pilot_configuration_digest,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version, submitted_at, not_before, expires_at
           ) values (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text,
             $7::text, $8::text, $9::text, 2, 2,
             $11::timestamptz,
             $11::timestamptz,
             least(
               $11::timestamptz + interval '5 minutes',
               $10::timestamptz
             )
           ) returning id`,
          [
            pilot.pilotRevisionId,
            pilot.submittingCustomerId,
            pilot.playerAccountIds[0]!,
            pilot.paymentProviderId,
            pilot.receiverProfileId,
            pilot.configurationDigest,
            `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${fingerprint.slice(0, 11)}`,
            fingerprint,
            `***${fingerprint.slice(0, 4).toUpperCase()}`,
            pilot.expiresAt,
            submittedAt,
          ],
        );
        expect(proof.rows).toHaveLength(1);

        const leaseRequestKey = randomUUID();
        const lease = await client.query<ShadowLeaseRow>(
          `select * from app.lease_private_live_telebirr_assignment_broker(
             $1::uuid, 'sql-shadow-verifier-01', $2::uuid, 120
           )`,
          [pilot.deviceEnrollmentId, leaseRequestKey],
        );
        expect(lease.rows).toHaveLength(1);
        expect(lease.rows[0]!.replayed).toBe(false);
        const replayedLease = await client.query<ShadowLeaseRow>(
          `select * from app.lease_private_live_telebirr_assignment_broker(
             $1::uuid, 'sql-shadow-verifier-01', $2::uuid, 120
           )`,
          [pilot.deviceEnrollmentId, leaseRequestKey],
        );
        expect(replayedLease.rows).toEqual([{ ...lease.rows[0]!, replayed: true }]);

        const assigned = lease.rows[0]!;
        const assignmentBodyDigest = digest(`shadow-assignment:${assigned.assignment_id}`);
        const referenceBindingDigest = digest(`shadow-reference:${assigned.assignment_id}`);
        const firstSignature = signature(0x31);
        const secondSignature = signature(0x32);
        const firstPersist = await client.query<ShadowPersistedRow>(
          `select * from app.persist_private_live_telebirr_assignment_broker_signature(
             $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
           )`,
          [
            assigned.verification_attempt_id,
            assigned.lease_token,
            pilot.assignmentSignerId,
            assignmentBodyDigest,
            firstSignature.encoded,
            firstSignature.digest,
            referenceBindingDigest,
          ],
        );
        expect(firstPersist.rows).toHaveLength(1);
        expect(firstPersist.rows[0]!.replayed).toBe(false);
        const signatureReplay = await client.query<ShadowPersistedRow>(
          `select * from app.persist_private_live_telebirr_assignment_broker_signature(
             $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
           )`,
          [
            assigned.verification_attempt_id,
            assigned.lease_token,
            pilot.assignmentSignerId,
            assignmentBodyDigest,
            secondSignature.encoded,
            secondSignature.digest,
            referenceBindingDigest,
          ],
        );
        expect(signatureReplay.rows).toEqual([{ ...firstPersist.rows[0]!, replayed: true }]);
        expect(signatureReplay.rows[0]!.assignment_signature).toBe(firstSignature.encoded);
        expect(signatureReplay.rows[0]!.assignment_signature_digest).toBe(firstSignature.digest);
        await expectFailure(
          client,
          `select * from app.persist_private_live_telebirr_assignment_broker_signature(
             $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
           )`,
          [
            assigned.verification_attempt_id,
            assigned.lease_token,
            pilot.assignmentSignerId,
            digest('conflicting-body'),
            secondSignature.encoded,
            secondSignature.digest,
            referenceBindingDigest,
          ],
          /replay conflicts/iu,
        );

        const observedAt = new Date(Math.max(assigned.issued_at.getTime() + 1, Date.now() - 1_000));
        const sourceDocumentDigest = digest(`shadow-source:${assigned.assignment_id}`);
        const normalizedFactsDigest = digest(`shadow-facts:${assigned.assignment_id}`);
        const observationBodyDigest = digest(`shadow-observation:${assigned.assignment_id}`);
        const observationSignature = signature(0x41);
        const bindings = {
          assignmentId: assigned.assignment_id,
          requestId: assigned.request_id,
          jobId: assigned.job_id,
          attemptNumber: assigned.attempt_number,
          pilotRevisionId: assigned.pilot_revision_id,
          deviceId: assigned.device_id,
          keyId: assigned.device_key_id,
          leaseNonceDigest: assigned.lease_nonce_digest,
          challengeId: assigned.challenge_id,
          challengeDigest: assigned.challenge_digest,
          referenceFingerprint: `hmac-sha256:${assigned.candidate_reference_fingerprint}`,
          referenceBindingDigest,
          receiverRevisionId: assigned.receiver_revision_id,
          receiverProfileId: assigned.receiver_profile_id,
          receiverProfileDigest: assigned.receiver_profile_digest,
          receiverConfigurationDigest: assigned.receiver_configuration_digest,
        };
        const signedAssignment = {
          body: bindings,
          bodyDigest: assignmentBodyDigest,
          signerKeyId: `unused-by-database-${randomUUID()}`,
          signature: firstSignature.encoded,
        };
        signedAssignment.signerKeyId = (
          await client.query<{ readonly signer_key_id: string }>(
            `select signer_key_id from app.private_live_telebirr_assignment_signers
              where id = $1::uuid`,
            [pilot.assignmentSignerId],
          )
        ).rows[0]!.signer_key_id;
        const signedObservation = {
          body: {
            ...bindings,
            assignmentBodyDigest,
            observedAt: observedAt.toISOString(),
            sourceDocumentDigest,
            normalizedFactsDigest,
          },
          bodyDigest: observationBodyDigest,
          signature: observationSignature.encoded,
        };
        const requestBodyDigest = digest(`shadow-request:${assigned.assignment_id}`);
        const stageSql = `select * from app.stage_private_telebirr_device_evidence(
          $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb
        )`;
        const stageValues = [
          pilot.deviceEnrollmentId,
          requestBodyDigest,
          assignmentBodyDigest,
          observationBodyDigest,
          JSON.stringify(signedAssignment),
          JSON.stringify(signedObservation),
        ] as const;
        const staged = await client.query<{
          readonly outcome: string;
          readonly reason_code: string | null;
          readonly replayed: boolean;
        }>(stageSql, [...stageValues]);
        expect(staged.rows).toEqual([{ outcome: 'accepted', reason_code: null, replayed: false }]);
        const stageReplay = await client.query<{
          readonly outcome: string;
          readonly reason_code: string | null;
          readonly replayed: boolean;
        }>(stageSql, [...stageValues]);
        expect(stageReplay.rows).toEqual([
          { outcome: 'accepted', reason_code: null, replayed: true },
        ]);

        const queued = await client.query<{
          readonly completion_request_key: string;
          readonly observation_body_digest: string;
          readonly verification_attempt_id: string;
        }>(`select * from app.load_next_private_telebirr_shadow_staged_evidence()`);
        expect(queued.rows).toHaveLength(1);
        expect(queued.rows[0]).toMatchObject({
          verification_attempt_id: assigned.verification_attempt_id,
          completion_request_key: leaseRequestKey,
          observation_body_digest: observationBodyDigest,
        });

        const authority = await client.query<{
          readonly authority: Readonly<Record<string, unknown>>;
        }>(
          `select app.load_private_telebirr_shadow_verification_authority(
             $1::uuid, $2::uuid, $3::timestamptz
           ) as authority`,
          [assigned.verification_attempt_id, assigned.lease_token, observedAt],
        );
        expect(authority.rows).toHaveLength(1);
        expect(Object.keys(authority.rows[0]!.authority).sort()).toEqual(
          [
            'contractVersion',
            'verificationMode',
            'capturedAt',
            'authorityStateDigest',
            'verificationAttemptId',
            'leaseTokenAccepted',
            'attempt',
            'trustedAssignmentSigner',
            'deviceEnrollment',
            'trustedRequestBinding',
            'assignmentTranscript',
            'replayIdentities',
            'existingCompletion',
            'trustedRequest',
            'trustedPilot',
            'trustedPlayer',
            'trustedProvider',
            'trustedReference',
            'trustedReceiver',
            'trustedPolicy',
            'databaseAuthority',
            'databaseFacts',
          ].sort(),
        );
        expect(authority.rows[0]!.authority).toMatchObject({
          contractVersion: 1,
          verificationMode: 'shadow',
          verificationAttemptId: assigned.verification_attempt_id,
          leaseTokenAccepted: true,
          existingCompletion: null,
          replayIdentities: [],
          trustedPilot: { state: 'armed' },
        });

        const assessedAt = new Date(observedAt.getTime() + 1_000);
        const completionValues = [
          assigned.verification_attempt_id,
          assigned.lease_token,
          leaseRequestKey,
          observationBodyDigest,
          observationSignature.digest,
          digest(`shadow-replay:${assigned.assignment_id}`),
          sourceDocumentDigest,
          normalizedFactsDigest,
          observedAt,
          'would_forward_signed_evidence',
          'signed_evidence_verified',
          digest(`shadow-assessment:${assigned.assignment_id}`),
          assessedAt,
          'settlement_candidate',
          'exact_proof_match',
          digest(`shadow-evidence:${assigned.assignment_id}`),
          observedAt,
          2500,
          observedAt,
          pilot.receiverIdentityDigest,
        ] as const;
        const completionSql = `select * from app.complete_private_telebirr_shadow_verification(
          $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
          $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
          $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
          $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
        )`;

        await client.query('savepoint shadow_quarantine_completion_guard');
        try {
          const quarantined = await client.query<{ readonly quarantined: boolean }>(
            `select app.quarantine_private_telebirr_shadow_staged_evidence(
               $1::uuid, $2::uuid, $3::text, 'trusted_evidence_invalid'
             ) as quarantined`,
            [assigned.verification_attempt_id, assigned.lease_token, observationBodyDigest],
          );
          expect(quarantined.rows).toEqual([{ quarantined: true }]);
          await expectFailure(
            client,
            completionSql,
            completionValues,
            /shadow completion authority is unavailable/iu,
          );
        } finally {
          await client.query('rollback to savepoint shadow_quarantine_completion_guard');
          await client.query('release savepoint shadow_quarantine_completion_guard');
        }

        const completed = await client.query<ShadowCompletionRow>(completionSql, [
          ...completionValues,
        ]);
        expect(completed.rows).toHaveLength(1);
        expect(completed.rows[0]).toMatchObject({
          outcome_disposition: 'would_verify',
          outcome_reason_code: 'exact_proof_match',
          deposit_intent_id: null,
          deposit_payment_claim_id: null,
          execution_job_id: null,
          settlement_created: false,
          already_completed: false,
        });
        const completionReplay = await client.query<ShadowCompletionRow>(completionSql, [
          ...completionValues,
        ]);
        expect(completionReplay.rows).toEqual([{ ...completed.rows[0]!, already_completed: true }]);

        const after = await client.query<{ readonly snapshot: Readonly<Record<string, number>> }>(`
          select jsonb_build_object(
            'intents', (select count(*) from app.deposit_intents),
            'claims', (select count(*) from app.deposit_payment_claims),
            'jobs', (select count(*) from app.deposit_jobs),
            'attempts', (select count(*) from app.deposit_execution_attempts),
            'evidence', (select count(*) from app.provider_payment_evidence),
            'reconciliations', (select count(*) from app.execution_reconciliations),
            'live_proofs', (select count(*) from app.private_live_deposit_pilot_proofs),
            'live_attempts', (select count(*) from app.private_live_telebirr_verification_attempts),
            'live_outcomes', (select count(*) from app.private_live_telebirr_verification_outcomes)
          ) as snapshot
        `);
        expect(after.rows).toEqual(before.rows);
        const shadowOutcome = await client.query<{
          readonly outcome_count: string;
          readonly would_verify: boolean;
        }>(
          `select count(*)::text as outcome_count, bool_and(would_verify) as would_verify
             from app.private_telebirr_shadow_verification_outcomes
            where shadow_proof_request_id = $1::uuid`,
          [proof.rows[0]!.id],
        );
        expect(shadowOutcome.rows).toEqual([{ outcome_count: '1', would_verify: true }]);
      });
    });

    it('leaves every financial and provider action switch disabled', async () => {
      const switches = await getClient().query<{
        readonly feature_key: string;
        readonly mode: string;
        readonly settings: Readonly<Record<string, unknown>>;
      }>(`
        select feature_key, mode, settings
          from app.feature_switches
         where feature_key in (
           'cbe_birr_authoritative_verification', 'deposit_execution',
           'payment_verification', 'telebirr_authoritative_verification',
           'withdrawal_collection', 'withdrawal_validation'
         )
         order by feature_key
      `);
      expect(switches.rows).toEqual([
        { feature_key: 'cbe_birr_authoritative_verification', mode: 'disabled', settings: {} },
        { feature_key: 'deposit_execution', mode: 'disabled', settings: {} },
        { feature_key: 'payment_verification', mode: 'disabled', settings: {} },
        { feature_key: 'telebirr_authoritative_verification', mode: 'disabled', settings: {} },
        { feature_key: 'withdrawal_collection', mode: 'disabled', settings: {} },
        { feature_key: 'withdrawal_validation', mode: 'disabled', settings: {} },
      ]);
    });
  });
}
