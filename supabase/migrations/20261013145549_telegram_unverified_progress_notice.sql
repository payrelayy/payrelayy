-- A reference that is still unverified should not leave the customer silent
-- for the full receipt window. This is a non-final status, never a rejection.
-- Only new submissions after this cutover can receive the extra message.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.telegram_deposit_outcome_cutover
  add column checking_enabled_at timestamptz;
update app.telegram_deposit_outcome_cutover
   set checking_enabled_at = pg_catalog.clock_timestamp()
 where singleton = true;
alter table app.telegram_deposit_outcome_cutover
  alter column checking_enabled_at set not null;

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_deposit_outcome_deliveries_notification_stage_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_check
  check (notification_stage in ('checking', 'waiting', 'final'));
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check
  check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected', 'not_credited', 'not_verified'
  ));
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_stage_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_code_check check (
    (notification_stage = 'checking' and outcome_code = 'checking')
    or (notification_stage = 'waiting' and outcome_code = 'verified_waiting')
    or (notification_stage = 'final' and outcome_code not in ('checking', 'verified_waiting'))
  );

-- The replacement is pinned to the reviewed current implementation. A source
-- drift aborts this entire migration instead of changing a payment outcome.
do $migration$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.claim_telegram_deposit_outcome_notification()'::pg_catalog.regprocedure
  ) into v_source;
  if v_source is null then
    raise exception 'The Telegram outcome claim source is unavailable.';
  end if;

  v_old := '  v_waiting_cutover timestamptz;';
  v_new := v_old || E'\n' || '  v_checking_cutover timestamptz;';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram outcome declaration has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := '  select cutover.enabled_at, cutover.waiting_enabled_at'
    || E'\n' || '    into v_cutover, v_waiting_cutover';
  v_new := '  select cutover.enabled_at, cutover.waiting_enabled_at, cutover.checking_enabled_at'
    || E'\n' || '    into v_cutover, v_waiting_cutover, v_checking_cutover';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram outcome cutover read has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := 'if v_cutover is null or v_waiting_cutover is null then';
  v_new := 'if v_cutover is null or v_waiting_cutover is null'
    || E'\n' || '    or v_checking_cutover is null then';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram outcome cutover guard has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := '  -- Only an actually verified, still-queued intent earns the progress update.';
  v_new := $checking$
  -- After three minutes, tell a customer that verification is still pending.
  -- This never claims that a payment was rejected or that the phone is online.
  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, notification_stage, private_chat_id, reference_masked,
    outcome_code, amount_minor, next_attempt_at, created_at, updated_at
  )
  select candidate.id, 'checking', telegram_identity.private_chat_id,
         candidate.candidate_reference_masked, 'checking', null,
         v_now, v_now, v_now
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = candidate.origin_identity_id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.inbound_events inbound_event
      on inbound_event.id = candidate.origin_request_key
     and inbound_event.customer_identity_id = candidate.origin_identity_id
     and inbound_event.channel = 'telegram'
   where candidate.intake_mode = 'paid'
     and candidate.origin_channel = 'telegram'
     and candidate.submitted_at >= v_checking_cutover
     and candidate.submitted_at between v_now - interval '70 minutes'
                                    and v_now - interval '3 minutes'
     and not exists (
       select 1 from app.routine_telebirr_paid_intent_openings opening
        where opening.candidate_id = candidate.id
     )
     and not exists (
       select 1 from app.telegram_deposit_outcome_deliveries existing
        where existing.candidate_id = candidate.id
     )
   order by candidate.submitted_at, candidate.id
   limit 100
  on conflict (candidate_id, notification_stage) do nothing;

  -- Suppress an unsent or expired progress message after verification or a
  -- final outcome. A leased message may finish; later stages wait for its ACK.
  update app.telegram_deposit_outcome_deliveries delivery
     set status = 'unavailable', lease_token = null,
         lease_expires_at = null, updated_at = v_now
   where delivery.notification_stage = 'checking'
     and (delivery.status = 'pending'
       or (delivery.status = 'leased' and delivery.lease_expires_at <= v_now))
     and (exists (
       select 1 from app.routine_telebirr_paid_intent_openings opening
        where opening.candidate_id = delivery.candidate_id
     ) or exists (
       select 1 from app.telegram_deposit_outcome_deliveries final
        where final.candidate_id = delivery.candidate_id
          and final.notification_stage = 'final'
     ));

  -- Only an actually verified, still-queued intent earns the progress update.$checking$;
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram waiting stage marker has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := '     and intent.status_changed_at <= v_now - interval ''1 minute'''
    || E'\n' || '     and not exists ('
    || E'\n' || '       select 1 from app.telegram_deposit_outcome_deliveries existing'
    || E'\n' || '        where existing.candidate_id = candidate.id'
    || E'\n' || '     )'
    || E'\n' || '   order by candidate.submitted_at, candidate.id'
    || E'\n' || '   limit 100'
    || E'\n' || '  on conflict (candidate_id, notification_stage) do nothing;'
    || E'\n\n' || '  -- Never start a stale waiting send';
  v_new := '     and intent.status_changed_at <= v_now - interval ''1 minute'''
    || E'\n' || '     and not exists ('
    || E'\n' || '       select 1 from app.telegram_deposit_outcome_deliveries existing'
    || E'\n' || '        where existing.candidate_id = candidate.id'
    || E'\n' || '          and existing.notification_stage in (''waiting'', ''final'')'
    || E'\n' || '     )'
    || E'\n' || '   order by candidate.submitted_at, candidate.id'
    || E'\n' || '   limit 100'
    || E'\n' || '  on conflict (candidate_id, notification_stage) do nothing;'
    || E'\n\n' || '  -- Never start a stale waiting send';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram waiting duplicate guard has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := '(delivery.notification_stage = ''waiting'' or not exists (';
  v_new := '(delivery.notification_stage <> ''final'' or not exists (';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram final ordering guard has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := '          and waiting.status in (''pending'', ''leased'')'
    || E'\n' || '     ))';
  v_new := '          and waiting.status in (''pending'', ''leased'')'
    || E'\n' || '     ))'
    || E'\n' || '     and (delivery.notification_stage = ''checking'' or not exists ('
    || E'\n' || '       select 1 from app.telegram_deposit_outcome_deliveries checking'
    || E'\n' || '        where checking.candidate_id = delivery.candidate_id'
    || E'\n' || '          and checking.notification_stage = ''checking'''
    || E'\n' || '          and checking.status in (''pending'', ''leased'')'
    || E'\n' || '     ))';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram checking ordering guard has changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$migration$;

comment on function app.claim_telegram_deposit_outcome_notification() is
  'Bot-only bounded non-final unverified status after three minutes, verified waiting notice, and final outcome; never infers rejection from an untrusted reference.';

commit;
