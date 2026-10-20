-- Post-cutover paid-phone results. Inconclusive checks never become invalid
-- payments. Decisions are serialized with paid staging/finalization/Owner stop.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_fast_result_cutover (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null
);
insert into app.routine_telebirr_fast_result_cutover values
  (true, pg_catalog.clock_timestamp());

create table app.routine_telebirr_fast_results (
  candidate_id uuid primary key references app.routine_telebirr_untrusted_proof_requests(id),
  outcome_code text not null check (outcome_code in
    ('invalid_reference', 'wrong_receiver', 'already_used',
     'unrelated_receipt', 'held_review')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  decided_at timestamptz not null default pg_catalog.clock_timestamp()
);
create trigger routine_telebirr_fast_results_immutable
before update or delete on app.routine_telebirr_fast_results
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();

create table app.routine_telebirr_fast_owner_alerts (
  id bigint generated always as identity primary key,
  alert_code text not null check (alert_code in
    ('held_review', 'receipt_layout_changed')),
  candidate_id uuid references app.routine_telebirr_untrusted_proof_requests(id),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_telebirr_fast_owner_alert_shape check (
    (alert_code = 'held_review' and candidate_id is not null)
    or (alert_code = 'receipt_layout_changed' and candidate_id is null)
  ),
  unique (alert_code, candidate_id)
);
create unique index routine_telebirr_layout_alert_once
  on app.routine_telebirr_fast_owner_alerts (alert_code)
  where alert_code = 'receipt_layout_changed';
create trigger routine_telebirr_fast_owner_alerts_immutable
before update or delete on app.routine_telebirr_fast_owner_alerts
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();

alter table app.routine_telebirr_fast_result_cutover owner to postgres;
alter table app.routine_telebirr_fast_results owner to postgres;
alter table app.routine_telebirr_fast_owner_alerts owner to postgres;
alter table app.routine_telebirr_fast_result_cutover enable row level security;
alter table app.routine_telebirr_fast_result_cutover force row level security;
alter table app.routine_telebirr_fast_results enable row level security;
alter table app.routine_telebirr_fast_results force row level security;
alter table app.routine_telebirr_fast_owner_alerts enable row level security;
alter table app.routine_telebirr_fast_owner_alerts force row level security;
revoke all on app.routine_telebirr_fast_result_cutover,
  app.routine_telebirr_fast_results,
  app.routine_telebirr_fast_owner_alerts from public, anon, authenticated,
  service_role, fetanagent_player_actions,
  fetanagent_player_actions_runtime,
  fetanagent_routine_telebirr_paid_poll,
  fetanagent_routine_telebirr_paid_poll_runtime;
revoke all on sequence app.routine_telebirr_fast_owner_alerts_id_seq
  from public, anon, authenticated, service_role;

-- A private classifier accepts only named, signed reason codes. A raw or
-- unknown phone reason remains inconclusive, including an unattested 404.
create function app.classify_routine_telebirr_fast_reason(p_reason text)
returns text language sql immutable security invoker set search_path = pg_catalog
as $$
  select case
    when p_reason in ('explicit_invalid_reference',
      'provider_status_not_completed', 'currency_mismatch',
      'amount_out_of_range') then 'invalid_reference'
    when p_reason = 'receiver_mismatch' then 'wrong_receiver'
    when p_reason in ('reference_mismatch', 'invalid_layout',
      'unknown_layout_provider_identity')
      or pg_catalog.left(p_reason, 15) = 'unknown_layout_' then 'unrelated_receipt'
    else null
  end;
$$;
alter function app.classify_routine_telebirr_fast_reason(text) owner to postgres;
revoke all on function app.classify_routine_telebirr_fast_reason(text)
  from public, anon, authenticated, service_role;

-- This resolver is invoked by the existing bot claim. It has no public or
-- runtime EXECUTE grant. The claim function runs as postgres and is already
-- limited to the bot runtime. The global lock orders it with signed staging,
-- finalization, terminal rejection, and Owner stop.
create function app.resolve_routine_telebirr_fast_results()
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cutover timestamptz;
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_reason text;
  v_class text;
  v_first_not_found timestamptz;
  v_distinct_not_found integer;
  v_layout_customers integer;
  v_layout_tripped boolean;
  v_chat_id bigint;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'The routine paid result resolver is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  select enabled_at into v_cutover
    from app.routine_telebirr_fast_result_cutover where singleton;
  if v_cutover is null then raise exception 'The routine paid cutover is unavailable.'; end if;
  for v_candidate in
    select candidate.* from app.routine_telebirr_untrusted_proof_requests candidate
    where candidate.intake_mode = 'paid' and candidate.provider_code = 'telebirr'
      and candidate.origin_channel = 'telegram'
      and candidate.submitted_at >= v_cutover
      and candidate.submitted_at >= v_now - interval '7 days'
      and not exists (select 1 from app.routine_telebirr_fast_results result
        where result.candidate_id = candidate.id)
      and not exists (select 1 from app.telegram_deposit_outcome_deliveries delivery
        where delivery.candidate_id = candidate.id and delivery.notification_stage = 'final')
      and not exists (select 1 from app.routine_telebirr_paid_intent_openings opening
        where opening.candidate_id = candidate.id)
    order by candidate.submitted_at, candidate.id
    limit 100 for update of candidate skip locked
  loop
    -- Only a prior signed staged receipt or an opened one-use claim proves
    -- another submission has this reference. Untrusted submissions cannot
    -- deny another customer service by merely repeating a reference.
    if exists (
      select 1 from app.routine_telebirr_paid_intent_openings opening
      where opening.payment_provider_id = v_candidate.payment_provider_id
        and opening.reference_fingerprint = v_candidate.candidate_reference_fingerprint
        and opening.candidate_id <> v_candidate.id
    ) or exists (
      select 1 from app.routine_telebirr_paid_observation_staging staged
      where staged.payment_provider_id = v_candidate.payment_provider_id
        and staged.reference_fingerprint = v_candidate.candidate_reference_fingerprint
        and staged.candidate_id <> v_candidate.id
    ) then
      v_class := 'already_used'; v_reason := 'previous_signed_claim';
    else
      select audit.reason_code into v_reason
        from app.routine_telebirr_paid_check_audit audit
        where audit.candidate_id = v_candidate.id and audit.source = 'check_review'
        order by audit.checked_at desc, audit.id desc limit 1;
      v_class := app.classify_routine_telebirr_fast_reason(v_reason);

      -- An attested not-found result needs a second independent signed phone
      -- challenge at least 60 seconds later. The currently known bare 404 is
      -- reported as provider_not_found_unattested and never enters this path.
      if v_reason = 'official_not_found' then
        select pg_catalog.min(audit.checked_at),
               pg_catalog.count(distinct audit.challenge_id)::integer
          into v_first_not_found, v_distinct_not_found
          from app.routine_telebirr_paid_check_audit audit
          where audit.candidate_id = v_candidate.id
            and audit.source = 'check_review'
            and audit.reason_code = 'official_not_found';
        if v_distinct_not_found >= 2 and exists (
          select 1 from app.routine_telebirr_paid_check_audit audit
          where audit.candidate_id = v_candidate.id
            and audit.source = 'check_review'
            and audit.reason_code = 'official_not_found'
            and audit.checked_at >= v_first_not_found + interval '60 seconds'
        ) then v_class := 'invalid_reference'; end if;
      end if;

      if v_class = 'unrelated_receipt' then
        select pg_catalog.count(distinct candidate.submitting_customer_id)::integer
          into v_layout_customers
          from app.routine_telebirr_paid_check_audit audit
          join app.routine_telebirr_untrusted_proof_requests candidate
            on candidate.id = audit.candidate_id
          where audit.source = 'check_review'
            and audit.checked_at >= v_now - interval '30 minutes'
            and candidate.submitted_at >= v_cutover
            and app.classify_routine_telebirr_fast_reason(audit.reason_code)
                = 'unrelated_receipt';
        if v_layout_customers >= 3 then
          insert into app.routine_telebirr_fast_owner_alerts (alert_code)
          values ('receipt_layout_changed') on conflict do nothing;
        end if;
        select exists (select 1 from app.routine_telebirr_fast_owner_alerts alert
          where alert.alert_code = 'receipt_layout_changed') into v_layout_tripped;
        if v_layout_tripped then
          v_class := 'held_review'; v_reason := 'receipt_layout_changed';
        end if;
      end if;

      if v_class is null and v_candidate.submitted_at <= v_now - interval '5 minutes' then
        v_class := 'held_review';
        v_reason := case when v_reason ~ '^[a-z][a-z0-9_]{0,63}$'
          then v_reason else 'no_phone_result' end;
      end if;
    end if;
    if v_class is null then continue; end if;

    -- The real customer delivery is still bound to an authenticated Telegram
    -- identity and the original inbound event, as in the established notifier.
    select identity.private_chat_id into v_chat_id
      from app.telegram_identities identity
      join app.inbound_events inbound_event
        on inbound_event.id = v_candidate.origin_request_key
        and inbound_event.customer_identity_id = v_candidate.origin_identity_id
        and inbound_event.channel = 'telegram'
      where identity.customer_identity_id = v_candidate.origin_identity_id
        and identity.private_chat_id = identity.telegram_user_id;
    if v_chat_id is null then continue; end if;
    insert into app.routine_telebirr_fast_results
      (candidate_id, outcome_code, reason_code, decided_at)
    values (v_candidate.id, v_class, v_reason, v_now);
    if v_class = 'held_review' then
      insert into app.routine_telebirr_fast_owner_alerts (alert_code, candidate_id)
      values ('held_review', v_candidate.id) on conflict do nothing;
    end if;
    insert into app.telegram_deposit_outcome_deliveries
      (candidate_id, notification_stage, private_chat_id, reference_masked,
       outcome_code, amount_minor, next_attempt_at, created_at, updated_at)
    values (v_candidate.id, 'final', v_chat_id,
      v_candidate.candidate_reference_masked, v_class,
      null, v_now, v_now, v_now)
    on conflict (candidate_id, notification_stage) do nothing;
  end loop;
end;
$$;
alter function app.resolve_routine_telebirr_fast_results() owner to postgres;
revoke all on function app.resolve_routine_telebirr_fast_results()
  from public, anon, authenticated, service_role,
  fetanagent_player_actions, fetanagent_player_actions_runtime;

-- A narrow Owner-only signal for the PR 2 review queue. PR 4 supplies the
-- per-transaction decision UI; this summary contains no payment identifiers.
create function app.get_owner_routine_telebirr_fast_alert_summary(
  p_actor_auth_user_id uuid
) returns table (held_count bigint, receipt_layout_changed boolean)
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or not exists (
      select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select (select pg_catalog.count(*) from app.routine_telebirr_fast_owner_alerts alert
          where alert.alert_code = 'held_review'),
         exists (select 1 from app.routine_telebirr_fast_owner_alerts alert
           where alert.alert_code = 'receipt_layout_changed');
end;
$$;
alter function app.get_owner_routine_telebirr_fast_alert_summary(uuid) owner to postgres;
revoke all on function app.get_owner_routine_telebirr_fast_alert_summary(uuid)
  from public, anon, authenticated, service_role,
  fetanagent_owner_control_runtime, fetanagent_player_actions_runtime;
grant execute on function app.get_owner_routine_telebirr_fast_alert_summary(uuid)
  to fetanagent_owner_control;

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected',
    'not_credited', 'not_verified', 'already_used', 'wrong_receiver',
    'invalid_reference', 'manual_review', 'unrelated_receipt', 'held_review'
  ));

