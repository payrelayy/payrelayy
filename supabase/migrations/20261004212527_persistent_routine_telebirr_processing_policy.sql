-- Persistent business authorization for routine TeleBirr processing, not an execution activation.
-- The fixed-pilot / v2 / one-job Owner gates are deliberately unchanged. No worker receives these
-- private admission functions, and saving this policy never starts an operator or permits Transfer.
begin;

create table app.routine_telebirr_processing_authorizations (
  id uuid primary key default gen_random_uuid(),
  revision bigint generated always as identity unique,
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  deposit_policy_version_id uuid not null
    references app.deposit_policy_versions (id) on delete restrict,
  authorized_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  authorized_at timestamptz not null default clock_timestamp(),
  contract_version integer not null default 1 check (contract_version = 1),
  provider_code text not null default 'telebirr' check (provider_code = 'telebirr'),
  platform_code text not null default 'kemerbet' check (platform_code = 'kemerbet'),
  currency_code text not null default 'ETB' check (currency_code = 'ETB'),
  minimum_amount_minor bigint not null default 2500 check (minimum_amount_minor = 2500),
  maximum_amount_minor bigint not null default 2500000 check (maximum_amount_minor = 2500000),
  freshness_window_seconds integer not null default 3600 check (freshness_window_seconds = 3600),
  player_scope text not null default 'all_active_deposit_eligible'
    check (player_scope = 'all_active_deposit_eligible'),
  player_ownership_required boolean not null default false check (not player_ownership_required),
  daily_quota_minor bigint check (daily_quota_minor is null),
  successful_deposit_quota bigint check (successful_deposit_quota is null),
  max_concurrent_deposits integer not null default 1 check (max_concurrent_deposits = 1),
  amount_source text not null default 'official_receipt_settled_amount'
    check (amount_source = 'official_receipt_settled_amount')
);

-- An append-only stop is persistent too. Replaying an old authorize request must not undo it.
create table app.routine_telebirr_processing_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  request_key uuid not null unique,
  authorization_id uuid references app.routine_telebirr_processing_authorizations (id)
    on delete restrict,
  event_kind text not null check (event_kind in ('authorize', 'stop')),
  actor_admin_id uuid not null references app.admin_users (id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  check (event_kind <> 'authorize' or authorization_id is not null)
);

alter table app.deposit_payment_claims
  add constraint deposit_payment_claims_id_intent_key unique (id, deposit_intent_id);
create table app.routine_telebirr_execution_bindings (
  execution_job_id uuid primary key,
  deposit_intent_id uuid not null unique references app.deposit_intents (id) on delete restrict,
  deposit_payment_claim_id uuid not null unique
    references app.deposit_payment_claims (id) on delete restrict,
  authorization_id uuid not null references app.routine_telebirr_processing_authorizations (id)
    on delete restrict,
  admitted_at timestamptz not null default clock_timestamp(),
  foreign key (execution_job_id, deposit_intent_id)
    references app.deposit_jobs (id, deposit_intent_id) on delete restrict,
  foreign key (deposit_payment_claim_id, deposit_intent_id)
    references app.deposit_payment_claims (id, deposit_intent_id) on delete restrict
);
create index routine_telebirr_execution_bindings_authorization_idx
  on app.routine_telebirr_execution_bindings (authorization_id, admitted_at, execution_job_id);

do $retain_ledgers$
declare
  ledger text;
begin
  foreach ledger in array array[
    'routine_telebirr_processing_authorizations', 'routine_telebirr_processing_events',
    'routine_telebirr_execution_bindings'
  ] loop
    execute format('alter table app.%I enable row level security', ledger);
    execute format('alter table app.%I force row level security', ledger);
    execute format('alter table app.%I owner to postgres', ledger);
    execute format('create trigger %I before update or delete on app.%I for each row '
      'execute function app.reject_deposit_ledger_delete()', ledger || '_immutable', ledger);
    execute format('create trigger %I before truncate on app.%I for each statement '
      'execute function app.reject_execution_ledger_truncate()', ledger || '_no_truncate', ledger);
    execute format('revoke all on app.%I from public, anon, authenticated, service_role, '
      'fetanagent_owner_control, fetanagent_owner_control_runtime, '
      'fetanagent_deposit_executor, fetanagent_deposit_executor_runtime, '
      'fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime', ledger);
  end loop;
