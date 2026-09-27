-- Owner-approved TeleBirr execution. Verification may create a queued command, but only
-- an authenticated Owner approval for the current pilot and epoch may release it to the
-- existing single-agent companion lane. No execution role or feature switch is enabled here.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $preflight$
begin
  if exists (
    select 1
      from app.deposit_jobs job
      join app.deposit_intents intent on intent.id = job.deposit_intent_id
      join app.payment_providers provider on provider.id = intent.payment_provider_id
     where job.job_kind = 'execute_deposit'
       and job.status in ('queued', 'leased', 'retry_wait')
       and provider.code = 'telebirr'
  ) then
    raise exception 'Owner approval gate cannot be installed over open TeleBirr execution work.';
  end if;
end;
$preflight$;

create table app.deposit_execution_owner_approvals (
  execution_job_id uuid primary key,
  request_key uuid not null unique,
  deposit_intent_id uuid not null,
  pilot_revision_id uuid not null references app.private_live_deposit_pilot_revisions (id)
    on delete restrict,
  activation_epoch bigint not null references app.private_trusted_telebirr_activation_epochs (epoch)
    on delete restrict,
  approved_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  constraint deposit_execution_owner_approvals_job_intent_fkey
    foreign key (execution_job_id, deposit_intent_id)
    references app.deposit_jobs (id, deposit_intent_id) on delete restrict,
  constraint deposit_execution_owner_approvals_window_check check (expires_at > approved_at)
);

create index deposit_execution_owner_approvals_pilot_idx
  on app.deposit_execution_owner_approvals (pilot_revision_id, approved_at desc);

create trigger deposit_execution_owner_approvals_immutable
before update or delete on app.deposit_execution_owner_approvals
for each row execute function app.reject_private_trusted_telebirr_activation_retained_mutation();
create trigger deposit_execution_owner_approvals_no_truncate
before truncate on app.deposit_execution_owner_approvals
for each statement execute function app.reject_private_trusted_telebirr_activation_truncate();

