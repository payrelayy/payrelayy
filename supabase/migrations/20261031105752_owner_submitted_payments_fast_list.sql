-- Evaluate the 60-minute Owner handoff only for the displayed page.
-- Preserve the existing status, order, decision guards, and Owner-only access.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'app.list_owner_submitted_payments(uuid,text,integer,integer)'::pg_catalog.regprocedure);
begin
  if v_definition is null
    or pg_catalog.strpos(v_definition,
      'app.receiver_sms_duplicate_state(candidate.id)') = 0
    or pg_catalog.strpos(v_definition,
      'app.owner_expired_unattempted_sms_candidate(candidate.id)') = 0 then
    raise exception 'Owner submitted-payment listing changed before fast-list migration.';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION app.list_owner_submitted_payments(p_actor_auth_user_id uuid, p_status text, p_limit integer, p_offset integer)
 RETURNS TABLE(case_id uuid, candidate_id uuid, legacy_candidate_id uuid, payment_event_id uuid, provider_code text, reference_masked text, submitted_at timestamp with time zone, payment_at timestamp with time zone, amount_minor bigint, receiver_account_id uuid, receiver_account_masked text, player_id text, payment_status text, status_detail text, owner_case_status text, rejection_reason text, decided_at timestamp with time zone, completed_at timestamp with time zone, can_approve boolean, can_reject boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
          and (sms.id is null or sms.amount_minor between 1 and 9999999999)
          and not exists (select 1 from app.receiver_sms_deposit_candidates earlier
            where earlier.provider_code = candidate.provider_code
              and earlier.reference_fingerprint = candidate.reference_fingerprint
              and (earlier.submitted_at,earlier.id) <
                (candidate.submitted_at,candidate.id))) as manual_allowed,
        (lineage.candidate_id is not null or evidence.id is not null
          or opening.id is not null) as automatic_started,
        (
          exists (
            select 1
            from app.receiver_sms_settlement_lineages credited_lineage
            join app.receiver_sms_deposit_candidates credited_candidate
              on credited_candidate.id = credited_lineage.candidate_id
            join app.deposit_intents credited_intent
              on credited_intent.id = credited_lineage.deposit_intent_id
            join app.deposit_execution_attempts credited_attempt
              on credited_attempt.deposit_intent_id = credited_intent.id
                and credited_attempt.deposit_job_id = credited_lineage.execution_job_id
            where credited_candidate.provider_code = candidate.provider_code
              and credited_candidate.payment_provider_id = candidate.payment_provider_id
              and credited_candidate.reference_fingerprint = candidate.reference_fingerprint
              and credited_candidate.player_account_id = candidate.player_account_id
              and credited_candidate.id <> candidate.id
              and (credited_candidate.submitted_at, credited_candidate.id) <
                (candidate.submitted_at, candidate.id)
              and credited_intent.player_account_id = candidate.player_account_id
              and credited_intent.status = 'executed'
              and credited_attempt.status = 'confirmed_executed'
              and credited_attempt.exact_player_credit_match is true
          )
        ) as already_credited_same_player,
        app.receiver_sms_duplicate_state(candidate.id) as duplicate_state,
        owner_case.id is null as no_owner_case,
        (execution_job.status = 'cancelled'
          and execution_job.last_error_code = 'automatic_window_expired_before_action'
          and execution_job.attempt_count = 0
          and execution_job.lease_token is null) as expired_job_possible
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
      left join app.deposit_jobs execution_job on execution_job.id = lineage.execution_job_id
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
          and observation.amount_minor between 1 and 9999999999
          and opening.challenge_id is null) as manual_allowed,
        (evidence.id is not null or opening.challenge_id is not null) as automatic_started,
        false as already_credited_same_player,
        null::text as duplicate_state,
        owner_case.id is null as no_owner_case,
        false as expired_job_possible
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
          when owner_status is null and intent_status is null
            and duplicate_state <> 'none' then 'rejected'
          else 'pending' end as display_status
      from submissions
    ), paged as materialized (
      select classified.*
      from classified
      where classified.display_status = p_status
      order by classified.submitted_at desc,
        coalesce(classified.candidate_id,classified.legacy_candidate_id) desc
      limit p_limit offset p_offset
    ), enriched as materialized (
      select paged.*,
        (paged.candidate_id is not null
          and paged.intent_status = 'execution_review'
          and paged.expired_job_possible is true
          and app.owner_expired_unattempted_sms_candidate(paged.candidate_id)) as expired_candidate
      from paged
    )
    select enriched.case_id, enriched.candidate_id, enriched.legacy_candidate_id,
      enriched.payment_event_id, enriched.provider_code, enriched.reference_masked,
      enriched.submitted_at, enriched.payment_at, enriched.amount_minor,
      enriched.receiver_account_id, enriched.receiver_account_masked,
      enriched.player_id, enriched.display_status,
        case when owner_status = 'manually_credited' then 'Manually credited by Owner'
          when intent_status = 'executed' then 'Automatically credited'
          when owner_status = 'rejected' then 'Rejected by Owner'
          when duplicate_state = 'credited' then 'Already credited — repeat rejected'
          when duplicate_state = 'same_account_pending' then 'Repeat from same Telegram account — original payment pending'
          when duplicate_state = 'other_account_pending' then 'Repeat from another Telegram account — rejected'
          when duplicate_state = 'closed' then 'Earlier payment closed — repeat rejected'
          when duplicate_state = 'recorded_elsewhere' then 'Payment already recorded — repeat rejected'
          when owner_status = 'awaiting_manual_credit' then 'Earlier approval awaits completion'
          when enriched.amount_minor is not null
            and enriched.amount_minor not between 10000 and 2500000
            then 'Outside automatic range; verify and approve for manual credit'
          when enriched.expired_candidate
            then 'Automatic window expired; Owner decision needed'
          when automatic_started then 'Automatic processing or reconciliation; check before manual credit'
          when manual_allowed and enriched.payment_event_id is null
            then 'Waiting for incoming SMS; verify bank record before manual credit'
          when manual_allowed then 'Incoming SMS recorded; review before manual credit'
          else 'This reference is already claimed or requires review' end as detail,
      enriched.owner_status,
      enriched.rejection_reason, enriched.decided_at, enriched.completed_at,
      (enriched.display_status = 'pending'
        and (enriched.manual_allowed
          or (enriched.no_owner_case and enriched.expired_candidate))),
      (enriched.display_status = 'pending'
        and (enriched.manual_allowed
          or (enriched.no_owner_case and enriched.expired_candidate)))
    from enriched
    order by enriched.submitted_at desc,
      coalesce(enriched.candidate_id,enriched.legacy_candidate_id) desc;
end;
$function$


alter function app.list_owner_submitted_payments(uuid,text,integer,integer)
  owner to postgres;
revoke all on function app.list_owner_submitted_payments(uuid,text,integer,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.list_owner_submitted_payments(uuid,text,integer,integer)
  to fetanagent_owner_control;

commit;
