-- PayReplayy Stage 2: immutable deposit intake and authoritative verification ledger.
--
-- This migration does not grant runtime access and does not create an automated KemerBet action.
-- It establishes the database invariants that later API/worker procedures must obey.

begin;

create type app.player_validation_status as enum ('unverified', 'valid', 'invalid', 'review_required');
create type app.deposit_status as enum (
  'intake_received',
  'verification_pending',
  'verification_review',
  'verified',
  'execution_pending',
  'execution_in_progress',
  'execution_review',
  'execution_reconciliation',
  'executed',
  'rejected',
  'expired',
  'cancelled',
  'execution_uncertain'
);
create type app.deposit_submission_status as enum (
  'received',
  'verification_enqueued',
  'verified',
  'rejected',
  'superseded'
);
create type app.verification_attempt_outcome as enum (
  'verified',
  'rejected',
  'manual_review',
  'unavailable'
);
create type app.review_kind as enum ('verification', 'execution');
create type app.review_status as enum ('open', 'assigned', 'resolved', 'cancelled');
create type app.deposit_job_kind as enum (
  'verify_deposit',
  'expire_deposit',
  'delete_evidence',
  'execute_deposit',
  'reconcile_execution'
);
create type app.deposit_job_status as enum (
  'queued',
  'leased',
  'retry_wait',
  'succeeded',
  'dead',
  'cancelled'
);
create type app.evidence_file_status as enum ('uploaded', 'accepted', 'rejected', 'purged');
create type app.provider_evidence_source as enum (
  'provider_api',
  'provider_receipt_lookup',
  'provider_account_activity'
);

-- Composite keys make an intent's immutable receiver and policy snapshots provable by foreign key.
alter table app.receiver_accounts
  add constraint receiver_accounts_id_provider_version_key unique (id, provider_id, version);
alter table app.deposit_policy_versions
  add constraint deposit_policy_versions_id_version_key unique (id, version);

create table app.customer_platform_players (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references app.customers (id) on delete restrict,
  platform_id uuid not null references app.platforms (id) on delete restrict,
  player_id text not null check (player_id = btrim(player_id) and char_length(player_id) between 1 and 64),
  status app.record_status not null default 'active',
  validation_status app.player_validation_status not null default 'unverified',
  last_validated_at timestamptz,
  last_validation_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_platform_players_platform_player_key unique (platform_id, player_id),
  constraint customer_platform_players_id_customer_platform_key unique (id, customer_id, platform_id)
);

create index customer_platform_players_customer_status_idx
  on app.customer_platform_players (customer_id, status, created_at desc);

create trigger customer_platform_players_set_updated_at
before update on app.customer_platform_players
for each row
execute function app.set_updated_at();

create function app.enforce_customer_platform_player_binding_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.customer_id is distinct from old.customer_id
    or new.platform_id is distinct from old.platform_id
    or new.player_id is distinct from old.player_id then
    raise exception 'Customer platform player bindings are immutable.';
  end if;

  return new;
end;
$$;

create trigger customer_platform_players_immutable_binding
before update on app.customer_platform_players
for each row
execute function app.enforce_customer_platform_player_binding_immutable();

create function app.reject_deposit_ledger_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Deposit-ledger records must be retained; use an explicit lifecycle status instead.';
end;
$$;

create table app.player_validation_attempts (
  id uuid primary key default gen_random_uuid(),
  player_account_id uuid not null references app.customer_platform_players (id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  outcome app.player_validation_status not null check (outcome <> 'unverified'),
  reason_code text,
  adapter_version text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= started_at),
  result_digest text,
  created_at timestamptz not null default now(),
  constraint player_validation_attempts_player_attempt_key unique (player_account_id, attempt_number)
);

create index player_validation_attempts_player_completed_idx
  on app.player_validation_attempts (player_account_id, completed_at desc);

create trigger player_validation_attempts_immutable
before update or delete on app.player_validation_attempts
for each row
execute function app.reject_deposit_ledger_delete();

create function app.enforce_customer_platform_player_validation()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  latest_attempt app.player_validation_attempts%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.validation_status <> 'unverified'
      or new.last_validated_at is not null
      or new.last_validation_reason_code is not null then
      raise exception 'A player account must begin unverified and without validation metadata.';
    end if;

    return new;
  end if;

  if new.validation_status is not distinct from old.validation_status
    and new.last_validated_at is not distinct from old.last_validated_at
    and new.last_validation_reason_code is not distinct from old.last_validation_reason_code then
    return new;
  end if;

  select *
    into latest_attempt
    from app.player_validation_attempts
    where player_account_id = old.id
    order by completed_at desc, attempt_number desc
    limit 1;

  if not found
    or new.validation_status = 'unverified'
    or latest_attempt.outcome <> new.validation_status then
    raise exception 'Player validation status must be backed by the latest immutable validation attempt.';
  end if;

  new.last_validated_at := latest_attempt.completed_at;
  new.last_validation_reason_code := latest_attempt.reason_code;
  return new;
end;
$$;

create trigger customer_platform_players_enforce_validation
before insert or update on app.customer_platform_players
for each row
execute function app.enforce_customer_platform_player_validation();