end;
$retain_ledgers$;

create function app.require_routine_telebirr_owner(p_actor_auth_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  if p_actor_auth_user_id is null or not pg_catalog.pg_has_role(
    session_user, 'fetanagent_owner_control', 'member'
  ) then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;
  select owner_user.id into actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
    for share;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;
  return actor_id;
end;
$$;

create function app.routine_telebirr_processing_policy_json(p_authorization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'mode', 'routine_production', 'version', authority.contract_version,
    'provider', authority.provider_code, 'platformCode', authority.platform_code,
    'currencyCode', authority.currency_code,
    'minimumAmountMinor', authority.minimum_amount_minor,
    'maximumAmountMinor', authority.maximum_amount_minor,
    'freshnessWindowSeconds', authority.freshness_window_seconds,
    'playerScope', authority.player_scope,
    'playerOwnershipRequired', authority.player_ownership_required,
    'dailyQuotaMinor', authority.daily_quota_minor,
    'successfulDepositQuota', authority.successful_deposit_quota,
    'maxConcurrentDeposits', authority.max_concurrent_deposits,
    'amountSource', authority.amount_source
  ) from app.routine_telebirr_processing_authorizations authority
    where authority.id = p_authorization_id;
$$;

create function app.get_owner_routine_telebirr_processing(p_actor_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest app.routine_telebirr_processing_events%rowtype;
  authority app.routine_telebirr_processing_authorizations%rowtype;
begin
  perform app.require_routine_telebirr_owner(p_actor_auth_user_id);
  select event.* into latest from app.routine_telebirr_processing_events event
    order by event.event_sequence desc limit 1;
  select saved.* into authority from app.routine_telebirr_processing_authorizations saved
    where saved.id = latest.authorization_id;
  return pg_catalog.jsonb_build_object(
    'configurationState', case when latest.id is null then 'not_configured'
      when latest.event_kind = 'authorize' then 'authorized' else 'stopped' end,
    -- This release has no routine execution activation procedure or runtime grant.
    'executionEnabled', false,
    'authorizationId', authority.id, 'revision', authority.revision::text,
    'platformAgentAccountId', authority.platform_agent_account_id,
    'authorizedAt', authority.authorized_at, 'changedAt', latest.recorded_at,
    'policy', app.routine_telebirr_processing_policy_json(authority.id)
  );
end;
$$;

create function app.save_owner_routine_telebirr_processing(
  p_actor_auth_user_id uuid, p_platform_agent_account_id uuid, p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  policy_id uuid;
  authority_id uuid;
  previous app.routine_telebirr_processing_events%rowtype;
begin
  actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);
  if p_platform_agent_account_id is null or p_request_key is null
    or p_request_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'The routine policy request is invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004)
  );
  select event.* into previous from app.routine_telebirr_processing_events event
    where event.request_key = p_request_key;
  if previous.id is not null then
    if previous.actor_admin_id <> actor_id or previous.event_kind <> 'authorize'
      or not exists (
        select 1 from app.routine_telebirr_processing_authorizations authority
          where authority.id = previous.authorization_id
            and authority.platform_agent_account_id = p_platform_agent_account_id
      ) then
      raise exception 'The routine policy request key has already been used.';
    end if;
    -- Return current state, never reactivate the historical authorization on replay.
    return app.get_owner_routine_telebirr_processing(p_actor_auth_user_id);
  end if;
  perform agent.id from app.platform_agent_accounts agent
    join app.platforms platform on platform.id = agent.platform_id
    where agent.id = p_platform_agent_account_id and agent.status = 'active'
      and platform.code = 'kemerbet' and platform.status = 'active'
    for share of agent, platform;
  if not found then raise exception 'The active KemerBet agent is required.'; end if;
  select policy.id into policy_id from app.deposit_policy_versions policy
    where policy.status = 'active' and policy.minimum_amount_minor = 2500
      and policy.maximum_amount_minor = 2500000 and policy.freshness_window_seconds = 3600
    for share;
  if policy_id is null then raise exception 'The documented deposit policy is required.'; end if;
  select authority.id into authority_id from app.routine_telebirr_processing_events event
    join app.routine_telebirr_processing_authorizations authority on authority.id = event.authorization_id
    where event.event_sequence = (
      select pg_catalog.max(latest.event_sequence) from app.routine_telebirr_processing_events latest
    ) and event.event_kind = 'authorize'
      and authority.platform_agent_account_id = p_platform_agent_account_id
      and authority.deposit_policy_version_id = policy_id and authority.authorized_by_admin_id = actor_id;
  if authority_id is null then
    if exists (
      select 1 from app.routine_telebirr_execution_bindings binding
        join app.deposit_jobs job on job.id = binding.execution_job_id
        join app.deposit_intents intent on intent.id = binding.deposit_intent_id
        where intent.status not in ('executed', 'rejected', 'cancelled')
          or job.status in ('queued', 'leased', 'retry_wait')
    ) then raise exception 'Resolve existing routine deposits before replacing their policy.'; end if;
    insert into app.routine_telebirr_processing_authorizations (
      platform_agent_account_id, deposit_policy_version_id, authorized_by_admin_id
    ) values (p_platform_agent_account_id, policy_id, actor_id) returning id into authority_id;
  end if;
  insert into app.routine_telebirr_processing_events (
    request_key, authorization_id, event_kind, actor_admin_id
  ) values (p_request_key, authority_id, 'authorize', actor_id);
  return app.get_owner_routine_telebirr_processing(p_actor_auth_user_id);
end;
$$;

create function app.stop_owner_routine_telebirr_processing(
  p_actor_auth_user_id uuid, p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  authority_id uuid;
  previous app.routine_telebirr_processing_events%rowtype;
begin
  actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);
  if p_request_key is null
    or p_request_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'The routine stop request is invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004)
  );
  select event.* into previous from app.routine_telebirr_processing_events event
    where event.request_key = p_request_key;
  if previous.id is not null then
    if previous.actor_admin_id <> actor_id or previous.event_kind <> 'stop' then
      raise exception 'The routine policy request key has already been used.';
    end if;
    return app.get_owner_routine_telebirr_processing(p_actor_auth_user_id);
  end if;
  select event.authorization_id into authority_id from app.routine_telebirr_processing_events event
    order by event.event_sequence desc limit 1;
  insert into app.routine_telebirr_processing_events (
    request_key, authorization_id, event_kind, actor_admin_id
  ) values (p_request_key, authority_id, 'stop', actor_id);
  return app.get_owner_routine_telebirr_processing(p_actor_auth_user_id);
