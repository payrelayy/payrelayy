-- Keep the customer-visible Ready label aligned with the separate financial eligibility ledger.
--
-- This is a read-only projection hardening. It adds no ownership proof, eligibility writer,
-- deposit route, runtime privilege, provider call, feature switch, or financial authorization.
-- The deposit-intent trigger remains the authoritative eligibility and serialization boundary.

begin;

create or replace function app.list_customer_web_player_registrations(
  p_actor_auth_user_id uuid,
  p_limit integer default 20
)
returns table (
  platform_code text,
  submitted_player_id text,
  request_status text,
  request_created_at timestamptz,
  request_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_customer_identity_id uuid;
  resolved_customer_id uuid;
begin
  if p_actor_auth_user_id is null
    or p_limit is null
    or p_limit not between 1 and 20 then
    raise exception 'The customer-web Player ID list request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:customer-auth:v1:' || p_actor_auth_user_id::text,
      0::bigint
    )
  );

  if exists (
    select 1
      from app.admin_users admin_user
     where admin_user.auth_user_id = p_actor_auth_user_id
       and admin_user.status = 'active'
  ) then
    raise exception 'The customer-web Player ID list request is unavailable.';
  end if;

  select customer_auth_identity.customer_identity_id,
         customer_auth_identity.customer_id
    into resolved_customer_identity_id,
         resolved_customer_id
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
     and customer_identity.identity_kind = 'supabase_auth'
     and customer_identity.external_subject = p_actor_auth_user_id::text
     and customer_identity.status = 'active'
     and customer.status = 'active'
   for share of customer_auth_identity, customer_identity, customer;

  if not found then
    raise exception 'The customer-web Player ID list request is unavailable.';
  end if;

  return query
  select platform.code,
         registration_request.player_id,
         case
           when registration_request.status in ('not_found', 'cancelled') then
             'needs_attention'
           when registration_request.status = 'exists'
             and association.id is not null
             and player_account.id is not null
             and validation_attempt.id is not null
             and player_account.status = 'active'
             and player_account.validation_status = 'valid'
             and platform.status = 'active'
             and eligibility_history.decision_count > 0
             and eligibility_history.decision_count = eligibility_history.maximum_version
             and eligibility_history.history_is_monotonic
             and latest_eligibility.decision_version = eligibility_history.maximum_version
             and latest_eligibility.decision = 'eligible'
             and latest_eligibility.decided_at <= clock_timestamp()
             and latest_eligibility.player_account_updated_at_snapshot
                 is not distinct from player_account.updated_at then
             'ready'
           else
             'checking'
         end,
         registration_request.created_at,
         registration_request.updated_at
    from app.player_registration_requests registration_request
    join app.platforms platform
      on platform.id = registration_request.platform_id
     and platform.code = 'kemerbet'
    left join app.player_registration_request_associations association
      on association.player_registration_request_id = registration_request.id
    left join app.customer_platform_players player_account
      on player_account.id = association.player_account_id
     and player_account.customer_id = resolved_customer_id
     and player_account.platform_id = registration_request.platform_id
     and player_account.player_id = registration_request.player_id
    left join app.player_validation_attempts validation_attempt
      on validation_attempt.id = association.validation_attempt_id
     and validation_attempt.player_account_id = player_account.id
     and validation_attempt.outcome = 'valid'
    left join lateral (
      select count(*)::integer as decision_count,
             coalesce(max(history.decision_version), 0) as maximum_version,
             coalesce(
               bool_and(
                 history.previous_decided_at is null
                 or history.decided_at >= history.previous_decided_at
               ),
               false
             ) as history_is_monotonic
        from (
          select decision.decision_version,
                 decision.decided_at,
                 lag(decision.decided_at) over (
                   order by decision.decision_version
                 ) as previous_decided_at
            from app.player_deposit_eligibility_decisions decision
           where decision.player_account_id = player_account.id
        ) history
    ) eligibility_history on player_account.id is not null
    left join lateral (
      select decision.decision_version,
             decision.decision,
             decision.decided_at,
             decision.player_account_updated_at_snapshot
        from app.player_deposit_eligibility_decisions decision
       where decision.player_account_id = player_account.id
       order by decision.decision_version desc
       limit 1
    ) latest_eligibility on player_account.id is not null
   where registration_request.customer_id = resolved_customer_id
     and exists (
       select 1
         from app.customer_web_player_registration_request_origins request_origin
        where request_origin.player_registration_request_id = registration_request.id
          and request_origin.customer_auth_identity_id = resolved_customer_identity_id
     )
   order by registration_request.created_at desc, registration_request.id desc
   limit p_limit;
end;
$$;

alter function app.list_customer_web_player_registrations(uuid, integer) owner to postgres;

revoke all on function app.list_customer_web_player_registrations(uuid, integer)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime;

grant execute on function app.list_customer_web_player_registrations(uuid, integer)
  to fetanagent_customer_web;

comment on function app.list_customer_web_player_registrations(uuid, integer) is
  'Returns only the caller mapping''s web-origin KemerBet Player-ID requests. Ready is advisory and requires aligned ownership plus a well-formed current eligibility decision; the function cannot write eligibility or authorize a deposit.';

commit;
