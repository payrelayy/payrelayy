import type { OwnerControlRuntimeConfig } from '@fetanagent/config/owner-control';
import { Pool, type PoolConfig } from 'pg';

import { PostgresOwnerInviteControl } from './owner-invites.js';
import { PostgresOwnerKemerbetAgentProfiles } from './owner-kemerbet-agent-profile.js';
import { PostgresOwnerKemerbetReadinessCohortClaims } from './owner-kemerbet-readiness-cohort.js';
import { PostgresOwnerPlayerDepositEligibility } from './owner-player-deposit-eligibility.js';
import { PostgresOwnerDryRunDepositIntake } from './owner-deposit-intake.js';
import { PostgresOwnerDryRunFixtureAssessments } from './owner-dry-run-fixture-assessments.js';
import { PostgresOwnerPlayerRegistrationReviews } from './owner-player-registration-reviews.js';
import { PostgresOwnerPrivateLivePilotControl } from './owner-private-live-pilot.js';
import { PostgresOwnerReceiverAccounts } from './owner-receiver-accounts.js';

export interface OwnerControlPostgresRuntime {
  readonly assessments: Pick<PostgresOwnerDryRunFixtureAssessments, 'assess' | 'list' | 'review'>;
  readonly deposits: Pick<PostgresOwnerDryRunDepositIntake, 'list'>;
  readonly eligibility: Pick<PostgresOwnerPlayerDepositEligibility, 'decide' | 'list'>;
  readonly invites: Pick<PostgresOwnerInviteControl, 'issue' | 'revoke'>;
  readonly kemerbetAgentProfiles: Pick<PostgresOwnerKemerbetAgentProfiles, 'list' | 'prepare'>;
  readonly kemerbetReadinessCohorts: Pick<
    PostgresOwnerKemerbetReadinessCohortClaims,
    'claim' | 'markExported' | 'recordRootReceipt'
  >;
  readonly playerRegistrations: Pick<
    PostgresOwnerPlayerRegistrationReviews,
    'associate' | 'list' | 'listAssociationCandidates' | 'review'
  >;
  readonly privateLivePilot: Pick<
    PostgresOwnerPrivateLivePilotControl,
    'arm' | 'current' | 'prepare' | 'status' | 'stop'
  >;
  readonly receivers: Pick<PostgresOwnerReceiverAccounts, 'list' | 'rotate'>;
  close(): Promise<void>;
  ready(): Promise<boolean>;
}

export class OwnerControlPostgresRuntimeUnavailableError extends Error {
  constructor() {
    super('The Owner-control PostgreSQL runtime is unavailable.');
    this.name = 'OwnerControlPostgresRuntimeUnavailableError';
  }
}

export function ownerControlPoolConfig(
  config: Extract<OwnerControlRuntimeConfig, { readonly enabled: true }>,
): PoolConfig {
  if (config.tlsMode !== 'verify-full') {
    throw new OwnerControlPostgresRuntimeUnavailableError();
  }
  return {
    application_name: 'fetanagent-owner-control',
    database: config.connection.database,
    connectionTimeoutMillis: 5_000,
    host: config.connection.host,
    idleTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 5_000,
    lock_timeout: 1_000,
    max: 1,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    query_timeout: 5_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
    user: config.connection.user,
  };
}

