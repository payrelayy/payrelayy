-- A signed live TeleBirr observation is bound to one assignment, so a retry produces a new
-- observation body and replay identity even when it inspects the same official receipt source.
-- The original global source-document UNIQUE constraint incorrectly made an earlier review-only
-- observation terminal. Replace it with two narrower immutable registries:
--
--   * one source document can only be reused for the same provider/reference binding; and
--   * one source document can produce at most one settlement candidate.
--
-- Review/reject observations remain append-only, every exact signed replay is still blocked by
-- the existing body/signature/replay constraints, and no runtime receives new direct privileges.

begin;

do $guard_reviewed_live_document_contract$
declare
  source_constraint_definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into source_constraint_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_live_telebirr_observation_transcripts'::regclass
     and constraint_row.conname =
         'private_live_telebirr_observation_tr_source_document_digest_key'
     and constraint_row.contype = 'u';

  if source_constraint_definition is distinct from
       'UNIQUE (source_document_digest)'
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_source_document_bindings'
       ) is not null
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_settlement_documents'
       ) is not null then
    raise exception 'The reviewed live TeleBirr source-document contract does not match.';
  end if;
end;
$guard_reviewed_live_document_contract$;

lock table app.private_live_telebirr_observation_transcripts
  in access exclusive mode;
lock table app.private_live_telebirr_verification_outcomes
  in access exclusive mode;

create table app.private_live_telebirr_source_document_bindings (
  source_document_digest text primary key
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  first_verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  registered_at timestamptz not null default pg_catalog.clock_timestamp()
);

do $guard_source_document_binding_backfill$
begin
  if exists (
    select observation.source_document_digest
      from app.private_live_telebirr_observation_transcripts observation
      join app.private_live_telebirr_verification_attempts attempt
        on attempt.id = observation.verification_attempt_id
      join app.private_live_telebirr_verification_jobs job
        on job.id = attempt.verification_job_id
     group by observation.source_document_digest
    having pg_catalog.count(distinct (
             job.payment_provider_id,
             job.candidate_reference_fingerprint
           )) <> 1
  ) then
    raise exception 'An existing TeleBirr source document spans provider references.';
  end if;
end;
$guard_source_document_binding_backfill$;

insert into app.private_live_telebirr_source_document_bindings (
  source_document_digest,
  payment_provider_id,
  candidate_reference_fingerprint,
  first_verification_attempt_id,
  registered_at
)
select distinct on (observation.source_document_digest)
       observation.source_document_digest,
       job.payment_provider_id,
       job.candidate_reference_fingerprint,
       observation.verification_attempt_id,
       observation.created_at
  from app.private_live_telebirr_observation_transcripts observation
  join app.private_live_telebirr_verification_attempts attempt
    on attempt.id = observation.verification_attempt_id
  join app.private_live_telebirr_verification_jobs job
    on job.id = attempt.verification_job_id
 order by observation.source_document_digest,
          observation.created_at,
          observation.id;

create function app.enforce_private_live_telebirr_source_document_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_provider_id uuid;
  resolved_reference_fingerprint text;
  registered_binding app.private_live_telebirr_source_document_bindings%rowtype;
begin
  select job.payment_provider_id, job.candidate_reference_fingerprint
    into resolved_provider_id, resolved_reference_fingerprint
    from app.private_live_telebirr_verification_attempts attempt
    join app.private_live_telebirr_verification_jobs job
      on job.id = attempt.verification_job_id
   where attempt.id = new.verification_attempt_id
   for share of attempt, job;

  if resolved_provider_id is null or resolved_reference_fingerprint is null then
    raise exception 'The TeleBirr source-document reference binding is unavailable.';
  end if;

  insert into app.private_live_telebirr_source_document_bindings (
    source_document_digest,
    payment_provider_id,
    candidate_reference_fingerprint,
    first_verification_attempt_id
  ) values (
    new.source_document_digest,
    resolved_provider_id,
    resolved_reference_fingerprint,
    new.verification_attempt_id
  )
  on conflict (source_document_digest) do nothing;

  select binding.*
    into registered_binding
    from app.private_live_telebirr_source_document_bindings binding
   where binding.source_document_digest = new.source_document_digest
   for update;

  if registered_binding.source_document_digest is null
    or registered_binding.payment_provider_id is distinct from resolved_provider_id
    or registered_binding.candidate_reference_fingerprint
         is distinct from resolved_reference_fingerprint then
    raise exception
      'The TeleBirr source document belongs to another provider reference.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_source_document_binding_guard
before insert on app.private_live_telebirr_observation_transcripts
for each row execute function app.enforce_private_live_telebirr_source_document_binding();

alter table app.private_live_telebirr_observation_transcripts
  add constraint private_live_tbirr_observation_source_document_fkey
  foreign key (source_document_digest)
  references app.private_live_telebirr_source_document_bindings (
    source_document_digest
  ) on delete restrict;

