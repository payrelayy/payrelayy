-- PayReplayy Stage 15: invite-only Telegram beta admission boundary.
--
-- This migration is intentionally local and inactive until separately reviewed and applied. It
-- retires the generic private Telegram recorder because that procedure could auto-provision an
-- unknown sender. A dedicated, non-login admission role may redeem a pre-issued, digest-only
-- invite exactly once for one private Telegram user/chat scope. It creates no credential, API
-- route, Telegram polling/webhook, container, scheduler, payment flow, or KemerBet action.

begin;

-- Do not silently convert a generic-inbox population into the invite-only beta. These locks make
-- the preflight and the legacy-revocation transition one stable cutover: an in-flight legacy
-- writer finishes first, and no new writer can create a Telegram record before this transaction
-- either fails closed or commits the retirements below.
lock table app.inbound_events in access exclusive mode;
lock table app.bot_conversations in access exclusive mode;
lock table app.telegram_identities in access exclusive mode;
lock table app.customer_identities in access exclusive mode;
lock table app.customers in access exclusive mode;
lock table app.audit_events in access exclusive mode;

do $$
begin
  if exists (
    select 1
    from app.telegram_identities
  ) or exists (
    select 1
    from app.customer_identities customer_identity
    where customer_identity.identity_kind = 'telegram'
  ) or exists (
    select 1
    from app.bot_conversations
  ) or exists (
    select 1
    from app.inbound_events inbound_event
    where inbound_event.channel = 'telegram'
  ) then
    raise exception 'Cannot enable invite-only Telegram beta admission while legacy Telegram identities, conversations, or inbound events exist.';
  end if;
end;
$$;

-- The beta admission runtime is deliberately separate from the generic API runtime. It has no
-- password, cannot log in, cannot SET ROLE, and receives only the two reviewed procedures below.
create role payreplayy_beta_admission
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

create role payreplayy_beta_admission_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

-- PostgreSQL 17 membership options deliberately allow only inherited admission-group privileges.
-- The later credential-provisioning step, if approved, must remain separate from this migration.
grant payreplayy_beta_admission to payreplayy_beta_admission_runtime
  with inherit true, set false, admin false;

-- A beta invite stores only a canonical digest of a cryptographically random, domain-separated
-- invite token. The raw deep-link token never enters this table, an audit event, or an inbound
-- event. Active invites become terminal exactly once: redeemed or revoked. Expiry is immutable
-- and evaluated at redemption time, so an expired row never needs a mutating maintenance job.
create table app.telegram_beta_invites (
  token_digest text primary key,
  status text not null default 'active',
  expires_at timestamptz not null,
  issued_by_admin_id uuid references app.admin_users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  redeemed_telegram_user_id bigint,
  redeemed_private_chat_id bigint,
  redeemed_customer_id uuid references app.customers (id) on delete restrict,
  redeemed_customer_identity_id uuid
    references app.customer_identities (id) on delete restrict,
  redeemed_inbound_event_id uuid references app.inbound_events (id) on delete restrict,
  redeemed_at timestamptz,
  revoked_at timestamptz,

  constraint telegram_beta_invites_token_digest_check check (
    token_digest = lower(btrim(token_digest))
    and token_digest ~ '^sha256-v1:[0-9a-f]{64}$'
  ),
  constraint telegram_beta_invites_status_check check (
    status = lower(btrim(status))
    and status in ('active', 'redeemed', 'revoked')
  ),
  constraint telegram_beta_invites_finite_times_check check (
    isfinite(expires_at)
    and isfinite(created_at)
    and (redeemed_at is null or isfinite(redeemed_at))
    and (revoked_at is null or isfinite(revoked_at))
  ),
  constraint telegram_beta_invites_expiry_after_creation_check check (
    expires_at > created_at
  ),
  constraint telegram_beta_invites_lifecycle_shape_check check (
    (
      status = 'active'
      and redeemed_telegram_user_id is null
      and redeemed_private_chat_id is null
      and redeemed_customer_id is null
      and redeemed_customer_identity_id is null
      and redeemed_inbound_event_id is null
      and redeemed_at is null
      and revoked_at is null
    )
    or (
      status = 'redeemed'
      and redeemed_telegram_user_id is not null
      and redeemed_telegram_user_id > 0
      and redeemed_private_chat_id is not null
      and redeemed_private_chat_id > 0
      and redeemed_private_chat_id = redeemed_telegram_user_id
      and redeemed_customer_id is not null
      and redeemed_customer_identity_id is not null
      and redeemed_inbound_event_id is not null
      and redeemed_at is not null
      and redeemed_at >= created_at
      and redeemed_at <= expires_at
      and revoked_at is null
    )
    or (
      status = 'revoked'
      and redeemed_telegram_user_id is null
      and redeemed_private_chat_id is null
      and redeemed_customer_id is null
      and redeemed_customer_identity_id is null
      and redeemed_inbound_event_id is null
      and redeemed_at is null
      and revoked_at is not null
      and revoked_at >= created_at
    )
  )
);

