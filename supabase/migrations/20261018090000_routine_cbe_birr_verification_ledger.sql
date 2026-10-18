-- Dormant routine CBE Birr verification ledger.
--
-- CBE Birr receipts are fetched by a server-side verifier rather than an enrolled phone. This
-- migration installs only the private ledger, a CBE-only processing control that starts
-- disabled, and an unprovisioned NOLOGIN verifier role with three guarded functions. It does
-- not grant any existing runtime, change a shared feature switch, settle a payment, enqueue a
-- KemerBet job, or move money. A verified result in this migration is a dry-run record only.
--
-- The shared `cbe_birr_authoritative_verification` switch is deliberately not used: many
-- existing TeleBirr and Companion boundaries require it to remain disabled.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create role fetanagent_routine_cbe_birr_verifier
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2;
create role fetanagent_routine_cbe_birr_verifier_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
grant fetanagent_routine_cbe_birr_verifier
  to fetanagent_routine_cbe_birr_verifier_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $$
begin
  execute pg_catalog.format(
    'revoke all privileges on database %I from fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime',
    pg_catalog.current_database());
end;
$$;
revoke all privileges on schema app
  from fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime;
revoke all privileges on all tables in schema app
  from fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime;
revoke all privileges on all procedures in schema app
  from fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime;

-- One receiver revision has exactly one lookup envelope; expose the pair for a composite key.
alter table app.cbe_birr_receiver_lookup_revisions
  add constraint cbe_birr_receiver_lookup_revision_version_key
  unique (receiver_revision_id, receiver_version);

create table app.routine_cbe_birr_processing_control (
  control_key text primary key check (control_key = 'routine_cbe_birr'),
  -- `live` is intentionally absent until a reviewed settlement boundary exists.
  mode text not null check (mode in ('disabled', 'dry_run')),
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  change_reason text not null check (change_reason in (
    'initial_installation', 'operator_dry_run', 'operator_stop', 'incident_stop'
  ))
);
insert into app.routine_cbe_birr_processing_control (control_key, mode, change_reason)
values ('routine_cbe_birr', 'disabled', 'initial_installation');

