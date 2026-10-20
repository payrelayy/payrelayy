-- Keep the live TeleBirr destination and its guarded stop/restore available when
-- CBE Birr is independently activated. This migration changes no switch or grant.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $decouple_cbe_switch$
declare
  target record;
  routine record;
  old_gate text;
  new_gate text;
  new_source text;
  new_definition text;
begin
  for target in
    select * from (values
      ('app.prepare_telegram_routine_telebirr_paid_destination_core(uuid,text,text)',
       'c0abfb0041557028e30099446a0d77789ec78c4135105bb7239a7dfee3222547', true),
      ('app.activate_routine_telebirr_financial_gates(uuid,uuid)',
       'a0ccf261f42f541243a4021ddd2c2452f5d3c13d4ab2349f6ab1d87f614589bf', false),
      ('app.stop_routine_telebirr_financial_gates(uuid,text)',
       'bae00c640c02c7652d07485f9a0140f7625984a4c12c59656775c9ef46ab973d', false)
    ) as reviewed(signature, source_sha256, security_definer)
  loop
    select p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) as definition,
           p.proowner, p.prosecdef, p.proconfig, p.proacl
      into routine
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(target.signature)::oid;
    if routine.oid is null
      or routine.proowner <> 'postgres'::pg_catalog.regrole
      or routine.prosecdef is distinct from target.security_definer
      or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex')
         <> target.source_sha256
      or pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE') then
      raise exception 'The TeleBirr financial function is not the reviewed definition: %',
        target.signature;
    end if;

    if target.signature =
       'app.prepare_telegram_routine_telebirr_paid_destination_core(uuid,text,text)' then
      old_gate := $old$or (feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation') and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb)$old$;
      new_gate := $new$or (feature_switch.feature_key = 'cbe_birr_authoritative_verification'
        and feature_switch.mode in ('disabled', 'live')
        and feature_switch.settings = '{}'::jsonb)
      or (feature_switch.feature_key in (
        'private_live_deposit_pilot', 'telebirr_authoritative_verification',
        'withdrawal_collection', 'withdrawal_validation')
        and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb)$new$;
    elsif target.signature = 'app.activate_routine_telebirr_financial_gates(uuid,uuid)' then
      old_gate := $old$where switch.feature_key in (
       'cbe_birr_authoritative_verification', 'deposit_execution',
       'payment_verification', 'private_live_deposit_pilot',
       'telebirr_authoritative_verification', 'withdrawal_collection',
       'withdrawal_validation')
       and switch.mode = 'disabled' and switch.settings = '{}'::jsonb$old$;
      new_gate := $new$where (
       (switch.feature_key = 'cbe_birr_authoritative_verification'
         and switch.mode in ('disabled', 'live'))
       or (switch.feature_key in (
         'deposit_execution', 'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification', 'withdrawal_collection',
         'withdrawal_validation') and switch.mode = 'disabled'))
       and switch.settings = '{}'::jsonb$new$;
    else
      old_gate := $old$where switch.feature_key in (
       'cbe_birr_authoritative_verification', 'private_live_deposit_pilot',
       'telebirr_authoritative_verification', 'withdrawal_collection',
       'withdrawal_validation')
       and switch.mode = 'disabled' and switch.settings = '{}'::jsonb$old$;
      new_gate := $new$where (
       (switch.feature_key = 'cbe_birr_authoritative_verification'
         and switch.mode in ('disabled', 'live'))
       or (switch.feature_key in (
         'private_live_deposit_pilot', 'telebirr_authoritative_verification',
         'withdrawal_collection', 'withdrawal_validation') and switch.mode = 'disabled'))
       and switch.settings = '{}'::jsonb$new$;
    end if;

    if (pg_catalog.length(routine.prosrc) -
        pg_catalog.length(pg_catalog.replace(routine.prosrc, old_gate, '')))
       <> pg_catalog.length(old_gate) then
      raise exception 'The TeleBirr CBE switch gate is not unique: %', target.signature;
    end if;
    new_source := pg_catalog.replace(routine.prosrc, old_gate, new_gate);
    new_definition := pg_catalog.replace(routine.definition, old_gate, new_gate);
    if new_definition is not distinct from routine.definition then
      raise exception 'The TeleBirr switch gate definition did not change: %', target.signature;
    end if;
    execute new_definition;
    if not exists (
      select 1 from pg_catalog.pg_proc p where p.oid = routine.oid
        and p.prosrc = new_source
        and p.proowner = routine.proowner
        and p.prosecdef = routine.prosecdef
        and p.proconfig is not distinct from routine.proconfig
        and p.proacl is not distinct from routine.proacl
    ) then
      raise exception 'The TeleBirr function replacement changed another boundary: %',
        target.signature;
    end if;
  end loop;
end;
$decouple_cbe_switch$;

comment on function app.prepare_telegram_routine_telebirr_paid_destination_core(uuid,text,text) is
  'Presents the guarded live TeleBirr receiver with shared deposit gates live and independent CBE verification either disabled or live.';
comment on function app.activate_routine_telebirr_financial_gates(uuid,uuid) is
  'Postgres-only guarded restore of the two shared TeleBirr deposit gates; an independently live CBE switch does not block it.';
comment on function app.stop_routine_telebirr_financial_gates(uuid,text) is
  'Postgres-only guarded stop of the two shared TeleBirr deposit gates; preserves an independently live CBE switch.';

commit;
