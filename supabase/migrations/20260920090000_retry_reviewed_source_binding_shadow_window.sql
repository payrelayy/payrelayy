-- Give the one reviewed source-binding shadow recovery exactly one append-only retry after its
-- first twelve-hour request expired untouched. The expired request remains immutable. The child
-- keeps the original protected reference and original submission clock, while receiving a new
-- twelve-hour review window bound to the exact current dry-run pilot and paired Android verifier.
-- This migration cannot reserve, settle, enqueue execution, credit KemerBet, or move money.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;
lock table app.private_live_telebirr_receiver_profiles in share row exclusive mode;
lock table app.private_live_telebirr_device_enrollments in share row exclusive mode;
lock table app.private_live_telebirr_device_pairing_challenges in share row exclusive mode;
lock table app.private_live_telebirr_device_enrollment_certificates in share row exclusive mode;
lock table app.private_live_telebirr_assignment_signers in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_telebirr_shadow_verification_attempts in share mode;
lock table app.private_telebirr_shadow_verification_outcomes in share mode;
lock table app.private_live_telebirr_source_binding_shadow_recoveries
  in share row exclusive mode;

do $source_binding_window_retry_preflight$
declare
  safe_switch_count integer;
  disabled_companion_count integer;
begin
  if pg_catalog.to_regclass(
       'app.private_telebirr_shadow_source_binding_window_retries'
     ) is not null
    or exists (
      select 1
        from pg_catalog.pg_attribute attribute
       where attribute.attrelid =
             'app.private_telebirr_shadow_proof_requests'::regclass
         and attribute.attname = 'source_binding_window_retry_source_id'
         and not attribute.attisdropped
    )
    or pg_catalog.to_regprocedure(
         'app.retry_reviewed_private_telebirr_source_binding_shadow_window(text,text)'
       ) is not null
    or pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_binding_window_retry_is_valid(uuid,uuid)'
       ) is not null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(uuid,uuid)'
       ) is not null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_source_binding_shadow_recovery_is_valid(uuid,uuid)'
       ) is null
    or app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'The reviewed source-binding window retry prerequisites do not match.';
  end if;

  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  select pg_catalog.count(*)::integer
    into disabled_companion_count
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
     and execution_control.control_state = 'disabled'
     and execution_control.certificate_id is null
     and execution_control.device_id is null
     and execution_control.device_key_id is null
     and execution_control.no_money_signer_key_id is null
     and execution_control.execution_signer_key_id is null
     and execution_control.execution_signer_public_key_spki is null
     and execution_control.execution_signer_public_key_spki_sha256 is null
     and execution_control.platform_agent_account_id is null
     and execution_control.pilot_revision_id is null
     and execution_control.pilot_revision is null
     and execution_control.pilot_configuration_digest is null
     and execution_control.activation_epoch is null
     and execution_control.active_from is null
     and execution_control.expires_at is null
     and execution_control.activated_by_admin_id is null
     and execution_control.activated_at is null;

  if safe_switch_count <> 7
    or disabled_companion_count <> 1
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_telebirr_shadow_verifier',
         'fetanagent_telebirr_shadow_verifier_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_telebirr_shadow_verifier',
         'fetanagent_telebirr_shadow_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The reviewed source-binding window retry requires the no-money boundary.';
  end if;
end;
$source_binding_window_retry_preflight$;

-- Preserve the exact current source-binding validator as a historical lineage validator. Only its
-- current lease and current-pilot predicates are removed; every immutable digest, source-binding,
-- completion-consumption, no-money, and protected-reference check remains byte-for-byte.
do $install_source_binding_shadow_history_validator$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_live_telebirr_source_binding_shadow_recovery_is_valid(uuid,uuid)'
  );
  old_name constant text :=
    'app.private_live_telebirr_source_binding_shadow_recovery_is_valid';
  new_name constant text :=
    'app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid';
  old_deadline constant text :=
    '    and recovery.authorized_at <= pg_catalog.clock_timestamp()' || pg_catalog.chr(10)
    || '    and recovery.recovery_expires_at > pg_catalog.clock_timestamp()';
  new_deadline constant text :=
    '    and recovery.authorized_at <= pg_catalog.clock_timestamp()' || pg_catalog.chr(10)
    || '    and recovery.recovery_expires_at > recovery.authorized_at';
  old_mode constant text :=
    '    and app.private_telebirr_shadow_mode_is_ready(' || pg_catalog.chr(10)
    || '      recovery.target_pilot_revision_id' || pg_catalog.chr(10)
    || '    );';
  new_mode constant text := '    and true;';
  original_definition text;
  rewritten_definition text;
begin
  select pg_catalog.pg_get_functiondef(routine.oid)
    into original_definition
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.provolatile = 's'
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_name, ''))
    ) / pg_catalog.length(old_name) <> 1
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_deadline, ''))
    ) / pg_catalog.length(old_deadline) <> 1
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_mode, ''))
    ) / pg_catalog.length(old_mode) <> 1 then
    raise exception 'The reviewed source-binding shadow validator changed shape.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_name, new_name);
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_deadline, new_deadline);
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_mode, new_mode);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = pg_catalog.to_regprocedure(
             'app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(uuid,uuid)'
           )
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.provolatile = 's'
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and pg_catalog.strpos(routine.prosrc, old_deadline) = 0
       and pg_catalog.strpos(routine.prosrc, new_deadline) > 0
       and pg_catalog.strpos(routine.prosrc, old_mode) = 0
  ) then
    raise exception 'The reviewed source-binding history validator was not installed exactly.';
  end if;
end;
$install_source_binding_shadow_history_validator$;

alter table app.private_telebirr_shadow_proof_requests
  add column source_binding_window_retry_source_id uuid;

alter table app.private_telebirr_shadow_proof_requests
  add constraint private_tbirr_shadow_binding_window_source_not_self_check check (
    source_binding_window_retry_source_id is null
    or source_binding_window_retry_source_id <> id
  ),
  add constraint private_tbirr_shadow_binding_window_branch_shape_check check (
    source_binding_window_retry_source_id is null
    or (
      source_unavailable_retry_source_id is null
      and observation_clock_retry_source_id is null
      and authority_deadline_retry_source_id is null
      and assessment_clock_retry_source_id is null
      and source_live_verification_job_id is null
      and source_live_proof_id is null
      and source_pilot_revision_id is null
      and source_receiver_profile_id is null
      and original_expires_at is null
      and recovered_at is null
      and recovery_request_key is null
      and recovery_request_digest is null
      and recovery_reason_code is null
      and retry_request_key is null
      and retry_request_digest is null
      and retry_reason_code is null
      and retry_prior_pilot_revision_id is null
      and retry_prior_receiver_profile_id is null
      and retry_prior_configuration_digest is null
      and retry_original_expires_at is null
      and retried_at is null
      and infrastructure_retry_request_key is null
      and infrastructure_retry_request_digest is null
      and infrastructure_retry_reason_code is null
      and infrastructure_retry_original_expires_at is null
      and infrastructure_retried_at is null
      and runtime_retry_request_key is null
      and runtime_retry_request_digest is null
      and runtime_retry_reason_code is null
      and runtime_retry_original_expires_at is null
      and runtime_retry_prior_attempt_count is null
      and runtime_retry_prior_attempt_history_digest is null
      and runtime_retried_at is null
    )
  ),
  add constraint private_tbirr_shadow_binding_window_source_reference_fkey
    foreign key (
      source_binding_window_retry_source_id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) references app.private_telebirr_shadow_proof_requests (
      id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) on delete restrict,
  add constraint private_tbirr_shadow_binding_window_source_once_key
    unique (source_binding_window_retry_source_id);

