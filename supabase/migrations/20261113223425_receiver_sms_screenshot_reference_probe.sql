-- A read-only, bounded OCR correction probe. It chooses no payment and creates no
-- candidate; the ordinary immutable submission still performs every eligibility check.
-- Keep EXECUTE ungranted until the replacement API with the exact catalog preflight
-- is running. Granting it before that deployment would fail the old API preflight.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.probe_receiver_sms_screenshot_reference(
  p_provider_code text, p_fingerprints text[]
)
returns smallint
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_control app.receiver_sms_route_control%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_match_count bigint;
  v_position integer;
begin
  if p_provider_code not in ('telebirr', 'cbe_birr')
    or p_fingerprints is null
    or pg_catalog.array_ndims(p_fingerprints) <> 1
    or pg_catalog.cardinality(p_fingerprints) not between 2 and 16
    or exists (
      select 1 from pg_catalog.unnest(p_fingerprints) fingerprint
      where fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$'
    )
    or exists (
      select 1 from pg_catalog.unnest(p_fingerprints) fingerprint
      group by fingerprint having pg_catalog.count(*) > 1
    ) then
    raise exception using errcode = '42501',
      message = 'Screenshot reference lookup is unavailable.';
  end if;

  select * into v_control from app.receiver_sms_route_control where singleton;
  if v_control.enabled is distinct from true then return null; end if;

  -- If the OCR reading already identifies any known SMS or prior submission,
  -- never redirect it to a nearby reference.
  if exists (
    select 1 from app.receiver_sms_payment_events sms
    where sms.provider_code = p_provider_code
      and sms.reference_fingerprint = p_fingerprints[1]
  ) or exists (
    select 1 from app.receiver_sms_deposit_candidates candidate
    where candidate.provider_code = p_provider_code
      and candidate.reference_fingerprint = p_fingerprints[1]
  ) then return null; end if;

  select pg_catalog.count(*),
    pg_catalog.min(pg_catalog.array_position(p_fingerprints, sms.reference_fingerprint))
  into v_match_count, v_position
  from app.receiver_sms_payment_events sms
  where sms.provider_code = p_provider_code
    and sms.reference_fingerprint = any(p_fingerprints[2:16])
    and sms.recorded_at >= v_control.cutover_at
    and sms.received_at >= v_control.cutover_at
    and sms.occurred_at between v_now - interval '1 hour' and v_now + interval '5 minutes'
    and sms.amount_minor between 2500 and 2500000
    and not exists (
      select 1 from app.receiver_sms_payment_conflicts conflict
      where conflict.existing_event_id = sms.id
    )
    and not exists (
      select 1 from app.receiver_sms_payment_matches matched
      where matched.payment_event_id = sms.id
    )
    and not exists (
      select 1 from app.receiver_sms_deposit_candidates candidate
      where candidate.provider_code = sms.provider_code
        and candidate.reference_fingerprint = sms.reference_fingerprint
    )
    and not exists (
      select 1 from app.owner_manual_payment_cases owner_case
      where owner_case.payment_provider_id = sms.payment_provider_id
        and owner_case.reference_fingerprint = sms.reference_fingerprint
    );

  if v_match_count = 1 then return (v_position - 1)::smallint; end if;
  return null;
end;
$$;

alter function app.probe_receiver_sms_screenshot_reference(text,text[]) owner to postgres;
revoke all on function app.probe_receiver_sms_screenshot_reference(text,text[])
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime;

comment on function app.probe_receiver_sms_screenshot_reference(text,text[]) is
  'Private read-only OCR variant probe; returns a correction index only for one recent unused signed SMS.';
commit;