end;
$$;

-- Internal readiness/admission only. No lease, final-action fence, state transition, provider
-- request, reconciliation assertion or credit can be obtained from this projection.
create function app.assess_routine_telebirr_execution_job(p_execution_job_id uuid)
returns table (
  authorization_id uuid, platform_agent_account_id uuid, deposit_intent_id uuid,
  deposit_payment_claim_id uuid, player_id text, amount_minor bigint, currency_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select authority.id, authority.platform_agent_account_id, intent.id, claim.id,
    player.player_id, evidence.amount_minor, evidence.currency_code::text
  from app.routine_telebirr_processing_events event
  join app.routine_telebirr_processing_authorizations authority on authority.id = event.authorization_id
  join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    and owner_user.role = 'owner' and owner_user.status = 'active'
  join app.platform_agent_accounts agent on agent.id = authority.platform_agent_account_id
    and agent.status = 'active'
  join app.platforms platform on platform.id = agent.platform_id
    and platform.code = 'kemerbet' and platform.status = 'active'
  join app.deposit_jobs job on job.id = p_execution_job_id and job.job_kind = 'execute_deposit'
    and job.status = 'queued' and job.max_attempts = 1 and job.attempt_count = 0
    and job.lease_token is null and job.created_at >= authority.authorized_at
  join app.deposit_intents intent on intent.id = job.deposit_intent_id
    and intent.platform_id = platform.id and intent.status = 'execution_pending'
    and intent.verified_at is not null and intent.opened_at >= authority.authorized_at
  join app.payment_providers provider on provider.id = intent.payment_provider_id
    and provider.code = 'telebirr' and provider.status = 'active'
  join app.deposit_policy_versions policy on policy.id = authority.deposit_policy_version_id
    and policy.id = intent.deposit_policy_version_id and policy.version = intent.deposit_policy_version
    and policy.status = 'active' and policy.minimum_amount_minor = authority.minimum_amount_minor
    and policy.maximum_amount_minor = authority.maximum_amount_minor
    and policy.freshness_window_seconds = authority.freshness_window_seconds
    and intent.minimum_amount_minor = policy.minimum_amount_minor
    and intent.maximum_amount_minor = policy.maximum_amount_minor
    and intent.freshness_window_seconds = policy.freshness_window_seconds
  join app.customer_platform_players player on player.id = intent.player_account_id
    and player.platform_id = platform.id and player.status = 'active' and player.validation_status = 'valid'
  join app.player_deposit_eligibility_decisions eligibility on eligibility.player_account_id = player.id
    and eligibility.decision_version = (
      select pg_catalog.max(decision.decision_version) from app.player_deposit_eligibility_decisions decision
        where decision.player_account_id = player.id
    ) and eligibility.decision_version = (
      select pg_catalog.count(*) from app.player_deposit_eligibility_decisions decision
        where decision.player_account_id = player.id
    ) and eligibility.decision = 'eligible' and eligibility.decided_at <= pg_catalog.statement_timestamp()
    and eligibility.player_account_updated_at_snapshot is not distinct from player.updated_at
  join app.deposit_payment_claims claim on claim.deposit_intent_id = intent.id
  join app.deposit_verification_attempts verification on verification.id = claim.verification_attempt_id
    and verification.deposit_intent_id = intent.id and verification.outcome = 'verified'
    and verification.provider_payment_evidence_id = claim.provider_payment_evidence_id
  join app.deposit_submissions submission on submission.id = verification.deposit_submission_id
    and submission.deposit_intent_id = intent.id and submission.status = 'verified'
  join app.provider_payment_evidence evidence on evidence.id = claim.provider_payment_evidence_id
    and evidence.payment_provider_id = provider.id and evidence.provider_final_status = 'completed'
    and evidence.canonical_reference_fingerprint = submission.submitted_reference_fingerprint
    and evidence.evidence_source = 'provider_receipt_lookup'
    and evidence.amount_minor = intent.expected_amount_minor and evidence.currency_code = intent.currency_code
    and evidence.amount_minor between authority.minimum_amount_minor and authority.maximum_amount_minor
    and evidence.occurred_at >= submission.created_at - interval '1 hour'
    and evidence.occurred_at <= submission.created_at + interval '5 minutes'
    and evidence.matched_receiver_account_id = intent.receiver_account_id
    and evidence.matched_receiver_account_version = intent.receiver_account_version
  join app.receiver_accounts receiver on receiver.id = intent.receiver_account_id
    and receiver.provider_id = provider.id and receiver.version = intent.receiver_account_version
    and receiver.account_holder_name = intent.receiver_account_holder_name_snapshot
    and receiver.status = 'active'
  where event.event_sequence = (
    select pg_catalog.max(latest.event_sequence) from app.routine_telebirr_processing_events latest
  ) and event.event_kind = 'authorize'
    and not exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
        where reservation.deposit_intent_id = intent.id
    ) and not exists (
      select 1 from app.deposit_execution_attempts attempt where attempt.deposit_intent_id = intent.id
    ) and not exists (
      select 1 from app.deposit_review_cases review where review.deposit_intent_id = intent.id
        and review.status in ('open', 'assigned')
    );