create table app.deposit_intents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  platform_id uuid not null,
  player_account_id uuid not null,
  payment_provider_id uuid not null references app.payment_providers (id) on delete restrict,
  receiver_account_id uuid not null,
  receiver_account_version integer not null,
  receiver_account_holder_name_snapshot text not null,
  receiver_account_masked_snapshot text not null,
  receiver_instructions_snapshot jsonb not null check (jsonb_typeof(receiver_instructions_snapshot) = 'object'),
  deposit_policy_version_id uuid not null,
  deposit_policy_version integer not null,
  minimum_amount_minor bigint not null,
  maximum_amount_minor bigint not null,
  freshness_window_seconds integer not null,
  currency_code char(3) not null default 'ETB' check (currency_code = 'ETB'),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  status app.deposit_status not null default 'intake_received',
  opened_at timestamptz not null default now(),
  payment_deadline_at timestamptz not null,
  status_changed_at timestamptz not null default now(),
  verified_at timestamptz,
  rejection_reason_code text,
  origin_inbound_event_id uuid unique references app.inbound_events (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_intents_player_customer_platform_fkey
    foreign key (player_account_id, customer_id, platform_id)
    references app.customer_platform_players (id, customer_id, platform_id) on delete restrict,
  constraint deposit_intents_receiver_provider_version_fkey
    foreign key (receiver_account_id, payment_provider_id, receiver_account_version)
    references app.receiver_accounts (id, provider_id, version) on delete restrict,
  constraint deposit_intents_policy_version_fkey
    foreign key (deposit_policy_version_id, deposit_policy_version)
    references app.deposit_policy_versions (id, version) on delete restrict,
  constraint deposit_intents_amount_in_snapshot_range
    check (expected_amount_minor between minimum_amount_minor and maximum_amount_minor),
  constraint deposit_intents_freshness_range
    check (freshness_window_seconds between 60 and 86400),
  constraint deposit_intents_deadline_shape
    check (payment_deadline_at = opened_at + make_interval(secs => freshness_window_seconds))
);

create index deposit_intents_customer_created_idx
  on app.deposit_intents (customer_id, created_at desc);
create index deposit_intents_player_created_idx
  on app.deposit_intents (player_account_id, created_at desc);
create index deposit_intents_status_deadline_idx
  on app.deposit_intents (status, payment_deadline_at)
  where status in ('intake_received', 'verification_pending', 'verification_review');

create function app.populate_deposit_intent_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  player_row app.customer_platform_players%rowtype;
  receiver_row app.receiver_accounts%rowtype;
  policy_row app.deposit_policy_versions%rowtype;
begin
  select player_account.*
    into player_row
    from app.customer_platform_players player_account
    join app.platforms platform
      on platform.id = player_account.platform_id
    where player_account.id = new.player_account_id
      and platform.status = 'active'
    for update of player_account, platform;

  if not found
    or player_row.status <> 'active'
    or player_row.validation_status <> 'valid' then
    raise exception 'A deposit intent requires an active, validated player account.';
  end if;

  if new.customer_id is distinct from player_row.customer_id
    or new.platform_id is distinct from player_row.platform_id then
    raise exception 'Deposit intent customer and platform must match its player account.';
  end if;

  select receiver_account.*
    into receiver_row
    from app.receiver_accounts receiver_account
    join app.payment_providers payment_provider
      on payment_provider.id = receiver_account.provider_id
    where receiver_account.id = new.receiver_account_id
      and receiver_account.provider_id = new.payment_provider_id
      and receiver_account.status = 'active'
      and payment_provider.status = 'active'
    for update of receiver_account, payment_provider;

  if not found then
    raise exception 'A deposit intent requires an active receiver account for its payment provider.';
  end if;

  select *
    into policy_row
    from app.deposit_policy_versions
    where status = 'active'
    for update;

  if not found then
    raise exception 'An active deposit policy is required.';
  end if;

  if new.origin_inbound_event_id is not null and not exists (
    select 1
    from app.inbound_events inbound_event
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    where inbound_event.id = new.origin_inbound_event_id
      and customer_identity.customer_id = new.customer_id
  ) then
    raise exception 'The inbound event does not belong to the deposit customer.';
  end if;

  new.receiver_account_version := receiver_row.version;
  new.receiver_account_holder_name_snapshot := receiver_row.account_holder_name;
  new.receiver_account_masked_snapshot := receiver_row.account_reference_masked;
  new.receiver_instructions_snapshot := receiver_row.instructions;
  new.deposit_policy_version_id := policy_row.id;
  new.deposit_policy_version := policy_row.version;
  new.minimum_amount_minor := policy_row.minimum_amount_minor;
  new.maximum_amount_minor := policy_row.maximum_amount_minor;
  new.freshness_window_seconds := policy_row.freshness_window_seconds;
  new.currency_code := 'ETB';
  new.opened_at := now();
  new.payment_deadline_at := new.opened_at + make_interval(secs => policy_row.freshness_window_seconds);
  new.status := 'intake_received';
  new.status_changed_at := new.opened_at;
  new.verified_at := null;
  new.rejection_reason_code := null;

  if new.expected_amount_minor < new.minimum_amount_minor
    or new.expected_amount_minor > new.maximum_amount_minor then
    raise exception 'The requested amount is outside the active deposit policy.';
  end if;

  return new;
end;
$$;

