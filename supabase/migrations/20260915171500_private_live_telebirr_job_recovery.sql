-- One-time, audit-preserving recovery for an unattempted TeleBirr verification job whose original
-- five-minute assignment window elapsed because the production assignment transport was absent.
--
-- This does not create a proof, verify a payment, settle a deposit, enqueue KemerBet execution, or
-- change any feature switch. Only postgres may authorize one bounded replacement assignment window,
-- and every normal lease, signature, evidence, duplicate, policy, pilot, and activation guard remains
-- in force. The original expiry is retained on the job and the recovery fields become immutable.

begin;

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_job_window_check;

alter table app.private_live_telebirr_verification_jobs
  add column original_expires_at timestamptz,
  add column recovered_at timestamptz,
  add column recovery_request_key uuid,
  add column recovery_request_digest text,
  add column recovery_reason_code text,
  add constraint private_live_telebirr_job_recovery_request_key_v4_check check (
    recovery_request_key is null
    or recovery_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint private_live_telebirr_job_recovery_request_digest_check check (
    recovery_request_digest is null
    or recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_live_telebirr_job_recovery_reason_check check (
    recovery_reason_code is null
    or recovery_reason_code = 'assignment_runtime_unavailable'
  ),
  add constraint private_live_telebirr_job_window_check check (
    not_before = submitted_at
    and expires_at > not_before
    and (
      (
        original_expires_at is null
        and recovered_at is null
        and recovery_request_key is null
        and recovery_request_digest is null
        and recovery_reason_code is null
        and expires_at <= submitted_at + interval '5 minutes'
      )
      or
      (
        original_expires_at is not null
        and recovered_at is not null
        and recovery_request_key is not null
        and recovery_request_digest is not null
        and recovery_reason_code = 'assignment_runtime_unavailable'
        and original_expires_at > not_before
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and expires_at > recovered_at + interval '60 seconds'
        and expires_at <= recovered_at + interval '5 minutes'
      )
    )
  );

create unique index private_live_telebirr_jobs_recovery_request_key_idx
  on app.private_live_telebirr_verification_jobs (recovery_request_key)
  where recovery_request_key is not null;

create unique index private_live_telebirr_jobs_recovery_request_digest_idx
  on app.private_live_telebirr_verification_jobs (recovery_request_digest)
  where recovery_request_digest is not null;

drop trigger private_live_telebirr_jobs_immutable
  on app.private_live_telebirr_verification_jobs;

create function app.enforce_private_live_telebirr_verification_job_recovery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Private live TeleBirr verification jobs cannot be deleted.';
  end if;

  if session_user <> 'postgres'
    or old.original_expires_at is not null
    or old.recovered_at is not null
    or old.recovery_request_key is not null
    or old.recovery_request_digest is not null
    or old.recovery_reason_code is not null
    or new.original_expires_at is distinct from old.expires_at
    or new.recovered_at is null
    or new.recovery_request_key is null
    or new.recovery_request_digest is null
    or new.recovery_reason_code <> 'assignment_runtime_unavailable'
    or new.expires_at <= new.recovered_at + interval '60 seconds'
    or new.expires_at > new.recovered_at + interval '5 minutes'
    or old.expires_at > new.recovered_at
    or (
      pg_catalog.to_jsonb(new) - array[
        'expires_at',
        'original_expires_at',
        'recovered_at',
        'recovery_request_key',
        'recovery_request_digest',
        'recovery_reason_code'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(old) - array[
        'expires_at',
        'original_expires_at',
        'recovered_at',
        'recovery_request_key',
        'recovery_request_digest',
        'recovery_reason_code'
      ]::text[]
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = old.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = old.id
    ) then
    raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
  end if;

  expected_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:job-recovery:v1'
      || '|request_key=' || new.recovery_request_key::text
      || '|job_id=' || new.id::text
      || '|pilot_revision_id=' || new.pilot_revision_id::text
      || '|original_expires_at_us=' || (
        extract(epoch from new.original_expires_at) * 1000000
      )::bigint::text
      || '|recovered_at_us=' || (
        extract(epoch from new.recovered_at) * 1000000
      )::bigint::text
      || '|recovered_expires_at_us=' || (
        extract(epoch from new.expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || new.recovery_reason_code
  );

  if new.recovery_request_digest is distinct from expected_digest then
    raise exception 'The private live TeleBirr verification job recovery digest is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_jobs_immutable
before update or delete on app.private_live_telebirr_verification_jobs
for each row execute function app.enforce_private_live_telebirr_verification_job_recovery();

create function app.recover_unattempted_private_live_telebirr_verification_job(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  verification_job_id uuid,
  original_job_expires_at timestamptz,
  recovered_job_expires_at timestamptz,
  already_recovered boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  active_epoch bigint;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  authorized_at timestamptz;
  recovered_expires_at timestamptz;
  request_digest text;
begin
  if session_user <> 'postgres'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null
    or p_activation_epoch <= 0
    or p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from 'assignment_runtime_unavailable' then
    raise exception 'The private live TeleBirr verification job recovery request is invalid.';
  end if;

  -- This takes the repository-wide activation/switch/pilot locks in their canonical order.
  active_epoch := app.current_private_trusted_telebirr_activation_epoch();
  if active_epoch is distinct from p_activation_epoch then
    raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = active_epoch
     and activation_epoch.pilot_revision_id = p_pilot_revision_id
     and activation_epoch.authority_state = 'active'
     and activation_epoch.revoked_at is null
   for share;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_verification_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
   for update;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
     and receiver_profile.pilot_revision_id = p_pilot_revision_id
   for share;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = p_pilot_revision_id
   for share;

  if job.id is null
    or authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null then
    raise exception 'The private live TeleBirr verification job recovery lineage is unavailable.';
  end if;

  if job.recovery_request_key is not null then
    if job.recovery_request_key is distinct from p_recovery_request_key
      or job.recovery_reason_code is distinct from p_reason_code
      or job.original_expires_at is null
      or job.recovered_at is null
      or job.recovery_request_digest is null then
      raise exception 'The private live TeleBirr verification job recovery replay conflicts.';
    end if;

    request_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:job-recovery:v1'
        || '|request_key=' || job.recovery_request_key::text
        || '|job_id=' || job.id::text
        || '|pilot_revision_id=' || job.pilot_revision_id::text
        || '|original_expires_at_us=' || (
          extract(epoch from job.original_expires_at) * 1000000
        )::bigint::text
        || '|recovered_at_us=' || (
          extract(epoch from job.recovered_at) * 1000000
        )::bigint::text
        || '|recovered_expires_at_us=' || (
          extract(epoch from job.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || job.recovery_reason_code
    );
    if job.recovery_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr verification job recovery replay is invalid.';
    end if;

    return query
    select job.id, job.original_expires_at, job.expires_at, true;
    return;
  end if;

  authorized_at := pg_catalog.clock_timestamp();
  recovered_expires_at := least(
    authorized_at + interval '5 minutes',
    authority.expires_at,
    pilot.expires_at,
    profile.valid_until
  );

  if pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or job.receiver_profile_id is distinct from profile.id
    or job.payment_provider_id is distinct from profile.payment_provider_id
    or job.candidate_reference_fingerprint
         is distinct from proof.candidate_reference_fingerprint
    or job.expires_at > authorized_at
    or authorized_at >= proof.submitted_at + interval '24 hours'
    or authorized_at < profile.valid_from
    or authorized_at >= profile.valid_until
    or recovered_expires_at <= authorized_at + interval '60 seconds'
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = job.id
    ) then
    raise exception 'The private live TeleBirr verification job is not recoverable.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:job-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|job_id=' || job.id::text
      || '|pilot_revision_id=' || job.pilot_revision_id::text
      || '|original_expires_at_us=' || (
        extract(epoch from job.expires_at) * 1000000
      )::bigint::text
      || '|recovered_at_us=' || (
        extract(epoch from authorized_at) * 1000000
      )::bigint::text
      || '|recovered_expires_at_us=' || (
        extract(epoch from recovered_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );

  update app.private_live_telebirr_verification_jobs verification_job
     set original_expires_at = verification_job.expires_at,
         recovered_at = authorized_at,
         recovery_request_key = p_recovery_request_key,
         recovery_request_digest = request_digest,
         recovery_reason_code = p_reason_code,
         expires_at = recovered_expires_at
   where verification_job.id = job.id
     and verification_job.recovery_request_key is null
  returning verification_job.* into job;

  if job.recovery_request_key is distinct from p_recovery_request_key
    or job.recovery_request_digest is distinct from request_digest then
    raise exception 'The private live TeleBirr verification job recovery did not persist.';
  end if;

  return query
  select job.id, job.original_expires_at, job.expires_at, false;
end;
$$;

alter function app.enforce_private_live_telebirr_verification_job_recovery()
  owner to postgres;
alter function app.recover_unattempted_private_live_telebirr_verification_job(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function
  app.enforce_private_live_telebirr_verification_job_recovery(),
  app.recover_unattempted_private_live_telebirr_verification_job(
    uuid, uuid, bigint, uuid, text
  )
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on function app.recover_unattempted_private_live_telebirr_verification_job(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, one-use recovery for an expired, wholly unattempted job in the exact active pilot and activation epoch. Opens at most one new five-minute verification window; performs no verification, settlement, execution, or switch change.';

comment on function app.enforce_private_live_telebirr_verification_job_recovery() is
  'Allows only the postgres-owned recovery function to replace one expired assignment window while retaining its original expiry and immutable request digest. All other job updates and every delete remain rejected.';

comment on table app.private_live_telebirr_verification_jobs is
  'Private TeleBirr proof-bound verification jobs. Immutable except for one postgres-only, fully retained recovery window when the original job expired wholly unattempted because assignment transport was unavailable.';

commit;