create function app.list_owner_pending_telebirr_executions(
  p_actor_auth_user_id uuid,
  p_limit integer default 25
)
returns table (
  execution_job_id uuid,
  player_id text,
  amount_minor bigint,
  currency_code text,
  queued_at timestamptz,
  verified_at timestamptz,
  approved_at timestamptz,
  approval_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 25
    or not exists (
      select 1 from app.admin_users owner_user
       where owner_user.auth_user_id = p_actor_auth_user_id
         and owner_user.role = 'owner' and owner_user.status = 'active'
    ) then
    raise exception using errcode = '42501',
      message = 'Only the active Owner can view pending execution approvals.';
  end if;

  return query
  select job.id, player.player_id, intent.expected_amount_minor,
         intent.currency_code::text, job.created_at, intent.verified_at,
         approval.approved_at, approval.expires_at
    from app.deposit_jobs job
    join app.deposit_intents intent on intent.id = job.deposit_intent_id
    join app.customer_platform_players player on player.id = intent.player_account_id
    join app.payment_providers provider on provider.id = intent.payment_provider_id
    join app.private_live_deposit_pilot_reservations reservation
      on reservation.deposit_intent_id = intent.id
     and reservation.player_account_id = intent.player_account_id
     and reservation.payment_provider_id = intent.payment_provider_id
     and reservation.amount_minor = intent.expected_amount_minor
     and reservation.currency_code = intent.currency_code
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = reservation.pilot_revision_id
    left join app.deposit_execution_owner_approvals approval
      on approval.execution_job_id = job.id
     and approval.deposit_intent_id = intent.id
     and approval.pilot_revision_id = pilot.id
   where job.job_kind = 'execute_deposit'
     and job.status = 'queued' and job.attempt_count = 0
     and job.max_attempts = 1
     and job.run_after <= pg_catalog.clock_timestamp()
     and intent.status = 'execution_pending'
     and intent.verified_at is not null
     and intent.expected_amount_minor = 2500
     and intent.currency_code = 'ETB'
     and provider.code = 'telebirr'
     and pilot.status = 'armed'
     and pilot.active_from <= pg_catalog.clock_timestamp()
     and pilot.expires_at > pg_catalog.clock_timestamp()
   order by job.priority desc, job.run_after, job.created_at, job.id
   limit p_limit;
end;
$$;

create function app.approve_owner_telebirr_execution(
  p_actor_auth_user_id uuid,
  p_execution_job_id uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_admin_id uuid;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  approval app.deposit_execution_owner_approvals%rowtype;
  companion app.agent_platform_companion_execution_control%rowtype;
  intent app.deposit_intents%rowtype;
  job app.deposit_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  selected_at timestamptz;
  selected_epoch bigint;
  valid_until timestamptz;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  if p_actor_auth_user_id is null or p_execution_job_id is null
    or p_request_key is null then
    raise exception 'The Owner execution approval input is invalid.';
  end if;

  -- Serialize Owner approvals without holding any lock across a provider operation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:owner-approved-telebirr-execution', 0)
  );

  select owner_user.id into actor_admin_id
    from app.admin_users owner_user
   where owner_user.auth_user_id = p_actor_auth_user_id
     and owner_user.role = 'owner' and owner_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception using errcode = '42501',
      message = 'Only the active Owner can approve execution.';
  end if;

  -- A lost HTTP response may be replayed with the same key after the companion has
  -- already leased or completed the job. Return only the immutable prior receipt.
  select existing.* into approval
    from app.deposit_execution_owner_approvals existing
   where existing.execution_job_id = p_execution_job_id
     and existing.request_key = p_request_key
     and existing.approved_by_admin_id = actor_admin_id;
  if approval.execution_job_id is not null then
    return pg_catalog.jsonb_build_object(
      'approvedAt', approval.approved_at, 'expiresAt', approval.expires_at,
      'alreadyApproved', true
    );
  end if;

  -- Match the financial lock order used by the companion lease: epoch, sorted switches,
  -- pilot, then job. The companion control is only read, never locked in reverse order.
  select control.current_epoch into selected_epoch
    from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority'
   for share;
  select epoch.* into authority
    from app.private_trusted_telebirr_activation_epochs epoch
   where epoch.epoch = selected_epoch
   for share;
  perform switch.feature_key
    from app.feature_switches switch
   where switch.feature_key in (
     'deposit_execution', 'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by switch.feature_key
   for share;
  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = authority.pilot_revision_id
   for share;
  select control.* into companion
    from app.agent_platform_companion_execution_control control
   where control.singleton;
  select execution_job.* into job
    from app.deposit_jobs execution_job
   where execution_job.id = p_execution_job_id
   for update;
  select deposit_intent.* into intent
    from app.deposit_intents deposit_intent
   where deposit_intent.id = job.deposit_intent_id;

  selected_at := pg_catalog.clock_timestamp();
  valid_until := least(authority.expires_at, pilot.expires_at, companion.expires_at);
  if job.id is null or intent.id is null
    or job.job_kind <> 'execute_deposit' or job.status <> 'queued'
    or job.attempt_count <> 0 or job.max_attempts <> 1
    or job.lease_token is not null or job.run_after > selected_at
    or intent.status <> 'execution_pending' or intent.verified_at is null
    or intent.currency_code <> 'ETB' or intent.expected_amount_minor <> 2500
    or authority.epoch is null or authority.authority_state <> 'active'
    or authority.revoked_at is not null or authority.epoch <> selected_epoch
    or pilot.id is null or pilot.status <> 'armed'
    or pilot.configuration_digest <> authority.configuration_digest
    or companion.singleton is null or companion.control_state <> 'active'
    or companion.expires_at is null
    or companion.activation_epoch <> authority.epoch
    or companion.pilot_revision_id <> pilot.id
    or selected_at < pilot.active_from or selected_at < authority.active_from
    or selected_at < companion.active_from
    or valid_until <= selected_at + interval '30 seconds'
    or not exists (
      select 1 from app.payment_providers provider
       where provider.id = intent.payment_provider_id
         and provider.code = 'telebirr' and provider.status = 'active'
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.pilot_revision_id = pilot.id
         and reservation.deposit_intent_id = intent.id
         and reservation.player_account_id = intent.player_account_id
         and reservation.payment_provider_id = intent.payment_provider_id
         and reservation.amount_minor = intent.expected_amount_minor
         and reservation.currency_code = intent.currency_code
    )
    or not exists (
      select 1 from app.deposit_payment_claims claim
       where claim.deposit_intent_id = intent.id
    )
    or (
      select pg_catalog.count(*) from app.feature_switches switch
       where switch.feature_key in (
         'deposit_execution', 'payment_verification', 'private_live_deposit_pilot',
         'telebirr_authoritative_verification'
       ) and switch.mode = 'live'
    ) <> 4
    or exists (
      select 1 from app.deposit_execution_attempts attempt
       where attempt.deposit_intent_id = intent.id
    ) then
    raise exception 'The selected deposit is not ready for Owner-approved execution.';
  end if;

  select existing.* into approval
    from app.deposit_execution_owner_approvals existing
   where existing.execution_job_id = job.id;
  if approval.execution_job_id is not null then
    raise exception 'The selected deposit already has a different approval.';
  end if;

  -- An Owner releases only one command at a time. The existing agent-account attempt
  -- fence and companion assignment singleton independently enforce physical serialization.
  if exists (
    select 1 from app.deposit_execution_owner_approvals existing
    join app.deposit_jobs other_job on other_job.id = existing.execution_job_id
     where other_job.id <> job.id and other_job.status in ('queued', 'leased')
       and existing.expires_at > selected_at
  ) or exists (
    select 1 from app.deposit_execution_attempts attempt
     where attempt.status in (
       'prepared', 'final_action_fenced', 'reconciliation_required', 'review_required'
     )
  ) then
    raise exception 'Another deposit must finish or be reconciled first.';
  end if;

  insert into app.deposit_execution_owner_approvals (
    execution_job_id, request_key, deposit_intent_id, pilot_revision_id, activation_epoch,
    approved_by_admin_id, approved_at, expires_at
  ) values (
    job.id, p_request_key, intent.id, pilot.id, authority.epoch,
    actor_admin_id, selected_at, valid_until
  ) returning * into approval;

  return pg_catalog.jsonb_build_object(
    'approvedAt', approval.approved_at, 'expiresAt', approval.expires_at,
    'alreadyApproved', false
  );
end;
$$;

create function app.require_owner_approved_telebirr_execution_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_code text;
begin
  if old.job_kind <> 'execute_deposit'
    or old.status not in ('queued', 'retry_wait') or new.status <> 'leased' then
    return new;
  end if;
  select provider.code into provider_code
    from app.deposit_intents intent
    join app.payment_providers provider on provider.id = intent.payment_provider_id
   where intent.id = old.deposit_intent_id;
  if provider_code is null then
    raise exception 'The execution provider is unavailable.';
  end if;
  if provider_code = 'telebirr' and not exists (
    select 1 from app.deposit_execution_owner_approvals approval
    join app.private_live_deposit_pilot_reservations reservation
      on reservation.pilot_revision_id = approval.pilot_revision_id
     and reservation.deposit_intent_id = approval.deposit_intent_id
   where approval.execution_job_id = old.id
     and approval.deposit_intent_id = old.deposit_intent_id
     and approval.activation_epoch = (
       select control.current_epoch
         from app.private_trusted_telebirr_activation_control control
        where control.control_key = 'trusted_telebirr_financial_authority'
     )
     and approval.approved_at <= pg_catalog.clock_timestamp()
     and approval.expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception 'TeleBirr execution requires current one-job Owner approval.';
  end if;
  return new;
end;
$$;

create trigger deposit_jobs_require_owner_approved_telebirr_execution
before update on app.deposit_jobs
for each row execute function app.require_owner_approved_telebirr_execution_lease();

-- The provider-aware selector must skip unapproved TeleBirr jobs, not repeatedly select
-- and reject the queue head. Preserve the existing function OID, owner, ACL and configuration.
do $patch_provider_lease$
declare
  target regprocedure := 'app.lease_private_live_deposit_by_provider(uuid,integer,boolean)'::regprocedure;
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  original_security_definer boolean;
  original_config text[];
  marker text := '     and execution_job.status = ''queued''';
  replacement text := $replacement$     and execution_job.status = 'queued'
     and (
       provider_member.provider_code_snapshot <> 'telebirr'
       or exists (
         select 1 from app.deposit_execution_owner_approvals approval
          where approval.execution_job_id = execution_job.id
            and approval.deposit_intent_id = deposit_intent.id
            and approval.pilot_revision_id = pilot.id
            and approval.activation_epoch = (
              select control.current_epoch
                from app.private_trusted_telebirr_activation_control control
               where control.control_key = 'trusted_telebirr_financial_authority'
            )
            and approval.approved_at <= pg_catalog.clock_timestamp()
            and approval.expires_at > pg_catalog.clock_timestamp()
       )
     )$replacement$;
  patched_source text;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl, routine.prosecdef, routine.proconfig
    into original_definition, original_source, original_owner, original_acl,
         original_security_definer, original_config
    from pg_catalog.pg_proc routine where routine.oid = target;
  if original_source is null
    or (pg_catalog.length(original_source) -
        pg_catalog.length(pg_catalog.replace(original_source, marker, '')))
       / pg_catalog.length(marker) <> 1 then
    raise exception 'The provider lease source does not match the reviewed approval gate.';
  end if;
  patched_source := pg_catalog.replace(original_source, marker, replacement);
  execute pg_catalog.replace(original_definition, marker, replacement);
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = target and routine.prosrc = patched_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prosecdef is not distinct from original_security_definer
       and routine.proconfig is not distinct from original_config
  ) then
    raise exception 'The provider lease approval patch changed function authority.';
  end if;
end;
$patch_provider_lease$;

alter table app.deposit_execution_owner_approvals enable row level security;
alter table app.deposit_execution_owner_approvals force row level security;
alter table app.deposit_execution_owner_approvals owner to postgres;
alter function app.list_owner_pending_telebirr_executions(uuid, integer) owner to postgres;
alter function app.approve_owner_telebirr_execution(uuid, uuid, uuid) owner to postgres;
alter function app.require_owner_approved_telebirr_execution_lease() owner to postgres;

revoke all on app.deposit_execution_owner_approvals
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime;
revoke all on function
  app.list_owner_pending_telebirr_executions(uuid, integer),
  app.approve_owner_telebirr_execution(uuid, uuid, uuid),
  app.require_owner_approved_telebirr_execution_lease()
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime;
grant execute on function
  app.list_owner_pending_telebirr_executions(uuid, integer),
  app.approve_owner_telebirr_execution(uuid, uuid, uuid)
  to fetanagent_owner_control;

comment on table app.deposit_execution_owner_approvals is
  'Immutable, one-job Owner approvals bound to the current live TeleBirr pilot and trusted activation epoch. They do not grant execution authority by themselves.';
comment on function app.approve_owner_telebirr_execution(uuid, uuid, uuid) is
  'Owner-control-only, one-job approval after a verified proof is already queued. The existing companion lease, final-action fence and reconciliation remain mandatory.';
comment on function app.list_owner_pending_telebirr_executions(uuid, integer) is
  'Owner-only queue projection with no raw payment reference or provider secrets.';

commit;