-- These indexes support the exact one-to-one terminal bindings and protect future owner-only
-- issuance/revocation tooling from accidental duplicate associations.
create unique index telegram_beta_invites_redeemed_identity_key
  on app.telegram_beta_invites (redeemed_customer_identity_id)
  where redeemed_customer_identity_id is not null;

create unique index telegram_beta_invites_redeemed_inbound_event_key
  on app.telegram_beta_invites (redeemed_inbound_event_id)
  where redeemed_inbound_event_id is not null;

create unique index telegram_beta_invites_redeemed_telegram_scope_key
  on app.telegram_beta_invites (
    redeemed_telegram_user_id,
    redeemed_private_chat_id
  )
  where status = 'redeemed';

create index telegram_beta_invites_active_expiry_idx
  on app.telegram_beta_invites (expires_at, token_digest)
  where status = 'active';

-- Only a privileged future owner-control-plane operation may create a row. The transition itself
-- is verified here so even a future helper cannot retarget the token, expiry, customer, user,
-- chat, or source update after the fact.
create function app.enforce_telegram_beta_invite_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active'
      or new.redeemed_telegram_user_id is not null
      or new.redeemed_private_chat_id is not null
      or new.redeemed_customer_id is not null
      or new.redeemed_customer_identity_id is not null
      or new.redeemed_inbound_event_id is not null
      or new.redeemed_at is not null
      or new.revoked_at is not null then
      raise exception 'A Telegram beta invite must be issued as active.';
    end if;

    return new;
  end if;

  if new.token_digest is distinct from old.token_digest
    or new.expires_at is distinct from old.expires_at
    or new.issued_by_admin_id is distinct from old.issued_by_admin_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Telegram beta invite issuance fields are immutable.';
  end if;

  if old.status <> 'active' then
    raise exception 'A terminal Telegram beta invite cannot be changed.';
  end if;

  if new.status = 'redeemed' then
    if new.redeemed_telegram_user_id is null
      or new.redeemed_private_chat_id is null
      or new.redeemed_customer_id is null
      or new.redeemed_customer_identity_id is null
      or new.redeemed_inbound_event_id is null
      or new.redeemed_at is null
      or new.revoked_at is not null then
      raise exception 'A redeemed Telegram beta invite requires its immutable admission binding.';
    end if;

    if clock_timestamp() > old.expires_at then
      raise exception 'An expired Telegram beta invite cannot be redeemed.';
    end if;

    if not exists (
      select 1
      from app.customer_identities customer_identity
      join app.telegram_identities telegram_identity
        on telegram_identity.customer_identity_id = customer_identity.id
      join app.inbound_events inbound_event
        on inbound_event.id = new.redeemed_inbound_event_id
      where customer_identity.id = new.redeemed_customer_identity_id
        and customer_identity.customer_id = new.redeemed_customer_id
        and customer_identity.identity_kind = 'telegram'
        and customer_identity.external_subject = new.redeemed_telegram_user_id::text
        and telegram_identity.telegram_user_id = new.redeemed_telegram_user_id
        and telegram_identity.private_chat_id = new.redeemed_private_chat_id
        and inbound_event.channel = 'telegram'
        and inbound_event.customer_identity_id = new.redeemed_customer_identity_id
    ) then
      raise exception 'A redeemed Telegram beta invite must bind one matching Telegram identity and inbound update.';
    end if;

    return new;
  end if;

  if new.status = 'revoked' then
    if new.revoked_at is null
      or new.redeemed_telegram_user_id is not null
      or new.redeemed_private_chat_id is not null
      or new.redeemed_customer_id is not null
      or new.redeemed_customer_identity_id is not null
      or new.redeemed_inbound_event_id is not null
      or new.redeemed_at is not null then
      raise exception 'A revoked Telegram beta invite must not retain an admission binding.';
    end if;

    return new;
  end if;

  raise exception 'A Telegram beta invite may transition only from active to redeemed or revoked.';
