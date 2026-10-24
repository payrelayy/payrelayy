-- A paired signing key belongs to the physical SMS phone. Its original
-- TeleBirr receiver revision remains immutable evidence of the pairing, but
-- a later Owner-approved receiver revision does not need a new phone key.
-- The first SMS after a number change is the same signed receiver proof used
-- for CBE Birr. Name-only revisions inherit proof for the unchanged number.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Readiness checks only the current receiving-number lineage. Keep that
-- lookup bounded as the signed SMS ledger grows.
create index receiver_sms_payment_events_receiver_proof_idx
  on app.receiver_sms_payment_events
    (receiver_account_id, recorded_at desc, device_enrollment_id)
  where provider_code = 'telebirr';

-- Keep historical SMS bound to the receiver active when the payment occurred.
-- The old function deliberately wrote every TeleBirr SMS to the enrollment's
-- original receiver. Replace only that branch; retain signature, replay,
-- conflict, role, and revocation checks byte-for-byte.
do $patch_telebirr_sms_receiver$
declare
  v_signature pg_catalog.regprocedure :=
    'app.record_receiver_sms_payment_event(text,text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer)'::pg_catalog.regprocedure;
  v_definition text;
  v_before text;
  v_after text;
begin
  select pg_catalog.pg_get_functiondef(routine.oid) into v_definition
    from pg_catalog.pg_proc routine
   where routine.oid = v_signature
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef
     and routine.proconfig @> array['search_path=pg_catalog, pg_temp']::text[];
  v_before := $old$
  if p_provider_code = 'telebirr' then
    -- The signed enrollment identifies the wallet even when its revision was
    -- retired moments before a delayed or old-wallet SMS reached this phone.
    select receiver.* into v_receiver from app.receiver_accounts receiver
      where receiver.id = v_enrollment.receiver_account_id
        and receiver.provider_id = v_provider.id
        and receiver.version = v_enrollment.receiver_account_version
        and receiver.active_from <= p_occurred_at for share;
  else
    select receiver.* into v_receiver from app.receiver_accounts receiver
      where receiver.provider_id = v_provider.id
        and receiver.active_from <= p_occurred_at
        and (receiver.retired_at is null or p_occurred_at < receiver.retired_at)
      order by receiver.version desc limit 1 for share;
  end if;
  if v_receiver.id is null or (p_provider_code = 'telebirr'
    and (v_enrollment.receiver_account_id <> v_receiver.id
      or v_enrollment.receiver_account_version <> v_receiver.version)) then
    raise exception using errcode = '42501',
      message = 'The receiver SMS account is unavailable.';
  end if;
$old$;
  v_after := $new$
  -- Enrollment authenticates the phone, while the signed SMS event's payment
  -- time selects the immutable receiver revision. Delayed old payments remain
  -- on the previous revision and are held by the existing rotation guard.
  if p_provider_code = 'telebirr' and not exists (
      select 1 from app.receiver_accounts paired_receiver
       where paired_receiver.id = v_enrollment.receiver_account_id
         and paired_receiver.provider_id = v_provider.id
         and paired_receiver.version = v_enrollment.receiver_account_version) then
    raise exception using errcode = '42501',
      message = 'The receiver SMS device is unavailable.';
  end if;
  select receiver.* into v_receiver from app.receiver_accounts receiver
    where receiver.provider_id = v_provider.id
      and receiver.active_from <= p_occurred_at
      and (receiver.retired_at is null or p_occurred_at < receiver.retired_at)
    order by receiver.version desc limit 1 for share;
  if v_receiver.id is null then
    raise exception using errcode = '42501',
      message = 'The receiver SMS account is unavailable.';
  end if;
$new$;
  if v_definition is null or pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
        <> pg_catalog.length(v_before) then
    raise exception 'The reviewed signed SMS receiver function has changed.';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_telebirr_sms_receiver$;

-- Even an offline receiver edit must mark its next version as needing current
-- proof. The same-number check below can satisfy it immediately.
do $patch_telebirr_rotation_pending$
declare
  v_signature pg_catalog.regprocedure :=
    'app.rotate_owner_receiver_account(uuid,uuid,text,text,text,text,text,smallint,smallint,smallint,text)'::pg_catalog.regprocedure;
  v_definition text;
  v_before text := $old$  if live_telebirr_rotation then
    update app.owner_provider_deposit_controls control
       set receiver_rotation_pending = true
     where control.provider_code = 'telebirr';
  end if;$old$;
  v_after text := $new$  if p_provider_code = 'telebirr' and current_receiver.id is not null then
    update app.owner_provider_deposit_controls control
       set receiver_rotation_pending = true
     where control.provider_code = 'telebirr';
  end if;$new$;
begin
  select pg_catalog.pg_get_functiondef(routine.oid) into v_definition
    from pg_catalog.pg_proc routine
   where routine.oid = v_signature
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef
     and routine.proconfig @> array['search_path=pg_catalog']::text[];
  if v_definition is null or pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
        <> pg_catalog.length(v_before) then
    raise exception 'The reviewed TeleBirr rotation function has changed.';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_telebirr_rotation_pending$;

