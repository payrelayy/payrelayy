-- Report a separately reviewed KemerBet History credit without rewriting the
-- original ambiguous Companion observation or authorizing another transfer.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app revoke execute on functions from public;

create function app.owner_history_approved_credit(p_deposit_intent_id uuid)
returns boolean language sql stable security invoker
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from app.deposit_intents intent
    join app.customer_platform_players player on player.id = intent.player_account_id
    join app.deposit_execution_attempts attempt on attempt.deposit_intent_id = intent.id
    join app.deposit_review_cases review_case on review_case.deposit_intent_id = intent.id
    join app.audit_events audit on audit.resource_type = 'deposit_intent'
      and audit.resource_id = intent.id
      and audit.action = 'deposit.owner_confirmed_kemerbet_history_approved'
    where intent.id = p_deposit_intent_id
      and intent.status = 'execution_review'
      and attempt.status = 'review_required'
      and review_case.id::text = audit.metadata ->> 'review_case_id'
      and review_case.status = 'resolved'
      and review_case.resolution_code = 'owner_confirmed_kemerbet_history_approved'
      and attempt.id::text = audit.metadata ->> 'execution_attempt_id'
      and player.player_id = audit.metadata ->> 'player_id'
      and intent.expected_amount_minor::text = audit.metadata ->> 'amount_minor'
      and audit.metadata ->> 'currency' = 'ETB'
      and audit.metadata ->> 'history_state' = 'Approved'
      and audit.metadata ->> 'money_action_performed' = 'false'
      and audit.metadata ->> 'history_transaction_id' ~ '^[0-9]{6,20}$'
      and audit.metadata ->> 'history_request_id' ~ '^[0-9]{6,20}$'
  );
$$;
alter function app.owner_history_approved_credit(uuid) owner to postgres;
revoke all on function app.owner_history_approved_credit(uuid)
  from public, anon, authenticated, service_role;

do $patch$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_pattern text;
  v_match_count integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'app.list_owner_submitted_payments(uuid,text,integer,integer)'::pg_catalog.regprocedure);
  v_old := 'intent.status::text as intent_status,';
  v_new := $new$case when app.owner_history_approved_credit(intent.id)
          then 'owner_history_approved' else intent.status::text end as intent_status,$new$;
  if v_definition is null or (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'Submitted-payment intent projection changed.';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);
  v_old := $old$case when owner_status = 'manually_credited' or intent_status = 'executed'$old$;
  v_new := $new$case when owner_status = 'manually_credited'
          or intent_status in ('executed','owner_history_approved')$new$;
  if (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'Submitted-payment status classification changed.';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);
  v_old := $old$when intent_status = 'executed' then 'Automatically credited'$old$;
  v_new := $new$when intent_status = 'owner_history_approved'
            then 'Credited in KemerBet; Owner confirmed its History entry'
          when intent_status = 'executed' then 'Automatically credited'$new$;
  if (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'Submitted-payment status detail changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);

  v_definition := pg_catalog.pg_get_functiondef(
    'app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)'::pg_catalog.regprocedure);
  v_old := $old$when intent.status = 'executed' then 'auto_credited'$old$;
  v_new := $new$when intent.status = 'executed'
          or app.owner_history_approved_credit(intent.id) then 'auto_credited'$new$;
  if v_definition is null or (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'Owner SMS credit status changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);

  v_definition := pg_catalog.pg_get_functiondef(
    'app.receiver_sms_duplicate_state(uuid)'::pg_catalog.regprocedure);
  v_old := $old$if v_case.status = 'manually_credited' or exists ($old$;
  v_new := $new$if v_case.status = 'manually_credited' or exists (
    select 1 from app.receiver_sms_deposit_candidates credited_candidate
    join app.receiver_sms_settlement_lineages credited_lineage
      on credited_lineage.candidate_id = credited_candidate.id
    where credited_candidate.payment_provider_id = v_candidate.payment_provider_id
      and credited_candidate.reference_fingerprint = v_candidate.reference_fingerprint
      and app.owner_history_approved_credit(credited_lineage.deposit_intent_id)
  ) or exists ($new$;
  if v_definition is null or (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'Duplicate-credit classification changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);

  v_definition := pg_catalog.pg_get_functiondef(
    'app.list_owner_provider_deposit_controls(uuid)'::pg_catalog.regprocedure);
  v_pattern := $pattern$and attempt\.status in \('prepared','final_action_fenced',\s*'reconciliation_required','review_required'\)$pattern$;
  select pg_catalog.count(*) into v_match_count
    from pg_catalog.regexp_matches(v_definition,v_pattern,'g');
  if v_definition is null or v_match_count <> 1 then
    raise exception 'Owner fenced-attempt count changed.';
  end if;
  v_new := $new$and (attempt.status in ('prepared','final_action_fenced',
            'reconciliation_required')
            or (attempt.status = 'review_required'
              and not app.owner_history_approved_credit(intent.id)))$new$;
  execute pg_catalog.regexp_replace(v_definition,v_pattern,v_new);
end;
$patch$;

commit;