end;
$$;

create function app.reject_telegram_beta_invite_delete()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Telegram beta invites are immutable and cannot be deleted.';
end;
$$;

create function app.reject_telegram_beta_invite_truncate()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Telegram beta invites cannot be truncated.';
end;
$$;

create trigger telegram_beta_invites_enforce_lifecycle
before insert or update on app.telegram_beta_invites
for each row
execute function app.enforce_telegram_beta_invite_lifecycle();

create trigger telegram_beta_invites_no_delete
before delete on app.telegram_beta_invites
for each row
execute function app.reject_telegram_beta_invite_delete();

create trigger telegram_beta_invites_no_truncate
before truncate on app.telegram_beta_invites
for each statement
execute function app.reject_telegram_beta_invite_truncate();

alter table app.telegram_beta_invites enable row level security;
alter table app.telegram_beta_invites force row level security;

-- The former compatibility function could create a customer for an arbitrary first private
-- message. Preserve its signature only so stale callers fail safely and atomically; no caller can
-- execute it after the revoke below.
create or replace function app.record_telegram_private_inbound_event(
  p_telegram_update_id bigint,
  p_telegram_user_id bigint,
  p_private_chat_id bigint,
  p_payload_hmac text,
  p_first_name text,
  p_username text default null,
  p_last_name text default null,
  p_preferred_locale text default null
)
returns table (
  inbound_event_id uuid,
  customer_id uuid,
  customer_identity_id uuid,
  bot_conversation_id uuid,
  preferred_locale text,
  customer_status text,
  identity_status text,
  received_at timestamptz,
  inbound_event_already_recorded boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'The generic Telegram inbound recorder is retired; beta admission requires a valid invite.';
end;
$$;

-- Redeem exactly one valid active invite. The fixed acquisition order is shared Telegram scope,
-- update advisory key, invite advisory key, then identity/customer/Telegram/conversation rows.
-- An unknown, expired, revoked, used, cross-user, malformed, or already-admitted request always
-- raises the same non-sensitive rejection before it can create a customer, identity, conversation,
-- inbound event, or audit event.
create function app.redeem_telegram_beta_invite(
  p_telegram_update_id bigint,
  p_telegram_user_id bigint,
  p_private_chat_id bigint,
  p_invite_token_digest text,
  p_payload_hmac text,
  p_preferred_locale text
)
returns table (
  inbound_event_id uuid,
  received_at timestamptz,
  inbound_event_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  external_event_id text;
  requested_locale text;
  event_lock_key bigint;
  invite_lock_key bigint;
  existing_event_id uuid;
  existing_event_customer_identity_id uuid;
  existing_payload_hmac text;
  existing_received_at timestamptz;
  resolved_invite_status text;
  resolved_invite_customer_id uuid;
  resolved_invite_customer_identity_id uuid;
  resolved_invite_event_id uuid;
  resolved_invite_user_id bigint;
  resolved_invite_chat_id bigint;
  resolved_invite_expires_at timestamptz;
  resolved_customer_id uuid;
  resolved_customer_identity_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_identity_external_subject text;
  resolved_customer_status app.record_status;
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
  resolved_conversation_id uuid;
  inserted_event_id uuid;
  inserted_received_at timestamptz;
begin
  if p_telegram_update_id is null
    or p_telegram_update_id < 0
    or p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or p_private_chat_id is null
    or p_private_chat_id <= 0
    or p_private_chat_id <> p_telegram_user_id then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  if p_invite_token_digest is null
    or p_invite_token_digest <> lower(btrim(p_invite_token_digest))
    or p_invite_token_digest !~ '^sha256-v1:[0-9a-f]{64}$'
    or p_payload_hmac is null
    or p_payload_hmac <> lower(btrim(p_payload_hmac))
    or p_payload_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  requested_locale := nullif(lower(btrim(p_preferred_locale)), '');
  if requested_locale is distinct from 'en' then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  external_event_id := 'update:' || p_telegram_update_id::text;

  perform app.lock_telegram_private_scope(p_telegram_user_id, p_private_chat_id);

  event_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-update:v1:' || external_event_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(event_lock_key);

  invite_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-beta-invite:v1:' || p_invite_token_digest,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(invite_lock_key);

  select inbound_event.id,
         inbound_event.customer_identity_id,
         inbound_event.payload_digest,
         inbound_event.received_at
    into existing_event_id,
         existing_event_customer_identity_id,
         existing_payload_hmac,
         existing_received_at
    from app.inbound_events inbound_event
   where inbound_event.channel = 'telegram'
     and inbound_event.external_event_id = external_event_id
   for update;

  if found then
    if existing_event_customer_identity_id is null
      or existing_payload_hmac is distinct from p_payload_hmac then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select invite.status,
           invite.redeemed_customer_id,
           invite.redeemed_customer_identity_id,
           invite.redeemed_inbound_event_id,
           invite.redeemed_telegram_user_id,
           invite.redeemed_private_chat_id,
           invite.expires_at
      into resolved_invite_status,
           resolved_invite_customer_id,
           resolved_invite_customer_identity_id,
           resolved_invite_event_id,
           resolved_invite_user_id,
           resolved_invite_chat_id,
           resolved_invite_expires_at
      from app.telegram_beta_invites invite
     where invite.token_digest = p_invite_token_digest
       and invite.redeemed_inbound_event_id = existing_event_id
     for update;

    if not found
      or resolved_invite_status is distinct from 'redeemed'
      or resolved_invite_event_id is distinct from existing_event_id
      or resolved_invite_customer_identity_id is distinct from existing_event_customer_identity_id
      or resolved_invite_user_id is distinct from p_telegram_user_id
      or resolved_invite_chat_id is distinct from p_private_chat_id then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select customer_identity.customer_id,
           customer_identity.status,
           customer_identity.identity_kind,
           customer_identity.external_subject
      into resolved_customer_id,
           resolved_identity_status,
           resolved_identity_kind,
           resolved_identity_external_subject
      from app.customer_identities customer_identity
     where customer_identity.id = resolved_invite_customer_identity_id
     for update;

    if not found
      or resolved_customer_id is distinct from resolved_invite_customer_id
      or resolved_identity_kind is distinct from 'telegram'
      or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select customer.status
      into resolved_customer_status
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id
      into resolved_telegram_user_id,
           resolved_private_chat_id
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_invite_customer_identity_id
     for update;

    if not found
      or resolved_telegram_user_id is distinct from p_telegram_user_id
      or resolved_private_chat_id is distinct from p_private_chat_id then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    select conversation.id
      into resolved_conversation_id
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_invite_customer_identity_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not accepted.';
    end if;

    return query
    select existing_event_id,
           existing_received_at,
           true;
    return;
  end if;

  select invite.status,
         invite.redeemed_customer_id,
           invite.redeemed_customer_identity_id,
           invite.redeemed_inbound_event_id,
           invite.redeemed_telegram_user_id,
         invite.redeemed_private_chat_id,
         invite.expires_at
    into resolved_invite_status,
         resolved_invite_customer_id,
         resolved_invite_customer_identity_id,
         resolved_invite_event_id,
         resolved_invite_user_id,
         resolved_invite_chat_id,
         resolved_invite_expires_at
    from app.telegram_beta_invites invite
   where invite.token_digest = p_invite_token_digest
   for update;

  if not found
    or resolved_invite_status is distinct from 'active'
    or resolved_invite_expires_at <= clock_timestamp() then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  -- A pre-existing or malformed binding cannot be silently adopted by a new invite.
  perform 1
    from app.customer_identities customer_identity
   where customer_identity.identity_kind = 'telegram'
     and customer_identity.external_subject = p_telegram_user_id::text
   for update;

  if found then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.telegram_user_id = p_telegram_user_id
   for update;

  if found then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
   where telegram_identity.private_chat_id = p_private_chat_id
   for update;

  if found then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  insert into app.customers default values
  returning id into resolved_customer_id;

  insert into app.customer_identities (
    customer_id,
    identity_kind,
    external_subject
  )
  values (
    resolved_customer_id,
    'telegram',
    p_telegram_user_id::text
  )
  returning id into resolved_customer_identity_id;

  insert into app.telegram_identities (
    customer_identity_id,
    telegram_user_id,
    private_chat_id,
    preferred_locale
  )
  values (
    resolved_customer_identity_id,
    p_telegram_user_id,
    p_private_chat_id,
    'en'
  );

  insert into app.bot_conversations (telegram_identity_id)
  values (resolved_customer_identity_id)
  returning id into resolved_conversation_id;

  insert into app.inbound_events (
    channel,
    external_event_id,
    customer_identity_id,
    payload_digest,
    received_at
  )
  values (
    'telegram',
    external_event_id,
    resolved_customer_identity_id,
    p_payload_hmac,
    clock_timestamp()
  )
  on conflict (channel, external_event_id) do nothing
  returning id, received_at into inserted_event_id, inserted_received_at;

  if inserted_event_id is null then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  update app.telegram_beta_invites invite
     set status = 'redeemed',
         redeemed_telegram_user_id = p_telegram_user_id,
         redeemed_private_chat_id = p_private_chat_id,
         redeemed_customer_id = resolved_customer_id,
         redeemed_customer_identity_id = resolved_customer_identity_id,
         redeemed_inbound_event_id = inserted_event_id,
         redeemed_at = clock_timestamp()
   where invite.token_digest = p_invite_token_digest
     and invite.status = 'active';

  if not found then
    raise exception 'The Telegram beta admission is not accepted.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'customer',
    resolved_customer_id,
    'customer.telegram_beta_invite_redeemed',
    'customer_identity',
    resolved_customer_identity_id,
    jsonb_build_object('channel', 'telegram', 'admission', 'beta_invite')
  );

  return query
  select inserted_event_id,
         inserted_received_at,
         false;
end;
$$;

-- Record later private updates only after an identity has been created by a redeemed beta invite.
-- It cannot create a customer, identity, Telegram binding, or conversation, and it never refreshes
-- profile fields. New records lock scope, update advisory key, redeemed invite, identity, customer,
-- Telegram identity, conversation, then the canonical inbound-event row. An already-stored receipt
-- is resolved first and checked only against immutable admission bindings so it stays replayable
-- after a later administrative deactivation.
create function app.record_admitted_telegram_private_inbound_event(
  p_telegram_update_id bigint,
  p_telegram_user_id bigint,
  p_private_chat_id bigint,
  p_payload_hmac text,
  p_preferred_locale text
)
returns table (
  inbound_event_id uuid,
  received_at timestamptz,
  inbound_event_already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  external_event_id text;
  requested_locale text;
  event_lock_key bigint;
  resolved_invite_customer_id uuid;
  resolved_invite_customer_identity_id uuid;
  resolved_customer_id uuid;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_identity_external_subject text;
  resolved_customer_status app.record_status;
  resolved_telegram_user_id bigint;
  resolved_private_chat_id bigint;
  resolved_conversation_id uuid;
  existing_event_id uuid;
  existing_event_customer_identity_id uuid;
  existing_payload_hmac text;
  existing_received_at timestamptz;
  inserted_event_id uuid;
  inserted_received_at timestamptz;
begin
  if p_telegram_update_id is null
    or p_telegram_update_id < 0
    or p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or p_private_chat_id is null
    or p_private_chat_id <= 0
    or p_private_chat_id <> p_telegram_user_id
    or p_payload_hmac is null
    or p_payload_hmac <> lower(btrim(p_payload_hmac))
    or p_payload_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  requested_locale := nullif(lower(btrim(p_preferred_locale)), '');
  if requested_locale is distinct from 'en' then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  external_event_id := 'update:' || p_telegram_update_id::text;

  perform app.lock_telegram_private_scope(p_telegram_user_id, p_private_chat_id);

  event_lock_key := pg_catalog.hashtextextended(
    'payreplayy:telegram-update:v1:' || external_event_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(event_lock_key);

  select inbound_event.id,
         inbound_event.customer_identity_id,
         inbound_event.payload_digest,
         inbound_event.received_at
    into existing_event_id,
         existing_event_customer_identity_id,
         existing_payload_hmac,
         existing_received_at
    from app.inbound_events inbound_event
   where inbound_event.channel = 'telegram'
     and inbound_event.external_event_id = external_event_id
   for update;

  if found then
    if existing_event_customer_identity_id is null
      or existing_payload_hmac is distinct from p_payload_hmac then
      raise exception 'The Telegram beta admission is not active.';
    end if;

    -- A stored receipt remains replayable even if an administrator later deactivates the
    -- customer or identity. Verify immutable bindings only; active-status checks apply only to
    -- new writes below.
    select invite.redeemed_customer_id,
           invite.redeemed_customer_identity_id
      into resolved_invite_customer_id,
           resolved_invite_customer_identity_id
      from app.telegram_beta_invites invite
     where invite.status = 'redeemed'
       and invite.redeemed_telegram_user_id = p_telegram_user_id
       and invite.redeemed_private_chat_id = p_private_chat_id
       and invite.redeemed_customer_identity_id = existing_event_customer_identity_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not active.';
    end if;

    select customer_identity.customer_id,
           customer_identity.status,
           customer_identity.identity_kind,
           customer_identity.external_subject
      into resolved_customer_id,
           resolved_identity_status,
           resolved_identity_kind,
           resolved_identity_external_subject
      from app.customer_identities customer_identity
     where customer_identity.id = resolved_invite_customer_identity_id
     for update;

    if not found
      or resolved_customer_id is distinct from resolved_invite_customer_id
      or resolved_identity_kind is distinct from 'telegram'
      or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
      raise exception 'The Telegram beta admission is not active.';
    end if;

    select customer.status
      into resolved_customer_status
      from app.customers customer
     where customer.id = resolved_customer_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not active.';
    end if;

    select telegram_identity.telegram_user_id,
           telegram_identity.private_chat_id
      into resolved_telegram_user_id,
           resolved_private_chat_id
      from app.telegram_identities telegram_identity
     where telegram_identity.customer_identity_id = resolved_invite_customer_identity_id
     for update;

    if not found
      or resolved_telegram_user_id is distinct from p_telegram_user_id
      or resolved_private_chat_id is distinct from p_private_chat_id then
      raise exception 'The Telegram beta admission is not active.';
    end if;

    select conversation.id
      into resolved_conversation_id
      from app.bot_conversations conversation
     where conversation.telegram_identity_id = resolved_invite_customer_identity_id
     for update;

    if not found then
      raise exception 'The Telegram beta admission is not active.';
    end if;

    return query
    select existing_event_id,
           existing_received_at,
           true;
    return;
  end if;

  select invite.redeemed_customer_id,
         invite.redeemed_customer_identity_id
    into resolved_invite_customer_id,
         resolved_invite_customer_identity_id
    from app.telegram_beta_invites invite
   where invite.status = 'redeemed'
     and invite.redeemed_telegram_user_id = p_telegram_user_id
     and invite.redeemed_private_chat_id = p_private_chat_id
   for update;

  if not found then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  select customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind,
         customer_identity.external_subject
    into resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind,
         resolved_identity_external_subject
    from app.customer_identities customer_identity
   where customer_identity.id = resolved_invite_customer_identity_id
   for update;

  if not found
    or resolved_customer_id is distinct from resolved_invite_customer_id
    or resolved_identity_status is distinct from 'active'
    or resolved_identity_kind is distinct from 'telegram'
    or resolved_identity_external_subject is distinct from p_telegram_user_id::text then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
   where customer.id = resolved_customer_id
   for update;

  if not found or resolved_customer_status is distinct from 'active' then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  select telegram_identity.telegram_user_id,
         telegram_identity.private_chat_id
    into resolved_telegram_user_id,
         resolved_private_chat_id
    from app.telegram_identities telegram_identity
   where telegram_identity.customer_identity_id = resolved_invite_customer_identity_id
   for update;

  if not found
    or resolved_telegram_user_id is distinct from p_telegram_user_id
    or resolved_private_chat_id is distinct from p_private_chat_id then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  select conversation.id
    into resolved_conversation_id
    from app.bot_conversations conversation
   where conversation.telegram_identity_id = resolved_invite_customer_identity_id
   for update;

  if not found then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  insert into app.inbound_events (
    channel,
    external_event_id,
    customer_identity_id,
    payload_digest,
    received_at
  )
  values (
    'telegram',
    external_event_id,
    resolved_invite_customer_identity_id,
    p_payload_hmac,
    clock_timestamp()
  )
  on conflict (channel, external_event_id) do nothing
  returning id, received_at into inserted_event_id, inserted_received_at;

  if inserted_event_id is null then
    raise exception 'The Telegram beta admission is not active.';
  end if;

  return query
  select inserted_event_id,
         inserted_received_at,
         false;
end;
$$;

-- The invite table is private even to the dedicated runtime. It can resolve only the two bounded
-- SECURITY DEFINER procedures; no generic API, worker, browser/Data API, or retention role gains
-- a path to admission or the underlying token digest.
revoke all privileges on schema app
  from payreplayy_beta_admission, payreplayy_beta_admission_runtime;
revoke all privileges on all tables in schema app
  from payreplayy_beta_admission, payreplayy_beta_admission_runtime;
revoke all privileges on all sequences in schema app
  from payreplayy_beta_admission, payreplayy_beta_admission_runtime;
revoke all privileges on all functions in schema app
  from payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all privileges on table app.telegram_beta_invites
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.enforce_telegram_beta_invite_lifecycle()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.reject_telegram_beta_invite_delete()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.reject_telegram_beta_invite_truncate()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.redeem_telegram_beta_invite(
  bigint, bigint, bigint, text, text, text
) from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

revoke all on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime;

grant usage on schema app to payreplayy_beta_admission;
grant execute on function app.redeem_telegram_beta_invite(
  bigint, bigint, bigint, text, text, text
) to payreplayy_beta_admission;
grant execute on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) to payreplayy_beta_admission;

comment on role payreplayy_beta_admission is
  'PayReplayy beta-admission group. NOLOGIN; only invite redemption and admitted Telegram inbound recording.';

comment on role payreplayy_beta_admission_runtime is
  'PayReplayy beta-admission runtime scaffold. NOLOGIN until separately provisioned; inherits only the beta-admission group and cannot SET ROLE.';

comment on table app.telegram_beta_invites is
  'Private immutable beta invite lifecycle. Stores only a canonical random-token digest and terminal admission bindings; issuance/revocation remain a later owner-only control-plane phase.';

comment on function app.redeem_telegram_beta_invite(bigint, bigint, bigint, text, text, text) is
  'Dedicated beta-admission entry point. It accepts an explicit English private Telegram /start invite receipt, creates one identity only from an active digest-only invite, and records the source update atomically.';

comment on function app.record_admitted_telegram_private_inbound_event(bigint, bigint, bigint, text, text) is
  'Dedicated beta-admission entry point for an already redeemed active Telegram identity. It records an update idempotently and never creates identities, conversations, or profile data.';

comment on function app.record_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text, text, text, text
) is
  'Retired generic private Telegram recorder. It is ungranted and fails closed because beta admission is invite-only.';

commit;