export const OWNER_CONTROL_PREFLIGHT_SQL = `
  select
    current_user = 'fetanagent_owner_control_runtime' as exact_runtime,
    session_user = 'fetanagent_owner_control_runtime' as exact_session,
    has_schema_privilege(current_user, 'app', 'usage') as app_usage,
    not has_schema_privilege(current_user, 'app', 'create') as app_create_denied,
    exists (
      select 1
      from pg_roles role
      where role.rolname = current_user
        and role.rolcanlogin
        and not role.rolinherit
        and not role.rolsuper
        and not role.rolcreatedb
        and not role.rolcreaterole
        and not role.rolreplication
        and not role.rolbypassrls
        and role.rolconnlimit = 1
    ) as runtime_role_is_narrow,
    (
      select count(*) = 1
      from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = current_user
        and granted_role.rolname = 'fetanagent_owner_control'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
    ) as exact_runtime_membership,
    not exists (
      select 1
      from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = current_user
        and granted_role.rolname <> 'fetanagent_owner_control'
    ) as no_other_runtime_memberships,
    not exists (
      select 1
      from pg_auth_members membership
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = 'fetanagent_owner_control'
    ) as owner_group_has_no_parent_roles,
    not exists (
      select 1
      from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where granted_role.rolname = 'fetanagent_owner_control'
        and member_role.rolname not in ('fetanagent_owner_control_runtime', 'postgres')
    ) as owner_group_members_are_private,
    has_function_privilege(current_user, 'app.issue_telegram_beta_invite(uuid,text,timestamptz)', 'execute') as issue_allowed,
    has_function_privilege(current_user, 'app.revoke_telegram_beta_invite(uuid,uuid,text)', 'execute') as revoke_allowed,
    has_function_privilege(current_user, 'app.list_owner_player_registration_requests(uuid,integer)', 'execute') as player_request_list_allowed,
    has_function_privilege(current_user, 'app.review_owner_player_registration_request(uuid,uuid,text,text)', 'execute') as player_request_review_allowed,
    has_function_privilege(current_user, 'app.list_owner_player_registration_association_candidates(uuid,integer)', 'execute') as player_association_list_allowed,
    has_function_privilege(current_user, 'app.associate_owner_validated_player_registration_request(uuid,uuid,text)', 'execute') as player_association_allowed,
    has_function_privilege(current_user, 'app.list_owner_dry_run_deposit_intake(uuid,integer)', 'execute') as deposit_intake_list_allowed,
    has_function_privilege(current_user, 'app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text)', 'execute') as fixture_assessment_record_allowed,
    has_function_privilege(current_user, 'app.review_owner_dry_run_fixture_assessment(uuid,uuid,text)', 'execute') as fixture_assessment_review_allowed,
    has_function_privilege(current_user, 'app.list_owner_dry_run_fixture_assessments(uuid,integer)', 'execute') as fixture_assessment_list_allowed,
    has_function_privilege(current_user, 'app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)', 'execute') as shadow_enqueue_allowed,
    has_function_privilege(current_user, 'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)', 'execute') as shadow_list_allowed,
    has_function_privilege(current_user, 'app.list_owner_player_deposit_eligibility(uuid,integer)', 'execute') as player_eligibility_list_allowed,
    has_function_privilege(current_user, 'app.decide_owner_player_deposit_eligibility(uuid,uuid,text,text)', 'execute') as player_eligibility_decide_allowed,
    has_function_privilege(current_user, 'app.prepare_approved_private_live_telebirr_pilot(uuid,uuid,text[],timestamptz,timestamptz)', 'execute') as private_live_pilot_prepare_allowed,
    has_function_privilege(current_user, 'app.get_current_private_live_deposit_pilot_status(uuid)', 'execute') as private_live_pilot_current_status_allowed,
    has_function_privilege(current_user, 'app.arm_private_live_deposit_pilot(uuid,uuid)', 'execute') as private_live_pilot_arm_allowed,
    has_function_privilege(current_user, 'app.stop_private_live_deposit_pilot(uuid,uuid,text)', 'execute') as private_live_pilot_stop_allowed,
    has_function_privilege(current_user, 'app.get_private_live_deposit_pilot_status(uuid,uuid)', 'execute') as private_live_pilot_status_allowed,
    has_function_privilege(current_user, 'app.list_owner_receiver_accounts(uuid)', 'execute') as receiver_list_allowed,
    has_function_privilege(current_user, 'app.rotate_owner_receiver_account(uuid,uuid,text,text,text,text,text,smallint,smallint,smallint,text)', 'execute') as receiver_rotate_allowed,
    has_function_privilege(current_user, 'app.list_owner_kemerbet_agent_profiles(uuid)', 'execute') as kemerbet_agent_profile_list_allowed,
    has_function_privilege(current_user, 'app.prepare_owner_kemerbet_agent_profile(uuid,uuid,text)', 'execute') as kemerbet_agent_profile_prepare_allowed,
    has_function_privilege(current_user, 'app.prepare_owner_kemerbet_readiness_cohort_claim(uuid,uuid)', 'execute') as kemerbet_readiness_claim_prepare_allowed,
    has_function_privilege(current_user, 'app.advance_owner_kemerbet_readiness_cohort_claim(uuid,uuid,uuid,text)', 'execute') as kemerbet_readiness_claim_advance_allowed,
    has_function_privilege(current_user, 'app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid,uuid,text,text)', 'execute') as kemerbet_readiness_root_receipt_allowed,
    not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and (
          (
            relation.relkind = 'S'
            and has_sequence_privilege(current_user, relation.oid, 'usage,select,update')
          ) or (
            relation.relkind <> 'S'
            and (
              has_table_privilege(
                current_user, relation.oid,
                'select,insert,update,delete,truncate,references,trigger'
              )
              or has_any_column_privilege(
                current_user, relation.oid, 'select,insert,update,references'
              )
            )
          )
        )
    ) as direct_table_access_denied,
    not has_function_privilege(current_user, 'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)', 'execute') as redemption_denied,
    not has_function_privilege(current_user, 'app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)', 'execute') as recorder_denied,
    (
      select count(*) = 26
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege(current_user, procedure.oid, 'execute')
    ) as exact_app_execute_count,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege(current_user, procedure.oid, 'execute')
        and procedure.oid not in (
          'app.issue_telegram_beta_invite(uuid,text,timestamptz)'::regprocedure,
          'app.revoke_telegram_beta_invite(uuid,uuid,text)'::regprocedure,
          'app.list_owner_player_registration_requests(uuid,integer)'::regprocedure,
          'app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure,
          'app.list_owner_player_registration_association_candidates(uuid,integer)'::regprocedure,
          'app.associate_owner_validated_player_registration_request(uuid,uuid,text)'::regprocedure,
          'app.list_owner_dry_run_deposit_intake(uuid,integer)'::regprocedure,
          'app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text)'::regprocedure,
          'app.review_owner_dry_run_fixture_assessment(uuid,uuid,text)'::regprocedure,
          'app.list_owner_dry_run_fixture_assessments(uuid,integer)'::regprocedure,
          'app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)'::regprocedure,
          'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)'::regprocedure,
          'app.list_owner_player_deposit_eligibility(uuid,integer)'::regprocedure,
          'app.decide_owner_player_deposit_eligibility(uuid,uuid,text,text)'::regprocedure,
          'app.prepare_approved_private_live_telebirr_pilot(uuid,uuid,text[],timestamptz,timestamptz)'::regprocedure,
          'app.get_current_private_live_deposit_pilot_status(uuid)'::regprocedure,
          'app.arm_private_live_deposit_pilot(uuid,uuid)'::regprocedure,
          'app.stop_private_live_deposit_pilot(uuid,uuid,text)'::regprocedure,
          'app.get_private_live_deposit_pilot_status(uuid,uuid)'::regprocedure
          ,'app.list_owner_receiver_accounts(uuid)'::regprocedure
          ,'app.rotate_owner_receiver_account(uuid,uuid,text,text,text,text,text,smallint,smallint,smallint,text)'::regprocedure
          ,'app.list_owner_kemerbet_agent_profiles(uuid)'::regprocedure
          ,'app.prepare_owner_kemerbet_agent_profile(uuid,uuid,text)'::regprocedure
          ,'app.prepare_owner_kemerbet_readiness_cohort_claim(uuid,uuid)'::regprocedure
          ,'app.advance_owner_kemerbet_readiness_cohort_claim(uuid,uuid,uuid,text)'::regprocedure
          ,'app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid,uuid,text,text)'::regprocedure
        )
    ) as all_other_app_functions_denied
`;

