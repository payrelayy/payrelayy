-- One-hour routine TeleBirr presentations and durable, bot-only expiry cleanup.
-- Historical ten-minute and pilot twelve-hour receipts keep their original deadlines.
-- This migration has no payment-claim or execution path; install with financial gates off.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $preflight$
begin
  if (select pg_catalog.count(*) from app.feature_switches switch
       where switch.feature_key in ('payment_verification', 'deposit_execution')
         and switch.mode = 'disabled' and switch.settings = '{}'::jsonb) <> 2 then
    raise exception 'Install one-hour Telegram instructions only with TeleBirr financial gates off.';
  end if;
end;
$preflight$;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.telegram_telebirr_destination_receipts
  drop constraint telegram_telebirr_destination_receipts_expiry_shape;
alter table app.telegram_telebirr_destination_receipts
  add constraint telegram_telebirr_destination_receipts_expiry_shape check (
    payment_presentation_expires_at in (
      created_at + interval '10 minutes',
      created_at + interval '1 hour',
      created_at + interval '12 hours'
    )
  );

-- Preserve the exact reviewed security-definer function, changing only its new-row deadline.
-- The source hash and catalog preconditions fail closed if a later release changed the routine.
do $extend_routine_window$
declare
  routine_oid oid :=
    'app.prepare_telegram_routine_telebirr_paid_destination_core(uuid,text,text)'::pg_catalog.regprocedure;
  source_body text;
begin
  select routine.prosrc into source_body from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
        '47cf2d933327cb6423cf28b18ef1bc275be47b2e60e7d504390333fbd7169f2d'
    or pg_catalog.length(source_body) - pg_catalog.length(pg_catalog.replace(
      source_body, 'v_now + interval ''10 minutes''', '')) <>
      pg_catalog.length('v_now + interval ''10 minutes''') then
    raise exception 'Routine TeleBirr presentation is not the reviewed definition.';
  end if;
  execute pg_catalog.replace(
    pg_catalog.pg_get_functiondef(routine_oid),
    'v_now + interval ''10 minutes''',
    'v_now + interval ''1 hour'''
  );
  select routine.prosrc into source_body from pg_catalog.pg_proc routine
   where routine.oid = routine_oid;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      'c0abfb0041557028e30099446a0d77789ec78c4135105bb7239a7dfee3222547' then
    raise exception 'Routine TeleBirr presentation rewrite failed.';
  end if;
end;
$extend_routine_window$;

create table app.telegram_payment_instruction_messages (
  origin_inbound_event_id uuid primary key
    references app.telegram_telebirr_destination_receipts(origin_inbound_event_id)
    on delete restrict,
  private_chat_id bigint not null
    check (private_chat_id > 0 and private_chat_id <= 9007199254740991),
  telegram_message_id bigint not null
    check (telegram_message_id > 0 and telegram_message_id <= 9007199254740991),
  constraint telegram_payment_instruction_chat_message_unique
    unique (private_chat_id, telegram_message_id),
  expires_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'complete', 'unavailable')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint telegram_payment_instruction_message_state_shape check (
    (state = 'pending' and lease_token is null and lease_expires_at is null
      and completed_at is null)
    or (state = 'leased' and lease_token is not null and lease_expires_at is not null
      and completed_at is null)
    or (state in ('complete', 'unavailable') and lease_expires_at is null
      and completed_at is not null)
  )
);
create index telegram_payment_instruction_due_idx
  on app.telegram_payment_instruction_messages
    (next_attempt_at, expires_at, origin_inbound_event_id)
  where state in ('pending', 'leased');
alter table app.telegram_payment_instruction_messages owner to postgres;
alter table app.telegram_payment_instruction_messages enable row level security;
alter table app.telegram_payment_instruction_messages force row level security;
revoke all on table app.telegram_payment_instruction_messages
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;