create table app.private_live_telebirr_settlement_documents (
  source_document_digest text primary key
    references app.private_live_telebirr_source_document_bindings (
      source_document_digest
    ) on delete restrict,
  verification_outcome_id uuid not null unique
    references app.private_live_telebirr_verification_outcomes (id) on delete restrict,
  observation_transcript_id uuid not null unique
    references app.private_live_telebirr_observation_transcripts (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into app.private_live_telebirr_settlement_documents (
  source_document_digest,
  verification_outcome_id,
  observation_transcript_id,
  payment_provider_id,
  candidate_reference_fingerprint,
  registered_at
)
select observation.source_document_digest,
       outcome.id,
       observation.id,
       outcome.payment_provider_id,
       outcome.candidate_reference_fingerprint,
       outcome.created_at
  from app.private_live_telebirr_verification_outcomes outcome
  join app.private_live_telebirr_observation_transcripts observation
    on observation.id = outcome.observation_transcript_id
   and observation.verification_attempt_id = outcome.verification_attempt_id
 where outcome.disposition = 'settlement_candidate';

create function app.register_private_live_telebirr_settlement_document()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  observation app.private_live_telebirr_observation_transcripts%rowtype;
  inserted_count integer;
begin
  if new.disposition <> 'settlement_candidate' then
    return new;
  end if;

  select transcript.*
    into observation
    from app.private_live_telebirr_observation_transcripts transcript
   where transcript.id = new.observation_transcript_id
     and transcript.verification_attempt_id = new.verification_attempt_id
   for share;

  if observation.id is null then
    raise exception 'The TeleBirr settlement source document is unavailable.';
  end if;

  insert into app.private_live_telebirr_settlement_documents (
    source_document_digest,
    verification_outcome_id,
    observation_transcript_id,
    payment_provider_id,
    candidate_reference_fingerprint,
    registered_at
  ) values (
    observation.source_document_digest,
    new.id,
    observation.id,
    new.payment_provider_id,
    new.candidate_reference_fingerprint,
    new.created_at
  )
  on conflict (source_document_digest) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count <> 1 then
    raise exception using
      errcode = '23505',
      message = 'The TeleBirr receipt document already has a settlement candidate.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_settlement_document_guard
after insert on app.private_live_telebirr_verification_outcomes
for each row execute function app.register_private_live_telebirr_settlement_document();

alter table app.private_live_telebirr_observation_transcripts
  drop constraint private_live_telebirr_observation_tr_source_document_digest_key;

create index private_live_tbirr_observation_source_document_idx
  on app.private_live_telebirr_observation_transcripts (source_document_digest);

create trigger private_live_telebirr_source_document_bindings_immutable
before update or delete on app.private_live_telebirr_source_document_bindings
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_source_document_bindings_no_truncate
before truncate on app.private_live_telebirr_source_document_bindings
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_live_telebirr_settlement_documents_immutable
before update or delete on app.private_live_telebirr_settlement_documents
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_settlement_documents_no_truncate
before truncate on app.private_live_telebirr_settlement_documents
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_live_telebirr_source_document_bindings enable row level security;
alter table app.private_live_telebirr_source_document_bindings force row level security;
alter table app.private_live_telebirr_settlement_documents enable row level security;
alter table app.private_live_telebirr_settlement_documents force row level security;

alter table app.private_live_telebirr_source_document_bindings owner to postgres;
alter table app.private_live_telebirr_settlement_documents owner to postgres;
alter function app.enforce_private_live_telebirr_source_document_binding()
  owner to postgres;
alter function app.register_private_live_telebirr_settlement_document()
  owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_source_document_bindings,
  app.private_live_telebirr_settlement_documents
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

revoke all on function
  app.enforce_private_live_telebirr_source_document_binding(),
  app.register_private_live_telebirr_settlement_document()
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

comment on table app.private_live_telebirr_source_document_bindings is
  'Append-only registry binding a live receipt source digest to exactly one provider/reference while permitting fresh signed observations for legitimate retries.';

comment on table app.private_live_telebirr_settlement_documents is
  'Append-only settlement anti-replay ledger: one source document can create at most one live TeleBirr settlement candidate.';

comment on function app.enforce_private_live_telebirr_source_document_binding() is
  'Trigger-only guard allowing source-document reuse solely for the same immutable provider/reference binding.';

comment on function app.register_private_live_telebirr_settlement_document() is
  'Trigger-only, concurrency-safe registration of one settlement candidate per TeleBirr source document.';

comment on table app.private_live_telebirr_observation_transcripts is
  'Append-only digest-only signed observations. Fresh assignment-bound retries may share a source document only through the provider/reference registry; exact bodies, signatures, and replay identities remain unique.';

commit;
