-- An exported no-money, exact-five readiness claim predates public Telegram
-- onboarding. Keep that claim frozen, while admitting only the two new-row
-- writes made by the isolated Player-actions SECURITY DEFINER procedures.
-- This migration does not change a claim, a financial switch, or a deposit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare
  source_routine pg_catalog.pg_proc%rowtype;
begin
  select * into source_routine
    from pg_catalog.pg_proc
   where oid = 'app.serialize_private_owner_kemerbet_readiness_source_mutation()'::pg_catalog.regprocedure;
  if not found
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source_routine.prosrc, 'UTF8')), 'hex')
      <> '2a6a6be464db30d96c4946469599a4273bae66cbce9e5e6b2ac018fa35935c22'
    or source_routine.proowner <> 'postgres'::pg_catalog.regrole
    or source_routine.prosecdef is not true
    or source_routine.proconfig <> array['search_path=pg_catalog']::text[]
    or pg_catalog.has_table_privilege(
      'fetanagent_player_actions_runtime', 'app.customers', 'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'fetanagent_player_actions_runtime', 'app.player_registration_requests', 'INSERT'
    ) then
    raise exception 'The reviewed Telegram onboarding/readiness boundary has drifted.';
  end if;
end;
$$;

create or replace function app.serialize_private_owner_kemerbet_readiness_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot_mutation_backend_pid integer;
  pilot_mutation_transaction_id pg_catalog.xid8;
  pilot_mutation text;
  reviewed_mutation boolean := false;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  select gate.pilot_mutation_backend_pid,
         gate.pilot_mutation_transaction_id,
         gate.pilot_mutation_mode
    into pilot_mutation_backend_pid,
         pilot_mutation_transaction_id,
         pilot_mutation
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

comment on function app.serialize_private_owner_kemerbet_readiness_source_mutation() is
  'Serializes the legacy exact-five readiness source. With an active claim, only the exact Player-actions runtime may insert minimal new Telegram customers and unassociated Player ID requests through existing SECURITY DEFINER procedures; existing-row edits, direct table writes, all other source tables and all financial gates remain frozen.';

commit;