$$;

create function app.admit_routine_telebirr_execution_job(p_execution_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessed record;
  previous app.routine_telebirr_execution_bindings%rowtype;
begin
  if p_execution_job_id is null then raise exception 'The routine job is invalid.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004)
  );
  -- Hold mutable lineage against concurrent revocation / eligibility or receiver changes.
  perform intent.id from app.deposit_jobs job
    join app.deposit_intents intent on intent.id = job.deposit_intent_id
    join app.customer_platform_players player on player.id = intent.player_account_id
    join app.receiver_accounts receiver on receiver.id = intent.receiver_account_id
    join app.platforms platform on platform.id = intent.platform_id
    join app.payment_providers provider on provider.id = intent.payment_provider_id
    join app.deposit_policy_versions policy on policy.id = intent.deposit_policy_version_id
    where job.id = p_execution_job_id
    for share of job, intent, player, receiver, platform, provider, policy;
  perform owner_user.id from app.routine_telebirr_processing_authorizations authority
    join app.routine_telebirr_processing_events event on event.authorization_id = authority.id
    join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent on agent.id = authority.platform_agent_account_id
    where event.event_sequence = (
      select pg_catalog.max(latest.event_sequence) from app.routine_telebirr_processing_events latest
    ) for share of owner_user, agent;
  select * into assessed from app.assess_routine_telebirr_execution_job(p_execution_job_id);
  if not found then raise exception 'The verified deposit is not eligible for routine admission.'; end if;
  select binding.* into previous from app.routine_telebirr_execution_bindings binding
    where binding.execution_job_id = p_execution_job_id;
  if previous.execution_job_id is not null then
    if previous.authorization_id <> assessed.authorization_id
      or previous.deposit_intent_id <> assessed.deposit_intent_id
      or previous.deposit_payment_claim_id <> assessed.deposit_payment_claim_id then
      raise exception 'The routine deposit has a different immutable authorization.';
    end if;
    return previous.execution_job_id;
  end if;
  insert into app.routine_telebirr_execution_bindings (
    execution_job_id, deposit_intent_id, deposit_payment_claim_id, authorization_id
  ) values (p_execution_job_id, assessed.deposit_intent_id, assessed.deposit_payment_claim_id,
    assessed.authorization_id);
  return p_execution_job_id;
