-- Let the paired TeleBirr phone refresh its no-money official-origin proof while
-- the two shared payment gates are stopped and independent CBE verification is
-- configured live. A previously accepted, still-retained no-money candidate may
-- be observed again after 24 hours; no paid claim or Player credit is created.
-- The exact seven-disabled state remains accepted for staging and inert recovery.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index routine_telebirr_recent_accepted_no_money_observation_idx
  on app.routine_telebirr_signed_observation_payloads
  (recorded_at desc, challenge_id)
  where server_policy_result = 'signed_evidence_matches_policy';

do $cbe_stopped_phone_proof$
declare
  target record;
  routine record;
  old_gate constant text :=
    'if v_switch_count <> 7 or v_disabled_count <> 7 then';
  new_gate constant text := $gate$if v_switch_count <> 7
    or v_disabled_count not in (6, 7)
    or (v_disabled_count = 6 and not exists (
      select 1 from app.feature_switches cbe
       where cbe.feature_key = 'cbe_birr_authoritative_verification'
         and cbe.mode = 'live' and cbe.settings = '{}'::jsonb
    )) then$gate$;
  definition text;
  source_body text;
  old_live text;
  new_live text;
  old_stopped text;
  new_stopped text;
  old_candidate text;
  new_candidate text;
  old_selection text;
  new_selection text;