-- A fast decision is a durable barrier even if a delayed phone upload arrives.
-- These triggers guard the three routes which could later open a claim.
create function app.block_routine_telebirr_fast_decided_candidate()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if exists (select 1 from app.routine_telebirr_fast_results result
    where result.candidate_id = new.candidate_id) then
    raise exception using errcode = '23514',
      message = 'The routine paid candidate is already decided.';
  end if;
  if tg_table_name = 'routine_telebirr_paid_observation_staging' then
    if exists (select 1 from app.routine_telebirr_paid_check_audit audit
      where audit.challenge_id = new.challenge_id
        and audit.source = 'check_review') then
      raise exception using errcode = '23514',
        message = 'The routine paid challenge has a signed check result.';
    end if;
  end if;
  return new;
end;
$$;
alter function app.block_routine_telebirr_fast_decided_candidate() owner to postgres;
revoke all on function app.block_routine_telebirr_fast_decided_candidate()
  from public, anon, authenticated, service_role;
create trigger routine_paid_fast_block_challenge
before insert on app.routine_telebirr_lookup_challenges
for each row when (new.issuance_mode = 'paid')
execute function app.block_routine_telebirr_fast_decided_candidate();
create trigger routine_paid_fast_block_stage
before insert on app.routine_telebirr_paid_observation_staging
for each row execute function app.block_routine_telebirr_fast_decided_candidate();
create trigger routine_paid_fast_block_opening
before insert on app.routine_telebirr_paid_intent_openings
for each row execute function app.block_routine_telebirr_fast_decided_candidate();

