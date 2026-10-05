-- Active-database retention for the separate, amount-free routine TeleBirr candidate.
-- No application role receives table access or a callable purge function. This does not
-- authorize customer intake, provider verification, settlement, or live deposit.

begin;

create index routine_telebirr_untrusted_retention_due_idx
  on app.routine_telebirr_untrusted_proof_requests (submitted_at, id);

-- Keep UPDATE and TRUNCATE forbidden, and DELETE forbidden to every application
-- role and for every younger row. The privileged postgres owner may remove only
-- rows at least seven days old; the fixed-batch Cron function is the normal path.
create or replace function app.reject_routine_telebirr_untrusted_proof_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'postgres'
      and old.submitted_at <= pg_catalog.statement_timestamp() - interval '7 days' then
      return old;
    end if;
  end if;
  raise exception 'Routine TeleBirr untrusted proof records are append-only.';
end;
$$;

create function app.purge_expired_routine_telebirr_untrusted_proofs()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_deleted_count integer;
begin
  -- Fixed 1,000-row batch: no caller-supplied scope, cutoff, or arbitrary SQL.
  -- SKIP LOCKED avoids waiting on a concurrent candidate intake transaction.
  with due as (
    select candidate.id
      from app.routine_telebirr_untrusted_proof_requests candidate
     where candidate.submitted_at <= pg_catalog.statement_timestamp() - interval '7 days'
     order by candidate.submitted_at, candidate.id
     limit 1000
     for update of candidate skip locked
  )
  delete from app.routine_telebirr_untrusted_proof_requests candidate
   using due
   where candidate.id = due.id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

alter function app.reject_routine_telebirr_untrusted_proof_mutation()
  owner to postgres;
alter function app.purge_expired_routine_telebirr_untrusted_proofs()
  owner to postgres;

revoke all on function app.reject_routine_telebirr_untrusted_proof_mutation(),
  app.purge_expired_routine_telebirr_untrusted_proofs()
from public, anon, authenticated, service_role,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime;

comment on function app.purge_expired_routine_telebirr_untrusted_proofs() is
  'Postgres-only, fixed-batch active-database deletion of amount-free candidate rows at least 7 days old; does not remove historical backups or create financial lineage.';

-- The disposable SQL test server has no pg_cron binary. Production must have
-- the extension and a single active postgres-owned schedule, or migration fails.
do $routine_retention_cron$
declare
  scheduled_count integer;
begin
  if exists (
    select 1 from pg_catalog.pg_available_extensions extension
     where extension.name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
    select pg_catalog.count(*)::integer into scheduled_count
      from cron.job job
     where job.jobname = 'fetanagent-routine-telebirr-candidate-retention-v1';
    if scheduled_count <> 0 then
      raise exception 'A routine candidate retention Cron job name already exists.';
    end if;
    perform cron.schedule(
      'fetanagent-routine-telebirr-candidate-retention-v1', '*/15 * * * *',
      'select app.purge_expired_routine_telebirr_untrusted_proofs()'
    );
    select pg_catalog.count(*)::integer into scheduled_count
      from cron.job job
     where job.jobname = 'fetanagent-routine-telebirr-candidate-retention-v1'
       and job.active and job.username = 'postgres'
       and job.schedule = '*/15 * * * *'
       and job.command = 'select app.purge_expired_routine_telebirr_untrusted_proofs()';
    if scheduled_count <> 1 then
      raise exception 'The routine candidate retention Cron installation is incomplete.';
    end if;
  elsif pg_catalog.to_regclass('sql_integration.applied_migrations') is null then
    raise exception 'Production routine candidate retention requires pg_cron.';
  end if;
end;
$routine_retention_cron$;

commit;
