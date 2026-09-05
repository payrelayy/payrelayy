-- Atomically provision the immutable TeleBirr receiver profile when the authenticated Owner
-- arms the companion-verified fixed dry-run pilot. The profile contains only digests and exact
-- revision bindings; this migration cannot enable a financial feature or move money.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- These bytes are identical to digestTelebirrLivePilotReceiverName in the TypeScript protocol:
-- NFC, ASCII whitespace collapse, ASCII-only case folding, and the same length-prefixed transcript.
create function app.private_live_telebirr_receiver_name_digest(
  p_account_holder_name text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  character_index integer;
  code_point integer;
  normalized_name text;
  digest_input bytea := pg_catalog.decode('', 'hex');
  digest_hex text;
  transcript_value text;
  transcript_values text[];
begin
  if p_account_holder_name is null then
    raise exception 'The TeleBirr receiver name is required.';
  end if;

  for character_index in 1..pg_catalog.char_length(p_account_holder_name) loop
    code_point := pg_catalog.ascii(
      pg_catalog.substr(p_account_holder_name, character_index, 1)
    );
    if code_point between 1 and 8
      or code_point between 14 and 31
      or code_point between 127 and 159 then
      raise exception 'The TeleBirr receiver name contains a forbidden code point.';
    end if;
  end loop;

  normalized_name := pg_catalog.normalize(p_account_holder_name, NFC);
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(9), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(10), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(11), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(12), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(13), ' ');
  normalized_name := pg_catalog.btrim(
    pg_catalog.regexp_replace(normalized_name, ' +', ' ', 'g')
  );
  normalized_name := pg_catalog.translate(
    normalized_name,
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );

  if pg_catalog.char_length(normalized_name) not between 2 and 160
    or pg_catalog.octet_length(normalized_name) > 320 then
    raise exception 'The normalized TeleBirr receiver name is invalid.';
  end if;

  transcript_values := array[
    'fetanagent:telebirr:live-private-pilot:receiver-name:v1',
    '2',
    'normalizerVersion',
    'string:telebirr-credited-party-name-normalizer-v1',
    'normalizedName',
    'string:' || normalized_name
  ];

  foreach transcript_value in array transcript_values loop
    digest_input := digest_input
      || pg_catalog.int4send(
           pg_catalog.octet_length(pg_catalog.convert_to(transcript_value, 'UTF8'))
         )
      || pg_catalog.convert_to(transcript_value, 'UTF8');
  end loop;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(extensions.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using digest_input;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using digest_input;
  else
    raise exception 'The TeleBirr receiver-name digest function is unavailable.';
  end if;

  if digest_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'The TeleBirr receiver-name digest result is invalid.';
  end if;

  return 'sha256:' || digest_hex;
end;
$$;

create function app.ensure_private_live_telebirr_receiver_profile(
  p_pilot_revision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  profiled_at timestamptz := pg_catalog.clock_timestamp();
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  provider app.payment_providers%rowtype;
  receiver app.receiver_accounts%rowtype;
  policy app.deposit_policy_versions%rowtype;
  existing_profile app.private_live_telebirr_receiver_profiles%rowtype;
  financial_switch_count integer;
  member_count integer;
  minimum_principal_amount_minor bigint;
  maximum_principal_amount_minor bigint;
  expected_policy_digest text;
  expected_receiver_name_digest text;
  expected_receiver_configuration_digest text;
  expected_receiver_profile_digest text;
  created_profile_id uuid;
begin
  if session_user <> 'postgres'
    and (
      session_user <> 'fetanagent_owner_control_runtime'
      or pg_catalog.pg_has_role(
        session_user,
        'fetanagent_owner_control',
        'member'
      ) is not true
    ) then
    raise exception 'The TeleBirr receiver-profile controller is unavailable.';
  end if;

  if p_pilot_revision_id is null then
    raise exception 'The TeleBirr receiver-profile pilot is required.';
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  if pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is null
    or pilot.configuration_digest !~ '^sha256:[0-9a-f]{64}$'
    or pilot.minimum_amount_minor <> 2500
    or pilot.maximum_per_deposit_minor <> 2500
    or pilot.maximum_per_player_minor <> 2500
    or pilot.maximum_aggregate_minor <> 12500
    or pilot.maximum_reservation_count <> 5
    or pilot.expires_at <> pilot.active_from + interval '2 hours'
    or pilot.expires_at <= profiled_at + interval '5 minutes' then
    raise exception 'The fixed dry-run TeleBirr pilot cannot receive a profile.';
  end if;

  select pg_catalog.count(*)::integer
    into member_count
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id;
  if member_count <> 5 then
    raise exception 'The TeleBirr receiver-profile Player cohort is not exact.';
  end if;

  select pg_catalog.count(*)::integer
    into member_count
    from app.private_live_deposit_pilot_customers member
   where member.pilot_revision_id = pilot.id;
  if member_count not between 1 and 5 then
    raise exception 'The TeleBirr receiver-profile customer cohort is not exact.';
  end if;

  select pg_catalog.count(*)::integer
    into member_count
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id;
  if member_count <> 1 then
    raise exception 'The TeleBirr receiver-profile provider cohort is not exact.';
  end if;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.provider_code_snapshot = 'telebirr'
   for key share;

  select payment_provider.*
    into provider
    from app.payment_providers payment_provider
   where payment_provider.id = provider_member.payment_provider_id
   for share;

  select receiver_account.*
    into receiver
    from app.receiver_accounts receiver_account
   where receiver_account.id = provider_member.receiver_account_id
     and receiver_account.provider_id = provider_member.payment_provider_id
     and receiver_account.version = provider_member.receiver_account_version
   for share;

  if provider_member.payment_provider_id is null
    or provider.id is null
    or provider.code <> 'telebirr'
    or provider.status <> 'active'
    or provider.updated_at is distinct from provider_member.provider_updated_at_snapshot
    or receiver.id is null
    or receiver.status <> 'active'
    or receiver.retired_at is not null
    or receiver.account_holder_name is distinct from
         provider_member.receiver_account_holder_name_snapshot
    or receiver.account_reference_masked is distinct from
         provider_member.receiver_account_masked_snapshot
    or receiver.active_from is distinct from provider_member.receiver_active_from_snapshot
    or receiver.updated_at is distinct from provider_member.receiver_updated_at_snapshot
    or receiver.account_reference_ciphertext !~
         '^receiver-v1[.]telebirr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
    or receiver.account_reference_fingerprint is null
    or receiver.account_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or receiver.account_reference_masked !~ '^[*][*][*][0-9]{4}$'
    or receiver.protection_profile_version is distinct from 1
    or receiver.encryption_key_version is distinct from 1
    or receiver.fingerprint_key_version is distinct from 1 then
    raise exception 'The protected TeleBirr receiver revision is not exact.';
  end if;

  select policy_version.*
    into policy
    from app.deposit_policy_versions policy_version
   where policy_version.status = 'active'
   for share;

  minimum_principal_amount_minor := pg_catalog.greatest(
    pilot.minimum_amount_minor,
    policy.minimum_amount_minor
  );
  maximum_principal_amount_minor := pg_catalog.least(
    pilot.maximum_per_deposit_minor,
    policy.maximum_amount_minor
  );

  if policy.id is null
    or policy.freshness_window_seconds <> 3600
    or minimum_principal_amount_minor <> 2500
    or maximum_principal_amount_minor <> 2500 then
    raise exception 'The TeleBirr receiver-profile policy is not exact.';
  end if;

  expected_policy_digest := app.private_live_telebirr_policy_digest(
    minimum_principal_amount_minor,
    maximum_principal_amount_minor
  );
  expected_receiver_name_digest := app.private_live_telebirr_receiver_name_digest(
    provider_member.receiver_account_holder_name_snapshot
  );
  expected_receiver_configuration_digest :=
    app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:receiver-configuration:v1:'
      || pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_configuration_digest', pilot.configuration_digest,
           'payment_provider_id', provider.id::text,
           'provider_code', 'telebirr',
           'receiver_account_id', receiver.id::text,
           'receiver_account_version', receiver.version,
           'receiver_account_reference_fingerprint', receiver.account_reference_fingerprint,
           'receiver_name_digest', expected_receiver_name_digest,
           'receiver_match_basis', 'exact_full_name',
           'source_profile', 'telebirr_official_receipt_v1',
           'receiver_name_normalizer_version',
             'telebirr-credited-party-name-normalizer-v1',
           'adapter_version', 'telebirr-live-private-pilot-adapter-v1',
           'parser_version', 'telebirr-official-receipt-live-pilot-parser-v1',
           'facts_normalizer_version',
             'telebirr-live-private-pilot-facts-normalizer-v1',
           'policy_version', 'telebirr_private_pilot_policy_v1',
           'deposit_policy_version_id', policy.id::text,
           'deposit_policy_version', policy.version,
           'minimum_principal_amount_minor', minimum_principal_amount_minor,
           'maximum_principal_amount_minor', maximum_principal_amount_minor,
           'policy_digest', expected_policy_digest,
           'automatic_freshness_seconds', 3600,
           'maximum_future_skew_seconds', 300,
           'valid_from_epoch_microseconds',
             (pg_catalog.date_part('epoch', pilot.active_from) * 1000000)::bigint,
           'valid_until_epoch_microseconds',
             (pg_catalog.date_part('epoch', pilot.expires_at) * 1000000)::bigint
         )::text
    );
  expected_receiver_profile_digest :=
    app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:receiver-profile:v1:'
      || pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'receiver_configuration_digest', expected_receiver_configuration_digest,
           'receiver_identity_digest', expected_receiver_name_digest
         )::text
    );

  select receiver_profile.*
    into existing_profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.pilot_revision_id = pilot.id
     and receiver_profile.payment_provider_id = provider.id
     and receiver_profile.receiver_account_id = receiver.id
     and receiver_profile.receiver_account_version = receiver.version
   for key share;

  if existing_profile.id is not null then
    if existing_profile.provider_code <> 'telebirr'
      or existing_profile.pilot_configuration_digest is distinct from
           pilot.configuration_digest
      or existing_profile.receiver_profile_digest is distinct from
           expected_receiver_profile_digest
      or existing_profile.receiver_configuration_digest is distinct from
           expected_receiver_configuration_digest
      or existing_profile.receiver_identity_digest is distinct from
           expected_receiver_name_digest
      or existing_profile.expected_receiver_name_digest is distinct from
           expected_receiver_name_digest
      or existing_profile.receiver_match_basis <> 'exact_full_name'
      or existing_profile.source_profile <> 'telebirr_official_receipt_v1'
      or existing_profile.receiver_name_normalizer_version <>
           'telebirr-credited-party-name-normalizer-v1'
      or existing_profile.adapter_version <> 'telebirr-live-private-pilot-adapter-v1'
      or existing_profile.parser_version <>
           'telebirr-official-receipt-live-pilot-parser-v1'
      or existing_profile.facts_normalizer_version <>
           'telebirr-live-private-pilot-facts-normalizer-v1'
      or existing_profile.policy_version <> 'telebirr_private_pilot_policy_v1'
      or existing_profile.deposit_policy_version_id is distinct from policy.id
      or existing_profile.deposit_policy_version is distinct from policy.version
      or existing_profile.minimum_principal_amount_minor is distinct from
           minimum_principal_amount_minor
      or existing_profile.maximum_principal_amount_minor is distinct from
           maximum_principal_amount_minor
      or existing_profile.policy_digest is distinct from expected_policy_digest
      or existing_profile.automatic_freshness_seconds <> 3600
      or existing_profile.maximum_future_skew_seconds <> 300
      or existing_profile.valid_from is distinct from pilot.active_from
      or existing_profile.valid_until is distinct from pilot.expires_at then
      raise exception 'The existing TeleBirr receiver profile does not match the pilot.';
    end if;
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics financial_switch_count = row_count;

  if financial_switch_count <> 6
    or exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'payment_verification',
         'deposit_execution',
         'withdrawal_validation',
         'withdrawal_collection',
         'cbe_birr_authoritative_verification',
         'telebirr_authoritative_verification'
       )
         and (
           feature_switch.mode <> 'disabled'
           or feature_switch.settings <> '{}'::jsonb
         )
    )
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'dry_run'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ) then
    raise exception 'Every financial switch must remain disabled for receiver profiling.';
  end if;

  if existing_profile.id is not null then
    return existing_profile.id;
  end if;

  created_profile_id := pg_catalog.gen_random_uuid();
  insert into app.private_live_telebirr_receiver_profiles (
    id,
    pilot_revision_id,
    payment_provider_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    receiver_profile_digest,
    receiver_configuration_digest,
    receiver_identity_digest,
    expected_receiver_name_digest,
    deposit_policy_version_id,
    deposit_policy_version,
    minimum_principal_amount_minor,
    maximum_principal_amount_minor,
    policy_digest,
    valid_from,
    valid_until
  ) values (
    created_profile_id,
    pilot.id,
    provider.id,
    receiver.id,
    receiver.version,
    pilot.configuration_digest,
    expected_receiver_profile_digest,
    expected_receiver_configuration_digest,
    expected_receiver_name_digest,
    expected_receiver_name_digest,
    policy.id,
    policy.version,
    minimum_principal_amount_minor,
    maximum_principal_amount_minor,
    expected_policy_digest,
    pilot.active_from,
    pilot.expires_at
  );

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'admin',
    pilot.armed_by_admin_id,
    'deposit.private_live_telebirr_receiver_profile_created',
    'private_live_telebirr_receiver_profile',
    created_profile_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'pilot_revision_id', pilot.id,
      'financially_active', false
    )
  );

  return created_profile_id;
