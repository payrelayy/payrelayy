-- Dormant atomic selection after a signed, accepted read-only KemerBet Find.
-- This function is not granted to the bridge or bot. It cannot move money.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_player_validation_created_beneficiaries (
  player_account_id uuid primary key
    references app.customer_platform_players (id) on delete restrict,
  beneficiary_customer_id uuid not null unique
    references app.customers (id) on delete restrict,
  validation_result_id text not null unique
    references app.telegram_player_validation_results (result_id) on delete restrict,
  created_at timestamptz not null
);

create table app.telegram_player_validation_finalizations (
  validation_request_id uuid primary key
    references app.telegram_player_validation_requests (id) on delete restrict,
  validation_result_id text not null unique
    references app.telegram_player_validation_results (result_id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  origin_inbound_event_id uuid not null unique
    references app.inbound_events (id) on delete restrict,
  selected_at timestamptz not null
);
create index telegram_player_validation_finalizations_player_idx
  on app.telegram_player_validation_finalizations (player_account_id, selected_at desc);

create trigger telegram_player_validation_created_beneficiaries_immutable
  before update or delete on app.telegram_player_validation_created_beneficiaries
  for each row execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_created_beneficiaries_no_truncate
  before truncate on app.telegram_player_validation_created_beneficiaries
  for each statement execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_finalizations_immutable
  before update or delete on app.telegram_player_validation_finalizations
  for each row execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_finalizations_no_truncate
  before truncate on app.telegram_player_validation_finalizations
  for each statement execute function app.reject_telegram_player_validation_evidence_mutation();

-- The request function already serializes on the Telegram identity and supersedes pending
-- requests. A later request must also supersede an accepted-but-not-selected Find.
create function app.supersede_unselected_telegram_player_validation()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  update app.telegram_player_validation_requests request
     set status = 'superseded', completed_at = new.requested_at
   where request.telegram_identity_id = new.telegram_identity_id
     and request.status = 'validated'
     and not exists (
       select 1 from app.telegram_player_validation_finalizations finalization
        where finalization.validation_request_id = request.id
     );
  return new;
end;
$$;
create trigger telegram_player_validation_new_request_supersedes
  before insert on app.telegram_player_validation_requests
  for each row execute function app.supersede_unselected_telegram_player_validation();

create function app.finalize_telegram_player_validation(p_validation_request_id uuid)
returns table (finalization_state text, selected_player_id text)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_now timestamptz;
  v_identity_id uuid;
  v_customer_id uuid;
  v_request app.telegram_player_validation_requests%rowtype;
  v_result app.telegram_player_validation_results%rowtype;
  v_finalization app.telegram_player_validation_finalizations%rowtype;
  v_selection_origin uuid;
  v_platform_id uuid;
  v_player app.customer_platform_players%rowtype;
  v_beneficiary_status app.record_status;
  v_new_beneficiary_customer_id uuid;
  v_decision_count integer;
  v_max_decision_version integer;
  v_latest_decision app.player_deposit_eligibility_decisions%rowtype;
  v_attempt_number integer;
  v_attempt_id uuid;
  v_new_decision_id uuid;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_validation_request_id is null then return; end if;

  select request.telegram_identity_id into v_identity_id
    from app.telegram_player_validation_requests request
   where request.id = p_validation_request_id;
  if v_identity_id is null then return; end if;
  perform 1 from app.customer_identities identity
   where identity.id = v_identity_id for update;
  select identity.customer_id into v_customer_id
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
   where identity.id = v_identity_id
     and identity.identity_kind = 'telegram' and identity.status = 'active'
     and customer.status = 'active'
     and identity.external_subject = telegram_identity.telegram_user_id::text
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
   for share of customer, telegram_identity;
  if v_customer_id is null then return; end if;
  select request.* into v_request
    from app.telegram_player_validation_requests request
   where request.id = p_validation_request_id
     and request.telegram_identity_id = v_identity_id
   for update;
  select finalization.* into v_finalization
    from app.telegram_player_validation_finalizations finalization
   where finalization.validation_request_id = p_validation_request_id;
  if v_finalization.validation_request_id is not null then
    select player.player_id into selected_player_id
      from app.customer_platform_players player
     where player.id = v_finalization.player_account_id;
    finalization_state := 'already_selected';
    return next;
    return;
  end if;
  if v_request.status <> 'validated' then return; end if;
  select result.* into v_result
    from app.telegram_player_validation_results result
   where result.validation_request_id = v_request.id
     and result.outcome = 'found'
   for share;
  if v_result.result_id is null then return; end if;
  select selection.origin_inbound_event_id into v_selection_origin
    from app.telegram_player_selections selection
   where selection.telegram_identity_id = v_identity_id for update;
  if v_selection_origin is distinct from v_request.selection_origin_inbound_event_id
    or exists (
      select 1 from app.telegram_player_validation_requests newer
       where newer.telegram_identity_id = v_identity_id
         and newer.id <> v_request.id
         and newer.requested_at >= v_request.requested_at
    ) then
    update app.telegram_player_validation_requests request
       set status = 'review_required'
     where request.id = v_request.id;
    finalization_state := 'review_required';
    return next;
    return;
  end if;

  -- The same Player may be selected by several Telegram accounts. Serialize creation by
  -- platform Player ID, and never attach a new Player to the first payer's customer row.
  perform pg_catalog.pg_advisory_xact_lock(
    193747, pg_catalog.hashtext(v_request.player_id));
  select platform.id into v_platform_id
    from app.platforms platform
   where platform.code = 'kemerbet' and platform.status = 'active'
   for share;
  if v_platform_id is null then return; end if;
  select player.* into v_player
    from app.customer_platform_players player
   where player.platform_id = v_platform_id
     and player.player_id = v_request.player_id
   for update;
  if v_player.id is null then
    insert into app.customers default values
      returning id into v_new_beneficiary_customer_id;
    insert into app.customer_platform_players (
      customer_id, platform_id, player_id
    ) values (
      v_new_beneficiary_customer_id, v_platform_id, v_request.player_id
    ) returning * into v_player;
  else
    select beneficiary.status into v_beneficiary_status
      from app.customers beneficiary
     where beneficiary.id = v_player.customer_id
     for share;
    if v_player.status <> 'active'
      or v_beneficiary_status is distinct from 'active'
      or v_player.validation_status not in ('unverified', 'valid') then
      update app.telegram_player_validation_requests request
         set status = 'review_required'
       where request.id = v_request.id;
      finalization_state := 'review_required';
      return next;
      return;
    end if;
  end if;

  select count(*)::integer, coalesce(max(decision.decision_version), 0)
    into v_decision_count, v_max_decision_version
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = v_player.id;
  select decision.* into v_latest_decision
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = v_player.id
   order by decision.decision_version desc limit 1 for share;
  if v_decision_count <> v_max_decision_version
    or (v_decision_count > 0 and (
      v_latest_decision.decision <> 'eligible'
      or v_latest_decision.reason_code <> 'financial_eligibility_approved'
      or v_player.validation_status <> 'valid'
      or v_latest_decision.player_account_updated_at_snapshot
         is distinct from v_player.updated_at
    )) then
    update app.telegram_player_validation_requests request
       set status = 'review_required'
     where request.id = v_request.id;
    finalization_state := 'review_required';
    return next;
    return;
  end if;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_player.validation_status = 'unverified' then
    select coalesce(max(attempt.attempt_number), 0) + 1
      into v_attempt_number
      from app.player_validation_attempts attempt
     where attempt.player_account_id = v_player.id;
    insert into app.player_validation_attempts (
      player_account_id, attempt_number, outcome, reason_code, adapter_version,
      started_at, completed_at, result_digest
    ) values (
      v_player.id, v_attempt_number, 'valid',
      'signed_exact_id_empty_etb_form', 'telegram_companion_player_validation_v1',
      v_now, v_now, v_result.result_body_digest
    ) returning id into v_attempt_id;
    update app.customer_platform_players player
       set validation_status = 'valid'
     where player.id = v_player.id and player.validation_status = 'unverified';
    if not found then raise exception 'The signed Player validation changed concurrently.'; end if;
    select player.* into v_player
      from app.customer_platform_players player where player.id = v_player.id;
  end if;
  if v_decision_count = 0 then
    insert into app.player_deposit_eligibility_decisions (
      player_account_id, decision_version, decision, reason_code, actor_kind,
      player_account_updated_at_snapshot, decided_at, created_at
    ) values (
      v_player.id, 1, 'eligible', 'financial_eligibility_approved', 'system',
      v_player.updated_at, v_now, v_now
    ) returning id into v_new_decision_id;
  end if;
  if v_new_beneficiary_customer_id is not null then
    insert into app.telegram_player_validation_created_beneficiaries (
      player_account_id, beneficiary_customer_id, validation_result_id, created_at
    ) values (
      v_player.id, v_new_beneficiary_customer_id, v_result.result_id, v_now
    );
  end if;
  insert into app.telegram_player_validation_finalizations (
    validation_request_id, validation_result_id, player_account_id,
    origin_inbound_event_id, selected_at
  ) values (
    v_request.id, v_result.result_id, v_player.id,
    v_request.origin_inbound_event_id, v_now
  );
  insert into app.telegram_player_selections (
    telegram_identity_id, player_account_id, origin_inbound_event_id, selected_at
  ) values (
    v_identity_id, v_player.id, v_request.origin_inbound_event_id, v_now
  ) on conflict (telegram_identity_id) do update
    set player_account_id = excluded.player_account_id,
        origin_inbound_event_id = excluded.origin_inbound_event_id,
        selected_at = excluded.selected_at;
  insert into app.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) values (
    'system', 'customer.telegram_player_signed_auto_selection',
    'customer_platform_player', v_player.id,
    pg_catalog.jsonb_build_object(
      'validation_request_id', v_request.id,
      'validation_result_id', v_result.result_id,
      'new_beneficiary_created', v_new_beneficiary_customer_id is not null,
      'new_eligibility_decision_id', v_new_decision_id,
      'validation_attempt_id', v_attempt_id,
      'payment_started', false
    )
  );
  finalization_state := 'selected';
  selected_player_id := v_request.player_id;
  return next;
end;
$$;

alter table app.telegram_player_validation_created_beneficiaries owner to postgres;
alter table app.telegram_player_validation_finalizations owner to postgres;
alter table app.telegram_player_validation_created_beneficiaries enable row level security;
alter table app.telegram_player_validation_created_beneficiaries force row level security;
alter table app.telegram_player_validation_finalizations enable row level security;
alter table app.telegram_player_validation_finalizations force row level security;
alter function app.supersede_unselected_telegram_player_validation() owner to postgres;
alter function app.finalize_telegram_player_validation(uuid) owner to postgres;
revoke all on table app.telegram_player_validation_created_beneficiaries,
  app.telegram_player_validation_finalizations
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all on function app.supersede_unselected_telegram_player_validation(),
  app.finalize_telegram_player_validation(uuid)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on function app.finalize_telegram_player_validation(uuid) is
  'Dormant atomic shared-beneficiary selection after one signed Find; never overrides revocation or moves money.';
commit;
