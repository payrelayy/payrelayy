-- Private five-account live-money pilot boundary.
--
-- This migration is intentionally dormant. `arm_private_live_deposit_pilot` proves and freezes
-- one exact configuration, but leaves the pilot switch in `dry_run` and every financial switch
-- disabled. A later, separately reviewed activation migration must be the only code capable of
-- changing the pilot switch to `live` together with the required financial switches.
--
-- Legacy SQL integration fixtures continue to exercise the pre-pilot ledgers while the pilot
-- switch is not `live`. Once that switch is `live`, claim, enqueue, lease, and final-action
-- boundaries all require one immutable database reservation. No granted routine in this
-- migration can create that live switch state.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

insert into app.feature_switches (feature_key, mode, settings)
values ('private_live_deposit_pilot', 'disabled', '{}'::jsonb);

do $private_live_pilot_pgcrypto_preflight$
begin
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
    and pg_catalog.to_regprocedure('public.digest(bytea,text)') is null then
    raise exception 'The private live-deposit pilot requires the pgcrypto digest function.';
  end if;
end;
$private_live_pilot_pgcrypto_preflight$;

create function app.private_live_deposit_pilot_sha256(p_value text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  digest_hex text;
begin
  if p_value is null then
    raise exception 'The private live-deposit pilot digest input is required.';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to($1, 'UTF8'), 'sha256'),
        'hex'
      )
    $digest$
      into digest_hex
      using p_value;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(
        public.digest(pg_catalog.convert_to($1, 'UTF8'), 'sha256'),
        'hex'
      )
    $digest$
      into digest_hex
      using p_value;
  else
    raise exception 'The private live-deposit pilot digest function is unavailable.';
  end if;

  if digest_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'The private live-deposit pilot digest result is invalid.';
  end if;

  return 'sha256:' || digest_hex;
end;
$$;

