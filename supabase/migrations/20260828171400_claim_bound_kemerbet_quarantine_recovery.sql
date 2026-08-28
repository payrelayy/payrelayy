-- Claim-bound, idempotent Owner recovery for one quarantined KemerBet agent profile.
--
-- This migration only rotates an opaque browser-profile identity after the exact no-transfer
-- readiness claim has entered the approved recovery path. It never accepts or stores a username,
-- password, OTP, cookie, Player ID, browser session, amount, or transfer instruction. Every money
-- switch must remain disabled and no private live-money pilot may be open.

begin;

create table app.private_owner_kemerbet_quarantine_recoveries (
  recovery_request_id uuid primary key,
  claim_id uuid not null unique
    references app.private_owner_kemerbet_readiness_cohort_claims (id) on delete restrict,
  actor_admin_id uuid not null,
  terminal_receipt_id uuid not null unique
    references app.private_owner_kemerbet_readiness_cohort_receipts (receipt_id) on delete restrict,
  quarantined_platform_agent_account_id uuid not null unique
    references app.platform_agent_accounts (id) on delete restrict,
  quarantined_profile_revision integer not null check (quarantined_profile_revision > 0),
  recovered_platform_agent_account_id uuid not null unique
    references app.platform_agent_accounts (id) on delete restrict,
  recovered_profile_revision integer not null check (recovered_profile_revision > 0),
  recovered_profile_configuration_request_id uuid not null unique,
  recovered_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint kemerbet_quarantine_recovery_binding_key
    unique (recovery_request_id, claim_id, actor_admin_id),
  constraint private_owner_kemerbet_quarantine_recoveries_request_v4_check check (
    recovery_request_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_owner_kemerbet_quarantine_recoveries_claim_v4_check check (
    claim_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_owner_kemerbet_quarantine_recoveries_receipt_v4_check check (
    terminal_receipt_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint kemerbet_quarantine_recovery_profile_request_v4_check check (
    recovered_profile_configuration_request_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint kemerbet_quarantine_recovery_freshness_check check (
    recovered_platform_agent_account_id <> quarantined_platform_agent_account_id
    and recovered_profile_revision > quarantined_profile_revision
  ),
  constraint kemerbet_quarantine_recovery_namespace_check check (
    recovery_request_id <> terminal_receipt_id
    and recovered_profile_configuration_request_id <> recovery_request_id
    and recovered_profile_configuration_request_id <> terminal_receipt_id
  )
);

create table app.private_owner_kemerbet_quarantine_recovery_requests (
  request_id uuid primary key,
  canonical_recovery_request_id uuid not null,
  claim_id uuid not null,
  actor_admin_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint kemerbet_quarantine_recovery_request_v4_check check (
    request_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint kemerbet_quarantine_recovery_request_binding_fkey
    foreign key (canonical_recovery_request_id, claim_id, actor_admin_id)
    references app.private_owner_kemerbet_quarantine_recoveries (
      recovery_request_id,
      claim_id,
      actor_admin_id
    )
    on delete restrict
);

create trigger private_owner_kemerbet_quarantine_recoveries_immutable
before update or delete on app.private_owner_kemerbet_quarantine_recoveries
for each row
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_quarantine_recoveries_no_truncate
before truncate on app.private_owner_kemerbet_quarantine_recoveries
for each statement
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_quarantine_recovery_requests_immutable
before update or delete on app.private_owner_kemerbet_quarantine_recovery_requests
for each row
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_quarantine_recovery_requests_no_truncate
before truncate on app.private_owner_kemerbet_quarantine_recovery_requests
for each statement
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

-- The older general profile-preparation RPC is intentionally still available for ordinary Owner
-- corrections and rotations. It must not be usable as a second, unbound security-recovery path.
-- Deferring this assertion lets the dedicated recovery RPC create the profile before its immutable
-- canonical ledger row in the same transaction, while every standalone security-recovery insert
-- fails atomically at commit.
create function app.require_claim_bound_kemerbet_security_recovery_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  exact_binding_count integer;
begin
  if new.configuration_reason <> 'security_recovery' then
    return null;
  end if;

  select count(*)::integer
    into exact_binding_count
    from app.private_owner_kemerbet_quarantine_recoveries recovery
    join app.private_owner_kemerbet_readiness_cohort_receipts receipt
      on receipt.receipt_id = recovery.terminal_receipt_id
     and receipt.claim_id = recovery.claim_id
     and receipt.receipt_event = 'failed_terminal'
     and receipt.terminal_failure_code = 'recovery_failed_cleanup_confirmed'
   where recovery.recovered_platform_agent_account_id = new.platform_agent_account_id
     and recovery.recovered_profile_revision = new.revision
     and recovery.recovered_profile_configuration_request_id = new.configuration_request_id
     and recovery.actor_admin_id = new.configured_by_admin_id
     and recovery.recovered_at = new.configured_at;

  if exact_binding_count <> 1 then
    raise exception 'A KemerBet security-recovery profile requires one exact claim-bound recovery.';
  end if;
  return null;
end;
$$;

create constraint trigger private_owner_kemerbet_security_recovery_claim_binding
after insert on app.private_owner_kemerbet_agent_profile_revisions
deferrable initially deferred
for each row
execute function app.require_claim_bound_kemerbet_security_recovery_profile();

create function app.recover_owner_kemerbet_quarantined_agent_profile(
  p_actor_auth_user_id uuid,
  p_claim_id uuid,
  p_recovery_request_id uuid
)
returns table (
  recovery_request_id uuid,
  recovered_claim_id uuid,
  terminal_receipt_id uuid,
  terminal_receipt_recorded_at timestamptz,
  quarantined_platform_agent_account_id uuid,
  quarantined_profile_revision integer,
  platform_agent_account_id uuid,
  platform_code text,
  profile_label text,
  profile_revision integer,
  profile_status text,
  configured_at timestamptz,
  retired_at timestamptz,
  configuration_reason text,
  profile_contract_version smallint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  existing_request app.private_owner_kemerbet_quarantine_recovery_requests%rowtype;
  existing_recovery app.private_owner_kemerbet_quarantine_recoveries%rowtype;
  locked_claim app.private_owner_kemerbet_readiness_cohort_claims%rowtype;
  kemerbet_platform app.platforms%rowtype;
  quarantined_agent_id uuid;
  quarantined_revision integer;
  terminal_recorded_receipt_id uuid;
  terminal_recorded_claim_id uuid;
  terminal_recorded_claim_state text;
  terminal_recorded_receipt_event text;
  terminal_recorded_at timestamptz;
  recovered_agent_id uuid;
  recovered_configuration_request_id uuid;
  recovered_revision integer;
  recovery_time timestamptz;
  affected_rows integer;
begin
  perform app.require_owner_kemerbet_readiness_cohort_controller();
  perform app.require_owner_kemerbet_agent_profile_controller();

  if p_actor_auth_user_id is null
    or p_claim_id is null
    or p_recovery_request_id is null
    or p_claim_id::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_recovery_request_id::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The claim-bound KemerBet quarantine recovery request is invalid.';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  -- This gate is also acquired by every protected readiness/profile source mutation. Holding it
  -- first makes the claim terminalization, exact-current-profile capture, and rotation one atomic
  -- serializable application operation without accepting a browser-supplied profile identity.
  perform 1
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;
  if not found then
    raise exception 'The private KemerBet readiness serialization gate is unavailable.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for update;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can recover a quarantined KemerBet agent profile.';
  end if;

  select request.*
    into existing_request
    from app.private_owner_kemerbet_quarantine_recovery_requests request
   where request.request_id = p_recovery_request_id;

  if existing_request.request_id is not null then
    if existing_request.claim_id <> p_claim_id
      or existing_request.actor_admin_id <> actor_admin_id then
      raise exception 'The KemerBet quarantine recovery request conflicts with its original binding.';
    end if;
    select recovery.*
      into existing_recovery
      from app.private_owner_kemerbet_quarantine_recoveries recovery
     where recovery.recovery_request_id = existing_request.canonical_recovery_request_id;
    if existing_recovery.recovery_request_id is null
      or existing_recovery.claim_id <> p_claim_id
      or existing_recovery.actor_admin_id <> actor_admin_id then
      raise exception 'The recorded KemerBet quarantine recovery request is incomplete.';
    end if;
  else
    select recovery.*
      into existing_recovery
      from app.private_owner_kemerbet_quarantine_recoveries recovery
     where recovery.claim_id = p_claim_id;
    if existing_recovery.recovery_request_id is not null then
      if existing_recovery.actor_admin_id <> actor_admin_id then
        raise exception 'The exact KemerBet readiness claim is bound to another Owner recovery.';
      end if;
      insert into app.private_owner_kemerbet_quarantine_recovery_requests (
        request_id,
        canonical_recovery_request_id,
        claim_id,
        actor_admin_id
      ) values (
        p_recovery_request_id,
        existing_recovery.recovery_request_id,
        existing_recovery.claim_id,
        existing_recovery.actor_admin_id
      );
    end if;
  end if;

  if existing_recovery.recovery_request_id is not null then
    perform app.require_private_owner_kemerbet_readiness_safe_boundary();
    return query
    select p_recovery_request_id,
           existing_recovery.claim_id,
           existing_recovery.terminal_receipt_id,
           receipt.recorded_at,
           existing_recovery.quarantined_platform_agent_account_id,
           existing_recovery.quarantined_profile_revision,
           agent.id,
           platform.code,
           agent.label,
           profile.revision,
           agent.status::text,
           profile.configured_at,
           profile.retired_at,
           profile.configuration_reason,
           profile.profile_contract_version
      from app.private_owner_kemerbet_readiness_cohort_receipts receipt
      join app.platform_agent_accounts agent
        on agent.id = existing_recovery.recovered_platform_agent_account_id
      join app.platforms platform on platform.id = agent.platform_id
      join app.private_owner_kemerbet_agent_profile_revisions profile
        on profile.platform_agent_account_id = agent.id
      join app.private_owner_kemerbet_agent_profile_revisions quarantined_profile
        on quarantined_profile.platform_agent_account_id
          = existing_recovery.quarantined_platform_agent_account_id
     where receipt.receipt_id = existing_recovery.terminal_receipt_id
       and receipt.claim_id = existing_recovery.claim_id
       and receipt.receipt_event = 'failed_terminal'
       and receipt.terminal_failure_code = 'recovery_failed_cleanup_confirmed'
       and platform.code = 'kemerbet'
       and profile.revision = existing_recovery.recovered_profile_revision
       and profile.configuration_request_id
         = existing_recovery.recovered_profile_configuration_request_id
       and profile.configuration_reason = 'security_recovery'
       and profile.profile_contract_version = 1
       and profile.configured_by_admin_id = existing_recovery.actor_admin_id
       and profile.configured_at = existing_recovery.recovered_at
       and profile.retired_at is null
       and agent.status = 'active'
       and quarantined_profile.revision = existing_recovery.quarantined_profile_revision
       and quarantined_profile.retired_at = existing_recovery.recovered_at
       and agent.id <> existing_recovery.quarantined_platform_agent_account_id
       and profile.revision > existing_recovery.quarantined_profile_revision;
    if not found then
      raise exception 'The recorded KemerBet quarantine recovery is incomplete.';
    end if;
    return;
  end if;

  select claim.*
    into locked_claim
    from app.private_owner_kemerbet_readiness_cohort_claims claim
   where claim.id = p_claim_id
   for update;
  if locked_claim.id is null
    or locked_claim.actor_admin_id <> actor_admin_id then
    raise exception 'The exact Owner KemerBet readiness claim is unavailable for recovery.';
  end if;
  if locked_claim.claim_state not in ('prepared', 'exported', 'imported', 'failed_terminal')
    or (
      locked_claim.claim_state = 'failed_terminal'
      and locked_claim.terminal_failure_code is distinct from 'recovery_failed_cleanup_confirmed'
    ) then
    raise exception 'The exact Owner KemerBet readiness claim is not in the approved recovery state.';
  end if;

  -- This revalidates all five disabled money switches, the absence of an open live-money pilot,
  -- and exactly one active non-retired KemerBet profile while the shared gate is held.
  perform app.require_private_owner_kemerbet_readiness_safe_boundary();

  select platform.*
    into kemerbet_platform
    from app.platforms platform
   where platform.code = 'kemerbet'
     and platform.status = 'active'
   for update;
  if kemerbet_platform.id is null then
    raise exception 'The active KemerBet platform is unavailable for quarantine recovery.';
  end if;

  select agent.id,
         profile.revision
    into quarantined_agent_id,
         quarantined_revision
    from app.platform_agent_accounts agent
    join app.private_owner_kemerbet_agent_profile_revisions profile
      on profile.platform_id = agent.platform_id
     and profile.platform_agent_account_id = agent.id
   where agent.platform_id = kemerbet_platform.id
     and agent.status = 'active'
     and profile.retired_at is null
     and profile.profile_contract_version = 1
   for update of agent, profile;
  if quarantined_agent_id is null or quarantined_revision is null then
    raise exception 'The exact active KemerBet profile could not be quarantined.';
  end if;

  select coalesce(max(profile.revision), 0) + 1
    into recovered_revision
    from app.private_owner_kemerbet_agent_profile_revisions profile
   where profile.platform_id = kemerbet_platform.id;
  if recovered_revision <= quarantined_revision then
    raise exception 'The recovered KemerBet profile revision is not fresh.';
  end if;

  select receipt.recorded_receipt_id,
         receipt.recorded_claim_id,
         receipt.recorded_claim_state,
         receipt.recorded_receipt_event,
         receipt.recorded_at
    into terminal_recorded_receipt_id,
         terminal_recorded_claim_id,
         terminal_recorded_claim_state,
         terminal_recorded_receipt_event,
         terminal_recorded_at
    from app.record_owner_kemerbet_readiness_cohort_root_receipt(
      p_claim_id,
      gen_random_uuid(),
      'failed_terminal',
      'recovery_failed_cleanup_confirmed'
    ) receipt;
  if terminal_recorded_receipt_id is null
    or terminal_recorded_claim_id <> p_claim_id
    or terminal_recorded_claim_state <> 'failed_terminal'
    or terminal_recorded_receipt_event <> 'failed_terminal' then
    raise exception 'The exact KemerBet readiness claim was not terminalized for recovery.';
  end if;

  recovery_time := clock_timestamp();
  recovered_agent_id := gen_random_uuid();
  recovered_configuration_request_id := gen_random_uuid();
  if recovered_agent_id = quarantined_agent_id then
    raise exception 'The recovered KemerBet profile identity is not fresh.';
  end if;

  update app.private_owner_kemerbet_agent_profile_revisions profile
     set retired_at = recovery_time
   where profile.platform_agent_account_id = quarantined_agent_id
     and profile.revision = quarantined_revision
     and profile.retired_at is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'The quarantined KemerBet profile retirement was not exact.';
  end if;

  update app.platform_agent_accounts agent
     set status = 'inactive'
   where agent.id = quarantined_agent_id
     and agent.platform_id = kemerbet_platform.id
     and agent.status = 'active';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'The quarantined KemerBet agent-account retirement was not exact.';
  end if;

  insert into app.platform_agent_accounts (
    id,
    platform_id,
    label,
    credential_ref,
    status,
    created_at,
    updated_at
  ) values (
    recovered_agent_id,
    kemerbet_platform.id,
    'Primary KemerBet agent revision ' || recovered_revision::text,
    'kemerbet-browser-profile-v1:' || recovered_agent_id::text,
    'active',
    recovery_time,
    recovery_time
  );

  insert into app.private_owner_kemerbet_agent_profile_revisions (
    platform_id,
    platform_agent_account_id,
    revision,
    configuration_request_id,
    configuration_reason,
    configured_by_admin_id,
    profile_contract_version,
    configured_at
  ) values (
    kemerbet_platform.id,
    recovered_agent_id,
    recovered_revision,
    recovered_configuration_request_id,
    'security_recovery',
    actor_admin_id,
    1,
    recovery_time
  );

  insert into app.private_owner_kemerbet_quarantine_recoveries (
    recovery_request_id,
    claim_id,
    actor_admin_id,
    terminal_receipt_id,
    quarantined_platform_agent_account_id,
    quarantined_profile_revision,
    recovered_platform_agent_account_id,
    recovered_profile_revision,
    recovered_profile_configuration_request_id,
    recovered_at
  ) values (
    p_recovery_request_id,
    p_claim_id,
    actor_admin_id,
    terminal_recorded_receipt_id,
    quarantined_agent_id,
    quarantined_revision,
    recovered_agent_id,
    recovered_revision,
    recovered_configuration_request_id,
    recovery_time
  ) returning * into existing_recovery;

  insert into app.private_owner_kemerbet_quarantine_recovery_requests (
    request_id,
    canonical_recovery_request_id,
    claim_id,
    actor_admin_id
  ) values (
    p_recovery_request_id,
    existing_recovery.recovery_request_id,
    existing_recovery.claim_id,
    existing_recovery.actor_admin_id
  );

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'admin',
    actor_admin_id,
    'configuration.kemerbet_quarantined_agent_profile_recovered',
    'platform_agent_account',
    recovered_agent_id,
    jsonb_build_object(
      'contract_version', 1,
      'claim_id', p_claim_id,
      'terminal_receipt_id', terminal_recorded_receipt_id,
      'quarantined_profile_id', quarantined_agent_id,
      'quarantined_profile_revision', quarantined_revision,
      'recovered_profile_revision', recovered_revision,
      'configuration_reason', 'security_recovery',
      'transfer_disabled', true,
      'money_moved', false,
      'identifiers_redacted', true
    )
  );

  return query
  select p_recovery_request_id,
         existing_recovery.claim_id,
         existing_recovery.terminal_receipt_id,
         terminal_recorded_at,
         existing_recovery.quarantined_platform_agent_account_id,
         existing_recovery.quarantined_profile_revision,
         agent.id,
         platform.code,
         agent.label,
         profile.revision,
         agent.status::text,
         profile.configured_at,
         profile.retired_at,
         profile.configuration_reason,
         profile.profile_contract_version
    from app.platform_agent_accounts agent
    join app.platforms platform on platform.id = agent.platform_id
    join app.private_owner_kemerbet_agent_profile_revisions profile
      on profile.platform_agent_account_id = agent.id
   where agent.id = existing_recovery.recovered_platform_agent_account_id
     and platform.code = 'kemerbet'
     and profile.revision = existing_recovery.recovered_profile_revision
     and profile.configuration_request_id
       = existing_recovery.recovered_profile_configuration_request_id
     and profile.configuration_reason = 'security_recovery'
     and profile.profile_contract_version = 1
     and profile.configured_by_admin_id = existing_recovery.actor_admin_id
     and profile.configured_at = existing_recovery.recovered_at
     and agent.status = 'active'
     and profile.retired_at is null
     and agent.id <> existing_recovery.quarantined_platform_agent_account_id
     and profile.revision > existing_recovery.quarantined_profile_revision;
  if not found then
    raise exception 'The fresh KemerBet quarantine recovery profile is unavailable.';
  end if;
end;
$$;

alter table app.private_owner_kemerbet_quarantine_recoveries enable row level security;
alter table app.private_owner_kemerbet_quarantine_recoveries force row level security;
alter table app.private_owner_kemerbet_quarantine_recovery_requests enable row level security;
alter table app.private_owner_kemerbet_quarantine_recovery_requests force row level security;
alter table app.private_owner_kemerbet_quarantine_recoveries owner to postgres;
alter table app.private_owner_kemerbet_quarantine_recovery_requests owner to postgres;
alter function app.require_claim_bound_kemerbet_security_recovery_profile() owner to postgres;
alter function app.recover_owner_kemerbet_quarantined_agent_profile(uuid, uuid, uuid)
  owner to postgres;

revoke all on table
  app.private_owner_kemerbet_quarantine_recoveries,
  app.private_owner_kemerbet_quarantine_recovery_requests
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

revoke all on function
  app.require_claim_bound_kemerbet_security_recovery_profile(),
  app.recover_owner_kemerbet_quarantined_agent_profile(uuid, uuid, uuid)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

grant usage on schema app to fetanagent_owner_control;
grant execute on function
  app.recover_owner_kemerbet_quarantined_agent_profile(uuid, uuid, uuid)
to fetanagent_owner_control;

comment on table app.private_owner_kemerbet_quarantine_recoveries is
  'Private immutable claim-canonical recovery ledger binding one exact quarantined KemerBet profile to exactly one strictly newer opaque security-recovery profile. Contains no Player identifiers, credentials, browser session material, amount, or transfer instruction.';
comment on table app.private_owner_kemerbet_quarantine_recovery_requests is
  'Private immutable retry-idempotency aliases. Every caller request UUID binds to one canonical claim recovery; a fresh request after a lost response replays the same recovered profile and can never create another revision.';
comment on function app.require_claim_bound_kemerbet_security_recovery_profile() is
  'Deferred fail-closed invariant: every newly inserted security-recovery KemerBet profile must match exactly one immutable claim-bound quarantine-recovery ledger row and terminal cleanup receipt.';
comment on function app.recover_owner_kemerbet_quarantined_agent_profile(uuid, uuid, uuid) is
  'Authenticated Owner-only claim-bound quarantine recovery. Under the readiness singleton gate it terminalizes or replays the exact approved claim receipt, captures and retires the exact current opaque KemerBet profile, and creates or replays exactly one different, strictly newer security-recovery profile. Requires every money switch disabled and never moves money or contacts KemerBet.';

commit;
