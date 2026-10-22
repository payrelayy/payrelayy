-- An authenticated private Telegram customer may see only the current payable CBE Birr
-- receiver. This is presentation, never evidence of a payment or authority to credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function app.prepare_telegram_live_cbe_sms_destination(
  p_origin_inbound_event_id uuid, p_player_id text
)
returns table (
  provider_code text,
  receiver_revision_id uuid,
  receiver_account_holder_name text,
  receiver_account_reference_ciphertext text,
  receiver_account_reference_fingerprint text,
  receiver_account_masked text,
  payments_enabled boolean
)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_selected_player text;
  v_player_account_id uuid;
  v_provider_id uuid;
  v_receiver app.receiver_accounts%rowtype;
  v_route_enabled boolean;
  v_live_switches integer;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime')
    or p_origin_inbound_event_id is null
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]' then
    raise exception using errcode = '42501',
      message = 'The CBE Birr destination is unavailable.';
  end if;

  -- Serialize with the guarded SMS stop before releasing payable receiver material.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select control.enabled into v_route_enabled
    from app.receiver_sms_route_control control where control.singleton for share;
  select pg_catalog.count(*)::integer into v_live_switches
    from app.feature_switches feature
   where feature.feature_key in (
     'payment_verification', 'deposit_execution',
     'cbe_birr_authoritative_verification') and feature.mode = 'live';
  if v_route_enabled is distinct from true or v_live_switches <> 3 then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;

  select selection.selected_player_id into v_selected_player
    from app.get_telegram_saved_player_selection(p_origin_inbound_event_id) selection;
  if v_selected_player is distinct from p_player_id then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;
  select boundary.player_account_id, boundary.payment_provider_id
    into v_player_account_id, v_provider_id
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'cbe_birr') boundary;
  if v_player_account_id is null or v_provider_id is null then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;

  select receiver.* into v_receiver
    from app.receiver_accounts receiver
   where receiver.provider_id = v_provider_id
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= pg_catalog.clock_timestamp()
   for share;
  if v_receiver.id is null
    or v_receiver.account_holder_name <> pg_catalog.btrim(v_receiver.account_holder_name)
    or pg_catalog.char_length(v_receiver.account_holder_name) not between 2 and 160
    or v_receiver.account_holder_name ~ '[[:cntrl:]]'
    or v_receiver.account_reference_ciphertext
       !~ '^receiver-v1[.]cbe_birr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
    or v_receiver.account_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or v_receiver.account_reference_masked !~ '^\*{3}[0-9]{4}$'
    or v_receiver.protection_profile_version <> 1
    or v_receiver.encryption_key_version <> 1
    or v_receiver.fingerprint_key_version <> 1 then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;

  return query select 'cbe_birr'::text, v_receiver.id,
    v_receiver.account_holder_name, v_receiver.account_reference_ciphertext,
    v_receiver.account_reference_fingerprint, v_receiver.account_reference_masked, true;
end;
$$;
alter function app.prepare_telegram_live_cbe_sms_destination(uuid,text) owner to postgres;
revoke all on function app.prepare_telegram_live_cbe_sms_destination(uuid,text)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_api, fetanagent_api_runtime;
grant execute on function app.prepare_telegram_live_cbe_sms_destination(uuid,text)
  to fetanagent_player_actions;
comment on function app.prepare_telegram_live_cbe_sms_destination(uuid,text) is
  'Read-only private Telegram CBE Birr SMS destination, gated by saved eligible Player, live SMS route and exact financial switches; no payment authority.';

commit;
