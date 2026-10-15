-- A receiver change after a one-hour Telegram instruction is a manual-review
-- boundary, never an old-receiver automatic-credit grace period.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $preflight$
begin
  if (select pg_catalog.count(*) from app.feature_switches switch
       where switch.feature_key in ('payment_verification', 'deposit_execution')
         and switch.mode = 'disabled' and switch.settings = '{}'::jsonb) <> 2 then
    raise exception 'Install rotated-instruction review only with TeleBirr financial gates off.';
  end if;
end;
$preflight$;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- This is an immutable review marker, not a payment finding. The candidate can
-- later be purged without erasing the decision that prevented automatic credit.
create table app.routine_telebirr_rotated_instruction_reviews (
  candidate_id uuid primary key,
  instruction_event_id uuid not null,
  origin_identity_id uuid not null,
  player_account_id uuid not null,
  instructed_receiver_account_id uuid not null,
  candidate_receiver_account_id uuid not null,
  reason_code text not null
    check (reason_code = 'receiver_changed_during_instruction'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index routine_rotated_instruction_review_instruction_idx
  on app.routine_telebirr_rotated_instruction_reviews
    (instruction_event_id, recorded_at);
alter table app.routine_telebirr_rotated_instruction_reviews owner to postgres;
alter table app.routine_telebirr_rotated_instruction_reviews enable row level security;
alter table app.routine_telebirr_rotated_instruction_reviews force row level security;
revoke all on table app.routine_telebirr_rotated_instruction_reviews
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_telebirr_paid_settlement,
    fetanagent_routine_telebirr_paid_settlement_runtime;
create trigger routine_rotated_instruction_reviews_immutable
before update or delete on app.routine_telebirr_rotated_instruction_reviews
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
create trigger routine_rotated_instruction_reviews_no_truncate
before truncate on app.routine_telebirr_rotated_instruction_reviews
for each statement execute function app.reject_routine_telebirr_untrusted_proof_mutation();

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected',
    'not_credited', 'not_verified', 'already_used', 'wrong_receiver',
    'invalid_reference', 'manual_review'
  ));

-- The candidate is bound to the active receiver by the existing BEFORE INSERT
-- trigger. If the same chat and Player have a displayed instruction for a
-- receiver retired during that instruction's hour, do not let this candidate
-- enter the ordinary phone/claim path. Conservatively review even a payment
-- that may have gone to the new receiver: the receipt cannot prove the full
-- receiving number at this point. A late submission is retained for review.
create function app.mark_routine_telebirr_rotated_instruction_review()
returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_instruction record;
  v_chat_id bigint;
begin
  if new.intake_mode <> 'paid' or new.origin_channel <> 'telegram'
    or new.provider_code <> 'telebirr' then return new; end if;
  select receipt.origin_inbound_event_id, receipt.receiver_account_id,
         telegram.private_chat_id
    into v_instruction
    from app.telegram_telebirr_destination_receipts receipt
    join app.telegram_identities telegram
      on telegram.customer_identity_id = receipt.customer_identity_id
     and telegram.private_chat_id = telegram.telegram_user_id
    join app.telegram_payment_instruction_messages message
      on message.origin_inbound_event_id = receipt.origin_inbound_event_id
     and message.private_chat_id = telegram.private_chat_id
     and message.expires_at = receipt.payment_presentation_expires_at
     and message.expires_at = receipt.payment_presentation_expires_at
    join app.receiver_accounts instructed
      on instructed.id = receipt.receiver_account_id
   where receipt.customer_identity_id = new.origin_identity_id
     and receipt.customer_id = new.submitting_customer_id
     and receipt.player_account_id = new.player_account_id
     and receipt.routine_processing_authorization_id is not null
     and receipt.payment_presentation_expires_at =
       receipt.created_at + interval '1 hour'
     and receipt.receiver_account_id <> new.receiver_account_id
     and instructed.provider_id = new.payment_provider_id
     and instructed.status = 'inactive'
     and instructed.retired_at >= receipt.created_at
     and instructed.retired_at < receipt.payment_presentation_expires_at
     and new.submitted_at >= instructed.retired_at
     and new.submitted_at < receipt.payment_presentation_expires_at + interval '1 hour'
   order by receipt.created_at desc, receipt.origin_inbound_event_id
   limit 1;
  if v_instruction.origin_inbound_event_id is null then return new; end if;
  v_chat_id := v_instruction.private_chat_id;
  insert into app.routine_telebirr_rotated_instruction_reviews (
    candidate_id, instruction_event_id, origin_identity_id,
    player_account_id, instructed_receiver_account_id,
    candidate_receiver_account_id, reason_code
  ) values (
    new.id, v_instruction.origin_inbound_event_id, new.origin_identity_id,
    new.player_account_id, v_instruction.receiver_account_id,
    new.receiver_account_id, 'receiver_changed_during_instruction'
  );
  insert into app.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) values (
    'system', 'deposit.telebirr_receiver_rotation_review_queued',
    'routine_telebirr_candidate', new.id,
    pg_catalog.jsonb_build_object('instruction_event_id', v_instruction.origin_inbound_event_id)
  );
  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, notification_stage, private_chat_id, reference_masked,
    outcome_code, amount_minor, next_attempt_at, created_at, updated_at
  ) values (
    new.id, 'final', v_chat_id, new.candidate_reference_masked,
    'manual_review', null, pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );
  return new;
