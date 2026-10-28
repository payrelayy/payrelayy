-- A reference belongs to its first Telegram submission. A repeat never
-- acquires a payment match or a second credit. Classify the repeat from the
-- protected payment ledger and the immutable submission/Owner history.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.receiver_sms_duplicate_state(p_candidate_id uuid)
returns text language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_first app.receiver_sms_deposit_candidates%rowtype;
  v_legacy app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_case app.owner_manual_payment_cases%rowtype;
  v_prior_identity_id uuid;
  v_legacy_is_first boolean := false;
begin
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id;
  if v_candidate.id is null then
    raise exception 'The payment submission is unavailable.';
  end if;
  select * into v_case from app.owner_manual_payment_cases owner_case
    where owner_case.payment_provider_id = v_candidate.payment_provider_id
      and owner_case.reference_fingerprint = v_candidate.reference_fingerprint;
  if v_case.status = 'manually_credited' or exists (
    select 1 from app.provider_payment_evidence evidence
    join app.deposit_payment_claims claim
      on claim.provider_payment_evidence_id = evidence.id
    join app.deposit_intents intent on intent.id = claim.deposit_intent_id
    where evidence.payment_provider_id = v_candidate.payment_provider_id
      and evidence.canonical_reference_fingerprint = v_candidate.reference_fingerprint
      and intent.status = 'executed'
  ) then
    return 'credited';
  end if;

  select * into v_first from app.receiver_sms_deposit_candidates candidate
    where candidate.provider_code = v_candidate.provider_code
      and candidate.reference_fingerprint = v_candidate.reference_fingerprint
    order by candidate.submitted_at, candidate.id limit 1;
  if v_candidate.provider_code = 'telebirr' then
    select * into v_legacy from app.routine_telebirr_untrusted_proof_requests proof
      where proof.payment_provider_id = v_candidate.payment_provider_id
        and proof.candidate_reference_fingerprint = v_candidate.reference_fingerprint
        and proof.intake_mode = 'paid' and proof.origin_channel = 'telegram'
      order by proof.submitted_at, proof.id limit 1;
    v_legacy_is_first := v_legacy.id is not null
      and v_legacy.submitted_at <= v_first.submitted_at;
  end if;

  if v_case.status = 'rejected' then return 'closed'; end if;
  if v_legacy_is_first then
    if exists (select 1 from app.routine_telebirr_old_payment_decisions decision
        where decision.candidate_id = v_legacy.id and decision.decision = 'rejected')
      or exists (select 1 from app.routine_telebirr_fast_results result
        where result.candidate_id = v_legacy.id
          and result.outcome_code <> 'held_review')
      or exists (select 1 from app.telegram_deposit_outcome_deliveries delivery
        where delivery.candidate_id = v_legacy.id
          and delivery.outcome_code in
            ('rejected','not_credited','not_verified','wrong_receiver',
             'invalid_reference','unrelated_receipt','old_rejected')) then
      return 'closed';
    end if;
    v_prior_identity_id := v_legacy.origin_identity_id;
  else
    if exists (select 1 from app.receiver_sms_owner_decisions decision
        where decision.candidate_id = v_first.id and decision.decision = 'rejected')
      or exists (select 1 from app.receiver_sms_settlement_lineages lineage
        join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
        where lineage.candidate_id = v_first.id
          and intent.status in ('rejected','expired','cancelled')) then
      return 'closed';
    end if;
    if v_first.id <> v_candidate.id then
      v_prior_identity_id := v_first.origin_identity_id;
    end if;
  end if;

  if v_prior_identity_id is not null then
    if v_prior_identity_id = v_candidate.origin_identity_id then
      return 'same_account_pending';
    end if;
    return 'other_account_pending';
  end if;
  if v_case.id is not null and v_case.candidate_id is distinct from v_candidate.id then
    return 'recorded_elsewhere';
  end if;
  return 'none';
