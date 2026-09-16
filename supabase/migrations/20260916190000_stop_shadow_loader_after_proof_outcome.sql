-- The continuously connected phone can stage more than one short-lived assignment while one
-- no-money proof remains open for review. Once any attempt produces the proof's unique advisory
-- outcome, stop the shadow loader at the proof boundary so the bounded verifier cannot race into
-- a later immutable attempt and collide with that terminal outcome. No financial authority is
-- added or changed by this migration.

begin;

do $migration$
declare
  definition text;
  old_fragment constant text :=
    'or outcome.completion_request_key = attempt.lease_request_key';
  new_marker constant text :=
    'or outcome.shadow_proof_request_id = proof.id';
  old_count integer;
  new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           'app.load_next_private_telebirr_shadow_staged_evidence()'::regprocedure
         )
    into definition;

  old_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  new_count := (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, new_marker, ''))
  ) / pg_catalog.length(new_marker);

  if old_count = 1 and new_count = 0 then
    definition := pg_catalog.replace(
      definition,
      old_fragment,
      old_fragment || pg_catalog.chr(10) || '            ' || new_marker
    );
    execute definition;
  elsif old_count = 1 and new_count = 1 then
    null;
  else
    raise exception 'The TeleBirr shadow loader outcome boundary is not reviewed.';
  end if;
end;
$migration$;

comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads at most one pending signed observation for a proof that has no terminal no-money outcome, preserving later immutable attempts without reprocessing them.';

commit;
