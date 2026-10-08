-- A receipt can precede the customer's reference submission. A paid routine intent
-- therefore needs a receipt-time opening, not the default current-time opening.
-- This migration creates only the protected snapshot boundary. No role can insert
-- an opening, and no payment claim, execution job, or live switch is changed here.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Every existing challenge was issued by the no-money path. A future paid
-- issuer must explicitly stamp 'paid'; an old rehearsal can never be settled.
alter table app.routine_telebirr_lookup_challenges
  add column issuance_mode text not null default 'no_money'
  check (issuance_mode in ('no_money', 'paid'));

create table app.routine_telebirr_paid_intent_openings (
  challenge_id uuid primary key,
  candidate_id uuid not null unique,
  deposit_intent_id uuid not null unique,
  authorization_id uuid not null
    references app.routine_telebirr_processing_authorizations(id) on delete restrict,
  player_account_id uuid not null references app.customer_platform_players(id) on delete restrict,
  payment_provider_id uuid not null references app.payment_providers(id) on delete restrict,
  receiver_account_id uuid not null references app.receiver_accounts(id) on delete restrict,
  receiver_account_version integer not null check (receiver_account_version > 0),
  reference_fingerprint text not null check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  observation_body_digest text not null unique
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_document_digest text not null
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  submitted_at timestamptz not null,
  challenge_issued_at timestamptz not null,
  observed_at timestamptz not null,
  occurred_at timestamptz not null,
  amount_minor bigint not null check (amount_minor between 2500 and 2500000),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_paid_opening_provider_reference_unique
    unique (payment_provider_id, reference_fingerprint),
  constraint routine_paid_opening_provider_document_unique
    unique (payment_provider_id, source_document_digest),
  constraint routine_paid_opening_receiver_provider_fkey
    foreign key (receiver_account_id, payment_provider_id, receiver_account_version)
    references app.receiver_accounts(id, provider_id, version) on delete restrict,
  constraint routine_paid_opening_time_check check (
    challenge_issued_at >= submitted_at
    and observed_at >= challenge_issued_at
    and observed_at <= challenge_issued_at + interval '5 minutes'
    and occurred_at between submitted_at - interval '1 hour'
                        and submitted_at + interval '5 minutes'
    and occurred_at <= observed_at
    and recorded_at >= observed_at - interval '5 minutes'
    and recorded_at < occurred_at + interval '1 hour'
  )
);

create index routine_paid_opening_player_idx
  on app.routine_telebirr_paid_intent_openings(player_account_id);
create index routine_paid_opening_authorization_idx
  on app.routine_telebirr_paid_intent_openings(authorization_id);
create index routine_paid_opening_receiver_idx
  on app.routine_telebirr_paid_intent_openings(receiver_account_id);

create trigger routine_paid_opening_immutable
before update or delete on app.routine_telebirr_paid_intent_openings
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
create trigger routine_paid_opening_no_truncate
before truncate on app.routine_telebirr_paid_intent_openings
for each statement execute function app.reject_routine_telebirr_untrusted_proof_mutation();

alter table app.routine_telebirr_paid_intent_openings owner to postgres;
alter table app.routine_telebirr_paid_intent_openings enable row level security;
alter table app.routine_telebirr_paid_intent_openings force row level security;
revoke all on table app.routine_telebirr_paid_intent_openings
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

alter table app.deposit_intents
  add column routine_telebirr_paid_opening_challenge_id uuid unique
  references app.routine_telebirr_paid_intent_openings(challenge_id) on delete restrict;
alter table app.deposit_intents
  add constraint deposit_intent_single_receipt_derived_origin check (
    routine_telebirr_paid_opening_challenge_id is null
    or private_live_telebirr_outcome_id is null
  );

-- The original snapshotter remains byte-for-byte unchanged for historical and
-- private-pilot intents. Only an explicitly linked paid routine intent uses the
-- new trigger. A foreign key alone cannot authorize that insert: the snapshotter
-- checks all opening, Player, receiver, and active policy fields again.
drop trigger deposit_intents_populate_snapshot on app.deposit_intents;
create trigger deposit_intents_populate_snapshot
before insert on app.deposit_intents
for each row when (new.routine_telebirr_paid_opening_challenge_id is null)
execute function app.populate_deposit_intent_snapshot();