create table app.private_live_deposit_pilot_revisions (
  id uuid primary key default gen_random_uuid(),
  revision integer generated always as identity unique,
  prepare_request_key uuid not null unique,
  prepare_request_digest text not null unique
    check (prepare_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  configuration_digest text
    check (
      configuration_digest is null
      or configuration_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  contract_version smallint not null default 1
    check (contract_version = 1),
  status text not null default 'draft'
    check (status in ('draft', 'armed', 'stopped')),
  platform_id uuid not null
    references app.platforms (id) on delete restrict,
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  platform_agent_label_snapshot text not null,
  platform_agent_updated_at_snapshot timestamptz not null,
  currency_code character(3) not null default 'ETB'
    check (currency_code = 'ETB'),
  minimum_amount_minor bigint not null
    check (minimum_amount_minor = 2500),
  maximum_per_deposit_minor bigint not null
    check (
      maximum_per_deposit_minor >= minimum_amount_minor
      and maximum_per_deposit_minor <= 2500000
    ),
  maximum_per_player_minor bigint not null
    check (
      maximum_per_player_minor >= maximum_per_deposit_minor
      and maximum_per_player_minor <= 2500000
    ),
  maximum_aggregate_minor bigint not null
    check (
      maximum_aggregate_minor >= maximum_per_player_minor
      and maximum_aggregate_minor::numeric
          <= maximum_per_player_minor::numeric * 5
    ),
  maximum_reservation_count smallint not null
    check (maximum_reservation_count between 1 and 5),
  active_from timestamptz not null,
  expires_at timestamptz not null,
  created_by_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  armed_by_admin_id uuid
    references app.admin_users (id) on delete restrict,
  stopped_by_admin_id uuid
    references app.admin_users (id) on delete restrict,
  armed_at timestamptz,
  stopped_at timestamptz,
  stop_reason_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint private_live_deposit_pilot_request_key_v4_check check (
    prepare_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_deposit_pilot_window_check check (
    expires_at > active_from
    and expires_at <= active_from + interval '24 hours'
  ),
  constraint private_live_deposit_pilot_reachable_exposure_check check (
    maximum_aggregate_minor::numeric
      <= maximum_per_deposit_minor::numeric * maximum_reservation_count::numeric
  ),
  constraint private_live_deposit_pilot_status_shape_check check (
    (status = 'draft'
      and armed_by_admin_id is null
      and stopped_by_admin_id is null
      and armed_at is null
      and stopped_at is null
      and stop_reason_code is null)
    or (status = 'armed'
      and configuration_digest is not null
      and armed_by_admin_id is not null
      and stopped_by_admin_id is null
      and armed_at is not null
      and stopped_at is null
      and stop_reason_code is null)
    or (status = 'stopped'
      and configuration_digest is not null
      and stopped_by_admin_id is not null
      and stopped_at is not null
      and stop_reason_code in (
        'owner_stop',
        'provider_incident',
        'parser_drift',
        'execution_uncertainty',
        'cap_review',
        'pilot_complete'
      ))
  )
);

create unique index private_live_deposit_pilot_one_open_revision_idx
  on app.private_live_deposit_pilot_revisions ((true))
  where status in ('draft', 'armed');

create index private_live_deposit_pilot_revisions_created_by_admin_idx
  on app.private_live_deposit_pilot_revisions (created_by_admin_id);
create index private_live_deposit_pilot_revisions_armed_by_admin_idx
  on app.private_live_deposit_pilot_revisions (armed_by_admin_id)
  where armed_by_admin_id is not null;
create index private_live_deposit_pilot_revisions_stopped_by_admin_idx
  on app.private_live_deposit_pilot_revisions (stopped_by_admin_id)
  where stopped_by_admin_id is not null;
create index private_live_deposit_pilot_revisions_platform_idx
  on app.private_live_deposit_pilot_revisions (platform_id);
create index private_live_deposit_pilot_revisions_agent_idx
  on app.private_live_deposit_pilot_revisions (platform_agent_account_id);

create table app.private_live_deposit_pilot_players (
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  player_id_snapshot text not null,
  player_owner_customer_id_snapshot uuid not null
    references app.customers (id) on delete restrict,
  player_owner_customer_status_snapshot app.record_status not null,
  player_owner_customer_updated_at_snapshot timestamptz not null,
  platform_id_snapshot uuid not null
    references app.platforms (id) on delete restrict,
  player_updated_at_snapshot timestamptz not null,
  eligibility_decision_id_snapshot uuid not null
    references app.player_deposit_eligibility_decisions (id) on delete restrict,
  eligibility_decision_version_snapshot integer not null
    check (eligibility_decision_version_snapshot > 0),
  eligibility_decided_at_snapshot timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (pilot_revision_id, player_account_id),
  constraint private_live_deposit_pilot_players_decision_player_fkey
    foreign key (eligibility_decision_id_snapshot, player_account_id)
    references app.player_deposit_eligibility_decisions (id, player_account_id)
    on delete restrict,
  constraint private_live_deposit_pilot_players_id_snapshot_key
    unique (pilot_revision_id, player_id_snapshot)
);

create index private_live_deposit_pilot_players_account_idx
  on app.private_live_deposit_pilot_players (player_account_id);
create index private_live_deposit_pilot_players_owner_idx
  on app.private_live_deposit_pilot_players (player_owner_customer_id_snapshot);
create index private_live_deposit_pilot_players_platform_idx
  on app.private_live_deposit_pilot_players (platform_id_snapshot);
create index private_live_deposit_pilot_players_decision_idx
  on app.private_live_deposit_pilot_players (eligibility_decision_id_snapshot);

create table app.private_live_deposit_pilot_customers (
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  customer_id uuid not null
    references app.customers (id) on delete restrict,
  customer_status_snapshot app.record_status not null,
  customer_updated_at_snapshot timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (pilot_revision_id, customer_id)
);

create index private_live_deposit_pilot_customers_customer_idx
  on app.private_live_deposit_pilot_customers (customer_id);

-- PostgreSQL foreign keys require an exact unique key for the receiver revision tuple. `id` is
-- already the receiver primary key; this redundant identity index lets the pilot bind and retain
-- all three independently checked revision columns in one declarative foreign key.
create unique index receiver_accounts_private_live_pilot_identity_idx
  on app.receiver_accounts (id, provider_id, version);

create table app.private_live_deposit_pilot_providers (
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  provider_code_snapshot text not null
    check (provider_code_snapshot in ('cbe_birr', 'telebirr')),
  provider_updated_at_snapshot timestamptz not null,
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  receiver_account_holder_name_snapshot text not null,
  receiver_account_masked_snapshot text not null,
  receiver_active_from_snapshot timestamptz not null,
  receiver_updated_at_snapshot timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (pilot_revision_id, payment_provider_id),
  constraint private_live_deposit_pilot_providers_code_key
    unique (pilot_revision_id, provider_code_snapshot),
  constraint private_live_deposit_pilot_providers_receiver_key
    unique (
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version
    ),
  constraint private_live_deposit_pilot_providers_receiver_fkey
    foreign key (
      receiver_account_id,
      payment_provider_id,
      receiver_account_version
    ) references app.receiver_accounts (id, provider_id, version)
    on delete restrict
);

create index private_live_deposit_pilot_providers_provider_idx
  on app.private_live_deposit_pilot_providers (payment_provider_id);
create index private_live_deposit_pilot_providers_receiver_idx
  on app.private_live_deposit_pilot_providers (receiver_account_id);
create index private_live_deposit_pilot_providers_receiver_revision_idx
  on app.private_live_deposit_pilot_providers (
    receiver_account_id,
    payment_provider_id,
    receiver_account_version
  );

create table app.private_live_deposit_pilot_proofs (
  id uuid primary key default gen_random_uuid(),
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  provider_code_snapshot text not null
    check (provider_code_snapshot in ('cbe_birr', 'telebirr')),
  origin_channel text not null
    check (origin_channel in ('telegram', 'customer_web')),
  input_kind text not null
    check (input_kind in ('direct_transaction_id', 'pasted_sms', 'image', 'pdf')),
  candidate_reference_ciphertext text not null,
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_reference_masked text not null
    check (
      candidate_reference_masked = pg_catalog.btrim(candidate_reference_masked)
      and candidate_reference_masked ~ '^\*{3}[A-Z0-9]{4}$'
    ),
  reference_encryption_key_version smallint not null
    check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null
    check (reference_profile_version = 2),
  submitted_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_deposit_pilot_proofs_ciphertext_shape check (
    candidate_reference_ciphertext = pg_catalog.btrim(candidate_reference_ciphertext)
    and pg_catalog.char_length(candidate_reference_ciphertext) between 50 and 512
    and candidate_reference_ciphertext
      ~ '^v2\.(cbe_birr|telebirr)\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
    and pg_catalog.split_part(candidate_reference_ciphertext, '.', 1) = 'v2'
    and pg_catalog.split_part(candidate_reference_ciphertext, '.', 2)
        = provider_code_snapshot
  ),
  constraint private_live_deposit_pilot_proofs_customer_fkey
    foreign key (pilot_revision_id, submitting_customer_id)
    references app.private_live_deposit_pilot_customers (
      pilot_revision_id,
      customer_id
    ) on delete restrict,
  constraint private_live_deposit_pilot_proofs_player_fkey
    foreign key (pilot_revision_id, player_account_id)
    references app.private_live_deposit_pilot_players (
      pilot_revision_id,
      player_account_id
    ) on delete restrict,
  constraint private_live_deposit_pilot_proofs_provider_fkey
    foreign key (pilot_revision_id, payment_provider_id)
    references app.private_live_deposit_pilot_providers (
      pilot_revision_id,
      payment_provider_id
    ) on delete restrict,
  constraint private_live_deposit_pilot_proofs_provider_reference_key
    unique (payment_provider_id, candidate_reference_fingerprint)
);

create index private_live_deposit_pilot_proofs_pilot_submitted_idx
  on app.private_live_deposit_pilot_proofs (pilot_revision_id, submitted_at, id);
create index private_live_deposit_pilot_proofs_customer_idx
  on app.private_live_deposit_pilot_proofs (submitting_customer_id);
create index private_live_deposit_pilot_proofs_player_idx
  on app.private_live_deposit_pilot_proofs (player_account_id);
create index private_live_deposit_pilot_proofs_pilot_customer_idx
  on app.private_live_deposit_pilot_proofs (
    pilot_revision_id,
    submitting_customer_id
  );
create index private_live_deposit_pilot_proofs_pilot_player_idx
  on app.private_live_deposit_pilot_proofs (pilot_revision_id, player_account_id);
create index private_live_deposit_pilot_proofs_pilot_provider_idx
  on app.private_live_deposit_pilot_proofs (
    pilot_revision_id,
    payment_provider_id
  );

create table app.private_live_deposit_pilot_reservations (
  id uuid primary key default gen_random_uuid(),
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  private_live_deposit_pilot_proof_id uuid not null unique
    references app.private_live_deposit_pilot_proofs (id) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  deposit_payment_claim_id uuid not null unique
    references app.deposit_payment_claims (id) on delete restrict,
  verification_attempt_id uuid not null unique
    references app.deposit_verification_attempts (id) on delete restrict,
  provider_payment_evidence_id uuid not null unique
    references app.provider_payment_evidence (id) on delete restrict,
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  player_owner_customer_id_snapshot uuid not null
    references app.customers (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  receiver_account_id uuid not null,
  receiver_account_version integer not null,
  canonical_reference_fingerprint text not null
    check (canonical_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code character(3) not null default 'ETB'
    check (currency_code = 'ETB'),
  authorization_token uuid not null unique default gen_random_uuid(),
  reserved_at timestamptz not null default clock_timestamp(),
  constraint private_live_deposit_pilot_reservation_player_fkey
    foreign key (pilot_revision_id, player_account_id)
    references app.private_live_deposit_pilot_players (
      pilot_revision_id,
      player_account_id
    ) on delete restrict,
  constraint private_live_deposit_pilot_reservation_customer_fkey
    foreign key (pilot_revision_id, submitting_customer_id)
    references app.private_live_deposit_pilot_customers (
      pilot_revision_id,
      customer_id
    ) on delete restrict,
  constraint private_live_deposit_pilot_reservation_provider_fkey
    foreign key (
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version
    ) references app.private_live_deposit_pilot_providers (
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version
    ) on delete restrict
);

create index private_live_deposit_pilot_reservations_pilot_reserved_idx
  on app.private_live_deposit_pilot_reservations (
    pilot_revision_id,
    reserved_at,
    id
  );
create index private_live_deposit_pilot_reservations_player_reserved_idx
  on app.private_live_deposit_pilot_reservations (
    pilot_revision_id,
    player_account_id,
    reserved_at,
    id
  );
create index private_live_deposit_pilot_reservations_submitting_customer_idx
  on app.private_live_deposit_pilot_reservations (submitting_customer_id);
create index private_live_deposit_pilot_reservations_player_owner_idx
  on app.private_live_deposit_pilot_reservations (player_owner_customer_id_snapshot);
create index private_live_deposit_pilot_reservations_player_idx
  on app.private_live_deposit_pilot_reservations (player_account_id);
create index private_live_deposit_pilot_reservations_provider_idx
  on app.private_live_deposit_pilot_reservations (payment_provider_id);
create index private_live_deposit_pilot_reservations_receiver_idx
  on app.private_live_deposit_pilot_reservations (receiver_account_id);
create index private_live_deposit_pilot_reservations_pilot_customer_idx
  on app.private_live_deposit_pilot_reservations (
    pilot_revision_id,
    submitting_customer_id
  );
create index private_live_pilot_reservations_provider_receiver_idx
  on app.private_live_deposit_pilot_reservations (
    pilot_revision_id,
    payment_provider_id,
    receiver_account_id,
    receiver_account_version
  );

create function app.reject_private_live_deposit_pilot_retained_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Private live-deposit pilot records are retained and immutable.';
end;
$$;

create function app.reject_private_live_deposit_pilot_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Private live-deposit pilot records cannot be truncated.';
end;
$$;

create function app.enforce_private_live_deposit_pilot_membership_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  revision_status text;
begin
  select pilot_revision.status
    into revision_status
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = new.pilot_revision_id
   for share;

  if not found or revision_status <> 'draft' then
    raise exception 'Private live-deposit pilot membership can be inserted only while drafting.';
  end if;

  return new;
end;
$$;

create function app.enforce_private_live_deposit_pilot_proof_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  captured_at timestamptz;
  live_financial_switch_count integer;
  switch_count integer;
begin
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
  )
  order by feature_switch.feature_key
  for update;
  get diagnostics switch_count = row_count;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = new.pilot_revision_id
   for update;

  perform platform.id
    from app.platforms platform
   where platform.id = pilot.platform_id
   for share;

  perform agent.id
    from app.platform_agent_accounts agent
   where agent.id = pilot.platform_agent_account_id
   for share;

  perform customer.id
    from app.customers customer
   where customer.id in (
     new.submitting_customer_id,
     (
       select player_member.player_owner_customer_id_snapshot
         from app.private_live_deposit_pilot_players player_member
        where player_member.pilot_revision_id = pilot.id
          and player_member.player_account_id = new.player_account_id
     )
   )
   order by customer.id
   for share;

  perform player.id
    from app.customer_platform_players player
   where player.id = new.player_account_id
   for share;

  perform decision.id
    from app.private_live_deposit_pilot_players player_member
    join app.player_deposit_eligibility_decisions decision
      on decision.id = player_member.eligibility_decision_id_snapshot
   where player_member.pilot_revision_id = pilot.id
     and player_member.player_account_id = new.player_account_id
   for share of decision;

  perform payment_provider.id
    from app.payment_providers payment_provider
   where payment_provider.id = new.payment_provider_id
   for share;

  perform receiver.id
    from app.private_live_deposit_pilot_providers provider_member
    join app.receiver_accounts receiver
      on receiver.id = provider_member.receiver_account_id
     and receiver.provider_id = provider_member.payment_provider_id
     and receiver.version = provider_member.receiver_account_version
   where provider_member.pilot_revision_id = pilot.id
     and provider_member.payment_provider_id = new.payment_provider_id
   for share of receiver;

  -- Refresh only after every potentially blocking policy lock. A proof that waited past pilot
  -- expiry must fail closed rather than inherit a pre-wait timestamp.
  captured_at := clock_timestamp();

  select pg_catalog.count(*)::integer
    into live_financial_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('deposit_execution', 'payment_verification')
     and feature_switch.mode = 'live';

  if switch_count <> 5
    or pilot.id is null
    or pilot.status <> 'armed'
    or captured_at < pilot.active_from
    or captured_at >= pilot.expires_at
    or live_financial_switch_count <> 2
    or not exists (
      select 1
        from app.platforms platform
       where platform.id = pilot.platform_id
         and platform.code = 'kemerbet'
         and platform.status = 'active'
    )
    or not exists (
      select 1
        from app.platform_agent_accounts agent
       where agent.id = pilot.platform_agent_account_id
         and agent.platform_id = pilot.platform_id
         and agent.status = 'active'
         and agent.label = pilot.platform_agent_label_snapshot
         and agent.updated_at is not distinct from pilot.platform_agent_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_providers provider_member
       where provider_member.pilot_revision_id = pilot.id
         and provider_member.payment_provider_id = new.payment_provider_id
         and provider_member.provider_code_snapshot = new.provider_code_snapshot
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_customers customer_member
        join app.customers customer
          on customer.id = customer_member.customer_id
       where customer_member.pilot_revision_id = pilot.id
         and customer_member.customer_id = new.submitting_customer_id
         and customer.status = 'active'
         and customer.status = customer_member.customer_status_snapshot
         and customer.updated_at is not distinct from customer_member.customer_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_players player_member
        join app.customer_platform_players player
          on player.id = player_member.player_account_id
        join app.customers player_owner_customer
          on player_owner_customer.id = player_member.player_owner_customer_id_snapshot
        join app.player_deposit_eligibility_decisions decision
          on decision.id = player_member.eligibility_decision_id_snapshot
       where player_member.pilot_revision_id = pilot.id
         and player_member.player_account_id = new.player_account_id
         and player.player_id = player_member.player_id_snapshot
         and player.customer_id = player_member.player_owner_customer_id_snapshot
         and player_owner_customer.status = 'active'
         and player_owner_customer.status
             = player_member.player_owner_customer_status_snapshot
         and player_owner_customer.updated_at
             is not distinct from player_member.player_owner_customer_updated_at_snapshot
         and player.platform_id = player_member.platform_id_snapshot
         and player.status = 'active'
         and player.validation_status = 'valid'
         and player.updated_at is not distinct from player_member.player_updated_at_snapshot
         and decision.player_account_id = player.id
         and decision.decision_version = player_member.eligibility_decision_version_snapshot
         and decision.decision = 'eligible'
         and decision.decided_at = player_member.eligibility_decided_at_snapshot
         and decision.player_account_updated_at_snapshot is not distinct from player.updated_at
         and decision.id = (
           select latest.id
             from app.player_deposit_eligibility_decisions latest
            where latest.player_account_id = player.id
            order by latest.decision_version desc
            limit 1
         )
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_providers provider_member
        join app.payment_providers payment_provider
          on payment_provider.id = provider_member.payment_provider_id
        join app.receiver_accounts receiver
          on receiver.id = provider_member.receiver_account_id
         and receiver.provider_id = provider_member.payment_provider_id
         and receiver.version = provider_member.receiver_account_version
       where provider_member.pilot_revision_id = pilot.id
         and provider_member.payment_provider_id = new.payment_provider_id
         and payment_provider.code = provider_member.provider_code_snapshot
         and payment_provider.status = 'active'
         and payment_provider.updated_at
             is not distinct from provider_member.provider_updated_at_snapshot
         and receiver.status = 'active'
         and receiver.account_holder_name = provider_member.receiver_account_holder_name_snapshot
         and receiver.account_reference_masked = provider_member.receiver_account_masked_snapshot
         and receiver.active_from = provider_member.receiver_active_from_snapshot
         and receiver.updated_at is not distinct from provider_member.receiver_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key =
             new.provider_code_snapshot || '_authoritative_verification'
         and provider_switch.mode = 'live'
    ) then
    raise exception 'The private live-deposit pilot cannot capture a live proof.';
  end if;

  new.submitted_at := captured_at;
  new.created_at := captured_at;
  return new;
end;
$$;

create trigger private_live_deposit_pilot_players_insert_guard
before insert on app.private_live_deposit_pilot_players
for each row execute function app.enforce_private_live_deposit_pilot_membership_insert();
create trigger private_live_deposit_pilot_players_immutable
before update or delete on app.private_live_deposit_pilot_players
for each row execute function app.reject_private_live_deposit_pilot_retained_mutation();
create trigger private_live_deposit_pilot_players_no_truncate
before truncate on app.private_live_deposit_pilot_players
for each statement execute function app.reject_private_live_deposit_pilot_truncate();

create trigger private_live_deposit_pilot_customers_insert_guard
before insert on app.private_live_deposit_pilot_customers
for each row execute function app.enforce_private_live_deposit_pilot_membership_insert();
create trigger private_live_deposit_pilot_customers_immutable
before update or delete on app.private_live_deposit_pilot_customers
for each row execute function app.reject_private_live_deposit_pilot_retained_mutation();
create trigger private_live_deposit_pilot_customers_no_truncate
before truncate on app.private_live_deposit_pilot_customers
for each statement execute function app.reject_private_live_deposit_pilot_truncate();

create trigger private_live_deposit_pilot_providers_insert_guard
before insert on app.private_live_deposit_pilot_providers
for each row execute function app.enforce_private_live_deposit_pilot_membership_insert();
create trigger private_live_deposit_pilot_providers_immutable
before update or delete on app.private_live_deposit_pilot_providers
for each row execute function app.reject_private_live_deposit_pilot_retained_mutation();
create trigger private_live_deposit_pilot_providers_no_truncate
before truncate on app.private_live_deposit_pilot_providers
for each statement execute function app.reject_private_live_deposit_pilot_truncate();

create trigger private_live_deposit_pilot_reservations_immutable
before update or delete on app.private_live_deposit_pilot_reservations
for each row execute function app.reject_private_live_deposit_pilot_retained_mutation();
create trigger private_live_deposit_pilot_reservations_no_truncate
before truncate on app.private_live_deposit_pilot_reservations
for each statement execute function app.reject_private_live_deposit_pilot_truncate();

create trigger private_live_deposit_pilot_proofs_insert_guard
before insert on app.private_live_deposit_pilot_proofs
for each row execute function app.enforce_private_live_deposit_pilot_proof_insert();
create trigger private_live_deposit_pilot_proofs_immutable
before update or delete on app.private_live_deposit_pilot_proofs
for each row execute function app.reject_private_live_deposit_pilot_retained_mutation();
create trigger private_live_deposit_pilot_proofs_no_truncate
before truncate on app.private_live_deposit_pilot_proofs
for each statement execute function app.reject_private_live_deposit_pilot_truncate();

create function app.enforce_private_live_deposit_pilot_revision_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.revision is distinct from old.revision
    or new.prepare_request_key is distinct from old.prepare_request_key
    or new.prepare_request_digest is distinct from old.prepare_request_digest
    or new.contract_version is distinct from old.contract_version
    or new.platform_id is distinct from old.platform_id
    or new.platform_agent_account_id is distinct from old.platform_agent_account_id
    or new.platform_agent_label_snapshot is distinct from old.platform_agent_label_snapshot
    or new.platform_agent_updated_at_snapshot
       is distinct from old.platform_agent_updated_at_snapshot
    or new.currency_code is distinct from old.currency_code
    or new.minimum_amount_minor is distinct from old.minimum_amount_minor
    or new.maximum_per_deposit_minor is distinct from old.maximum_per_deposit_minor
    or new.maximum_per_player_minor is distinct from old.maximum_per_player_minor
    or new.maximum_aggregate_minor is distinct from old.maximum_aggregate_minor
    or new.maximum_reservation_count is distinct from old.maximum_reservation_count
    or new.active_from is distinct from old.active_from
    or new.expires_at is distinct from old.expires_at
    or new.created_by_admin_id is distinct from old.created_by_admin_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Private live-deposit pilot configuration is immutable.';
  end if;

  if old.status = 'draft'
    and old.configuration_digest is null
    and new.configuration_digest is not null
    and new.configuration_digest ~ '^sha256:[0-9a-f]{64}$'
    and new.status = old.status
    and current_setting('app.private_live_pilot_preparing', true) = 'on' then
    new.updated_at := clock_timestamp();
    return new;
  end if;

  if new.configuration_digest is distinct from old.configuration_digest then
    raise exception 'Private live-deposit pilot configuration digest is immutable.';
  end if;

  if new.status = old.status then
    if new.armed_by_admin_id is distinct from old.armed_by_admin_id
      or new.stopped_by_admin_id is distinct from old.stopped_by_admin_id
      or new.armed_at is distinct from old.armed_at
      or new.stopped_at is distinct from old.stopped_at
      or new.stop_reason_code is distinct from old.stop_reason_code
      or new.updated_at is distinct from old.updated_at then
      raise exception 'Private live-deposit pilot metadata changes only with a status transition.';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'draft' and new.status in ('armed', 'stopped'))
    or (old.status = 'armed' and new.status = 'stopped')
  ) then
    raise exception 'The private live-deposit pilot status transition is invalid.';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger private_live_deposit_pilot_revision_transition
before update on app.private_live_deposit_pilot_revisions
for each row execute function app.enforce_private_live_deposit_pilot_revision_transition();
create trigger private_live_deposit_pilot_revisions_no_delete
before delete on app.private_live_deposit_pilot_revisions
for each row execute function app.reject_private_live_deposit_pilot_retained_mutation();
create trigger private_live_deposit_pilot_revisions_no_truncate
before truncate on app.private_live_deposit_pilot_revisions
for each statement execute function app.reject_private_live_deposit_pilot_truncate();

create function app.compute_private_live_deposit_pilot_configuration_digest(
  p_pilot_revision_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  canonical_configuration text;
begin
  select pg_catalog.jsonb_build_object(
           'contract_version', pilot.contract_version,
           'platform_id', pilot.platform_id::text,
           'platform_agent', pg_catalog.jsonb_build_object(
             'id', pilot.platform_agent_account_id::text,
             'label', pilot.platform_agent_label_snapshot,
             'updated_at_epoch_microseconds',
               (pg_catalog.date_part(
                 'epoch', pilot.platform_agent_updated_at_snapshot
               ) * 1000000)::bigint
           ),
           'currency_code', pilot.currency_code,
           'minimum_amount_minor', pilot.minimum_amount_minor,
           'maximum_per_deposit_minor', pilot.maximum_per_deposit_minor,
           'maximum_per_player_minor', pilot.maximum_per_player_minor,
           'maximum_aggregate_minor', pilot.maximum_aggregate_minor,
           'maximum_reservation_count', pilot.maximum_reservation_count,
           'active_from_epoch_microseconds',
             (pg_catalog.date_part('epoch', pilot.active_from) * 1000000)::bigint,
           'expires_at_epoch_microseconds',
             (pg_catalog.date_part('epoch', pilot.expires_at) * 1000000)::bigint,
           'players', (
             select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'player_account_id', member.player_account_id::text,
                   'player_id', member.player_id_snapshot,
                   'owner_customer_id', member.player_owner_customer_id_snapshot::text,
                   'owner_customer_status',
                     member.player_owner_customer_status_snapshot::text,
                   'owner_customer_updated_at_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.player_owner_customer_updated_at_snapshot
                     ) * 1000000)::bigint,
                   'platform_id', member.platform_id_snapshot::text,
                   'player_updated_at_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.player_updated_at_snapshot
                     ) * 1000000)::bigint,
                   'eligibility_decision_id', member.eligibility_decision_id_snapshot::text,
                   'eligibility_decision_version',
                     member.eligibility_decision_version_snapshot,
                   'eligibility_decided_at_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.eligibility_decided_at_snapshot
                     ) * 1000000)::bigint
                 ) order by member.player_id_snapshot
               ),
               '[]'::jsonb
             )
             from app.private_live_deposit_pilot_players member
            where member.pilot_revision_id = pilot.id
           ),
           'submitting_customers', (
             select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'customer_id', member.customer_id::text,
                   'status', member.customer_status_snapshot::text,
                   'updated_at_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.customer_updated_at_snapshot
                     ) * 1000000)::bigint
                 ) order by member.customer_id
               ),
               '[]'::jsonb
             )
             from app.private_live_deposit_pilot_customers member
            where member.pilot_revision_id = pilot.id
           ),
           'providers', (
             select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'payment_provider_id', member.payment_provider_id::text,
                   'provider_code', member.provider_code_snapshot,
                   'provider_updated_at_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.provider_updated_at_snapshot
                     ) * 1000000)::bigint,
                   'receiver_account_id', member.receiver_account_id::text,
                   'receiver_account_version', member.receiver_account_version,
                   'receiver_account_holder_name',
                     member.receiver_account_holder_name_snapshot,
                   'receiver_account_masked', member.receiver_account_masked_snapshot,
                   'receiver_active_from_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.receiver_active_from_snapshot
                     ) * 1000000)::bigint,
                   'receiver_updated_at_epoch_microseconds',
                     (pg_catalog.date_part(
                       'epoch', member.receiver_updated_at_snapshot
                     ) * 1000000)::bigint
                 ) order by member.provider_code_snapshot
               ),
               '[]'::jsonb
             )
             from app.private_live_deposit_pilot_providers member
            where member.pilot_revision_id = pilot.id
           )
         )::text
    into canonical_configuration
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_pilot_revision_id;

  if canonical_configuration is null then
    raise exception 'The private live-deposit pilot configuration is unavailable.';
  end if;

  return app.private_live_deposit_pilot_sha256(canonical_configuration);
