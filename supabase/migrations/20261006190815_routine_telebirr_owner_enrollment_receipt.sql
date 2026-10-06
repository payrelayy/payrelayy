-- Dedicated, unprovisioned routine receipt signer and Owner-only material read.
-- This migration inserts no signer, issues no certificate, and grants no phone,
-- assignment, provider, or financial authority. Deploy the compatible Owner image first.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_enrollment_receipt_signers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  signer_key_id text not null unique
    check (signer_key_id ~ '^telebirr-routine-enrollment-(staging|production)-v[1-9][0-9]*$'),
  public_key_spki_sha256 text not null unique
    check (public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (valid_until > valid_from and valid_until <= valid_from + interval '90 days')
);

create table app.routine_telebirr_enrollment_receipt_signer_revocations (
  signer_id uuid primary key references app.routine_telebirr_enrollment_receipt_signers (id)
    on delete restrict,
  reason_code text not null check (reason_code in ('owner_revoked', 'key_compromise', 'rotation')),
  revoked_at timestamptz not null default pg_catalog.clock_timestamp()
);

do $protect_routine_receipt_signers$
declare ledger text;
begin
  foreach ledger in array array[
    'routine_telebirr_enrollment_receipt_signers',
    'routine_telebirr_enrollment_receipt_signer_revocations'
  ] loop
    execute pg_catalog.format('alter table app.%I owner to postgres', ledger);
    execute pg_catalog.format('alter table app.%I enable row level security', ledger);
    execute pg_catalog.format('alter table app.%I force row level security', ledger);
    execute pg_catalog.format('create trigger %I before update or delete on app.%I '
      || 'for each row execute function app.reject_deposit_ledger_delete()',
      ledger || '_immutable', ledger);
    execute pg_catalog.format('create trigger %I before truncate on app.%I '
      || 'for each statement execute function app.reject_execution_ledger_truncate()',
      ledger || '_no_truncate', ledger);
    execute pg_catalog.format('revoke all on table app.%I from public, anon, authenticated, '
      || 'service_role, fetanagent_owner_control, fetanagent_owner_control_runtime, '
      || 'fetanagent_api, fetanagent_api_runtime, '
      || 'fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime, '
      || 'fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime, '
      || 'fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime, '
      || 'fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime, '
      || 'fetanagent_deposit_executor, fetanagent_deposit_executor_runtime', ledger);
  end loop;
end;
$protect_routine_receipt_signers$;

create function app.get_owner_routine_telebirr_enrollment_receipt_material(
  p_actor_auth_user_id uuid, p_signer_key_id text, p_signer_public_key_spki_sha256 text
)
returns table (
  enrollment_id uuid, pairing_evidence_digest text, device_id text,
  device_key_id text, device_public_key_spki_sha256 text,
  receiver_revision_id uuid, receiver_version integer,
  receiver_profile_digest text, expected_receiver_name_digest text,
  valid_from timestamptz, valid_until timestamptz, issued_at timestamptz,
  signer_valid_from timestamptz, signer_valid_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_signer app.routine_telebirr_enrollment_receipt_signers%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null
    or p_signer_key_id is null
    or p_signer_key_id !~ '^telebirr-routine-enrollment-(staging|production)-v[1-9][0-9]*$'
    or p_signer_public_key_spki_sha256 is null
    or p_signer_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'The routine receipt request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);

  -- Match pairing's no-money lock order so a concurrent switch change cannot race this read.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select signer.* into v_signer from app.routine_telebirr_enrollment_receipt_signers signer
    where signer.signer_key_id = p_signer_key_id
      and signer.public_key_spki_sha256 = p_signer_public_key_spki_sha256
      and signer.valid_from <= v_now and signer.valid_until > v_now
      and not exists (
        select 1 from app.routine_telebirr_enrollment_receipt_signer_revocations revocation
          where revocation.signer_id = signer.id)
    for share of signer;
  if v_signer.id is null then raise exception 'The routine receipt signer is unavailable.'; end if;

  select enrollment.* into strict v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    join app.routine_telebirr_device_pairing_challenges challenge
      on challenge.pairing_evidence_digest = enrollment.pairing_evidence_digest
    where challenge.created_by_admin_id = v_actor_id and challenge.consumed_at is not null
      and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
      and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = enrollment.id)
    for share of enrollment, challenge;
  -- STRICT fails closed if a second active Owner-linked phone appears.

  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where receiver.id = v_enrollment.receiver_account_id
      and receiver.version = v_enrollment.receiver_account_version
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
      and receiver.protection_profile_version = 1
      and receiver.encryption_key_version = 1
      and receiver.fingerprint_key_version = 1
      and provider.code = 'telebirr' and provider.status = 'active'
    for share of receiver, provider;
  if v_receiver.id is null
    or v_enrollment.receiver_profile_digest
      <> app.routine_telebirr_receiver_profile_digest(v_receiver.id, v_receiver.version,
        v_receiver.account_reference_fingerprint, v_receiver.account_holder_name)
    or v_enrollment.expected_receiver_name_digest
      <> app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name) then
    raise exception 'The routine pairing receiver has rotated.';
  end if;

  return query select v_enrollment.id, v_enrollment.pairing_evidence_digest,
    v_enrollment.device_id, v_enrollment.device_key_id,
    v_enrollment.device_public_key_spki_sha256,
    v_enrollment.receiver_account_id, v_enrollment.receiver_account_version,
    v_enrollment.receiver_profile_digest, v_enrollment.expected_receiver_name_digest,
    v_enrollment.valid_from,
    least(v_enrollment.valid_until, v_signer.valid_until),
    v_now, v_signer.valid_from, v_signer.valid_until;
end;
$$;

alter function app.get_owner_routine_telebirr_enrollment_receipt_material(uuid, text, text)
  owner to postgres;
revoke all on function app.get_owner_routine_telebirr_enrollment_receipt_material(uuid, text, text)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
grant execute on function app.get_owner_routine_telebirr_enrollment_receipt_material(uuid, text, text)
  to fetanagent_owner_control;

comment on table app.routine_telebirr_enrollment_receipt_signers is
  'Empty private registry for independently provisioned routine-only receipt signing keys. No application role may mutate it.';
comment on function app.get_owner_routine_telebirr_enrollment_receipt_material(uuid, text, text) is
  'Owner-runtime-only read of exactly one active, Owner-linked routine enrollment and guarded signer while every financial switch is disabled. No provider lookup, assignment, or money authority.';

commit;
