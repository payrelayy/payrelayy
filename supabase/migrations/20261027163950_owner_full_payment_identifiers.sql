-- Keep payment identifiers encrypted in storage and reveal them only through
-- the dedicated Owner runtime. Historical SMS without a submitted reference
-- have no recoverable reference; new phone events receive a separate display
-- ciphertext without giving the SMS broker a payment-proof opening key.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.receiver_sms_payment_reference_displays (
  payment_event_id uuid primary key
    references app.receiver_sms_payment_events (id) on delete restrict,
  reference_ciphertext text not null
    check (reference_ciphertext ~
      '^sms-display-v1[.](telebirr|cbe_birr)[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{11,43}$'),
  reference_masked text not null
    check (reference_masked ~ '^\*{3}[A-Z0-9]{4}$'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create trigger receiver_sms_payment_reference_displays_immutable
before update or delete on app.receiver_sms_payment_reference_displays
for each row execute function app.reject_provider_payment_evidence_mutation();
alter table app.receiver_sms_payment_reference_displays enable row level security;
alter table app.receiver_sms_payment_reference_displays force row level security;
alter table app.receiver_sms_payment_reference_displays owner to postgres;
revoke all on app.receiver_sms_payment_reference_displays
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest_runtime, fetanagent_owner_control_runtime;

-- Preserve SMS reference-last-four filtering for newly captured phone events.
create or replace function app.list_owner_receiver_sms_inbox_filtered(
  p_actor_auth_user_id uuid, p_provider text, p_status text,
  p_reference_last4 text, p_from date, p_to date,
  p_limit integer, p_offset integer
) returns table (
  payment_event_id uuid, provider_code text, payment_at timestamptz,
  received_at timestamptz, amount_minor bigint, receiver_account_masked text,
  receiver_holder_name text, reference_masked text, candidate_id uuid,
  player_masked text, payment_status text, case_id uuid,
  can_mark_manually_credited boolean
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or p_provider is null or p_provider not in ('all','telebirr','cbe_birr')
    or p_status is null or p_status not in (
      'all','unmatched','submission_waiting','pending_review',
      'auto_processing','auto_credited','auto_not_credited','auto_used',
      'awaiting_manual_credit','manually_credited','rejected')
    or (p_reference_last4 is not null
      and p_reference_last4 !~ '^[A-Z0-9]{4}$')
    or (p_from is not null and p_to is not null and p_from > p_to)
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  return query
  with inbox as (
    select sms.id as payment_event_id, sms.provider_code,
      sms.occurred_at as payment_at, sms.received_at, sms.amount_minor,
      receiver.account_reference_masked as receiver_account_masked,
      receiver.account_holder_name as receiver_holder_name,
      coalesce(candidate.reference_masked, display.reference_masked) as reference_masked,
      candidate.id as candidate_id,
      case when player.id is not null then '***' || pg_catalog.right(player.player_id,4)
        else null::text end as player_masked,
      case when owner_case.id is not null then owner_case.status
        when intent.status = 'executed' then 'auto_credited'
        when intent.status in ('rejected','expired','cancelled') then 'auto_not_credited'
        when lineage.candidate_id is not null then 'auto_processing'
        when evidence.id is not null then 'auto_used'
        when matched.disposition in ('older_review','held_review') then 'pending_review'
        when candidate.id is not null then 'submission_waiting'
        else 'unmatched' end as payment_status,
      owner_case.id as case_id,
      owner_case.id is null and (
        (candidate.id is null and evidence.id is null)
        or (candidate.id is not null
          and coalesce(intent.status in ('rejected','cancelled'),false)
          and not exists (select 1 from app.deposit_jobs job
            where job.deposit_intent_id = lineage.deposit_intent_id
              and job.status not in ('cancelled','dead'))
          and not exists (select 1 from app.deposit_execution_attempts attempt
            where attempt.deposit_intent_id = lineage.deposit_intent_id
              and attempt.status <> 'cancelled_before_action')))
        as can_mark_manually_credited
    from app.receiver_sms_payment_events sms
    join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
    left join app.receiver_sms_payment_reference_displays display
      on display.payment_event_id = sms.id
    left join app.owner_manual_payment_cases owner_case
      on owner_case.payment_provider_id = sms.payment_provider_id
        and owner_case.reference_fingerprint = sms.reference_fingerprint
    left join lateral (
      select first_candidate.* from app.receiver_sms_deposit_candidates first_candidate
        where first_candidate.provider_code = sms.provider_code
          and first_candidate.reference_fingerprint = sms.reference_fingerprint
        order by first_candidate.submitted_at, first_candidate.id limit 1
    ) candidate on true
    left join app.customer_platform_players player on player.id = candidate.player_account_id
    left join app.receiver_sms_payment_matches matched
      on matched.candidate_id = candidate.id
    left join app.receiver_sms_settlement_lineages lineage
      on lineage.candidate_id = candidate.id
    left join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
    left join app.provider_payment_evidence evidence
      on evidence.payment_provider_id = sms.payment_provider_id
        and evidence.canonical_reference_fingerprint = sms.reference_fingerprint
    where (p_provider = 'all' or sms.provider_code = p_provider)
      and (p_from is null
        or sms.received_at >= (p_from::timestamp at time zone 'Africa/Nairobi'))
      and (p_to is null
        or sms.received_at < ((p_to + 1)::timestamp at time zone 'Africa/Nairobi'))
  )
  select inbox.payment_event_id, inbox.provider_code, inbox.payment_at,
    inbox.received_at, inbox.amount_minor, inbox.receiver_account_masked,
    inbox.receiver_holder_name, inbox.reference_masked, inbox.candidate_id,
    inbox.player_masked, inbox.payment_status, inbox.case_id,
    inbox.can_mark_manually_credited
  from inbox
  where (p_status = 'all' or inbox.payment_status = p_status)
    and (p_reference_last4 is null
      or pg_catalog.right(inbox.reference_masked,4) = p_reference_last4)
  order by inbox.received_at desc, inbox.payment_event_id desc
  limit p_limit offset p_offset;
end;
$$;

-- The existing 13-argument intake remains available during the broker rollout.
-- The new broker calls this atomic wrapper after its signed phone verification.
create function app.record_receiver_sms_payment_event_with_display(
  p_provider_code text, p_reference_digest text, p_reference_fingerprint text,
  p_amount_minor bigint, p_occurred_at timestamptz, p_received_at timestamptz,
  p_observed_at timestamptz, p_source_message_digest text, p_event_body_digest text,
  p_device_id text, p_device_key_id text, p_device_public_key_spki_sha256 text,
  p_source_subscription_id integer, p_reference_ciphertext text,
  p_reference_masked text
) returns text language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_status text;
  v_event_id uuid;
begin
  if session_user <> 'fetanagent_receiver_sms_ingest_runtime'
    or p_provider_code not in ('telebirr','cbe_birr')
    or p_reference_ciphertext is null
    or p_reference_ciphertext !~ ('^sms-display-v1[.]' || p_provider_code ||
      '[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{11,43}$')
    or p_reference_masked is null
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$' then
    raise exception using errcode = '42501', message = 'Receiver SMS display payload is invalid.';
  end if;

  v_status := app.record_receiver_sms_payment_event(
    p_provider_code, p_reference_digest, p_reference_fingerprint,
    p_amount_minor, p_occurred_at, p_received_at, p_observed_at,
    p_source_message_digest, p_event_body_digest, p_device_id,
    p_device_key_id, p_device_public_key_spki_sha256, p_source_subscription_id);
  if v_status = 'conflict' then return v_status; end if;
  if v_status not in ('recorded','exact_replay') then
    raise exception 'Receiver SMS recording returned an unexpected status.';
  end if;

  select sms.id into v_event_id
    from app.receiver_sms_payment_events sms
    where sms.provider_code = p_provider_code
      and sms.reference_digest = p_reference_digest
      and sms.reference_fingerprint = p_reference_fingerprint
      and sms.source_message_digest = p_source_message_digest;
  if v_event_id is null then
    raise exception 'Recorded receiver SMS identity is unavailable.';
  end if;
  insert into app.receiver_sms_payment_reference_displays (
    payment_event_id, reference_ciphertext, reference_masked
  ) values (v_event_id, p_reference_ciphertext, p_reference_masked)
  on conflict (payment_event_id) do nothing;
  return v_status;
end;
$$;
alter function app.record_receiver_sms_payment_event_with_display(
  text,text,text,bigint,timestamptz,timestamptz,timestamptz,
  text,text,text,text,text,integer,text,text) owner to postgres;
revoke all on function app.record_receiver_sms_payment_event_with_display(
  text,text,text,bigint,timestamptz,timestamptz,timestamptz,
  text,text,text,text,text,integer,text,text)
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest_runtime;
grant execute on function app.record_receiver_sms_payment_event_with_display(
  text,text,text,bigint,timestamptz,timestamptz,timestamptz,
  text,text,text,text,text,integer,text,text)
  to fetanagent_receiver_sms_ingest;

-- Existing list functions retain their masked contracts. Each new projection
-- authenticates the active Owner before it exposes ciphertext to the server.
create function app.list_owner_submitted_payments_sensitive(
  p_actor_auth_user_id uuid, p_status text, p_limit integer, p_offset integer
) returns table (
  case_id uuid, candidate_id uuid, legacy_candidate_id uuid,
  payment_event_id uuid, provider_code text, reference_masked text,
  submitted_at timestamptz, payment_at timestamptz, amount_minor bigint,
  receiver_account_id uuid, receiver_account_masked text, player_id text,
  payment_status text, status_detail text, owner_case_status text,
  rejection_reason text, decided_at timestamptz, completed_at timestamptz,
  can_approve boolean, can_reject boolean,
  reference_ciphertext text, reference_fingerprint text,
  receiver_ciphertext text, receiver_fingerprint text
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select listed.*, coalesce(candidate.reference_ciphertext,
      legacy.candidate_reference_ciphertext),
    coalesce(candidate.reference_fingerprint,
      legacy.candidate_reference_fingerprint),
    receiver.account_reference_ciphertext, receiver.account_reference_fingerprint
  from app.list_owner_submitted_payments(
    p_actor_auth_user_id,p_status,p_limit,p_offset) listed
  left join app.receiver_sms_deposit_candidates candidate
    on candidate.id = listed.candidate_id
  left join app.routine_telebirr_untrusted_proof_requests legacy
    on legacy.id = listed.legacy_candidate_id
  left join app.receiver_accounts receiver on receiver.id = listed.receiver_account_id;
end;
$$;
alter function app.list_owner_submitted_payments_sensitive(uuid,text,integer,integer)
  owner to postgres;
revoke all on function app.list_owner_submitted_payments_sensitive(uuid,text,integer,integer)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_submitted_payments_sensitive(uuid,text,integer,integer)
  to fetanagent_owner_control;

create function app.list_owner_receiver_sms_inbox_sensitive(
  p_actor_auth_user_id uuid, p_provider text, p_status text,
  p_reference_last4 text, p_from date, p_to date,
  p_limit integer, p_offset integer
) returns table (
  payment_event_id uuid, provider_code text, payment_at timestamptz,
  received_at timestamptz, amount_minor bigint, receiver_account_masked text,
  receiver_holder_name text, reference_masked text, candidate_id uuid,
  player_masked text, payment_status text, case_id uuid,
  can_mark_manually_credited boolean,
  receiver_ciphertext text, receiver_fingerprint text,
  player_id text, reference_ciphertext text, reference_source text,
  reference_digest text, reference_fingerprint text,
  display_reference_masked text
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select listed.*, receiver.account_reference_ciphertext,
    receiver.account_reference_fingerprint, player.player_id,
    coalesce(display.reference_ciphertext, candidate.reference_ciphertext),
    case when display.payment_event_id is not null then 'sms_display'::text
      when candidate.id is not null then 'candidate'::text
      else 'unavailable'::text end,
    sms.reference_digest, sms.reference_fingerprint,
    coalesce(display.reference_masked,candidate.reference_masked)
  from app.list_owner_receiver_sms_inbox_filtered(
    p_actor_auth_user_id,p_provider,p_status,p_reference_last4,
    p_from,p_to,p_limit,p_offset) listed
  join app.receiver_sms_payment_events sms on sms.id = listed.payment_event_id
  join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
  left join app.receiver_sms_payment_reference_displays display
    on display.payment_event_id = sms.id
  left join app.receiver_sms_deposit_candidates candidate
    on candidate.id = listed.candidate_id
  left join app.customer_platform_players player
    on player.id = candidate.player_account_id;
end;
$$;
alter function app.list_owner_receiver_sms_inbox_sensitive(
  uuid,text,text,text,date,date,integer,integer) owner to postgres;
revoke all on function app.list_owner_receiver_sms_inbox_sensitive(
  uuid,text,text,text,date,date,integer,integer)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_receiver_sms_inbox_sensitive(
  uuid,text,text,text,date,date,integer,integer)
  to fetanagent_owner_control;

create function app.list_owner_provider_deposit_controls_sensitive(p_actor_auth_user_id uuid)
returns table (
  provider_code text, owner_enabled boolean, readiness text,
  receiver_name text, receiver_masked text, pending_jobs bigint,
  fenced_attempts bigint, changed_at timestamptz,
  receiver_ciphertext text, receiver_fingerprint text
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select listed.*, receiver.account_reference_ciphertext,
    receiver.account_reference_fingerprint
  from app.list_owner_provider_deposit_controls(p_actor_auth_user_id) listed
  left join app.payment_providers provider on provider.code = listed.provider_code
  left join app.receiver_accounts receiver on receiver.provider_id = provider.id
    and receiver.status = 'active';
end;
$$;
alter function app.list_owner_provider_deposit_controls_sensitive(uuid) owner to postgres;
revoke all on function app.list_owner_provider_deposit_controls_sensitive(uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_provider_deposit_controls_sensitive(uuid)
  to fetanagent_owner_control;

create function app.list_owner_receiver_accounts_sensitive(p_actor_auth_user_id uuid)
returns table (
  provider_code text, provider_display_name text, receiver_revision_id uuid,
  revision integer, account_holder_name text, account_reference_masked text,
  receiver_status text, active_from timestamptz, retired_at timestamptz,
  rotation_reason text, protected_reference boolean,
  account_reference_ciphertext text, account_reference_fingerprint text
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select listed.*, receiver.account_reference_ciphertext,
    receiver.account_reference_fingerprint
  from app.list_owner_receiver_accounts(p_actor_auth_user_id) listed
  left join app.receiver_accounts receiver on receiver.id = listed.receiver_revision_id;
end;
$$;
alter function app.list_owner_receiver_accounts_sensitive(uuid) owner to postgres;
revoke all on function app.list_owner_receiver_accounts_sensitive(uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_receiver_accounts_sensitive(uuid)
  to fetanagent_owner_control;

commit;