end;
$$;

create function app.require_private_live_deposit_pilot_owner_controller()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'fetanagent_owner_control',
    'member'
  ) then
    raise exception 'The private live-deposit pilot Owner-control role is required.';
  end if;
end;
$$;

create function app.require_private_live_deposit_pilot_executor()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'fetanagent_deposit_executor',
    'member'
  ) then
    raise exception 'The private live-deposit pilot executor role is required.';
  end if;
end;
$$;

create function app.require_private_live_deposit_pilot_settlement()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'fetanagent_verification_settlement',
    'member'
  ) then
    raise exception 'The private live-deposit pilot settlement role is required.';
  end if;
end;
$$;

create function app.require_active_owner_for_private_live_deposit_pilot(
  p_actor_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_admin_id is null or not exists (
    select 1
      from app.admin_users admin_user
     where admin_user.id = p_actor_admin_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
  ) then
    raise exception 'Only the active Owner can control the private live-deposit pilot.';
  end if;
end;
$$;

create function app.prepare_private_live_deposit_pilot(
  p_actor_admin_id uuid,
  p_request_key uuid,
  p_provider_codes text[],
  p_player_ids text[],
  p_submitting_customer_ids uuid[],
  p_minimum_amount_minor bigint,
  p_maximum_per_deposit_minor bigint,
  p_maximum_per_player_minor bigint,
  p_maximum_aggregate_minor bigint,
  p_maximum_reservation_count smallint,
  p_active_from timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  created_pilot_id uuid;
  existing_pilot app.private_live_deposit_pilot_revisions%rowtype;
  kemerbet_platform app.platforms%rowtype;
  active_agent app.platform_agent_accounts%rowtype;
  computed_configuration_digest text;
  request_digest text;
  matched_customer_count integer;
  matched_player_count integer;
  matched_provider_count integer;
  switch_count integer;
begin
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  if p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_provider_codes is null
    or pg_catalog.cardinality(p_provider_codes) not between 1 and 2
    or p_player_ids is null
    or pg_catalog.cardinality(p_player_ids) <> 5
    or p_submitting_customer_ids is null
    or pg_catalog.cardinality(p_submitting_customer_ids) not between 1 and 5
    or p_minimum_amount_minor is distinct from 2500
    or p_maximum_per_deposit_minor is null
    or p_maximum_per_deposit_minor < p_minimum_amount_minor
    or p_maximum_per_deposit_minor > 2500000
    or p_maximum_per_player_minor is null
    or p_maximum_per_player_minor < p_maximum_per_deposit_minor
    or p_maximum_per_player_minor > 2500000
    or p_maximum_aggregate_minor is null
    or p_maximum_aggregate_minor < p_maximum_per_player_minor
    or p_maximum_aggregate_minor::numeric
       > p_maximum_per_player_minor::numeric * 5
    or p_maximum_aggregate_minor::numeric
       > p_maximum_per_deposit_minor::numeric * p_maximum_reservation_count::numeric
    or p_maximum_reservation_count is null
    or p_maximum_reservation_count not between 1 and 5
    or p_active_from is null
    or p_expires_at is null
    or p_expires_at <= p_active_from
    or p_expires_at > p_active_from + interval '24 hours'
    or p_expires_at <= clock_timestamp()
    or exists (
      select 1
        from pg_catalog.unnest(p_provider_codes) input_value
       where input_value is null
          or input_value is distinct from pg_catalog.lower(pg_catalog.btrim(input_value))
          or input_value not in ('cbe_birr', 'telebirr')
    )
    or exists (
      select 1
        from pg_catalog.unnest(p_player_ids) input_value
       where input_value is null
          or input_value is distinct from pg_catalog.btrim(input_value)
          or pg_catalog.char_length(input_value) not between 1 and 64
    )
    or (
      select pg_catalog.count(distinct input_value)
        from pg_catalog.unnest(p_provider_codes) input_value
    ) <> pg_catalog.cardinality(p_provider_codes)
    or (
      select pg_catalog.count(distinct input_value)
        from pg_catalog.unnest(p_player_ids) input_value
    ) <> 5
    or (
      select pg_catalog.count(distinct input_value)
        from pg_catalog.unnest(p_submitting_customer_ids) input_value
    ) <> pg_catalog.cardinality(p_submitting_customer_ids) then
    raise exception 'The private live-deposit pilot preparation request is invalid.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'provider_codes', (
        select pg_catalog.jsonb_agg(input_value order by input_value)
          from pg_catalog.unnest(p_provider_codes) input_value
      ),
      'player_ids', (
        select pg_catalog.jsonb_agg(input_value order by input_value)
          from pg_catalog.unnest(p_player_ids) input_value
      ),
      'submitting_customer_ids', (
        select pg_catalog.jsonb_agg(input_value::text order by input_value)
          from pg_catalog.unnest(p_submitting_customer_ids) input_value
      ),
      'minimum_amount_minor', p_minimum_amount_minor,
      'maximum_per_deposit_minor', p_maximum_per_deposit_minor,
      'maximum_per_player_minor', p_maximum_per_player_minor,
      'maximum_aggregate_minor', p_maximum_aggregate_minor,
      'maximum_reservation_count', p_maximum_reservation_count,
      'active_from_epoch_microseconds',
        (pg_catalog.date_part('epoch', p_active_from) * 1000000)::bigint,
      'expires_at_epoch_microseconds',
        (pg_catalog.date_part('epoch', p_expires_at) * 1000000)::bigint
    )::text
  );

  -- Every pilot routine locks the complete switch set by key before pilot, reservation, and
  -- ledger rows. This serializes preparation with every later activation/control boundary.
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 or exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification'
     )
       and (
         feature_switch.mode <> 'disabled'
         or feature_switch.settings <> '{}'::jsonb
       )
  ) then
    raise exception 'Private pilot preparation requires every financial switch disabled.';
  end if;

  select pilot.*
    into existing_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.prepare_request_key = p_request_key
   for update;

  if found then
    if existing_pilot.created_by_admin_id is distinct from p_actor_admin_id
      or existing_pilot.prepare_request_digest is distinct from request_digest then
      raise exception 'The private live-deposit pilot preparation key conflicts.';
    end if;
    return existing_pilot.id;
  end if;

  if exists (
    select 1
      from app.private_live_deposit_pilot_revisions pilot
     where pilot.status in ('draft', 'armed')
  ) then
    raise exception 'Another private live-deposit pilot is open.';
  end if;

  select platform.*
    into kemerbet_platform
    from app.platforms platform
   where platform.code = 'kemerbet'
     and platform.status = 'active'
   for share;

  if not found then
    raise exception 'The private live-deposit pilot requires the active KemerBet platform.';
  end if;

  select agent.*
    into active_agent
    from app.platform_agent_accounts agent
   where agent.platform_id = kemerbet_platform.id
     and agent.status = 'active'
   for share;

  if not found then
    raise exception 'The private live-deposit pilot requires one active KemerBet agent.';
  end if;

  perform customer.id
    from app.customers customer
   where customer.id = any(p_submitting_customer_ids)
     and customer.status = 'active'
   order by customer.id
   for share;
  get diagnostics matched_customer_count = row_count;

  if matched_customer_count <> pg_catalog.cardinality(p_submitting_customer_ids) then
    raise exception 'Every private pilot submitting customer must be active.';
  end if;

  perform player.id
    from app.customer_platform_players player
    join app.customers player_owner_customer
      on player_owner_customer.id = player.customer_id
    join app.player_deposit_eligibility_decisions decision
      on decision.id = (
        select latest.id
          from app.player_deposit_eligibility_decisions latest
         where latest.player_account_id = player.id
         order by latest.decision_version desc
         limit 1
      )
   where player.platform_id = kemerbet_platform.id
     and player.player_id = any(p_player_ids)
     and player.status = 'active'
     and player.validation_status = 'valid'
     and player_owner_customer.status = 'active'
     and decision.decision = 'eligible'
     and decision.player_account_updated_at_snapshot is not distinct from player.updated_at
   order by player.id
   for share of player, player_owner_customer, decision;
  get diagnostics matched_player_count = row_count;

  if matched_player_count <> 5 then
    raise exception 'Every private pilot Player ID must be current and deposit-eligible.';
  end if;

  perform payment_provider.id
    from app.payment_providers payment_provider
    join app.receiver_accounts receiver
      on receiver.provider_id = payment_provider.id
     and receiver.status = 'active'
   where payment_provider.code = any(p_provider_codes)
     and payment_provider.status = 'active'
   order by payment_provider.id
   for share of payment_provider, receiver;
  get diagnostics matched_provider_count = row_count;

  if matched_provider_count <> pg_catalog.cardinality(p_provider_codes) then
    raise exception 'Every private pilot provider requires one active receiver revision.';
  end if;

  if p_expires_at <= clock_timestamp() then
    raise exception 'The private live-deposit pilot expired while preparation locks were acquired.';
  end if;

  insert into app.private_live_deposit_pilot_revisions (
    prepare_request_key,
    prepare_request_digest,
    platform_id,
    platform_agent_account_id,
    platform_agent_label_snapshot,
    platform_agent_updated_at_snapshot,
    minimum_amount_minor,
    maximum_per_deposit_minor,
    maximum_per_player_minor,
    maximum_aggregate_minor,
    maximum_reservation_count,
    active_from,
    expires_at,
    created_by_admin_id
  ) values (
    p_request_key,
    request_digest,
    kemerbet_platform.id,
    active_agent.id,
    active_agent.label,
    active_agent.updated_at,
    p_minimum_amount_minor,
    p_maximum_per_deposit_minor,
    p_maximum_per_player_minor,
    p_maximum_aggregate_minor,
    p_maximum_reservation_count,
    p_active_from,
    p_expires_at,
    p_actor_admin_id
  ) returning id into created_pilot_id;

  insert into app.private_live_deposit_pilot_players (
    pilot_revision_id,
    player_account_id,
    player_id_snapshot,
    player_owner_customer_id_snapshot,
    player_owner_customer_status_snapshot,
    player_owner_customer_updated_at_snapshot,
    platform_id_snapshot,
    player_updated_at_snapshot,
    eligibility_decision_id_snapshot,
    eligibility_decision_version_snapshot,
    eligibility_decided_at_snapshot
  )
  select created_pilot_id,
         player.id,
         player.player_id,
         player.customer_id,
         player_owner_customer.status,
         player_owner_customer.updated_at,
         player.platform_id,
         player.updated_at,
         decision.id,
         decision.decision_version,
         decision.decided_at
    from app.customer_platform_players player
    join app.customers player_owner_customer
      on player_owner_customer.id = player.customer_id
    join app.player_deposit_eligibility_decisions decision
      on decision.id = (
        select latest.id
          from app.player_deposit_eligibility_decisions latest
         where latest.player_account_id = player.id
         order by latest.decision_version desc
         limit 1
      )
   where player.platform_id = kemerbet_platform.id
     and player.player_id = any(p_player_ids)
   order by player.player_id;

  insert into app.private_live_deposit_pilot_customers (
    pilot_revision_id,
    customer_id,
    customer_status_snapshot,
    customer_updated_at_snapshot
  )
  select created_pilot_id,
         customer.id,
         customer.status,
         customer.updated_at
    from app.customers customer
   where customer.id = any(p_submitting_customer_ids)
   order by customer.id;

  insert into app.private_live_deposit_pilot_providers (
    pilot_revision_id,
    payment_provider_id,
    provider_code_snapshot,
    provider_updated_at_snapshot,
    receiver_account_id,
    receiver_account_version,
    receiver_account_holder_name_snapshot,
    receiver_account_masked_snapshot,
    receiver_active_from_snapshot,
    receiver_updated_at_snapshot
  )
  select created_pilot_id,
         payment_provider.id,
         payment_provider.code,
         payment_provider.updated_at,
         receiver.id,
         receiver.version,
         receiver.account_holder_name,
         receiver.account_reference_masked,
         receiver.active_from,
         receiver.updated_at
    from app.payment_providers payment_provider
    join app.receiver_accounts receiver
      on receiver.provider_id = payment_provider.id
     and receiver.status = 'active'
   where payment_provider.code = any(p_provider_codes)
   order by payment_provider.code;

  computed_configuration_digest :=
    app.compute_private_live_deposit_pilot_configuration_digest(created_pilot_id);

  perform pg_catalog.set_config('app.private_live_pilot_preparing', 'on', true);
  update app.private_live_deposit_pilot_revisions pilot
     set configuration_digest = computed_configuration_digest
   where pilot.id = created_pilot_id;
  perform pg_catalog.set_config('app.private_live_pilot_preparing', 'off', true);

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'admin',
    p_actor_admin_id,
    'deposit.private_live_pilot_prepared',
    'private_live_deposit_pilot',
    created_pilot_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'configuration_digest', computed_configuration_digest,
      'player_count', 5,
      'submitting_customer_count', pg_catalog.cardinality(p_submitting_customer_ids),
      'provider_count', pg_catalog.cardinality(p_provider_codes),
      'maximum_reservation_count', p_maximum_reservation_count,
      'maximum_aggregate_minor', p_maximum_aggregate_minor,
      'expires_at', p_expires_at
    )
  );

  return created_pilot_id;