create function app.enforce_deposit_intent_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.customer_id is distinct from old.customer_id
    or new.platform_id is distinct from old.platform_id
    or new.player_account_id is distinct from old.player_account_id
    or new.payment_provider_id is distinct from old.payment_provider_id
    or new.receiver_account_id is distinct from old.receiver_account_id
    or new.receiver_account_version is distinct from old.receiver_account_version
    or new.receiver_account_holder_name_snapshot is distinct from old.receiver_account_holder_name_snapshot
    or new.receiver_account_masked_snapshot is distinct from old.receiver_account_masked_snapshot
    or new.receiver_instructions_snapshot is distinct from old.receiver_instructions_snapshot
    or new.deposit_policy_version_id is distinct from old.deposit_policy_version_id
    or new.deposit_policy_version is distinct from old.deposit_policy_version
    or new.minimum_amount_minor is distinct from old.minimum_amount_minor
    or new.maximum_amount_minor is distinct from old.maximum_amount_minor
    or new.freshness_window_seconds is distinct from old.freshness_window_seconds
    or new.currency_code is distinct from old.currency_code
    or new.expected_amount_minor is distinct from old.expected_amount_minor
    or new.opened_at is distinct from old.opened_at
    or new.payment_deadline_at is distinct from old.payment_deadline_at
    or new.origin_inbound_event_id is distinct from old.origin_inbound_event_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Deposit intent financial snapshots are immutable.';
  end if;

  if new.status = old.status then
    if new.verified_at is distinct from old.verified_at
      or new.rejection_reason_code is distinct from old.rejection_reason_code
      or new.status_changed_at is distinct from old.status_changed_at then
      raise exception 'Deposit status metadata changes only as part of a valid status transition.';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'intake_received' and new.status in ('verification_pending', 'rejected', 'expired', 'cancelled'))
    or (old.status = 'verification_pending' and new.status in ('verification_review', 'verified', 'rejected', 'expired', 'cancelled'))
    or (old.status = 'verification_review' and new.status in ('verification_pending', 'verified', 'rejected', 'expired', 'cancelled'))
    or (old.status = 'verified' and new.status in ('execution_pending', 'execution_review'))
    or (old.status = 'execution_pending' and new.status in ('execution_in_progress', 'execution_uncertain', 'execution_review'))
    or (old.status = 'execution_in_progress' and new.status in ('executed', 'execution_uncertain', 'execution_review'))
    or (old.status = 'execution_review' and new.status in ('execution_pending', 'execution_reconciliation', 'rejected'))
    or (old.status = 'execution_reconciliation' and new.status in ('execution_pending', 'executed', 'execution_review'))
    or (old.status = 'execution_uncertain' and new.status in ('execution_reconciliation', 'execution_review'))
    or (old.status = 'expired' and new.status in ('verification_review', 'cancelled'))
  ) then
    raise exception 'Invalid deposit intent status transition from % to %.', old.status, new.status;
  end if;

  if new.status = 'verified' then
    new.verified_at := now();
  elsif new.verified_at is distinct from old.verified_at then
    raise exception 'Only the verified transition can set verified_at.';
  end if;

  if new.status = 'rejected' and coalesce(btrim(new.rejection_reason_code), '') = '' then
    raise exception 'A rejected deposit intent requires a reason code.';
  elsif new.status <> 'rejected' and new.rejection_reason_code is not null then
    raise exception 'A rejection reason code is allowed only on a rejected deposit intent.';
  end if;

  new.status_changed_at := now();
  return new;
end;
$$;

create trigger deposit_intents_populate_snapshot
before insert on app.deposit_intents
for each row
execute function app.populate_deposit_intent_snapshot();

create trigger deposit_intents_enforce_transition
before update on app.deposit_intents
for each row
execute function app.enforce_deposit_intent_transition();

create trigger deposit_intents_set_updated_at
before update on app.deposit_intents
for each row
execute function app.set_updated_at();

create trigger deposit_intents_no_delete
before delete on app.deposit_intents
for each row
execute function app.reject_deposit_ledger_delete();

create table app.deposit_submissions (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  submission_number integer not null check (submission_number > 0),
  submitted_reference_ciphertext text,
  submitted_reference_fingerprint text,
  submitted_reference_masked text,
  reference_encryption_key_version smallint,
  status app.deposit_submission_status not null default 'received',
  origin_inbound_event_id uuid unique references app.inbound_events (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_submissions_intent_submission_key unique (deposit_intent_id, submission_number),
  constraint deposit_submissions_id_intent_key unique (id, deposit_intent_id),
  constraint deposit_submissions_reference_shape check (
    (submitted_reference_ciphertext is null
      and submitted_reference_fingerprint is null
      and submitted_reference_masked is null
      and reference_encryption_key_version is null)
    or (submitted_reference_ciphertext is not null
      and submitted_reference_fingerprint is not null
      and submitted_reference_masked is not null
      and reference_encryption_key_version is not null
      and reference_encryption_key_version > 0)
  )
);

create unique index deposit_submissions_active_reference_fingerprint_idx
  on app.deposit_submissions (submitted_reference_fingerprint)
  where submitted_reference_fingerprint is not null
    and status in ('received', 'verification_enqueued');
create unique index deposit_submissions_one_active_per_intent_idx
  on app.deposit_submissions (deposit_intent_id)
  where status in ('received', 'verification_enqueued');
create index deposit_submissions_intent_submitted_idx
  on app.deposit_submissions (deposit_intent_id, submitted_at desc);

create function app.enforce_deposit_submission_inbound_event_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.origin_inbound_event_id is not null and not exists (
    select 1
    from app.deposit_intents deposit_intent
    join app.inbound_events inbound_event
      on inbound_event.id = new.origin_inbound_event_id
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    where deposit_intent.id = new.deposit_intent_id
      and customer_identity.customer_id = deposit_intent.customer_id
  ) then
    raise exception 'The submission inbound event does not belong to the deposit customer.';
  end if;

  return new;
end;
$$;

create trigger deposit_submissions_require_owned_inbound_event
before insert on app.deposit_submissions
for each row
execute function app.enforce_deposit_submission_inbound_event_owner();

create function app.enforce_deposit_submission_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.deposit_intent_id is distinct from old.deposit_intent_id
    or new.submission_number is distinct from old.submission_number
    or new.submitted_reference_ciphertext is distinct from old.submitted_reference_ciphertext
    or new.submitted_reference_fingerprint is distinct from old.submitted_reference_fingerprint
    or new.submitted_reference_masked is distinct from old.submitted_reference_masked
    or new.reference_encryption_key_version is distinct from old.reference_encryption_key_version
    or new.origin_inbound_event_id is distinct from old.origin_inbound_event_id
    or new.submitted_at is distinct from old.submitted_at then
    raise exception 'Deposit submission identity and reference material are immutable.';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'received' and new.status in ('verification_enqueued', 'rejected', 'superseded'))
    or (old.status = 'verification_enqueued' and new.status in ('verified', 'rejected', 'superseded'))
  ) then
    raise exception 'Invalid deposit submission status transition from % to %.', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger deposit_submissions_enforce_transition
