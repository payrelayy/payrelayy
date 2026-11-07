-- A failed database preflight has not moved money. Retry it briefly, retain a
-- safe diagnostic, and make a final hold visible and manually resolvable.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table app.receiver_sms_settlement_retries (
  candidate_id uuid primary key references app.receiver_sms_deposit_candidates(id)
    on delete restrict,
  attempt_count integer not null check (attempt_count between 1 and 3),
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  next_attempt_at timestamptz not null,
  last_sqlstate text not null check (last_sqlstate ~ '^[A-Z0-9]{5}$'),
  last_category text not null check (last_category in (
    'concurrency', 'database_constraint', 'sms_eligibility',
    'snapshot_guard', 'verified_settlement', 'routine_admission',
    'queue_guard', 'other')),
  last_constraint_name text check (last_constraint_name is null or
    last_constraint_name ~ '^[a-z_][a-z0-9_]{0,79}$'),
  last_message_hash text not null check (last_message_hash ~ '^[0-9a-f]{32}$')
);
alter table app.receiver_sms_settlement_retries owner to postgres;
alter table app.receiver_sms_settlement_retries enable row level security;
alter table app.receiver_sms_settlement_retries force row level security;
revoke all on app.receiver_sms_settlement_retries
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_settlement,
    fetanagent_receiver_sms_settlement_runtime,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

do $settlement_patch$
declare
  v_target pg_catalog.regprocedure :=
    'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure;
  v_definition text;
  v_old text;
  v_new text;
  v_acl pg_catalog.aclitem[];
begin
  select pg_catalog.pg_get_functiondef(p.oid), p.proacl
    into v_definition, v_acl from pg_catalog.pg_proc p where p.oid = v_target;
  if (select p.proowner = 'postgres'::pg_catalog.regrole
      and p.prosecdef
      and p.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
      and pg_catalog.md5(p.prosrc) = '2acdfc09e4c199cbc10d43afcfe59aaf'
      from pg_catalog.pg_proc p where p.oid = v_target) is not true then
    raise exception 'Receiver SMS settlement changed before retry repair.';
  end if;

  v_old := '  v_result record;';
  v_new := $new$  v_result record;
  v_error_sqlstate text;
  v_error_message text;
  v_error_constraint text;
  v_error_category text;
  v_attempt_count integer;$new$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition,v_old,''))) / pg_catalog.length(v_old) <> 1 then
    raise exception 'Receiver SMS retry declaration changed.';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $old$      and not exists (select 1 from app.receiver_sms_settlement_lineages lineage
        where lineage.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
      and not exists (select 1 from app.owner_manual_payment_cases owner_case$old$;
  v_new := $new$      and not exists (select 1 from app.receiver_sms_settlement_lineages lineage
        where lineage.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_retries retry
        where retry.candidate_id = candidate.id
          and retry.next_attempt_at > pg_catalog.clock_timestamp())
      and not exists (select 1 from app.owner_manual_payment_cases owner_case$new$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition,v_old,''))) / pg_catalog.length(v_old) <> 1 then
    raise exception 'Receiver SMS retry selection changed.';
  end if;
  v_definition := pg_catalog.replace(v_definition,v_old,v_new);

  v_old := $old$  exception when others then
    insert into app.receiver_sms_settlement_holds (candidate_id, reason_code)
      values (v_candidate_id, 'settlement_preflight_failed')
      on conflict (candidate_id) do nothing;
    return 'held_review';
  end;$old$;
  v_new := $new$  exception when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate,
      v_error_message = message_text,
      v_error_constraint = constraint_name;
    v_error_category := case
      when v_error_sqlstate in ('40001','40P01','55P03') then 'concurrency'
      when v_error_sqlstate like '23%' then 'database_constraint'
      when v_error_message = 'The receiver SMS match is not eligible for automatic settlement.'
        then 'sms_eligibility'
      when v_error_message = 'The receiver SMS deposit snapshot is unavailable.'
        then 'snapshot_guard'
      when v_error_message = 'The verified deposit is not eligible for routine admission.'
        then 'routine_admission'
      when v_error_message like 'The verified deposit %' then 'verified_settlement'
      when v_error_message = 'The receiver SMS job was not queued.'
        or v_error_message = 'The receiver SMS job admission is incomplete.'
        then 'queue_guard'
      else 'other' end;
    insert into app.receiver_sms_settlement_retries as retry (
      candidate_id, attempt_count, first_failed_at, last_failed_at,
      next_attempt_at, last_sqlstate, last_category,
      last_constraint_name, last_message_hash
    ) values (
      v_candidate_id, 1, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp() + interval '10 seconds', v_error_sqlstate,
      v_error_category,
      case when v_error_constraint ~ '^[a-z_][a-z0-9_]{0,79}$'
        then v_error_constraint else null end,
      pg_catalog.md5(v_error_message)
    ) on conflict (candidate_id) do update set
      attempt_count = least(3,retry.attempt_count + 1),
      last_failed_at = pg_catalog.clock_timestamp(),
      next_attempt_at = pg_catalog.clock_timestamp() + interval '10 seconds',
      last_sqlstate = excluded.last_sqlstate,
      last_category = excluded.last_category,
      last_constraint_name = excluded.last_constraint_name,
      last_message_hash = excluded.last_message_hash
    returning attempt_count into v_attempt_count;
    if v_attempt_count >= 3 then
      insert into app.receiver_sms_settlement_holds (candidate_id, reason_code)
        values (v_candidate_id, 'settlement_preflight_failed')
        on conflict (candidate_id) do nothing;
      return 'held_review';
    end if;
    return 'empty';
  end;$new$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition,v_old,''))) / pg_catalog.length(v_old) <> 1 then
    raise exception 'Receiver SMS retry exception handler changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
  if (select p.proowner = 'postgres'::pg_catalog.regrole
      and p.prosecdef and p.proacl is not distinct from v_acl
      and p.prosrc like '%app.receiver_sms_settlement_retries%'
      from pg_catalog.pg_proc p where p.oid = v_target) is not true then
    raise exception 'Receiver SMS retry postcondition failed.';
  end if;
