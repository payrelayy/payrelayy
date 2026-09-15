-- Give human-operated production setup and review steps enough time to complete without weakening
-- the short, machine-only replay and lease boundaries. This migration does not enable a feature
-- switch, create an activation epoch, authorize settlement, or grant KemerBet execution.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;
lock table app.private_live_telebirr_device_pairing_challenges in share row exclusive mode;
lock table app.agent_platform_companion_pairing_challenges in share row exclusive mode;
lock table app.agent_platform_companion_lookup_assignments in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.telegram_telebirr_destination_receipts in share row exclusive mode;
lock table app.telegram_live_telebirr_payment_presentations in share row exclusive mode;
lock table app.bot_action_capabilities in share row exclusive mode;
lock table app.bot_conversation_actions in share row exclusive mode;

do $twelve_hour_human_window_preflight$
declare
  safe_switch_count integer;
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception
      'The twelve-hour human-window migration requires inactive TeleBirr authority.';
  end if;

  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  if safe_switch_count <> 7
    or exists (
      select 1
        from app.agent_platform_companion_execution_control execution_control
       where execution_control.singleton
         and execution_control.control_state <> 'disabled'
    )
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_deposit_executor_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception
      'The twelve-hour human-window migration requires the complete inert money boundary.';
  end if;
end;
$twelve_hour_human_window_preflight$;

-- Existing five-, ten-, and thirty-minute rows remain valid. New human-operated packages and
-- assignments may last up to twelve hours. Pairing requests remain one-use and identity-bound;
-- operational HTTP requests, leases, and clock-skew checks remain unchanged and short.
alter table app.private_live_telebirr_device_pairing_challenges
  drop constraint private_live_telebirr_device_pairing_window_check,
  add constraint private_live_telebirr_device_pairing_window_check check (
    expires_at > valid_from
    and expires_at <= valid_from + interval '12 hours'
  );

alter table app.private_live_telebirr_device_pairing_challenges
  drop constraint private_live_telebirr_device_pairing_claim_window_check,
  add constraint private_live_telebirr_device_pairing_claim_window_check check (
    pairing_request_issued_at is null
    or (
      pairing_request_expires_at > pairing_request_issued_at
      and pairing_request_expires_at <= pairing_request_issued_at + interval '12 hours'
      and certificate_issued_at >= pairing_request_issued_at
      and certificate_issued_at < pairing_request_expires_at
      and certificate_valid_from = certificate_issued_at
      and certificate_valid_until > certificate_valid_from
    )
  );

alter table app.agent_platform_companion_pairing_challenges
  drop constraint agent_platform_companion_pairing_window_check,
  add constraint agent_platform_companion_pairing_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '12 hours'
  );

alter table app.agent_platform_companion_lookup_assignments
  drop constraint agent_platform_companion_lookup_window_check,
  add constraint agent_platform_companion_lookup_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '12 hours'
  );

-- Telegram menu capabilities and the subsequent Player-ID prompt are both human-operated and
-- independently bound to one private conversation, one expected version, and one consumption.
alter table app.bot_action_capabilities
  drop constraint bot_action_capabilities_expiry_after_creation,
  add constraint bot_action_capabilities_expiry_after_creation check (
    expires_at > created_at
    and expires_at <= created_at + interval '12 hours'
  );

alter table app.bot_conversation_actions
  drop constraint bot_conversation_actions_expiry_after_creation,
  add constraint bot_conversation_actions_expiry_after_creation check (
    expires_at > created_at
    and expires_at <= created_at + interval '12 hours'
  );

-- The dormant execution control must be able to bind a twelve-hour pilot later, but remains
-- disabled and grants no authority in this migration.
alter table app.agent_platform_companion_execution_control
  drop constraint agent_platform_companion_execution_control_shape,
  add constraint agent_platform_companion_execution_control_shape check (
    (
      control_state = 'disabled'
      and certificate_id is null
      and device_id is null
      and device_key_id is null
      and no_money_signer_key_id is null
      and execution_signer_key_id is null
      and execution_signer_public_key_spki is null
      and execution_signer_public_key_spki_sha256 is null
      and platform_agent_account_id is null
      and pilot_revision_id is null
      and pilot_revision is null
      and pilot_configuration_digest is null
      and activation_epoch is null
      and active_from is null
      and expires_at is null
      and activated_by_admin_id is null
      and activated_at is null
      and disabled_at is null
      and disable_reason_code is null
    ) or (
      control_state = 'active'
      and certificate_id is not null
      and device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and no_money_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and execution_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and execution_signer_key_id <> no_money_signer_key_id
      and pg_catalog.length(execution_signer_public_key_spki) between 1 and 684
      and execution_signer_public_key_spki ~ '^[A-Za-z0-9_-]+$'
      and execution_signer_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'
      and platform_agent_account_id is not null
      and pilot_revision_id is not null
      and pilot_revision > 0
      and pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'
      and activation_epoch > 0
      and active_from is not null
      and expires_at > active_from
      and expires_at <= active_from + interval '12 hours'
      and activated_by_admin_id is not null
      and activated_at is not null
      and activated_at < expires_at
      and disabled_at is null
      and disable_reason_code is null
    )
  );