do $replace_source_binding_window_original_reference_index$
declare
  index_definition text;
begin
  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into index_definition
    from pg_catalog.pg_index index_row
   where index_row.indexrelid =
         'app.private_tbirr_shadow_original_provider_reference_uidx'::regclass
     and index_row.indisunique
     and index_row.indisvalid;

  if index_definition is distinct from
       'CREATE UNIQUE INDEX private_tbirr_shadow_original_provider_reference_uidx ON app.private_telebirr_shadow_proof_requests USING btree (payment_provider_id, candidate_reference_fingerprint) WHERE ((source_unavailable_retry_source_id IS NULL) AND (observation_clock_retry_source_id IS NULL) AND (authority_deadline_retry_source_id IS NULL) AND (assessment_clock_retry_source_id IS NULL))' then
    raise exception 'The TeleBirr original provider-reference index changed shape.';
  end if;
end;
$replace_source_binding_window_original_reference_index$;

drop index app.private_tbirr_shadow_original_provider_reference_uidx;
create unique index private_tbirr_shadow_original_provider_reference_uidx
  on app.private_telebirr_shadow_proof_requests (
    payment_provider_id,
    candidate_reference_fingerprint
  )
  where source_unavailable_retry_source_id is null
    and observation_clock_retry_source_id is null
    and authority_deadline_retry_source_id is null
    and assessment_clock_retry_source_id is null
    and source_binding_window_retry_source_id is null;

-- Extend the deployed proof-window expression rather than reconstructing its prior branches.
do $extend_source_binding_window_retry_proof_window$
declare
  definition text;
  prior_expression text;
  installed_definition text;
  new_branch constant text := $window_branch$
    not_before = submitted_at
    and expires_at > not_before
    and source_live_verification_job_id is null
    and source_live_proof_id is null
    and source_pilot_revision_id is null
    and source_receiver_profile_id is null
    and original_expires_at is null
    and recovered_at is null
    and recovery_request_key is null
    and recovery_request_digest is null
    and recovery_reason_code is null
    and retry_request_key is null
    and retry_request_digest is null
    and retry_reason_code is null
    and retry_prior_pilot_revision_id is null
    and retry_prior_receiver_profile_id is null
    and retry_prior_configuration_digest is null
    and retry_original_expires_at is null
    and retried_at is null
    and infrastructure_retry_request_key is null
    and infrastructure_retry_request_digest is null
    and infrastructure_retry_reason_code is null
    and infrastructure_retry_original_expires_at is null
    and infrastructure_retried_at is null
    and runtime_retry_request_key is null
    and runtime_retry_request_digest is null
    and runtime_retry_reason_code is null
    and runtime_retry_original_expires_at is null
    and runtime_retry_prior_attempt_count is null
    and runtime_retry_prior_attempt_history_digest is null
    and runtime_retried_at is null
    and source_unavailable_retry_source_id is null
    and observation_clock_retry_source_id is null
    and authority_deadline_retry_source_id is null
    and assessment_clock_retry_source_id is null
    and source_binding_window_retry_source_id is not null
    and created_at >= submitted_at
    and expires_at = created_at + interval '12 hours'
  $window_branch$;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;

  if definition is null
    or pg_catalog.left(definition, 7) <> 'CHECK ('
    or pg_catalog.right(definition, 1) <> ')'
    or pg_catalog.strpos(definition, 'source_binding_window_retry_source_id') <> 0
    or pg_catalog.strpos(
         definition,
         'reviewed_source_binding_source_unavailable_recovery_no_credit'
       ) = 0
    or pg_catalog.strpos(definition, 'assessment_clock_retry_source_id') = 0 then
    raise exception 'The deployed TeleBirr shadow proof window changed shape.';
  end if;

  prior_expression := pg_catalog.substring(
    definition,
    8,
    pg_catalog.length(definition) - 8
  );
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'drop constraint private_telebirr_shadow_proof_window_check';
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'add constraint private_telebirr_shadow_proof_window_check check (('
       || prior_expression || ') or (' || new_branch || '))';

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into installed_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;

  if installed_definition is null
    or (
      pg_catalog.length(installed_definition)
      - pg_catalog.length(pg_catalog.replace(
          installed_definition,
          'source_binding_window_retry_source_id',
          ''
        ))
    ) / pg_catalog.length('source_binding_window_retry_source_id') <> 1
    or pg_catalog.strpos(installed_definition, 'assessment_clock_retry_source_id') = 0
    or pg_catalog.strpos(installed_definition, 'runtime_retry_request_key') = 0 then
    raise exception 'The source-binding window retry branch was not installed exactly.';
  end if;
end;
$extend_source_binding_window_retry_proof_window$;