end;
$settlement_patch$;

-- A final preflight hold proves that no job was created: the failed function's
-- entire inner transaction rolled back before the hold was inserted.
do $owner_patch$
declare
  v_target pg_catalog.regprocedure;
  v_definition text;
  v_acl pg_catalog.aclitem[];
  v_old text;
  v_new text;
  v_row record;
begin
  v_target := 'app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)'::pg_catalog.regprocedure;
  select pg_catalog.pg_get_functiondef(p.oid), p.proacl into v_definition,v_acl
    from pg_catalog.pg_proc p where p.oid=v_target;
  if (select pg_catalog.md5(p.prosrc) = '3836987e5595c574a1c6d1643eb2b00d'
      and p.prosecdef and p.proowner = 'postgres'::pg_catalog.regrole
      from pg_catalog.pg_proc p where p.oid=v_target) is not true then
    raise exception 'Owner manual completion changed before held-payment repair.';
  end if;
  v_old := $old$not exists (select 1 from app.receiver_sms_settlement_lineages lineage
        join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
        where lineage.candidate_id = v_candidate.id
          and intent.status in ('rejected','cancelled'))$old$;
  v_new := $new$not (
        exists (select 1 from app.receiver_sms_settlement_lineages lineage
          join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
          where lineage.candidate_id = v_candidate.id
            and intent.status in ('rejected','cancelled'))
        or (exists (select 1 from app.receiver_sms_settlement_holds held
              where held.candidate_id = v_candidate.id
                and held.reason_code = 'settlement_preflight_failed')
          and not exists (select 1 from app.receiver_sms_intent_openings opening
            where opening.candidate_id = v_candidate.id)
          and not exists (select 1 from app.receiver_sms_settlement_lineages lineage
            where lineage.candidate_id = v_candidate.id)
          and not exists (select 1 from app.provider_payment_evidence evidence
            where evidence.payment_provider_id = v_candidate.payment_provider_id
              and evidence.canonical_reference_fingerprint = v_candidate.reference_fingerprint))
      )$new$;
  if (pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition,v_old,''))) / pg_catalog.length(v_old) <> 1 then
    raise exception 'Owner held-payment guard changed.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
  if (select p.proacl is not distinct from v_acl and p.prosecdef
      from pg_catalog.pg_proc p where p.oid=v_target) is not true then
    raise exception 'Owner manual completion privileges changed.';
  end if;

  for v_row in select * from (values
      ('app.list_owner_receiver_sms_inbox(uuid,integer,integer)',
        '0bf42da46970d2707f1d9deda1a7fffe'),
      ('app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)',
        '1928501331bc4f6a0379c92eb264db7f')
    ) as target(signature, expected_hash)
  loop
    v_target := v_row.signature::pg_catalog.regprocedure;
    select pg_catalog.pg_get_functiondef(p.oid),p.proacl into v_definition,v_acl
      from pg_catalog.pg_proc p where p.oid=v_target;
    if (select pg_catalog.md5(p.prosrc) = v_row.expected_hash
        and p.prosecdef and p.proowner = 'postgres'::pg_catalog.regrole
        from pg_catalog.pg_proc p where p.oid=v_target) is not true then
      raise exception 'Owner SMS inbox changed before held-payment repair: %',v_row.signature;
    end if;
    v_old := $old$when candidate.id is not null then 'submission_waiting'$old$;
    v_new := $new$when candidate.id is not null and exists (
          select 1 from app.receiver_sms_settlement_holds held
          where held.candidate_id = candidate.id
            and held.reason_code = 'settlement_preflight_failed')
          then 'pending_review'
        when candidate.id is not null then 'submission_waiting'$new$;
    if (pg_catalog.length(v_definition) - pg_catalog.length(
        pg_catalog.replace(v_definition,v_old,''))) / pg_catalog.length(v_old) <> 1 then
      raise exception 'Owner SMS status projection changed: %',v_row.signature;
    end if;
    v_definition := pg_catalog.replace(v_definition,v_old,v_new);
    v_old := $old$or (candidate.id is not null$old$;
    v_new := $new$or (candidate.id is not null and evidence.id is null
        and exists (select 1 from app.receiver_sms_settlement_holds held
          where held.candidate_id = candidate.id
            and held.reason_code = 'settlement_preflight_failed')
        and not exists (select 1 from app.receiver_sms_intent_openings opening
          where opening.candidate_id = candidate.id)
        and not exists (select 1 from app.receiver_sms_settlement_lineages lineage_check
          where lineage_check.candidate_id = candidate.id))
      or (candidate.id is not null$new$;
    if (pg_catalog.length(v_definition) - pg_catalog.length(
        pg_catalog.replace(v_definition,v_old,''))) / pg_catalog.length(v_old) <> 1 then
      raise exception 'Owner SMS manual-credit guard changed: %',v_row.signature;
    end if;
    execute pg_catalog.replace(v_definition,v_old,v_new);
    if (select p.proacl is not distinct from v_acl and p.prosecdef
        from pg_catalog.pg_proc p where p.oid=v_target) is not true then
      raise exception 'Owner SMS inbox privileges changed: %',v_row.signature;
    end if;
  end loop;
end;
$owner_patch$;

comment on table app.receiver_sms_settlement_retries is
  'Private sanitized diagnostics and bounded retry state for failed pre-transfer SMS settlement.';
comment on function app.settle_next_receiver_sms_match() is
  'Retries a rolled-back SMS preflight twice before a final Owner review hold; no transfer is retried.';
commit;
