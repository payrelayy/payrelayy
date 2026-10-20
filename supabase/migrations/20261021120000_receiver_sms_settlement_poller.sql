-- Private, one-at-a-time settlement. A failed transaction is rolled back and
-- held for Owner review, so neither the phone nor the customer can retry credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.receiver_sms_settlement_holds (
  candidate_id uuid primary key
    references app.receiver_sms_deposit_candidates (id) on delete restrict,
  reason_code text not null check (reason_code in
    ('settlement_preflight_failed', 'no_receiver_sms_after_5m')),
  held_at timestamptz not null default pg_catalog.clock_timestamp()
);
create trigger receiver_sms_settlement_holds_immutable
before update or delete on app.receiver_sms_settlement_holds
for each row execute function app.reject_provider_payment_evidence_mutation();
alter table app.receiver_sms_settlement_holds enable row level security;
alter table app.receiver_sms_settlement_holds force row level security;
alter table app.receiver_sms_settlement_holds owner to postgres;
revoke all on app.receiver_sms_settlement_holds
  from public, anon, authenticated, service_role;

create function app.settle_next_receiver_sms_match()
returns text language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_candidate_id uuid;
  v_result record;
begin
  if session_user not in ('postgres', 'fetanagent_receiver_sms_settlement_runtime') then
    raise exception using errcode = '42501',
      message = 'Receiver SMS settlement is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  if not exists (select 1 from app.receiver_sms_route_control control
    where control.singleton and control.enabled) then
    return 'disabled';
  end if;
  -- A missing receiving-phone SMS is uncertain, never proof of an invalid payment.
  select candidate.id into v_candidate_id
    from app.receiver_sms_deposit_candidates candidate
    where candidate.submitted_at <= pg_catalog.clock_timestamp() - interval '5 minutes'
      and not exists (select 1 from app.receiver_sms_payment_matches matched
        where matched.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
    order by candidate.submitted_at, candidate.id
    for update of candidate skip locked
    limit 1;
  if v_candidate_id is not null then
    insert into app.receiver_sms_settlement_holds (candidate_id, reason_code)
      values (v_candidate_id, 'no_receiver_sms_after_5m');
    return 'held_review';
  end if;
  select candidate.id into v_candidate_id
    from app.receiver_sms_deposit_candidates candidate
    join app.receiver_sms_payment_matches matched
      on matched.candidate_id = candidate.id and matched.disposition = 'ready'
    where not exists (select 1 from app.receiver_sms_settlement_lineages lineage
      where lineage.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
    order by candidate.submitted_at, candidate.id
    for update of candidate skip locked
    limit 1;
  if v_candidate_id is null then return 'empty'; end if;
  begin
    select * into v_result from app.finalize_receiver_sms_match(v_candidate_id);
    if v_result.execution_job_id is null or v_result.already_finalized is not false then
      raise exception 'The receiver SMS job was not queued.';
    end if;
  exception when others then
    insert into app.receiver_sms_settlement_holds (candidate_id, reason_code)
      values (v_candidate_id, 'settlement_preflight_failed')
      on conflict (candidate_id) do nothing;
    return 'held_review';
  end;
  return 'queued';
end;
$$;
alter function app.settle_next_receiver_sms_match() owner to postgres;
revoke all on function app.settle_next_receiver_sms_match()
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;
grant execute on function app.settle_next_receiver_sms_match()
  to fetanagent_receiver_sms_settlement;
grant usage on schema app to fetanagent_receiver_sms_settlement;

comment on function app.settle_next_receiver_sms_match() is
  'Default-off route only: atomically queue one ready SMS match or hold a failed one without exposing payment data.';
commit;