before update on app.deposit_submissions
for each row
execute function app.enforce_deposit_submission_transition();

create trigger deposit_submissions_set_updated_at
before update on app.deposit_submissions
for each row
execute function app.set_updated_at();

create trigger deposit_submissions_no_delete
before delete on app.deposit_submissions
for each row
execute function app.reject_deposit_ledger_delete();

create table app.deposit_submission_files (
  id uuid primary key default gen_random_uuid(),
  deposit_submission_id uuid not null references app.deposit_submissions (id) on delete restrict,
  storage_object_key text not null unique check (storage_object_key = btrim(storage_object_key) and storage_object_key <> ''),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  sha256_hex text not null check (sha256_hex ~ '^[0-9a-f]{64}$'),
  status app.evidence_file_status not null default 'uploaded',
  extraction_digest text,
  retention_expires_at timestamptz not null default (now() + interval '90 days'),
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_submission_files_purge_shape
    check ((status = 'purged') = (purged_at is not null)),
  constraint deposit_submission_files_fixed_retention
    check (retention_expires_at = created_at + interval '90 days')
);

create index deposit_submission_files_submission_idx
  on app.deposit_submission_files (deposit_submission_id, created_at);
create index deposit_submission_files_retention_idx
  on app.deposit_submission_files (retention_expires_at)
  where status <> 'purged';

create function app.populate_deposit_submission_file_retention()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status <> 'uploaded' or new.purged_at is not null then
    raise exception 'An evidence file must begin uploaded and cannot be pre-purged.';
  end if;

  new.created_at := clock_timestamp();
  new.retention_expires_at := new.created_at + interval '90 days';
  return new;
end;
$$;

create trigger deposit_submission_files_populate_retention
before insert on app.deposit_submission_files
for each row
execute function app.populate_deposit_submission_file_retention();

create function app.enforce_deposit_submission_file_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.deposit_submission_id is distinct from old.deposit_submission_id
    or new.storage_object_key is distinct from old.storage_object_key
    or new.content_type is distinct from old.content_type
    or new.byte_size is distinct from old.byte_size
    or new.sha256_hex is distinct from old.sha256_hex
    or new.retention_expires_at is distinct from old.retention_expires_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Evidence file identity and retention are immutable.';
  end if;

  if old.status = 'purged' then
    raise exception 'A purged evidence file cannot change.';
  end if;

  if new.status = old.status then
    if old.status <> 'uploaded'
      and new.extraction_digest is distinct from old.extraction_digest then
      raise exception 'Extraction metadata is immutable once an evidence file leaves uploaded state.';
    end if;

    if new.status <> 'purged' and new.purged_at is not null then
      raise exception 'Only a purged evidence file may have purged_at.';
    end if;

    return new;
  end if;

  if not (
    (old.status = 'uploaded' and new.status in ('accepted', 'rejected', 'purged'))
    or (old.status in ('accepted', 'rejected') and new.status = 'purged')
  ) then
    raise exception 'Invalid evidence file status transition from % to %.', old.status, new.status;
  end if;

  if new.status = 'purged' then
    if clock_timestamp() < old.retention_expires_at then
      raise exception 'Evidence files cannot be purged before the 90-day retention period ends.';
    end if;

    new.purged_at := clock_timestamp();
  elsif new.status <> 'purged' and new.purged_at is not null then
    raise exception 'Only a purged evidence file may have purged_at.';
  end if;

  return new;
end;
$$;

create trigger deposit_submission_files_immutable
before update on app.deposit_submission_files
for each row
execute function app.enforce_deposit_submission_file_immutable();

create trigger deposit_submission_files_set_updated_at
before update on app.deposit_submission_files
for each row
execute function app.set_updated_at();

create trigger deposit_submission_files_no_delete
before delete on app.deposit_submission_files
for each row
execute function app.reject_deposit_ledger_delete();

create function app.require_deposit_submission_evidence_before_verification()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.status = 'verification_enqueued'
    and old.status <> 'verification_enqueued'
    and new.submitted_reference_ciphertext is null
    and not exists (
      select 1
      from app.deposit_submission_files submission_file
      where submission_file.deposit_submission_id = old.id
        and submission_file.status in ('uploaded', 'accepted')
    ) then
    raise exception 'A verification submission requires a transaction reference or retained evidence file.';
  end if;

  return new;
end;
$$;

create trigger deposit_submissions_require_evidence_before_verification
before update of status on app.deposit_submissions
for each row
execute function app.require_deposit_submission_evidence_before_verification();