create table app.private_telebirr_shadow_source_binding_window_retries (
  retry_request_key uuid primary key,
  retry_request_digest text not null unique
    check (retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_recovery_request_key uuid not null unique
    references app.private_live_telebirr_source_binding_shadow_recoveries (
      recovery_request_key
    ) on delete restrict,
  source_recovery_request_digest text not null unique
    check (source_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_proof_request_id uuid not null unique,
  source_shadow_verification_job_id uuid not null unique,
  replacement_shadow_proof_request_id uuid not null unique,
  replacement_shadow_verification_job_id uuid not null unique,
  source_pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  source_receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  target_pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  target_receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  assignment_signer_id uuid not null
    references app.private_live_telebirr_assignment_signers (id) on delete restrict,
  source_attempt_count integer not null check (source_attempt_count = 0),
  source_outcome_count integer not null check (source_outcome_count = 0),
  authorized_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reviewed_main_commit_sha text not null
    check (reviewed_main_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null check (
    reason_code = 'reviewed_source_binding_shadow_window_retry_no_credit'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_binding_window_retry_key_v4_check check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_binding_window_retry_distinct_pilot_check check (
    source_pilot_revision_id <> target_pilot_revision_id
  ),
  constraint private_tbirr_shadow_binding_window_retry_window_check check (
    retry_expires_at = authorized_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_binding_window_retry_source_job_fkey
    foreign key (source_shadow_proof_request_id, source_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_binding_window_retry_replacement_job_fkey
    foreign key (
      replacement_shadow_proof_request_id,
      replacement_shadow_verification_job_id
    ) references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict deferrable initially deferred
);

create function app.private_telebirr_shadow_source_binding_window_retry_digest(
  p_retry_request_key uuid,
  p_source_recovery_request_key uuid,
  p_source_recovery_request_digest text,
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_source_pilot_revision_id uuid,
  p_source_receiver_profile_id uuid,
  p_target_pilot_revision_id uuid,
  p_target_receiver_profile_id uuid,
  p_device_enrollment_id uuid,
  p_assignment_signer_id uuid,
  p_source_attempt_count integer,
  p_source_outcome_count integer,
  p_authorized_at timestamptz,
  p_retry_expires_at timestamptz,
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
  if p_retry_request_key is null
    or p_source_recovery_request_key is null
    or p_source_recovery_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_shadow_proof_request_id is null
    or p_source_shadow_verification_job_id is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_device_enrollment_id is null
    or p_assignment_signer_id is null
    or p_source_attempt_count <> 0
    or p_source_outcome_count <> 0
    or p_authorized_at is null
    or p_retry_expires_at is distinct from p_authorized_at + interval '12 hours'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'reviewed_source_binding_shadow_window_retry_no_credit' then
    raise exception 'The source-binding shadow window retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:reviewed-source-binding:shadow-window-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_recovery_key=' || p_source_recovery_request_key::text
      || '|source_recovery_digest=' || p_source_recovery_request_digest
      || '|source_shadow_proof_id=' || p_source_shadow_proof_request_id::text
      || '|source_shadow_job_id=' || p_source_shadow_verification_job_id::text
      || '|replacement_shadow_proof_id='
      || p_replacement_shadow_proof_request_id::text
      || '|replacement_shadow_job_id='
      || p_replacement_shadow_verification_job_id::text
      || '|source_pilot_id=' || p_source_pilot_revision_id::text
      || '|source_profile_id=' || p_source_receiver_profile_id::text
      || '|target_pilot_id=' || p_target_pilot_revision_id::text
      || '|target_profile_id=' || p_target_receiver_profile_id::text
      || '|device_enrollment_id=' || p_device_enrollment_id::text
      || '|assignment_signer_id=' || p_assignment_signer_id::text
      || '|source_attempt_count=' || p_source_attempt_count::text
      || '|source_outcome_count=' || p_source_outcome_count::text
      || '|authorized_at_us=' || (
        extract(epoch from p_authorized_at) * 1000000
      )::bigint::text
      || '|retry_expires_at_us=' || (
        extract(epoch from p_retry_expires_at) * 1000000
      )::bigint::text
      || '|reviewed_main_commit_sha=' || p_reviewed_main_commit_sha
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.private_live_telebirr_shadow_pilot_contract_matches(
  p_source_pilot_revision_id uuid,
  p_target_pilot_revision_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
begin
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_source_pilot_revision_id;
  select pilot.* into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_target_pilot_revision_id;

  return source_pilot.id is not null
    and target_pilot.id is not null
    and source_pilot.id <> target_pilot.id
    and source_pilot.contract_version is not distinct from target_pilot.contract_version
    and source_pilot.platform_id is not distinct from target_pilot.platform_id
    and source_pilot.platform_agent_account_id is not distinct from
        target_pilot.platform_agent_account_id
    and source_pilot.platform_agent_label_snapshot is not distinct from
        target_pilot.platform_agent_label_snapshot
    and source_pilot.platform_agent_updated_at_snapshot is not distinct from
        target_pilot.platform_agent_updated_at_snapshot
    and source_pilot.currency_code is not distinct from target_pilot.currency_code
    and source_pilot.minimum_amount_minor is not distinct from
        target_pilot.minimum_amount_minor
    and source_pilot.maximum_per_deposit_minor is not distinct from
        target_pilot.maximum_per_deposit_minor
    and source_pilot.maximum_per_player_minor is not distinct from
        target_pilot.maximum_per_player_minor
    and source_pilot.maximum_aggregate_minor is not distinct from
        target_pilot.maximum_aggregate_minor
    and source_pilot.maximum_reservation_count is not distinct from
        target_pilot.maximum_reservation_count
    and source_pilot.created_by_admin_id is not distinct from
        target_pilot.created_by_admin_id
    and (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.player_account_id
             )
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = source_pilot.id
    ) is not distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.player_account_id
             )
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = target_pilot.id
    )
    and (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.customer_id
             )
        from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = source_pilot.id
    ) is not distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.customer_id
             )
        from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = target_pilot.id
    )
    and (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.payment_provider_id
             )
        from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = source_pilot.id
    ) is not distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.payment_provider_id
             )
        from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = target_pilot.id
    );
exception
  when others then
    return false;
end;
$$;

