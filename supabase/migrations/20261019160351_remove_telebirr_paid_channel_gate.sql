-- The official paid receipt's channel is metadata, not a settlement condition.
-- Keep every status, source, receiver, reference, amount, and timing guard.
-- This changes no switch, receiver, runtime grant, payment, or Player balance.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $channel$
declare
  routine_oid oid :=
    'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure;
  source_body text;
  definition text;
  expected_body text;
  previous_acl aclitem[];
  old_guard constant text :=
    $old$or v_staged.signed_observation #>> '{body,facts,paymentChannel}' is distinct from 'api_app'$old$;
  new_guard constant text := '';
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation') and feature_switch.mode = 'disabled') <> 7 then
    raise exception 'Financial switches must all be stopped for the channel guard change.';
  end if;

  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid), routine.proacl
    into source_body, definition, previous_acl
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      '4311c9cedc30ad157a0d5cefca4cda631cf3385af2baf7010bd9ace3a06641a6'
    or (pg_catalog.length(source_body) - pg_catalog.length(
        pg_catalog.replace(source_body, old_guard, ''))) <> pg_catalog.length(old_guard)
    or not exists (
      select 1 from pg_catalog.aclexplode(previous_acl) privilege
       where privilege.grantee =
         'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole
         and privilege.privilege_type = 'EXECUTE')
    or exists (
      select 1 from pg_catalog.aclexplode(coalesce(previous_acl,
        pg_catalog.acldefault('f', 'postgres'::pg_catalog.regrole))) privilege
       where privilege.privilege_type = 'EXECUTE'
         and privilege.grantee not in (
           'postgres'::pg_catalog.regrole,
           'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole)) then
    raise exception 'The paid claim function is not the reviewed stopped definition.';
  end if;

  expected_body := pg_catalog.replace(source_body, old_guard, new_guard);
  execute pg_catalog.replace(definition, old_guard, new_guard);
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = expected_body
       and routine.proowner = 'postgres'::pg_catalog.regrole
       and routine.prosecdef and routine.prokind = 'f'
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.proacl is not distinct from previous_acl) then
    raise exception 'The paid channel guard removal is incomplete.';
  end if;
end;
$channel$;

comment on function app.finalize_routine_telebirr_paid_observation(uuid) is
  'Guarded one-use signed-origin paid settlement with channel-neutral eligibility; source, status, receiver, reference, amount, and timing guards remain.';
commit;
