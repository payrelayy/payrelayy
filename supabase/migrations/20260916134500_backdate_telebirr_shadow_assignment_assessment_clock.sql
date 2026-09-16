-- A phone records its assessment clock immediately before the authenticated broker poll. The
-- broker mints the assignment during that poll, so the returned issued_at can be a few
-- milliseconds later than the phone's pre-poll clock. Give only the no-money shadow lease a
-- bounded five-second issue-time allowance. This shortens (never extends) the signed lease and
-- leaves every production payment, settlement, credit, reservation, and execution path untouched.

do $migration$
declare
  target regprocedure :=
    'app.lease_private_telebirr_shadow_assignment(uuid,text,uuid,integer)'::regprocedure;
  definition text;
  needle constant text :=
    'now_at := pg_catalog.date_trunc(''milliseconds'', authority_at);';
  replacement constant text :=
    'now_at := pg_catalog.date_trunc(''milliseconds'', authority_at - interval ''5 seconds'');';
  occurrences integer;
  replacement_occurrences integer;
begin
  definition := pg_catalog.pg_get_functiondef(target);
  occurrences :=
    (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, needle, '')))
      / pg_catalog.length(needle);
  replacement_occurrences :=
    (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, replacement, '')))
      / pg_catalog.length(replacement);

  if occurrences = 2 and replacement_occurrences = 0 then
    execute pg_catalog.replace(definition, needle, replacement);
  elsif occurrences = 0 and replacement_occurrences = 2 then
    null;
  else
    raise exception 'The TeleBirr shadow lease clock definition is not the reviewed shape.';
  end if;
end;
$migration$;

comment on function app.lease_private_telebirr_shadow_assignment(uuid, text, uuid, integer) is
  'Leases one evidence-only TeleBirr shadow assignment. Its signed issue time is bounded five seconds behind the post-lock authority clock so a phone pre-poll assessment cannot falsely reject a freshly minted assignment; the allowance shortens the lease and grants no financial authority.';