create function app.private_live_telebirr_shadow_profile_contract_matches(
  p_source_receiver_profile_id uuid,
  p_target_receiver_profile_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
begin
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = p_source_receiver_profile_id;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = p_target_receiver_profile_id;

  return source_profile.id is not null
    and target_profile.id is not null
    and source_profile.id <> target_profile.id
    and source_profile.payment_provider_id is not distinct from
        target_profile.payment_provider_id
    and source_profile.provider_code is not distinct from target_profile.provider_code
    and source_profile.receiver_account_id is not distinct from
        target_profile.receiver_account_id
    and source_profile.receiver_account_version is not distinct from
        target_profile.receiver_account_version
    and source_profile.receiver_identity_digest is not distinct from
        target_profile.receiver_identity_digest
    and source_profile.expected_receiver_name_digest is not distinct from
        target_profile.expected_receiver_name_digest
    and source_profile.receiver_match_basis is not distinct from
        target_profile.receiver_match_basis
    and source_profile.source_profile is not distinct from target_profile.source_profile
    and source_profile.receiver_name_normalizer_version is not distinct from
        target_profile.receiver_name_normalizer_version
    and source_profile.adapter_version is not distinct from target_profile.adapter_version
    and source_profile.parser_version is not distinct from target_profile.parser_version
    and source_profile.facts_normalizer_version is not distinct from
        target_profile.facts_normalizer_version
    and source_profile.policy_version is not distinct from target_profile.policy_version
    and source_profile.deposit_policy_version_id is not distinct from
        target_profile.deposit_policy_version_id
    and source_profile.deposit_policy_version is not distinct from
        target_profile.deposit_policy_version
    and source_profile.minimum_principal_amount_minor is not distinct from
        target_profile.minimum_principal_amount_minor
    and source_profile.maximum_principal_amount_minor is not distinct from
        target_profile.maximum_principal_amount_minor
    and source_profile.policy_digest is not distinct from target_profile.policy_digest
    and source_profile.automatic_freshness_seconds is not distinct from
        target_profile.automatic_freshness_seconds
    and source_profile.maximum_future_skew_seconds is not distinct from
        target_profile.maximum_future_skew_seconds;
exception
  when others then
    return false;
end;
$$;

create function app.private_telebirr_shadow_source_binding_window_boundary_is_ready(
  p_pilot_revision_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  select app.private_telebirr_shadow_mode_is_ready(p_pilot_revision_id)
    and app.current_private_trusted_telebirr_activation_epoch() is null
    and (
      select pg_catalog.count(*) = 1
        from app.agent_platform_companion_execution_control execution_control
       where execution_control.singleton
         and execution_control.control_state = 'disabled'
         and execution_control.certificate_id is null
         and execution_control.device_id is null
         and execution_control.device_key_id is null
         and execution_control.no_money_signer_key_id is null
         and execution_control.execution_signer_key_id is null
         and execution_control.execution_signer_public_key_spki is null
         and execution_control.execution_signer_public_key_spki_sha256 is null
         and execution_control.platform_agent_account_id is null
         and execution_control.pilot_revision_id is null
         and execution_control.pilot_revision is null
         and execution_control.pilot_configuration_digest is null
         and execution_control.activation_epoch is null
         and execution_control.active_from is null
         and execution_control.expires_at is null
         and execution_control.activated_by_admin_id is null
         and execution_control.activated_at is null
    )
    and not exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and role.rolcanlogin
    )
    and not exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    )
$$;

create function app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_device_enrollment_id uuid,
  p_assignment_signer_id uuid,
  p_required_until timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_required_until is not null
    and (
      select pg_catalog.count(*) = 1
        from app.private_live_telebirr_device_enrollments enrollment
        join app.private_live_telebirr_device_enrollment_certificates certificate
          on certificate.device_enrollment_id = enrollment.id
        join app.private_live_telebirr_device_pairing_challenges pairing
          on pairing.pairing_id = certificate.pairing_id
         and pairing.reserved_enrollment_id = enrollment.id
        join app.private_live_telebirr_assignment_signers signer
          on signer.id = pairing.assignment_signer_id
       where enrollment.id = p_device_enrollment_id
         and enrollment.pilot_revision_id = p_pilot_revision_id
         and enrollment.receiver_profile_id = p_receiver_profile_id
         and pairing.pilot_revision_id = p_pilot_revision_id
         and pairing.receiver_profile_id = p_receiver_profile_id
         and pairing.assignment_signer_id = p_assignment_signer_id
         and pairing.state = 'completed'
         and pairing.completed_at is not null
         and enrollment.valid_from <= pg_catalog.clock_timestamp()
         and enrollment.valid_until > p_required_until
         and pairing.certificate_valid_from <= pg_catalog.clock_timestamp()
         and pairing.certificate_valid_until > p_required_until
         and signer.valid_from <= pg_catalog.clock_timestamp()
         and signer.valid_until > p_required_until
         and not exists (
           select 1
             from app.private_live_telebirr_device_revocations revocation
            where revocation.device_enrollment_id = enrollment.id
              and revocation.revoked_at <= pg_catalog.clock_timestamp()
         )
         and not exists (
           select 1
             from app.private_live_telebirr_assignment_signer_revocations revocation
            where revocation.assignment_signer_id = signer.id
              and revocation.revoked_at <= pg_catalog.clock_timestamp()
         )
    )
$$;

create trigger private_tbirr_shadow_binding_window_retries_immutable
before update or delete on app.private_telebirr_shadow_source_binding_window_retries
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_tbirr_shadow_binding_window_retries_no_truncate
before truncate on app.private_telebirr_shadow_source_binding_window_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.private_telebirr_shadow_source_binding_window_retry_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_retry_request_key uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_telebirr_shadow_source_binding_window_retries%rowtype;
  source_recovery app.private_live_telebirr_source_binding_shadow_recoveries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  replacement app.private_telebirr_shadow_proof_requests%rowtype;
  expected_digest text;
  source_attempt_count integer;
  source_outcome_count integer;
begin
  if p_replacement_shadow_proof_request_id is null
    or p_retry_request_key is null then
    return false;
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_source_binding_window_retries candidate
   where candidate.retry_request_key = p_retry_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;
  select recovery.* into source_recovery
    from app.private_live_telebirr_source_binding_shadow_recoveries recovery
   where recovery.recovery_request_key = retry.source_recovery_request_key;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.source_shadow_proof_request_id
     and proof.verification_job_id = retry.source_shadow_verification_job_id;
  select proof.* into replacement
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id;

  select pg_catalog.count(*)::integer into source_attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into source_outcome_count
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_source_binding_window_retry_digest(
    retry.retry_request_key,
    retry.source_recovery_request_key,
    retry.source_recovery_request_digest,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.source_pilot_revision_id,
    retry.source_receiver_profile_id,
    retry.target_pilot_revision_id,
    retry.target_receiver_profile_id,
    retry.device_enrollment_id,
    retry.assignment_signer_id,
    retry.source_attempt_count,
    retry.source_outcome_count,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );

  return retry.retry_request_key is not null
    and retry.retry_request_digest = expected_digest
    and retry.source_recovery_request_digest =
        source_recovery.recovery_request_digest
    and retry.source_shadow_proof_request_id =
        source_recovery.replacement_shadow_proof_request_id
    and retry.source_shadow_verification_job_id =
        source_recovery.replacement_shadow_verification_job_id
    and retry.source_pilot_revision_id = source_recovery.target_pilot_revision_id
    and retry.source_receiver_profile_id = source_recovery.target_receiver_profile_id
    and app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(
          source_proof.id,
          source_recovery.recovery_request_key
        )
    and source_proof.proof_status = 'verification_queued'
    and source_proof.expires_at <= retry.authorized_at
    and source_attempt_count = retry.source_attempt_count
    and source_outcome_count = retry.source_outcome_count
    and retry.source_attempt_count = 0
    and retry.source_outcome_count = 0
    and replacement.id = p_replacement_shadow_proof_request_id
    and replacement.source_binding_window_retry_source_id = source_proof.id
    and replacement.pilot_revision_id = retry.target_pilot_revision_id
    and replacement.receiver_profile_id = retry.target_receiver_profile_id
    and replacement.submitting_customer_id = source_proof.submitting_customer_id
    and replacement.player_account_id = source_proof.player_account_id
    and replacement.payment_provider_id = source_proof.payment_provider_id
    and replacement.provider_code = source_proof.provider_code
    and replacement.pilot_configuration_digest = (
      select pilot.configuration_digest
        from app.private_live_deposit_pilot_revisions pilot
       where pilot.id = retry.target_pilot_revision_id
    )
    and replacement.origin_channel = source_proof.origin_channel
    and replacement.input_kind = source_proof.input_kind
    and replacement.candidate_reference_ciphertext =
        source_proof.candidate_reference_ciphertext
    and replacement.candidate_reference_fingerprint =
        source_proof.candidate_reference_fingerprint
    and replacement.candidate_reference_masked = source_proof.candidate_reference_masked
    and replacement.reference_encryption_key_version =
        source_proof.reference_encryption_key_version
    and replacement.reference_profile_version = source_proof.reference_profile_version
    and replacement.proof_status = 'verification_queued'
    and replacement.submitted_at = source_proof.submitted_at
    and replacement.not_before = source_proof.not_before
    and replacement.created_at = retry.authorized_at
    and replacement.expires_at = retry.retry_expires_at
    and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
    and retry.authorized_at <= pg_catalog.clock_timestamp()
    and retry.retry_expires_at > pg_catalog.clock_timestamp()
    and retry.reason_code = 'reviewed_source_binding_shadow_window_retry_no_credit'
    and app.private_live_telebirr_shadow_pilot_contract_matches(
          retry.source_pilot_revision_id,
          retry.target_pilot_revision_id
        )
    and app.private_live_telebirr_shadow_profile_contract_matches(
          retry.source_receiver_profile_id,
          retry.target_receiver_profile_id
        )
    and app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
          retry.target_pilot_revision_id,
          retry.target_receiver_profile_id,
          retry.device_enrollment_id,
          retry.assignment_signer_id,
          pg_catalog.clock_timestamp() + interval '60 seconds'
        )
    and app.private_telebirr_shadow_source_binding_window_boundary_is_ready(
          retry.target_pilot_revision_id
        )
    and not exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             source_recovery.source_live_proof_id
    )
    and not exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id = source_recovery.source_live_outcome_id
    )
    and not exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    );
