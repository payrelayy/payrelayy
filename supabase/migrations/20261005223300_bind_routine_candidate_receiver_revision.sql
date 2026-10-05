-- Snapshot the exact TeleBirr receiving-account revision at no-money candidate intake.
-- The prior capture RPC checked a receiver but did not retain its identity; a later signed
-- observation could otherwise be compared with a different revision after rotation.
-- This migration creates no verifier, claim, job, role grant, or financial activation.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

lock table app.routine_telebirr_untrusted_proof_requests in access exclusive mode;

do $candidate_receiver_preflight$
begin
  -- Historical candidates cannot be assigned a receiver retrospectively. Production had no
  -- candidates when this change was prepared; fail rather than inventing a financial binding.
  if exists (select 1 from app.routine_telebirr_untrusted_proof_requests) then
    raise exception 'Existing routine TeleBirr candidates require receiver-binding review.';
  end if;
end;
$candidate_receiver_preflight$;

alter table app.routine_telebirr_untrusted_proof_requests
  add column receiver_account_id uuid not null
    references app.receiver_accounts (id) on delete restrict,
  add column receiver_account_version integer not null
    check (receiver_account_version > 0);

create index routine_telebirr_untrusted_receiver_submitted_idx
  on app.routine_telebirr_untrusted_proof_requests
    (receiver_account_id, submitted_at desc, id);

create function app.bind_routine_telebirr_candidate_receiver_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  receiver_id uuid;
  receiver_version integer;
begin
  if new.payment_provider_id is null or new.provider_code is distinct from 'telebirr' then
    raise exception 'The routine TeleBirr receiver is unavailable.';
  end if;

  -- The existing capture function already checks this same active receiver under FOR SHARE.
  -- This second check retains the immutable revision in the same insert transaction. There
  -- can be at most one active revision per provider by the receiver_accounts partial index.
  select receiver.id, receiver.version into receiver_id, receiver_version
    from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
   where receiver.provider_id = new.payment_provider_id
     and provider.code = 'telebirr'
     and provider.status = 'active'
     and receiver.status = 'active'
     and receiver.retired_at is null
     and receiver.active_from <= pg_catalog.clock_timestamp()
     and receiver.account_holder_name = pg_catalog.btrim(receiver.account_holder_name)
     and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
     and receiver.account_holder_name !~ '[[:cntrl:]]'
     and receiver.account_reference_ciphertext
       ~ '^receiver-v1[.]telebirr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
     and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
     and receiver.account_reference_masked ~ '^\*{3}[0-9]{4}$'
     and receiver.protection_profile_version = 1
     and receiver.encryption_key_version = 1
     and receiver.fingerprint_key_version = 1
   for share of receiver;
  if receiver_id is null or receiver_version is null then
    raise exception 'The routine TeleBirr receiver is unavailable.';
  end if;
  new.receiver_account_id := receiver_id;
  new.receiver_account_version := receiver_version;
  return new;
end;
$$;

alter function app.bind_routine_telebirr_candidate_receiver_revision() owner to postgres;
revoke all on function app.bind_routine_telebirr_candidate_receiver_revision()
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_customer_web, fetanagent_customer_web_runtime,
    fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

create trigger routine_telebirr_candidate_bind_receiver_revision
before insert on app.routine_telebirr_untrusted_proof_requests
for each row execute function app.bind_routine_telebirr_candidate_receiver_revision();

comment on column app.routine_telebirr_untrusted_proof_requests.receiver_account_id is
  'Exact immutable receiving-account revision selected at untrusted candidate intake; not evidence of payment or receiver match.';
comment on column app.routine_telebirr_untrusted_proof_requests.receiver_account_version is
  'Version of the receiving-account revision selected at untrusted candidate intake; no financial authority.';

commit;
