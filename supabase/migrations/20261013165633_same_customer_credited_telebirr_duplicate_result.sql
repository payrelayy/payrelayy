-- A later Telegram submission by the same customer of a reference already
-- credited through the paid ledger is terminal. Do not reveal another
-- customer's payment, infer duplication from untrusted candidates, or issue
-- another paid phone assignment for this known completed reference.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function app.routine_telebirr_same_customer_credited_reference(p_candidate_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (
    select 1
      from app.routine_telebirr_untrusted_proof_requests candidate
      join app.routine_telebirr_paid_intent_openings previous_opening
        on previous_opening.payment_provider_id = candidate.payment_provider_id
       and previous_opening.reference_fingerprint =
           candidate.candidate_reference_fingerprint
      join app.routine_telebirr_untrusted_proof_requests previous_candidate
        on previous_candidate.id = previous_opening.candidate_id
       and previous_candidate.submitting_customer_id = candidate.submitting_customer_id
      join app.deposit_intents previous_intent
        on previous_intent.id = previous_opening.deposit_intent_id
       and previous_intent.status = 'executed'
     where candidate.id = p_candidate_id
       and candidate.intake_mode = 'paid'
       and candidate.origin_channel = 'telegram'
       and previous_candidate.id <> candidate.id
  );
$$;
alter function app.routine_telebirr_same_customer_credited_reference(uuid) owner to postgres;
revoke all on function app.routine_telebirr_same_customer_credited_reference(uuid)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_telebirr_assignment_broker,
       fetanagent_telebirr_assignment_broker_runtime;
comment on function app.routine_telebirr_same_customer_credited_reference(uuid) is
  'Postgres-owned internal predicate: only a previous executed paid intent for the same customer and protected provider reference is a known duplicate.';

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check
  check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected',
    'not_credited', 'not_verified', 'already_used'
  ));

-- Patch only reviewed fragments of the existing security-definer functions.
-- Any drift fails the whole migration; no existing financial function changes.
do $migration$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.claim_telegram_deposit_outcome_notification()'::pg_catalog.regprocedure
  ) into v_source;
  if v_source is null then
    raise exception 'The Telegram outcome claim source is unavailable.';
  end if;
  v_old := 'case when intent.status = ''executed'' then ''credited''';
  v_new := 'case when opening.candidate_id is null and '
    || 'app.routine_telebirr_same_customer_credited_reference(candidate.id)'
    || E' then ''already_used''\n              '
    || 'when intent.status = ''executed'' then ''credited''';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram final outcome mapping has changed.';
  end if;
  v_source := pg_catalog.replace(v_source, v_old, v_new);

  v_old := '       or (opening.candidate_id is null'
    || E'\n           and candidate.submitted_at <= v_now - interval ''70 minutes'')';
  v_new := '       or (opening.candidate_id is null'
    || E'\n           and (candidate.submitted_at <= v_now - interval ''70 minutes'''
    || E'\n             or app.routine_telebirr_same_customer_credited_reference(candidate.id)))';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The Telegram final eligibility guard has changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);

  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'::pg_catalog.regprocedure
  ) into v_source;
  v_old := '     and candidate.submitted_at + interval ''1 hour 5 minutes'' > v_now';
  v_new := v_old || E'\n     and not app.routine_telebirr_same_customer_credited_reference(candidate.id)';
  if v_source is null or
     pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The paid poll candidate guard has changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);

  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) into v_source;
  v_old := '    or v_candidate.submitted_at + interval ''1 hour 5 minutes'' <= v_now then';
  v_new := '    or v_candidate.submitted_at + interval ''1 hour 5 minutes'' <= v_now'
    || E'\n    or app.routine_telebirr_same_customer_credited_reference(v_candidate.id) then';
  if v_source is null or
     pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old, ''))
     <> pg_catalog.length(v_old) then
    raise exception 'The paid challenge candidate guard has changed.';
  end if;
  execute pg_catalog.replace(v_source, v_old, v_new);
end;
$migration$;

comment on function app.claim_telegram_deposit_outcome_notification() is
  'Bot-only bounded delivery: same-customer previously credited references receive an immediate final already-used result; other untrusted references retain normal verification windows.';
comment on function app.issue_routine_telebirr_paid_poll_assignment(
  uuid,uuid,text,timestamptz,uuid) is
  'Paid phone poll excludes same-customer references already executed in the paid ledger, preserving the global no-double-credit boundary.';

commit;