create table app.provider_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  payment_provider_id uuid not null references app.payment_providers (id) on delete restrict,
  canonical_reference_ciphertext text not null,
  canonical_reference_fingerprint text not null,
  canonical_reference_masked text not null,
  reference_encryption_key_version smallint not null check (reference_encryption_key_version > 0),
  evidence_source app.provider_evidence_source not null,
  provider_final_status text not null default 'completed' check (provider_final_status = 'completed'),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code char(3) not null default 'ETB' check (currency_code = 'ETB'),
  occurred_at timestamptz not null,
  matched_receiver_account_id uuid,
  matched_receiver_account_version integer,
  authoritative_locator_ciphertext text,
  authoritative_locator_key_version smallint check (
    authoritative_locator_ciphertext is null
    or (authoritative_locator_key_version is not null and authoritative_locator_key_version > 0)
  ),
  evidence_digest text not null,
  adapter_version text not null,
  normalization_version text not null,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint provider_payment_evidence_provider_reference_key
    unique (payment_provider_id, canonical_reference_fingerprint),
  constraint provider_payment_evidence_receiver_version_shape check (
    (matched_receiver_account_id is null and matched_receiver_account_version is null)
    or (matched_receiver_account_id is not null and matched_receiver_account_version is not null)
  ),
  constraint provider_payment_evidence_receiver_fkey
    foreign key (matched_receiver_account_id, payment_provider_id, matched_receiver_account_version)
    references app.receiver_accounts (id, provider_id, version) on delete restrict,
  constraint provider_payment_evidence_retrieval_after_occurrence
    check (retrieved_at >= occurred_at)
);

create index provider_payment_evidence_provider_occurred_idx
  on app.provider_payment_evidence (payment_provider_id, occurred_at desc);

create function app.reject_provider_payment_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Provider payment evidence is append-only.';
end;
$$;

create trigger provider_payment_evidence_immutable
before update or delete on app.provider_payment_evidence
for each row
execute function app.reject_provider_payment_evidence_mutation();

create table app.deposit_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null,
  deposit_submission_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  outcome app.verification_attempt_outcome not null,
  reason_code text,
  provider_payment_evidence_id uuid references app.provider_payment_evidence (id) on delete restrict,
  adapter_version text not null,
  response_digest text,
  started_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= started_at),
  created_at timestamptz not null default now(),
  constraint deposit_verification_attempts_intent_attempt_key unique (deposit_intent_id, attempt_number),
  constraint deposit_verification_attempts_id_intent_evidence_key
    unique (id, deposit_intent_id, provider_payment_evidence_id),
  constraint deposit_verification_attempts_submission_intent_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions (id, deposit_intent_id) on delete restrict,
  constraint deposit_verification_attempts_verified_evidence_shape
    check (outcome <> 'verified' or provider_payment_evidence_id is not null)
);

create index deposit_verification_attempts_submission_completed_idx
  on app.deposit_verification_attempts (deposit_submission_id, completed_at desc);

create function app.reject_deposit_verification_attempt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Deposit verification attempts are append-only.';
end;
$$;

create trigger deposit_verification_attempts_immutable
before update or delete on app.deposit_verification_attempts
for each row
execute function app.reject_deposit_verification_attempt_mutation();

create table app.deposit_payment_claims (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null unique references app.deposit_intents (id) on delete restrict,
  provider_payment_evidence_id uuid not null unique
    references app.provider_payment_evidence (id) on delete restrict,
  verification_attempt_id uuid not null unique,
  claimed_at timestamptz not null default now(),
  constraint deposit_payment_claims_verification_proof_fkey
    foreign key (
      verification_attempt_id,
      deposit_intent_id,
      provider_payment_evidence_id
    ) references app.deposit_verification_attempts (
      id,
      deposit_intent_id,
      provider_payment_evidence_id
    ) on delete restrict
);

create function app.reject_deposit_payment_claim_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Deposit payment claims are append-only.';
end;
$$;

create trigger deposit_payment_claims_immutable
before update or delete on app.deposit_payment_claims
for each row
execute function app.reject_deposit_payment_claim_mutation();

create function app.require_payment_claim_before_deposit_verified()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.status = 'verified'
    and old.status <> 'verified'
    and not exists (
      select 1
      from app.deposit_payment_claims payment_claim
      where payment_claim.deposit_intent_id = old.id
    ) then
    raise exception 'A deposit cannot become verified without a payment claim.';
  end if;

  return new;
end;
$$;

create trigger deposit_intents_require_payment_claim_before_verified
before update of status on app.deposit_intents
for each row
execute function app.require_payment_claim_before_deposit_verified();

