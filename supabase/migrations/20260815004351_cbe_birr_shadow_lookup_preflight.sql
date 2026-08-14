-- Stage 1G: fail-closed metadata preflight for legacy CBE Birr shadow jobs.
--
-- The worker can inspect only whether one job identifier exists while every financial feature is
-- disabled. The response is always blocked and never returns protected lookup material. This
-- migration also contains the legacy lease, completion, and retry procedures by removing the
-- shadow worker's ability to execute them.

begin;

do $$
declare
  worker_can_login boolean;
begin
  if to_regclass('app.feature_switches') is null then
    raise exception 'Stage 1G requires app.feature_switches.';
  end if;

  if to_regclass('app.cbe_birr_shadow_verification_jobs') is null then
    raise exception 'Stage 1G requires app.cbe_birr_shadow_verification_jobs.';
  end if;

  if to_regprocedure('app.lease_cbe_birr_shadow_verification_job(uuid,integer)') is null
    or to_regprocedure('app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)') is null
    or to_regprocedure('app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)') is null then
    raise exception 'Stage 1G requires the legacy CBE Birr shadow worker procedures.';
  end if;

  select database_role.rolcanlogin
    into worker_can_login
    from pg_catalog.pg_roles database_role
   where database_role.rolname = 'fetanagent_cbe_birr_shadow_worker';

  if worker_can_login is null then
    raise exception 'Stage 1G requires fetanagent_cbe_birr_shadow_worker.';
  end if;

  if worker_can_login then
    raise exception 'Stage 1G requires fetanagent_cbe_birr_shadow_worker to remain NOLOGIN.';
  end if;
end;
$$;

create function app.preflight_cbe_birr_shadow_verification_job(
  p_job_id uuid
)
returns table (
  job_id uuid,
  preflight_version text,
  verifier_version text,
  eligibility text,
  blocker_code text,
  lease_allowed boolean,
  protected_material_allowed boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  resolved_feature_count bigint;
  resolved_disabled_count bigint;
begin
  if p_job_id is null then
    raise exception 'The CBE Birr shadow preflight request is invalid.';
  end if;

  select count(*),
         count(*) filter (where feature_switch.mode = 'disabled')
    into resolved_feature_count, resolved_disabled_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection'
   );

  if resolved_feature_count <> 4 or resolved_disabled_count <> 4 then
    raise exception 'Dry-run deposit intake requires every financial feature to remain disabled.';
  end if;

  return query
  select shadow_job.id,
         'cbe-birr-shadow-preflight-v1'::text,
         'cbe-birr-shadow-v1'::text,
         'blocked'::text,
         'legacy_protected_lookup_material_ineligible'::text,
         false,
         false
    from app.cbe_birr_shadow_verification_jobs shadow_job
   where shadow_job.id = p_job_id;
end;
$$;

revoke execute on function
  app.lease_cbe_birr_shadow_verification_job(uuid,integer),
  app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text),
  app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)
from fetanagent_cbe_birr_shadow_worker;

revoke all on function app.preflight_cbe_birr_shadow_verification_job(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker;

grant usage on schema app to fetanagent_cbe_birr_shadow_worker;
grant execute on function app.preflight_cbe_birr_shadow_verification_job(uuid)
to fetanagent_cbe_birr_shadow_worker;

comment on role fetanagent_cbe_birr_shadow_worker is
  'FetanAgent CBE Birr shadow-verification group. NOLOGIN; only the metadata-only blocked preflight is executable.';

comment on function app.preflight_cbe_birr_shadow_verification_job(uuid) is
  'Worker-only metadata preflight for one legacy CBE Birr shadow job. Reads only financial-switch metadata and the job identifier; returns fixed blocked labels and literal false lease/protected-material flags; takes no row lock and makes no state or financial claim.';
comment on function app.lease_cbe_birr_shadow_verification_job(uuid,integer) is
  'Legacy ciphertext-returning shadow lease retained for migration continuity; worker execution is revoked.';
comment on function app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text) is
  'Legacy shadow completion mutator retained for migration continuity; worker execution is revoked.';
comment on function app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer) is
  'Legacy shadow retry mutator retained for migration continuity; worker execution is revoked.';

commit;
