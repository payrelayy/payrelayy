-- Complete the private TeleBirr verifier's database-only ingress. The verifier receives only one
-- already-staged signed assignment/observation pair at a time and may quarantine only that exact
-- pair after a cryptographic validation failure. Neither function accepts arbitrary SQL or creates
-- a payment; financial completion remains behind the separately guarded existing routine.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.private_live_telebirr_verifier_evidence_quarantine (
  observation_body_digest text primary key
    references app.private_live_telebirr_device_evidence_staging (observation_body_digest)
      on delete restrict,
  verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  reason_code text not null check (reason_code = 'trusted_evidence_invalid'),
  quarantined_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger private_live_telebirr_verifier_quarantine_immutable
before update or delete on app.private_live_telebirr_verifier_evidence_quarantine
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_verifier_quarantine_no_truncate
before truncate on app.private_live_telebirr_verifier_evidence_quarantine
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.load_next_private_live_telebirr_staged_evidence()
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  completion_request_key uuid,
  observation_body_digest text,
  signed_assignment jsonb,
  signed_observation jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  captured_at timestamptz;
begin
  perform app.require_trusted_telebirr_verifier_session();
  captured_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  -- A disabled or stopped financial authority is an empty queue, never a verifier error. This
  -- lets operators stop all consumption atomically with the existing database switches.
  if (
    select count(*) <> 4
      from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification'
     )
       and feature_switch.mode = 'live'
  ) then
    return;
  end if;

  return query
  select staged.verification_attempt_id,
         attempt.lease_token,
         attempt.lease_request_key,
         staged.observation_body_digest,
         staged.signed_assignment,
         staged.signed_observation
    from app.private_live_telebirr_device_evidence_staging staged
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
    join app.private_live_telebirr_verification_jobs job
      on job.id = attempt.verification_job_id
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = job.pilot_revision_id
   where pilot.status = 'armed'
     and captured_at >= pilot.active_from
     and captured_at < pilot.expires_at
     and captured_at >= job.not_before
     and captured_at < job.expires_at
     and captured_at < attempt.expires_at
     and staged.observed_at >= attempt.issued_at
     and staged.observed_at < attempt.expires_at
     and attempt.lease_request_key::text
       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and not exists (
       select 1
         from app.private_live_telebirr_verification_outcomes outcome
        where outcome.verification_attempt_id = attempt.id
           or outcome.completion_request_key = attempt.lease_request_key
     )
     and not exists (
       select 1
         from app.private_live_telebirr_verifier_evidence_quarantine quarantine
        where quarantine.verification_attempt_id = attempt.id
           or quarantine.observation_body_digest = staged.observation_body_digest
     )
   order by staged.staged_at, staged.observation_body_digest
   limit 1;
end;
$$;

create function app.quarantine_private_live_telebirr_staged_evidence(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_observation_body_digest text,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_quarantine app.private_live_telebirr_verifier_evidence_quarantine%rowtype;
  staged_attempt_id uuid;
begin
  perform app.require_trusted_telebirr_verifier_session();

  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reason_code is distinct from 'trusted_evidence_invalid' then
    raise exception 'The trusted TeleBirr evidence quarantine request is invalid.';
  end if;

  select quarantine.*
    into existing_quarantine
    from app.private_live_telebirr_verifier_evidence_quarantine quarantine
   where quarantine.observation_body_digest = p_observation_body_digest
      or quarantine.verification_attempt_id = p_verification_attempt_id;

  if existing_quarantine.observation_body_digest is not null then
    if existing_quarantine.observation_body_digest = p_observation_body_digest
      and existing_quarantine.verification_attempt_id = p_verification_attempt_id
      and existing_quarantine.reason_code = p_reason_code then
      return true;
    end if;
    raise exception 'The trusted TeleBirr evidence quarantine replay conflicts.';
  end if;

  select staged.verification_attempt_id
    into staged_attempt_id
    from app.private_live_telebirr_device_evidence_staging staged
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
     and attempt.lease_token = p_lease_token
   where staged.observation_body_digest = p_observation_body_digest
     and staged.verification_attempt_id = p_verification_attempt_id
     and not exists (
       select 1
         from app.private_live_telebirr_verification_outcomes outcome
        where outcome.verification_attempt_id = p_verification_attempt_id
     )
   for share of staged, attempt;

  if staged_attempt_id is null then
    raise exception 'The trusted TeleBirr staged evidence is unavailable.';
  end if;

  insert into app.private_live_telebirr_verifier_evidence_quarantine (
    observation_body_digest,
    verification_attempt_id,
    reason_code
  ) values (
    p_observation_body_digest,
    p_verification_attempt_id,
    p_reason_code
  );

  return true;
end;
$$;

alter table app.private_live_telebirr_verifier_evidence_quarantine enable row level security;
alter table app.private_live_telebirr_verifier_evidence_quarantine force row level security;
alter table app.private_live_telebirr_verifier_evidence_quarantine owner to postgres;

alter function app.load_next_private_live_telebirr_staged_evidence() owner to postgres;
alter function app.quarantine_private_live_telebirr_staged_evidence(uuid, uuid, text, text)
  owner to postgres;

revoke all privileges on table app.private_live_telebirr_verifier_evidence_quarantine
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.load_next_private_live_telebirr_staged_evidence(),
  app.quarantine_private_live_telebirr_staged_evidence(uuid, uuid, text, text)
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

grant execute on function
  app.load_next_private_live_telebirr_staged_evidence(),
  app.quarantine_private_live_telebirr_staged_evidence(uuid, uuid, text, text)
to fetanagent_trusted_telebirr_verifier;

comment on table app.private_live_telebirr_verifier_evidence_quarantine is
  'Append-only terminal record for a staged signed TeleBirr pair that failed the isolated verifier cryptographic boundary. It creates no claim, settlement, execution job, or money authority.';
comment on function app.load_next_private_live_telebirr_staged_evidence() is
  'Operation-time guarded database-only verifier ingress. Returns at most one unexpired, uncompleted, non-quarantined signed pair while every private-pilot financial switch is live.';
comment on function app.quarantine_private_live_telebirr_staged_evidence(uuid, uuid, text, text) is
  'Operation-time guarded idempotent quarantine for the exact staged attempt, lease token, and observation digest after trusted cryptographic verification fails.';

commit;