begin
  -- Pin each installed definition. A drifted production function aborts the
  -- transaction rather than widening an unreviewed SECURITY DEFINER path.
  for target in
    select * from (values
      ('app.claim_routine_telebirr_no_money_poll(uuid,uuid,text,timestamptz)',
       '97debad2503c6a6075ec356bd3c494d4f7dbcb672da3da5760705775c7cf0146',
       'gate'),
      ('app.issue_routine_telebirr_lookup_challenge(uuid,uuid,uuid)',
       '2998e5653417686570d62784c260cb53a2b6f9cc191125ad52d649898178db95',
       'gate'),
      ('app.load_routine_telebirr_no_money_observation_material(uuid)',
       '8dc390ad1c3e0d96dcd9d2788eee701979f21c7fade54985cc3ac9d7a9abd695',
       'gate'),
      ('app.stage_routine_telebirr_no_money_observation_digest(uuid,text,text,text,text)',
       '7022da1749ca04fd2f25b009fd84e2f52a5efa98b36a209186389084bd4207ac',
       'gate'),
      ('app.issue_routine_telebirr_no_money_poll_assignment(uuid,uuid,text,timestamptz,uuid)',
       'f909bb025db902978a66b9459f8277ffa1586356ecea582c21fa541c7ad3f35b',
       'poll')
    ) as reviewed(signature, source_sha256, kind)
  loop
    select p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) as function_definition,
           p.proowner, p.prosecdef, p.proconfig, p.proacl
      into routine
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(target.signature)::oid;
    if routine.oid is null
      or routine.proowner <> 'postgres'::pg_catalog.regrole
      or not routine.prosecdef
      or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or pg_catalog.encode(pg_catalog.sha256(
           pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex')
         <> target.source_sha256
      or pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
    then
      raise exception 'Routine no-money source is not reviewed: %', target.signature;
    end if;
    definition := routine.function_definition;
    source_body := routine.prosrc;
    if target.kind = 'gate' then
      if pg_catalog.length(source_body) -
         pg_catalog.length(pg_catalog.replace(source_body, old_gate, ''))
         <> pg_catalog.length(old_gate)
      then
        raise exception 'Routine no-money gate is not unique: %', target.signature;
      end if;
      definition := pg_catalog.replace(definition, old_gate, new_gate);
      source_body := pg_catalog.replace(source_body, old_gate, new_gate);
    else
      old_live := 'if v_live_count = 2 and v_other_disabled_count = 5 then';
      new_live := $live$if v_live_count = 2 and (
    v_other_disabled_count = 5
    or (v_other_disabled_count = 4 and exists (
      select 1 from app.feature_switches cbe
       where cbe.feature_key = 'cbe_birr_authoritative_verification'
         and cbe.mode = 'live' and cbe.settings = '{}'::jsonb
    ))
  ) then$live$;
      old_stopped := 'if v_disabled_count <> 7 then';
      new_stopped := $stopped$if v_disabled_count not in (6, 7)
    or (v_disabled_count = 6 and not exists (
      select 1 from app.feature_switches cbe
       where cbe.feature_key = 'cbe_birr_authoritative_verification'
         and cbe.mode = 'live' and cbe.settings = '{}'::jsonb
    )) then$stopped$;
      old_selection := $selection$  v_now := pg_catalog.clock_timestamp();
  select candidate.id into v_candidate_id$selection$;
      new_selection := $selection$  v_now := pg_catalog.clock_timestamp();
  -- One current, accepted proof for this enrolled phone is enough. Stop
  -- polling old receipts after the first fresh official-origin observation.
  if exists (
    select 1 from app.routine_telebirr_signed_observation_payloads observation
    join app.routine_telebirr_lookup_challenges challenge
      on challenge.challenge_id = observation.challenge_id
   where challenge.device_enrollment_id = v_enrollment.id
     and challenge.issuance_mode = 'no_money'
     and observation.recorded_at >= v_now - interval '24 hours'
     and observation.server_policy_result = 'signed_evidence_matches_policy'
     and observation.signed_observation ->> 'contractVersion' = '2'
     and observation.signed_observation
           #>> '{body,facts,sourceOriginAttestation}' = 'official_tls_origin'
  ) then return; end if;
  select candidate.id into v_candidate_id$selection$;
      old_candidate := $candidate$     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
         join app.routine_telebirr_observation_receipts receipt
           on receipt.challenge_id = challenge.challenge_id
        where challenge.candidate_id = candidate.id
     )
     and (select pg_catalog.count(*)
       from app.routine_telebirr_lookup_challenges challenge
       where challenge.candidate_id = candidate.id) < 5$candidate$;
      new_candidate := $candidate$     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
         join app.routine_telebirr_observation_receipts receipt
           on receipt.challenge_id = challenge.challenge_id
        where challenge.candidate_id = candidate.id
          and receipt.received_at >= v_now - interval '24 hours'
     )
     and (
       not exists (
         select 1 from app.routine_telebirr_lookup_challenges challenge
           join app.routine_telebirr_observation_receipts receipt
             on receipt.challenge_id = challenge.challenge_id
          where challenge.candidate_id = candidate.id
       )
       or exists (
         select 1 from app.routine_telebirr_lookup_challenges challenge
           join app.routine_telebirr_signed_observation_payloads observation
             on observation.challenge_id = challenge.challenge_id
          where challenge.candidate_id = candidate.id
            and challenge.issuance_mode = 'no_money'
            and observation.recorded_at < v_now - interval '24 hours'
            and observation.server_policy_result =
              'signed_evidence_matches_policy'
            and observation.signed_observation ->> 'contractVersion' = '2'
            and observation.signed_observation
                  #>> '{body,facts,sourceOriginAttestation}' =
              'official_tls_origin'
       )
     )
     and (select pg_catalog.count(*)
       from app.routine_telebirr_lookup_challenges challenge
       where challenge.candidate_id = candidate.id) < 5$candidate$;
      if pg_catalog.length(source_body) -
           pg_catalog.length(pg_catalog.replace(source_body, old_live, ''))
           <> pg_catalog.length(old_live)
        or pg_catalog.length(source_body) -
           pg_catalog.length(pg_catalog.replace(source_body, old_stopped, ''))
           <> pg_catalog.length(old_stopped)
        or pg_catalog.length(source_body) -
           pg_catalog.length(pg_catalog.replace(source_body, old_selection, ''))
           <> pg_catalog.length(old_selection)
        or pg_catalog.length(source_body) -
           pg_catalog.length(pg_catalog.replace(source_body, old_candidate, ''))
           <> pg_catalog.length(old_candidate)
      then
        raise exception 'Routine no-money poll boundary is not unique';
      end if;
      definition := pg_catalog.replace(definition, old_live, new_live);
      definition := pg_catalog.replace(definition, old_stopped, new_stopped);
      definition := pg_catalog.replace(definition, old_selection, new_selection);
      definition := pg_catalog.replace(definition, old_candidate, new_candidate);
      source_body := pg_catalog.replace(source_body, old_live, new_live);
      source_body := pg_catalog.replace(source_body, old_stopped, new_stopped);
      source_body := pg_catalog.replace(source_body, old_selection, new_selection);
      source_body := pg_catalog.replace(source_body, old_candidate, new_candidate);
    end if;
    execute definition;
    if not exists (
      select 1 from pg_catalog.pg_proc p
       where p.oid = routine.oid and p.prosrc = source_body
         and p.proowner = routine.proowner
         and p.prosecdef = routine.prosecdef
         and p.proconfig is not distinct from routine.proconfig
         and p.proacl is not distinct from routine.proacl
    ) then
      raise exception 'Routine no-money replacement changed another boundary: %',
        target.signature;
    end if;
  end loop;
end;
$cbe_stopped_phone_proof$;
commit;