end;
$$;

create function app.arm_private_live_deposit_pilot(
  p_actor_admin_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  armed_time timestamptz;
  computed_digest text;
  player_count integer;
  customer_count integer;
  provider_count integer;
  switch_count integer;
begin
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 or exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification'
     )
       and (
         feature_switch.mode <> 'disabled'
         or feature_switch.settings <> '{}'::jsonb
       )
  ) then
    raise exception 'Private pilot arming requires every financial switch to remain disabled.';
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  armed_time := clock_timestamp();

  if not found
    or pilot.status <> 'draft'
    or pilot.configuration_digest is null
    or pilot.expires_at <= armed_time
    or pilot.active_from > armed_time + interval '15 minutes' then
    raise exception 'The private live-deposit pilot cannot be armed.';
  end if;

  select pg_catalog.count(*)::integer into player_count
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id;
  select pg_catalog.count(*)::integer into customer_count
    from app.private_live_deposit_pilot_customers member
   where member.pilot_revision_id = pilot.id;
  select pg_catalog.count(*)::integer into provider_count
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id;

  if player_count <> 5
    or customer_count not between 1 and 5
    or provider_count not between 1 and 2 then
    raise exception 'The private live-deposit pilot membership is incomplete.';
  end if;

  computed_digest := app.compute_private_live_deposit_pilot_configuration_digest(pilot.id);
  if computed_digest is distinct from pilot.configuration_digest then
    raise exception 'The private live-deposit pilot configuration digest does not match.';
  end if;

  -- Lock every mutable policy source in the same global order used by settlement and final
  -- authorization. `FOR SHARE` conflicts with non-key status/snapshot updates.
  perform platform.id
    from app.platforms platform
   where platform.id = pilot.platform_id
   for share;

  perform agent.id
    from app.platform_agent_accounts agent
   where agent.id = pilot.platform_agent_account_id
   for share;

  perform customer.id
    from app.customers customer
   where customer.id in (
     select customer_member.customer_id
       from app.private_live_deposit_pilot_customers customer_member
      where customer_member.pilot_revision_id = pilot.id
     union
     select player_member.player_owner_customer_id_snapshot
       from app.private_live_deposit_pilot_players player_member
      where player_member.pilot_revision_id = pilot.id
   )
   order by customer.id
   for share;

  perform player.id
    from app.private_live_deposit_pilot_players player_member
    join app.customer_platform_players player
      on player.id = player_member.player_account_id
   where player_member.pilot_revision_id = pilot.id
   order by player.id
   for share of player;

  perform decision.id
    from app.private_live_deposit_pilot_players player_member
    join app.player_deposit_eligibility_decisions decision
      on decision.id = player_member.eligibility_decision_id_snapshot
   where player_member.pilot_revision_id = pilot.id
   order by decision.id
   for share of decision;

  perform payment_provider.id
    from app.private_live_deposit_pilot_providers provider_member
    join app.payment_providers payment_provider
      on payment_provider.id = provider_member.payment_provider_id
   where provider_member.pilot_revision_id = pilot.id
   order by payment_provider.id
   for share of payment_provider;

  perform receiver.id
    from app.private_live_deposit_pilot_providers provider_member
    join app.receiver_accounts receiver
      on receiver.id = provider_member.receiver_account_id
     and receiver.provider_id = provider_member.payment_provider_id
     and receiver.version = provider_member.receiver_account_version
   where provider_member.pilot_revision_id = pilot.id
   order by receiver.id
   for share of receiver;

  armed_time := clock_timestamp();

  if pilot.expires_at <= armed_time
    or pilot.active_from > armed_time + interval '15 minutes'
    or not exists (
    select 1
      from app.platforms platform
     where platform.id = pilot.platform_id
       and platform.code = 'kemerbet'
       and platform.status = 'active'
  ) or not exists (
    select 1
      from app.platform_agent_accounts agent
     where agent.id = pilot.platform_agent_account_id
       and agent.platform_id = pilot.platform_id
       and agent.status = 'active'
       and agent.label is not distinct from pilot.platform_agent_label_snapshot
       and agent.updated_at is not distinct from pilot.platform_agent_updated_at_snapshot
  ) or exists (
    select 1
      from app.private_live_deposit_pilot_players member
      left join app.customer_platform_players player
        on player.id = member.player_account_id
      left join app.customers player_owner_customer
        on player_owner_customer.id = member.player_owner_customer_id_snapshot
      left join app.player_deposit_eligibility_decisions decision
        on decision.id = member.eligibility_decision_id_snapshot
     where member.pilot_revision_id = pilot.id
       and (
         player.id is null
         or player.player_id is distinct from member.player_id_snapshot
         or player.customer_id is distinct from member.player_owner_customer_id_snapshot
         or player_owner_customer.id is null
         or player_owner_customer.status <> 'active'
         or player_owner_customer.status
            is distinct from member.player_owner_customer_status_snapshot
         or player_owner_customer.updated_at
            is distinct from member.player_owner_customer_updated_at_snapshot
         or player.platform_id is distinct from member.platform_id_snapshot
         or player.status <> 'active'
         or player.validation_status <> 'valid'
         or player.updated_at is distinct from member.player_updated_at_snapshot
         or decision.id is null
         or decision.player_account_id is distinct from player.id
         or decision.decision_version
            is distinct from member.eligibility_decision_version_snapshot
         or decision.decision <> 'eligible'
         or decision.decided_at is distinct from member.eligibility_decided_at_snapshot
         or decision.player_account_updated_at_snapshot is distinct from player.updated_at
         or decision.id is distinct from (
           select latest.id
             from app.player_deposit_eligibility_decisions latest
            where latest.player_account_id = player.id
            order by latest.decision_version desc
            limit 1
         )
       )
  ) or exists (
    select 1
      from app.private_live_deposit_pilot_customers member
      left join app.customers customer on customer.id = member.customer_id
     where member.pilot_revision_id = pilot.id
       and (
         customer.id is null
         or customer.status <> 'active'
         or customer.status is distinct from member.customer_status_snapshot
         or customer.updated_at is distinct from member.customer_updated_at_snapshot
       )
  ) or exists (
    select 1
      from app.private_live_deposit_pilot_providers member
      left join app.payment_providers payment_provider
        on payment_provider.id = member.payment_provider_id
      left join app.receiver_accounts receiver
        on receiver.id = member.receiver_account_id
       and receiver.provider_id = member.payment_provider_id
       and receiver.version = member.receiver_account_version
     where member.pilot_revision_id = pilot.id
       and (
         payment_provider.id is null
         or payment_provider.code is distinct from member.provider_code_snapshot
         or payment_provider.status <> 'active'
         or payment_provider.updated_at is distinct from member.provider_updated_at_snapshot
         or receiver.id is null
         or receiver.status <> 'active'
         or receiver.account_holder_name
            is distinct from member.receiver_account_holder_name_snapshot
         or receiver.account_reference_masked
            is distinct from member.receiver_account_masked_snapshot
         or receiver.active_from is distinct from member.receiver_active_from_snapshot
         or receiver.updated_at is distinct from member.receiver_updated_at_snapshot
       )
  ) then
    raise exception 'The private live-deposit pilot snapshots are no longer current.';
  end if;

  if exists (
    select 1
      from app.deposit_jobs job
     where job.job_kind in ('execute_deposit', 'reconcile_execution')
       and job.status in ('queued', 'leased', 'retry_wait')
  ) or exists (
    select 1
      from app.deposit_execution_attempts attempt
     where attempt.status in (
       'prepared',
       'final_action_fenced',
       'reconciliation_required',
       'review_required'
     )
  ) then
    raise exception 'The private live-deposit pilot cannot arm over blocking execution state.';
  end if;

  update app.private_live_deposit_pilot_revisions pilot_revision
     set status = 'armed',
         armed_by_admin_id = p_actor_admin_id,
         armed_at = armed_time
   where pilot_revision.id = pilot.id;

  -- `dry_run` is an attested manifest pointer, not financial authority.
  update app.feature_switches feature_switch
     set mode = 'dry_run',
         settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         ),
         updated_by_admin_id = p_actor_admin_id
   where feature_switch.feature_key = 'private_live_deposit_pilot';

  if not found then
    raise exception 'The private live-deposit pilot switch is unavailable.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'admin',
    p_actor_admin_id,
    'deposit.private_live_pilot_armed_dormant',
    'private_live_deposit_pilot',
    pilot.id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'configuration_digest', pilot.configuration_digest,
      'financially_active', false,
      'expires_at', pilot.expires_at
    )
  );
end;
$$;

create function app.stop_private_live_deposit_pilot(
  p_actor_admin_id uuid,
  p_pilot_revision_id uuid,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  stopped_time timestamptz;
  switch_count integer;
begin
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  if p_reason_code is null or p_reason_code not in (
    'owner_stop',
    'provider_incident',
    'parser_drift',
    'execution_uncertainty',
    'cap_review',
    'pilot_complete'
  ) then
    raise exception 'The private live-deposit pilot stop reason is invalid.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 then
    raise exception 'The private live-deposit pilot switch set is incomplete.';
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  stopped_time := clock_timestamp();

  if not found then
    raise exception 'The private live-deposit pilot is unavailable.';
  end if;

  if pilot.status = 'stopped'
    and pilot.stop_reason_code is distinct from p_reason_code then
    raise exception 'The private live-deposit pilot is already stopped for another reason.';
  elsif pilot.status <> 'stopped' then
    update app.private_live_deposit_pilot_revisions pilot_revision
       set status = 'stopped',
           stopped_by_admin_id = p_actor_admin_id,
           stopped_at = stopped_time,
           stop_reason_code = p_reason_code
     where pilot_revision.id = pilot.id;
  end if;

  update app.feature_switches feature_switch
     set mode = 'disabled',
         settings = '{}'::jsonb,
         updated_by_admin_id = p_actor_admin_id
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   );
  get diagnostics switch_count = row_count;

  if switch_count <> 5 then
    raise exception 'The private live-deposit pilot stop did not disable every switch.';
  end if;

  if pilot.status <> 'stopped' then
    insert into app.audit_events (
      actor_kind,
      actor_admin_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) values (
      'admin',
      p_actor_admin_id,
      'deposit.private_live_pilot_stopped',
      'private_live_deposit_pilot',
      pilot.id,
      pg_catalog.jsonb_build_object('reason_code', p_reason_code)
    );
  end if;
end;
$$;

create function app.get_private_live_deposit_pilot_status(
  p_actor_admin_id uuid,
  p_pilot_revision_id uuid
)
returns table (
  pilot_revision_id uuid,
  revision integer,
  contract_version smallint,
  pilot_status text,
  switch_mode text,
  configuration_digest text,
  financially_active boolean,
  within_active_window boolean,
  player_count integer,
  submitting_customer_count integer,
  provider_count integer,
  reserved_deposit_count integer,
  reserved_amount_minor bigint,
  maximum_reservation_count smallint,
  maximum_aggregate_minor bigint,
  expires_at timestamptz,
  stopped_at timestamptz,
  stop_reason_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);

  return query
  select pilot.id,
         pilot.revision,
         pilot.contract_version,
         pilot.status,
         feature_switch.mode::text,
         pilot.configuration_digest,
         (
           pilot.status = 'armed'
           and clock_timestamp() >= pilot.active_from
           and clock_timestamp() < pilot.expires_at
           and feature_switch.mode = 'live'
           and feature_switch.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )
           and (
             select pg_catalog.count(*) = 2
               from app.feature_switches financial_switch
              where financial_switch.feature_key in (
                'deposit_execution',
                'payment_verification'
              ) and financial_switch.mode = 'live'
           )
           and not exists (
             select 1
               from app.private_live_deposit_pilot_providers provider_member
               left join app.feature_switches provider_switch
                 on provider_switch.feature_key =
                   provider_member.provider_code_snapshot || '_authoritative_verification'
              where provider_member.pilot_revision_id = pilot.id
                and (provider_switch.feature_key is null or provider_switch.mode <> 'live')
           )
         ),
         (clock_timestamp() >= pilot.active_from and clock_timestamp() < pilot.expires_at),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_players member
            where member.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_customers member
            where member.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_providers member
            where member.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)::integer
             from app.private_live_deposit_pilot_reservations reservation
            where reservation.pilot_revision_id = pilot.id
         ),
         (
           select coalesce(pg_catalog.sum(reservation.amount_minor), 0)::bigint
             from app.private_live_deposit_pilot_reservations reservation
            where reservation.pilot_revision_id = pilot.id
         ),
         pilot.maximum_reservation_count,
         pilot.maximum_aggregate_minor,
         pilot.expires_at,
         pilot.stopped_at,
         pilot.stop_reason_code
    from app.private_live_deposit_pilot_revisions pilot
    join app.feature_switches feature_switch
      on feature_switch.feature_key = 'private_live_deposit_pilot'
   where pilot.id = p_pilot_revision_id;

  if not found then
    raise exception 'The private live-deposit pilot is unavailable.';
  end if;
end;
$$;

create function app.is_private_live_deposit_pilot_enforced()
returns boolean
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select coalesce((
    select feature_switch.mode = 'live'
      from app.feature_switches feature_switch
     where feature_switch.feature_key = 'private_live_deposit_pilot'
  ), false)
$$;

