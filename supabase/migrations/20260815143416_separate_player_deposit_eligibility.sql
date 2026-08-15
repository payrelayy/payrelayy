-- Stage 1I: separate a validated Player-ID binding from financial deposit eligibility.
--
-- A valid customer_platform_players row represents only the existing account association. Every new
-- deposit intent must additionally snapshot the latest immutable eligibility decision for that
-- exact player. No decision is seeded here, no write procedure is exposed, and every financial
-- feature switch remains disabled.

begin;

create table app.player_deposit_eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  decision_version integer not null check (decision_version > 0),
  decision text not null check (decision in ('eligible', 'revoked')),
  reason_code text not null,
  actor_kind app.actor_kind not null
    check (actor_kind in ('admin', 'system', 'worker')),
  actor_admin_id uuid references app.admin_users (id) on delete restrict,
  player_account_updated_at_snapshot timestamptz not null,
  decided_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint player_deposit_eligibility_decisions_player_version_key
    unique (player_account_id, decision_version),
  constraint player_deposit_eligibility_decisions_id_player_key
    unique (id, player_account_id),
  constraint player_deposit_eligibility_decisions_reason_check check (
    (decision = 'eligible' and reason_code = 'financial_eligibility_approved')
    or (decision = 'revoked' and reason_code = 'financial_eligibility_revoked')
  ),
  constraint player_deposit_eligibility_decisions_actor_check check (
    (actor_kind = 'admin' and actor_admin_id is not null)
    or (actor_kind in ('system', 'worker') and actor_admin_id is null)
  ),
  constraint player_deposit_eligibility_decisions_time_shape_check
    check (decided_at = created_at)
);

create index player_deposit_eligibility_decisions_actor_created_idx
  on app.player_deposit_eligibility_decisions (actor_admin_id, created_at desc)
  where actor_admin_id is not null;

create function app.enforce_player_deposit_eligibility_decision_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  decision_time timestamptz;
  expected_decision_version integer;
  existing_decision_count integer;
  existing_maximum_version integer;
  locked_player app.customer_platform_players%rowtype;
  player_platform app.platforms%rowtype;
  previous_decided_at timestamptz;
begin
  if new.player_account_id is null or new.decision_version is null then
    raise exception 'A player deposit-eligibility decision requires a player and explicit version.';
  end if;

  -- This player-row lock is the serialization boundary shared with new deposit intents. A
  -- concurrent decision therefore becomes visible before an intent checks eligibility, or waits
  -- until an already-checked intent has durably snapshotted its decision.
  select player_account.*
    into locked_player
    from app.customer_platform_players player_account
   where player_account.id = new.player_account_id
   for update;

  if not found then
    raise exception 'The player deposit-eligibility decision references an unknown player.';
  end if;

  select platform.*
    into player_platform
    from app.platforms platform
   where platform.id = locked_player.platform_id;

  if not found then
    raise exception 'The player deposit-eligibility decision references an unknown platform.';
  end if;

  if new.decision = 'eligible'
    and (
      locked_player.status <> 'active'
      or locked_player.validation_status <> 'valid'
      or player_platform.status <> 'active'
    ) then
    raise exception
      'An eligible deposit decision requires an active, validated player account and platform.';
  end if;

  select count(*)::integer, coalesce(max(decision.decision_version), 0)
    into existing_decision_count, existing_maximum_version
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = new.player_account_id;

  if existing_decision_count <> existing_maximum_version then
    raise exception 'The Player-ID deposit-eligibility decision history is invalid.';
  end if;

  select decision.decided_at
    into previous_decided_at
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = new.player_account_id
   order by decision.decision_version desc
   limit 1;

  expected_decision_version := existing_maximum_version + 1;

  if new.decision_version <> expected_decision_version then
    raise exception
      'Player deposit-eligibility decisions require exact sequential versions; expected %.',
      expected_decision_version;
  end if;

  decision_time := clock_timestamp();
  if previous_decided_at is not null and decision_time < previous_decided_at then
    raise exception 'Player deposit-eligibility decision time cannot precede its prior version.';
  end if;
  if new.decision = 'eligible' and decision_time < locked_player.updated_at then
    raise exception 'Player deposit-eligibility decision time cannot precede its source state.';
  end if;

  -- Eligibility becomes authoritative only at this server-authored instant. Caller-supplied
  -- timestamps and the player-state snapshot are deliberately ignored so audit chronology cannot
  -- be forged, future-dated, or silently revived after a later player-state change.
  new.player_account_updated_at_snapshot := locked_player.updated_at;
  new.decided_at := decision_time;
  new.created_at := decision_time;

  return new;
end;
$$;

create trigger player_deposit_eligibility_decisions_enforce_insert
before insert on app.player_deposit_eligibility_decisions
for each row
execute function app.enforce_player_deposit_eligibility_decision_insert();

create function app.reject_player_deposit_eligibility_decision_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  raise exception 'Player deposit-eligibility decisions are append-only.';
end;
$$;

create trigger player_deposit_eligibility_decisions_immutable
before update or delete on app.player_deposit_eligibility_decisions
for each row
execute function app.reject_player_deposit_eligibility_decision_mutation();