-- Immutable ten-minute payment-presentation receipts from older releases remain valid. New
-- presentations use twelve hours and are still invalidated immediately by a stopped activation
-- epoch, an expired pilot, a retired receiver, or a changed eligibility decision.
alter table app.telegram_live_telebirr_payment_presentations
  drop constraint telegram_live_telebirr_presentations_window_check;
alter table app.telegram_telebirr_destination_receipts
  drop constraint telegram_telebirr_destination_receipts_expiry_shape;

alter table app.telegram_telebirr_destination_receipts
  add constraint telegram_telebirr_destination_receipts_expiry_shape check (
    payment_presentation_expires_at in (
      created_at + interval '10 minutes',
      created_at + interval '12 hours'
    )
  );

alter table app.telegram_live_telebirr_payment_presentations
  add constraint telegram_live_telebirr_presentations_window_check check (
    payment_presentation_expires_at in (
      created_at + interval '10 minutes',
      created_at + interval '12 hours'
    )
  );

-- Rewrite only exact reviewed literals inside the already deployed security-definer boundaries.
-- CREATE OR REPLACE retains each routine's OID, owner, ACL, volatility, parallel mode, search path,
-- and return shape; the postcondition below proves those catalog properties were preserved.
do $install_twelve_hour_human_windows$
declare
  rewrite record;
  routine_oid oid;
  original_definition text;
  rewritten_definition text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
  old_occurrences integer;
