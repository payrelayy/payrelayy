-- A receiver SMS may precede the customer's submission. The dedicated opening
-- retains that true payment time; the legacy receipt opening is unchanged.
-- No function in this migration can claim a payment or enqueue a Player credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.receiver_sms_payment_matches
  add constraint receiver_sms_matches_pair_key unique (candidate_id, payment_event_id);

create table app.receiver_sms_intent_openings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  candidate_id uuid not null unique,
  payment_event_id uuid not null unique,
  deposit_intent_id uuid not null unique,
  authorization_id uuid not null
    references app.routine_telebirr_processing_authorizations (id) on delete restrict,
  opened_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (candidate_id, payment_event_id)
    references app.receiver_sms_payment_matches (candidate_id, payment_event_id)
    on delete restrict
);
create trigger receiver_sms_intent_openings_immutable
before update or delete on app.receiver_sms_intent_openings
for each row execute function app.reject_provider_payment_evidence_mutation();
alter table app.receiver_sms_intent_openings enable row level security;
alter table app.receiver_sms_intent_openings force row level security;
alter table app.receiver_sms_intent_openings owner to postgres;
revoke all on app.receiver_sms_intent_openings
  from public, anon, authenticated, service_role;

alter table app.deposit_intents
  add column receiver_sms_opening_id uuid unique
    references app.receiver_sms_intent_openings (id) on delete restrict;
alter table app.deposit_intents
  add constraint deposit_intent_single_sms_or_receipt_origin check (
    pg_catalog.num_nonnulls(receiver_sms_opening_id,
      routine_telebirr_paid_opening_challenge_id, private_live_telebirr_outcome_id) <= 1
  );

drop trigger deposit_intents_populate_snapshot on app.deposit_intents;
create trigger deposit_intents_populate_snapshot
before insert on app.deposit_intents
for each row when (new.routine_telebirr_paid_opening_challenge_id is null
  and new.receiver_sms_opening_id is null)
execute function app.populate_deposit_intent_snapshot();

create function app.populate_receiver_sms_intent_snapshot()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_opening app.receiver_sms_intent_openings%rowtype;
  v_match app.receiver_sms_payment_matches%rowtype;
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_event app.receiver_sms_payment_events%rowtype;
  v_control app.receiver_sms_route_control%rowtype;
  v_player app.customer_platform_players%rowtype;
  v_platform app.platforms%rowtype;
  v_provider app.payment_providers%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_policy app.deposit_policy_versions%rowtype;
  v_authority app.routine_telebirr_processing_authorizations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_switch_count integer;
