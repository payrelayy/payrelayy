-- The exact no-money runtime retry may be refreshed after infrastructure-only failures. Extend
-- only that final branch of the existing structural window constraint from 24 to 36 hours, giving
-- at most one additional 12-hour review period. Earlier recovery branches remain capped at 24
-- hours and all payment/credit/settlement/execution authority remains absent.

do $migration$
declare
  definition text;
  runtime_time_24 constant text :=
    '(runtime_retried_at < (submitted_at + ''24:00:00''::interval))';
  runtime_time_36 constant text :=
    '(runtime_retried_at < (submitted_at + ''36:00:00''::interval))';
  expiry_24 constant text :=
    '(expires_at <= (submitted_at + ''24:00:00''::interval))';
  expiry_36 constant text :=
    '(expires_at <= (submitted_at + ''36:00:00''::interval))';
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check';

  if definition is null
    or (
      pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, runtime_time_24, ''))
    ) / pg_catalog.length(runtime_time_24) <> 1
    or (
      pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, expiry_24, ''))
    ) / pg_catalog.length(expiry_24) <> 1 then
    raise exception 'The TeleBirr shadow proof window constraint is not the reviewed shape.';
  end if;

  definition := pg_catalog.replace(definition, runtime_time_24, runtime_time_36);
  definition := pg_catalog.replace(definition, expiry_24, expiry_36);
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'drop constraint private_telebirr_shadow_proof_window_check';
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'add constraint private_telebirr_shadow_proof_window_check ' || definition;
end;
$migration$;

comment on constraint private_telebirr_shadow_proof_window_check
  on app.private_telebirr_shadow_proof_requests is
  'Preserves the original short shadow and recovery windows. Only the final same-key, evidence-free runtime refresh may remain open for up to 36 hours from submission and 12 hours from its latest bounded retry.';