create function app.record_telegram_payment_instruction_message(
  p_update_id bigint, p_private_chat_id bigint, p_message_id bigint
)
returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_receipt app.telegram_telebirr_destination_receipts%rowtype;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram instruction recording is unavailable.';
  end if;
  if p_update_id is null or p_update_id < 0
    or p_private_chat_id is null or p_private_chat_id <= 0
    or p_private_chat_id > 9007199254740991
    or p_message_id is null or p_message_id <= 0
    or p_message_id > 9007199254740991 then return false; end if;
  select receipt.* into v_receipt
    from app.telegram_telebirr_destination_receipts receipt
    join app.inbound_events inbound_event
      on inbound_event.id = receipt.origin_inbound_event_id
    join app.telegram_identities identity
      on identity.customer_identity_id = receipt.customer_identity_id
   where inbound_event.channel = 'telegram'
     and inbound_event.telegram_update_id = p_update_id
     and identity.private_chat_id = p_private_chat_id
     and identity.telegram_user_id = p_private_chat_id
     and receipt.routine_processing_authorization_id is not null
     and receipt.payment_presentation_expires_at = receipt.created_at + interval '1 hour'
   for share of receipt;
  if v_receipt.origin_inbound_event_id is null
    or pg_catalog.clock_timestamp() >= v_receipt.payment_presentation_expires_at then
    return false;
  end if;
  insert into app.telegram_payment_instruction_messages (
    origin_inbound_event_id, private_chat_id, telegram_message_id, expires_at
  ) values (
    v_receipt.origin_inbound_event_id, p_private_chat_id, p_message_id,
    v_receipt.payment_presentation_expires_at
  ) on conflict (origin_inbound_event_id) do nothing;
  return exists (
    select 1 from app.telegram_payment_instruction_messages instruction
     where instruction.origin_inbound_event_id = v_receipt.origin_inbound_event_id
       and instruction.private_chat_id = p_private_chat_id
       and instruction.telegram_message_id = p_message_id
       and instruction.expires_at = v_receipt.payment_presentation_expires_at
  );
end;
$$;