create table app.deposit_review_cases (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  review_kind app.review_kind not null,
  status app.review_status not null default 'open',
  reason_code text not null,
  assigned_admin_id uuid references app.admin_users (id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_review_cases_resolution_shape check (
    (status in ('resolved', 'cancelled')) = (resolved_at is not null)
  ),
  constraint deposit_review_cases_assignment_shape check (
    status <> 'assigned' or assigned_admin_id is not null
  ),
  constraint deposit_review_cases_resolution_code_shape check (
    (status in ('resolved', 'cancelled')) = (coalesce(btrim(resolution_code), '') <> '')
  )
);

create unique index deposit_review_cases_one_open_stage_idx
  on app.deposit_review_cases (deposit_intent_id, review_kind)
  where status in ('open', 'assigned');
create index deposit_review_cases_status_opened_idx
  on app.deposit_review_cases (status, opened_at)
  where status in ('open', 'assigned');
create index deposit_review_cases_assigned_admin_idx
  on app.deposit_review_cases (assigned_admin_id)
  where assigned_admin_id is not null;

create function app.enforce_deposit_review_initial_state()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status <> 'open'
    or new.assigned_admin_id is not null
    or new.resolved_at is not null
    or new.resolution_code is not null then
    raise exception 'A deposit review case must begin open and unassigned.';
  end if;

  return new;
end;
$$;

create trigger deposit_review_cases_enforce_initial_state
before insert on app.deposit_review_cases
for each row
execute function app.enforce_deposit_review_initial_state();

create function app.enforce_deposit_review_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.deposit_intent_id is distinct from old.deposit_intent_id
    or new.review_kind is distinct from old.review_kind
    or new.reason_code is distinct from old.reason_code
    or new.opened_at is distinct from old.opened_at then
    raise exception 'Deposit review case identity is immutable.';
  end if;

  if old.status in ('resolved', 'cancelled') then
    raise exception 'A resolved or cancelled deposit review case cannot change.';
  end if;

  if new.status = 'open' and new.assigned_admin_id is not null then
    raise exception 'An open review case cannot retain an administrator assignment.';
  elsif new.status = 'assigned' and new.assigned_admin_id is null then
    raise exception 'An assigned review case requires an administrator.';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'open' and new.status in ('assigned', 'resolved', 'cancelled'))
    or (old.status = 'assigned' and new.status in ('open', 'resolved', 'cancelled'))
  ) then
    raise exception 'Invalid deposit review status transition from % to %.', old.status, new.status;
  end if;

  if new.status in ('resolved', 'cancelled') then
    if coalesce(btrim(new.resolution_code), '') = '' then
      raise exception 'A resolved or cancelled review case requires a resolution code.';
    end if;

    new.resolved_at := now();
  elsif new.resolved_at is not null then
    raise exception 'Only a resolved or cancelled review case may have resolved_at.';
  end if;

  return new;
end;
$$;

create trigger deposit_review_cases_enforce_transition
before update on app.deposit_review_cases
for each row
execute function app.enforce_deposit_review_transition();

create trigger deposit_review_cases_set_updated_at
before update on app.deposit_review_cases
for each row
execute function app.set_updated_at();

create trigger deposit_review_cases_no_delete
before delete on app.deposit_review_cases
for each row
execute function app.reject_deposit_ledger_delete();

create table app.deposit_jobs (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  deposit_submission_id uuid,
  job_kind app.deposit_job_kind not null,
  status app.deposit_job_status not null default 'queued',
  job_key text not null unique check (job_key = btrim(job_key) and job_key <> ''),
  payload jsonb not null default '{}'::jsonb check (payload = '{}'::jsonb),
  priority smallint not null default 0,
  run_after timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 100),
  lease_token uuid,
  leased_by text,
  lease_expires_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_jobs_submission_intent_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions (id, deposit_intent_id) on delete restrict,
  constraint deposit_jobs_lease_shape check (
    (status = 'leased'
      and lease_token is not null
      and coalesce(btrim(leased_by), '') <> ''
      and lease_expires_at is not null)
    or (status <> 'leased'
      and lease_token is null
      and leased_by is null
      and lease_expires_at is null)
  ),
  constraint deposit_jobs_terminal_completion_shape check (
    (status in ('succeeded', 'dead', 'cancelled')) = (completed_at is not null)
  )
);

create index deposit_jobs_claimable_idx
  on app.deposit_jobs (run_after, priority desc, created_at)
  where status in ('queued', 'retry_wait');
create index deposit_jobs_leased_expiry_idx
  on app.deposit_jobs (lease_expires_at)
  where status = 'leased';
create index deposit_jobs_intent_created_idx
  on app.deposit_jobs (deposit_intent_id, created_at desc);

create function app.enforce_deposit_job_initial_state()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status <> 'queued'
    or new.attempt_count <> 0
    or new.lease_token is not null
    or new.leased_by is not null
    or new.lease_expires_at is not null
    or new.last_error_code is not null
    or new.completed_at is not null then
    raise exception 'A deposit job must begin queued with no lease, attempt, error, or completion state.';
  end if;

  return new;
end;
$$;

create trigger deposit_jobs_enforce_initial_state
before insert on app.deposit_jobs
for each row
execute function app.enforce_deposit_job_initial_state();

create function app.enforce_deposit_job_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.deposit_intent_id is distinct from old.deposit_intent_id
    or new.deposit_submission_id is distinct from old.deposit_submission_id
    or new.job_kind is distinct from old.job_kind
    or new.job_key is distinct from old.job_key
    or new.payload is distinct from old.payload
    or new.priority is distinct from old.priority
    or new.max_attempts is distinct from old.max_attempts
    or new.created_at is distinct from old.created_at then
    raise exception 'Deposit job identity and payload are immutable.';
  end if;

  if new.status = old.status then
    if new.attempt_count is distinct from old.attempt_count
      or new.run_after is distinct from old.run_after
      or new.completed_at is distinct from old.completed_at then
      raise exception 'A deposit job cannot change attempts, schedule, or completion without a state transition.';
    end if;

    if old.status = 'leased'
      and (new.lease_token is distinct from old.lease_token
        or new.leased_by is distinct from old.leased_by) then
      raise exception 'A leased deposit job cannot be retargeted to another lease token or worker.';
    end if;

    return new;
  end if;

  if not (
    (old.status in ('queued', 'retry_wait') and new.status in ('leased', 'cancelled'))
    or (old.status = 'leased' and new.status in ('retry_wait', 'succeeded', 'dead', 'cancelled'))
  ) then
    raise exception 'Invalid deposit job status transition from % to %.', old.status, new.status;
  end if;

  if new.status = 'leased' then
    if new.attempt_count <> old.attempt_count + 1 then
      raise exception 'Leasing a deposit job must increment its attempt count exactly once.';
    end if;
  elsif new.attempt_count <> old.attempt_count then
    raise exception 'Only leasing a deposit job may change its attempt count.';
  end if;

  if not (old.status = 'leased' and new.status = 'retry_wait')
    and new.run_after is distinct from old.run_after then
    raise exception 'Only a retry transition may change a deposit job schedule.';
  end if;

  if new.status in ('succeeded', 'dead', 'cancelled') then
    new.completed_at := clock_timestamp();
  elsif new.completed_at is not null then
    raise exception 'Only terminal deposit jobs may have completed_at.';
  end if;

  if new.status = 'succeeded' and new.last_error_code is not null then
    raise exception 'A succeeded deposit job cannot retain an error code.';
  end if;

  return new;
