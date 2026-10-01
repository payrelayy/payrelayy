\set ON_ERROR_STOP on

-- The Owner explicitly attested that both wallets are theirs and that this one
-- payment needs neither KemerBet credit nor a refund. Resolve only the singular
-- existing emergency-stopped review even if a newer unspent dry-run pilot is
-- armed. The private function rechecks its full payment lineage and no-money
-- boundary under locks.
begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $operation$
declare
  target record;
  resolution record;
begin
  select candidate.* into target
    from (
      select review.request_key as paid_review_request_key,
             owner_user.id as owner_admin_id,
             pg_catalog.count(*) over () as candidate_count
        from app.stopped_pilot_paid_execution_reviews review
        join app.private_live_deposit_pilot_revisions pilot
          on pilot.id = review.pilot_revision_id
        join app.deposit_jobs job
          on job.id = review.deposit_job_id
        join app.deposit_intents intent
          on intent.id = review.deposit_intent_id
        join app.deposit_review_cases review_case
          on review_case.deposit_intent_id = review.deposit_intent_id
        cross join app.admin_users owner_user
       where pilot.status = 'stopped'
         and pilot.stop_reason_code = 'execution_uncertainty'
         and pilot.armed_by_admin_id = owner_user.id
         and pilot.stopped_by_admin_id = owner_user.id
         and review.actor_admin_id = owner_user.id
         and owner_user.role = 'owner'
         and owner_user.status = 'active'
         and job.job_kind = 'execute_deposit'
         and job.status = 'cancelled'
         and job.last_error_code = 'stopped_pilot_paid_proof_review'
         and job.attempt_count = 0
         and job.lease_token is null
         and job.leased_by is null
         and job.lease_expires_at is null
         and job.completed_at is not null
         and intent.status = 'execution_review'
         and review_case.review_kind = 'execution'
         and review_case.reason_code = 'stopped_pilot_paid_proof_review'
         and review_case.status = 'open'
         and review_case.assigned_admin_id is null
         and not exists (
           select 1 from app.stopped_pilot_owner_test_resolutions existing
            where existing.paid_review_request_key = review.request_key
         )
    ) candidate
   where candidate.candidate_count = 1;

  if target.paid_review_request_key is null then
    raise exception 'The singular Owner-funded emergency-stopped review was not found.';
  end if;

  select result.* into resolution
    from app.resolve_stopped_pilot_owner_test_payment(
      target.owner_admin_id,
      target.paid_review_request_key,
      pg_catalog.gen_random_uuid(),
      true,
      true
    ) result;

  if resolution.resolution_state is distinct from 'owner_test_closed'
    or resolution.replayed is distinct from false then
    raise exception 'The one-use Owner-funded test closure was not recorded.';
  end if;
end;
$operation$;

select 'owner_test_closed';
commit;