exception
  when others then
    return false;
end;
$$;

create function app.guard_private_telebirr_shadow_source_binding_window_retry_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  request_key_text text := pg_catalog.current_setting(
    'app.private_telebirr_shadow_source_binding_window_retry', true
  );
  retry app.private_telebirr_shadow_source_binding_window_retries%rowtype;
  source_recovery app.private_live_telebirr_source_binding_shadow_recoveries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  expected_digest text;
  source_attempt_count integer;
  source_outcome_count integer;
begin
  if new.source_binding_window_retry_source_id is null then
    return new;
  end if;

  if request_key_text is null
    or request_key_text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The source-binding shadow window retry context is invalid.';
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_source_binding_window_retries candidate
   where candidate.retry_request_key = request_key_text::uuid
   for share;
  select recovery.* into source_recovery
    from app.private_live_telebirr_source_binding_shadow_recoveries recovery
   where recovery.recovery_request_key = retry.source_recovery_request_key
   for share;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = new.source_binding_window_retry_source_id
     and proof.id = retry.source_shadow_proof_request_id
     and proof.verification_job_id = retry.source_shadow_verification_job_id
   for share;

  select pg_catalog.count(*)::integer into source_attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into source_outcome_count
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_source_binding_window_retry_digest(
    retry.retry_request_key,
    retry.source_recovery_request_key,
    retry.source_recovery_request_digest,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.source_pilot_revision_id,
    retry.source_receiver_profile_id,
    retry.target_pilot_revision_id,
    retry.target_receiver_profile_id,
    retry.device_enrollment_id,
    retry.assignment_signer_id,
    retry.source_attempt_count,
    retry.source_outcome_count,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );

  if session_user <> 'postgres'
    or retry.retry_request_key is null
    or retry.retry_request_digest is distinct from expected_digest
    or retry.source_recovery_request_digest is distinct from
       source_recovery.recovery_request_digest
    or retry.source_shadow_proof_request_id is distinct from
       source_recovery.replacement_shadow_proof_request_id
    or retry.source_shadow_verification_job_id is distinct from
       source_recovery.replacement_shadow_verification_job_id
    or retry.source_pilot_revision_id is distinct from
       source_recovery.target_pilot_revision_id
    or retry.source_receiver_profile_id is distinct from
       source_recovery.target_receiver_profile_id
    or not app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(
         source_proof.id,
         source_recovery.recovery_request_key
       )
    or source_proof.proof_status is distinct from 'verification_queued'
    or source_proof.expires_at > retry.authorized_at
    or source_attempt_count <> 0
    or source_outcome_count <> 0
    or retry.source_attempt_count <> source_attempt_count
    or retry.source_outcome_count <> source_outcome_count
    or new.id is distinct from retry.replacement_shadow_proof_request_id
    or new.verification_job_id is distinct from
       retry.replacement_shadow_verification_job_id
    or new.pilot_revision_id is distinct from retry.target_pilot_revision_id
    or new.receiver_profile_id is distinct from retry.target_receiver_profile_id
    or new.submitting_customer_id is distinct from source_proof.submitting_customer_id
    or new.player_account_id is distinct from source_proof.player_account_id
    or new.payment_provider_id is distinct from source_proof.payment_provider_id
    or new.provider_code is distinct from source_proof.provider_code
    or new.pilot_configuration_digest is distinct from (
      select pilot.configuration_digest
        from app.private_live_deposit_pilot_revisions pilot
       where pilot.id = retry.target_pilot_revision_id
    )
    or new.origin_channel is distinct from source_proof.origin_channel
    or new.input_kind is distinct from source_proof.input_kind
    or new.candidate_reference_ciphertext is distinct from
       source_proof.candidate_reference_ciphertext
    or new.candidate_reference_fingerprint is distinct from
       source_proof.candidate_reference_fingerprint
    or new.candidate_reference_masked is distinct from source_proof.candidate_reference_masked
    or new.reference_encryption_key_version is distinct from
       source_proof.reference_encryption_key_version
    or new.reference_profile_version is distinct from source_proof.reference_profile_version
    or new.proof_status is distinct from 'verification_queued'
    or new.submitted_at is distinct from source_proof.submitted_at
    or new.not_before is distinct from source_proof.not_before
    or new.created_at is distinct from retry.authorized_at
    or new.expires_at is distinct from retry.retry_expires_at
    or new.expires_at is distinct from retry.authorized_at + interval '12 hours'
    or not app.private_live_telebirr_shadow_pilot_contract_matches(
         retry.source_pilot_revision_id,
         retry.target_pilot_revision_id
       )
    or not app.private_live_telebirr_shadow_profile_contract_matches(
         retry.source_receiver_profile_id,
         retry.target_receiver_profile_id
       )
    or not app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
         retry.target_pilot_revision_id,
         retry.target_receiver_profile_id,
         retry.device_enrollment_id,
         retry.assignment_signer_id,
         retry.authorized_at + interval '5 minutes'
       )
    or not app.private_telebirr_shadow_source_binding_window_boundary_is_ready(
         retry.target_pilot_revision_id
       ) then
    raise exception 'The source-binding shadow window retry child is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_tbirr_shadow_binding_window_retry_insert_guard
