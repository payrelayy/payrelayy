-- Owner-only, masked transaction history. This is a read model over the existing
-- immutable submission, phone-result, decision, and execution ledgers. It never
-- changes a payment state or grants direct table access to the Owner runtime.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.list_owner_routine_telebirr_transactions(
  p_actor_auth_user_id uuid,
  p_status text default 'all',
  p_from date default null,
  p_to date default null,
  p_reference_last4 text default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_result jsonb;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active')
    or p_status is null or p_status not in ('all','pending','credited','rejected')
    or (p_from is not null and p_to is not null and p_from > p_to)
    or (p_reference_last4 is not null
      and p_reference_last4 !~ '^[A-Z0-9]{4}$')
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset < 0 then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  with base as materialized (
    select candidate.id, candidate.submitted_at,
      candidate.candidate_reference_masked as reference_masked,
      '***' || pg_catalog.right(player.player_id, 4) as player_masked,
      coalesce(old_payment.occurred_at, opening.occurred_at) as payment_at,
      coalesce(old_payment.amount_minor, opening.amount_minor) as amount_minor,
      old_payment.challenge_id as old_challenge_id,
      old_decision.decision as old_decision,
      old_decision.decided_at as old_decided_at,
      coalesce(nullif(pg_catalog.btrim(actor.display_name),''),'Owner')
        as old_decided_by,
      fast.outcome_code as fast_outcome,
      fast.reason_code as fast_reason,
      fast.decided_at as fast_decided_at,
      terminal.reason_code as terminal_reason,
      terminal.recorded_at as terminal_decided_at,
      intent.status::text as intent_status,
      intent.status_changed_at as intent_status_at,
      intent.rejection_reason_code as intent_reason,
      final_delivery.outcome_code as final_outcome,
      final_delivery.created_at as final_at
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.customer_platform_players player on player.id = candidate.player_account_id
    left join app.routine_telebirr_old_payment_observations old_payment
      on old_payment.candidate_id = candidate.id
    left join app.routine_telebirr_old_payment_decisions old_decision
      on old_decision.candidate_id = candidate.id
    left join app.admin_users actor on actor.id = old_decision.actor_admin_id
    left join app.routine_telebirr_fast_results fast
      on fast.candidate_id = candidate.id
    left join app.routine_telebirr_paid_terminal_rejections terminal
      on terminal.candidate_id = candidate.id
    left join app.routine_telebirr_paid_intent_openings opening
      on opening.candidate_id = candidate.id
    left join app.deposit_intents intent on intent.id = opening.deposit_intent_id
    left join app.telegram_deposit_outcome_deliveries final_delivery
      on final_delivery.candidate_id = candidate.id
      and final_delivery.notification_stage = 'final'
    where candidate.intake_mode = 'paid' and candidate.provider_code = 'telebirr'
      and candidate.origin_channel = 'telegram'
  ), classified as materialized (
    select base.*,
      case
        when old_decision = 'rejected' then 'rejected'
        when intent_status = 'executed' then 'credited'
        when fast_outcome is not null and fast_outcome <> 'held_review' then 'rejected'
        when terminal_reason is not null then 'rejected'
        when intent_status in ('rejected','expired','cancelled') then 'rejected'
        when final_outcome is not null and final_outcome <> 'credited' then 'rejected'
        else 'pending'
      end as status_group,
      case
        when old_decision = 'rejected' then 'rejected'
        when intent_status = 'executed' then 'credited'
        when fast_outcome = 'held_review' then 'held_review'
        when fast_outcome is not null or terminal_reason is not null
          or intent_status in ('rejected','expired','cancelled')
          or (final_outcome is not null and final_outcome <> 'credited')
          then 'rejected'
        when old_challenge_id is not null and old_decision is null
          then 'waiting_approval'
        else 'checking'
      end as status_detail,
      case
        when old_decision = 'rejected' then 'Payment older than 1 hour'
        when fast_outcome = 'invalid_reference' or final_outcome = 'invalid_reference'
          then 'Invalid payment information'
        when fast_outcome = 'wrong_receiver' or terminal_reason = 'receiver_mismatch'
          or final_outcome = 'wrong_receiver' then 'Wrong receiver'
        when fast_outcome = 'already_used' or final_outcome = 'already_used'
          then 'Payment already used'
        when fast_outcome = 'unrelated_receipt' or final_outcome = 'unrelated_receipt'
          then 'Unrelated receipt'
        when fast_outcome = 'held_review' and fast_reason = 'receipt_layout_changed'
          then 'Receipt layout needs review'
        when fast_outcome = 'held_review' then 'Payment check could not finish'
        when old_challenge_id is not null and old_decision is null
          then 'Payment older than 1 hour'
        when intent_status in ('rejected','expired','cancelled')
          then 'Payment was not eligible for credit'
        when final_outcome is not null and final_outcome <> 'credited'
          then 'Payment could not be verified'
        when old_decision = 'approved' and intent_status <> 'executed'
          then 'Owner approved; credit in progress'
        when intent_status is not null and intent_status <> 'executed'
          then 'Credit in progress'
        else null
      end as reason,
      case
        when old_decision is not null then old_decided_by
        when fast_outcome is not null or terminal_reason is not null
          or intent_status in ('rejected','expired','cancelled','executed')
          or final_outcome is not null then 'FetanAgent'
        else null
      end as decided_by,
      case
        when old_decision is not null then old_decided_at
        when fast_outcome is not null then fast_decided_at
        when terminal_reason is not null then terminal_decided_at
        when intent_status in ('rejected','expired','cancelled','executed')
          then intent_status_at
        when final_outcome is not null then final_at
        else null
      end as decided_at
    from base
  ), filtered as materialized (
    select * from classified
    where (p_from is null or (submitted_at at time zone 'Africa/Nairobi')::date >= p_from)
      and (p_to is null or (submitted_at at time zone 'Africa/Nairobi')::date <= p_to)
      and (p_reference_last4 is null or pg_catalog.right(reference_masked, 4) = p_reference_last4)
  ), selected as materialized (
    select * from filtered where p_status = 'all' or status_group = p_status
  ), page as (
    select * from selected order by submitted_at desc, id desc
    limit p_limit offset p_offset
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'candidateId', page.id,
        'submittedAt', page.submitted_at,
        'paymentAt', page.payment_at,
        'amountMinor', page.amount_minor::text,
        'referenceMasked', page.reference_masked,
        'playerMasked', page.player_masked,
        'statusGroup', page.status_group,
        'statusDetail', page.status_detail,
        'reason', page.reason,
        'decidedBy', page.decided_by,
        'decidedAt', page.decided_at,
        'canDecide', page.status_detail = 'waiting_approval'
      ) order by page.submitted_at desc, page.id desc
    ) from page), '[]'::jsonb),
    'total', (select pg_catalog.count(*) from selected),
    'pending', (select pg_catalog.count(*) from filtered where status_group = 'pending'),
    'credited', (select pg_catalog.count(*) from filtered where status_group = 'credited'),
    'rejected', (select pg_catalog.count(*) from filtered where status_group = 'rejected'),
    'waitingCount', (select pg_catalog.count(*) from classified
      where status_detail in ('waiting_approval','held_review'))
  ) into v_result;
  return v_result;
end;
$$;

alter function app.list_owner_routine_telebirr_transactions(uuid,text,date,date,text,integer,integer)
  owner to postgres;
revoke all on function app.list_owner_routine_telebirr_transactions(uuid,text,date,date,text,integer,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_routine_telebirr_transactions(uuid,text,date,date,text,integer,integer)
  to fetanagent_owner_control;

commit;