end;
$$;

create or replace function app.arm_companion_verified_private_live_telebirr_pilot(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  context_count integer;
begin
  perform app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    p_pilot_revision_id
  );

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'arm'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context is unavailable.';
  end if;

  begin
    perform app.arm_private_live_deposit_pilot(
      p_actor_auth_user_id,
      p_pilot_revision_id
    );
    perform app.ensure_private_live_telebirr_receiver_profile(p_pilot_revision_id);
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'arm';
    raise;
  end;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'arm';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot mutation context did not close.';
  end if;
end;
$$;

alter function app.private_live_telebirr_receiver_name_digest(text) owner to postgres;
alter function app.ensure_private_live_telebirr_receiver_profile(uuid) owner to postgres;
alter function app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid)
  owner to postgres;

revoke all on function
  app.private_live_telebirr_receiver_name_digest(text),
  app.ensure_private_live_telebirr_receiver_profile(uuid)
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
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant execute on function
  app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid)
to fetanagent_owner_control;

-- Repair only one still-current fixed dry-run pilot created before this migration. Ambiguity fails
-- the migration; an expired or absent pilot is left untouched and must follow the normal Owner flow.
do $backfill_current_armed_telebirr_profile$
declare
  candidate_count integer;
  candidate_pilot_id uuid;