create function app.reserve_private_live_deposit_pilot_claim(
  p_deposit_payment_claim_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  claim app.deposit_payment_claims%rowtype;
  verification_attempt app.deposit_verification_attempts%rowtype;
  evidence app.provider_payment_evidence%rowtype;
  intent app.deposit_intents%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  existing_reservation app.private_live_deposit_pilot_reservations%rowtype;
  reservation_id uuid;
  proof_id uuid;
  proof_submitting_customer_id uuid;
  proof_submitted_at timestamptz;
  proof_reference_fingerprint text;
  pilot_id uuid;
  proof_count integer;
  live_financial_switch_count integer;
  switch_count integer;
  reservation_count integer;
  aggregate_reserved bigint;
  player_reserved bigint;
  checked_at timestamptz;
begin
  if p_deposit_payment_claim_id is null then
    raise exception 'The private pilot payment claim is required.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if not app.is_private_live_deposit_pilot_enforced() then
    return null;
  end if;

  if switch_count <> 5 then
    raise exception 'The private live-deposit pilot switch set is incomplete.';
  end if;

  select (feature_switch.settings ->> 'pilot_revision_id')::uuid
    into pilot_id
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot'
     and pg_catalog.jsonb_typeof(feature_switch.settings) = 'object'
     and feature_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = pilot_id
   for update;

  checked_at := clock_timestamp();

  if not found
    or pilot.status <> 'armed'
    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or pilot.configuration_digest is null
    or not exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'live'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ) then
    raise exception 'The private live-deposit pilot authority is unavailable.';
  end if;

  select pg_catalog.count(*)::integer
    into live_financial_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('deposit_execution', 'payment_verification')
     and feature_switch.mode = 'live';

  if live_financial_switch_count <> 2 then
    raise exception 'The private live-deposit pilot financial switches are unavailable.';
  end if;

  select payment_claim.*
    into claim
    from app.deposit_payment_claims payment_claim
   where payment_claim.id = p_deposit_payment_claim_id;

  if not found then
    raise exception 'The private pilot payment claim is unavailable.';
  end if;

  select payment_evidence.*
    into evidence
    from app.provider_payment_evidence payment_evidence
   where payment_evidence.id = claim.provider_payment_evidence_id;

  if not found then
    raise exception 'The private pilot provider evidence is unavailable.';
  end if;

  -- This reference-scoped lock follows switch and pilot locks and serializes duplicate proof
  -- candidates before intent/player/job rows. It performs no external work.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      evidence.payment_provider_id::text || ':' || evidence.canonical_reference_fingerprint,
      20260821151428
    )
  );

  -- Re-read and lock the immutable evidence and claim only after the reference-scoped lock. The
  -- initial unlocked reads above resolve the advisory key without introducing a row-lock edge.
  select payment_evidence.*
    into evidence
    from app.provider_payment_evidence payment_evidence
   where payment_evidence.id = evidence.id
   for share;

  select payment_claim.*
    into claim
    from app.deposit_payment_claims payment_claim
   where payment_claim.id = p_deposit_payment_claim_id
     and payment_claim.provider_payment_evidence_id = evidence.id
   for share;

  if not found then
    raise exception 'The private pilot payment claim changed before reservation.';
  end if;

  select reservation.*
    into existing_reservation
    from app.private_live_deposit_pilot_reservations reservation
   where reservation.deposit_payment_claim_id = claim.id
   for share;

  if found then
    return existing_reservation.id;
  end if;

  select verification.*
    into verification_attempt
    from app.deposit_verification_attempts verification
   where verification.id = claim.verification_attempt_id
   for share;

  select deposit_intent.*
    into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = claim.deposit_intent_id
   for update;

  if verification_attempt.id is null
    or intent.id is null
    or verification_attempt.deposit_intent_id is distinct from intent.id
    or verification_attempt.provider_payment_evidence_id is distinct from evidence.id
    or verification_attempt.outcome <> 'verified'
    or evidence.provider_final_status <> 'completed'
    or evidence.payment_provider_id is distinct from intent.payment_provider_id
    or evidence.amount_minor is distinct from intent.expected_amount_minor
    or evidence.currency_code is distinct from intent.currency_code
    or evidence.matched_receiver_account_id is distinct from intent.receiver_account_id
    or evidence.matched_receiver_account_version is distinct from intent.receiver_account_version
    or intent.platform_id is distinct from pilot.platform_id
    or intent.currency_code is distinct from pilot.currency_code
    or evidence.amount_minor < pilot.minimum_amount_minor
    or evidence.amount_minor > pilot.maximum_per_deposit_minor then
    raise exception 'The private pilot payment lineage is inconsistent.';
  end if;

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_account_id = intent.player_account_id
   for share;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.payment_provider_id = intent.payment_provider_id
     and member.receiver_account_id = intent.receiver_account_id
     and member.receiver_account_version = intent.receiver_account_version
   for share;

  perform platform.id
    from app.platforms platform
   where platform.id = pilot.platform_id
   for share;

  perform agent.id
    from app.platform_agent_accounts agent
   where agent.id = pilot.platform_agent_account_id
   for share;

  perform customer.id
    from app.customers customer
   where customer.id in (
     player_member.player_owner_customer_id_snapshot,
     (
       select proof_request.submitting_customer_id
         from app.private_live_deposit_pilot_proofs proof_request
        where proof_request.pilot_revision_id = pilot.id
          and proof_request.player_account_id = intent.player_account_id
          and proof_request.payment_provider_id = intent.payment_provider_id
          and proof_request.provider_code_snapshot = provider_member.provider_code_snapshot
          and proof_request.candidate_reference_fingerprint
              = evidence.canonical_reference_fingerprint
     )
   )
   order by customer.id
   for share;

  perform player.id
    from app.customer_platform_players player
   where player.id = intent.player_account_id
   for share;

  perform decision.id
    from app.player_deposit_eligibility_decisions decision
   where decision.id = player_member.eligibility_decision_id_snapshot
   for share;

  perform payment_provider.id
    from app.payment_providers payment_provider
   where payment_provider.id = intent.payment_provider_id
   for share;

  perform receiver.id
    from app.receiver_accounts receiver
   where receiver.id = intent.receiver_account_id
     and receiver.provider_id = intent.payment_provider_id
     and receiver.version = intent.receiver_account_version
   for share;

  checked_at := clock_timestamp();

  if pilot.status <> 'armed'
    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ) then
    raise exception 'The private live-deposit pilot expired or changed while reserving.';
  end if;

  if player_member.player_account_id is null
    or provider_member.payment_provider_id is null
    or intent.customer_id is distinct from player_member.player_owner_customer_id_snapshot
    or not exists (
      select 1
        from app.platforms platform
       where platform.id = pilot.platform_id
         and platform.code = 'kemerbet'
         and platform.status = 'active'
    )
    or not exists (
      select 1
        from app.platform_agent_accounts agent
       where agent.id = pilot.platform_agent_account_id
         and agent.platform_id = pilot.platform_id
         and agent.status = 'active'
         and agent.label = pilot.platform_agent_label_snapshot
         and agent.updated_at is not distinct from pilot.platform_agent_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key =
             provider_member.provider_code_snapshot || '_authoritative_verification'
         and provider_switch.mode = 'live'
    )
    or not exists (
      select 1
        from app.customer_platform_players player
        join app.customers player_owner_customer
          on player_owner_customer.id = player_member.player_owner_customer_id_snapshot
        join app.player_deposit_eligibility_decisions decision
          on decision.id = player_member.eligibility_decision_id_snapshot
       where player.id = player_member.player_account_id
         and player.player_id = player_member.player_id_snapshot
         and player.customer_id = player_member.player_owner_customer_id_snapshot
         and player_owner_customer.status = 'active'
         and player_owner_customer.status
             = player_member.player_owner_customer_status_snapshot
         and player_owner_customer.updated_at
             is not distinct from player_member.player_owner_customer_updated_at_snapshot
         and player.platform_id = player_member.platform_id_snapshot
         and player.status = 'active'
         and player.validation_status = 'valid'
         and player.updated_at is not distinct from player_member.player_updated_at_snapshot
         and decision.player_account_id = player.id
         and decision.decision_version
             = player_member.eligibility_decision_version_snapshot
         and decision.decision = 'eligible'
         and decision.decided_at = player_member.eligibility_decided_at_snapshot
         and decision.player_account_updated_at_snapshot is not distinct from player.updated_at
         and decision.id = (
           select latest.id
             from app.player_deposit_eligibility_decisions latest
            where latest.player_account_id = player.id
            order by latest.decision_version desc
            limit 1
         )
    )
    or not exists (
      select 1
        from app.payment_providers payment_provider
        join app.receiver_accounts receiver
          on receiver.id = provider_member.receiver_account_id
         and receiver.provider_id = payment_provider.id
         and receiver.version = provider_member.receiver_account_version
       where payment_provider.id = provider_member.payment_provider_id
         and payment_provider.code = provider_member.provider_code_snapshot
         and payment_provider.status = 'active'
         and payment_provider.updated_at
             is not distinct from provider_member.provider_updated_at_snapshot
         and receiver.status = 'active'
         and receiver.account_holder_name
             = provider_member.receiver_account_holder_name_snapshot
         and receiver.account_reference_masked
             = provider_member.receiver_account_masked_snapshot
         and receiver.active_from = provider_member.receiver_active_from_snapshot
         and receiver.updated_at is not distinct from provider_member.receiver_updated_at_snapshot
    ) then
    raise exception 'The private pilot destination or provider snapshot is unavailable.';
  end if;

  select pg_catalog.count(*)::integer
    into proof_count
    from app.private_live_deposit_pilot_proofs proof_request
   where proof_request.pilot_revision_id = pilot.id
     and proof_request.player_account_id = intent.player_account_id
     and proof_request.payment_provider_id = intent.payment_provider_id
     and proof_request.provider_code_snapshot = provider_member.provider_code_snapshot
     and proof_request.candidate_reference_fingerprint
         = evidence.canonical_reference_fingerprint;

  if proof_count <> 1 then
    raise exception 'The authoritative payment must match exactly one private pilot proof.';
  end if;

  select proof_request.id
    into proof_id
    from app.private_live_deposit_pilot_proofs proof_request
   where proof_request.pilot_revision_id = pilot.id
     and proof_request.player_account_id = intent.player_account_id
     and proof_request.payment_provider_id = intent.payment_provider_id
     and proof_request.provider_code_snapshot = provider_member.provider_code_snapshot
     and proof_request.candidate_reference_fingerprint
         = evidence.canonical_reference_fingerprint
   order by proof_request.id
   limit 1;

  select proof_request.submitting_customer_id,
         proof_request.submitted_at,
         proof_request.candidate_reference_fingerprint
    into proof_submitting_customer_id,
         proof_submitted_at,
         proof_reference_fingerprint
    from app.private_live_deposit_pilot_proofs proof_request
   where proof_request.id = proof_id
   for share;

  if not found
    or proof_submitted_at < checked_at - interval '1 hour'
    or proof_submitted_at < evidence.occurred_at - interval '5 minutes'
    or proof_submitted_at > evidence.occurred_at + interval '1 hour'
    or evidence.occurred_at < pilot.active_from - interval '1 hour'
    or evidence.occurred_at >= pilot.expires_at
    or evidence.canonical_reference_fingerprint
       is distinct from proof_reference_fingerprint then
    raise exception 'The private pilot proof is outside the authoritative freshness window.';
  end if;

  if not exists (
    select 1
      from app.private_live_deposit_pilot_customers customer_member
      join app.customers customer on customer.id = customer_member.customer_id
     where customer_member.pilot_revision_id = pilot.id
       and customer_member.customer_id = proof_submitting_customer_id
       and customer.status = 'active'
       and customer.status = customer_member.customer_status_snapshot
       and customer.updated_at is not distinct from customer_member.customer_updated_at_snapshot
  ) then
    raise exception 'The private pilot submitting customer is no longer current.';
  end if;

  select coalesce(pg_catalog.sum(reservation.amount_minor), 0)::bigint,
         pg_catalog.count(*)::integer
    into aggregate_reserved,
         reservation_count
    from app.private_live_deposit_pilot_reservations reservation
   where reservation.pilot_revision_id = pilot.id;

  select coalesce(pg_catalog.sum(reservation.amount_minor), 0)::bigint
    into player_reserved
    from app.private_live_deposit_pilot_reservations reservation
   where reservation.pilot_revision_id = pilot.id
     and reservation.player_account_id = intent.player_account_id;

  if aggregate_reserved + evidence.amount_minor > pilot.maximum_aggregate_minor
    or player_reserved + evidence.amount_minor > pilot.maximum_per_player_minor
    or reservation_count >= pilot.maximum_reservation_count then
    raise exception 'The private live-deposit pilot reservation budget is exhausted.';
  end if;

  insert into app.private_live_deposit_pilot_reservations (
    pilot_revision_id,
    private_live_deposit_pilot_proof_id,
    deposit_intent_id,
    deposit_payment_claim_id,
    verification_attempt_id,
    provider_payment_evidence_id,
    submitting_customer_id,
    player_account_id,
    player_owner_customer_id_snapshot,
    payment_provider_id,
    receiver_account_id,
    receiver_account_version,
    canonical_reference_fingerprint,
    amount_minor,
    currency_code
  ) values (
    pilot.id,
    proof_id,
    intent.id,
    claim.id,
    verification_attempt.id,
    evidence.id,
    proof_submitting_customer_id,
    intent.player_account_id,
    player_member.player_owner_customer_id_snapshot,
    intent.payment_provider_id,
    intent.receiver_account_id,
    intent.receiver_account_version,
    evidence.canonical_reference_fingerprint,
    evidence.amount_minor,
    evidence.currency_code
  ) returning id into reservation_id;

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'worker',
    'private-live-deposit-pilot',
    'deposit.private_live_pilot_reserved',
    'private_live_deposit_pilot_reservation',
    reservation_id,
    pg_catalog.jsonb_build_object(
      'pilot_revision_id', pilot.id,
      'deposit_intent_id', intent.id,
      'provider_payment_evidence_id', evidence.id,
      'amount_minor', evidence.amount_minor,
      'currency_code', evidence.currency_code
    )
  );

  return reservation_id;
end;
$$;

create function app.reserve_private_live_deposit_pilot_claim_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.reserve_private_live_deposit_pilot_claim(new.id);
  return new;
end;
$$;

create trigger deposit_payment_claims_reserve_private_live_pilot
after insert on app.deposit_payment_claims
for each row
execute function app.reserve_private_live_deposit_pilot_claim_trigger();

