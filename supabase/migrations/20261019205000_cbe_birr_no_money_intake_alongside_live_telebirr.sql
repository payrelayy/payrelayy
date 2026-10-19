-- Permit CBE-only, instruction-bound no-money proof intake while TeleBirr is live.
-- CBE verification must stay disabled. This grants no verifier, claim, job, or credit path.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create function app.require_cbe_birr_no_money_intake_disabled()
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform 1
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
     and feature_switch.mode = 'disabled'
   for share;
  if not found then
    raise exception 'CBE Birr no-money intake requires verification disabled.';
  end if;
end;
$$;

alter function app.require_cbe_birr_no_money_intake_disabled() owner to postgres;
revoke all on function app.require_cbe_birr_no_money_intake_disabled()
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
       fetanagent_cbe_birr_candidate_prelease,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

-- Keep the already-granted generic Telegram capture on its all-off gate.
-- Only the bound CBE function may invoke this postgres-owned, ungranted copy.
do $private_cbe_capture$
declare
  routine record;
  original_name constant text := 'app.capture_telegram_dry_run_deposit_proof(';
  private_name constant text := 'app.capture_telegram_cbe_birr_no_money_proof(';
  old_call constant text := 'perform app.require_dry_run_deposit_proof_switches_disabled();';
  new_call constant text := $gate$if p_provider_code <> 'cbe_birr' then
    raise exception 'The private CBE Birr proof provider is invalid.';
  end if;
  perform app.require_cbe_birr_no_money_intake_disabled();$gate$;
  private_definition text;
begin
  select p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) as definition,
         p.proowner, p.prosecdef, p.proacl
    into routine
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)'
   )::oid;
  if routine.oid is null
    or routine.proowner <> 'postgres'::pg_catalog.regrole
    or routine.prosecdef is distinct from true
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex')
       <> '67206fe775e639cb8b8e9c37cfaff6f8607ba969905605d4c5137d4e3004e25a'
    or exists (
      select 1 from pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee not in (
           routine.proowner, 'fetanagent_player_actions'::pg_catalog.regrole
         )
    )
    or pg_catalog.strpos(routine.definition, original_name) = 0
    or pg_catalog.strpos(routine.definition, old_call) = 0 then
    raise exception 'The generic Telegram proof function is not the reviewed definition.';
  end if;
  private_definition := pg_catalog.replace(routine.definition, original_name, private_name);
  private_definition := pg_catalog.replace(private_definition, old_call, new_call);
  execute private_definition;
  if (select p.prosrc from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure(
         'app.capture_telegram_cbe_birr_no_money_proof(uuid,text,text,text,text,text,smallint,smallint,text)'
       )::oid)
     is distinct from pg_catalog.replace(routine.prosrc, old_call, new_call) then
    raise exception 'The private CBE Birr proof function copy is incomplete.';
  end if;
end;
$private_cbe_capture$;

alter function app.capture_telegram_cbe_birr_no_money_proof(
  uuid,text,text,text,text,text,smallint,smallint,text
) owner to postgres;
revoke all on function app.capture_telegram_cbe_birr_no_money_proof(
  uuid,text,text,text,text,text,smallint,smallint,text
) from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
       fetanagent_cbe_birr_candidate_prelease,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

do $cbe_no_money_intake$
declare
  target record;
  routine record;
  old_call constant text := 'perform app.require_dry_run_deposit_proof_switches_disabled();';
  replacement text;
  changed_source text;
  changed_definition text;
  call_count integer;
begin
  for target in
    select * from (values
      ('app.create_or_reuse_dry_run_deposit_proof(uuid,text,text,text,text,text,text,smallint,smallint)', '9bbee6d95be7cffa125fa271564afd3cebc8f5409797073b274bde31c7c0a971', true),
      ('app.issue_telegram_cbe_birr_dry_run_instruction(uuid,text,text)', 'aded712a41cba17a987e64332bba581eccfe48ba67cadb312f9969e50dc9d24a', false),
      ('app.capture_telegram_cbe_birr_bound_dry_run_proof(uuid,uuid,text,text,text,text,smallint,smallint,text)', 'b7a819154169aaa242f3e1276643c01fbccb5b6cf975d44ecc285f81c365611e', false)
    ) as reviewed(signature, source_sha256, provider_conditional)
  loop
    select p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) as definition,
           p.proowner, p.prosecdef, p.proacl
      into routine
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(target.signature)::oid;
    if routine.oid is null
      or routine.proowner <> 'postgres'::pg_catalog.regrole
      or routine.prosecdef is distinct from true
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex')
         <> target.source_sha256
      or exists (
        select 1
          from pg_catalog.aclexplode(
            coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
          ) acl
         where acl.privilege_type = 'EXECUTE'
           and acl.grantee not in (
             routine.proowner, 'fetanagent_player_actions'::pg_catalog.regrole
           )
      ) then
      raise exception 'The CBE no-money intake function is not the reviewed definition: %', target.signature;
    end if;
    select count(*) into call_count
      from pg_catalog.regexp_matches(
        routine.prosrc,
        'perform app[.]require_dry_run_deposit_proof_switches_disabled[(][)];',
        'g'
      );
    if call_count <> 1 then
      raise exception 'The CBE no-money switch call is not unique: %', target.signature;
    end if;
    if target.provider_conditional then
      replacement := $conditional$if p_provider_code = 'cbe_birr' then
    perform app.require_cbe_birr_no_money_intake_disabled();
  else
    perform app.require_dry_run_deposit_proof_switches_disabled();
  end if;$conditional$;
    else
      replacement := 'perform app.require_cbe_birr_no_money_intake_disabled();';
    end if;
    changed_source := pg_catalog.replace(routine.prosrc, old_call, replacement);
    changed_definition := pg_catalog.replace(routine.definition, old_call, replacement);
    if target.signature =
       'app.capture_telegram_cbe_birr_bound_dry_run_proof(uuid,uuid,text,text,text,text,smallint,smallint,text)' then
      if pg_catalog.strpos(changed_source, 'app.capture_telegram_dry_run_deposit_proof(') = 0 then
        raise exception 'The bound CBE Birr proof call is not the reviewed definition.';
      end if;
      changed_source := pg_catalog.replace(
        changed_source,
        'app.capture_telegram_dry_run_deposit_proof(',
        'app.capture_telegram_cbe_birr_no_money_proof('
      );
      changed_definition := pg_catalog.replace(
        changed_definition,
        'app.capture_telegram_dry_run_deposit_proof(',
        'app.capture_telegram_cbe_birr_no_money_proof('
      );
    end if;
    if changed_source = routine.prosrc or changed_definition = routine.definition then
      raise exception 'The CBE no-money switch call could not be replaced: %', target.signature;
    end if;
    execute changed_definition;
    if (select p.prosrc from pg_catalog.pg_proc p where p.oid = routine.oid)
       is distinct from changed_source then
      raise exception 'The CBE no-money function replacement was incomplete: %', target.signature;
    end if;
  end loop;
end;
$cbe_no_money_intake$;

comment on function app.require_cbe_birr_no_money_intake_disabled() is
  'Locks the CBE verification switch in disabled mode for no-money instruction/proof capture. Does not affect TeleBirr live switches or authorize CBE verification.';

commit;