create table app.routine_cbe_birr_candidates (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  submitting_customer_id uuid not null,
  origin_identity_id uuid not null,
  origin_channel text not null check (origin_channel = 'telegram'),
  origin_request_key uuid not null check (
    origin_request_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  semantic_input_hmac text not null check (
    semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  platform_id uuid not null,
  player_account_id uuid not null,
  player_deposit_eligibility_decision_id uuid not null,
  payment_provider_id uuid not null,
  provider_code text not null check (provider_code = 'cbe_birr'),
  reference_ciphertext text not null check (
    reference_ciphertext = pg_catalog.btrim(reference_ciphertext)
    and pg_catalog.char_length(reference_ciphertext) between 50 and 512
    and reference_ciphertext
      ~ '^v2\.cbe_birr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
  ),
  reference_fingerprint text not null check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  reference_masked text not null check (reference_masked ~ '^\*{3}[A-Z0-9]{4}$'),
  reference_encryption_key_version smallint not null check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null check (reference_profile_version = 2),
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  submitted_at timestamptz not null,
  -- Settlement is not installed; every candidate is a dry-run observation.
  verification_mode text not null check (verification_mode = 'dry_run'),
  status text not null default 'queued' check (
    status in ('queued', 'leased', 'verified', 'rejected', 'review')
  ),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 6),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_worker_id uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_cbe_birr_candidates_origin_key
    unique (origin_channel, origin_identity_id, origin_request_key),
  constraint routine_cbe_birr_candidates_customer_fkey
    foreign key (submitting_customer_id) references app.customers (id) on delete restrict,
  constraint routine_cbe_birr_candidates_origin_customer_fkey
    foreign key (origin_identity_id, submitting_customer_id)
    references app.customer_identities (id, customer_id) on delete restrict,
  constraint routine_cbe_birr_candidates_platform_fkey
    foreign key (platform_id) references app.platforms (id) on delete restrict,
  constraint routine_cbe_birr_candidates_player_fkey
    foreign key (player_account_id, platform_id)
    references app.customer_platform_players (id, platform_id) on delete restrict,
  constraint routine_cbe_birr_candidates_eligibility_fkey
    foreign key (player_deposit_eligibility_decision_id, player_account_id)
    references app.player_deposit_eligibility_decisions (id, player_account_id) on delete restrict,
  constraint routine_cbe_birr_candidates_provider_fkey
    foreign key (payment_provider_id, provider_code)
    references app.payment_providers (id, code) on delete restrict,
  constraint routine_cbe_birr_candidates_receiver_lookup_fkey
    foreign key (receiver_account_id, receiver_account_version)
    references app.cbe_birr_receiver_lookup_revisions (receiver_revision_id, receiver_version)
    on delete restrict,
  constraint routine_cbe_birr_candidates_lease_shape check (
    (status = 'queued' and lease_token is null and lease_worker_id is null
      and lease_expires_at is null and completed_at is null)
    or (status = 'leased' and lease_token is not null and lease_worker_id is not null
      and lease_expires_at is not null and completed_at is null)
    or (status in ('verified', 'rejected', 'review') and lease_token is not null
      and lease_expires_at is null and completed_at is not null
      and completed_at >= submitted_at)
  ),
  constraint routine_cbe_birr_candidates_schedule_shape check (
    next_attempt_at >= submitted_at and created_at >= submitted_at
  )
);

create index routine_cbe_birr_candidates_pending_idx
  on app.routine_cbe_birr_candidates (next_attempt_at, created_at)
  where status in ('queued', 'leased');
create index routine_cbe_birr_candidates_reference_idx
  on app.routine_cbe_birr_candidates (reference_fingerprint);
create index routine_cbe_birr_candidates_identity_time_idx
  on app.routine_cbe_birr_candidates (origin_identity_id, submitting_customer_id, submitted_at);
create index routine_cbe_birr_candidates_customer_idx
  on app.routine_cbe_birr_candidates (submitting_customer_id);
create index routine_cbe_birr_candidates_platform_idx
  on app.routine_cbe_birr_candidates (platform_id);
create index routine_cbe_birr_candidates_player_idx
  on app.routine_cbe_birr_candidates (player_account_id, platform_id);
create index routine_cbe_birr_candidates_eligibility_idx
  on app.routine_cbe_birr_candidates (player_deposit_eligibility_decision_id, player_account_id);
create index routine_cbe_birr_candidates_provider_idx
  on app.routine_cbe_birr_candidates (payment_provider_id, provider_code);
create index routine_cbe_birr_candidates_receiver_idx
  on app.routine_cbe_birr_candidates (receiver_account_id, receiver_account_version);

create table app.routine_cbe_birr_verification_results (
  candidate_id uuid primary key,
  outcome text not null check (outcome in ('verified', 'rejected', 'review')),
  reason_code text not null check (reason_code in (
    'exact_receipt',
    'reference_mismatch', 'receiver_mismatch', 'currency_not_etb',
    'duplicate_reference', 'amount_out_of_range', 'receipt_outside_freshness_window',
    'receiver_revision_inactive', 'receipt_status_unsupported', 'transaction_type_unsupported',
    'fee_arithmetic_mismatch', 'receiver_identity_unavailable', 'pdf_unreadable',
    'pdf_layout_drift', 'receipt_unavailable', 'provider_unavailable', 'parser_unavailable',
    'verification_window_expired'
  )),
  verification_mode text not null check (verification_mode = 'dry_run'),
  amount_minor bigint check (amount_minor is null or amount_minor between 1 and 1000000000),
  currency_code text check (currency_code is null or currency_code = 'ETB'),
  occurred_at timestamptz,
  occurred_at_precision text check (
    occurred_at_precision is null or occurred_at_precision in ('second', 'minute')
  ),
  document_digest text check (document_digest is null or document_digest ~ '^sha256:[0-9a-f]{64}$'),
  document_topology text check (document_topology is null or document_topology in (
    'cbe_birr_vat_customer_receipt_v1', 'cbe_birr_vat_customer_receipt_credit_account_v2'
  )),
  parser_version smallint check (parser_version is null or parser_version = 2),
  attempt_number smallint not null check (attempt_number between 0 and 6),
  lease_token uuid not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_cbe_birr_verification_results_candidate_fkey
    foreign key (candidate_id) references app.routine_cbe_birr_candidates (id) on delete restrict,
  constraint routine_cbe_birr_verification_results_outcome_reason check (
    (outcome = 'verified') = (reason_code = 'exact_receipt')
    and (outcome <> 'rejected'
      or reason_code in ('reference_mismatch', 'receiver_mismatch', 'currency_not_etb'))
  ),
  constraint routine_cbe_birr_verification_results_verified_facts check (
    outcome <> 'verified' or (
      amount_minor between 2500 and 2500000 and currency_code = 'ETB'
      and occurred_at is not null and occurred_at_precision is not null
      and document_digest is not null and document_topology is not null
      and parser_version = 2
    )
  ),
  constraint routine_cbe_birr_verification_results_fact_pairs check (
    (occurred_at is null) = (occurred_at_precision is null)
    and (amount_minor is null) = (currency_code is null)
  )
);

create function app.reject_routine_cbe_birr_ledger_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'The routine CBE Birr ledger record is immutable.';
end;
$$;
alter function app.reject_routine_cbe_birr_ledger_mutation() owner to postgres;
revoke all on function app.reject_routine_cbe_birr_ledger_mutation()
  from public, anon, authenticated, service_role;

-- A candidate's identity, destination, protected reference, and receiver snapshot never change.
-- Only the lease and terminal-state columns may advance.
create function app.reject_routine_cbe_birr_candidate_identity_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.submitting_customer_id is distinct from old.submitting_customer_id
    or new.origin_identity_id is distinct from old.origin_identity_id
    or new.origin_channel is distinct from old.origin_channel
    or new.origin_request_key is distinct from old.origin_request_key
    or new.semantic_input_hmac is distinct from old.semantic_input_hmac
    or new.platform_id is distinct from old.platform_id
    or new.player_account_id is distinct from old.player_account_id
    or new.player_deposit_eligibility_decision_id
      is distinct from old.player_deposit_eligibility_decision_id
    or new.payment_provider_id is distinct from old.payment_provider_id
    or new.provider_code is distinct from old.provider_code
    or new.reference_ciphertext is distinct from old.reference_ciphertext
    or new.reference_fingerprint is distinct from old.reference_fingerprint
    or new.reference_masked is distinct from old.reference_masked
    or new.reference_encryption_key_version is distinct from old.reference_encryption_key_version
    or new.reference_profile_version is distinct from old.reference_profile_version
    or new.receiver_account_id is distinct from old.receiver_account_id
    or new.receiver_account_version is distinct from old.receiver_account_version
    or new.submitted_at is distinct from old.submitted_at
    or new.verification_mode is distinct from old.verification_mode
    or new.created_at is distinct from old.created_at
    or old.status in ('verified', 'rejected', 'review')
    or new.attempt_count < old.attempt_count then
    raise exception 'The routine CBE Birr candidate identity is immutable.';
  end if;
  return new;
end;
$$;
alter function app.reject_routine_cbe_birr_candidate_identity_change() owner to postgres;
revoke all on function app.reject_routine_cbe_birr_candidate_identity_change()
  from public, anon, authenticated, service_role;

create trigger routine_cbe_birr_candidates_identity_immutable
before update on app.routine_cbe_birr_candidates
for each row execute function app.reject_routine_cbe_birr_candidate_identity_change();
create trigger routine_cbe_birr_candidates_no_delete
before delete on app.routine_cbe_birr_candidates
for each row execute function app.reject_routine_cbe_birr_ledger_mutation();
create trigger routine_cbe_birr_candidates_no_truncate
before truncate on app.routine_cbe_birr_candidates
for each statement execute function app.reject_routine_cbe_birr_ledger_mutation();
create trigger routine_cbe_birr_verification_results_immutable
before update or delete on app.routine_cbe_birr_verification_results
for each row execute function app.reject_routine_cbe_birr_ledger_mutation();
create trigger routine_cbe_birr_verification_results_no_truncate
before truncate on app.routine_cbe_birr_verification_results
for each statement execute function app.reject_routine_cbe_birr_ledger_mutation();
create trigger routine_cbe_birr_processing_control_no_delete
before delete on app.routine_cbe_birr_processing_control
for each row execute function app.reject_routine_cbe_birr_ledger_mutation();
create trigger routine_cbe_birr_processing_control_no_truncate
before truncate on app.routine_cbe_birr_processing_control
for each statement execute function app.reject_routine_cbe_birr_ledger_mutation();

alter table app.routine_cbe_birr_processing_control enable row level security;
alter table app.routine_cbe_birr_processing_control force row level security;
alter table app.routine_cbe_birr_candidates enable row level security;
alter table app.routine_cbe_birr_candidates force row level security;
alter table app.routine_cbe_birr_verification_results enable row level security;
alter table app.routine_cbe_birr_verification_results force row level security;
revoke all on app.routine_cbe_birr_processing_control, app.routine_cbe_birr_candidates,
  app.routine_cbe_birr_verification_results
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_routine_cbe_birr_verifier, fetanagent_routine_cbe_birr_verifier_runtime;

create function app.routine_cbe_birr_verifier_session_allowed()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_allowed boolean;
begin
  if session_user = 'postgres' then return true; end if;
  if session_user <> 'fetanagent_routine_cbe_birr_verifier_runtime' then
    return false;
  end if;
  select runtime.rolcanlogin and not runtime.rolinherit
         and not runtime.rolsuper and not runtime.rolcreatedb
         and not runtime.rolcreaterole and not runtime.rolreplication
         and not runtime.rolbypassrls and runtime.rolconnlimit = 1
         and runtime.rolvaliduntil is not null
         and runtime.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
         and runtime.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '30 days 5 minutes'
         and pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_cbe_birr_verifier', 'USAGE')
         and not pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_cbe_birr_verifier', 'SET')
         and exists (
           select 1 from pg_catalog.pg_roles group_role
            where group_role.rolname = 'fetanagent_routine_cbe_birr_verifier'
              and not group_role.rolcanlogin and not group_role.rolinherit
              and not group_role.rolsuper and not group_role.rolcreatedb
              and not group_role.rolcreaterole and not group_role.rolreplication
              and not group_role.rolbypassrls and group_role.rolconnlimit = 2
              and not exists (
                select 1 from pg_catalog.pg_auth_members upstream
                 where upstream.member = group_role.oid))
         and (
           select pg_catalog.count(*) = 1
                  and pg_catalog.bool_and(
                    granted.rolname = 'fetanagent_routine_cbe_birr_verifier'
                    and membership.inherit_option
                    and not membership.set_option
                    and not membership.admin_option)
             from pg_catalog.pg_auth_members membership
             join pg_catalog.pg_roles granted on granted.oid = membership.roleid
            where membership.member = runtime.oid)
    into v_allowed
    from pg_catalog.pg_roles runtime
   where runtime.rolname = 'fetanagent_routine_cbe_birr_verifier_runtime';
  return coalesce(v_allowed, false);
end;
$$;
alter function app.routine_cbe_birr_verifier_session_allowed() owner to postgres;
revoke all on function app.routine_cbe_birr_verifier_session_allowed()
  from public, anon, authenticated, service_role;

-- Operator-only mode change. The Owner dashboard control is a later, separately reviewed
-- change; until then only a protected administrator session can start or stop the dry run.
create function app.set_routine_cbe_birr_processing_mode(p_mode text, p_reason text)
returns table (mode text, changed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_control app.routine_cbe_birr_processing_control%rowtype;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the database administrator may change routine CBE Birr processing.';
  end if;
  if p_mode is null or p_reason is null
    or not ((p_mode = 'dry_run' and p_reason = 'operator_dry_run')
      or (p_mode = 'disabled' and p_reason in ('operator_stop', 'incident_stop'))) then
    raise exception 'The routine CBE Birr processing mode request is invalid.';
  end if;
  select control.* into v_control
    from app.routine_cbe_birr_processing_control control
   where control.control_key = 'routine_cbe_birr' for update;
  if v_control.control_key is null then
    raise exception 'The routine CBE Birr processing control is unavailable.';
  end if;
  if v_control.mode = p_mode then
    return query select v_control.mode, false;
    return;
  end if;
  update app.routine_cbe_birr_processing_control control
     set mode = p_mode, change_reason = p_reason,
         changed_at = pg_catalog.clock_timestamp()
   where control.control_key = 'routine_cbe_birr';
  insert into app.audit_events (actor_kind, actor_label, action, resource_type, metadata)
  values ('system', 'production-database-administrator',
    'routine_cbe_birr.processing_mode_changed', 'routine_cbe_birr_processing_control',
    pg_catalog.jsonb_build_object('from_mode', v_control.mode, 'to_mode', p_mode,
      'reason', p_reason));
  return query select p_mode, true;
end;
$$;
alter function app.set_routine_cbe_birr_processing_mode(text, text) owner to postgres;
revoke all on function app.set_routine_cbe_birr_processing_mode(text, text)
  from public, anon, authenticated, service_role;

-- Telegram intake. It is intentionally granted to no runtime in this migration: the
-- Player-action catalog preflight must change in the same release that grants it.
create function app.capture_routine_cbe_birr_candidate(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_provider_code text,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_reference_profile_version smallint,
  p_semantic_input_hmac text
)
returns table (
  candidate_id uuid,
  provider_code text,
  candidate_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_mode text;
  v_identity_id uuid;
  v_customer_id uuid;
  v_processed_at timestamptz;
  v_identity_status app.record_status;
  v_customer_status app.record_status;
  v_conversation_id uuid;
  v_existing app.routine_cbe_birr_candidates%rowtype;
  v_existing_player_id text;
  v_platform_id uuid;
  v_player_account_id uuid;
  v_eligibility_id uuid;
  v_provider_id uuid;
  v_resolved_provider_code text;
  v_beneficiary_id uuid;
  v_receiver_id uuid;
  v_receiver_version integer;
  v_captured_at timestamptz;
  v_inserted app.routine_cbe_birr_candidates%rowtype;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'The routine CBE Birr candidate boundary is unavailable.';
  end if;

  select control.mode into v_mode
    from app.routine_cbe_birr_processing_control control
   where control.control_key = 'routine_cbe_birr' for share;
  if v_mode is distinct from 'dry_run' then
    raise exception 'Routine CBE Birr intake is unavailable.';
  end if;

  if p_origin_inbound_event_id is null
    or p_origin_inbound_event_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_provider_code is distinct from 'cbe_birr'
    or p_reference_key_version is distinct from 2
    or p_reference_profile_version is distinct from 2
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> pg_catalog.btrim(p_reference_ciphertext)
    or p_reference_ciphertext
      !~ '^v2\.cbe_birr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The routine CBE Birr candidate request is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram' for update;
  if v_identity_id is null then
    raise exception 'The routine CBE Birr Telegram event is unavailable.';
  end if;
  select identity.customer_id, identity.status, customer.status, conversation.id
    into v_customer_id, v_identity_status, v_customer_status, v_conversation_id
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where identity.id = v_identity_id
     and identity.identity_kind = 'telegram'
   for update of identity, customer, telegram_identity, conversation;
  if v_customer_id is null or v_identity_status <> 'active'
    or v_customer_status <> 'active' then
    raise exception 'The routine CBE Birr Telegram customer is unavailable.';
  end if;

  select candidate.* into v_existing
    from app.routine_cbe_birr_candidates candidate
   where candidate.origin_channel = 'telegram'
     and candidate.origin_identity_id = v_identity_id
     and candidate.origin_request_key = p_origin_inbound_event_id;
  if v_existing.id is not null then
    select player.player_id into v_existing_player_id
      from app.customer_platform_players player
     where player.id = v_existing.player_account_id;
    if v_existing.submitting_customer_id is distinct from v_customer_id
      or v_existing.semantic_input_hmac is distinct from p_semantic_input_hmac
      or v_existing.reference_fingerprint is distinct from p_reference_fingerprint
      or v_existing.reference_masked is distinct from p_reference_masked
      or v_existing.reference_encryption_key_version is distinct from p_reference_key_version
      or v_existing.reference_profile_version is distinct from p_reference_profile_version
      or v_existing.submitted_at is distinct from v_processed_at
      or v_existing_player_id is distinct from p_player_id then
      raise exception 'The routine CBE Birr candidate replay conflicts.';
    end if;
    return query select v_existing.id, 'cbe_birr'::text, v_existing.status,
                        v_existing.submitted_at, true;
    return;
  end if;

  if v_processed_at is not null
    or exists (select 1 from app.inbound_event_consumptions consumption
      where consumption.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_live_deposit_request_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_dry_run_deposit_proof_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_live_telebirr_proof_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.telegram_telebirr_destination_receipts receipt
      where receipt.origin_inbound_event_id = p_origin_inbound_event_id)
    or exists (select 1 from app.routine_telebirr_untrusted_proof_requests proof
      where proof.origin_channel = 'telegram'
        and proof.origin_request_key = p_origin_inbound_event_id) then
    raise exception 'The routine CBE Birr Telegram event already has another action.';
  end if;

  -- Unlimited successful deposits do not mean unlimited lookups: bound probing and keep at
  -- most three candidates waiting for verification per Telegram identity.
  if (
    select pg_catalog.count(*) from app.routine_cbe_birr_candidates candidate
     where candidate.origin_identity_id = v_identity_id
       and candidate.submitted_at > pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 5 or (
    select pg_catalog.count(*) from app.routine_cbe_birr_candidates candidate
     where candidate.origin_identity_id = v_identity_id
       and candidate.submitted_at > pg_catalog.clock_timestamp() - interval '1 hour'
  ) >= 60 or (
    select pg_catalog.count(*) from app.routine_cbe_birr_candidates candidate
     where candidate.origin_identity_id = v_identity_id
       and candidate.status in ('queued', 'leased')
  ) >= 3 then
    raise exception 'Routine CBE Birr intake is temporarily unavailable.';
  end if;

  select boundary.platform_id, boundary.player_account_id,
         boundary.player_deposit_eligibility_decision_id,
         boundary.payment_provider_id, boundary.normalized_provider_code
    into v_platform_id, v_player_account_id, v_eligibility_id,
         v_provider_id, v_resolved_provider_code
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'cbe_birr') boundary;
  if v_player_account_id is null or v_resolved_provider_code is distinct from 'cbe_birr' then
    raise exception 'The routine CBE Birr destination is unavailable.';
  end if;
  select player.customer_id into v_beneficiary_id
    from app.customer_platform_players player
    join app.customers beneficiary on beneficiary.id = player.customer_id
   where player.id = v_player_account_id and beneficiary.status = 'active'
   for share of player, beneficiary;
  if v_beneficiary_id is null then
    raise exception 'The routine CBE Birr Player beneficiary is unavailable.';
  end if;

  -- Only a lookup-protected v2 receiver revision can be verified by the server. A legacy
  -- v1-only receiver needs a fresh Owner protection-upgrade revision first.
  select receiver.id, receiver.version into v_receiver_id, v_receiver_version
    from app.receiver_accounts receiver
    join app.cbe_birr_receiver_lookup_revisions lookup
      on lookup.receiver_revision_id = receiver.id
     and lookup.receiver_version = receiver.version
     and lookup.rotation_request_id = receiver.rotation_request_id
   where receiver.provider_id = v_provider_id
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= pg_catalog.clock_timestamp()
     and receiver.account_holder_name = pg_catalog.btrim(receiver.account_holder_name)
     and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
     and receiver.account_holder_name !~ '[[:cntrl:]]'
     and receiver.account_reference_ciphertext
       ~ '^receiver-v1[.]cbe_birr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{16}$'
     and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
     and receiver.account_reference_masked ~ '^\*{3}[0-9]{4}$'
     and receiver.account_reference_masked = lookup.lookup_masked
     and receiver.protection_profile_version = 1
     and receiver.encryption_key_version = 1
     and receiver.fingerprint_key_version = 1
   for share of receiver;
  if v_receiver_id is null then
    raise exception 'The routine CBE Birr receiving account is unavailable.';
  end if;

  v_captured_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  insert into app.routine_cbe_birr_candidates (
    submitting_customer_id, origin_identity_id, origin_channel, origin_request_key,
    semantic_input_hmac, platform_id, player_account_id,
    player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
    reference_ciphertext, reference_fingerprint, reference_masked,
    reference_encryption_key_version, reference_profile_version,
    receiver_account_id, receiver_account_version, submitted_at,
    verification_mode, next_attempt_at, created_at
  ) values (
    v_customer_id, v_identity_id, 'telegram', p_origin_inbound_event_id,
    p_semantic_input_hmac, v_platform_id, v_player_account_id,
    v_eligibility_id, v_provider_id, 'cbe_birr',
    p_reference_ciphertext, p_reference_fingerprint, p_reference_masked,
    p_reference_key_version, p_reference_profile_version,
    v_receiver_id, v_receiver_version, v_captured_at,
    'dry_run', v_captured_at, v_captured_at
  ) returning * into v_inserted;
  update app.inbound_events inbound_event
     set processed_at = v_captured_at, processing_error_code = null
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'The routine CBE Birr Telegram event could not be marked handled.';
  end if;
  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', v_customer_id, 'deposit.routine_cbe_birr_candidate_received',
    'routine_cbe_birr_candidate', v_inserted.id,
    pg_catalog.jsonb_build_object('channel', 'telegram', 'provider_code', 'cbe_birr',
      'verification_mode', 'dry_run', 'verification_performed', false)
  );
  return query select v_inserted.id, 'cbe_birr'::text, v_inserted.status,
                      v_inserted.submitted_at, false;
end;
$$;
alter function app.capture_routine_cbe_birr_candidate(
  uuid, text, text, text, text, text, smallint, smallint, text
) owner to postgres;
revoke all on function app.capture_routine_cbe_birr_candidate(
  uuid, text, text, text, text, text, smallint, smallint, text
) from public, anon, authenticated, service_role;

-- Terminal review without provider facts. Internal only; never granted.
create function app.close_routine_cbe_birr_candidate_for_review(
  p_candidate_id uuid,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate app.routine_cbe_birr_candidates%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_reason_code not in (
    'verification_window_expired', 'provider_unavailable', 'receipt_unavailable',
    'parser_unavailable'
  ) then
    raise exception 'The routine CBE Birr review reason is invalid.';
  end if;
  select candidate.* into v_candidate
    from app.routine_cbe_birr_candidates candidate
   where candidate.id = p_candidate_id for update;
  if v_candidate.id is null or v_candidate.status not in ('queued', 'leased') then
    raise exception 'The routine CBE Birr candidate is not open.';
  end if;
  update app.routine_cbe_birr_candidates candidate
     set status = 'review',
         lease_token = coalesce(v_candidate.lease_token, pg_catalog.gen_random_uuid()),
         lease_worker_id = null,
         lease_expires_at = null,
         completed_at = v_now
   where candidate.id = p_candidate_id
   returning * into v_candidate;
  insert into app.routine_cbe_birr_verification_results (
    candidate_id, outcome, reason_code, verification_mode, attempt_number, lease_token,
    recorded_at
  ) values (
    v_candidate.id, 'review', p_reason_code, v_candidate.verification_mode,
    v_candidate.attempt_count, v_candidate.lease_token, v_now
  );
  insert into app.audit_events (actor_kind, actor_label, action, resource_type, resource_id, metadata)
  values ('worker', 'routine-cbe-birr-verifier', 'routine_cbe_birr.verification_recorded',
    'routine_cbe_birr_candidate', v_candidate.id,
    pg_catalog.jsonb_build_object('outcome', 'review', 'reason_code', p_reason_code,
      'verification_mode', v_candidate.verification_mode));
end;
$$;
alter function app.close_routine_cbe_birr_candidate_for_review(uuid, text) owner to postgres;
revoke all on function app.close_routine_cbe_birr_candidate_for_review(uuid, text)
  from public, anon, authenticated, service_role;

create function app.lease_routine_cbe_birr_verification(p_worker_id uuid)
returns table (
  candidate_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_number smallint,
  reference_ciphertext text,
  reference_encryption_key_version smallint,
  reference_profile_version smallint,
  receiver_revision_id uuid,
  receiver_version integer,
  receiver_lookup_ciphertext text,
  receiver_lookup_encryption_key_version smallint,
  submitted_at timestamptz,
  verification_mode text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_mode text;
  v_now timestamptz;
  v_expired uuid;
  v_candidate app.routine_cbe_birr_candidates%rowtype;
  v_lookup app.cbe_birr_receiver_lookup_revisions%rowtype;
begin
  if not app.routine_cbe_birr_verifier_session_allowed() then
    raise exception using errcode = '42501',
      message = 'The routine CBE Birr verifier is unavailable.';
  end if;
  if p_worker_id is null or p_worker_id::text !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The routine CBE Birr verifier identity is invalid.';
  end if;
  select control.mode into v_mode
    from app.routine_cbe_birr_processing_control control
   where control.control_key = 'routine_cbe_birr' for share;
  if v_mode is distinct from 'dry_run' then
    return;
  end if;
  v_now := pg_catalog.clock_timestamp();

  -- Close a bounded batch of candidates that can no longer be checked inside the one-hour
  -- verification window. They need an Owner decision, never a late automatic credit.
  for v_expired in
    select candidate.id from app.routine_cbe_birr_candidates candidate
     where candidate.status in ('queued', 'leased')
       and candidate.submitted_at <= v_now - interval '1 hour'
       and (candidate.status = 'queued' or candidate.lease_expires_at <= v_now)
     order by candidate.submitted_at, candidate.id
     limit 20
     for update skip locked
  loop
    perform app.close_routine_cbe_birr_candidate_for_review(
      v_expired, 'verification_window_expired');
  end loop;

  select candidate.* into v_candidate
    from app.routine_cbe_birr_candidates candidate
   where candidate.verification_mode = v_mode
     and candidate.submitted_at > v_now - interval '1 hour'
     and ((candidate.status = 'queued' and candidate.next_attempt_at <= v_now)
       or (candidate.status = 'leased' and candidate.lease_expires_at <= v_now))
   order by candidate.next_attempt_at, candidate.created_at, candidate.id
   limit 1
   for update skip locked;
  if v_candidate.id is null then
    return;
  end if;
  if v_candidate.attempt_count >= 6 then
    -- An abandoned lease consumed the final attempt; do not start a seventh provider request.
    perform app.close_routine_cbe_birr_candidate_for_review(v_candidate.id, 'provider_unavailable');
    return;
  end if;

  select lookup.* into v_lookup
    from app.cbe_birr_receiver_lookup_revisions lookup
   where lookup.receiver_revision_id = v_candidate.receiver_account_id
     and lookup.receiver_version = v_candidate.receiver_account_version;
  if v_lookup.receiver_revision_id is null then
    raise exception 'The routine CBE Birr receiver lookup material is unavailable.';
  end if;

  update app.routine_cbe_birr_candidates candidate
     set status = 'leased',
         attempt_count = v_candidate.attempt_count + 1,
         lease_token = pg_catalog.gen_random_uuid(),
         lease_worker_id = p_worker_id,
         lease_expires_at = v_now + interval '60 seconds'
   where candidate.id = v_candidate.id
   returning * into v_candidate;

  return query select v_candidate.id, v_candidate.lease_token, v_candidate.lease_expires_at,
    v_candidate.attempt_count, v_candidate.reference_ciphertext,
    v_candidate.reference_encryption_key_version, v_candidate.reference_profile_version,
    v_lookup.receiver_revision_id, v_lookup.receiver_version, v_lookup.lookup_ciphertext,
    v_lookup.encryption_key_version, v_candidate.submitted_at, v_candidate.verification_mode;
end;
$$;
alter function app.lease_routine_cbe_birr_verification(uuid) owner to postgres;
revoke all on function app.lease_routine_cbe_birr_verification(uuid)
  from public, anon, authenticated, service_role;

create function app.record_routine_cbe_birr_verification(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_reason_code text,
  p_amount_minor bigint,
  p_currency_code text,
  p_occurred_at timestamptz,
  p_occurred_at_precision text,
  p_document_digest text,
  p_document_topology text,
  p_parser_version smallint
)
returns table (
  candidate_id uuid,
  outcome text,
  reason_code text,
  verification_mode text,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate app.routine_cbe_birr_candidates%rowtype;
  v_existing app.routine_cbe_birr_verification_results%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_outcome text := p_outcome;
  v_reason text := p_reason_code;
  v_span interval;
  v_now timestamptz;
begin
  if not app.routine_cbe_birr_verifier_session_allowed() then
    raise exception using errcode = '42501',
      message = 'The routine CBE Birr verifier is unavailable.';
  end if;
  if p_candidate_id is null or p_lease_token is null
    or p_outcome is null or p_outcome not in ('verified', 'rejected', 'review')
    or p_reason_code is null
    or (p_outcome = 'verified') <> (p_reason_code = 'exact_receipt')
    or (p_outcome = 'rejected' and p_reason_code not in (
      'reference_mismatch', 'receiver_mismatch', 'currency_not_etb'))
    or (p_outcome = 'review' and p_reason_code not in (
      'duplicate_reference', 'amount_out_of_range', 'receipt_outside_freshness_window',
      'receiver_revision_inactive', 'receipt_status_unsupported',
      'transaction_type_unsupported', 'fee_arithmetic_mismatch',
      'receiver_identity_unavailable', 'pdf_unreadable', 'pdf_layout_drift'))
    or (p_amount_minor is null) <> (p_currency_code is null)
    or (p_occurred_at is null) <> (p_occurred_at_precision is null)
    or (p_amount_minor is not null and p_amount_minor not between 1 and 1000000000)
    or (p_currency_code is not null and p_currency_code <> 'ETB'
      and not (p_outcome = 'rejected' and p_reason_code = 'currency_not_etb'))
    or (p_occurred_at_precision is not null
      and p_occurred_at_precision not in ('second', 'minute'))
    or (p_document_digest is not null and p_document_digest !~ '^sha256:[0-9a-f]{64}$')
    or (p_document_topology is not null and p_document_topology not in (
      'cbe_birr_vat_customer_receipt_v1', 'cbe_birr_vat_customer_receipt_credit_account_v2'))
    or (p_parser_version is not null and p_parser_version <> 2)
    or (p_outcome = 'verified' and (
      p_amount_minor is null or p_currency_code is distinct from 'ETB'
      or p_occurred_at is null or p_document_digest is null
      or p_document_topology is null or p_parser_version is null)) then
    raise exception 'The routine CBE Birr verification result is invalid.';
  end if;

  select candidate.* into v_candidate
    from app.routine_cbe_birr_candidates candidate
   where candidate.id = p_candidate_id for update;
  if v_candidate.id is null then
    raise exception 'The routine CBE Birr candidate is unavailable.';
  end if;

  -- An exact replay after a lost response returns the stored outcome without a second write.
  if v_candidate.status in ('verified', 'rejected', 'review') then
    select result.* into v_existing
      from app.routine_cbe_birr_verification_results result
     where result.candidate_id = p_candidate_id;
    if v_existing.candidate_id is null
      or v_existing.lease_token is distinct from p_lease_token
      or v_existing.document_digest is distinct from p_document_digest
      or v_existing.parser_version is distinct from p_parser_version
      or v_existing.document_topology is distinct from p_document_topology
      or v_existing.occurred_at is distinct from p_occurred_at
      or v_existing.occurred_at_precision is distinct from p_occurred_at_precision
      or v_existing.amount_minor is distinct from
        (case when p_currency_code = 'ETB' then p_amount_minor end)
      or not (
        (v_existing.outcome = p_outcome and v_existing.reason_code = p_reason_code)
        -- The server may have downgraded a verified request to review.
        or (p_outcome = 'verified' and v_existing.outcome = 'review'
          and v_existing.reason_code in ('amount_out_of_range',
            'receipt_outside_freshness_window', 'receiver_revision_inactive',
            'duplicate_reference'))
      ) then
      raise exception 'The routine CBE Birr verification replay conflicts.';
    end if;
    return query select v_existing.candidate_id, v_existing.outcome, v_existing.reason_code,
                        v_existing.verification_mode, true;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_candidate.status <> 'leased' or v_candidate.lease_token is distinct from p_lease_token
    or v_candidate.lease_expires_at <= v_now then
    raise exception 'The routine CBE Birr verification lease is not current.';
  end if;

  -- Recheck every server-owned fact before a verified dry-run outcome is accepted. A mismatch
  -- becomes review rather than an automatic credit candidate.
  if v_outcome = 'verified' then
    v_span := case p_occurred_at_precision
      when 'minute' then interval '59.999999 seconds' else interval '0' end;
    select receiver.* into v_receiver
      from app.receiver_accounts receiver
     where receiver.id = v_candidate.receiver_account_id
       and receiver.version = v_candidate.receiver_account_version;
    if p_amount_minor not between 2500 and 2500000 then
      v_outcome := 'review'; v_reason := 'amount_out_of_range';
    elsif p_occurred_at < v_candidate.submitted_at - interval '1 hour'
      or p_occurred_at + v_span > v_candidate.submitted_at + interval '5 minutes'
      or p_occurred_at > v_now + interval '5 minutes' then
      v_outcome := 'review'; v_reason := 'receipt_outside_freshness_window';
    elsif v_receiver.id is null
      or v_receiver.active_from > p_occurred_at
      or (v_receiver.retired_at is not null
        and v_receiver.retired_at < v_candidate.submitted_at) then
      v_outcome := 'review'; v_reason := 'receiver_revision_inactive';
    elsif exists (
      select 1 from app.routine_cbe_birr_candidates other
      join app.routine_cbe_birr_verification_results other_result
        on other_result.candidate_id = other.id and other_result.outcome = 'verified'
     where other.reference_fingerprint = v_candidate.reference_fingerprint
       and other.id <> v_candidate.id
    ) then
      v_outcome := 'review'; v_reason := 'duplicate_reference';
    end if;
  end if;

  update app.routine_cbe_birr_candidates candidate
     set status = v_outcome, lease_worker_id = null, lease_expires_at = null,
         completed_at = v_now
   where candidate.id = v_candidate.id;
  insert into app.routine_cbe_birr_verification_results (
    candidate_id, outcome, reason_code, verification_mode, amount_minor, currency_code,
    occurred_at, occurred_at_precision, document_digest, document_topology, parser_version,
    attempt_number, lease_token, recorded_at
  ) values (
    v_candidate.id, v_outcome, v_reason, v_candidate.verification_mode,
    case when v_outcome = 'verified' or p_currency_code = 'ETB' then p_amount_minor end,
    case when v_outcome = 'verified' or p_currency_code = 'ETB' then p_currency_code end,
    p_occurred_at, p_occurred_at_precision, p_document_digest, p_document_topology,
    p_parser_version, v_candidate.attempt_count, v_candidate.lease_token, v_now
  );
  insert into app.audit_events (actor_kind, actor_label, action, resource_type, resource_id, metadata)
  values ('worker', 'routine-cbe-birr-verifier', 'routine_cbe_birr.verification_recorded',
    'routine_cbe_birr_candidate', v_candidate.id,
    pg_catalog.jsonb_build_object('outcome', v_outcome, 'reason_code', v_reason,
      'verification_mode', v_candidate.verification_mode));
  return query select v_candidate.id, v_outcome, v_reason, v_candidate.verification_mode, false;
end;
$$;
alter function app.record_routine_cbe_birr_verification(
  uuid, uuid, text, text, bigint, text, timestamptz, text, text, text, smallint
) owner to postgres;
revoke all on function app.record_routine_cbe_birr_verification(
  uuid, uuid, text, text, bigint, text, timestamptz, text, text, text, smallint
) from public, anon, authenticated, service_role;

create function app.release_routine_cbe_birr_verification(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_reason_code text
)
returns table (candidate_id uuid, candidate_status text, next_attempt_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate app.routine_cbe_birr_candidates%rowtype;
  v_now timestamptz;
  v_next timestamptz;
begin
  if not app.routine_cbe_birr_verifier_session_allowed() then
    raise exception using errcode = '42501',
      message = 'The routine CBE Birr verifier is unavailable.';
  end if;
  if p_candidate_id is null or p_lease_token is null
    or p_reason_code is null
    or p_reason_code not in ('provider_unavailable', 'receipt_unavailable', 'parser_unavailable') then
    raise exception 'The routine CBE Birr release request is invalid.';
  end if;
  select candidate.* into v_candidate
    from app.routine_cbe_birr_candidates candidate
   where candidate.id = p_candidate_id for update;
  v_now := pg_catalog.clock_timestamp();
  if v_candidate.id is null or v_candidate.status <> 'leased'
    or v_candidate.lease_token is distinct from p_lease_token
    or v_candidate.lease_expires_at <= v_now then
    raise exception 'The routine CBE Birr verification lease is not current.';
  end if;
  -- Exponential backoff from 30 seconds; a provider outage never retries indefinitely.
  v_next := v_now + interval '30 seconds' * pg_catalog.power(2, v_candidate.attempt_count - 1);
  if v_candidate.attempt_count >= 6
    or v_next >= v_candidate.submitted_at + interval '1 hour' then
    perform app.close_routine_cbe_birr_candidate_for_review(v_candidate.id, p_reason_code);
    return query select v_candidate.id, 'review'::text, null::timestamptz;
    return;
  end if;
  update app.routine_cbe_birr_candidates candidate
     set status = 'queued', lease_token = null, lease_worker_id = null,
         lease_expires_at = null, next_attempt_at = v_next
   where candidate.id = v_candidate.id;
  return query select v_candidate.id, 'queued'::text, v_next;
end;
$$;
alter function app.release_routine_cbe_birr_verification(uuid, uuid, text) owner to postgres;
revoke all on function app.release_routine_cbe_birr_verification(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant usage on schema app to fetanagent_routine_cbe_birr_verifier;
grant execute on function app.lease_routine_cbe_birr_verification(uuid)
  to fetanagent_routine_cbe_birr_verifier;
grant execute on function app.record_routine_cbe_birr_verification(
  uuid, uuid, text, text, bigint, text, timestamptz, text, text, text, smallint
) to fetanagent_routine_cbe_birr_verifier;
grant execute on function app.release_routine_cbe_birr_verification(uuid, uuid, text)
  to fetanagent_routine_cbe_birr_verifier;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(
      routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
    where namespace.nspname = 'app'
      and routine.proname in (
        'routine_cbe_birr_verifier_session_allowed', 'set_routine_cbe_birr_processing_mode',
        'capture_routine_cbe_birr_candidate', 'close_routine_cbe_birr_candidate_for_review',
        'lease_routine_cbe_birr_verification', 'record_routine_cbe_birr_verification',
        'release_routine_cbe_birr_verification', 'reject_routine_cbe_birr_ledger_mutation',
        'reject_routine_cbe_birr_candidate_identity_change')
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> routine.proowner
      and not (
        privilege.grantee = 'fetanagent_routine_cbe_birr_verifier'::pg_catalog.regrole
        and routine.proname in ('lease_routine_cbe_birr_verification',
          'record_routine_cbe_birr_verification', 'release_routine_cbe_birr_verification'))
  ) then
    raise exception 'A routine CBE Birr function has an unexpected execute grant.';
  end if;
end;
$$;

comment on table app.routine_cbe_birr_processing_control is
  'CBE-only processing mode, independent of the shared payment feature switches. Starts disabled; live is not installed.';
comment on table app.routine_cbe_birr_candidates is
  'Untrusted CBE Birr transaction-ID submissions awaiting server-side official receipt verification. Dry-run only.';
comment on table app.routine_cbe_birr_verification_results is
  'Immutable server-verified CBE Birr receipt outcomes. A verified dry-run result never creates a claim or job.';
comment on function app.capture_routine_cbe_birr_candidate(
  uuid, text, text, text, text, text, smallint, smallint, text
) is 'Dry-run CBE Birr Telegram intake. Ungranted until the Player-action catalog preflight is updated.';
comment on role fetanagent_routine_cbe_birr_verifier is
  'NOLOGIN group with only the dry-run CBE Birr lease, record, and release functions.';
comment on role fetanagent_routine_cbe_birr_verifier_runtime is
  'Unprovisioned NOLOGIN one-connection CBE Birr verifier scaffold; no credential or live switch.';
commit;
