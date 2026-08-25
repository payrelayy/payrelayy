-- Private, globally serialized five-Player claim for the KemerBet no-transfer readiness recheck.
--
-- This migration does not enable a feature switch, create a deposit, contact KemerBet, or move
-- money. It replaces a bounded Owner list followed by an application-side file decision with one
-- database claim that proves the complete current eligible set is exactly five, every money switch
-- is disabled, no private live pilot is open, and one configured KemerBet agent profile exists. The
-- singleton gate is also the first data-row lock acquired by guarded runtime DML, so the no-money
-- cohort/profile boundary cannot change during the isolated no-transfer recheck.
-- A clean terminal failure may be retried with a fresh request; the first successful recheck is
-- permanently one-use because its completed control-volume marker is intentionally retained.

begin;

create table app.private_owner_kemerbet_readiness_cohort_gate (
  singleton boolean primary key default true check (singleton),
  contract_version smallint not null default 1 check (contract_version = 1),
  created_at timestamptz not null default clock_timestamp()
);

insert into app.private_owner_kemerbet_readiness_cohort_gate (singleton)
values (true);

create table app.private_owner_kemerbet_readiness_cohort_claims (
  id uuid primary key default gen_random_uuid(),
  singleton_scope text not null default 'kemerbet-five-player-no-transfer-v1'
    check (singleton_scope = 'kemerbet-five-player-no-transfer-v1'),
  actor_admin_id uuid not null,
  claim_state text not null default 'prepared'
    check (claim_state in ('prepared', 'exported', 'imported', 'succeeded', 'failed_terminal')),
  prepared_at timestamptz not null default clock_timestamp(),
  exported_at timestamptz,
  imported_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  terminal_failure_code text,
  constraint private_owner_kemerbet_readiness_claims_id_v4_check check (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_owner_kemerbet_readiness_claims_state_shape check (
    (
      claim_state = 'prepared'
      and exported_at is null
      and imported_at is null
      and succeeded_at is null
      and failed_at is null
      and terminal_failure_code is null
    )
    or (
      claim_state = 'exported'
      and exported_at is not null
      and exported_at >= prepared_at
      and imported_at is null
      and succeeded_at is null
      and failed_at is null
      and terminal_failure_code is null
    )
    or (
      claim_state = 'imported'
      and exported_at is not null
      and exported_at >= prepared_at
      and imported_at is not null
      and imported_at >= exported_at
      and succeeded_at is null
      and failed_at is null
      and terminal_failure_code is null
    )
    or (
      claim_state = 'succeeded'
      and exported_at is not null
      and exported_at >= prepared_at
      and imported_at is not null
      and imported_at >= exported_at
      and succeeded_at is not null
      and succeeded_at >= imported_at
      and failed_at is null
      and terminal_failure_code is null
    )
    or (
      claim_state = 'failed_terminal'
      and succeeded_at is null
      and failed_at is not null
      and failed_at >= coalesce(imported_at, exported_at, prepared_at)
      and (exported_at is null or exported_at >= prepared_at)
      and (
        imported_at is null
        or (exported_at is not null and imported_at >= exported_at)
      )
      and terminal_failure_code in (
        'import_failed_cleanup_confirmed',
        'recheck_failed_cleanup_confirmed',
        'recovery_failed_cleanup_confirmed',
        'operator_cancelled_cleanup_confirmed'
      )
    )
  )
);

create unique index private_owner_kemerbet_readiness_claims_active_singleton_key
  on app.private_owner_kemerbet_readiness_cohort_claims (singleton_scope)
  where claim_state in ('prepared', 'exported', 'imported');

-- A successful root recheck is permanently one-use because its completed control-volume marker is
-- intentionally permanent. Failed terminal attempts leave this index and may be retried by a fresh
-- request; succeeded attempts remain in it and make every later active claim impossible.
create unique index private_owner_kemerbet_readiness_claims_one_success_key
  on app.private_owner_kemerbet_readiness_cohort_claims (singleton_scope)
  where claim_state in ('prepared', 'exported', 'imported', 'succeeded');

create table app.private_owner_kemerbet_readiness_cohort_members (
  claim_id uuid not null
    references app.private_owner_kemerbet_readiness_cohort_claims (id) on delete restrict,
  member_ordinal smallint not null check (member_ordinal between 1 and 5),
  -- The composite decision FK below transitively and immutably binds this UUID to the Player row.
  -- A redundant direct Player FK is deliberately omitted: its key-share lock could invert the
  -- singleton-gate order used by an older Owner decision procedure that pre-locks the Player row.
  player_account_id uuid not null,
  eligibility_decision_id uuid not null,
  eligibility_decision_version integer not null check (eligibility_decision_version > 0),
  player_account_updated_at_snapshot timestamptz not null,
  decision_decided_at_snapshot timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (claim_id, member_ordinal),
  constraint private_owner_kemerbet_readiness_members_player_key
    unique (claim_id, player_account_id),
  constraint private_owner_kemerbet_readiness_members_decision_key
    unique (claim_id, eligibility_decision_id),
  constraint private_owner_kemerbet_readiness_members_decision_fkey
    foreign key (eligibility_decision_id, player_account_id)
    references app.player_deposit_eligibility_decisions (id, player_account_id)
    on delete restrict
);

create table app.private_owner_kemerbet_readiness_cohort_requests (
  request_id uuid primary key,
  claim_id uuid not null
    references app.private_owner_kemerbet_readiness_cohort_claims (id) on delete restrict,
  actor_admin_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_owner_kemerbet_readiness_requests_id_v4_check check (
    request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_owner_kemerbet_readiness_requests_claim_actor_key
    unique (request_id, claim_id, actor_admin_id)
);

create table app.private_owner_kemerbet_readiness_cohort_receipts (
  receipt_id uuid primary key,
  claim_id uuid not null
    references app.private_owner_kemerbet_readiness_cohort_claims (id) on delete restrict,
  receipt_event text not null check (receipt_event in ('imported', 'completed', 'failed_terminal')),
  terminal_failure_code text,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint private_owner_kemerbet_readiness_receipts_id_v4_check check (
    receipt_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_owner_kemerbet_readiness_receipts_claim_event_key
    unique (claim_id, receipt_event),
  constraint private_owner_kemerbet_readiness_receipts_shape check (
    (
      receipt_event in ('imported', 'completed')
      and terminal_failure_code is null
    )
    or (
      receipt_event = 'failed_terminal'
      and terminal_failure_code in (
        'import_failed_cleanup_confirmed',
        'recheck_failed_cleanup_confirmed',
        'recovery_failed_cleanup_confirmed',
        'operator_cancelled_cleanup_confirmed'
      )
    )
  )
);

create index private_owner_kemerbet_readiness_members_player_idx
  on app.private_owner_kemerbet_readiness_cohort_members (player_account_id);
create index private_owner_kemerbet_readiness_requests_claim_idx
  on app.private_owner_kemerbet_readiness_cohort_requests (claim_id, created_at);
create index private_owner_kemerbet_readiness_receipts_claim_idx
  on app.private_owner_kemerbet_readiness_cohort_receipts (claim_id, recorded_at);

create function app.reject_private_owner_kemerbet_readiness_immutable_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'The private KemerBet readiness claim ledger is immutable.';
end;
$$;

create function app.enforce_private_owner_kemerbet_readiness_claim_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.singleton_scope is distinct from old.singleton_scope
    or new.actor_admin_id is distinct from old.actor_admin_id
    or new.prepared_at is distinct from old.prepared_at then
    raise exception 'The private KemerBet readiness claim identity is immutable.';
  end if;

  if old.claim_state = 'prepared'
    and new.claim_state = 'exported'
    and new.exported_at is not null
    and new.imported_at is null
    and new.succeeded_at is null
    and new.failed_at is null
    and new.terminal_failure_code is null then
    return new;
  end if;

  if old.claim_state = 'prepared'
    and new.claim_state = 'imported'
    and new.exported_at is not null
    and new.imported_at is not null
    and new.succeeded_at is null
    and new.failed_at is null
    and new.terminal_failure_code is null then
    return new;
  end if;

  if old.claim_state = 'exported'
    and new.claim_state = 'imported'
    and new.exported_at is not distinct from old.exported_at
    and new.imported_at is not null
    and new.succeeded_at is null
    and new.failed_at is null
    and new.terminal_failure_code is null then
    return new;
  end if;

  if old.claim_state = 'prepared'
    and new.claim_state = 'succeeded'
    and new.exported_at is not null
    and new.imported_at is not null
    and new.succeeded_at is not null
    and new.failed_at is null
    and new.terminal_failure_code is null then
    return new;
  end if;

  if old.claim_state = 'exported'
    and new.claim_state = 'succeeded'
    and new.exported_at is not distinct from old.exported_at
    and new.imported_at is not null
    and new.succeeded_at is not null
    and new.failed_at is null
    and new.terminal_failure_code is null then
    return new;
  end if;

  if old.claim_state = 'imported'
    and new.claim_state = 'succeeded'
    and new.exported_at is not distinct from old.exported_at
    and new.imported_at is not distinct from old.imported_at
    and new.succeeded_at is not null
    and new.failed_at is null
    and new.terminal_failure_code is null then
    return new;
  end if;

  if old.claim_state in ('prepared', 'exported', 'imported')
    and new.claim_state = 'failed_terminal'
    and new.exported_at is not distinct from old.exported_at
    and new.imported_at is not distinct from old.imported_at
    and new.succeeded_at is null
    and new.failed_at is not null
    and new.terminal_failure_code is not null then
    return new;
  end if;

  raise exception 'The private KemerBet readiness claim transition is invalid.';
end;
$$;

create trigger private_owner_kemerbet_readiness_claims_transition
before update on app.private_owner_kemerbet_readiness_cohort_claims
for each row
execute function app.enforce_private_owner_kemerbet_readiness_claim_transition();

create trigger private_owner_kemerbet_readiness_claims_no_delete
before delete on app.private_owner_kemerbet_readiness_cohort_claims
for each row
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_claims_no_truncate
before truncate on app.private_owner_kemerbet_readiness_cohort_claims
for each statement
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_members_immutable
before update or delete on app.private_owner_kemerbet_readiness_cohort_members
for each row
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_members_no_truncate
before truncate on app.private_owner_kemerbet_readiness_cohort_members
for each statement
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_requests_immutable
before update or delete on app.private_owner_kemerbet_readiness_cohort_requests
for each row
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_requests_no_truncate
before truncate on app.private_owner_kemerbet_readiness_cohort_requests
for each statement
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_receipts_immutable
before update or delete on app.private_owner_kemerbet_readiness_cohort_receipts
for each row
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create trigger private_owner_kemerbet_readiness_receipts_no_truncate
before truncate on app.private_owner_kemerbet_readiness_cohort_receipts
for each statement
execute function app.reject_private_owner_kemerbet_readiness_immutable_mutation();

create function app.require_private_owner_kemerbet_readiness_exact_members()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  exact_members integer;
begin
  select count(*)::integer
    into exact_members
    from app.private_owner_kemerbet_readiness_cohort_members member
   where member.claim_id = new.id;

  if exact_members <> 5 then
    raise exception 'A private KemerBet readiness claim requires exactly five members.';
  end if;
  return null;
end;
$$;

create constraint trigger private_owner_kemerbet_readiness_claim_exact_members
after insert on app.private_owner_kemerbet_readiness_cohort_claims
deferrable initially deferred
for each row
execute function app.require_private_owner_kemerbet_readiness_exact_members();

create function app.serialize_private_owner_kemerbet_readiness_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  perform 1
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;

  if not found then
    raise exception 'The private KemerBet readiness serialization gate is unavailable.';
  end if;

  if exists (
    select 1
      from app.private_owner_kemerbet_readiness_cohort_claims claim
     where claim.claim_state in ('prepared', 'exported', 'imported')
  ) then
    raise exception 'The fixed KemerBet readiness cohort is frozen.';
  end if;

  return null;
end;
$$;

-- Statement-level BEFORE triggers take the singleton gate before DML can lock or mutate a source
-- row. The claim path deliberately uses lock-free MVCC source/Admin reads and omits live source FKs
-- that could invert older procedures which pre-lock rows before their guarded DML. PostgreSQL takes
-- an ACCESS EXCLUSIVE relation lock before firing a BEFORE TRUNCATE trigger, so ad-hoc operational
-- TRUNCATE remains outside the concurrent runtime contract; the trigger still fail-closes mutation.
create trigger customer_platform_players_serialize_kemerbet_readiness
before insert or update or delete on app.customer_platform_players
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger customer_platform_players_serialize_kemerbet_readiness_truncate
before truncate on app.customer_platform_players
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger player_validation_attempts_serialize_kemerbet_readiness
before insert or update or delete on app.player_validation_attempts
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger validation_attempts_serialize_kemerbet_readiness_truncate
before truncate on app.player_validation_attempts
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger eligibility_decisions_serialize_kemerbet_readiness
before insert or update or delete on app.player_deposit_eligibility_decisions
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger eligibility_decisions_serialize_kemerbet_readiness_truncate
before truncate on app.player_deposit_eligibility_decisions
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger player_registration_requests_serialize_kemerbet_readiness
before insert or update or delete on app.player_registration_requests
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger registration_requests_serialize_kemerbet_readiness_truncate
before truncate on app.player_registration_requests
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger player_registration_associations_serialize_kemerbet_readiness
before insert or update or delete on app.player_registration_request_associations
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger registration_associations_serialize_kemerbet_readiness_truncate
before truncate on app.player_registration_request_associations
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger platforms_serialize_kemerbet_readiness
before insert or update or delete on app.platforms
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger platforms_serialize_kemerbet_readiness_truncate
before truncate on app.platforms
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger customers_serialize_kemerbet_readiness
before insert or update or delete on app.customers
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger customers_serialize_kemerbet_readiness_truncate
before truncate on app.customers
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger feature_switches_serialize_kemerbet_readiness
before insert or update or delete on app.feature_switches
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger feature_switches_serialize_kemerbet_readiness_truncate
before truncate on app.feature_switches
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger live_pilot_revisions_serialize_kemerbet_readiness
before insert or update or delete on app.private_live_deposit_pilot_revisions
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger live_pilot_revisions_serialize_kemerbet_readiness_truncate
before truncate on app.private_live_deposit_pilot_revisions
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger agent_accounts_serialize_kemerbet_readiness
before insert or update or delete on app.platform_agent_accounts
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger agent_accounts_serialize_kemerbet_readiness_truncate
before truncate on app.platform_agent_accounts
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create trigger agent_profiles_serialize_kemerbet_readiness
before insert or update or delete on app.private_owner_kemerbet_agent_profile_revisions
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();
create trigger agent_profiles_serialize_kemerbet_readiness_truncate
before truncate on app.private_owner_kemerbet_agent_profile_revisions
for each statement
execute function app.serialize_private_owner_kemerbet_readiness_source_mutation();

create function app.require_private_owner_kemerbet_readiness_safe_boundary()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  configured_profile_count integer;
  switch_count integer;
  switches_disabled boolean;
begin
  select count(*)::integer,
         coalesce(bool_and(feature.mode = 'disabled'), false)
    into switch_count, switches_disabled
    from app.feature_switches feature
   where feature.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   );
  if switch_count <> 5 or not switches_disabled then
    raise exception 'The KemerBet readiness claim requires every money switch to be disabled.';
  end if;

  if exists (
    select 1
      from app.private_live_deposit_pilot_revisions pilot
     where pilot.status in ('draft', 'armed')
  ) then
    raise exception 'The KemerBet readiness claim requires no open private live-money pilot.';
  end if;

  select count(*)::integer
    into configured_profile_count
    from app.platforms platform
    join app.platform_agent_accounts agent
      on agent.platform_id = platform.id
    join app.private_owner_kemerbet_agent_profile_revisions profile
      on profile.platform_id = platform.id
     and profile.platform_agent_account_id = agent.id
   where platform.code = 'kemerbet'
     and platform.status = 'active'
     and agent.status = 'active'
     and profile.retired_at is null
     and profile.profile_contract_version = 1;
  if configured_profile_count <> 1 then
    raise exception 'The KemerBet readiness claim requires one active configured agent profile.';
  end if;
end;
$$;

create function app.require_private_owner_kemerbet_readiness_claim_current(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_count integer;
  matched_count integer;
begin
  with current_eligible as (
    select player_account.id as player_account_id,
           latest_decision.id as eligibility_decision_id,
           latest_decision.decision_version,
           player_account.updated_at,
           latest_decision.decided_at
      from app.player_registration_request_associations association
      join app.customer_platform_players player_account
        on player_account.id = association.player_account_id
      join app.customers customer on customer.id = player_account.customer_id
      join app.platforms platform on platform.id = player_account.platform_id
      join lateral (
        select decision.*
          from app.player_deposit_eligibility_decisions decision
         where decision.player_account_id = player_account.id
         order by decision.decision_version desc
         limit 1
      ) latest_decision on true
     where platform.code = 'kemerbet'
       and platform.status = 'active'
       and customer.status = 'active'
       and player_account.status = 'active'
       and player_account.validation_status = 'valid'
       and player_account.player_id collate pg_catalog."C"
         ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
       and latest_decision.decision = 'eligible'
       and latest_decision.reason_code = 'financial_eligibility_approved'
       and latest_decision.player_account_updated_at_snapshot is not distinct from player_account.updated_at
       and latest_decision.decided_at <= clock_timestamp()
       and (
         select count(*)::integer = latest_decision.decision_version
           and max(history.decision_version) = latest_decision.decision_version
           and min(history.decision_version) = 1
           and count(distinct history.decision_version)::integer = latest_decision.decision_version
           from app.player_deposit_eligibility_decisions history
          where history.player_account_id = player_account.id
       )
  )
  select count(*)::integer,
         count(member.player_account_id)::integer
    into current_count, matched_count
    from current_eligible eligible
    left join app.private_owner_kemerbet_readiness_cohort_members member
      on member.claim_id = p_claim_id
     and member.player_account_id = eligible.player_account_id
     and member.eligibility_decision_id = eligible.eligibility_decision_id
     and member.eligibility_decision_version = eligible.decision_version
     and member.player_account_updated_at_snapshot is not distinct from eligible.updated_at
     and member.decision_decided_at_snapshot is not distinct from eligible.decided_at;

  if current_count <> 5
    or matched_count <> 5
    or (
      select count(*)::integer
        from app.private_owner_kemerbet_readiness_cohort_members member
       where member.claim_id = p_claim_id
    ) <> 5 then
    raise exception 'The fixed KemerBet readiness cohort is no longer current.';
  end if;
end;
$$;

create function app.require_owner_kemerbet_readiness_cohort_controller()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if session_user = 'postgres' then
    return;
  end if;
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true then
    raise exception 'The Owner KemerBet readiness-cohort controller is unavailable.';
  end if;
end;
$$;

create function app.prepare_owner_kemerbet_readiness_cohort_claim(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns table (
  cohort_id uuid,
  cohort_state text,
  cohort_already_claimed boolean,
  member_ordinal smallint,
  player_account_id uuid,
  platform_code text,
  player_id text,
  player_status text,
  validation_status text,
  decision_id uuid,
  decision_version integer,
  decision text,
  reason_code text,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  existing_request app.private_owner_kemerbet_readiness_cohort_requests%rowtype;
  resolved_claim app.private_owner_kemerbet_readiness_cohort_claims%rowtype;
  claim_was_existing boolean := true;
  eligible_count integer;
begin
  perform app.require_owner_kemerbet_readiness_cohort_controller();

  if p_actor_auth_user_id is null
    or p_request_id is null
    or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The Owner KemerBet readiness claim request is invalid.';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

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
     and admin_user.status = 'active';
  if actor_admin_id is null then
    raise exception 'Only an active Owner can prepare the KemerBet readiness cohort.';
  end if;

  select request.*
    into existing_request
    from app.private_owner_kemerbet_readiness_cohort_requests request
   where request.request_id = p_request_id
   for update;

  if existing_request.request_id is not null then
    if existing_request.actor_admin_id <> actor_admin_id then
      raise exception 'The Owner KemerBet readiness request conflicts with its receipt.';
    end if;
    select claim.* into resolved_claim
      from app.private_owner_kemerbet_readiness_cohort_claims claim
     where claim.id = existing_request.claim_id
     for update;
    if resolved_claim.id is null then
      raise exception 'The Owner KemerBet readiness request receipt is incomplete.';
    end if;
  else
    if exists (
      select 1
        from app.private_owner_kemerbet_readiness_cohort_claims claim
       where claim.singleton_scope = 'kemerbet-five-player-no-transfer-v1'
         and claim.claim_state = 'succeeded'
    ) then
      raise exception 'The one-use KemerBet readiness recheck has already succeeded; a fresh request is not allowed.';
    end if;

    select claim.* into resolved_claim
      from app.private_owner_kemerbet_readiness_cohort_claims claim
     where claim.singleton_scope = 'kemerbet-five-player-no-transfer-v1'
       and claim.claim_state in ('prepared', 'exported', 'imported')
     for update;

    if resolved_claim.id is null then
      with current_eligible as (
        select player_account.id as player_account_id,
               player_account.player_id,
               player_account.updated_at,
               latest_decision.id as eligibility_decision_id,
               latest_decision.decision_version,
               latest_decision.decided_at
          from app.player_registration_request_associations association
          join app.customer_platform_players player_account
            on player_account.id = association.player_account_id
          join app.customers customer on customer.id = player_account.customer_id
          join app.platforms platform on platform.id = player_account.platform_id
          join lateral (
            select decision.*
              from app.player_deposit_eligibility_decisions decision
             where decision.player_account_id = player_account.id
             order by decision.decision_version desc
             limit 1
          ) latest_decision on true
         where platform.code = 'kemerbet'
           and platform.status = 'active'
           and customer.status = 'active'
           and player_account.status = 'active'
           and player_account.validation_status = 'valid'
           and player_account.player_id collate pg_catalog."C"
             ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
           and latest_decision.decision = 'eligible'
           and latest_decision.reason_code = 'financial_eligibility_approved'
           and latest_decision.player_account_updated_at_snapshot is not distinct from player_account.updated_at
           and latest_decision.decided_at <= clock_timestamp()
           and (
             select count(*)::integer = latest_decision.decision_version
               and max(history.decision_version) = latest_decision.decision_version
               and min(history.decision_version) = 1
               and count(distinct history.decision_version)::integer = latest_decision.decision_version
               from app.player_deposit_eligibility_decisions history
              where history.player_account_id = player_account.id
           )
      )
      select count(*)::integer into eligible_count from current_eligible;

      if eligible_count <> 5 then
        raise exception 'The Owner KemerBet readiness cohort requires exactly five current eligible Players.';
      end if;

      insert into app.private_owner_kemerbet_readiness_cohort_claims (actor_admin_id)
      values (actor_admin_id)
      returning * into resolved_claim;
      claim_was_existing := false;

      insert into app.private_owner_kemerbet_readiness_cohort_members (
        claim_id,
        member_ordinal,
        player_account_id,
        eligibility_decision_id,
        eligibility_decision_version,
        player_account_updated_at_snapshot,
        decision_decided_at_snapshot
      )
      select resolved_claim.id,
             row_number() over (order by player_account.id)::smallint,
             player_account.id,
             latest_decision.id,
             latest_decision.decision_version,
             player_account.updated_at,
             latest_decision.decided_at
        from app.player_registration_request_associations association
        join app.customer_platform_players player_account
          on player_account.id = association.player_account_id
        join app.customers customer on customer.id = player_account.customer_id
        join app.platforms platform on platform.id = player_account.platform_id
        join lateral (
          select decision.*
            from app.player_deposit_eligibility_decisions decision
           where decision.player_account_id = player_account.id
           order by decision.decision_version desc
           limit 1
        ) latest_decision on true
       where platform.code = 'kemerbet'
         and platform.status = 'active'
         and customer.status = 'active'
         and player_account.status = 'active'
         and player_account.validation_status = 'valid'
         and player_account.player_id collate pg_catalog."C"
           ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
         and latest_decision.decision = 'eligible'
         and latest_decision.reason_code = 'financial_eligibility_approved'
         and latest_decision.player_account_updated_at_snapshot is not distinct from player_account.updated_at
         and latest_decision.decided_at <= clock_timestamp()
         and (
           select count(*)::integer = latest_decision.decision_version
             and max(history.decision_version) = latest_decision.decision_version
             and min(history.decision_version) = 1
             and count(distinct history.decision_version)::integer = latest_decision.decision_version
             from app.player_deposit_eligibility_decisions history
            where history.player_account_id = player_account.id
         )
       order by player_account.id;

      perform app.require_private_owner_kemerbet_readiness_claim_current(resolved_claim.id);

      insert into app.audit_events (
        actor_kind,
        actor_label,
        action,
        resource_type,
        resource_id,
        metadata
      ) values (
        'system',
        'owner-readiness-controller-v1',
        'kemerbet_readiness.cohort_claimed',
        'kemerbet_readiness_cohort',
        resolved_claim.id,
        jsonb_build_object(
          'contract_version', 1,
          'players_claimed', 5,
          'transfer_disabled', true,
          'money_moved', false,
          'identifiers_redacted', true
        )
      );
    end if;

    insert into app.private_owner_kemerbet_readiness_cohort_requests (
      request_id,
      claim_id,
      actor_admin_id
    ) values (
      p_request_id,
      resolved_claim.id,
      actor_admin_id
    );
  end if;

  if resolved_claim.claim_state = 'failed_terminal' then
    raise exception 'The Owner KemerBet readiness request is bound to a terminally failed claim; use a fresh request.';
  end if;
  if resolved_claim.claim_state in ('prepared', 'exported', 'imported', 'succeeded') then
    perform app.require_private_owner_kemerbet_readiness_safe_boundary();
    perform app.require_private_owner_kemerbet_readiness_claim_current(resolved_claim.id);
  end if;

  return query
  select resolved_claim.id,
         resolved_claim.claim_state,
         claim_was_existing,
         member.member_ordinal,
         player_account.id,
         platform.code,
         player_account.player_id,
         player_account.status::text,
         player_account.validation_status::text,
         decision.id,
         decision.decision_version,
         decision.decision,
         decision.reason_code,
         decision.decided_at
    from app.private_owner_kemerbet_readiness_cohort_members member
    join app.customer_platform_players player_account
      on player_account.id = member.player_account_id
    join app.platforms platform on platform.id = player_account.platform_id
    join app.player_deposit_eligibility_decisions decision
      on decision.id = member.eligibility_decision_id
     and decision.player_account_id = member.player_account_id
   where member.claim_id = resolved_claim.id
   order by member.member_ordinal;
end;
$$;

create function app.advance_owner_kemerbet_readiness_cohort_claim(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_claim_id uuid,
  p_transition text
)
returns table (
  advanced_claim_id uuid,
  advanced_claim_state text,
  transition_already_recorded boolean,
  transitioned_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  normalized_transition text := lower(btrim(p_transition));
  request_receipt app.private_owner_kemerbet_readiness_cohort_requests%rowtype;
  locked_claim app.private_owner_kemerbet_readiness_cohort_claims%rowtype;
  transition_time timestamptz;
begin
  perform app.require_owner_kemerbet_readiness_cohort_controller();

  if p_actor_auth_user_id is null
    or p_request_id is null
    or p_claim_id is null
    or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_claim_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or normalized_transition is distinct from 'exported' then
    raise exception 'The Owner KemerBet readiness claim transition is invalid.';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

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
     and admin_user.status = 'active';
  if actor_admin_id is null then
    raise exception 'Only an active Owner can advance the KemerBet readiness claim.';
  end if;

  select request.* into request_receipt
    from app.private_owner_kemerbet_readiness_cohort_requests request
   where request.request_id = p_request_id
   for update;
  if request_receipt.request_id is null
    or request_receipt.claim_id <> p_claim_id
    or request_receipt.actor_admin_id <> actor_admin_id then
    raise exception 'The Owner KemerBet readiness transition conflicts with its receipt.';
  end if;

  select claim.* into locked_claim
    from app.private_owner_kemerbet_readiness_cohort_claims claim
   where claim.id = p_claim_id
   for update;
  if locked_claim.id is null then
    raise exception 'The Owner KemerBet readiness claim is unavailable.';
  end if;

  if locked_claim.claim_state in ('exported', 'imported', 'succeeded') then
    if locked_claim.claim_state in ('exported', 'imported') then
      perform app.require_private_owner_kemerbet_readiness_safe_boundary();
      perform app.require_private_owner_kemerbet_readiness_claim_current(locked_claim.id);
    end if;
    return query select locked_claim.id, 'exported'::text, true, locked_claim.exported_at;
    return;
  end if;
  if locked_claim.claim_state <> 'prepared' then
    raise exception 'The Owner KemerBet readiness claim cannot be exported.';
  end if;

  perform app.require_private_owner_kemerbet_readiness_safe_boundary();
  perform app.require_private_owner_kemerbet_readiness_claim_current(locked_claim.id);
  transition_time := clock_timestamp();
  update app.private_owner_kemerbet_readiness_cohort_claims claim
     set claim_state = 'exported',
         exported_at = transition_time
   where claim.id = locked_claim.id;

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'system',
    'owner-readiness-controller-v1',
    'kemerbet_readiness.cohort_exported',
    'kemerbet_readiness_cohort',
    locked_claim.id,
    jsonb_build_object(
      'contract_version', 1,
      'players_confirmed', 5,
      'transfer_disabled', true,
      'money_moved', false,
      'identifiers_redacted', true
    )
  );

  return query select locked_claim.id, 'exported'::text, false, transition_time;
end;
$$;

create function app.record_owner_kemerbet_readiness_cohort_root_receipt(
  p_claim_id uuid,
  p_receipt_id uuid,
  p_event text,
  p_failure_code text default null
)
returns table (
  recorded_receipt_id uuid,
  recorded_claim_id uuid,
  recorded_claim_state text,
  recorded_receipt_event text,
  receipt_already_recorded boolean,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_receipt app.private_owner_kemerbet_readiness_cohort_receipts%rowtype;
  imported_receipt app.private_owner_kemerbet_readiness_cohort_receipts%rowtype;
  locked_claim app.private_owner_kemerbet_readiness_cohort_claims%rowtype;
  synthetic_imported_receipt_id uuid;
  transition_time timestamptz;
begin
  perform app.require_owner_kemerbet_readiness_cohort_controller();

  if p_claim_id is null
    or p_receipt_id is null
    or p_claim_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_receipt_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_event is null
    or p_event not in ('imported', 'completed', 'failed_terminal')
    or (
      p_event in ('imported', 'completed')
      and p_failure_code is not null
    )
    or (
      p_event = 'failed_terminal'
      and (
        p_failure_code is null
        or p_failure_code not in (
          'import_failed_cleanup_confirmed',
          'recheck_failed_cleanup_confirmed',
          'recovery_failed_cleanup_confirmed',
          'operator_cancelled_cleanup_confirmed'
        )
      )
    ) then
    raise exception 'The root KemerBet readiness receipt is invalid.';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  perform 1
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;
  if not found then
    raise exception 'The private KemerBet readiness serialization gate is unavailable.';
  end if;

  select receipt.* into existing_receipt
    from app.private_owner_kemerbet_readiness_cohort_receipts receipt
   where receipt.receipt_id = p_receipt_id;
  if existing_receipt.receipt_id is not null then
    if existing_receipt.claim_id <> p_claim_id
      or existing_receipt.receipt_event <> p_event
      or existing_receipt.terminal_failure_code is distinct from p_failure_code then
      raise exception 'The root KemerBet readiness receipt identity conflicts with its ledger entry.';
    end if;
  else
    select receipt.* into existing_receipt
      from app.private_owner_kemerbet_readiness_cohort_receipts receipt
     where receipt.claim_id = p_claim_id
       and receipt.receipt_event = p_event;
    if existing_receipt.receipt_id is not null
      and existing_receipt.terminal_failure_code is distinct from p_failure_code then
      raise exception 'The root KemerBet readiness receipt conflicts with its recorded event.';
    end if;
  end if;

  if existing_receipt.receipt_id is not null then
    select claim.* into locked_claim
      from app.private_owner_kemerbet_readiness_cohort_claims claim
     where claim.id = existing_receipt.claim_id
     for update;
    if locked_claim.id is null then
      raise exception 'The recorded root KemerBet readiness receipt has no claim.';
    end if;
    return query
    select existing_receipt.receipt_id,
           locked_claim.id,
           locked_claim.claim_state,
           existing_receipt.receipt_event,
           true,
           existing_receipt.recorded_at;
    return;
  end if;

  select claim.* into locked_claim
    from app.private_owner_kemerbet_readiness_cohort_claims claim
   where claim.id = p_claim_id
   for update;
  if locked_claim.id is null then
    raise exception 'The root KemerBet readiness receipt claim is unavailable.';
  end if;

  transition_time := clock_timestamp();
  if p_event = 'imported' then
    perform app.require_private_owner_kemerbet_readiness_safe_boundary();
    perform app.require_private_owner_kemerbet_readiness_claim_current(locked_claim.id);
    if locked_claim.claim_state not in ('prepared', 'exported') then
      raise exception 'The root KemerBet readiness import receipt is out of sequence.';
    end if;
    update app.private_owner_kemerbet_readiness_cohort_claims claim
       set claim_state = 'imported',
           exported_at = coalesce(claim.exported_at, transition_time),
           imported_at = transition_time
     where claim.id = locked_claim.id
     returning claim.* into locked_claim;
  elsif p_event = 'completed' then
    perform app.require_private_owner_kemerbet_readiness_safe_boundary();
    perform app.require_private_owner_kemerbet_readiness_claim_current(locked_claim.id);
    if locked_claim.claim_state not in ('prepared', 'exported', 'imported') then
      raise exception 'The root KemerBet readiness completion receipt is out of sequence.';
    end if;
    select receipt.* into imported_receipt
      from app.private_owner_kemerbet_readiness_cohort_receipts receipt
     where receipt.claim_id = locked_claim.id
       and receipt.receipt_event = 'imported';
    if locked_claim.claim_state = 'imported'
      and imported_receipt.receipt_id is null then
      raise exception 'The imported KemerBet readiness claim has no immutable root receipt.';
    end if;
    if locked_claim.claim_state in ('prepared', 'exported')
      and imported_receipt.receipt_id is not null then
      raise exception 'The KemerBet readiness import receipt conflicts with its claim state.';
    end if;
    update app.private_owner_kemerbet_readiness_cohort_claims claim
       set claim_state = 'succeeded',
           exported_at = coalesce(claim.exported_at, transition_time),
           imported_at = coalesce(claim.imported_at, transition_time),
           succeeded_at = transition_time
     where claim.id = locked_claim.id
     returning claim.* into locked_claim;
    if imported_receipt.receipt_id is null then
      synthetic_imported_receipt_id := gen_random_uuid();
      insert into app.private_owner_kemerbet_readiness_cohort_receipts (
        receipt_id,
        claim_id,
        receipt_event,
        recorded_at
      ) values (
        synthetic_imported_receipt_id,
        locked_claim.id,
        'imported',
        transition_time
      );
    end if;
  else
    if locked_claim.claim_state not in ('prepared', 'exported', 'imported') then
      raise exception 'The root KemerBet readiness terminal-failure receipt is out of sequence.';
    end if;
    update app.private_owner_kemerbet_readiness_cohort_claims claim
       set claim_state = 'failed_terminal',
           failed_at = transition_time,
           terminal_failure_code = p_failure_code
     where claim.id = locked_claim.id
     returning claim.* into locked_claim;
  end if;

  insert into app.private_owner_kemerbet_readiness_cohort_receipts (
    receipt_id,
    claim_id,
    receipt_event,
    terminal_failure_code,
    recorded_at
  ) values (
    p_receipt_id,
    locked_claim.id,
    p_event,
    p_failure_code,
    transition_time
  );

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'system',
    'root-readiness-receipt-bridge-v1',
    'kemerbet_readiness.root_receipt_' || p_event,
    'kemerbet_readiness_cohort',
    locked_claim.id,
    jsonb_build_object(
      'contract_version', 1,
      'receipt_event', p_event,
      'claim_state', locked_claim.claim_state,
      'terminal_failure_code', p_failure_code,
      'transfer_disabled', true,
      'money_moved', false,
      'identifiers_redacted', true
    )
  );

  return query
  select p_receipt_id,
         locked_claim.id,
         locked_claim.claim_state,
         p_event,
         false,
         transition_time;
end;
$$;

alter table app.private_owner_kemerbet_readiness_cohort_gate enable row level security;
alter table app.private_owner_kemerbet_readiness_cohort_gate force row level security;
alter table app.private_owner_kemerbet_readiness_cohort_claims enable row level security;
alter table app.private_owner_kemerbet_readiness_cohort_claims force row level security;
alter table app.private_owner_kemerbet_readiness_cohort_members enable row level security;
alter table app.private_owner_kemerbet_readiness_cohort_members force row level security;
alter table app.private_owner_kemerbet_readiness_cohort_requests enable row level security;
alter table app.private_owner_kemerbet_readiness_cohort_requests force row level security;
alter table app.private_owner_kemerbet_readiness_cohort_receipts enable row level security;
alter table app.private_owner_kemerbet_readiness_cohort_receipts force row level security;

alter table app.private_owner_kemerbet_readiness_cohort_gate owner to postgres;
alter table app.private_owner_kemerbet_readiness_cohort_claims owner to postgres;
alter table app.private_owner_kemerbet_readiness_cohort_members owner to postgres;
alter table app.private_owner_kemerbet_readiness_cohort_requests owner to postgres;
alter table app.private_owner_kemerbet_readiness_cohort_receipts owner to postgres;
alter function app.reject_private_owner_kemerbet_readiness_immutable_mutation() owner to postgres;
alter function app.enforce_private_owner_kemerbet_readiness_claim_transition() owner to postgres;
alter function app.require_private_owner_kemerbet_readiness_exact_members() owner to postgres;
alter function app.serialize_private_owner_kemerbet_readiness_source_mutation() owner to postgres;
alter function app.require_private_owner_kemerbet_readiness_safe_boundary() owner to postgres;
alter function app.require_private_owner_kemerbet_readiness_claim_current(uuid) owner to postgres;
alter function app.require_owner_kemerbet_readiness_cohort_controller() owner to postgres;
alter function app.prepare_owner_kemerbet_readiness_cohort_claim(uuid, uuid) owner to postgres;
alter function app.advance_owner_kemerbet_readiness_cohort_claim(uuid, uuid, uuid, text)
  owner to postgres;
alter function app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid, uuid, text, text)
  owner to postgres;

revoke all on table
  app.private_owner_kemerbet_readiness_cohort_gate,
  app.private_owner_kemerbet_readiness_cohort_claims,
  app.private_owner_kemerbet_readiness_cohort_members,
  app.private_owner_kemerbet_readiness_cohort_requests,
  app.private_owner_kemerbet_readiness_cohort_receipts
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
  app.reject_private_owner_kemerbet_readiness_immutable_mutation(),
  app.enforce_private_owner_kemerbet_readiness_claim_transition(),
  app.require_private_owner_kemerbet_readiness_exact_members(),
  app.serialize_private_owner_kemerbet_readiness_source_mutation(),
  app.require_private_owner_kemerbet_readiness_safe_boundary(),
  app.require_private_owner_kemerbet_readiness_claim_current(uuid),
  app.require_owner_kemerbet_readiness_cohort_controller(),
  app.prepare_owner_kemerbet_readiness_cohort_claim(uuid, uuid),
  app.advance_owner_kemerbet_readiness_cohort_claim(uuid, uuid, uuid, text),
  app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid, uuid, text, text)
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
  app.prepare_owner_kemerbet_readiness_cohort_claim(uuid, uuid),
  app.advance_owner_kemerbet_readiness_cohort_claim(uuid, uuid, uuid, text),
  app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid, uuid, text, text)
to fetanagent_owner_control;

comment on table app.private_owner_kemerbet_readiness_cohort_claims is
  'Private one-active-at-a-time claim history for the globally exact five-Player KemerBet no-transfer readiness cohort. A failed terminal claim permits a fresh request; the first succeeded claim permanently closes the one-use lifecycle. Terminal claims remain immutable history; no row contains a raw Player ID.';
comment on column app.private_owner_kemerbet_readiness_cohort_claims.actor_admin_id is
  'Immutable UUID snapshot of the active Owner validated under the gate. Deliberately has no live admin FK, preventing a pre-gate Owner lock from inverting the singleton-gate order.';
comment on table app.private_owner_kemerbet_readiness_cohort_members is
  'Private immutable five-member claim lineage using Player-account and eligibility-decision UUIDs only; raw Player IDs are joined only inside the Owner server procedure.';
comment on table app.private_owner_kemerbet_readiness_cohort_requests is
  'Immutable same-request claim binding with a validated Owner UUID snapshot and no live admin FK; terminally failed request replay is rejected, a fresh request may retry only after failure, and no fresh request is accepted after success.';
comment on table app.private_owner_kemerbet_readiness_cohort_receipts is
  'Private immutable root-receipt ledger. It contains only claim/receipt UUIDs, fixed event/failure codes, and time; it never stores Player IDs, payload digests, Owner identity, or request identity.';
comment on function app.prepare_owner_kemerbet_readiness_cohort_claim(uuid, uuid) is
  'Authenticated Owner-only exact-five global claim and server payload. It requires the exact disabled five-switch/no-open-pilot boundary and exactly one active configured KemerBet agent profile. Same-request success replay is revalidated, but success permanently rejects fresh requests; it never creates a deposit, contacts KemerBet, or returns identifiers to the browser.';
comment on function app.require_private_owner_kemerbet_readiness_safe_boundary() is
  'Ungrantable lock-free invariant check used only after the singleton gate: all five money switches disabled, no draft/armed private live pilot, and exactly one active non-retired KemerBet agent-profile revision v1.';
comment on function app.advance_owner_kemerbet_readiness_cohort_claim(uuid, uuid, uuid, text) is
  'Owner-bound exported marker after durable server staging. Imported/succeeded root races are semantic exported replays; terminal failures are rejected.';
comment on function app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid, uuid, text, text) is
  'Exact Owner-control runtime bridge for immutable root control-volume receipts. It has no Owner/request parameter, supports crash-window imported/completed transitions, and performs no financial action.';

commit;
