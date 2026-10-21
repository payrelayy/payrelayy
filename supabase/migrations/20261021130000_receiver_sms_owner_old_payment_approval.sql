-- An old signed receiver SMS is never auto-credited. Only an active Owner may
-- approve its exact immutable match; the ordinary one-use settlement path then
-- reruns every current receiver, Player, amount, switch and policy check.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- The existing private claim and settlement functions enforce the one-hour
-- deadline for ordinary payments. Permit only this exact audited Owner approval
-- to cross that deadline, leaving all other proof checks intact.
do $patch$
declare
  v_target pg_catalog.regprocedure;
  v_definition text;
  v_old text;
  v_new text;
begin
  v_target := 'app.claim_verified_deposit_payment(uuid,uuid,uuid)'::pg_catalog.regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  v_old := 'and not app.owner_approved_old_payment_for_intent(p_deposit_intent_id) then';
  v_new := 'and not app.owner_approved_old_payment_for_intent(p_deposit_intent_id)'
    || E'\n    and not app.receiver_sms_owner_approved_for_intent(p_deposit_intent_id) then';
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'Receiver SMS claim patch target changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);

  v_target := 'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'
    ::pg_catalog.regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  v_old := 'and not app.owner_approved_old_payment_for_intent(intent_row.id))';
  v_new := 'and not app.owner_approved_old_payment_for_intent(intent_row.id)'
    || E'\n      and not app.receiver_sms_owner_approved_for_intent(intent_row.id))';
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'Receiver SMS settlement patch target changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end;
$patch$;

create function app.list_owner_receiver_sms_old_payments(
  p_actor_auth_user_id uuid, p_limit integer default 25
) returns table (
  candidate_id uuid, provider_code text, submitted_at timestamptz,
  payment_at timestamptz, amount_minor bigint, reference_masked text,
  player_masked text, review_kind text, reason_code text
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select candidate.id, candidate.provider_code, candidate.submitted_at,
    sms.occurred_at, sms.amount_minor, candidate.reference_masked,
    '***' || pg_catalog.right(player.player_id, 4),
    case when matched.disposition = 'older_review' then 'older_approval'
      else 'held_review' end,
    case when matched.disposition = 'older_review' then 'old_payment'
      when held.reason_code is not null then held.reason_code
      else 'sms_match_uncertain' end
  from app.receiver_sms_deposit_candidates candidate
  left join app.receiver_sms_payment_matches matched on matched.candidate_id = candidate.id
  left join app.receiver_sms_payment_events sms on sms.id = matched.payment_event_id
  left join app.receiver_sms_settlement_holds held on held.candidate_id = candidate.id
  join app.customer_platform_players player on player.id = candidate.player_account_id
  where ((matched.disposition = 'older_review' and held.candidate_id is null
      and not exists (select 1 from app.receiver_sms_owner_decisions decision
        where decision.candidate_id = candidate.id))
    or matched.disposition = 'held_review' or held.candidate_id is not null)
    and not exists (select 1 from app.receiver_sms_settlement_lineages lineage
      where lineage.candidate_id = candidate.id)
  order by candidate.submitted_at, candidate.id
  limit p_limit;
end;
$$;
alter function app.list_owner_receiver_sms_old_payments(uuid,integer) owner to postgres;
revoke all on function app.list_owner_receiver_sms_old_payments(uuid,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

create function app.decide_owner_receiver_sms_old_payment(
  p_actor_auth_user_id uuid, p_candidate_id uuid, p_decision text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_actor_id uuid;
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_match app.receiver_sms_payment_matches%rowtype;
  v_sms app.receiver_sms_payment_events%rowtype;
  v_decision app.receiver_sms_owner_decisions%rowtype;
  v_settled record;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_candidate_id is null
    or p_decision is null or p_decision not in ('approve','reject') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
    for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id for update;
  select * into v_match from app.receiver_sms_payment_matches matched
    where matched.candidate_id = p_candidate_id for share;
  select * into v_sms from app.receiver_sms_payment_events sms
    where sms.id = v_match.payment_event_id for share;
  if v_candidate.id is null or v_match.disposition <> 'older_review'
    or v_sms.id is null or v_sms.provider_code <> v_candidate.provider_code
    or v_sms.reference_fingerprint <> v_candidate.reference_fingerprint
    or not (v_sms.occurred_at < v_candidate.submitted_at - interval '1 hour'
      or pg_catalog.clock_timestamp() >= v_sms.occurred_at + interval '1 hour')
    or exists (select 1 from app.receiver_sms_owner_decisions decision
      where decision.candidate_id = p_candidate_id)
    or exists (select 1 from app.receiver_sms_settlement_lineages lineage
      where lineage.candidate_id = p_candidate_id)
    or exists (select 1 from app.receiver_sms_settlement_holds held
      where held.candidate_id = p_candidate_id)
    or exists (select 1 from app.deposit_payment_claims claim
      join app.provider_payment_evidence evidence
        on evidence.id = claim.provider_payment_evidence_id
      where evidence.payment_provider_id = v_sms.payment_provider_id
        and evidence.canonical_reference_fingerprint = v_sms.reference_fingerprint) then
    raise exception 'The old receiver SMS payment is no longer eligible for a decision.';
  end if;
  insert into app.receiver_sms_owner_decisions
    (candidate_id,payment_event_id,decision,actor_admin_id)
    values (p_candidate_id,v_sms.id,
      case when p_decision = 'approve' then 'approved' else 'rejected' end,v_actor_id)
    returning * into v_decision;
  if p_decision = 'reject' then
    return pg_catalog.jsonb_build_object('decision','rejected',
      'decidedAt',v_decision.decided_at);
  end if;
  select * into v_settled from app.finalize_receiver_sms_match(p_candidate_id);
  if v_settled.payment_claim_id is null or v_settled.execution_job_id is null
    or v_settled.already_finalized is distinct from false then
    raise exception 'The old receiver SMS payment was not admitted to the normal credit path.';
  end if;
  return pg_catalog.jsonb_build_object('decision','approved',
    'decidedAt',v_decision.decided_at,
    'depositIntentId',v_settled.deposit_intent_id,
    'executionJobId',v_settled.execution_job_id);
end;
$$;
alter function app.decide_owner_receiver_sms_old_payment(uuid,uuid,text) owner to postgres;
revoke all on function app.decide_owner_receiver_sms_old_payment(uuid,uuid,text)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

-- No Owner grant in the migration: the currently deployed Owner service has
-- an exact catalog and must not fail before its replacement is deployed.

comment on table app.receiver_sms_owner_decisions is
  'Immutable active-Owner decision for an exact older signed receiver SMS match.';
commit;
