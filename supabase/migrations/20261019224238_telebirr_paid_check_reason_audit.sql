-- Reason-only, append-only audit. This does not change admission, payment
-- classification, claims, execution, or notification timing.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Reserve copy for PR 2 without producing or changing an outcome in this PR.
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected',
    'not_credited', 'not_verified', 'already_used', 'wrong_receiver',
    'invalid_reference', 'manual_review', 'unrelated_receipt'
  ));

create table app.routine_telebirr_paid_check_audit_cutover (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null
);
insert into app.routine_telebirr_paid_check_audit_cutover (singleton, enabled_at)
values (true, pg_catalog.clock_timestamp());

create table app.routine_telebirr_paid_check_audit (
  id bigint generated always as identity primary key,
  candidate_id uuid not null,
  challenge_id uuid,
  source text not null check (source in (
    'check_review', 'signed_observation', 'terminal_result', 'customer_outcome'
  )),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  classification_code text not null check (
    classification_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  checked_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (source, evidence_digest),
  constraint routine_paid_check_audit_shape check (
    (source = 'customer_outcome' and challenge_id is null and reason_code is null)
    or (source <> 'customer_outcome' and challenge_id is not null and reason_code is not null)
  )
);
create index routine_paid_check_audit_candidate_idx
  on app.routine_telebirr_paid_check_audit (candidate_id, recorded_at, id);
create trigger routine_paid_check_audit_immutable
before update or delete on app.routine_telebirr_paid_check_audit
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
alter table app.routine_telebirr_paid_check_audit_cutover owner to postgres;
alter table app.routine_telebirr_paid_check_audit owner to postgres;
alter table app.routine_telebirr_paid_check_audit_cutover enable row level security;
alter table app.routine_telebirr_paid_check_audit_cutover force row level security;
alter table app.routine_telebirr_paid_check_audit enable row level security;
alter table app.routine_telebirr_paid_check_audit force row level security;
revoke all on table app.routine_telebirr_paid_check_audit_cutover,
                    app.routine_telebirr_paid_check_audit
  from public, anon, authenticated, service_role,
       fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
revoke all on sequence app.routine_telebirr_paid_check_audit_id_seq
  from public, anon, authenticated, service_role,
       fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;

-- The private broker calls this only after independently verifying the signed
-- assignment and the enrolled phone's signature. SQL rechecks the immutable
-- challenge/candidate binding. A review row cannot decide or move money.
create function app.record_routine_telebirr_paid_check_reason(
  p_challenge_id uuid, p_candidate_id uuid, p_reason_code text,
  p_checked_at timestamptz, p_report_digest text
) returns text language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing app.routine_telebirr_paid_check_audit%rowtype;
begin
  if not app.routine_telebirr_paid_poll_session_allowed()
    or p_challenge_id is null or p_candidate_id is null
    or p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_checked_at is null
    or p_report_digest is null or p_report_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501',
      message = 'The routine paid check reason is unavailable.';
  end if;
  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
   where challenge.challenge_id = p_challenge_id
     and challenge.candidate_id = p_candidate_id
     and challenge.issuance_mode = 'paid';
  if not found or p_checked_at < v_challenge.issued_at
    or p_checked_at > v_challenge.expires_at + interval '5 seconds'
    or p_checked_at > v_now + interval '5 seconds'
    or v_now >= v_challenge.expires_at + interval '15 minutes'
    or not exists (
      select 1 from app.routine_telebirr_untrusted_proof_requests candidate
      join app.routine_telebirr_paid_check_audit_cutover cutover on cutover.singleton
      where candidate.id = p_candidate_id and candidate.intake_mode = 'paid'
        and candidate.provider_code = 'telebirr'
        and candidate.submitted_at = v_challenge.candidate_submitted_at
        and candidate.submitted_at >= cutover.enabled_at
    ) then
    return 'conflict';
  end if;
  select audit.* into v_existing
    from app.routine_telebirr_paid_check_audit audit
   where audit.source = 'check_review' and audit.evidence_digest = p_report_digest;
  if found then
    return case when v_existing.candidate_id = p_candidate_id
      and v_existing.challenge_id = p_challenge_id
      and v_existing.reason_code = p_reason_code
      and v_existing.checked_at = p_checked_at
      then 'exact_replay' else 'conflict' end;
  end if;
  insert into app.routine_telebirr_paid_check_audit
    (candidate_id, challenge_id, source, reason_code, classification_code,
     evidence_digest, checked_at)
  values (p_candidate_id, p_challenge_id, 'check_review', p_reason_code,
          'review', p_report_digest, p_checked_at)
  on conflict (source, evidence_digest) do nothing;
  if not found then return 'exact_replay'; end if;
  return 'recorded';
end;
$$;
alter function app.record_routine_telebirr_paid_check_reason(uuid,uuid,text,timestamptz,text)
  owner to postgres;
revoke all on function app.record_routine_telebirr_paid_check_reason(uuid,uuid,text,timestamptz,text)
  from public, anon, authenticated, service_role,
       fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
grant execute on function app.record_routine_telebirr_paid_check_reason(uuid,uuid,text,timestamptz,text)
  to fetanagent_routine_telebirr_paid_poll;

create function app.audit_routine_telebirr_paid_staged_check()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if exists (
    select 1 from app.routine_telebirr_untrusted_proof_requests candidate
    join app.routine_telebirr_paid_check_audit_cutover cutover on cutover.singleton
    where candidate.id = new.candidate_id and candidate.submitted_at >= cutover.enabled_at
  ) then
    insert into app.routine_telebirr_paid_check_audit
      (candidate_id, challenge_id, source, reason_code, classification_code,
       evidence_digest, checked_at)
    values (new.candidate_id, new.challenge_id, 'signed_observation',
      'signed_receipt_observed', 'staged', new.observation_body_digest, new.observed_at)
    on conflict (source, evidence_digest) do nothing;
  end if;
  return new;
end;
$$;
alter function app.audit_routine_telebirr_paid_staged_check() owner to postgres;
revoke all on function app.audit_routine_telebirr_paid_staged_check()
  from public, anon, authenticated, service_role;
create trigger routine_paid_check_audit_staged
after insert on app.routine_telebirr_paid_observation_staging
for each row execute function app.audit_routine_telebirr_paid_staged_check();

create function app.audit_routine_telebirr_paid_terminal_check()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.submitted_at >= (select enabled_at
    from app.routine_telebirr_paid_check_audit_cutover where singleton) then
    insert into app.routine_telebirr_paid_check_audit
      (candidate_id, challenge_id, source, reason_code, classification_code,
       evidence_digest, checked_at)
    values (new.candidate_id, new.challenge_id, 'terminal_result',
      new.reason_code, 'terminal_rejected', new.observation_body_digest,
      new.observed_at)
    on conflict (source, evidence_digest) do nothing;
  end if;
  return new;
end;
$$;
alter function app.audit_routine_telebirr_paid_terminal_check() owner to postgres;
revoke all on function app.audit_routine_telebirr_paid_terminal_check()
  from public, anon, authenticated, service_role;
create trigger routine_paid_check_audit_terminal
after insert on app.routine_telebirr_paid_terminal_rejections
for each row execute function app.audit_routine_telebirr_paid_terminal_check();

create function app.audit_routine_telebirr_customer_outcome()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.outcome_code not in ('checking', 'verified_waiting') and exists (
    select 1 from app.routine_telebirr_untrusted_proof_requests candidate
    join app.routine_telebirr_paid_check_audit_cutover cutover on cutover.singleton
    where candidate.id = new.candidate_id and candidate.intake_mode = 'paid'
      and candidate.provider_code = 'telebirr'
      and candidate.submitted_at >= cutover.enabled_at
  ) then
    insert into app.routine_telebirr_paid_check_audit
      (candidate_id, source, classification_code, evidence_digest, checked_at)
    values (new.candidate_id, 'customer_outcome', new.outcome_code,
      'sha256:' || pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(new.id::text, 'UTF8')), 'hex'),
      new.created_at)
    on conflict (source, evidence_digest) do nothing;
  end if;
  return new;
end;
$$;
alter function app.audit_routine_telebirr_customer_outcome() owner to postgres;
revoke all on function app.audit_routine_telebirr_customer_outcome()
  from public, anon, authenticated, service_role;
create trigger routine_paid_check_audit_customer_outcome
after insert on app.telegram_deposit_outcome_deliveries
for each row execute function app.audit_routine_telebirr_customer_outcome();

comment on table app.routine_telebirr_paid_check_audit is
  'Redacted reason and final classification audit for post-cutover TeleBirr submissions; no receipt, raw reference, Player ID, receiver phone, or payment authority.';
commit;