begin
  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(pilot.id order by pilot.id))[1]
    into candidate_count, candidate_pilot_id
    from app.private_live_deposit_pilot_revisions pilot
    join app.feature_switches pilot_switch
      on pilot_switch.feature_key = 'private_live_deposit_pilot'
   where pilot.status = 'armed'
     and pilot.configuration_digest is not null
     and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
     and pilot_switch.mode = 'dry_run'
     and pilot_switch.settings = pg_catalog.jsonb_build_object(
       'contract_version', 1,
       'pilot_revision_id', pilot.id,
       'configuration_digest', pilot.configuration_digest
     )
     and not exists (
       select 1
         from app.private_live_telebirr_receiver_profiles receiver_profile
        where receiver_profile.pilot_revision_id = pilot.id
     );

  if candidate_count > 1 then
    raise exception 'More than one current unprofiled TeleBirr pilot exists.';
  elsif candidate_count = 1 then
    perform app.ensure_private_live_telebirr_receiver_profile(candidate_pilot_id);
  end if;
end;
$backfill_current_armed_telebirr_profile$;

comment on function app.private_live_telebirr_receiver_name_digest(text) is
  'Private byte-for-byte protocol digest for the normalized TeleBirr credited-party full name. It is never granted to an application role.';
comment on function app.ensure_private_live_telebirr_receiver_profile(uuid) is
  'Private idempotent provisioning boundary for one immutable digest-only receiver profile. It requires the exact fixed dry-run pilot and all financial features disabled.';
comment on function app.arm_companion_verified_private_live_telebirr_pilot(uuid, uuid) is
  'Authenticated Owner arming gated by fresh exact-five companion evidence; the immutable TeleBirr receiver profile is created atomically while all money switches remain disabled.';

commit;
