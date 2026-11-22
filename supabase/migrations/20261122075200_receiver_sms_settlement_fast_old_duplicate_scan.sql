-- Keep the one-use settlement path intact while avoiding duplicate-state
-- lookups for every historical candidate on each live poll. A later
-- submission with the same provider/reference cannot have duplicate state
-- 'none': both current and legacy first identities are non-null.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '15s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004));

do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure);
  v_old text := $old$  select candidate.id into v_candidate_id
    from app.receiver_sms_deposit_candidates candidate
    where candidate.submitted_at >= v_cutover_at
      and candidate.submitted_at < pg_catalog.clock_timestamp() - interval '60 minutes'
      and not exists (select 1 from app.receiver_sms_payment_matches matched
        where matched.candidate_id = candidate.id)
      and app.receiver_sms_duplicate_state(candidate.id) = 'none'
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
      and not exists (select 1 from app.owner_manual_payment_cases owner_case
        where owner_case.payment_provider_id = candidate.payment_provider_id
          and owner_case.reference_fingerprint = candidate.reference_fingerprint)
    order by candidate.submitted_at, candidate.id
    for update of candidate skip locked
    limit 1;$old$;
  v_new text := $new$  with first_old_unmatched as materialized (
    select candidate.id, candidate.submitted_at
      from app.receiver_sms_deposit_candidates candidate
      where candidate.submitted_at >= v_cutover_at
        and candidate.submitted_at < pg_catalog.clock_timestamp() - interval '60 minutes'
        and not exists (select 1 from app.receiver_sms_payment_matches matched
          where matched.candidate_id = candidate.id)
        and not exists (select 1 from app.receiver_sms_settlement_holds held
          where held.candidate_id = candidate.id)
        and not exists (select 1 from app.owner_manual_payment_cases owner_case
          where owner_case.payment_provider_id = candidate.payment_provider_id
            and owner_case.reference_fingerprint = candidate.reference_fingerprint)
        and not exists (select 1 from app.receiver_sms_deposit_candidates prior
          where prior.provider_code = candidate.provider_code
            and prior.reference_fingerprint = candidate.reference_fingerprint
            and (prior.submitted_at, prior.id) < (candidate.submitted_at, candidate.id))
  )
  select candidate.id into v_candidate_id
    from first_old_unmatched older
    join app.receiver_sms_deposit_candidates candidate on candidate.id = older.id
    where app.receiver_sms_duplicate_state(candidate.id) = 'none'
    order by older.submitted_at, candidate.id
    for update of candidate skip locked
    limit 1;$new$;
  v_hits integer;
begin
  if v_definition is null then
    raise exception 'Receiver SMS settlement function is unavailable.';
  end if;
  v_hits := (pg_catalog.length(v_definition) -
    pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);
  if v_hits <> 1 then
    raise exception 'Expected one receiver SMS old-submission query, found %.', v_hits;
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$patch$;

comment on function app.settle_next_receiver_sms_match() is
  'Queue one safe receiver-SMS match or hold a first unmatched submission after 60 minutes; skip later duplicate references before costly duplicate checks.';
commit;