-- Drift-checked minimal edits: no old outcome is rewritten. The historical
-- 70-minute result remains solely for pre-cutover submissions.
do $migration$
declare v_source text; v_old text; v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.claim_telegram_deposit_outcome_notification()'::pg_catalog.regprocedure)
    into v_source;
  v_old := '  -- Final outcomes are still one per candidate.';
  v_new := '  perform app.resolve_routine_telebirr_fast_results();' || E'\n\n' || v_old;
  if v_source is null or pg_catalog.length(v_source) -
    pg_catalog.length(pg_catalog.replace(v_source,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'The Telegram outcome resolver insertion point changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);
  v_old := 'and (candidate.submitted_at <= v_now - interval ''70 minutes''';
  v_new := 'and (candidate.submitted_at < (select enabled_at from '
    || 'app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n             and candidate.submitted_at <= v_now - interval ''70 minutes''';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The legacy Telegram final cutoff changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);
  v_old := 'or app.routine_telebirr_same_customer_credited_reference(candidate.id)))';
  v_new := 'or (candidate.submitted_at < (select enabled_at from '
    || 'app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n               and app.routine_telebirr_same_customer_credited_reference(candidate.id))))';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The legacy duplicate cutoff changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);
  -- Keep the historical checking window, but stop creating it once a fast
  -- decision exists and after five minutes for post-cutover submissions.
  v_old := 'and candidate.submitted_at between v_now - interval ''70 minutes'''
    || E'\n                                    and v_now - interval ''2 minutes''';
  v_new := v_old || E'\n     and (candidate.submitted_at < (select enabled_at from '
    || 'app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n       or candidate.submitted_at > v_now - interval ''5 minutes'')'
    || E'\n     and not exists (select 1 from app.routine_telebirr_fast_results result'
    || E'\n       where result.candidate_id = candidate.id)';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The Telegram checking cutoff changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$migration$;