end;
$$;
alter function app.mark_routine_telebirr_rotated_instruction_review() owner to postgres;
revoke all on function app.mark_routine_telebirr_rotated_instruction_review()
  from public, anon, authenticated, service_role;
create trigger routine_telebirr_rotated_instruction_review
after insert on app.routine_telebirr_untrusted_proof_requests
for each row execute function app.mark_routine_telebirr_rotated_instruction_review();

-- Receiver rotation itself requires all payment switches off. Any previously
-- submitted but unclaimed reference under a still-open instruction is moved to
-- the same review state before that rotation commits. A queued, already-claimed
-- credit must be resolved before changing the receiver; silently resuming it
-- against a new account would break the Owner's review-only rule.
create function app.mark_routine_telebirr_rotated_instruction_on_change()
returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_candidate record;
  v_count integer;
begin
  if new.status <> 'inactive' or old.status <> 'active'
    or new.retired_at is null then return new; end if;
  if not exists (
    select 1 from app.payment_providers provider
     where provider.id = new.provider_id and provider.code = 'telebirr'
  ) then return new; end if;
  if exists (
    select 1 from app.routine_telebirr_paid_intent_openings opening
    join app.deposit_intents intent on intent.id = opening.deposit_intent_id
    join app.routine_telebirr_untrusted_proof_requests candidate
      on candidate.id = opening.candidate_id
   where candidate.receiver_account_id = new.id
     and intent.status not in ('executed', 'rejected', 'expired', 'cancelled')
  ) then
    raise exception 'Resolve pending TeleBirr Player credits before rotating this receiver.';
  end if;
  select pg_catalog.count(*)::integer into v_count
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.telegram_telebirr_destination_receipts receipt
      on receipt.customer_identity_id = candidate.origin_identity_id
     and receipt.customer_id = candidate.submitting_customer_id
     and receipt.player_account_id = candidate.player_account_id
     and receipt.receiver_account_id = new.id
    join app.telegram_identities telegram
      on telegram.customer_identity_id = candidate.origin_identity_id
     and telegram.private_chat_id = telegram.telegram_user_id
    join app.telegram_payment_instruction_messages message
      on message.origin_inbound_event_id = receipt.origin_inbound_event_id
     and message.private_chat_id = telegram.private_chat_id
     and message.expires_at = receipt.payment_presentation_expires_at
   where candidate.receiver_account_id = new.id
     and candidate.intake_mode = 'paid' and candidate.origin_channel = 'telegram'
     and candidate.submitted_at >= receipt.created_at
     and candidate.submitted_at < receipt.payment_presentation_expires_at
     and candidate.submitted_at < new.retired_at
     and receipt.routine_processing_authorization_id is not null
     and receipt.payment_presentation_expires_at =
       receipt.created_at + interval '1 hour'
     and new.retired_at < receipt.payment_presentation_expires_at
     and not exists (select 1 from app.routine_telebirr_paid_intent_openings opening
       where opening.candidate_id = candidate.id)
     and not exists (select 1 from app.telegram_deposit_outcome_deliveries delivery
       where delivery.candidate_id = candidate.id and delivery.notification_stage = 'final');
  if v_count > 100 then
    raise exception 'Too many pending TeleBirr instructions to rotate safely.';
  end if;
  for v_candidate in
    select distinct on (candidate.id)
           candidate.id, candidate.origin_identity_id, candidate.player_account_id,
           candidate.candidate_reference_masked, receipt.origin_inbound_event_id,
           telegram.private_chat_id
      from app.routine_telebirr_untrusted_proof_requests candidate
      join app.telegram_telebirr_destination_receipts receipt
        on receipt.customer_identity_id = candidate.origin_identity_id
       and receipt.customer_id = candidate.submitting_customer_id
       and receipt.player_account_id = candidate.player_account_id
       and receipt.receiver_account_id = new.id
      join app.telegram_identities telegram
        on telegram.customer_identity_id = candidate.origin_identity_id
       and telegram.private_chat_id = telegram.telegram_user_id
      join app.telegram_payment_instruction_messages message
        on message.origin_inbound_event_id = receipt.origin_inbound_event_id
       and message.private_chat_id = telegram.private_chat_id
       and message.expires_at = receipt.payment_presentation_expires_at
     where candidate.receiver_account_id = new.id
       and candidate.intake_mode = 'paid' and candidate.origin_channel = 'telegram'
       and candidate.submitted_at >= receipt.created_at
       and candidate.submitted_at < receipt.payment_presentation_expires_at
       and candidate.submitted_at < new.retired_at
       and receipt.routine_processing_authorization_id is not null
       and receipt.payment_presentation_expires_at =
         receipt.created_at + interval '1 hour'
       and new.retired_at < receipt.payment_presentation_expires_at
       and not exists (select 1 from app.routine_telebirr_paid_intent_openings opening
         where opening.candidate_id = candidate.id)
       and not exists (select 1 from app.telegram_deposit_outcome_deliveries delivery
         where delivery.candidate_id = candidate.id and delivery.notification_stage = 'final')
     order by candidate.id, receipt.created_at desc
  loop
    insert into app.routine_telebirr_rotated_instruction_reviews (
      candidate_id, instruction_event_id, origin_identity_id, player_account_id,
      instructed_receiver_account_id, candidate_receiver_account_id, reason_code
    ) values (
      v_candidate.id, v_candidate.origin_inbound_event_id,
      v_candidate.origin_identity_id, v_candidate.player_account_id,
      new.id, new.id, 'receiver_changed_during_instruction'
    ) on conflict (candidate_id) do nothing;
    insert into app.audit_events (
      actor_kind, action, resource_type, resource_id, metadata
    ) values (
      'system', 'deposit.telebirr_receiver_rotation_review_queued',
      'routine_telebirr_candidate', v_candidate.id,
      pg_catalog.jsonb_build_object('instruction_event_id', v_candidate.origin_inbound_event_id)
    );
    insert into app.telegram_deposit_outcome_deliveries (
      candidate_id, notification_stage, private_chat_id, reference_masked,
      outcome_code, amount_minor, next_attempt_at, created_at, updated_at
    ) values (
      v_candidate.id, 'final', v_candidate.private_chat_id,
      v_candidate.candidate_reference_masked, 'manual_review', null,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    ) on conflict (candidate_id, notification_stage) do nothing;
  end loop;
  return new;