begin
  if session_user not in ('postgres', 'fetanagent_receiver_sms_settlement_runtime') then
    raise exception using errcode = '42501',
      message = 'The receiver SMS deposit snapshot is unavailable.';
  end if;
  select * into v_opening from app.receiver_sms_intent_openings opening
    where opening.id = new.receiver_sms_opening_id
      and opening.deposit_intent_id = new.id for share;
  select * into v_match from app.receiver_sms_payment_matches matched
    where matched.candidate_id = v_opening.candidate_id
      and matched.payment_event_id = v_opening.payment_event_id for share;
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = v_opening.candidate_id for share;
  select * into v_event from app.receiver_sms_payment_events event
    where event.id = v_opening.payment_event_id for share;
  select * into v_control from app.receiver_sms_route_control where singleton for share;
  select * into v_player from app.customer_platform_players player
    where player.id = v_candidate.player_account_id for share;
  select * into v_platform from app.platforms platform
    where platform.id = v_candidate.platform_id for share;
  select * into v_provider from app.payment_providers provider
    where provider.id = v_event.payment_provider_id for share;
  select * into v_receiver from app.receiver_accounts receiver
    where receiver.id = v_event.receiver_account_id for share;
  select * into v_policy from app.deposit_policy_versions policy
    where policy.status = 'active' for share;
  select * into v_authority from app.routine_telebirr_processing_authorizations authority
    where authority.id = v_opening.authorization_id for share;
  select pg_catalog.count(*)::integer into v_switch_count
    from app.feature_switches feature
    where (feature.feature_key in ('payment_verification','deposit_execution')
      and feature.mode = 'live')
      or (v_candidate.provider_code = 'cbe_birr'
        and feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live');
  if v_opening.id is null or v_match.candidate_id is null
    or v_match.disposition <> 'ready'
    or v_candidate.id is null or v_event.id is null
    or v_control.enabled is distinct from true
    or v_candidate.submitted_at < v_control.cutover_at
    or v_event.received_at < v_control.cutover_at
    or v_event.recorded_at < v_control.cutover_at
    or v_candidate.provider_code is distinct from v_event.provider_code
    or v_candidate.payment_provider_id is distinct from v_event.payment_provider_id
    or v_candidate.reference_fingerprint is distinct from v_event.reference_fingerprint
    or v_candidate.reference_profile_version <> 2
    or exists (select 1 from app.receiver_sms_payment_conflicts conflict
      where conflict.existing_event_id = v_event.id)
    or v_event.occurred_at < v_candidate.submitted_at - interval '1 hour'
    or v_event.occurred_at > v_candidate.submitted_at + interval '5 minutes'
    or v_event.occurred_at > v_now + interval '5 minutes'
    or v_now >= v_event.occurred_at + interval '1 hour'
    or v_opening.opened_at < v_candidate.submitted_at
    or v_opening.opened_at > v_now + interval '5 seconds'
    or v_player.id is null or v_player.customer_id <> v_candidate.submitting_customer_id
    or v_player.platform_id <> v_candidate.platform_id
    or v_player.status <> 'active' or v_player.validation_status <> 'valid'
    or v_platform.id is null or v_platform.code <> 'kemerbet'
    or v_platform.status <> 'active'
    or v_provider.id is null or v_provider.code <> v_candidate.provider_code
    or v_provider.status <> 'active'
    or v_receiver.id is null or v_receiver.provider_id <> v_provider.id
    or v_receiver.version <> v_event.receiver_account_version
    or v_receiver.status <> 'active' or v_receiver.retired_at is not null
    or v_receiver.active_from > v_event.occurred_at
    or v_policy.id is null or v_policy.minimum_amount_minor <> 2500
    or v_policy.maximum_amount_minor <> 2500000
    or v_policy.freshness_window_seconds <> 3600
    or v_event.amount_minor not between v_policy.minimum_amount_minor
      and v_policy.maximum_amount_minor
    or v_authority.id is null or v_authority.authorized_at > v_event.occurred_at
    or v_authority.authorized_at > v_candidate.submitted_at
    or v_authority.deposit_policy_version_id <> v_policy.id
    or v_authority.minimum_amount_minor <> v_policy.minimum_amount_minor
    or v_authority.maximum_amount_minor <> v_policy.maximum_amount_minor
    or v_authority.freshness_window_seconds <> v_policy.freshness_window_seconds
    or not exists (select 1 from app.routine_telebirr_processing_events policy_event
      join app.admin_users owner_user
        on owner_user.id = v_authority.authorized_by_admin_id
      join app.platform_agent_accounts agent
        on agent.id = v_authority.platform_agent_account_id
      where policy_event.authorization_id = v_authority.id
        and policy_event.event_kind = 'authorize'
        and policy_event.event_sequence = (select pg_catalog.max(latest.event_sequence)
          from app.routine_telebirr_processing_events latest)
        and owner_user.role = 'owner' and owner_user.status = 'active'
        and agent.platform_id = v_platform.id and agent.status = 'active')
    or (v_candidate.provider_code = 'cbe_birr' and v_switch_count <> 3)
    or (v_candidate.provider_code = 'telebirr' and v_switch_count <> 2)
    or new.customer_id is distinct from v_candidate.submitting_customer_id
    or new.platform_id is distinct from v_platform.id
    or new.player_account_id is distinct from v_player.id
    or new.payment_provider_id is distinct from v_provider.id
    or new.receiver_account_id is distinct from v_receiver.id
    or new.expected_amount_minor is distinct from v_event.amount_minor
    or new.origin_inbound_event_id is not null
    or new.routine_telebirr_paid_opening_challenge_id is not null
    or new.private_live_telebirr_outcome_id is not null then
    raise exception 'The receiver SMS deposit snapshot is unavailable.';
  end if;
  new.receiver_account_version := v_receiver.version;
  new.receiver_account_holder_name_snapshot := v_receiver.account_holder_name;
  new.receiver_account_masked_snapshot := v_receiver.account_reference_masked;
  new.receiver_instructions_snapshot := v_receiver.instructions;
  new.deposit_policy_version_id := v_policy.id;
  new.deposit_policy_version := v_policy.version;
  new.minimum_amount_minor := v_policy.minimum_amount_minor;
  new.maximum_amount_minor := v_policy.maximum_amount_minor;
  new.freshness_window_seconds := v_policy.freshness_window_seconds;
  new.currency_code := 'ETB';
  new.opened_at := v_event.occurred_at;
  new.payment_deadline_at := v_event.occurred_at + interval '1 hour';
  new.status := 'intake_received';
  new.status_changed_at := v_now;
  new.verified_at := null;
  new.rejection_reason_code := null;
  return new;
end;
$$;
alter function app.populate_receiver_sms_intent_snapshot() owner to postgres;
revoke all on function app.populate_receiver_sms_intent_snapshot()
  from public, anon, authenticated, service_role;
create trigger deposit_intents_populate_receiver_sms_snapshot
before insert on app.deposit_intents
for each row when (new.receiver_sms_opening_id is not null)
execute function app.populate_receiver_sms_intent_snapshot();

create function app.reject_receiver_sms_intent_link_mutation()
returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.receiver_sms_opening_id is distinct from old.receiver_sms_opening_id then
    raise exception 'The receiver SMS deposit opening is immutable.';
  end if;
  return new;
end;
$$;
alter function app.reject_receiver_sms_intent_link_mutation() owner to postgres;
revoke all on function app.reject_receiver_sms_intent_link_mutation()
  from public, anon, authenticated, service_role;
create trigger deposit_intents_receiver_sms_opening_immutable
before update on app.deposit_intents
for each row execute function app.reject_receiver_sms_intent_link_mutation();

comment on table app.receiver_sms_intent_openings is
  'Immutable SMS payment-time opening for a single protected customer submission. No claim or job.';
commit;