end;
$$;

alter function app.require_routine_telebirr_owner(uuid) owner to postgres;
alter function app.routine_telebirr_processing_policy_json(uuid) owner to postgres;
alter function app.get_owner_routine_telebirr_processing(uuid) owner to postgres;
alter function app.save_owner_routine_telebirr_processing(uuid, uuid, uuid) owner to postgres;
alter function app.stop_owner_routine_telebirr_processing(uuid, uuid) owner to postgres;
alter function app.assess_routine_telebirr_execution_job(uuid) owner to postgres;
alter function app.admit_routine_telebirr_execution_job(uuid) owner to postgres;
revoke all on function
  app.require_routine_telebirr_owner(uuid), app.routine_telebirr_processing_policy_json(uuid),
  app.get_owner_routine_telebirr_processing(uuid),
  app.save_owner_routine_telebirr_processing(uuid, uuid, uuid),
  app.stop_owner_routine_telebirr_processing(uuid, uuid),
  app.assess_routine_telebirr_execution_job(uuid), app.admit_routine_telebirr_execution_job(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime;
grant execute on function
  app.get_owner_routine_telebirr_processing(uuid),
  app.save_owner_routine_telebirr_processing(uuid, uuid, uuid),
  app.stop_owner_routine_telebirr_processing(uuid, uuid) to fetanagent_owner_control;
revoke all on sequence
  app.routine_telebirr_processing_authorizations_revision_seq,
  app.routine_telebirr_processing_events_event_sequence_seq from public, anon, authenticated, service_role;

comment on table app.routine_telebirr_processing_authorizations is
  'Persistent Owner-approved business scope, with no expiry or successful-deposit quota. It is not an operator activation or financial capability.';
comment on table app.routine_telebirr_execution_bindings is
  'Immutable readiness-only binding of a fresh non-pilot verified job and one-use global payment claim to a persistent routine policy. No execution runtime has access.';
commit;