async function runOwnerControlCatalogPreflight(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query("set local search_path = 'pg_catalog'");
    const result = await client.query<Record<string, boolean>>(OWNER_CONTROL_PREFLIGHT_SQL);
    const row = result.rows.length === 1 ? result.rows[0] : undefined;
    if (!row || Object.values(row).some((value) => value !== true)) {
      throw new Error('preflight failed');
    }
    await client.query('rollback');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The caller receives only the generic unavailable error on rollback uncertainty.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createOwnerControlPostgresRuntime(
  config: Extract<OwnerControlRuntimeConfig, { readonly enabled: true }>,
): Promise<OwnerControlPostgresRuntime> {
  const pool = new Pool(ownerControlPoolConfig(config));
  let poolHealthy = true;
  pool.on('error', () => {
    poolHealthy = false;
  });
  try {
    await runOwnerControlCatalogPreflight(pool);
  } catch {
    await pool.end();
    throw new OwnerControlPostgresRuntimeUnavailableError();
  }

  let closed = false;
  return {
    assessments: new PostgresOwnerDryRunFixtureAssessments({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    deposits: new PostgresOwnerDryRunDepositIntake({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    eligibility: new PostgresOwnerPlayerDepositEligibility({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    invites: new PostgresOwnerInviteControl({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    kemerbetAgentProfiles: new PostgresOwnerKemerbetAgentProfiles({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    kemerbetReadinessCohorts: new PostgresOwnerKemerbetReadinessCohortClaims({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    playerRegistrations: new PostgresOwnerPlayerRegistrationReviews({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    privateLivePilot: new PostgresOwnerPrivateLivePilotControl({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    receivers: new PostgresOwnerReceiverAccounts(
      { query: async (sql, values) => pool.query(sql, [...values]) },
      {
        encryptionSecret: config.receiverReferenceProtection.encryptionSecret,
        fingerprintSecret: config.receiverReferenceProtection.fingerprintSecret,
      },
    ),
    ready: async () => {
      if (closed) return false;
      try {
        const result = await pool.query<{ ready: boolean }>(
          "select current_user = 'fetanagent_owner_control_runtime' as ready",
        );
        const ready = result.rows.length === 1 && result.rows[0]?.ready === true;
        poolHealthy = ready;
        return poolHealthy;
      } catch {
        poolHealthy = false;
        return false;
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
