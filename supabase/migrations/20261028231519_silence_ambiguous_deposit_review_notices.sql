-- A repeated reference already receives a precise intake reply. Do not turn
-- that repeat into a 60-minute Owner hold. Interim review outcomes remain in
-- the private ledger, but no longer generate ambiguous customer messages.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004));

do $patch_settlement$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure);
  v_old := '      and not exists (select 1 from app.receiver_sms_payment_matches matched'
    || E'\n' || '        where matched.candidate_id = candidate.id)';
  v_new := v_old || E'\n'
    || '      and app.receiver_sms_duplicate_state(candidate.id) = ''none''';
  if v_source is null or pg_catalog.length(v_source)
      - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
      <> pg_catalog.length(v_old) then
    raise exception 'Receiver SMS settlement candidate source changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$patch_settlement$;

create function app.silence_telegram_deposit_review_notice()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
begin
  if new.outcome_code in ('held_review', 'older_pending', 'manual_review') then
    new.status := 'unavailable';
    new.lease_token := null;
    new.lease_expires_at := null;
    new.telegram_message_id := null;
    new.sent_at := null;
  end if;
  return new;
end;
$$;
alter function app.silence_telegram_deposit_review_notice() owner to postgres;
revoke all on function app.silence_telegram_deposit_review_notice()
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

create trigger silence_telegram_deposit_review_notice
before insert on app.telegram_deposit_outcome_deliveries
for each row execute function app.silence_telegram_deposit_review_notice();

-- A pending or leased review notice from before this migration must not be
-- delivered after the new policy takes effect. Previously sent history stays.
update app.telegram_deposit_outcome_deliveries delivery
  set status = 'unavailable', lease_token = null, lease_expires_at = null,
    updated_at = pg_catalog.clock_timestamp()
  where delivery.outcome_code in ('held_review', 'older_pending', 'manual_review')
    and delivery.status in ('pending', 'leased');

comment on function app.silence_telegram_deposit_review_notice() is
  'Keep interim payment reviews in the private ledger without sending an ambiguous Telegram message.';
comment on function app.settle_next_receiver_sms_match() is
  'Queue one safe receiver-SMS match, or hold a first unmatched submission after 60 minutes; repeated references are not held.';
commit;