-- A signed, inconclusive phone check frees the same candidate for another
-- challenge after 60 seconds. The reported challenge can never later stage a
-- receipt. The existing five-challenge cap and one-use financial fences stay.
do $retry$
declare v_source text; v_old text; v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.record_routine_telebirr_paid_check_reason(uuid,uuid,text,timestamptz,text)'::pg_catalog.regprocedure)
    into v_source;
  v_old := '  select challenge.* into v_challenge';
  v_new := '  perform pg_catalog.pg_advisory_xact_lock('
    || E'\n    pg_catalog.hashtextextended(''fetanagent:routine-telebirr-processing'', 20261004));'
    || E'\n' || v_old;
  if v_source is null or pg_catalog.length(v_source) -
    pg_catalog.length(pg_catalog.replace(v_source,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'The paid phone check recorder changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);

  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'::pg_catalog.regprocedure)
    into v_source;
  v_old := 'candidate.submitted_at + interval ''1 hour 5 minutes'' > v_now';
  v_new := '(' || v_old || E'\n       and (candidate.submitted_at < (select enabled_at from app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n         or candidate.submitted_at > v_now - interval ''5 minutes''))';
  if v_source is null or pg_catalog.length(v_source) -
    pg_catalog.length(pg_catalog.replace(v_source,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'The paid poll candidate window changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);
  v_old := 'challenge.expires_at + interval ''15 minutes'' > v_now';
  v_new := v_old || E'\n          and (candidate.submitted_at < (select enabled_at from app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n            or challenge.issued_at > v_now - interval ''60 seconds'''
    || E'\n            or not exists (select 1 from app.routine_telebirr_paid_check_audit audit'
    || E'\n              where audit.challenge_id = challenge.challenge_id'
    || E'\n                and audit.source = ''check_review''))';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The paid poll challenge cooldown changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);

  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)'::pg_catalog.regprocedure)
    into v_source;
  v_old := 'v_candidate.submitted_at + interval ''1 hour 5 minutes'' <= v_now';
  v_new := '(' || v_old || E'\n      or (v_candidate.submitted_at >= (select enabled_at from app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n        and v_candidate.submitted_at <= v_now - interval ''5 minutes''))';
  if v_source is null or pg_catalog.length(v_source) -
    pg_catalog.length(pg_catalog.replace(v_source,v_old,'')) <> pg_catalog.length(v_old) then
    raise exception 'The paid challenge candidate window changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);
  v_old := 'challenge.expires_at + interval ''15 minutes'' > v_now';
  v_new := v_old || E'\n            and (v_candidate.submitted_at < (select enabled_at from app.routine_telebirr_fast_result_cutover where singleton)'
    || E'\n              or challenge.issued_at > v_now - interval ''60 seconds'''
    || E'\n              or not exists (select 1 from app.routine_telebirr_paid_check_audit audit'
    || E'\n                where audit.challenge_id = challenge.challenge_id'
    || E'\n                  and audit.source = ''check_review''))';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The paid challenge cooldown changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$retry$;

comment on table app.routine_telebirr_fast_results is
  'Post-cutover, one-way paid candidate result; no payment, raw reference, Player ID or receiver phone.';
comment on table app.routine_telebirr_fast_owner_alerts is
  'Owner review signals for unresolved checks and a sticky receipt-layout circuit breaker.';
commit;
