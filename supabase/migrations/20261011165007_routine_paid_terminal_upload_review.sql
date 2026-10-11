-- A private, read-only terminal check for a sealed paid-phone upload. It does
-- not inspect or mutate payment claims, jobs, balances, or candidate status.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.classify_routine_telebirr_paid_upload_terminal(
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
  -- A purged or unknown challenge cannot be authenticated by this check. The
  -- phone must retain its sealed record rather than infer a terminal outcome.
  if not found then return false; end if;
  if v_challenge.issuance_mode is distinct from 'paid'
    or v_challenge.challenge_digest is distinct from p_challenge_digest
    or v_challenge.device_public_key_spki_sha256 is distinct from
      p_device_public_key_spki_sha256 then
    return false;
  end if;

  -- These are the hard upper bounds enforced by the paid observation loader
  -- and stager. Gate-off, signer revocation, and transient failures do not
  -- count as terminal and therefore cannot free a phone lane.
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