before insert on app.private_telebirr_shadow_proof_requests
for each row
when (new.source_binding_window_retry_source_id is not null)
execute function app.guard_private_telebirr_shadow_source_binding_window_retry_insert();

create function app.retry_reviewed_private_telebirr_source_binding_shadow_window(
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns table (
  created boolean,
  window_retry_count integer,
  shadow_request_count integer,
  source_shadow_attempt_count integer,
  source_shadow_outcome_count integer,
  replacement_shadow_attempt_count integer,
  replacement_shadow_outcome_count integer,
  configured_window_seconds integer,
  remaining_seconds integer,
  money_moved boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_retry app.private_telebirr_shadow_source_binding_window_retries%rowtype;
  source_recovery app.private_live_telebirr_source_binding_shadow_recoveries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_enrollment_id uuid;
  target_signer_id uuid;
  inserted_proof app.private_telebirr_shadow_proof_requests%rowtype;
  candidate_count integer;
  existing_retry_count integer;
  locked_switch_count integer;
  ready_enrollment_count integer;
  source_attempts integer;
  source_outcomes integer;
  v_retry_request_key uuid;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_digest text;
  v_authorized_at timestamptz;
  v_retry_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'reviewed_source_binding_shadow_window_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The reviewed source-binding shadow window retry request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:reviewed-source-binding:shadow-window-retry',
      0
    )
  );
  perform app.lock_private_trusted_telebirr_activation_authority();

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification',
     'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics locked_switch_count = row_count;

  v_authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_retry_until := v_authorized_at + interval '12 hours';

  select pg_catalog.count(*)::integer into existing_retry_count
    from app.private_telebirr_shadow_source_binding_window_retries retry;
  select retry.* into existing_retry
    from app.private_telebirr_shadow_source_binding_window_retries retry
   order by retry.authorized_at desc, retry.retry_request_key
   limit 1
   for share;

  if existing_retry_count <> 0 then
    if existing_retry_count = 1
      and existing_retry.reviewed_main_commit_sha = p_reviewed_main_commit_sha
      and existing_retry.reason_code = p_reason_code
      and app.private_telebirr_shadow_source_binding_window_retry_is_valid(
            existing_retry.replacement_shadow_proof_request_id,
            existing_retry.retry_request_key
          ) then
      return query
      select false,
             1,
             1,
             existing_retry.source_attempt_count,
             existing_retry.source_outcome_count,
             (
               select pg_catalog.count(*)::integer
                 from app.private_telebirr_shadow_verification_attempts attempt
                where attempt.shadow_proof_request_id =
                      existing_retry.replacement_shadow_proof_request_id
             ),
             (
               select pg_catalog.count(*)::integer
                 from app.private_telebirr_shadow_verification_outcomes outcome
                where outcome.shadow_proof_request_id =
                      existing_retry.replacement_shadow_proof_request_id
             ),
             43200,
             greatest(
               0,
               extract(epoch from (
                 existing_retry.retry_expires_at - pg_catalog.clock_timestamp()
               ))::integer
             ),
             false;
      return;
    end if;
    raise exception 'The reviewed source-binding shadow window retry already exists or conflicts.';
  end if;

  select pg_catalog.count(*)::integer into candidate_count
    from app.private_live_telebirr_source_binding_shadow_recoveries recovery
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = recovery.replacement_shadow_proof_request_id
     and proof.verification_job_id = recovery.replacement_shadow_verification_job_id
    left join app.private_telebirr_shadow_source_binding_window_retries retry
      on retry.source_recovery_request_key = recovery.recovery_request_key
   where retry.retry_request_key is null
     and recovery.reason_code =
         'reviewed_source_binding_source_unavailable_recovery_no_credit'
     and proof.proof_status = 'verification_queued'
     and proof.expires_at <= v_authorized_at
     and app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(
           proof.id,
           recovery.recovery_request_key
         )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_attempts attempt
        where attempt.shadow_proof_request_id = proof.id
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = proof.id
     );

  if candidate_count <> 1 then
    raise exception 'Exactly one expired untouched reviewed source-binding shadow request is required.';
  end if;

  select recovery.* into source_recovery
    from app.private_live_telebirr_source_binding_shadow_recoveries recovery
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = recovery.replacement_shadow_proof_request_id
     and proof.verification_job_id = recovery.replacement_shadow_verification_job_id
    left join app.private_telebirr_shadow_source_binding_window_retries retry
      on retry.source_recovery_request_key = recovery.recovery_request_key
   where retry.retry_request_key is null
     and recovery.reason_code =
         'reviewed_source_binding_source_unavailable_recovery_no_credit'
     and proof.proof_status = 'verification_queued'
     and proof.expires_at <= v_authorized_at
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_attempts attempt
        where attempt.shadow_proof_request_id = proof.id
     )
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = proof.id
     )
   for share of recovery, proof;

  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = source_recovery.replacement_shadow_proof_request_id
     and proof.verification_job_id = source_recovery.replacement_shadow_verification_job_id
   for key share;
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = source_recovery.target_pilot_revision_id
   for share;
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = source_recovery.target_receiver_profile_id
   for share;

  select pilot.* into target_pilot
    from app.feature_switches pilot_switch
    join app.private_live_deposit_pilot_revisions pilot
      on pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
   where pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'dry_run'
     and pilot.status = 'armed'
   for update of pilot;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.pilot_revision_id = target_pilot.id
     and profile.payment_provider_id = source_profile.payment_provider_id
     and profile.receiver_account_id = source_profile.receiver_account_id
     and profile.receiver_account_version = source_profile.receiver_account_version
   for share;

  select pg_catalog.count(*)::integer into ready_enrollment_count
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join app.private_live_telebirr_device_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.reserved_enrollment_id = enrollment.id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = pairing.assignment_signer_id
   where enrollment.pilot_revision_id = target_pilot.id
     and enrollment.receiver_profile_id = target_profile.id
     and pairing.pilot_revision_id = target_pilot.id
     and pairing.receiver_profile_id = target_profile.id
     and pairing.state = 'completed'
     and pairing.completed_at is not null
     and enrollment.valid_from <= v_authorized_at
     and enrollment.valid_until > v_authorized_at + interval '5 minutes'
     and pairing.certificate_valid_from <= v_authorized_at
     and pairing.certificate_valid_until > v_authorized_at + interval '5 minutes'
     and signer.valid_from <= v_authorized_at
     and signer.valid_until > v_authorized_at + interval '5 minutes'
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= v_authorized_at
     )
     and not exists (
       select 1
         from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
          and revocation.revoked_at <= v_authorized_at
     );

  select enrollment.id, signer.id
    into target_enrollment_id, target_signer_id
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
    join app.private_live_telebirr_device_pairing_challenges pairing
      on pairing.pairing_id = certificate.pairing_id
     and pairing.reserved_enrollment_id = enrollment.id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = pairing.assignment_signer_id
   where enrollment.pilot_revision_id = target_pilot.id
     and enrollment.receiver_profile_id = target_profile.id
     and pairing.pilot_revision_id = target_pilot.id
     and pairing.receiver_profile_id = target_profile.id
     and pairing.state = 'completed'
     and enrollment.valid_from <= v_authorized_at
     and enrollment.valid_until > v_authorized_at + interval '5 minutes'
     and pairing.certificate_valid_from <= v_authorized_at
     and pairing.certificate_valid_until > v_authorized_at + interval '5 minutes'
     and signer.valid_from <= v_authorized_at
     and signer.valid_until > v_authorized_at + interval '5 minutes'
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= v_authorized_at
     )
     and not exists (
       select 1
         from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
          and revocation.revoked_at <= v_authorized_at
     )
   for share of enrollment, certificate, pairing, signer;

  select pg_catalog.count(*)::integer into source_attempts
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into source_outcomes
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id;

  if locked_switch_count <> 7
    or source_recovery.recovery_request_key is null
    or source_proof.id is null
    or source_pilot.id is null
    or source_profile.id is null
    or target_pilot.id is null
    or target_profile.id is null
    or ready_enrollment_count <> 1
    or target_enrollment_id is null
    or target_signer_id is null
    or source_attempts <> 0
    or source_outcomes <> 0
    or source_proof.proof_status <> 'verification_queued'
    or source_proof.expires_at > v_authorized_at
    or target_pilot.id = source_pilot.id
    or target_pilot.expires_at is distinct from
       target_pilot.active_from + interval '12 hours'
    or target_pilot.expires_at <= v_authorized_at + interval '11 hours 50 minutes'
    or target_profile.valid_from > v_authorized_at
    or target_profile.valid_until <= v_authorized_at + interval '5 minutes'
    or not app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(
         source_proof.id,
         source_recovery.recovery_request_key
       )
    or not app.private_live_telebirr_shadow_pilot_contract_matches(
         source_pilot.id,
         target_pilot.id
       )
    or not app.private_live_telebirr_shadow_profile_contract_matches(
         source_profile.id,
         target_profile.id
       )
    or not app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
         target_pilot.id,
         target_profile.id,
         target_enrollment_id,
         target_signer_id,
         v_authorized_at + interval '5 minutes'
       )
    or not app.private_telebirr_shadow_source_binding_window_boundary_is_ready(
         target_pilot.id
       )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             source_recovery.source_live_proof_id
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id = source_recovery.source_live_outcome_id
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    ) then
    raise exception 'The expired reviewed source-binding shadow request is not safely retryable.';
  end if;

  v_retry_request_key := pg_catalog.gen_random_uuid();
  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_source_binding_window_retry_digest(
    v_retry_request_key,
    source_recovery.recovery_request_key,
    source_recovery.recovery_request_digest,
    source_proof.id,
    source_proof.verification_job_id,
    replacement_proof_id,
    replacement_job_id,
    source_pilot.id,
    source_profile.id,
    target_pilot.id,
    target_profile.id,
    target_enrollment_id,
    target_signer_id,
    source_attempts,
    source_outcomes,
    v_authorized_at,
    v_retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  insert into app.private_telebirr_shadow_source_binding_window_retries (
    retry_request_key,
    retry_request_digest,
    source_recovery_request_key,
    source_recovery_request_digest,
    source_shadow_proof_request_id,
    source_shadow_verification_job_id,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    source_pilot_revision_id,
    source_receiver_profile_id,
    target_pilot_revision_id,
    target_receiver_profile_id,
    device_enrollment_id,
    assignment_signer_id,
    source_attempt_count,
    source_outcome_count,
    authorized_at,
    retry_expires_at,
    reviewed_main_commit_sha,
    reason_code
  ) values (
    v_retry_request_key,
    retry_digest,
    source_recovery.recovery_request_key,
    source_recovery.recovery_request_digest,
    source_proof.id,
    source_proof.verification_job_id,
    replacement_proof_id,
    replacement_job_id,
    source_pilot.id,
    source_profile.id,
    target_pilot.id,
    target_profile.id,
    target_enrollment_id,
    target_signer_id,
    source_attempts,
    source_outcomes,
    v_authorized_at,
    v_retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_source_binding_window_retry',
    v_retry_request_key::text,
    true
  );
  insert into app.private_telebirr_shadow_proof_requests (
    id,
    verification_job_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    provider_code,
    receiver_profile_id,
    pilot_configuration_digest,
    origin_channel,
    input_kind,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    proof_status,
    submitted_at,
    not_before,
    expires_at,
    created_at,
    source_binding_window_retry_source_id
  ) values (
    replacement_proof_id,
    replacement_job_id,
    target_pilot.id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    source_proof.provider_code,
    target_profile.id,
    target_pilot.configuration_digest,
    source_proof.origin_channel,
    source_proof.input_kind,
    source_proof.candidate_reference_ciphertext,
    source_proof.candidate_reference_fingerprint,
    source_proof.candidate_reference_masked,
    source_proof.reference_encryption_key_version,
    source_proof.reference_profile_version,
    'verification_queued',
    source_proof.submitted_at,
    source_proof.not_before,
    v_retry_until,
    v_authorized_at,
    source_proof.id
  ) returning * into inserted_proof;
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_source_binding_window_retry',
    'off',
    true
  );

  if not app.private_telebirr_shadow_source_binding_window_retry_is_valid(
    inserted_proof.id,
    v_retry_request_key
  ) then
    raise exception 'The source-binding shadow window retry did not validate exactly.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'worker',
    'reviewed-source-binding-shadow-window-retry',
    'deposit.telebirr_source_binding_shadow_window_retried',
    'private_live_deposit_pilot',
    target_pilot.id,
    pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'configured_window_seconds', 43200,
      'source_attempt_count', source_attempts,
      'source_outcome_count', source_outcomes,
      'financial_rows_created', false,
      'execution_enabled', false,
      'money_moved', false
    )
  );

  return query
  select true,
         1,
         1,
         source_attempts,
         source_outcomes,
         0,
         0,
         43200,
         greatest(
           0,
           extract(epoch from (v_retry_until - pg_catalog.clock_timestamp()))::integer
         ),
         false;