create function app.require_private_live_deposit_pilot_authorization(
  p_deposit_intent_id uuid,
  p_execution_attempt_id uuid default null
)
returns table (
  pilot_contract_version smallint,
  pilot_revision_id uuid,
  pilot_reservation_id uuid,
  pilot_configuration_digest text,
  pilot_authorization_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  reservation app.private_live_deposit_pilot_reservations%rowtype;
  execution_attempt app.deposit_execution_attempts%rowtype;
  intent app.deposit_intents%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  pilot_id uuid;
  live_financial_switch_count integer;
  execution_job_count integer := 0;
  switch_count integer;
  checked_at timestamptz;
begin
  if p_deposit_intent_id is null then
    raise exception 'The private pilot execution authorization request is invalid.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
  )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 or not app.is_private_live_deposit_pilot_enforced() then
    raise exception 'The private live-deposit pilot is not financially active.';
  end if;

  select (feature_switch.settings ->> 'pilot_revision_id')::uuid
    into pilot_id
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot'
     and pg_catalog.jsonb_typeof(feature_switch.settings) = 'object'
     and feature_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = pilot_id
   for update;

  checked_at := clock_timestamp();

  -- Resolve the immutable evidence/reference advisory key without first taking a row lock. The
  -- reservation is re-read under lock immediately after the advisory lock.
  select pilot_reservation.*
    into reservation
    from app.private_live_deposit_pilot_reservations pilot_reservation
   where pilot_reservation.pilot_revision_id = pilot.id
     and pilot_reservation.deposit_intent_id = p_deposit_intent_id;

  if reservation.id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        reservation.payment_provider_id::text || ':'
          || reservation.canonical_reference_fingerprint,
        20260821151428
      )
    );
  end if;

  select pilot_reservation.*
    into reservation
    from app.private_live_deposit_pilot_reservations pilot_reservation
   where pilot_reservation.pilot_revision_id = pilot.id
     and pilot_reservation.deposit_intent_id = p_deposit_intent_id
   for share;

  perform evidence.id
    from app.provider_payment_evidence evidence
   where evidence.id = reservation.provider_payment_evidence_id
     and evidence.payment_provider_id = reservation.payment_provider_id
     and evidence.canonical_reference_fingerprint
         = reservation.canonical_reference_fingerprint
   for share;

  perform proof.id
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = reservation.private_live_deposit_pilot_proof_id
   for share;

  select deposit_intent.*
    into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = p_deposit_intent_id
   for share;

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_account_id = reservation.player_account_id
   for share;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.payment_provider_id = reservation.payment_provider_id
     and member.receiver_account_id = reservation.receiver_account_id
     and member.receiver_account_version = reservation.receiver_account_version
   for share;

  -- Hold every mutable policy row through the authorization transaction. `FOR SHARE` conflicts
  -- with non-key status/snapshot updates; customer UUID ordering is deterministic, and Player
  -- always precedes its retained eligibility decision.
  perform platform.id
    from app.platforms platform
   where platform.id = pilot.platform_id
   for share;

  perform agent.id
    from app.platform_agent_accounts agent
   where agent.id = pilot.platform_agent_account_id
   for share;

  perform customer.id
    from app.customers customer
   where customer.id in (
     reservation.submitting_customer_id,
     player_member.player_owner_customer_id_snapshot
   )
   order by customer.id
   for share;

  perform player.id
    from app.customer_platform_players player
   where player.id = reservation.player_account_id
   for share;

  perform decision.id
    from app.player_deposit_eligibility_decisions decision
   where decision.id = player_member.eligibility_decision_id_snapshot
   for share;

  perform payment_provider.id
    from app.payment_providers payment_provider
   where payment_provider.id = reservation.payment_provider_id
   for share;

  perform receiver.id
    from app.receiver_accounts receiver
   where receiver.id = reservation.receiver_account_id
     and receiver.provider_id = reservation.payment_provider_id
     and receiver.version = reservation.receiver_account_version
   for share;

  if p_execution_attempt_id is not null then
    select attempt.*
      into execution_attempt
      from app.deposit_execution_attempts attempt
     where attempt.id = p_execution_attempt_id
       and attempt.deposit_intent_id = p_deposit_intent_id
     for share;

    perform job.id
      from app.deposit_jobs job
     where job.id = execution_attempt.deposit_job_id
       and job.deposit_intent_id = reservation.deposit_intent_id
       and job.job_kind = 'execute_deposit'
     for share;
    get diagnostics execution_job_count = row_count;
  end if;

  -- Authorization time is measured after the complete lock set, never before a wait.
  checked_at := clock_timestamp();

  select pg_catalog.count(*)::integer
    into live_financial_switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('deposit_execution', 'payment_verification')
     and feature_switch.mode = 'live';

  if pilot.id is null
    or pilot.status <> 'armed'
    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or pilot.configuration_digest is null
    or reservation.id is null
    or intent.id is null
    or live_financial_switch_count <> 2
    or not exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'live'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or reservation.player_account_id is distinct from intent.player_account_id
    or reservation.player_owner_customer_id_snapshot is distinct from intent.customer_id
    or reservation.payment_provider_id is distinct from intent.payment_provider_id
    or reservation.receiver_account_id is distinct from intent.receiver_account_id
    or reservation.receiver_account_version is distinct from intent.receiver_account_version
    or reservation.amount_minor is distinct from intent.expected_amount_minor
    or reservation.currency_code is distinct from intent.currency_code
    or provider_member.payment_provider_id is null
    or player_member.player_account_id is null
    or not exists (
      select 1
        from app.platforms platform
       where platform.id = pilot.platform_id
         and platform.code = 'kemerbet'
         and platform.status = 'active'
    )
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key =
             provider_member.provider_code_snapshot || '_authoritative_verification'
         and provider_switch.mode = 'live'
    )
    or not exists (
      select 1
        from app.deposit_payment_claims payment_claim
       where payment_claim.id = reservation.deposit_payment_claim_id
         and payment_claim.deposit_intent_id = reservation.deposit_intent_id
         and payment_claim.provider_payment_evidence_id
             = reservation.provider_payment_evidence_id
         and payment_claim.verification_attempt_id = reservation.verification_attempt_id
    )
    or not exists (
      select 1
        from app.deposit_verification_attempts verification
       where verification.id = reservation.verification_attempt_id
         and verification.deposit_intent_id = reservation.deposit_intent_id
         and verification.provider_payment_evidence_id
             = reservation.provider_payment_evidence_id
         and verification.outcome = 'verified'
    )
    or not exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.id = reservation.provider_payment_evidence_id
         and evidence.payment_provider_id = reservation.payment_provider_id
         and evidence.canonical_reference_fingerprint
             = reservation.canonical_reference_fingerprint
         and evidence.amount_minor = reservation.amount_minor
         and evidence.currency_code = reservation.currency_code
         and evidence.matched_receiver_account_id = reservation.receiver_account_id
         and evidence.matched_receiver_account_version = reservation.receiver_account_version
         and evidence.provider_final_status = 'completed'
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_proofs proof
       where proof.id = reservation.private_live_deposit_pilot_proof_id
         and proof.pilot_revision_id = reservation.pilot_revision_id
         and proof.submitting_customer_id = reservation.submitting_customer_id
         and proof.player_account_id = reservation.player_account_id
         and proof.payment_provider_id = reservation.payment_provider_id
         and proof.provider_code_snapshot = provider_member.provider_code_snapshot
         and proof.candidate_reference_fingerprint
             = reservation.canonical_reference_fingerprint
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_customers customer_member
        join app.customers customer on customer.id = customer_member.customer_id
       where customer_member.pilot_revision_id = pilot.id
         and customer_member.customer_id = reservation.submitting_customer_id
         and customer.status = 'active'
         and customer.status = customer_member.customer_status_snapshot
         and customer.updated_at is not distinct from customer_member.customer_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.customer_platform_players player
        join app.customers player_owner_customer
          on player_owner_customer.id = player_member.player_owner_customer_id_snapshot
        join app.player_deposit_eligibility_decisions decision
          on decision.id = player_member.eligibility_decision_id_snapshot
       where player.id = reservation.player_account_id
         and player.player_id = player_member.player_id_snapshot
         and player.customer_id = player_member.player_owner_customer_id_snapshot
         and player_owner_customer.status = 'active'
         and player_owner_customer.status
             = player_member.player_owner_customer_status_snapshot
         and player_owner_customer.updated_at
             is not distinct from player_member.player_owner_customer_updated_at_snapshot
         and player.platform_id = player_member.platform_id_snapshot
         and player.status = 'active'
         and player.validation_status = 'valid'
         and player.updated_at is not distinct from player_member.player_updated_at_snapshot
         and decision.player_account_id = player.id
         and decision.decision_version
             = player_member.eligibility_decision_version_snapshot
         and decision.decision = 'eligible'
         and decision.decided_at = player_member.eligibility_decided_at_snapshot
         and decision.player_account_updated_at_snapshot is not distinct from player.updated_at
         and decision.id = (
           select latest.id
             from app.player_deposit_eligibility_decisions latest
            where latest.player_account_id = player.id
            order by latest.decision_version desc
            limit 1
         )
    )
    or not exists (
      select 1
        from app.payment_providers payment_provider
        join app.receiver_accounts receiver
          on receiver.id = provider_member.receiver_account_id
         and receiver.provider_id = payment_provider.id
         and receiver.version = provider_member.receiver_account_version
       where payment_provider.id = provider_member.payment_provider_id
         and payment_provider.code = provider_member.provider_code_snapshot
         and payment_provider.status = 'active'
         and payment_provider.updated_at
             is not distinct from provider_member.provider_updated_at_snapshot
         and receiver.status = 'active'
         and receiver.account_holder_name
             = provider_member.receiver_account_holder_name_snapshot
         and receiver.account_reference_masked
             = provider_member.receiver_account_masked_snapshot
         and receiver.active_from = provider_member.receiver_active_from_snapshot
         and receiver.updated_at is not distinct from provider_member.receiver_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.platform_agent_accounts agent
       where agent.id = pilot.platform_agent_account_id
         and agent.platform_id = pilot.platform_id
         and agent.status = 'active'
         and agent.label = pilot.platform_agent_label_snapshot
         and agent.updated_at is not distinct from pilot.platform_agent_updated_at_snapshot
    )
    or (p_execution_attempt_id is not null and (
      execution_attempt.id is null
      or execution_attempt.platform_agent_account_id
         is distinct from pilot.platform_agent_account_id
      or execution_job_count <> 1
    )) then
    raise exception 'The private live-deposit pilot execution authorization is invalid.';
  end if;

  return query
  select pilot.contract_version,
         pilot.id,
         reservation.id,
         pilot.configuration_digest,
         reservation.authorization_token;
end;
$$;