end;
$$;

create trigger deposit_jobs_enforce_transition
before update on app.deposit_jobs
for each row
execute function app.enforce_deposit_job_transition();

create trigger deposit_jobs_set_updated_at
before update on app.deposit_jobs
for each row
execute function app.set_updated_at();

create trigger deposit_jobs_no_delete
before delete on app.deposit_jobs
for each row
execute function app.reject_deposit_ledger_delete();

create table app.deposit_state_events (
  id bigint generated always as identity primary key,
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  from_status app.deposit_status,
  to_status app.deposit_status not null,
  actor_kind app.actor_kind not null,
  actor_admin_id uuid references app.admin_users (id) on delete restrict,
  actor_customer_id uuid references app.customers (id) on delete restrict,
  reason_code text,
  source_kind text check (source_kind is null or source_kind = lower(btrim(source_kind))),
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint deposit_state_events_deposit_sequence_key unique (deposit_intent_id, sequence_number),
  constraint deposit_state_events_actor_shape check (
    (actor_kind = 'admin' and actor_admin_id is not null and actor_customer_id is null)
    or (actor_kind = 'customer' and actor_customer_id is not null and actor_admin_id is null)
    or (actor_kind in ('system', 'worker') and actor_admin_id is null and actor_customer_id is null)
  )
);

create index deposit_state_events_intent_created_idx
  on app.deposit_state_events (deposit_intent_id, created_at);

create function app.reject_deposit_state_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Deposit state events are append-only.';
end;
$$;

create function app.reject_deposit_state_event_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Deposit state events cannot be truncated.';
end;
$$;

create trigger deposit_state_events_immutable
before update or delete on app.deposit_state_events
for each row
execute function app.reject_deposit_state_event_mutation();

create trigger deposit_state_events_no_truncate
before truncate on app.deposit_state_events
for each statement
execute function app.reject_deposit_state_event_truncate();

create function app.record_deposit_intent_state_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  next_sequence_number integer;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  select coalesce(max(sequence_number), 0) + 1
    into next_sequence_number
    from app.deposit_state_events
    where deposit_intent_id = new.id;

  insert into app.deposit_state_events (
    deposit_intent_id,
    sequence_number,
    from_status,
    to_status,
    actor_kind,
    reason_code,
    source_kind,
    source_id
  )
  values (
    new.id,
    next_sequence_number,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    'system',
    case when tg_op = 'INSERT' then 'intake_created' else 'status_transition' end,
    'deposit_intent',
    new.id
  );

  return new;
end;
$$;

create trigger deposit_intents_record_state_event
after insert or update of status on app.deposit_intents
for each row
execute function app.record_deposit_intent_state_event();

