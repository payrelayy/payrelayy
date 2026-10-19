-- Retire Telegram beta-invite admission without changing Player eligibility,
-- payment authority, receipt lineage, or financial switches.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $retire_invite_gate$
declare
  target record;
  routine record;
  source_body text;
  definition text;
  changed_source text;
  changed_definition text;
  predicate_count integer;
  invite_predicate constant text := $predicate$[[:space:]]+and exists \([[:space:]]*select 1[[:space:]]+from app[.]telegram_beta_invites invite[[:space:]]+where invite[.]status = 'redeemed'[[:space:]]+and invite[.]redeemed_customer_id = [a-z_]+[.]customer_id[[:space:]]+and invite[.]redeemed_customer_identity_id = [a-z_]+[.]id[[:space:]]+and invite[.]redeemed_telegram_user_id = telegram_identity[.]telegram_user_id[[:space:]]+and invite[.]redeemed_private_chat_id = telegram_identity[.]private_chat_id[[:space:]]+\)$predicate$;
begin
  for target in
    select * from (values
      ('app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)', '1d8f92d0e4bfda0d35c84dc29ad6314cf9dfa6301dae44e5718e2105d039a48b'),
      ('app.capture_telegram_live_deposit_reference(uuid,uuid,text,text,text,smallint,text)', '776f3dcf50e9ba2e16193aa28b88bca16a04dc123d299151a066ac3b4cb2fadd'),
      ('app.capture_telegram_live_telebirr_proof(uuid,text,text,text,text,text,smallint,smallint,text)', '5a9f687897669fcd23f26d648546c6ace856c873f9f3446c28c590349abb6305'),
      ('app.capture_telegram_routine_telebirr_no_money_core(uuid,text,text,text,text,text,smallint,smallint,text)', '6663a6d0369dc3a78ce261e2985a90479aaefc7dcf96b00d980b442f1b3604c4'),
      ('app.capture_telegram_telebirr_shadow_proof(uuid,text,text,text,text,text,smallint,smallint,text)', '25eedb6a450dee893b0525580946dab7bb88cde1f312f1a70e2e17ac867d681a'),
      ('app.enforce_telegram_dry_run_proof_receipt_binding()', '60578553193fc0437ee38bb349f66684a3bf0f7fd3c5e591ce3f2fa636ba3c2f'),
      ('app.enforce_telegram_live_deposit_receipt_binding()', 'abcbde1007877e97b39b2d5fc3de106fc02e4611fc61913655846fde995e0c60'),
      ('app.enforce_telegram_live_telebirr_proof_receipt_insert()', '58d8bf74b485702410d45d335e7196f879fd6ba6b955874b176df982919ffcda'),
      ('app.get_telegram_customer_deposit(uuid,uuid)', '0b3c7711d5ead089e9f6a295f74e0c5aac7fe54706405a25db933f6f6fda7dac'),
      ('app.get_telegram_customer_live_telebirr_proof(uuid,uuid)', '37531e5f4e5f21b9477a663661e4049d1c420540ebd16c24cb2f975c7c90b12d'),
      ('app.issue_telegram_cbe_birr_dry_run_instruction(uuid,text,text)', 'ce00f9990a5fec20006b2c94b7a970be42a873d12663b32520eb5884a3554f76'),
      ('app.open_telegram_live_deposit_intent(uuid,text,bigint,text)', 'ae5dfc2c617dba1735f9d84ae1ed0ef5afdba298058a6bc769fad9b1e2374c1f'),
      ('app.prepare_telegram_telebirr_destination(uuid,text,text)', '4484ecec4a08840a067ce8e456770bd0213f0634ecc64325c67921eb05a91ffe')
    ) as expected(signature, source_sha256)
  loop
    select p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) as definition,
           p.proowner, p.prokind, p.proconfig, p.proacl
      into routine
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(target.signature)::oid;
    if routine.oid is null
      or routine.proowner <> 'postgres'::pg_catalog.regrole
      or routine.prokind <> 'f'
      or routine.proconfig is null
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex') <> target.source_sha256
      or exists (
        select 1 from pg_catalog.aclexplode(coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))) acl
         where acl.privilege_type = 'EXECUTE'
           and acl.grantee not in (
             routine.proowner,
             'fetanagent_player_actions'::pg_catalog.regrole
           )
      ) then
      raise exception 'The Telegram invite-gated function is not the reviewed definition: %', target.signature;
    end if;
    select count(*) into predicate_count
      from pg_catalog.regexp_matches(routine.prosrc, invite_predicate, 'g');
    if predicate_count <> 1 then
      raise exception 'The Telegram invite predicate is not unique: %', target.signature;
    end if;
    source_body := routine.prosrc;
    definition := routine.definition;
    changed_source := pg_catalog.regexp_replace(source_body, invite_predicate, '', 'g');
    changed_definition := pg_catalog.regexp_replace(definition, invite_predicate, '', 'g');
    if changed_source = source_body or pg_catalog.strpos(changed_source, 'telegram_beta_invites') <> 0 then
      raise exception 'The Telegram invite predicate could not be removed: %', target.signature;
    end if;
    execute changed_definition;
    if (select p.prosrc from pg_catalog.pg_proc p where p.oid = routine.oid)
       is distinct from changed_source then
      raise exception 'The Telegram function replacement was incomplete: %', target.signature;
    end if;
  end loop;
end;
$retire_invite_gate$;

commit;
