-- The sensitive Owner projection joins the already sorted inbox. Joins do not
-- preserve row order, so repeat the ordering at the outermost query boundary.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if (select pg_catalog.md5(prosrc) = 'ebddc94df807a76aff53121514e680a3'
      and prosecdef and proowner = 'postgres'::pg_catalog.regrole
      from pg_catalog.pg_proc
      where oid = 'app.list_owner_receiver_sms_inbox_sensitive(uuid,text,text,text,date,date,integer,integer)'::pg_catalog.regprocedure
    ) is not true then
    raise exception 'Unexpected Owner SMS inbox function; review before changing its order.';
  end if;
end;
$guard$;

create or replace function app.list_owner_receiver_sms_inbox_sensitive(
  p_actor_auth_user_id uuid, p_provider text, p_status text,
  p_reference_last4 text, p_from date, p_to date,
  p_limit integer, p_offset integer
) returns table (
  payment_event_id uuid, provider_code text, payment_at timestamptz,
  received_at timestamptz, amount_minor bigint, receiver_account_masked text,
  receiver_holder_name text, reference_masked text, candidate_id uuid,
  player_masked text, payment_status text, case_id uuid,
  can_mark_manually_credited boolean,
  receiver_ciphertext text, receiver_fingerprint text,
  player_id text, reference_ciphertext text, reference_source text,
  reference_digest text, reference_fingerprint text,
  display_reference_masked text
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select listed.*, receiver.account_reference_ciphertext,
    receiver.account_reference_fingerprint, player.player_id,
    coalesce(display.reference_ciphertext, candidate.reference_ciphertext),
    case when display.payment_event_id is not null then 'sms_display'::text
      when candidate.id is not null then 'candidate'::text
      else 'unavailable'::text end,
    sms.reference_digest, sms.reference_fingerprint,
    coalesce(display.reference_masked,candidate.reference_masked)
  from app.list_owner_receiver_sms_inbox_filtered(
    p_actor_auth_user_id,p_provider,p_status,p_reference_last4,
    p_from,p_to,p_limit,p_offset) listed
  join app.receiver_sms_payment_events sms on sms.id = listed.payment_event_id
  join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
  left join app.receiver_sms_payment_reference_displays display
    on display.payment_event_id = sms.id
  left join app.receiver_sms_deposit_candidates candidate
    on candidate.id = listed.candidate_id
  left join app.customer_platform_players player
    on player.id = candidate.player_account_id
  order by listed.received_at desc, listed.payment_event_id desc;
end;
$$;

commit;
