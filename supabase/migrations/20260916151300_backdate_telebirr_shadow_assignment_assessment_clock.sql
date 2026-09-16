-- Production first received the reviewed operational change under hosted version 20260916134441.
-- This replay-safe canonical finalizer runs after the runtime-retry foundation on clean databases.
-- A phone records its assessment clock immediately before the authenticated broker poll. The
-- broker mints the assignment during that poll, so the returned issued_at can be a few
-- milliseconds later than the phone's pre-poll clock. Give only the no-money shadow lease a
-- bounded five-second issue-time allowance. Clamp that allowance to every authority start so a
-- newly created enrollment, profile, or proof can never be backdated outside its validity. This
-- shortens (never extends) the signed lease and leaves every production payment, settlement,
-- credit, reservation, and execution path untouched.

do $migration$
declare
  target regprocedure :=
    'app.lease_private_telebirr_shadow_assignment(uuid,text,uuid,integer)'::regprocedure;
  definition text;
  original_clock constant text :=
    'now_at := pg_catalog.date_trunc(''milliseconds'', authority_at);';
  unsafe_clock constant text :=
    'now_at := pg_catalog.date_trunc(''milliseconds'', authority_at - interval ''5 seconds'');';
  original_final_block constant text := E'  authority_at := pg_catalog.clock_timestamp();\n  now_at := pg_catalog.date_trunc(''milliseconds'', authority_at);\n  if authority_at < enrollment.valid_from';
  unsafe_final_block constant text := E'  authority_at := pg_catalog.clock_timestamp();\n  now_at := pg_catalog.date_trunc(''milliseconds'', authority_at - interval ''5 seconds'');\n  if authority_at < enrollment.valid_from';
  reviewed_final_block constant text := E'  authority_at := pg_catalog.clock_timestamp();\n  now_at := pg_catalog.date_trunc(\n    ''milliseconds'',\n    greatest(\n      authority_at - interval ''5 seconds'',\n      enrollment.valid_from,\n      profile.valid_from,\n      proof.not_before\n    )\n  );\n  if authority_at < enrollment.valid_from';
  original_occurrences integer;
  unsafe_occurrences integer;
  reviewed_occurrences integer;
begin
  definition := pg_catalog.pg_get_functiondef(target);

  if pg_catalog.strpos(definition, reviewed_final_block) = 0 then
    if pg_catalog.strpos(definition, unsafe_final_block) > 0 then
      definition := pg_catalog.replace(
        definition,
        unsafe_final_block,
        reviewed_final_block
      );
    elsif pg_catalog.strpos(definition, original_final_block) > 0 then
      definition := pg_catalog.replace(
        definition,
        original_final_block,
        reviewed_final_block
      );
    else
      raise exception 'The TeleBirr shadow lease final clock is not the reviewed shape.';
    end if;
  end if;

  -- An earlier hotfix backdated both clock assignments. Only the final, proof-bound issue time
  -- needs the allowance; restore the pre-selection clock before validating the resulting shape.
  unsafe_occurrences :=
    (pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, unsafe_clock, '')))
      / pg_catalog.length(unsafe_clock);
  if unsafe_occurrences = 1 then
    definition := pg_catalog.replace(definition, unsafe_clock, original_clock);
  elsif unsafe_occurrences <> 0 then
    raise exception 'The TeleBirr shadow lease preliminary clock is not the reviewed shape.';
  end if;

  original_occurrences :=
    (pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, original_clock, '')))
      / pg_catalog.length(original_clock);
  unsafe_occurrences :=
    (pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, unsafe_clock, '')))
      / pg_catalog.length(unsafe_clock);
  reviewed_occurrences :=
    (pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, reviewed_final_block, '')))
      / pg_catalog.length(reviewed_final_block);

  if original_occurrences <> 1
    or unsafe_occurrences <> 0
    or reviewed_occurrences <> 1 then
    raise exception 'The TeleBirr shadow lease clock definition is not the reviewed shape.';
  end if;

  if definition is distinct from pg_catalog.pg_get_functiondef(target) then
    execute definition;
  end if;
end;
$migration$;

comment on function app.lease_private_telebirr_shadow_assignment(uuid, text, uuid, integer) is
  'Leases one evidence-only TeleBirr shadow assignment. Its signed issue time is bounded five seconds behind the post-lock authority clock and clamped to every authority start so a phone pre-poll assessment cannot falsely reject a freshly minted assignment; the allowance shortens the lease and grants no financial authority.';