create function app.populate_routine_telebirr_paid_intent_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  opening app.routine_telebirr_paid_intent_openings%rowtype;
  player app.customer_platform_players%rowtype;
  platform app.platforms%rowtype;
  provider app.payment_providers%rowtype;
  receiver app.receiver_accounts%rowtype;
  policy app.deposit_policy_versions%rowtype;
  authority app.routine_telebirr_processing_authorizations%rowtype;
  assessed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'The routine TeleBirr paid intent snapshot is unavailable.';
  end if;
  select item.* into opening
    from app.routine_telebirr_paid_intent_openings item
   where item.challenge_id = new.routine_telebirr_paid_opening_challenge_id
     and item.deposit_intent_id = new.id for share;
  select account.* into player
    from app.customer_platform_players account
   where account.id = opening.player_account_id for share;
  select item.* into platform from app.platforms item
   where item.id = player.platform_id for share;
  select item.* into provider from app.payment_providers item
   where item.id = opening.payment_provider_id for share;
  select item.* into receiver from app.receiver_accounts item
   where item.id = opening.receiver_account_id
     and item.provider_id = opening.payment_provider_id
     and item.version = opening.receiver_account_version for share;
  select item.* into policy from app.deposit_policy_versions item
   where item.status = 'active' for share;
  select item.* into authority from app.routine_telebirr_processing_authorizations item
   where item.id = opening.authorization_id for share;

  if opening.challenge_id is null
    or player.id is null or player.status <> 'active'
    or player.validation_status <> 'valid'
    or platform.id is null or platform.status <> 'active'
    or provider.id is null or provider.code <> 'telebirr' or provider.status <> 'active'
    or receiver.id is null or receiver.status <> 'active'
    or receiver.retired_at is not null
    or receiver.active_from > opening.occurred_at
    or policy.id is null or policy.freshness_window_seconds <> 3600
    or authority.id is null
    or authority.deposit_policy_version_id is distinct from policy.id
    or authority.minimum_amount_minor is distinct from policy.minimum_amount_minor
    or authority.maximum_amount_minor is distinct from policy.maximum_amount_minor
    or authority.freshness_window_seconds is distinct from policy.freshness_window_seconds
    or opening.occurred_at < authority.authorized_at
    or opening.submitted_at < authority.authorized_at
    or not exists (
      select 1 from app.routine_telebirr_processing_events event
       where event.authorization_id = authority.id
         and event.event_kind = 'authorize'
         and event.event_sequence = (
           select pg_catalog.max(latest.event_sequence)
             from app.routine_telebirr_processing_events latest
         )
    )
    or not exists (
      select 1 from app.admin_users owner_user
       where owner_user.id = authority.authorized_by_admin_id
         and owner_user.role = 'owner' and owner_user.status = 'active'
    )
    or not exists (
      select 1 from app.platform_agent_accounts agent
       where agent.id = authority.platform_agent_account_id
         and agent.platform_id = platform.id and agent.status = 'active'
    )
    or assessed_at < opening.recorded_at - interval '5 minutes'
    or opening.challenge_issued_at > assessed_at
    or opening.observed_at > assessed_at + interval '5 minutes'
    or opening.occurred_at > assessed_at + interval '5 minutes'
    or assessed_at >= opening.occurred_at + interval '1 hour'
    or new.customer_id is distinct from player.customer_id
    or new.platform_id is distinct from player.platform_id
    or new.player_account_id is distinct from player.id
    or new.payment_provider_id is distinct from provider.id
    or new.receiver_account_id is distinct from receiver.id
    or new.expected_amount_minor is distinct from opening.amount_minor
    or new.origin_inbound_event_id is not null
    or new.private_live_telebirr_outcome_id is not null
    or opening.amount_minor not between policy.minimum_amount_minor
                                    and policy.maximum_amount_minor then
    raise exception 'The routine TeleBirr paid intent snapshot is unavailable.';
  end if;

  new.receiver_account_version := receiver.version;
  new.receiver_account_holder_name_snapshot := receiver.account_holder_name;
  new.receiver_account_masked_snapshot := receiver.account_reference_masked;
  new.receiver_instructions_snapshot := receiver.instructions;
  new.deposit_policy_version_id := policy.id;
  new.deposit_policy_version := policy.version;
  new.minimum_amount_minor := policy.minimum_amount_minor;
  new.maximum_amount_minor := policy.maximum_amount_minor;
  new.freshness_window_seconds := policy.freshness_window_seconds;
  new.currency_code := 'ETB';
  new.opened_at := opening.occurred_at;
  new.payment_deadline_at := opening.occurred_at + interval '1 hour';
  new.status := 'intake_received';
  new.status_changed_at := assessed_at;
  new.verified_at := null;
  new.rejection_reason_code := null;
  return new;
end;
$$;

alter function app.populate_routine_telebirr_paid_intent_snapshot() owner to postgres;
revoke all on function app.populate_routine_telebirr_paid_intent_snapshot()
  from public, anon, authenticated, service_role;
create trigger deposit_intents_populate_routine_paid_snapshot
before insert on app.deposit_intents
for each row when (new.routine_telebirr_paid_opening_challenge_id is not null)
execute function app.populate_routine_telebirr_paid_intent_snapshot();

create function app.reject_routine_telebirr_paid_intent_link_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.routine_telebirr_paid_opening_challenge_id
       is distinct from old.routine_telebirr_paid_opening_challenge_id then
    raise exception 'The routine TeleBirr paid intent opening is immutable.';
  end if;
  return new;
end;
$$;
alter function app.reject_routine_telebirr_paid_intent_link_mutation() owner to postgres;
revoke all on function app.reject_routine_telebirr_paid_intent_link_mutation()
  from public, anon, authenticated, service_role;
create trigger deposit_intents_paid_opening_immutable
before update on app.deposit_intents
for each row execute function app.reject_routine_telebirr_paid_intent_link_mutation();

comment on table app.routine_telebirr_paid_intent_openings is
  'Unreachable until a separate reviewed paid producer records one signed official-receipt opening. It preserves receipt-time intent bounds and global reference uniqueness; not itself a payment claim.';
comment on function app.populate_routine_telebirr_paid_intent_snapshot() is
  'Receipt-time snapshot for separately approved routine paid openings. Cannot create an opening, claim, job, or credit by itself.';

commit;