end;
$$;
alter function app.mark_routine_telebirr_rotated_instruction_on_change()
  owner to postgres;
revoke all on function app.mark_routine_telebirr_rotated_instruction_on_change()
  from public, anon, authenticated, service_role;
create trigger routine_telebirr_rotated_instruction_on_change
after update of status, retired_at on app.receiver_accounts
for each row when (old.status = 'active' and new.status = 'inactive')
execute function app.mark_routine_telebirr_rotated_instruction_on_change();

-- No runtime can bypass this marker by invoking a lower-level paid issuer or
-- settlement routine. A reviewed candidate has no automatic execution path.
create function app.reject_routine_telebirr_reviewed_automatic_action()
returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from app.routine_telebirr_rotated_instruction_reviews review
     where review.candidate_id = new.candidate_id
  ) then
    raise exception 'This TeleBirr submission requires manual receiver review.';
  end if;
  return new;
end;
$$;
alter function app.reject_routine_telebirr_reviewed_automatic_action() owner to postgres;
revoke all on function app.reject_routine_telebirr_reviewed_automatic_action()
  from public, anon, authenticated, service_role;
create trigger routine_telebirr_reviewed_no_paid_challenge
before insert on app.routine_telebirr_lookup_challenges
for each row when (new.issuance_mode = 'paid')
execute function app.reject_routine_telebirr_reviewed_automatic_action();
create trigger routine_telebirr_reviewed_no_paid_claim
before insert on app.routine_telebirr_paid_intent_openings
for each row execute function app.reject_routine_telebirr_reviewed_automatic_action();

-- Keep reviewed candidates out of the normal paid phone poll rather than
-- repeatedly attempting an assignment that the challenge trigger will refuse.
-- Preserve the existing narrow runtime grants and all other issuer checks.
do $exclude_review_from_paid_poll$
declare
  v_oid oid :=
    'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'
      ::pg_catalog.regprocedure;
  v_definition text;
  v_old constant text :=
    'and not app.routine_telebirr_same_customer_credited_reference(candidate.id)';
  v_new constant text :=
    'and not app.routine_telebirr_same_customer_credited_reference(candidate.id)'
    || E'\n     and not exists (select 1'
    || E'\n       from app.routine_telebirr_rotated_instruction_reviews review'
    || E'\n       where review.candidate_id = candidate.id)';
begin
  select pg_catalog.pg_get_functiondef(routine.oid) into v_definition
    from pg_catalog.pg_proc routine
   where routine.oid = v_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if v_definition is null
    or pg_catalog.length(v_definition) -
       pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')) <>
       pg_catalog.length(v_old) then
    raise exception 'The paid poll candidate selection is not the reviewed definition.';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$exclude_review_from_paid_poll$;

comment on table app.routine_telebirr_rotated_instruction_reviews is
  'Immutable Telegram candidate marker: a receiver changed during a displayed one-hour instruction. Manual review only; this does not verify money or authorize a Player credit.';
commit;