create function app.claim_telegram_payment_instruction_expiry()
returns table (
  instruction_event_id uuid, instruction_lease_token uuid,
  instruction_private_chat_id bigint, instruction_message_id bigint,
  instruction_suppress_menu boolean
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_event_id uuid;
  v_lease_token uuid;
  v_chat_id bigint;
  v_message_id bigint;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram instruction expiry is unavailable.';
  end if;
  -- A lost ACK on the tenth Telegram attempt must not strand an expired lease forever.
  update app.telegram_payment_instruction_messages instruction
     set state = 'unavailable', lease_token = null,
         lease_expires_at = null, completed_at = v_now
   where instruction.state = 'leased' and instruction.attempts >= 10
     and instruction.lease_expires_at <= v_now;
  select instruction.origin_inbound_event_id into v_event_id
    from app.telegram_payment_instruction_messages instruction
   where instruction.state in ('pending', 'leased')
     and instruction.expires_at <= v_now
     and instruction.next_attempt_at <= v_now
     and instruction.attempts < 10
     and (instruction.state <> 'leased' or instruction.lease_expires_at <= v_now)
   order by instruction.expires_at, instruction.origin_inbound_event_id
   limit 1 for update skip locked;
  if v_event_id is null then return; end if;
  update app.telegram_payment_instruction_messages instruction
     set state = 'leased', attempts = instruction.attempts + 1,
         lease_token = pg_catalog.gen_random_uuid(),
         lease_expires_at = v_now + interval '90 seconds',
         next_attempt_at = v_now + interval '90 seconds'
   where instruction.origin_inbound_event_id = v_event_id
   returning instruction.lease_token, instruction.private_chat_id,
             instruction.telegram_message_id
    into v_lease_token, v_chat_id, v_message_id;
  if v_lease_token is null or v_chat_id is null or v_message_id is null then
    raise exception 'Telegram instruction expiry lease was not recorded.';
  end if;
  return query select v_event_id, v_lease_token, v_chat_id, v_message_id,
    exists (
      -- A newer, still-live instruction is already the current call to action. Do not put a
      -- fresh menu after it when cleaning up an older instruction from the same private chat.
      select 1 from app.telegram_payment_instruction_messages newer
       where newer.private_chat_id = v_chat_id
         and newer.origin_inbound_event_id <> v_event_id
         and newer.expires_at > v_now
         and newer.state in ('pending', 'leased')
    ) or exists (
      -- A submitted candidate has its own waiting/final message lifecycle. This instruction
      -- expiry removes the stale card but must not add a second progress/menu message.
      select 1 from app.telegram_telebirr_destination_receipts receipt
      join app.routine_telebirr_untrusted_proof_requests candidate
        on candidate.origin_identity_id = receipt.customer_identity_id
       and candidate.player_account_id = receipt.player_account_id
       and candidate.origin_channel = 'telegram'
       and candidate.intake_mode = 'paid'
       and candidate.submitted_at >= receipt.created_at
       and candidate.submitted_at < receipt.payment_presentation_expires_at
      where receipt.origin_inbound_event_id = v_event_id
    );
end;
$$;

create function app.complete_telegram_payment_instruction_expiry(
  p_event_id uuid, p_lease_token uuid, p_result text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_instruction app.telegram_payment_instruction_messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram instruction expiry completion is unavailable.';
  end if;
  if p_event_id is null or p_lease_token is null
    or p_result not in ('complete', 'retry', 'unavailable') then return false; end if;
  select * into v_instruction from app.telegram_payment_instruction_messages instruction
   where instruction.origin_inbound_event_id = p_event_id for update;
  if v_instruction.origin_inbound_event_id is null
    or v_instruction.lease_token is distinct from p_lease_token then return false; end if;
  if v_instruction.state = 'complete' and p_result = 'complete' then return true; end if;
  if v_instruction.state <> 'leased' or v_instruction.lease_expires_at <= v_now then
    return false;
  end if;
  if p_result = 'complete' then
    update app.telegram_payment_instruction_messages instruction
       set state = 'complete', lease_expires_at = null, completed_at = v_now
     where instruction.origin_inbound_event_id = p_event_id;
  elsif p_result = 'unavailable' or v_instruction.attempts >= 10 then
    update app.telegram_payment_instruction_messages instruction
       set state = 'unavailable', lease_token = null,
           lease_expires_at = null, completed_at = v_now
     where instruction.origin_inbound_event_id = p_event_id;
  else
    update app.telegram_payment_instruction_messages instruction
       set state = 'pending', lease_token = null, lease_expires_at = null,
           next_attempt_at = v_now + pg_catalog.make_interval(
             secs => pg_catalog.least(300, 5 * (1 << v_instruction.attempts))
           )
     where instruction.origin_inbound_event_id = p_event_id;
  end if;
  return true;
end;
$$;

alter function app.record_telegram_payment_instruction_message(bigint,bigint,bigint)
  owner to postgres;
alter function app.claim_telegram_payment_instruction_expiry() owner to postgres;
alter function app.complete_telegram_payment_instruction_expiry(uuid,uuid,text)
  owner to postgres;
revoke all on function app.record_telegram_payment_instruction_message(bigint,bigint,bigint),
  app.claim_telegram_payment_instruction_expiry(),
  app.complete_telegram_payment_instruction_expiry(uuid,uuid,text)
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.record_telegram_payment_instruction_message(bigint,bigint,bigint),
  app.claim_telegram_payment_instruction_expiry(),
  app.complete_telegram_payment_instruction_expiry(uuid,uuid,text)
  to fetanagent_player_actions;

comment on table app.telegram_payment_instruction_messages is
  'Bot-only Telegram message IDs for one-hour routine instruction expiry; no payment authority, receipt, amount, or Player identifier.';
commit;