create function app.finalize_private_live_verified_deposit_and_enqueue_execution(
  p_deposit_intent_id uuid,
  p_verification_attempt_id uuid,
  p_provider_payment_evidence_id uuid
)
returns table (
  deposit_intent_id uuid,
  payment_claim_id uuid,
  execution_job_id uuid,
  deposit_status text,
  execution_job_status text,
  already_finalized boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  intent app.deposit_intents%rowtype;
  verification_attempt app.deposit_verification_attempts%rowtype;
  evidence_id uuid;
  evidence_payment_provider_id uuid;
  evidence_reference_fingerprint text;
  evidence_provider_final_status text;
  evidence_amount_minor bigint;
  evidence_currency_code character(3);
  evidence_receiver_account_id uuid;
  evidence_receiver_account_version integer;
  proof_id uuid;
  proof_provider_code text;
  proof_submitting_customer_id uuid;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  pilot_id uuid;
  switch_count integer;
  proof_count integer;
  player_member_count integer;
  provider_member_count integer;
  settled_deposit_intent_id uuid;
  settled_payment_claim_id uuid;
  settled_execution_job_id uuid;
  settled_deposit_status text;
  settled_execution_job_status text;
  settlement_already_finalized boolean;
  settlement_updated_at timestamptz;
  authorization record;
  checked_at timestamptz;
begin
  perform app.require_private_live_deposit_pilot_settlement();

  if p_deposit_intent_id is null
    or p_verification_attempt_id is null
    or p_provider_payment_evidence_id is null then
    raise exception 'The private pilot settlement request is invalid.';
  end if;

  -- This wrapper is the settlement runtime's only grant. Taking the complete switch set first
  -- closes the inherited two-switch/intent lock inversion in the legacy settlement procedure.
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  if switch_count <> 5 then
    raise exception 'The private live-deposit pilot switch set is incomplete.';
  end if;

  select case
           when pilot_switch.settings ->> 'pilot_revision_id'
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             then (pilot_switch.settings ->> 'pilot_revision_id')::uuid
           else null::uuid
         end
    into pilot_id
    from app.feature_switches pilot_switch
   where pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'live'
     and pg_catalog.jsonb_typeof(pilot_switch.settings) = 'object'
     and pilot_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = pilot_id
   for update;

  checked_at := clock_timestamp();

  if not found
    or pilot.status <> 'armed'
    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or pilot.configuration_digest is null
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or (
      select pg_catalog.count(*)
        from app.feature_switches financial_switch
       where financial_switch.feature_key in ('deposit_execution', 'payment_verification')
         and financial_switch.mode = 'live'
    ) <> 2 then
    raise exception 'The private live-deposit pilot settlement authority is unavailable.';
  end if;

  -- Unlocked reads resolve the immutable reference-scoped advisory key without adding a row-lock
  -- edge. Every row is re-read under its lock below before any claim or execution job can exist.
  select payment_evidence.id,
         payment_evidence.payment_provider_id,
         payment_evidence.canonical_reference_fingerprint,
         payment_evidence.provider_final_status,
         payment_evidence.amount_minor,
         payment_evidence.currency_code,
         payment_evidence.matched_receiver_account_id,
         payment_evidence.matched_receiver_account_version
    into evidence_id,
         evidence_payment_provider_id,
         evidence_reference_fingerprint,
         evidence_provider_final_status,
         evidence_amount_minor,
         evidence_currency_code,
         evidence_receiver_account_id,
         evidence_receiver_account_version
    from app.provider_payment_evidence payment_evidence
   where payment_evidence.id = p_provider_payment_evidence_id;

  select deposit_intent.*
    into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = p_deposit_intent_id;

  select attempt.*
    into verification_attempt
    from app.deposit_verification_attempts attempt
   where attempt.id = p_verification_attempt_id;

  if evidence_id is null
    or intent.id is null
    or verification_attempt.id is null
    or verification_attempt.deposit_intent_id is distinct from intent.id
    or verification_attempt.provider_payment_evidence_id is distinct from evidence_id
    or verification_attempt.outcome <> 'verified'
    or evidence_provider_final_status <> 'completed'
    or evidence_payment_provider_id is distinct from intent.payment_provider_id
    or evidence_amount_minor is distinct from intent.expected_amount_minor
    or evidence_currency_code is distinct from intent.currency_code
    or evidence_receiver_account_id is distinct from intent.receiver_account_id
    or evidence_receiver_account_version is distinct from intent.receiver_account_version
    or intent.platform_id is distinct from pilot.platform_id then
    raise exception 'The private pilot settlement lineage is inconsistent.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      evidence_payment_provider_id::text || ':' || evidence_reference_fingerprint,
      20260821151428
    )
  );

  select payment_evidence.id,
         payment_evidence.payment_provider_id,
         payment_evidence.canonical_reference_fingerprint,
         payment_evidence.provider_final_status,
         payment_evidence.amount_minor,
         payment_evidence.currency_code,
         payment_evidence.matched_receiver_account_id,
         payment_evidence.matched_receiver_account_version
    into evidence_id,
         evidence_payment_provider_id,
         evidence_reference_fingerprint,
         evidence_provider_final_status,
         evidence_amount_minor,
         evidence_currency_code,
         evidence_receiver_account_id,
         evidence_receiver_account_version
    from app.provider_payment_evidence payment_evidence
   where payment_evidence.id = p_provider_payment_evidence_id
   for share;

  select pg_catalog.count(*)::integer
    into proof_count
    from app.private_live_deposit_pilot_proofs proof_candidate
   where proof_candidate.pilot_revision_id = pilot.id
     and proof_candidate.player_account_id = intent.player_account_id
     and proof_candidate.payment_provider_id = intent.payment_provider_id
     and proof_candidate.candidate_reference_fingerprint
         = evidence_reference_fingerprint;

  if proof_count <> 1 then
    raise exception 'The private pilot settlement requires exactly one live proof.';
  end if;

  select proof_candidate.id,
         proof_candidate.provider_code_snapshot,
         proof_candidate.submitting_customer_id
    into proof_id,
         proof_provider_code,
         proof_submitting_customer_id
    from app.private_live_deposit_pilot_proofs proof_candidate
   where proof_candidate.pilot_revision_id = pilot.id
     and proof_candidate.player_account_id = intent.player_account_id
     and proof_candidate.payment_provider_id = intent.payment_provider_id
     and proof_candidate.candidate_reference_fingerprint
         = evidence_reference_fingerprint
   order by proof_candidate.id
   limit 1
   for share;

  -- Acquire the legacy intent advisory lock only after the pilot evidence/reference lock. The
  -- nested legacy settlement then reacquires this lock, the switches, and the intent reentrantly.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_deposit_intent_id::text, 20260815203606)
  );

  select deposit_intent.*
    into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = p_deposit_intent_id
   for update;

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_account_id = intent.player_account_id
   for share;
  get diagnostics player_member_count = row_count;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.payment_provider_id = intent.payment_provider_id
     and member.receiver_account_id = intent.receiver_account_id
     and member.receiver_account_version = intent.receiver_account_version
   for share;
  get diagnostics provider_member_count = row_count;

  perform platform.id
    from app.platforms platform
   where platform.id = pilot.platform_id
   for share;

  perform agent.id
    from app.platform_agent_accounts agent
   where agent.id = pilot.platform_agent_account_id
   for share;

  perform customer.id
    from app.customers customer
   where customer.id in (
     proof_submitting_customer_id,
     player_member.player_owner_customer_id_snapshot
   )
   order by customer.id
   for share;

  perform player.id
    from app.customer_platform_players player
   where player.id = player_member.player_account_id
   for share;

  perform decision.id
    from app.player_deposit_eligibility_decisions decision
   where decision.id = player_member.eligibility_decision_id_snapshot
   for share;

  perform payment_provider.id
    from app.payment_providers payment_provider
   where payment_provider.id = provider_member.payment_provider_id
   for share;

  perform receiver.id
    from app.receiver_accounts receiver
   where receiver.id = provider_member.receiver_account_id
     and receiver.provider_id = provider_member.payment_provider_id
     and receiver.version = provider_member.receiver_account_version
   for share;

  select attempt.*
    into verification_attempt
    from app.deposit_verification_attempts attempt
   where attempt.id = p_verification_attempt_id
     and attempt.deposit_intent_id = intent.id
     and attempt.provider_payment_evidence_id = evidence_id
   for share;

  checked_at := clock_timestamp();

  if checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or player_member_count <> 1
    or provider_member_count <> 1
    or verification_attempt.id is null
    or proof_id is null
    or proof_provider_code is distinct from provider_member.provider_code_snapshot
    or intent.customer_id is distinct from player_member.player_owner_customer_id_snapshot
    or not exists (
      select 1
        from app.platforms platform
       where platform.id = pilot.platform_id
         and platform.code = 'kemerbet'
         and platform.status = 'active'
    )
    or not exists (
      select 1
        from app.platform_agent_accounts agent
       where agent.id = pilot.platform_agent_account_id
         and agent.platform_id = pilot.platform_id
         and agent.status = 'active'
         and agent.label = pilot.platform_agent_label_snapshot
         and agent.updated_at is not distinct from pilot.platform_agent_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_customers customer_member
        join app.customers customer on customer.id = customer_member.customer_id
       where customer_member.pilot_revision_id = pilot.id
         and customer_member.customer_id = proof_submitting_customer_id
         and customer.status = 'active'
         and customer.status = customer_member.customer_status_snapshot
         and customer.updated_at is not distinct from customer_member.customer_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.customer_platform_players player
        join app.customers player_owner_customer
          on player_owner_customer.id = player_member.player_owner_customer_id_snapshot
        join app.player_deposit_eligibility_decisions decision
          on decision.id = player_member.eligibility_decision_id_snapshot
       where player.id = player_member.player_account_id
         and player.player_id = player_member.player_id_snapshot
         and player.customer_id = player_member.player_owner_customer_id_snapshot
         and player_owner_customer.status = 'active'
         and player_owner_customer.status
             = player_member.player_owner_customer_status_snapshot
         and player_owner_customer.updated_at
             is not distinct from player_member.player_owner_customer_updated_at_snapshot
         and player.platform_id = player_member.platform_id_snapshot
         and player.status = 'active'
         and player.validation_status = 'valid'
         and player.updated_at is not distinct from player_member.player_updated_at_snapshot
         and decision.player_account_id = player.id
         and decision.decision_version
             = player_member.eligibility_decision_version_snapshot
         and decision.decision = 'eligible'
         and decision.decided_at = player_member.eligibility_decided_at_snapshot
         and decision.player_account_updated_at_snapshot is not distinct from player.updated_at
         and decision.id = (
           select latest.id
             from app.player_deposit_eligibility_decisions latest
            where latest.player_account_id = player.id
            order by latest.decision_version desc
            limit 1
         )
    )
    or not exists (
      select 1
        from app.payment_providers payment_provider
        join app.receiver_accounts receiver
          on receiver.id = provider_member.receiver_account_id
         and receiver.provider_id = payment_provider.id
         and receiver.version = provider_member.receiver_account_version
       where payment_provider.id = provider_member.payment_provider_id
         and payment_provider.code = provider_member.provider_code_snapshot
         and payment_provider.status = 'active'
         and payment_provider.updated_at
             is not distinct from provider_member.provider_updated_at_snapshot
         and receiver.status = 'active'
         and receiver.account_holder_name
             = provider_member.receiver_account_holder_name_snapshot
         and receiver.account_reference_masked
             = provider_member.receiver_account_masked_snapshot
         and receiver.active_from = provider_member.receiver_active_from_snapshot
         and receiver.updated_at is not distinct from provider_member.receiver_updated_at_snapshot
    )
    or not exists (
      select 1
        from app.feature_switches provider_switch
        join app.private_live_deposit_pilot_providers provider_member
          on provider_member.pilot_revision_id = pilot.id
         and provider_member.payment_provider_id = intent.payment_provider_id
         and provider_switch.feature_key =
             provider_member.provider_code_snapshot || '_authoritative_verification'
       where provider_switch.mode = 'live'
    ) then
    raise exception 'The private pilot settlement proof is not authorized.';
  end if;

  select settlement.deposit_intent_id,
         settlement.payment_claim_id,
         settlement.execution_job_id,
         settlement.deposit_status,
         settlement.execution_job_status,
         settlement.already_finalized,
         settlement.updated_at
    into settled_deposit_intent_id,
         settled_payment_claim_id,
         settled_execution_job_id,
         settled_deposit_status,
         settled_execution_job_status,
         settlement_already_finalized,
         settlement_updated_at
    from app.finalize_verified_deposit_and_enqueue_execution(
      p_deposit_intent_id,
      p_verification_attempt_id,
      p_provider_payment_evidence_id
    ) settlement;

  if not found
    or settled_deposit_intent_id is distinct from p_deposit_intent_id
    or settled_payment_claim_id is null
    or settled_execution_job_id is null then
    raise exception 'The private pilot settlement result is inconsistent.';
  end if;

  select pilot_authorization.*
    into authorization
    from app.require_private_live_deposit_pilot_authorization(
      settled_deposit_intent_id,
      null
    ) pilot_authorization;

  if authorization.pilot_reservation_id is null
    or not exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.id = authorization.pilot_reservation_id
         and reservation.deposit_payment_claim_id = settled_payment_claim_id
         and reservation.deposit_intent_id = settled_deposit_intent_id
         and reservation.verification_attempt_id = p_verification_attempt_id
         and reservation.provider_payment_evidence_id = p_provider_payment_evidence_id
    ) then
    raise exception 'The private pilot settlement did not retain exact authorization.';
  end if;

  return query
  select settled_deposit_intent_id,
         settled_payment_claim_id,
         settled_execution_job_id,
         settled_deposit_status,
         settled_execution_job_status,
         settlement_already_finalized,
         settlement_updated_at;
end;
$$;

create function app.require_private_live_deposit_pilot_execution_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.job_kind = 'execute_deposit'
    and (
      app.is_private_live_deposit_pilot_enforced()
      or exists (
        select 1
          from app.private_live_deposit_pilot_reservations reservation
         where reservation.deposit_intent_id = new.deposit_intent_id
      )
    ) then
    perform 1
      from app.require_private_live_deposit_pilot_authorization(
        new.deposit_intent_id,
        null
      );
  end if;
  return new;
end;
$$;

create trigger deposit_jobs_require_private_live_pilot_reservation
before insert on app.deposit_jobs
for each row
execute function app.require_private_live_deposit_pilot_execution_job();

create function app.recheck_private_live_deposit_pilot_job_lease()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.job_kind = 'execute_deposit'
    and new.status = 'leased'
    and old.status <> 'leased'
    and (
      app.is_private_live_deposit_pilot_enforced()
      or exists (
        select 1
          from app.private_live_deposit_pilot_reservations reservation
         where reservation.deposit_intent_id = new.deposit_intent_id
      )
    ) then
    perform 1
      from app.require_private_live_deposit_pilot_authorization(
        new.deposit_intent_id,
        null
      );
  end if;
  return new;
end;
$$;

create trigger deposit_jobs_recheck_private_live_pilot_lease
before update on app.deposit_jobs
for each row
execute function app.recheck_private_live_deposit_pilot_job_lease();

create function app.recheck_private_live_deposit_pilot_final_action()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'final_action_fenced'
    and old.status <> 'final_action_fenced'
    and (
      app.is_private_live_deposit_pilot_enforced()
      or exists (
        select 1
          from app.private_live_deposit_pilot_reservations reservation
         where reservation.deposit_intent_id = new.deposit_intent_id
      )
    ) then
    perform 1
      from app.require_private_live_deposit_pilot_authorization(
        new.deposit_intent_id,
        new.id
      );
  end if;
  return new;
end;
$$;

create trigger deposit_execution_attempts_recheck_private_live_pilot
before update on app.deposit_execution_attempts
for each row
execute function app.recheck_private_live_deposit_pilot_final_action();

create function app.lease_next_private_live_deposit_execution(
  p_worker_instance_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  deposit_intent_id uuid,
  execution_job_id uuid,
  execution_attempt_id uuid,
  platform_agent_account_id uuid,
  player_id text,
  amount_minor bigint,
  currency_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_disposition text,
  pilot_contract_version smallint,
  pilot_revision_id uuid,
  pilot_reservation_id uuid,
  pilot_configuration_digest text,
  pilot_authorization_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  leased_deposit_intent_id uuid;
  leased_execution_job_id uuid;
  leased_execution_attempt_id uuid;
  leased_platform_agent_account_id uuid;
  leased_player_id text;
  leased_amount_minor bigint;
  leased_currency_code text;
  leased_token uuid;
  leased_expires_at timestamptz;
  leased_disposition text;
  authorization record;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  pilot_id uuid;
  checked_at timestamptz;
  switch_count integer;
begin
  perform app.require_private_live_deposit_pilot_executor();

  -- Stopped, expired, malformed, and not-yet-activated pilots are normal idle states. Holding the
  -- switch rows through the nested legacy lease prevents Owner stop from interleaving after this
  -- check. A row actually leased under an active pilot is still validated again below.
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
  )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select case
           when pilot_switch.settings ->> 'pilot_revision_id'
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             then (pilot_switch.settings ->> 'pilot_revision_id')::uuid
           else null::uuid
         end
    into pilot_id
    from app.feature_switches pilot_switch
   where pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'live'
     and pg_catalog.jsonb_typeof(pilot_switch.settings) = 'object'
     and pilot_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = pilot_id
   for update;

  checked_at := clock_timestamp();

  if switch_count <> 5
    or pilot.id is null
    or pilot.status <> 'armed'
    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'live'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or (
      select pg_catalog.count(*)
        from app.feature_switches financial_switch
       where financial_switch.feature_key in ('deposit_execution', 'payment_verification')
         and financial_switch.mode = 'live'
    ) <> 2
    or exists (
      select 1
        from app.private_live_deposit_pilot_providers provider_member
        left join app.feature_switches provider_switch
          on provider_switch.feature_key =
            provider_member.provider_code_snapshot || '_authoritative_verification'
       where provider_member.pilot_revision_id = pilot.id
         and (provider_switch.feature_key is null or provider_switch.mode <> 'live')
    ) then
    return;
  end if;

  select lease.deposit_intent_id,
         lease.execution_job_id,
         lease.execution_attempt_id,
         lease.platform_agent_account_id,
         lease.player_id,
         lease.amount_minor,
         lease.currency_code,
         lease.lease_token,
         lease.lease_expires_at,
         lease.lease_disposition
    into leased_deposit_intent_id,
         leased_execution_job_id,
         leased_execution_attempt_id,
         leased_platform_agent_account_id,
         leased_player_id,
         leased_amount_minor,
         leased_currency_code,
         leased_token,
         leased_expires_at,
         leased_disposition
    from app.lease_next_deposit_execution(
      p_worker_instance_id,
      p_lease_seconds
    ) lease;

  if not found then
    -- Disabled, stopped, expired, and simply idle pilots are normal zero-row results.
    return;
  end if;

  if leased_disposition = 'recovered_expired_prepared' then
    return query
    select leased_deposit_intent_id,
           leased_execution_job_id,
           leased_execution_attempt_id,
           leased_platform_agent_account_id,
           leased_player_id,
           leased_amount_minor,
           leased_currency_code,
           leased_token,
           leased_expires_at,
           leased_disposition,
           null::smallint,
           null::uuid,
           null::uuid,
           null::text,
           null::uuid;
    return;
  end if;

  if leased_disposition <> 'execution'
    or leased_deposit_intent_id is null
    or leased_execution_attempt_id is null then
    raise exception 'The private pilot lease returned an invalid disposition.';
  end if;

  select pilot_authorization.*
    into authorization
    from app.require_private_live_deposit_pilot_authorization(
      leased_deposit_intent_id,
      leased_execution_attempt_id
    ) pilot_authorization;

  if authorization.pilot_reservation_id is null then
    raise exception 'The private pilot lease lacks database authorization.';
  end if;

  return query
  select leased_deposit_intent_id,
         leased_execution_job_id,
         leased_execution_attempt_id,
         leased_platform_agent_account_id,
         leased_player_id,
         leased_amount_minor,
         leased_currency_code,
         leased_token,
         leased_expires_at,
         leased_disposition,
         authorization.pilot_contract_version,
         authorization.pilot_revision_id,
         authorization.pilot_reservation_id,
         authorization.pilot_configuration_digest,
         authorization.pilot_authorization_token;
