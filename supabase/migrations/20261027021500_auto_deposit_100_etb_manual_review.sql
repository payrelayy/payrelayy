-- A versioned 100–25,000 ETB automatic policy. Signed payments outside that
-- range stay in Owner review and may be recorded as manually credited for their
-- exact positive bank amount. Keep the 25 ETB pilot ledger and historical policy.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Serialize with SMS matching and Owner decisions. Do not strand an in-flight
-- execution under a retired policy. A busy system retries this migration later.
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
lock table app.deposit_intents, app.deposit_jobs in share row exclusive mode;

-- The authorization ledger is append-only. Preserve the historical 25 ETB
-- record while permitting the new 100 ETB revision.
alter table app.routine_telebirr_processing_authorizations
  drop constraint routine_telebirr_processing_authoriz_minimum_amount_minor_check;
alter table app.routine_telebirr_processing_authorizations
  add constraint routine_telebirr_processing_authoriz_minimum_amount_minor_check
  check (minimum_amount_minor in (2500, 10000));
alter table app.routine_telebirr_processing_authorizations
  alter column minimum_amount_minor set default 10000;

do $cutover$
declare
  v_prior app.routine_telebirr_processing_authorizations%rowtype;
  v_event app.routine_telebirr_processing_events%rowtype;
  v_policy app.deposit_policy_versions%rowtype;
  v_new_policy_id uuid;
  v_new_authorization_id uuid;
begin
  if exists (select 1 from app.deposit_jobs job
      where job.status not in ('succeeded','cancelled','dead'))
    or exists (select 1 from app.deposit_intents intent
      where intent.status in ('execution_pending','execution_in_progress',
        'execution_reconciliation','execution_uncertain')) then
    raise exception 'Wait for active deposit executions before changing the amount policy.';
  end if;

  select * into v_event from app.routine_telebirr_processing_events
    order by event_sequence desc limit 1;
  select * into v_prior from app.routine_telebirr_processing_authorizations
    where id = v_event.authorization_id;
  select * into v_policy from app.deposit_policy_versions
    where status = 'active' for update;
  -- An unowned initial seed has no execution authorization. Keep its historic
  -- version until an Owner establishes the new policy; it cannot credit.
  if v_event.event_sequence is null
    and v_policy.version = 1
    and v_policy.created_by_admin_id is null
    and v_policy.minimum_amount_minor = 2500
    and v_policy.maximum_amount_minor = 2500000
    and v_policy.freshness_window_seconds = 3600
    and not exists (select 1 from app.routine_telebirr_processing_authorizations) then
    return;
  end if;
  if v_event.event_kind is distinct from 'authorize'
    or v_prior.id is null
    or v_prior.minimum_amount_minor <> 2500
    or v_prior.maximum_amount_minor <> 2500000
    or v_policy.id is null
    or v_policy.id <> v_prior.deposit_policy_version_id
    or v_policy.minimum_amount_minor <> 2500
    or v_policy.maximum_amount_minor <> 2500000
    or v_policy.freshness_window_seconds <> 3600
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.id = v_prior.authorized_by_admin_id
        and owner_user.role = 'owner' and owner_user.status = 'active')
    or not exists (select 1 from app.platform_agent_accounts agent
      where agent.id = v_prior.platform_agent_account_id
        and agent.status = 'active') then
    raise exception 'The active Owner policy has changed; inspect it before cutover.';
  end if;

  v_new_policy_id := app.set_deposit_policy(
    v_prior.authorized_by_admin_id, 10000, 2500000, 3600);
  insert into app.routine_telebirr_processing_authorizations
    (platform_agent_account_id, deposit_policy_version_id,
      authorized_by_admin_id, minimum_amount_minor)
  values (v_prior.platform_agent_account_id, v_new_policy_id,
    v_prior.authorized_by_admin_id, 10000)
  returning id into v_new_authorization_id;
  insert into app.routine_telebirr_processing_events
    (request_key, authorization_id, event_kind, actor_admin_id)
  values (pg_catalog.gen_random_uuid(), v_new_authorization_id,
    'authorize', v_prior.authorized_by_admin_id);
end;
$cutover$;

-- Automatic boundaries all use the same minimum. These functions were
-- inspected individually; the exact source-hit guard prevents broad, silent
-- rewrites if a future migration changes any one of them.
do $automatic_functions$
declare
  v_row record;
  v_oid oid;
  v_count integer;
  v_definition text;
