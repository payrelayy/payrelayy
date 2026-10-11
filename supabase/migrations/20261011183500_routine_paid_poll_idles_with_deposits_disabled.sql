-- A paired phone keeps polling its paid lane while the Owner has paused deposits.
-- The exact all-disabled TeleBirr gate state means no assignment, not a broken
-- database connection. Return no rows without claiming a poll or touching a
-- candidate; preserve the existing exception for every partial/mixed state.
-- This migration does not enable a financial switch or create a payment job.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $routine_paid_poll_idle$
declare
  target constant pg_catalog.regprocedure :=
    'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'
      ::pg_catalog.regprocedure;
  source_body text;
  definition text;
  expected_body text;
  old_declaration constant text := '  v_live_count integer;';
  new_declaration constant text := E'  v_live_count integer;\n  v_disabled_count integer;';
  old_gate constant text := $old_gate$
  if v_switch_count <> 4 or v_live_count <> 4 then
    raise exception 'The routine paid poll requires live generic deposit gates and no legacy TeleBirr pilot.';
  end if;$old_gate$;
  new_gate constant text := $new_gate$
  if v_switch_count <> 4 then
    raise exception 'The routine paid poll requires live generic deposit gates and no legacy TeleBirr pilot.';
  end if;
  select pg_catalog.count(*)::integer into v_disabled_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
      'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification'
   )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb;
  if v_disabled_count = 4 then
    -- No claim, challenge, assignment, or payment is created while stopped.
    return;
  end if;
  if v_live_count <> 4 then
    raise exception 'The routine paid poll requires live generic deposit gates and no legacy TeleBirr pilot.';
  end if;$new_gate$;
begin
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification', 'deposit_execution',
         'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification', 'withdrawal_collection',
         'withdrawal_validation'
       ) and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb) <> 7 then
    raise exception 'The seven financial switches must remain disabled.';
  end if;

  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into source_body, definition
    from pg_catalog.pg_proc routine
   where routine.oid = target
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      '629e0791ad34e97313b92cfda1876ea0c496c159c1bb0882eb190bcc69fe18b8'
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_declaration, '')))
       <> pg_catalog.length(old_declaration)
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_gate, '')))
       <> pg_catalog.length(old_gate)
    or not pg_catalog.has_function_privilege(
      'fetanagent_routine_telebirr_paid_poll_runtime', target, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', target, 'EXECUTE') then
    raise exception 'The paid poll issuer is not the reviewed private definition.';
  end if;

  expected_body := pg_catalog.replace(
    pg_catalog.replace(source_body, old_declaration, new_declaration),
    old_gate, new_gate);
  execute pg_catalog.replace(
    pg_catalog.replace(definition, old_declaration, new_declaration),
    old_gate, new_gate);
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = target
       and routine.proowner = 'postgres'::pg_catalog.regrole
       and routine.prosecdef and routine.prokind = 'f'
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.prosrc = expected_body)
    or not pg_catalog.has_function_privilege(
      'fetanagent_routine_telebirr_paid_poll_runtime', target, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', target, 'EXECUTE') then
    raise exception 'The paid poll idle-only replacement is incomplete.';
  end if;
end;
$routine_paid_poll_idle$;

comment on function app.issue_routine_telebirr_paid_poll_assignment(
  uuid,uuid,text,timestamptz,uuid) is
  'Private one-use paid poll handoff only with live generic deposit gates; returns no rows and creates no claim or assignment when the four TeleBirr gates are exactly disabled.';

commit;