end;
$$;

create function app.private_telebirr_shadow_source_binding_window_review_deadline(
  p_shadow_proof_request_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_telebirr_shadow_source_binding_window_retries%rowtype;
begin
  select candidate.* into retry
    from app.private_telebirr_shadow_source_binding_window_retries candidate
   where candidate.replacement_shadow_proof_request_id = p_shadow_proof_request_id;

  if retry.retry_request_key is null
    or not app.private_telebirr_shadow_source_binding_window_retry_is_valid(
      p_shadow_proof_request_id,
      retry.retry_request_key
    ) then
    return null;
  end if;
  return retry.retry_expires_at;
exception
  when others then
    return null;
end;
$$;

-- The authority loader must use the child's new review deadline, while the assessment timestamp
-- remains the immutable original submission time. Preserve all routine metadata across the exact
-- one-fragment rewrite.
do $bind_source_binding_window_retry_deadline$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)'
  );
  old_fragment constant text :=
    '      else proof.submitted_at + interval ''12 hours''';
  new_fragment constant text :=
    '      when proof.source_binding_window_retry_source_id is not null' || pg_catalog.chr(10)
    || '        then app.private_telebirr_shadow_source_binding_window_review_deadline('
    || pg_catalog.chr(10)
    || '          proof.id' || pg_catalog.chr(10)
    || '        )' || pg_catalog.chr(10)
    || old_fragment;
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.pronargs = 3
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The TeleBirr shadow authority review deadline changed shape.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The TeleBirr shadow authority deadline rewrite changed its authority.';
  end if;