begin
  for v_row in
    select * from (values
      ('activate_receiver_sms_financial_gates', 1),
      ('activate_routine_telebirr_financial_gates', 1),
      ('capture_telegram_routine_telebirr_untrusted_proof', 1),
      ('enqueue_verified_deposit_execution', 2),
      ('fence_deposit_execution_final_action', 2),
      ('finalize_receiver_sms_match', 2),
      ('finalize_routine_telebirr_paid_observation', 2),
      ('issue_routine_telebirr_paid_lookup_challenge', 1),
      ('issue_routine_telebirr_paid_poll_assignment', 1),
      ('lease_next_deposit_execution', 2),
      ('lease_private_live_deposit_by_provider', 2),
      ('match_receiver_sms_payment', 1),
      ('populate_receiver_sms_intent_snapshot', 1),
      ('prepare_telegram_routine_telebirr_paid_destination_core', 1),
      ('queue_receiver_sms_customer_outcome', 1),
      ('resolve_current_live_customer_deposit_boundary', 1),
      ('resume_receiver_sms_cbe_stopped_financial_gates', 1),
      ('routine_telebirr_runtime_policy_json', 1),
      ('save_owner_routine_telebirr_processing', 1),
      ('stage_routine_telebirr_paid_signed_observation', 2)
    ) as targets(name, expected_hits)
  loop
    select pg_catalog.count(*)::integer, pg_catalog.max(p.oid)
      into v_count, v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = v_row.name;
    if v_count <> 1 then
      raise exception 'Expected one app.% function, found %', v_row.name, v_count;
    end if;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.regexp_count(v_definition, '\m2500\M') <> v_row.expected_hits then
      raise exception 'Unexpected old range in app.%', v_row.name;
    end if;
    v_definition := pg_catalog.regexp_replace(v_definition, '\m2500\M', '10000', 'g');
    if v_row.name = 'resolve_current_live_customer_deposit_boundary' then
      if pg_catalog.strpos(v_definition,
          'The current 25 to 25000 ETB deposit policy is unavailable.') = 0 then
        raise exception 'The customer deposit policy message has changed.';
      end if;
      v_definition := pg_catalog.replace(v_definition,
        'The current 25 to 25000 ETB deposit policy is unavailable.',
        'The current 100 to 25000 ETB deposit policy is unavailable.');
    end if;
    if v_row.name = 'save_owner_routine_telebirr_processing' then
      if pg_catalog.strpos(v_definition,
          'if policy_id is null then raise exception ''The documented deposit policy is required.''; end if;') = 0 then
        raise exception 'The Owner policy save has changed.';
      end if;
      v_definition := pg_catalog.replace(v_definition,
        'if policy_id is null then raise exception ''The documented deposit policy is required.''; end if;',
        $first_owner_policy$
if policy_id is null then
  if exists (select 1 from app.deposit_policy_versions policy
      where policy.status = 'active' and policy.version = 1
        and policy.created_by_admin_id is null
        and policy.minimum_amount_minor = 2500
        and policy.maximum_amount_minor = 2500000
        and policy.freshness_window_seconds = 3600)
    and not exists (select 1 from app.routine_telebirr_processing_authorizations)
    and not exists (select 1 from app.deposit_jobs job
      where job.status not in ('succeeded','cancelled','dead')) then
    policy_id := app.set_deposit_policy(actor_id,10000,2500000,3600);
  else
    raise exception 'The documented deposit policy is required.';
  end if;
end if;
$first_owner_policy$);
    end if;
    execute v_definition;
  end loop;
end;
$automatic_functions$;

-- The SMS ledger accepts any positive amount. Only automatic settlement is
-- limited to 100–25,000 ETB; Owner completion and its Telegram message are not.
alter table app.owner_manual_payment_cases
  drop constraint owner_manual_payment_cases_amount_minor_check;
alter table app.owner_manual_payment_cases
  add constraint owner_manual_payment_cases_amount_minor_check
  check (amount_minor between 1 and 9999999999);
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_deposit_outcome_deliveries_amount_minor_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_deposit_outcome_deliveries_amount_minor_check
  check (amount_minor is null or amount_minor between 1 and 9999999999);

do $manual_functions$
declare
  v_name text;
  v_oid oid;
  v_count integer;
  v_expected_hits integer;
  v_definition text;
begin
  foreach v_name in array array[
    'complete_owner_manual_payment_case',
    'queue_owner_manual_payment_outcome'
  ] loop
    select pg_catalog.count(*)::integer, pg_catalog.max(p.oid)
      into v_count, v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = v_name;
    if v_count <> 1 then raise exception 'Expected one app.% function', v_name; end if;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    v_expected_hits := case when v_name = 'complete_owner_manual_payment_case' then 2 else 1 end;
    if pg_catalog.regexp_count(v_definition, 'between 2500 and 2500000') <>
      v_expected_hits then
      raise exception 'Unexpected manual range in app.%', v_name;
    end if;
    execute pg_catalog.replace(v_definition,
      'between 2500 and 2500000', 'between 1 and 9999999999');
  end loop;
end;
$manual_functions$;

-- Keep pending out-of-range submissions actionable in the Owner page. The
-- existing reference reservation and automatic-evidence guards remain intact.
do $owner_projection$
declare
  v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'app.list_owner_submitted_payments(uuid,text,integer,integer)'::regprocedure);
  if pg_catalog.regexp_count(v_definition,
      'and \(sms\.id is null or sms\.amount_minor between 2500 and 2500000\)') <> 1
    or pg_catalog.regexp_count(v_definition,
      'and observation\.amount_minor between 2500 and 2500000') <> 1
    or pg_catalog.regexp_count(v_definition,
      'submissions\.amount_minor not between 2500 and 2500000') <> 1 then
    raise exception 'The Owner payment projection has changed.';
  end if;
  v_definition := pg_catalog.replace(v_definition,
    'and (sms.id is null or sms.amount_minor between 2500 and 2500000)',
    'and (sms.id is null or sms.amount_minor between 1 and 9999999999)');
  v_definition := pg_catalog.replace(v_definition,
    'and observation.amount_minor between 2500 and 2500000',
    'and observation.amount_minor between 1 and 9999999999');
  v_definition := pg_catalog.replace(v_definition,
    'submissions.amount_minor not between 2500 and 2500000',
    'submissions.amount_minor not between 10000 and 2500000');
  v_definition := pg_catalog.replace(v_definition,
    'Amount outside supported manual-credit limits; review required',
    'Outside automatic range; verify and approve for manual credit');
  execute v_definition;
end;
$owner_projection$;

commit;
