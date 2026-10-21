-- The SMS candidate keeps the Telegram submitter for audit and notification,
-- while the selected eligible Player's customer owns the deposit intent.
-- This restores the existing any-eligible-Player Owner policy. No old payment
-- is replayed and the SMS route must be stopped before this change.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004));

do $preflight$
declare
  v_switch_count integer;
begin
  if (select control.enabled from app.receiver_sms_route_control control
      where control.singleton) is distinct from false
    or exists (select 1 from app.receiver_sms_deposit_candidates)
    or exists (select 1 from app.deposit_jobs job
      where job.job_kind in ('execute_deposit','reconcile_execution')
        and job.status in ('queued','leased','retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared','final_action_fenced',
        'reconciliation_required','review_required')) then
    raise exception 'The SMS beneficiary migration requires stopped, empty settlement.';
  end if;
  select pg_catalog.count(*) into v_switch_count
    from app.feature_switches feature
    where feature.feature_key in (
      'payment_verification', 'deposit_execution',
      'cbe_birr_authoritative_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature.mode = 'disabled';
  if v_switch_count <> 7 then
    raise exception 'The SMS beneficiary migration requires seven disabled switches.';
  end if;
end;
$preflight$;

alter table app.receiver_sms_deposit_candidates
  add column beneficiary_customer_id uuid not null;
alter table app.receiver_sms_deposit_candidates
  drop constraint receiver_sms_deposit_candidat_player_account_id_submitting_fkey;
alter table app.receiver_sms_deposit_candidates
  add constraint receiver_sms_candidates_beneficiary_player_fkey
  foreign key (player_account_id, beneficiary_customer_id, platform_id)
  references app.customer_platform_players (id, customer_id, platform_id)
  on delete restrict;
comment on column app.receiver_sms_deposit_candidates.beneficiary_customer_id is
  'Owner of the selected eligible Player; may differ from the Telegram submitter.';

-- Replace only the reviewed production function bodies. Preserve function
-- identities, grants, owner, security-definer settings and dependent triggers.
create function pg_temp.replace_reviewed_sms_function(
  p_signature pg_catalog.regprocedure, p_source_sha256 text,
  p_old text[], p_new text[]
) returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $replace$
declare
  v_source text;
  v_expected text;
  v_definition text;
  v_old text;
  v_new text;
  v_index integer;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into v_source, v_definition
    from pg_catalog.pg_proc routine
    where routine.oid = p_signature
      and routine.proowner = 'postgres'::pg_catalog.regrole
      and routine.prosecdef and routine.prokind = 'f';
  if v_source is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(v_source, 'UTF8')), 'hex') <> p_source_sha256
    or pg_catalog.cardinality(p_old) <> pg_catalog.cardinality(p_new)
    or pg_catalog.cardinality(p_old) = 0 then
    raise exception 'The reviewed SMS function definition has changed.';
  end if;
  v_expected := v_source;
  for v_index in 1..pg_catalog.cardinality(p_old) loop
    v_old := p_old[v_index];
    v_new := p_new[v_index];
    if v_old is null or v_new is null or v_old = ''
      or pg_catalog.length(v_expected) -
        pg_catalog.length(pg_catalog.replace(v_expected, v_old, ''))
        <> pg_catalog.length(v_old) then
      raise exception 'The reviewed SMS function patch is not unique.';
    end if;
    v_expected := pg_catalog.replace(v_expected, v_old, v_new);
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  end loop;
  execute v_definition;
  if (select routine.prosrc from pg_catalog.pg_proc routine
      where routine.oid = p_signature) is distinct from v_expected then
    raise exception 'The reviewed SMS function patch is incomplete.';
  end if;
end;
$replace$;
revoke all on function pg_temp.replace_reviewed_sms_function(
  pg_catalog.regprocedure,text,text[],text[]) from public;

select pg_temp.replace_reviewed_sms_function(
  'app.capture_telegram_receiver_sms_candidate(uuid,text,text,text,text,text,smallint,smallint,text)'::pg_catalog.regprocedure,
  '381b42b2e4f6f1f54e4ec8c67c80b17b2c7273b4a848fa6a6fd2a392fa82253d',
  array[
    E'or v_player_owner is distinct from v_customer.id\n      or v_player_id is distinct from p_player_id',
    'or v_player_owner is distinct from v_customer.id then',
    E'origin_inbound_event_id, origin_identity_id, submitting_customer_id,\n    platform_id',
    E'p_origin_inbound_event_id, v_identity.id, v_customer.id,\n    v_platform_id'
  ], array[
    E'or v_player_owner is distinct from v_existing.beneficiary_customer_id\n      or v_player_id is distinct from p_player_id',
    'or v_player_owner is null then',
    E'origin_inbound_event_id, origin_identity_id, submitting_customer_id,\n    beneficiary_customer_id, platform_id',
    E'p_origin_inbound_event_id, v_identity.id, v_customer.id,\n    v_player_owner, v_platform_id'
  ]);

select pg_temp.replace_reviewed_sms_function(
  'app.populate_receiver_sms_intent_snapshot()'::pg_catalog.regprocedure,
  '6655c2d9d155417ccc290e77f85f8017601762335875c5052a1c1c5de7f3d799',
  array[
    'v_player.customer_id <> v_candidate.submitting_customer_id',
    'new.customer_id is distinct from v_candidate.submitting_customer_id'
  ], array[
    'v_player.customer_id <> v_candidate.beneficiary_customer_id',
    'new.customer_id is distinct from v_candidate.beneficiary_customer_id'
  ]);

select pg_temp.replace_reviewed_sms_function(
  'app.finalize_receiver_sms_match(uuid)'::pg_catalog.regprocedure,
  '1e62bda8ae0398c408fb79dda8df23e0e4a7cafbe5bda0ccc579197f1fb88354',
  array[
    'v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,'
  ], array[
    'v_intent_id, v_candidate.beneficiary_customer_id, v_candidate.platform_id,'
  ]);

select pg_temp.replace_reviewed_sms_function(
  'app.assess_receiver_sms_execution_job(uuid)'::pg_catalog.regprocedure,
  'dcddba7cc90f136c959a24b7f45dfe8f99227b5663518f268156fa0a5b8eb245',
  array[
    'intent.customer_id = candidate.submitting_customer_id'
  ], array[
    'intent.customer_id = candidate.beneficiary_customer_id'
  ]);

drop function pg_temp.replace_reviewed_sms_function(
  pg_catalog.regprocedure,text,text[],text[]);
commit;