end;
$$;

create function app.fence_private_live_deposit_execution_final_action(
  p_execution_attempt_id uuid,
  p_lease_token uuid,
  p_pilot_revision_id uuid,
  p_pilot_reservation_id uuid,
  p_pilot_authorization_token uuid
)
returns table (
  deposit_intent_id uuid,
  execution_attempt_id uuid,
  final_action_fenced_at timestamptz,
  first_fence_acquired boolean,
  pilot_contract_version smallint,
  pilot_revision_id uuid,
  pilot_reservation_id uuid,
  pilot_configuration_digest text,
  pilot_authorization_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_deposit_intent_id uuid;
  fenced_deposit_intent_id uuid;
  fenced_execution_attempt_id uuid;
  fenced_at timestamptz;
  first_fence boolean;
  authorization record;
begin
  perform app.require_private_live_deposit_pilot_executor();

  if p_execution_attempt_id is null
    or p_lease_token is null
    or p_pilot_revision_id is null
    or p_pilot_reservation_id is null
    or p_pilot_authorization_token is null then
    raise exception 'The private pilot final-action fence request is invalid.';
  end if;

  select attempt.deposit_intent_id
    into resolved_deposit_intent_id
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id;

  if not found then
    raise exception 'The private pilot execution attempt is unavailable.';
  end if;

  select pilot_authorization.*
    into authorization
    from app.require_private_live_deposit_pilot_authorization(
      resolved_deposit_intent_id,
      p_execution_attempt_id
    ) pilot_authorization;

  if authorization.pilot_revision_id is distinct from p_pilot_revision_id
    or authorization.pilot_reservation_id is distinct from p_pilot_reservation_id
    or authorization.pilot_authorization_token is distinct from p_pilot_authorization_token then
    raise exception 'The private pilot lease authorization does not match the final action.';
  end if;

  select fence.deposit_intent_id,
         fence.execution_attempt_id,
         fence.final_action_fenced_at,
         fence.first_fence_acquired
    into fenced_deposit_intent_id,
         fenced_execution_attempt_id,
         fenced_at,
         first_fence
    from app.fence_deposit_execution_final_action(
      p_execution_attempt_id,
      p_lease_token
    ) fence;

  if not found
    or fenced_deposit_intent_id is distinct from resolved_deposit_intent_id
    or fenced_execution_attempt_id is distinct from p_execution_attempt_id then
    raise exception 'The private pilot final-action fence result is inconsistent.';
  end if;

  select pilot_authorization.*
    into authorization
    from app.require_private_live_deposit_pilot_authorization(
      fenced_deposit_intent_id,
      fenced_execution_attempt_id
    ) pilot_authorization;

  if authorization.pilot_revision_id is distinct from p_pilot_revision_id
    or authorization.pilot_reservation_id is distinct from p_pilot_reservation_id
    or authorization.pilot_authorization_token is distinct from p_pilot_authorization_token then
    raise exception 'The private pilot authority changed while fencing final action.';
  end if;

  return query
  select fenced_deposit_intent_id,
         fenced_execution_attempt_id,
         fenced_at,
         first_fence,
         authorization.pilot_contract_version,
         authorization.pilot_revision_id,
         authorization.pilot_reservation_id,
         authorization.pilot_configuration_digest,
         authorization.pilot_authorization_token;
end;
$$;

create unique index private_live_deposit_pilot_one_armed_revision_idx
  on app.private_live_deposit_pilot_revisions ((true))
  where status = 'armed';

alter table app.private_live_deposit_pilot_revisions enable row level security;
alter table app.private_live_deposit_pilot_revisions force row level security;
alter table app.private_live_deposit_pilot_players enable row level security;
alter table app.private_live_deposit_pilot_players force row level security;
alter table app.private_live_deposit_pilot_customers enable row level security;
alter table app.private_live_deposit_pilot_customers force row level security;
alter table app.private_live_deposit_pilot_providers enable row level security;
alter table app.private_live_deposit_pilot_providers force row level security;
alter table app.private_live_deposit_pilot_proofs enable row level security;
alter table app.private_live_deposit_pilot_proofs force row level security;
alter table app.private_live_deposit_pilot_reservations enable row level security;
alter table app.private_live_deposit_pilot_reservations force row level security;

alter table app.private_live_deposit_pilot_revisions owner to postgres;
alter table app.private_live_deposit_pilot_players owner to postgres;
alter table app.private_live_deposit_pilot_customers owner to postgres;
alter table app.private_live_deposit_pilot_providers owner to postgres;
alter table app.private_live_deposit_pilot_proofs owner to postgres;
alter table app.private_live_deposit_pilot_reservations owner to postgres;

alter function app.private_live_deposit_pilot_sha256(text) owner to postgres;
alter function app.reject_private_live_deposit_pilot_retained_mutation() owner to postgres;
alter function app.reject_private_live_deposit_pilot_truncate() owner to postgres;
alter function app.enforce_private_live_deposit_pilot_membership_insert() owner to postgres;
alter function app.enforce_private_live_deposit_pilot_proof_insert() owner to postgres;
alter function app.enforce_private_live_deposit_pilot_revision_transition() owner to postgres;
alter function app.compute_private_live_deposit_pilot_configuration_digest(uuid)
  owner to postgres;
alter function app.require_private_live_deposit_pilot_owner_controller() owner to postgres;
alter function app.require_private_live_deposit_pilot_executor() owner to postgres;
alter function app.require_private_live_deposit_pilot_settlement() owner to postgres;
alter function app.require_active_owner_for_private_live_deposit_pilot(uuid)
  owner to postgres;
alter function app.prepare_private_live_deposit_pilot(
  uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
  timestamptz, timestamptz
) owner to postgres;
alter function app.arm_private_live_deposit_pilot(uuid, uuid) owner to postgres;
alter function app.stop_private_live_deposit_pilot(uuid, uuid, text) owner to postgres;
alter function app.get_private_live_deposit_pilot_status(uuid, uuid) owner to postgres;
alter function app.is_private_live_deposit_pilot_enforced() owner to postgres;
alter function app.reserve_private_live_deposit_pilot_claim(uuid) owner to postgres;
alter function app.reserve_private_live_deposit_pilot_claim_trigger() owner to postgres;
alter function app.require_private_live_deposit_pilot_authorization(uuid, uuid)
  owner to postgres;
alter function app.finalize_private_live_verified_deposit_and_enqueue_execution(
  uuid, uuid, uuid
) owner to postgres;
alter function app.require_private_live_deposit_pilot_execution_job() owner to postgres;
alter function app.recheck_private_live_deposit_pilot_job_lease() owner to postgres;
alter function app.recheck_private_live_deposit_pilot_final_action() owner to postgres;
alter function app.lease_next_private_live_deposit_execution(uuid, integer)
  owner to postgres;
alter function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) owner to postgres;

revoke all privileges on table
  app.private_live_deposit_pilot_revisions,
  app.private_live_deposit_pilot_players,
  app.private_live_deposit_pilot_customers,
  app.private_live_deposit_pilot_providers,
  app.private_live_deposit_pilot_proofs,
  app.private_live_deposit_pilot_reservations
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all privileges on sequence app.private_live_deposit_pilot_revisions_revision_seq
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function
  app.private_live_deposit_pilot_sha256(text),
  app.reject_private_live_deposit_pilot_retained_mutation(),
  app.reject_private_live_deposit_pilot_truncate(),
  app.enforce_private_live_deposit_pilot_membership_insert(),
  app.enforce_private_live_deposit_pilot_proof_insert(),
  app.enforce_private_live_deposit_pilot_revision_transition(),
  app.compute_private_live_deposit_pilot_configuration_digest(uuid),
  app.require_private_live_deposit_pilot_owner_controller(),
  app.require_private_live_deposit_pilot_executor(),
  app.require_private_live_deposit_pilot_settlement(),
  app.require_active_owner_for_private_live_deposit_pilot(uuid),
  app.is_private_live_deposit_pilot_enforced(),
  app.reserve_private_live_deposit_pilot_claim(uuid),
  app.reserve_private_live_deposit_pilot_claim_trigger(),
  app.require_private_live_deposit_pilot_authorization(uuid, uuid),
  app.require_private_live_deposit_pilot_execution_job(),
  app.recheck_private_live_deposit_pilot_job_lease(),
  app.recheck_private_live_deposit_pilot_final_action()
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function
  app.prepare_private_live_deposit_pilot(
    uuid, uuid, text[], text[], uuid[], bigint, bigint, bigint, bigint, smallint,
    timestamptz, timestamptz
  ),
  app.arm_private_live_deposit_pilot(uuid, uuid),
  app.stop_private_live_deposit_pilot(uuid, uuid, text),
  app.get_private_live_deposit_pilot_status(uuid, uuid)
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function
  app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid, uuid, uuid)
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function
  app.lease_next_private_live_deposit_execution(uuid, integer),
  app.fence_private_live_deposit_execution_final_action(uuid, uuid, uuid, uuid, uuid)
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

-- The executor must use the pilot wrappers for all new final-action authority. Cancellation and
-- reconciliation procedures remain available so a stopped pilot can still converge uncertainty.
revoke execute on function app.lease_next_deposit_execution(uuid, integer)
from fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke execute on function app.fence_deposit_execution_final_action(uuid, uuid)
from fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke execute on function app.finalize_verified_deposit_and_enqueue_execution(uuid, uuid, uuid)
from fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
revoke execute on function app.open_telegram_live_deposit_intent(uuid, text, bigint, text)
from fetanagent_player_actions, fetanagent_player_actions_runtime;
revoke execute on function
  app.capture_telegram_live_deposit_reference(
    uuid, uuid, text, text, text, smallint, text
  )
from fetanagent_player_actions, fetanagent_player_actions_runtime;
revoke execute on function app.open_customer_web_deposit_intent(uuid, uuid, text, bigint)
from fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke execute on function
  app.capture_customer_web_deposit_reference(
    uuid, uuid, uuid, text, text, text, smallint
  )
from fetanagent_customer_web, fetanagent_customer_web_runtime;

grant usage on schema app
to fetanagent_owner_control,
   fetanagent_deposit_executor,
   fetanagent_verification_settlement;

-- The four Owner pilot-control routines remain deliberately ungranted. A later forward-only
-- activation slice must add a typed Owner adapter, its exact catalog preflight, authenticated
-- routes, and idempotent audit coverage before any runtime can prepare, arm, inspect, or stop a
-- private-money pilot. Migration-owner calls below are used only by disposable SQL tests.

grant execute on function app.lease_next_private_live_deposit_execution(uuid, integer)
  to fetanagent_deposit_executor;
grant execute on function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) to fetanagent_deposit_executor;
grant execute on function app.finalize_private_live_verified_deposit_and_enqueue_execution(
  uuid, uuid, uuid
) to fetanagent_verification_settlement;

comment on table app.private_live_deposit_pilot_revisions is
  'Private immutable five-Player-ID pilot manifests. Armed means configuration-ready and dormant; only a later reviewed activation migration may make the pilot financially active.';
comment on table app.private_live_deposit_pilot_players is
  'Exactly five immutable KemerBet Player-ID, canonical owner-customer status/revision, platform, Player row-version, and eligibility-decision snapshots for one pilot revision.';
comment on table app.private_live_deposit_pilot_providers is
  'Immutable provider and exact receiver-account revision snapshots; one receiver revision per configured provider.';
comment on table app.private_live_deposit_pilot_proofs is
  'Append-only amount-free live pilot proofs. Existing dry-run deposit_proof_requests are never promotable; no role can insert this ledger until a separate reviewed proof-first intake migration grants one narrow procedure.';
comment on table app.private_live_deposit_pilot_reservations is
  'Append-only, never-released pilot budget consumption binding one proof, intent, claim, verification attempt, provider evidence, customer, Player ID, receiver revision, amount, and database-authored authorization token.';
comment on function app.arm_private_live_deposit_pilot(uuid, uuid) is
  'Freezes a verified pilot configuration but leaves the pilot in dry_run and all financial switches disabled. It grants no financial authority.';
comment on function app.stop_private_live_deposit_pilot(uuid, uuid, text) is
  'Idempotently stops one exact pilot and disables both provider-verification switches plus payment verification, deposit execution, and the pilot switch. Immutable reservations and reconciliation evidence remain.';
comment on function app.finalize_private_live_verified_deposit_and_enqueue_execution(
  uuid, uuid, uuid
) is
  'The settlement runtime''s only live-deposit settlement RPC. It preserves the legacy seven-column return contract, prelocks the complete pilot authority lineage, and returns only after one immutable reservation exists.';
comment on function app.lease_next_private_live_deposit_execution(uuid, integer) is
  'The only executor-granted live-deposit lease. Execution rows carry an immutable database-authored pilot revision/reservation/configuration/token envelope; recovery sentinels carry five null pilot fields.';
comment on function app.fence_private_live_deposit_execution_final_action(
  uuid, uuid, uuid, uuid, uuid
) is
  'Rechecks the exact lease pilot envelope atomically before and after the one-shot final-action fence; only first_fence_acquired=true with an identical returned envelope can authorize an external click.';

commit;