end;
$bind_source_binding_window_retry_deadline$;

-- Keep the global evidence loader's newest-attempt preference for the new append-only child.
do $prefer_latest_source_binding_window_retry_evidence$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  old_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null'
    || ' and proof.observation_clock_retry_source_id is null'
    || ' and proof.authority_deadline_retry_source_id is null'
    || ' and proof.assessment_clock_retry_source_id is null)';
  new_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null'
    || ' and proof.observation_clock_retry_source_id is null'
    || ' and proof.authority_deadline_retry_source_id is null'
    || ' and proof.assessment_clock_retry_source_id is null'
    || ' and proof.source_binding_window_retry_source_id is null)';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The TeleBirr staged-evidence retry ordering changed shape.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The staged-evidence retry ordering rewrite changed its authority.';
  end if;
end;
$prefer_latest_source_binding_window_retry_evidence$;

alter table app.private_telebirr_shadow_source_binding_window_retries
  enable row level security;
alter table app.private_telebirr_shadow_source_binding_window_retries
  force row level security;
alter table app.private_telebirr_shadow_source_binding_window_retries
  owner to postgres;

alter function
  app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(uuid, uuid)
  owner to postgres;
alter function app.private_telebirr_shadow_source_binding_window_retry_digest(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  uuid, uuid, integer, integer, timestamptz, timestamptz, text, text
) owner to postgres;
alter function app.private_live_telebirr_shadow_pilot_contract_matches(uuid, uuid)
  owner to postgres;
alter function app.private_live_telebirr_shadow_profile_contract_matches(uuid, uuid)
  owner to postgres;
alter function app.private_telebirr_shadow_source_binding_window_boundary_is_ready(uuid)
  owner to postgres;
alter function app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
  uuid, uuid, uuid, uuid, timestamptz
) owner to postgres;
alter function app.private_telebirr_shadow_source_binding_window_retry_is_valid(uuid, uuid)
  owner to postgres;
alter function app.guard_private_telebirr_shadow_source_binding_window_retry_insert()
  owner to postgres;
alter function app.retry_reviewed_private_telebirr_source_binding_shadow_window(text, text)
  owner to postgres;
alter function app.private_telebirr_shadow_source_binding_window_review_deadline(uuid)
  owner to postgres;

revoke all privileges on table
  app.private_telebirr_shadow_source_binding_window_retries
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(uuid, uuid),
  app.private_telebirr_shadow_source_binding_window_retry_digest(
    uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
    uuid, uuid, integer, integer, timestamptz, timestamptz, text, text
  ),
  app.private_live_telebirr_shadow_pilot_contract_matches(uuid, uuid),
  app.private_live_telebirr_shadow_profile_contract_matches(uuid, uuid),
  app.private_telebirr_shadow_source_binding_window_boundary_is_ready(uuid),
  app.private_telebirr_shadow_source_binding_window_enrollment_is_ready(
    uuid, uuid, uuid, uuid, timestamptz
  ),
  app.private_telebirr_shadow_source_binding_window_retry_is_valid(uuid, uuid),
  app.guard_private_telebirr_shadow_source_binding_window_retry_insert(),
  app.retry_reviewed_private_telebirr_source_binding_shadow_window(text, text),
  app.private_telebirr_shadow_source_binding_window_review_deadline(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

comment on column
  app.private_telebirr_shadow_proof_requests.source_binding_window_retry_source_id is
  'Immutable expired untouched reviewed source-binding shadow proof that authorized this single append-only no-money child.';
comment on table app.private_telebirr_shadow_source_binding_window_retries is
  'Immutable one-use ledger from the expired untouched reviewed source-binding shadow request to one paired-device, twelve-hour, review-only child. It grants no financial authority.';
comment on function
  app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(uuid, uuid) is
  'Validates the immutable historical reviewed source-binding shadow recovery without reviving its expired lease or granting current authority.';
comment on function app.retry_reviewed_private_telebirr_source_binding_shadow_window(
  text, text
) is
  'Postgres-only, idempotent creation of one append-only twelve-hour no-money child from the unique expired untouched reviewed source-binding shadow request, exact fresh dry-run pilot, and paired Android verifier.';
comment on function app.private_telebirr_shadow_source_binding_window_retry_is_valid(
  uuid, uuid
) is
  'Validates the complete immutable source-binding shadow-window retry lineage, paired verifier, and current no-money boundary without exposing protected identifiers.';
comment on function app.private_telebirr_shadow_source_binding_window_review_deadline(uuid) is
  'Returns the current review deadline only for a valid paired, no-money source-binding window retry child.';
comment on function app.load_private_telebirr_shadow_verification_authority(
  uuid, uuid, timestamptz
) is
  'Loads current no-money shadow authority while retaining the original assessment submission clock and honoring independently validated append-only recovery deadlines.';
comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads immutable staged evidence inside its reviewed no-money window and selects only the newest eligible attempt for every append-only retry branch.';
comment on index app.private_tbirr_shadow_original_provider_reference_uidx is
  'Preserves global provider/reference uniqueness for original shadow intake while separately ledger-bound no-money retry children are permitted.';

commit;
