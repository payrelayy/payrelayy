-- Search the Owner's verified SMS details without exposing raw messages or
-- references. Keep the original three-argument projection for older runtimes.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index receiver_sms_payment_events_received_idx
  on app.receiver_sms_payment_events (received_at desc, id desc);

create function app.list_owner_receiver_sms_inbox_filtered(
  p_actor_auth_user_id uuid, p_provider text, p_status text,
  p_reference_last4 text, p_from date, p_to date,
  p_limit integer, p_offset integer
) returns table (
  payment_event_id uuid, provider_code text, payment_at timestamptz,
  received_at timestamptz, amount_minor bigint, receiver_account_masked text,
  receiver_holder_name text, reference_masked text, candidate_id uuid,
  player_masked text, payment_status text, case_id uuid,
  can_mark_manually_credited boolean
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or p_provider is null or p_provider not in ('all','telebirr','cbe_birr')
    or p_status is null or p_status not in (
      'all','unmatched','submission_waiting','pending_review',
      'auto_processing','auto_credited','auto_not_credited','auto_used',
      'awaiting_manual_credit','manually_credited','rejected')
    or (p_reference_last4 is not null
      and p_reference_last4 !~ '^[A-Z0-9]{4}$')
    or (p_from is not null and p_to is not null and p_from > p_to)
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  return query
  with inbox as (
    select sms.id as payment_event_id, sms.provider_code,
      sms.occurred_at as payment_at, sms.received_at, sms.amount_minor,
      receiver.account_reference_masked as receiver_account_masked,
      receiver.account_holder_name as receiver_holder_name,
      candidate.reference_masked, candidate.id as candidate_id,
      case when player.id is not null then '***' || pg_catalog.right(player.player_id,4)
        else null::text end as player_masked,
      case when owner_case.id is not null then owner_case.status
        when intent.status = 'executed' then 'auto_credited'
        when intent.status in ('rejected','expired','cancelled') then 'auto_not_credited'
        when lineage.candidate_id is not null then 'auto_processing'
        when evidence.id is not null then 'auto_used'
        when matched.disposition in ('older_review','held_review') then 'pending_review'
        when candidate.id is not null then 'submission_waiting'
        else 'unmatched' end as payment_status,
      owner_case.id as case_id,
      owner_case.id is null and (
        (candidate.id is null and evidence.id is null)
        or (candidate.id is not null
          and coalesce(intent.status in ('rejected','cancelled'),false)
          and not exists (select 1 from app.deposit_jobs job
            where job.deposit_intent_id = lineage.deposit_intent_id
              and job.status not in ('cancelled','dead'))
          and not exists (select 1 from app.deposit_execution_attempts attempt
            where attempt.deposit_intent_id = lineage.deposit_intent_id
              and attempt.status <> 'cancelled_before_action')))
        as can_mark_manually_credited
    from app.receiver_sms_payment_events sms
    join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
    left join app.owner_manual_payment_cases owner_case
      on owner_case.payment_provider_id = sms.payment_provider_id
        and owner_case.reference_fingerprint = sms.reference_fingerprint
    left join lateral (
      select first_candidate.* from app.receiver_sms_deposit_candidates first_candidate
        where first_candidate.provider_code = sms.provider_code
          and first_candidate.reference_fingerprint = sms.reference_fingerprint
        order by first_candidate.submitted_at, first_candidate.id limit 1
    ) candidate on true
    left join app.customer_platform_players player on player.id = candidate.player_account_id
    left join app.receiver_sms_payment_matches matched
      on matched.candidate_id = candidate.id
    left join app.receiver_sms_settlement_lineages lineage
      on lineage.candidate_id = candidate.id
    left join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
    left join app.provider_payment_evidence evidence
      on evidence.payment_provider_id = sms.payment_provider_id
        and evidence.canonical_reference_fingerprint = sms.reference_fingerprint
    where (p_provider = 'all' or sms.provider_code = p_provider)
      and (p_from is null
        or sms.received_at >= (p_from::timestamp at time zone 'Africa/Nairobi'))
      and (p_to is null
        or sms.received_at < ((p_to + 1)::timestamp at time zone 'Africa/Nairobi'))
  )
  select inbox.payment_event_id, inbox.provider_code, inbox.payment_at,
    inbox.received_at, inbox.amount_minor, inbox.receiver_account_masked,
    inbox.receiver_holder_name, inbox.reference_masked, inbox.candidate_id,
    inbox.player_masked, inbox.payment_status, inbox.case_id,
    inbox.can_mark_manually_credited
  from inbox
  where (p_status = 'all' or inbox.payment_status = p_status)
    and (p_reference_last4 is null
      or pg_catalog.right(inbox.reference_masked,4) = p_reference_last4)
  order by inbox.received_at desc, inbox.payment_event_id desc
  limit p_limit offset p_offset;
end;
$$;
alter function app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)
  owner to postgres;
revoke all on function app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)
  to fetanagent_owner_control;

commit;
