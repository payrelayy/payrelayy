-- The legacy exact-five claim is an immutable snapshot of *associated* Players.
-- Telegram's signed Find creates/selects an unassociated Player. Its atomic
-- accept/finalize procedure needs a narrow, transaction-bound path through the
-- shared readiness-source trigger; direct table writes remain frozen.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if pg_catalog.has_table_privilege(
       'fetanagent_companion_device_bridge_runtime',
       'app.private_owner_kemerbet_readiness_cohort_gate', 'UPDATE'
     )
    or pg_catalog.has_function_privilege(
       'fetanagent_companion_device_bridge_runtime',
       'app.finalize_telegram_player_validation(uuid)', 'EXECUTE'
     ) then
    raise exception 'The signed Player selection boundary has drifted.';
  end if;
end;
$$;

alter table app.private_owner_kemerbet_readiness_cohort_gate
  add column player_validation_request_id uuid,
  drop constraint private_owner_kemerbet_readiness_pilot_mutation_context_check,
  add constraint private_owner_kemerbet_readiness_pilot_mutation_context_check check (
    (pilot_mutation_backend_pid is null
      and pilot_mutation_transaction_id is null
      and pilot_mutation_mode is null
      and player_validation_request_id is null)
    or (pilot_mutation_backend_pid is not null
      and pilot_mutation_transaction_id is not null
      and pilot_mutation_mode in (
        'prepare', 'arm', 'stop', 'routine_activate', 'routine_stop'
      )
      and player_validation_request_id is null)
    or (pilot_mutation_backend_pid is not null
      and pilot_mutation_transaction_id is not null
      and pilot_mutation_mode = 'signed_player_validation'
      and player_validation_request_id is not null)
  );

create or replace function app.serialize_private_owner_kemerbet_readiness_source_mutation()
returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  pilot_mutation_backend_pid integer;
  pilot_mutation_transaction_id pg_catalog.xid8;
  pilot_mutation text;
  player_validation_request_id uuid;
  reviewed_mutation boolean := false;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  select gate.pilot_mutation_backend_pid,
         gate.pilot_mutation_transaction_id,
         gate.pilot_mutation_mode,
         gate.player_validation_request_id
    into pilot_mutation_backend_pid,
         pilot_mutation_transaction_id,
         pilot_mutation,
         player_validation_request_id
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then
    raise exception 'The private KemerBet readiness serialization gate is unavailable.';
  end if;

  if exists (
    select 1 from app.private_owner_kemerbet_readiness_cohort_claims claim
    where claim.claim_state in ('prepared', 'exported', 'imported')
  ) then
    reviewed_mutation :=
      (
        session_user = 'fetanagent_player_actions_runtime'
        and pg_catalog.pg_has_role(session_user, 'fetanagent_player_actions', 'member')
        and tg_table_schema = 'app'
        and tg_when = 'BEFORE'
        and tg_level = 'STATEMENT'
        and tg_op = 'INSERT'
        and (
          (tg_table_name = 'customers'
            and tg_name = 'customers_serialize_kemerbet_readiness')
          or (tg_table_name = 'player_registration_requests'
            and tg_name = 'player_registration_requests_serialize_kemerbet_readiness')
        )
      )
      or (
        (session_user = 'postgres'
          or (session_user = 'fetanagent_companion_device_bridge_runtime'
            and pg_catalog.pg_has_role(
              session_user, 'fetanagent_companion_device_bridge', 'member'
            )))
        and pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
        and pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
        and pilot_mutation = 'signed_player_validation'
        and player_validation_request_id is not null
        and exists (
          select 1
            from app.telegram_player_validation_requests request
            join app.telegram_player_validation_results result
              on result.validation_request_id = request.id
           where request.id = player_validation_request_id
             and request.status = 'validated'
             and result.outcome = 'found'
        )
        -- The legacy claim counts associated eligible Players. A signed Find
        -- may select one, but must not change any associated Player/decision.
        and not exists (
          select 1
            from app.telegram_player_validation_requests request
            join app.platforms platform on platform.code = 'kemerbet'
            join app.customer_platform_players player
              on player.platform_id = platform.id
             and player.player_id = request.player_id
            join app.player_registration_request_associations association
              on association.player_account_id = player.id
           where request.id = player_validation_request_id
        )
        and tg_table_schema = 'app'
        and tg_when = 'BEFORE'
        and tg_level = 'STATEMENT'
        and (
          (tg_table_name = 'customers'
            and tg_name = 'customers_serialize_kemerbet_readiness'
            and tg_op = 'INSERT')
          or (tg_table_name = 'customer_platform_players'
            and tg_name = 'customer_platform_players_serialize_kemerbet_readiness'
            and tg_op in ('INSERT', 'UPDATE'))
          or (tg_table_name = 'player_validation_attempts'
            and tg_name = 'player_validation_attempts_serialize_kemerbet_readiness'
            and tg_op = 'INSERT')
          or (tg_table_name = 'player_deposit_eligibility_decisions'
            and tg_name = 'eligibility_decisions_serialize_kemerbet_readiness'
            and tg_op = 'INSERT')
        )
      )
      or (
        pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member')
        and pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
        and pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
        and tg_table_schema = 'app'
        and tg_op <> 'TRUNCATE'
        and (
          (pilot_mutation = 'prepare'
            and tg_table_name = 'private_live_deposit_pilot_revisions'
            and tg_op in ('INSERT', 'UPDATE'))
          or (pilot_mutation in ('arm', 'stop')
            and tg_table_name in ('private_live_deposit_pilot_revisions', 'feature_switches')
            and tg_op = 'UPDATE')
          or (session_user = 'postgres'
            and pilot_mutation in ('routine_activate', 'routine_stop')
            and tg_table_name = 'feature_switches'
            and tg_op = 'UPDATE')
        )
      );
    if reviewed_mutation is not true then
      raise exception 'The fixed KemerBet readiness cohort is frozen.';
    end if;
  end if;
  return null;
