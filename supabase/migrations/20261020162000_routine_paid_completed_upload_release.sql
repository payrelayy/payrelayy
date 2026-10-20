-- A signed phone upload no longer occupies its sealed lane after its exact
-- challenge has a durable server result. A retry after an uncertain HTTP
-- acknowledgement may only be retired when the database confirms that result.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create or replace function app.classify_routine_telebirr_paid_upload_terminal(
  p_challenge_id uuid, p_challenge_digest text, p_device_public_key_spki_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not app.routine_telebirr_paid_poll_session_allowed()
    or p_challenge_id is null
    or p_challenge_digest is null
    or p_challenge_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_device_public_key_spki_sha256 is null
    or p_device_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501',
      message = 'The routine paid upload terminal check is unavailable.';
  end if;

  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
   where challenge.challenge_id = p_challenge_id;
  -- Never discard a sealed upload on an unknown or mismatched challenge.
  if not found then return false; end if;
  if v_challenge.issuance_mode is distinct from 'paid'
    or v_challenge.challenge_digest is distinct from p_challenge_digest
    or v_challenge.device_public_key_spki_sha256 is distinct from
      p_device_public_key_spki_sha256 then
    return false;
  end if;

  -- Each row below is immutable and proves the server already holds the
  -- result or has made a final customer decision. A phone transport failure,
  -- gate change, or unsigned assertion alone cannot free a lane.
  if exists (select 1 from app.routine_telebirr_paid_observation_staging staged
      where staged.challenge_id = p_challenge_id)
    or exists (select 1 from app.routine_telebirr_old_payment_observations old_payment
      where old_payment.challenge_id = p_challenge_id)
    or exists (select 1 from app.routine_telebirr_paid_terminal_rejections rejected
      where rejected.challenge_id = p_challenge_id)
    or exists (select 1 from app.routine_telebirr_fast_results result
      where result.candidate_id = v_challenge.candidate_id
        and result.outcome_code in ('invalid_reference', 'wrong_receiver',
          'already_used', 'unrelated_receipt', 'held_review')) then
    return true;
  end if;

  -- Preserve the existing hard expiry for work without a durable result.
  return v_now >= v_challenge.expires_at + interval '15 minutes'
    or v_now >= v_challenge.candidate_submitted_at + interval '1 hour';
end;
$$;
alter function app.classify_routine_telebirr_paid_upload_terminal(uuid,text,text)
  owner to postgres;
revoke all on function app.classify_routine_telebirr_paid_upload_terminal(uuid,text,text)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_routine_telebirr_paid_poll, fetanagent_routine_telebirr_paid_poll_runtime;
grant execute on function app.classify_routine_telebirr_paid_upload_terminal(uuid,text,text)
  to fetanagent_routine_telebirr_paid_poll;

commit;