begin
  for rewrite in
    select *
      from (values
        (
          'app.prepare_approved_private_live_telebirr_pilot_unverified(uuid,uuid,text[],timestamptz,timestamptz)',
          'p_expires_at is distinct from p_active_from + interval ''2 hours''',
          'p_expires_at is distinct from p_active_from + interval ''12 hours'''
        ),
        (
          'app.require_companion_verified_private_live_telebirr_pilot(uuid,uuid)',
          'pilot.expires_at is distinct from pilot.active_from + interval ''2 hours''',
          'pilot.expires_at is distinct from pilot.active_from + interval ''12 hours'''
        ),
        (
          'app.ensure_private_live_telebirr_receiver_profile(uuid)',
          'pilot.expires_at <> pilot.active_from + interval ''2 hours''',
          'pilot.expires_at <> pilot.active_from + interval ''12 hours'''
        ),
        (
          'app.activate_private_trusted_telebirr_verification_v1_surrogate(uuid,uuid,uuid,text)',
          'pilot.expires_at is distinct from pilot.active_from + interval ''2 hours''',
          'pilot.expires_at is distinct from pilot.active_from + interval ''12 hours'''
        ),
        (
          'app.issue_private_telebirr_device_pairing(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz)',
          'p_expires_at > now_at + interval ''30 minutes''',
          'p_expires_at > now_at + interval ''12 hours'''
        ),
        (
          'app.claim_private_telebirr_device_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz)',
          'p_request_expires_at > p_request_issued_at + interval ''10 minutes''',
          'p_request_expires_at > p_request_issued_at + interval ''12 hours'''
        ),
        (
          'app.issue_current_private_telebirr_device_pairing(uuid,uuid,text,text)',
          'now_at + interval ''10 minutes''',
          'now_at + interval ''12 hours'''
        ),
        (
          'app.issue_agent_platform_companion_pairing(uuid,uuid,text,text)',
          'now_at + interval ''10 minutes''',
          'now_at + interval ''12 hours'''
        ),
        (
          'app.claim_agent_platform_companion_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)',
          'p_request_expires_at > p_request_issued_at + interval ''10 minutes''',
          'p_request_expires_at > p_request_issued_at + interval ''12 hours'''
        ),
        (
          'app.issue_agent_platform_companion_exact_five_lookup(uuid,uuid,text)',
          'now_at + interval ''10 minutes''',
          'now_at + interval ''12 hours'''
        ),
        (
          'app.prepare_telegram_telebirr_destination(uuid,text,text)',
          'v_now + interval ''10 minutes''',
          'v_now + interval ''12 hours'''
        ),
        (
          'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
          $old_capability$five-minute maximum remains valid even across that final timestamp.
  resolved_expiry := resolved_now + interval '4 minutes 59 seconds';$old_capability$,
          $new_capability$twelve-hour maximum remains valid even across that final timestamp.
  resolved_expiry := resolved_now + interval '11 hours 59 minutes 59 seconds';$new_capability$
        ),
        (
          'app.start_telegram_player_registration_action(uuid,uuid,text,text)',
          $old_action$ten-minute upper
  -- bound because the action binding trigger controls created_at at insert time.
  resolved_new_action_expires_at := clock_timestamp() + interval '9 minutes 59 seconds';$old_action$,
          $new_action$twelve-hour upper
  -- bound because the action binding trigger controls created_at at insert time.
  resolved_new_action_expires_at := clock_timestamp() + interval '11 hours 59 minutes 59 seconds';$new_action$
        )
      ) reviewed(signature, old_fragment, new_fragment)
  loop
    routine_oid := pg_catalog.to_regprocedure(rewrite.signature);
    if routine_oid is null then
      raise exception 'A reviewed human-window function is unavailable: %', rewrite.signature;
    end if;

    select pg_catalog.pg_get_functiondef(routine.oid),
           routine.proowner,
           routine.proacl,
           routine.proconfig,
           routine.provolatile,
           routine.proparallel,
           routine.proleakproof,
           routine.prosecdef,
           routine.proretset
      into original_definition,
           original_owner,
           original_acl,
           original_config,
           original_volatility,
           original_parallel,
           original_leakproof,
           original_security_definer,
           original_returns_set
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prokind = 'f'
       and routine.prosecdef;

    if original_definition is null then
      raise exception 'A reviewed human-window function changed shape: %', rewrite.signature;
    end if;

    old_occurrences := (
      pg_catalog.length(original_definition)
      - pg_catalog.length(
          pg_catalog.replace(original_definition, rewrite.old_fragment, '')
        )
    ) / pg_catalog.length(rewrite.old_fragment);

    if old_occurrences <> 1
      or pg_catalog.strpos(original_definition, rewrite.new_fragment) <> 0 then
      raise exception 'A reviewed human-window literal changed unexpectedly: %', rewrite.signature;
    end if;

    rewritten_definition := pg_catalog.replace(
      original_definition,
      rewrite.old_fragment,
      rewrite.new_fragment
    );
    execute rewritten_definition;

    if not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = routine_oid
         and routine.prokind = 'f'
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.proconfig is not distinct from original_config
         and routine.provolatile = original_volatility
         and routine.proparallel = original_parallel
         and routine.proleakproof = original_leakproof
         and routine.prosecdef = original_security_definer
         and routine.proretset = original_returns_set
         and pg_catalog.strpos(
               pg_catalog.pg_get_functiondef(routine.oid), rewrite.old_fragment
             ) = 0
         and (
           pg_catalog.length(pg_catalog.pg_get_functiondef(routine.oid))
           - pg_catalog.length(
               pg_catalog.replace(
                 pg_catalog.pg_get_functiondef(routine.oid),
                 rewrite.new_fragment,
                 ''
               )
             )
         ) / pg_catalog.length(rewrite.new_fragment) = 1
    ) then
      raise exception 'A reviewed human-window rewrite did not preserve its boundary: %',
        rewrite.signature;
    end if;
  end loop;
end;
$install_twelve_hour_human_windows$;

comment on constraint private_live_telebirr_device_pairing_window_check
  on app.private_live_telebirr_device_pairing_challenges is
  'Human-entered Android pairing packages and their exact one-use device-bound requests may remain open for at most twelve hours.';
comment on constraint private_live_telebirr_device_pairing_claim_window_check
  on app.private_live_telebirr_device_pairing_challenges is
  'Android pairing requests are one-use, device-bound, and may match the twelve-hour human pairing package; claim leases remain short.';
comment on constraint agent_platform_companion_pairing_window_check
  on app.agent_platform_companion_pairing_challenges is
  'Human-entered Windows companion pairing packages and their exact one-use device-bound requests may remain open for at most twelve hours.';
comment on constraint agent_platform_companion_lookup_window_check
  on app.agent_platform_companion_lookup_assignments is
  'Owner-approved, read-only exact-five assignments may await the companion for at most twelve hours; claim and HTTP leases remain short.';
comment on constraint bot_action_capabilities_expiry_after_creation
  on app.bot_action_capabilities is
  'One-use, conversation-bound Telegram menu capabilities may await a human response for at most twelve hours.';
comment on constraint bot_conversation_actions_expiry_after_creation
  on app.bot_conversation_actions is
  'One-use Telegram conversation prompts may await the bound customer input for at most twelve hours.';

commit;
