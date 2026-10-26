-- Owner approval records the reference as credited and queues the normal
-- customer success message before the Owner performs the outside KemerBet credit.
-- The existing decision and completion functions retain their reference locks and
-- one-use checks. No automatic execution job is created here.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.approve_owner_manual_payment_for_immediate_credit(
  p_actor_auth_user_id uuid, p_candidate_id uuid, p_amount_minor bigint,
  p_receiver_account_id uuid, p_bank_payment_confirmed boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_decision jsonb;
  v_completed jsonb;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_candidate_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  -- Both calls run inside this statement's transaction. A failed completion
  -- rolls the reservation back, so no half-approved case can be left behind.
  -- The legacy completion helper uses true to record the Owner's immediate
  -- post-approval credit commitment. The outside credit remains the Owner's
  -- next action and cannot be part of this database transaction.
  v_decision := app.decide_owner_manual_payment_case(
    p_actor_auth_user_id, p_candidate_id, 'approve', null);
  v_completed := app.complete_owner_manual_payment_case(
    p_actor_auth_user_id, (v_decision->>'caseId')::uuid, null,
    p_amount_minor, p_receiver_account_id, p_bank_payment_confirmed, true);
  if v_completed->>'status' <> 'manually_credited' then
    raise exception 'The Owner approval could not be recorded.';
  end if;
  return v_completed;
end;
$$;
alter function app.approve_owner_manual_payment_for_immediate_credit(uuid,uuid,bigint,uuid,boolean)
  owner to postgres;
revoke all on function app.approve_owner_manual_payment_for_immediate_credit(uuid,uuid,bigint,uuid,boolean)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.approve_owner_manual_payment_for_immediate_credit(uuid,uuid,bigint,uuid,boolean)
  to fetanagent_owner_control;

-- A dedicated Owner-only projection exposes the full Player ID needed for
-- manual KemerBet credit. The existing masked projections remain unchanged.
create function app.list_owner_submitted_payments(
  p_actor_auth_user_id uuid, p_status text, p_limit integer, p_offset integer
) returns table (
  case_id uuid, candidate_id uuid, legacy_candidate_id uuid,
  payment_event_id uuid, provider_code text, reference_masked text,
  submitted_at timestamptz, payment_at timestamptz, amount_minor bigint,
  receiver_account_id uuid, receiver_account_masked text, player_id text,
  payment_status text, status_detail text, owner_case_status text, rejection_reason text,
  decided_at timestamptz, completed_at timestamptz,
  can_approve boolean, can_reject boolean
) language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or p_status not in ('pending','approved','rejected')
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  return query
  with submissions as (
    select case when owner_case.candidate_id = candidate.id then owner_case.id
        else null::uuid end as case_id, candidate.id as candidate_id,
      null::uuid as legacy_candidate_id, sms.id as payment_event_id,
      candidate.provider_code, candidate.reference_masked,
      candidate.submitted_at, sms.occurred_at as payment_at,
      coalesce(sms.amount_minor,owner_case.amount_minor) as amount_minor,
      coalesce(sms.receiver_account_id,owner_case.receiver_account_id) as receiver_account_id,
      receiver.account_reference_masked as receiver_account_masked,
      player.player_id,
      case when owner_case.candidate_id = candidate.id then owner_case.status
        else null::text end as owner_status,
      intent.status::text as intent_status,
      case when owner_case.candidate_id = candidate.id then owner_case.rejection_reason
        else null::text end as rejection_reason,
      case when owner_case.candidate_id = candidate.id then owner_case.decided_at
        else null::timestamptz end as decided_at,
      case when owner_case.candidate_id = candidate.id then owner_case.completed_at
        else null::timestamptz end as completed_at,
      (owner_case.id is null and evidence.id is null
        and opening.id is null and old_decision.candidate_id is null
        and (sms.id is null or sms.amount_minor between 2500 and 2500000)
        and not exists (select 1 from app.receiver_sms_deposit_candidates earlier
          where earlier.provider_code = candidate.provider_code
            and earlier.reference_fingerprint = candidate.reference_fingerprint
            and (earlier.submitted_at,earlier.id) <
              (candidate.submitted_at,candidate.id))) as manual_allowed,
      (lineage.candidate_id is not null or evidence.id is not null
        or opening.id is not null) as automatic_started
    from app.receiver_sms_deposit_candidates candidate
    join app.customer_platform_players player on player.id = candidate.player_account_id
    left join app.receiver_sms_payment_events sms
      on sms.provider_code = candidate.provider_code
        and sms.reference_fingerprint = candidate.reference_fingerprint
    left join app.owner_manual_payment_cases owner_case
      on owner_case.payment_provider_id = candidate.payment_provider_id
        and owner_case.reference_fingerprint = candidate.reference_fingerprint
    left join app.receiver_accounts receiver
      on receiver.id = coalesce(sms.receiver_account_id,owner_case.receiver_account_id)
    left join app.receiver_sms_intent_openings opening on opening.candidate_id = candidate.id
    left join app.receiver_sms_owner_decisions old_decision
      on old_decision.candidate_id = candidate.id
    left join app.receiver_sms_settlement_lineages lineage
      on lineage.candidate_id = candidate.id
    left join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
    left join app.provider_payment_evidence evidence
      on evidence.payment_provider_id = candidate.payment_provider_id
        and evidence.canonical_reference_fingerprint = candidate.reference_fingerprint
    union all
    select case when owner_case.legacy_candidate_id = legacy.id then owner_case.id
        else null::uuid end, null::uuid, legacy.id, null::uuid,
      'telebirr'::text, legacy.candidate_reference_masked,
      legacy.submitted_at, observation.occurred_at,
      coalesce(owner_case.amount_minor,observation.amount_minor),
      owner_case.receiver_account_id, receiver.account_reference_masked,
      player.player_id,
      case when owner_case.legacy_candidate_id = legacy.id then owner_case.status
        else null::text end, null::text,
      case when owner_case.legacy_candidate_id = legacy.id then owner_case.rejection_reason
        else null::text end,
      case when owner_case.legacy_candidate_id = legacy.id then owner_case.decided_at
        else null::timestamptz end,
      case when owner_case.legacy_candidate_id = legacy.id then owner_case.completed_at
        else null::timestamptz end,
      (owner_case.id is null and evidence.id is null
        and old_decision.candidate_id is null and fast_result.candidate_id is null
        and observation.amount_minor between 2500 and 2500000
        and opening.challenge_id is null) as manual_allowed,
      (evidence.id is not null or opening.challenge_id is not null) as automatic_started
    from app.routine_telebirr_old_payment_observations observation
    join app.routine_telebirr_untrusted_proof_requests legacy
      on legacy.id = observation.candidate_id and legacy.origin_channel = 'telegram'
    join app.customer_platform_players player on player.id = legacy.player_account_id
    left join app.owner_manual_payment_cases owner_case
      on owner_case.payment_provider_id = observation.payment_provider_id
        and owner_case.reference_fingerprint = observation.reference_fingerprint
    left join app.receiver_accounts receiver on receiver.id = owner_case.receiver_account_id
    left join app.provider_payment_evidence evidence
      on evidence.payment_provider_id = observation.payment_provider_id
        and evidence.canonical_reference_fingerprint = observation.reference_fingerprint
    left join app.routine_telebirr_old_payment_decisions old_decision
      on old_decision.candidate_id = legacy.id
    left join app.routine_telebirr_fast_results fast_result
      on fast_result.candidate_id = legacy.id
    left join app.routine_telebirr_paid_intent_openings opening
      on opening.payment_provider_id = observation.payment_provider_id
        and opening.reference_fingerprint = observation.reference_fingerprint
  ), classified as (
    select submissions.*,
      case when owner_status = 'manually_credited' or intent_status = 'executed'
        then 'approved'
        when owner_status = 'rejected' then 'rejected'
        else 'pending' end as display_status,
      case when owner_status = 'manually_credited' then 'Manually credited by Owner'
        when intent_status = 'executed' then 'Automatically credited'
        when owner_status = 'rejected' then 'Rejected by Owner'
        when owner_status = 'awaiting_manual_credit' then 'Earlier approval awaits completion'
        when submissions.amount_minor is not null
          and submissions.amount_minor not between 2500 and 2500000
          then 'Amount outside supported manual-credit limits; review required'
        when automatic_started then 'Automatic processing or reconciliation; check before manual credit'
        when manual_allowed and submissions.payment_event_id is null
          then 'Waiting for incoming SMS; verify bank record before manual credit'
        when manual_allowed then 'Incoming SMS recorded; review before manual credit'
        else 'This reference is already claimed or requires review' end as detail
    from submissions
  )
  select classified.case_id, classified.candidate_id, classified.legacy_candidate_id,
    classified.payment_event_id, classified.provider_code, classified.reference_masked,
    classified.submitted_at, classified.payment_at, classified.amount_minor,
    classified.receiver_account_id, classified.receiver_account_masked,
    classified.player_id, classified.display_status, classified.detail,
    classified.owner_status,
    classified.rejection_reason, classified.decided_at, classified.completed_at,
    (classified.display_status = 'pending' and classified.manual_allowed),
    (classified.display_status = 'pending' and classified.manual_allowed)
  from classified
  where classified.display_status = p_status
  order by classified.submitted_at desc,
    coalesce(classified.candidate_id,classified.legacy_candidate_id) desc
  limit p_limit offset p_offset;
end;
$$;
alter function app.list_owner_submitted_payments(uuid,text,integer,integer)
  owner to postgres;
revoke all on function app.list_owner_submitted_payments(uuid,text,integer,integer)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_submitted_payments(uuid,text,integer,integer)
  to fetanagent_owner_control;

commit;