end;
$$;

create or replace function app.accept_and_finalize_telegram_player_validation_result(
  p_http_replay_identity text, p_http_body_digest text, p_http_request_id text,
  p_result_replay_identity text, p_assignment_id text, p_assignment_body_digest text,
  p_result_id text, p_result_body_digest text, p_certificate_id text,
  p_device_id text, p_device_key_id text,
  p_request_issued_at timestamptz, p_request_expires_at timestamptz,
  p_assessed_at timestamptz, p_signed_assignment jsonb, p_signed_result jsonb
)
returns table (accepted boolean, replayed boolean, finalization_state text)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_accept record;
  v_result app.telegram_player_validation_results%rowtype;
  v_request_status text;
  v_finalization_state text;
  v_context_count integer;
begin
  perform app.require_agent_platform_companion_bridge_session();
  select * into v_accept
    from app.accept_telegram_player_validation_result(
      p_http_replay_identity, p_http_body_digest, p_http_request_id,
      p_result_replay_identity, p_assignment_id, p_assignment_body_digest,
      p_result_id, p_result_body_digest, p_certificate_id,
      p_device_id, p_device_key_id,
      p_request_issued_at, p_request_expires_at, p_assessed_at,
      p_signed_assignment, p_signed_result
    );
  if v_accept.accepted is distinct from true then return; end if;
  select result.* into v_result
    from app.telegram_player_validation_results result
   where result.result_id = p_result_id
     and result.assignment_id = p_assignment_id::uuid
     and result.result_replay_identity = p_result_replay_identity
   for share;
  if v_result.result_id is null then
    raise exception 'Accepted Player validation evidence is unavailable.';
  end if;

  if v_result.outcome = 'found' then
    -- An associated Player outside the frozen five cannot become a sixth
    -- eligible associated Player under this old readiness claim. Hold it for
    -- review instead of letting the trigger reject and endlessly retry.
    if exists (
      select 1 from app.private_owner_kemerbet_readiness_cohort_claims claim
       where claim.claim_state in ('prepared', 'exported', 'imported')
    ) and exists (
      select 1
        from app.telegram_player_validation_requests request
        join app.platforms platform on platform.code = 'kemerbet'
        join app.customer_platform_players player
          on player.platform_id = platform.id
         and player.player_id = request.player_id
        join app.player_registration_request_associations association
          on association.player_account_id = player.id
       where request.id = v_result.validation_request_id
         and not exists (
           select 1
             from app.private_owner_kemerbet_readiness_cohort_claims claim
             join app.private_owner_kemerbet_readiness_cohort_members member
               on member.claim_id = claim.id
            where claim.claim_state in ('prepared', 'exported', 'imported')
              and member.player_account_id = player.id
         )
    ) then
      update app.telegram_player_validation_requests request
         set status = 'review_required'
       where request.id = v_result.validation_request_id
         and request.status in ('validated', 'review_required');
      get diagnostics v_context_count = row_count;
      if v_context_count <> 1 then
        raise exception 'Associated Player review could not be recorded.';
      end if;
      finalization_state := 'review_required';
      accepted := true;
      replayed := v_accept.replayed;
      return next;
      return;
    end if;
    -- This singleton row serializes protected source DML. A caller cannot set
    -- this marker directly; the SECURITY DEFINER wrapper binds it to the exact
    -- accepted Find, backend and transaction, then clears it before returning.
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
           pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
           pilot_mutation_mode = 'signed_player_validation',
           player_validation_request_id = v_result.validation_request_id
     where gate.singleton
       and gate.pilot_mutation_backend_pid is null
       and gate.pilot_mutation_transaction_id is null
       and gate.pilot_mutation_mode is null
       and gate.player_validation_request_id is null;
    get diagnostics v_context_count = row_count;
    if v_context_count <> 1 then
      raise exception 'The signed Player selection context is unavailable.';
    end if;
    select selected.finalization_state into v_finalization_state
      from app.finalize_telegram_player_validation(v_result.validation_request_id) selected;
    if v_finalization_state not in ('selected', 'already_selected', 'review_required')
       or v_finalization_state is null then
      raise exception 'Accepted Player Find could not be finalized.';
    end if;
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null,
           player_validation_request_id = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'signed_player_validation'
       and gate.player_validation_request_id = v_result.validation_request_id;
    get diagnostics v_context_count = row_count;
    if v_context_count <> 1 then
      raise exception 'The signed Player selection context did not close.';
    end if;
    finalization_state := v_finalization_state;
  else
    select request.status into v_request_status
      from app.telegram_player_validation_requests request
     where request.id = v_result.validation_request_id;
    if v_request_status <> 'review_required' then
      raise exception 'Inconclusive Player Find was not held for review.';
    end if;
    finalization_state := 'review_required';
  end if;
  accepted := true;
  replayed := v_accept.replayed;
  return next;
end;
$$;

comment on function app.serialize_private_owner_kemerbet_readiness_source_mutation() is
  'Keeps the legacy exact-five associated-Player readiness claim frozen. The atomic signed Find wrapper alone may open a backend-and-transaction-bound context for new Telegram Player selection DML on four named tables; direct writes, financial switches and cohort-member mutation remain blocked.';
comment on function app.accept_and_finalize_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) is
  'Atomically accepts one signed read-only Find and selects the Player through a short-lived legacy-readiness exception; never initiates a payment.';

commit;