create function app.claim_verified_deposit_payment(
  p_deposit_intent_id uuid,
  p_verification_attempt_id uuid,
  p_provider_payment_evidence_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  deposit_row app.deposit_intents%rowtype;
  attempt_row app.deposit_verification_attempts%rowtype;
  evidence_row app.provider_payment_evidence%rowtype;
  claim_id uuid;
  claim_time timestamptz := clock_timestamp();
begin
  select *
    into deposit_row
    from app.deposit_intents
    where id = p_deposit_intent_id
    for update;

  if not found then
    raise exception 'Deposit intent not found.';
  end if;

  select id
    into claim_id
    from app.deposit_payment_claims
    where deposit_intent_id = deposit_row.id
      and verification_attempt_id = p_verification_attempt_id
      and provider_payment_evidence_id = p_provider_payment_evidence_id;

  if found then
    if deposit_row.status <> 'verified' then
      raise exception 'A matching payment claim exists but the deposit state is inconsistent.';
    end if;

    return claim_id;
  end if;

  if exists (
    select 1
    from app.deposit_payment_claims
    where deposit_intent_id = deposit_row.id
  ) then
    raise exception 'This deposit is already claimed by a different verified payment.';
  end if;

  if deposit_row.status <> 'verification_pending' then
    raise exception 'Automatic payment claims require a verification-pending intent.';
  end if;

  if claim_time > deposit_row.payment_deadline_at then
    raise exception 'An expired deposit requires manual verification review.';
  end if;

  if exists (
    select 1
    from app.deposit_review_cases review_case
    where review_case.deposit_intent_id = deposit_row.id
      and review_case.review_kind = 'verification'
      and review_case.status in ('open', 'assigned')
  ) then
    raise exception 'A deposit with an open verification review cannot be automatically claimed.';
  end if;

  if not exists (
    select 1
    from app.feature_switches
    where feature_key = 'payment_verification'
      and mode in ('dry_run', 'live')
  ) then
    raise exception 'Payment verification is disabled.';
  end if;

  select *
    into attempt_row
    from app.deposit_verification_attempts
    where id = p_verification_attempt_id
    for key share;

  if not found
    or attempt_row.deposit_intent_id <> deposit_row.id
    or attempt_row.outcome <> 'verified'
    or attempt_row.provider_payment_evidence_id is distinct from p_provider_payment_evidence_id then
    raise exception 'The verification attempt does not prove this payment claim.';
  end if;

  select *
    into evidence_row
    from app.provider_payment_evidence
    where id = p_provider_payment_evidence_id
    for key share;

  if not found then
    raise exception 'Provider payment evidence not found.';
  end if;

  if evidence_row.payment_provider_id <> deposit_row.payment_provider_id
    or evidence_row.currency_code <> deposit_row.currency_code
    or evidence_row.amount_minor <> deposit_row.expected_amount_minor
    or evidence_row.matched_receiver_account_id is distinct from deposit_row.receiver_account_id
    or evidence_row.matched_receiver_account_version is distinct from deposit_row.receiver_account_version
    or evidence_row.occurred_at < deposit_row.opened_at
    or evidence_row.occurred_at > deposit_row.payment_deadline_at
    or evidence_row.occurred_at > claim_time + interval '5 minutes' then
    raise exception 'Provider payment evidence does not match the deposit intent snapshot.';
  end if;

  insert into app.deposit_payment_claims (
    deposit_intent_id,
    provider_payment_evidence_id,
    verification_attempt_id
  )
  values (
    deposit_row.id,
    evidence_row.id,
    attempt_row.id
  )
  returning id into claim_id;

  update app.deposit_submissions
  set status = 'verified'
  where id = attempt_row.deposit_submission_id
    and deposit_intent_id = deposit_row.id
    and status = 'verification_enqueued';

  if not found then
    raise exception 'A payment claim requires an enqueued verification submission.';
  end if;

  update app.deposit_intents
  set status = 'verified'
  where id = deposit_row.id;

  return claim_id;
end;
$$;

revoke all on table
  app.customer_platform_players,
  app.player_validation_attempts,
  app.deposit_intents,
  app.deposit_submissions,
  app.deposit_submission_files,
  app.provider_payment_evidence,
  app.deposit_verification_attempts,
  app.deposit_payment_claims,
  app.deposit_review_cases,
  app.deposit_jobs,
  app.deposit_state_events
from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

alter table app.customer_platform_players enable row level security;
alter table app.customer_platform_players force row level security;
alter table app.player_validation_attempts enable row level security;
alter table app.player_validation_attempts force row level security;
alter table app.deposit_intents enable row level security;
alter table app.deposit_intents force row level security;
alter table app.deposit_submissions enable row level security;
alter table app.deposit_submissions force row level security;
alter table app.deposit_submission_files enable row level security;
alter table app.deposit_submission_files force row level security;
alter table app.provider_payment_evidence enable row level security;
alter table app.provider_payment_evidence force row level security;
alter table app.deposit_verification_attempts enable row level security;
alter table app.deposit_verification_attempts force row level security;
alter table app.deposit_payment_claims enable row level security;
alter table app.deposit_payment_claims force row level security;
alter table app.deposit_review_cases enable row level security;
alter table app.deposit_review_cases force row level security;
alter table app.deposit_jobs enable row level security;
alter table app.deposit_jobs force row level security;
alter table app.deposit_state_events enable row level security;
alter table app.deposit_state_events force row level security;

revoke all on function app.enforce_customer_platform_player_binding_immutable() from public;
revoke all on function app.reject_deposit_ledger_delete() from public;
revoke all on function app.enforce_customer_platform_player_validation() from public;
revoke all on function app.populate_deposit_intent_snapshot() from public;
revoke all on function app.enforce_deposit_intent_transition() from public;
revoke all on function app.enforce_deposit_submission_inbound_event_owner() from public;
revoke all on function app.enforce_deposit_submission_transition() from public;
revoke all on function app.populate_deposit_submission_file_retention() from public;
revoke all on function app.enforce_deposit_submission_file_immutable() from public;
revoke all on function app.require_deposit_submission_evidence_before_verification() from public;
revoke all on function app.reject_provider_payment_evidence_mutation() from public;
revoke all on function app.reject_deposit_verification_attempt_mutation() from public;
revoke all on function app.reject_deposit_payment_claim_mutation() from public;
revoke all on function app.require_payment_claim_before_deposit_verified() from public;
revoke all on function app.enforce_deposit_review_initial_state() from public;
revoke all on function app.enforce_deposit_review_transition() from public;
revoke all on function app.enforce_deposit_job_initial_state() from public;
revoke all on function app.enforce_deposit_job_transition() from public;
revoke all on function app.reject_deposit_state_event_mutation() from public;
revoke all on function app.reject_deposit_state_event_truncate() from public;
revoke all on function app.record_deposit_intent_state_event() from public;
revoke all on function app.claim_verified_deposit_payment(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke usage on type
  app.player_validation_status,
  app.deposit_status,
  app.deposit_submission_status,
  app.verification_attempt_outcome,
  app.review_kind,
  app.review_status,
  app.deposit_job_kind,
  app.deposit_job_status,
  app.evidence_file_status,
  app.provider_evidence_source
from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

comment on table app.deposit_intents is
  'Immutable deposit policy and receiver snapshots. Expired payments require verification review, never automatic credit.';
comment on table app.provider_payment_evidence is
  'Authoritative provider facts only. Uploaded receipts and OCR never create this record by themselves.';
comment on table app.deposit_payment_claims is
  'Atomic one-to-one bridge from a verified payment to a deposit intent; prevents double credit.';
comment on table app.deposit_jobs is
  'Durable ID-only work queue. Job payload must not contain transaction references, receipt data, or credentials.';

commit;