end;
$$;
alter function app.receiver_sms_duplicate_state(uuid) owner to postgres;
revoke all on function app.receiver_sms_duplicate_state(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime;

-- Only the exact inbound event that created the candidate may obtain its
-- immediate, reference-free customer classification.
create function app.telegram_receiver_sms_duplicate_state(
  p_origin_inbound_event_id uuid, p_candidate_id uuid
) returns text language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp as $$
declare v_origin_inbound_event_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime')
    or p_origin_inbound_event_id is null or p_candidate_id is null then
    raise exception using errcode = '42501',
      message = 'The payment submission result is unavailable.';
  end if;
  select candidate.origin_inbound_event_id into v_origin_inbound_event_id
    from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id;
  if v_origin_inbound_event_id is distinct from p_origin_inbound_event_id then
    raise exception using errcode = '42501',
      message = 'The payment submission result is unavailable.';
  end if;
  return app.receiver_sms_duplicate_state(p_candidate_id);
end;
$$;
alter function app.telegram_receiver_sms_duplicate_state(uuid,uuid) owner to postgres;
revoke all on function app.telegram_receiver_sms_duplicate_state(uuid,uuid)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.telegram_receiver_sms_duplicate_state(uuid,uuid)
  to fetanagent_player_actions_runtime;

-- The old TeleBirr paid path can precede the current SMS path. Do not give a
-- later SMS candidate the old reference's payment match while it is being
-- reported as a repeat. Existing exact matches remain untouched.
do $patch_match$
declare v_source text; v_old text; v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.match_receiver_sms_payment(text,text)'::pg_catalog.regprocedure);
  v_old := '  if exists (select 1 from app.receiver_sms_payment_matches match'
    || E'\n' || '      where match.candidate_id = v_candidate.id or match.payment_event_id = v_event.id) then';
  v_new := '  if app.receiver_sms_duplicate_state(v_candidate.id) <> ''none'' then'
    || E'\n' || '    return ''duplicate'';'
    || E'\n' || '  end if;'
    || E'\n' || v_old;
  if v_source is null or pg_catalog.length(v_source)
      - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
      <> pg_catalog.length(v_old) then
    raise exception 'The receiver SMS match source changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$patch_match$;

-- Serialize new submissions for the same provider/reference before assigning
-- their timestamp. Millisecond ties must never let a later Player become first.
do $patch_capture$
declare v_source text; v_old text; v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.capture_telegram_receiver_sms_candidate(uuid,text,text,text,text,text,smallint,smallint,text)'
      ::pg_catalog.regprocedure);
  v_old := '  v_captured_at := pg_catalog.date_trunc(''milliseconds'', pg_catalog.clock_timestamp());';
  v_new := '  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('
    || E'\n' || '    p_provider_code || '':'' || p_reference_fingerprint, 20261021));'
    || E'\n' || '  v_captured_at := greatest('
    || E'\n' || '    pg_catalog.date_trunc(''milliseconds'', pg_catalog.clock_timestamp()),'
    || E'\n' || '    coalesce((select max(prior.submitted_at) + interval ''1 millisecond'''
    || E'\n' || '      from app.receiver_sms_deposit_candidates prior'
    || E'\n' || '      where prior.provider_code = p_provider_code'
    || E'\n' || '        and prior.reference_fingerprint = p_reference_fingerprint),'
    || E'\n' || '      ''-infinity''::timestamptz));';
  if v_source is null or pg_catalog.length(v_source)
      - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
      <> pg_catalog.length(v_old) then
    raise exception 'The receiver SMS capture timestamp source changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$patch_capture$;

-- Owner sees every repeat under Rejected, with no manual action. The first
-- submission keeps its normal pending/approved status and Player assignment.
do $patch_owner$
declare v_source text; v_old text; v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.list_owner_submitted_payments(uuid,text,integer,integer)'
      ::pg_catalog.regprocedure);
  if v_source is null then raise exception 'The Owner payment list is unavailable.'; end if;
  v_old := '      ) as already_credited_same_player';
  v_new := v_old || ',' || E'\n'
    || '      app.receiver_sms_duplicate_state(candidate.id) as duplicate_state';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The Owner candidate projection changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);

  v_old := '      false as already_credited_same_player';
  v_new := v_old || ',' || E'\n' || '      null::text as duplicate_state';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The Owner legacy projection changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);

  v_old := '        when owner_status is null and intent_status is null'
    || E'\n' || '          and already_credited_same_player then ''approved''';
  v_new := '        when owner_status is null and intent_status is null'
    || E'\n' || '          and duplicate_state <> ''none'' then ''rejected''';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The Owner duplicate status changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);

  v_old := '        when owner_status is null and intent_status is null'
    || E'\n' || '          and already_credited_same_player then ''Already credited — duplicate submission''';
  v_new := '        when duplicate_state = ''credited'' then ''Already credited — repeat rejected'''
    || E'\n' || '        when duplicate_state = ''same_account_pending'''
    || ' then ''Repeat from same Telegram account — original payment pending'''
    || E'\n' || '        when duplicate_state = ''other_account_pending'''
    || ' then ''Repeat from another Telegram account — rejected'''
    || E'\n' || '        when duplicate_state = ''closed'''
    || ' then ''Earlier payment closed — repeat rejected'''
    || E'\n' || '        when duplicate_state = ''recorded_elsewhere'''
    || ' then ''Payment already recorded — repeat rejected''';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'The Owner duplicate detail changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$patch_owner$;

comment on function app.receiver_sms_duplicate_state(uuid) is
  'Internal, reference-free classification of an SMS submission against known credits, first Telegram submission, and terminal decisions.';
comment on function app.telegram_receiver_sms_duplicate_state(uuid,uuid) is
  'Player-action-only classification bound to the exact inbound Telegram event; it cannot create a payment match, claim, job, or credit.';
commit;
