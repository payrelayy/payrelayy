\set ON_ERROR_STOP on

-- One reviewed, identifier-free queue disposition. The database function rechecks the full
-- payment lineage and no-execution boundary under locks before changing any row.
begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $operation$
declare
  target record;
  disposition record;
begin
  select candidate.* into target
    from (
      select pilot.id as pilot_revision_id,
             owner_user.id as owner_admin_id,
             job.id as deposit_job_id,
             pg_catalog.count(*) over () as candidate_count
        from app.private_live_deposit_pilot_revisions pilot
        join app.private_live_deposit_pilot_reservations reservation
          on reservation.pilot_revision_id = pilot.id
        join app.deposit_jobs job
          on job.deposit_intent_id = reservation.deposit_intent_id
        join app.deposit_payment_claims claim
          on claim.id = reservation.deposit_payment_claim_id
         and claim.deposit_intent_id = job.deposit_intent_id
        cross join app.admin_users owner_user
       where pilot.id = (
               select recent.id
                 from app.private_live_deposit_pilot_revisions recent
                order by recent.created_at desc, recent.revision desc
                limit 1
             )
         and pilot.status = 'stopped'
         and pilot.stop_reason_code = 'execution_uncertainty'
         and pilot.stopped_at is not null
         and owner_user.role = 'owner'
         and owner_user.status = 'active'
         and job.job_kind = 'execute_deposit'
         and job.status = 'queued'
         and job.attempt_count = 0
         and job.lease_token is null
         and job.leased_by is null
         and job.lease_expires_at is null
         and job.completed_at is null
         and claim.provider_payment_evidence_id = reservation.provider_payment_evidence_id
    ) candidate
   where candidate.candidate_count = 1;

  if target.deposit_job_id is null then
    raise exception 'The singular emergency-stopped untouched paid job was not found.';
  end if;

  select result.* into disposition
    from app.review_stopped_pilot_paid_execution_job(
      target.owner_admin_id,
      target.pilot_revision_id,
      target.deposit_job_id,
      pg_catalog.gen_random_uuid()
    ) result;

  if disposition.review_state is distinct from 'review_required'
    or disposition.replayed is distinct from false then
    raise exception 'The one-use paid-job review was not recorded.';
  end if;
end;
$operation$;

select 'review_recorded';
commit;