create or replace function app.owner_provider_deposit_readiness(p_provider_code text)
returns text language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_receiver app.receiver_accounts%rowtype;
  v_last_other_number_version integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_provider_code not in ('telebirr', 'cbe_birr') then return 'unsupported'; end if;
  if not exists (select 1 from app.payment_providers provider
      where provider.code = p_provider_code and provider.status = 'active') then
    return 'provider_unavailable';
  end if;
  select receiver.* into v_receiver
    from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
   where provider.code = p_provider_code and receiver.status = 'active'
     and receiver.retired_at is null and receiver.active_from <= v_now
     and receiver.account_reference_masked ~ '^\*{3}[0-9]{4}$';
  if v_receiver.id is null then return 'receiver_missing'; end if;
  if p_provider_code = 'cbe_birr' and not exists (
      select 1 from app.cbe_birr_receiver_lookup_revisions lookup
      where lookup.receiver_revision_id = v_receiver.id
        and lookup.receiver_version = v_receiver.version
        and lookup.protection_profile_version = 2
        and lookup.encryption_key_version = 2
        and lookup.fingerprint_key_version = 2) then
    return 'receiver_not_protected';
  end if;
  if (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in ('payment_verification', 'deposit_execution')
        and feature.mode = 'live') <> 2 then return 'payments_paused'; end if;
  if not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and control.enabled) then return 'sms_route_paused'; end if;
  if p_provider_code = 'cbe_birr' and not exists (
      select 1 from app.feature_switches feature
      where feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live') then return 'verification_paused'; end if;
  if not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    return 'credit_worker_offline';
  end if;
  if p_provider_code = 'telebirr' then
    if not exists (
        select 1 from app.routine_telebirr_device_enrollments enrollment
        join app.receiver_accounts paired_receiver
          on paired_receiver.id = enrollment.receiver_account_id
         and paired_receiver.version = enrollment.receiver_account_version
       where paired_receiver.provider_id = v_receiver.provider_id
         and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
         and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
           where revoked.enrollment_id = enrollment.id)) then
      return 'phone_not_paired';
    end if;
    if exists (select 1 from app.owner_provider_deposit_controls control
        where control.provider_code = 'telebirr' and control.receiver_rotation_pending) then
      -- Only a contiguous run of revisions for this same protected number can
      -- inherit its earlier pairing or signed-SMS proof. Reverting to an older
      -- number after an intervening number change needs new proof.
      select coalesce(pg_catalog.max(prior.version), 0)
        into v_last_other_number_version
        from app.receiver_accounts prior
       where prior.provider_id = v_receiver.provider_id
         and prior.version < v_receiver.version
         and prior.account_reference_fingerprint is distinct from
           v_receiver.account_reference_fingerprint;
      if not exists (
          select 1 from app.routine_telebirr_device_enrollments enrollment
          join app.receiver_accounts paired_receiver
            on paired_receiver.id = enrollment.receiver_account_id
           and paired_receiver.version = enrollment.receiver_account_version
         where paired_receiver.provider_id = v_receiver.provider_id
           and paired_receiver.version > v_last_other_number_version
           and paired_receiver.account_reference_fingerprint =
             v_receiver.account_reference_fingerprint
           and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
           and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
             where revoked.enrollment_id = enrollment.id))
        and not exists (
          select 1 from app.receiver_sms_payment_events event
          join app.receiver_accounts proved_receiver
            on proved_receiver.id = event.receiver_account_id
           and proved_receiver.version = event.receiver_account_version
          join app.routine_telebirr_device_enrollments enrollment
            on enrollment.id = event.device_enrollment_id
         where event.provider_code = 'telebirr'
           and proved_receiver.provider_id = v_receiver.provider_id
           and proved_receiver.version > v_last_other_number_version
           and proved_receiver.account_reference_fingerprint =
             v_receiver.account_reference_fingerprint
           and event.occurred_at >= proved_receiver.active_from
           and event.received_at >= proved_receiver.active_from
           and event.recorded_at >= proved_receiver.active_from
           and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
           and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
             where revoked.enrollment_id = enrollment.id)) then
        return 'new_receiver_sms_not_seen';
      end if;
    end if;
  elsif exists (select 1 from app.owner_provider_deposit_controls control
      where control.provider_code = 'cbe_birr' and control.receiver_rotation_pending)
    and not exists (select 1 from app.receiver_sms_payment_events event
      where event.receiver_account_id = v_receiver.id
        and event.recorded_at >= v_now - interval '24 hours') then
    return 'new_receiver_sms_not_seen';
  end if;
  return 'ready';
end;
$$;
alter function app.owner_provider_deposit_readiness(text) owner to postgres;
revoke all on function app.owner_provider_deposit_readiness(text)
  from public, anon, authenticated, service_role;

comment on function app.owner_provider_deposit_readiness(text) is
  'TeleBirr keeps the valid signed phone while a receiver revision changes. An unchanged number inherits proof; a changed number needs a signed SMS on its current contiguous-number revision. CBE retains its protected lookup and fresh SMS check.';
commit;