create trigger player_deposit_eligibility_decisions_no_truncate
before truncate on app.player_deposit_eligibility_decisions
for each statement
execute function app.reject_player_deposit_eligibility_decision_mutation();

alter table app.deposit_intents
  add column player_deposit_eligibility_decision_id uuid;

alter table app.deposit_intents
  add constraint deposit_intents_player_eligibility_decision_fkey
  foreign key (player_deposit_eligibility_decision_id, player_account_id)
  references app.player_deposit_eligibility_decisions (id, player_account_id)
  on delete restrict;

create index deposit_intents_player_eligibility_decision_idx
  on app.deposit_intents (player_deposit_eligibility_decision_id)
  where player_deposit_eligibility_decision_id is not null;

create function app.require_player_deposit_eligibility_for_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  decision_count integer;
  locked_player app.customer_platform_players%rowtype;
  maximum_decision_version integer;
  latest_decision app.player_deposit_eligibility_decisions%rowtype;
  player_platform app.platforms%rowtype;
begin
  if new.player_account_id is null then
    raise exception 'A deposit intent requires a player account.';
  end if;

  -- Decision inserts take this same lock before appending a new version. The latest-decision read
  -- below is consequently race-free without coupling eligibility to ownership validation.
  select player_account.*
    into locked_player
    from app.customer_platform_players player_account
   where player_account.id = new.player_account_id
   for update;

  if not found then
    raise exception 'A deposit intent requires an existing player account.';
  end if;

  select platform.*
    into player_platform
    from app.platforms platform
   where platform.id = locked_player.platform_id;

  if not found then
    raise exception 'A deposit intent requires an existing player platform.';
  end if;

  select count(*)::integer, coalesce(max(decision.decision_version), 0)
    into decision_count, maximum_decision_version
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = new.player_account_id;

  select decision.*
    into latest_decision
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = new.player_account_id
   order by decision.decision_version desc
   limit 1;

  if decision_count = 0 then
    raise exception 'A deposit intent requires a current Player-ID deposit-eligibility decision.';
  end if;

  if maximum_decision_version <> decision_count
    or latest_decision.decision_version <> maximum_decision_version
    or latest_decision.decided_at > clock_timestamp() then
    raise exception 'The Player-ID deposit-eligibility decision history is invalid.';
  end if;

  if latest_decision.decision <> 'eligible'
    or locked_player.status <> 'active'
    or locked_player.validation_status <> 'valid'
    or player_platform.status <> 'active'
    or latest_decision.player_account_updated_at_snapshot
       is distinct from locked_player.updated_at then
    raise exception 'A deposit intent requires a current Player-ID deposit-eligibility decision.';
  end if;

  -- Never trust a caller-supplied snapshot. Always bind the intent to the exact latest eligible
  -- decision observed while holding the shared player serialization lock.
  new.player_deposit_eligibility_decision_id := latest_decision.id;
  return new;
end;
$$;

-- PostgreSQL runs same-kind triggers in name order. "enforce" sorts before the existing
-- deposit_intents_populate_snapshot trigger, so eligibility fails before receiver/policy snapshot
-- work. Correctness does not rely on that convenience: both triggers independently validate and
-- lock the player row before allowing the insert.
create trigger deposit_intents_enforce_player_deposit_eligibility
before insert on app.deposit_intents
for each row
execute function app.require_player_deposit_eligibility_for_intent();

create function app.enforce_deposit_intent_eligibility_snapshot_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.player_deposit_eligibility_decision_id
    is distinct from old.player_deposit_eligibility_decision_id then
    raise exception 'A deposit intent eligibility snapshot is immutable.';
  end if;

  return new;
end;
$$;

create trigger deposit_intents_enforce_eligibility_snapshot_immutable
before update on app.deposit_intents
for each row
execute function app.enforce_deposit_intent_eligibility_snapshot_immutable();

alter table app.player_deposit_eligibility_decisions enable row level security;
alter table app.player_deposit_eligibility_decisions force row level security;

revoke all on table app.player_deposit_eligibility_decisions
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime;

revoke all on function app.enforce_player_deposit_eligibility_decision_insert()
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke all on function app.reject_player_deposit_eligibility_decision_mutation()
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke all on function app.require_player_deposit_eligibility_for_intent()
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke all on function app.enforce_deposit_intent_eligibility_snapshot_immutable()
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_beta_admission, fetanagent_beta_admission_runtime,
       fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker,
       fetanagent_customer_web, fetanagent_customer_web_runtime;

comment on table app.player_deposit_eligibility_decisions is
  'Private append-only Player-ID financial-eligibility ledger. The latest sequential decision is authoritative for new deposit intents; no runtime role can read or write it directly.';
comment on column app.deposit_intents.player_deposit_eligibility_decision_id is
  'Exact immutable eligibility decision snapshotted for a new intent. NULL is reserved only for rows that predate the eligibility boundary.';
comment on function app.require_player_deposit_eligibility_for_intent() is
  'Canonical ungranted BEFORE INSERT guard for direct, live, and dry-run deposit intents. It serializes with decision appends and snapshots only the latest eligible decision.';

commit;
