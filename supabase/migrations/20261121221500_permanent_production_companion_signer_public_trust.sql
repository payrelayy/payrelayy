-- Independently provision the public half of the permanent production Companion
-- signer. The private key is held only in the protected GitHub production secret.
-- This insert grants no financial authority and does not select the live signer.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $provision$
declare
  v_id uuid := '276ef32b-695f-4c66-b708-d9d6497bc6a1';
  v_key_id text := 'companion-server-production-v2';
  v_spki text := 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPa_e_dg-r5QUph_eMHa5pztycRFL81rsu-2y_PLoXzMpHFNTJgkC9QiXNBew-FJDfx5049o6nu70NkUidvkJ2A';
  v_digest text := 'sha256:cc80c7074a0de01f94459b9d2cd71f010854aee50f6d9de2564ee7ae41f5169d';
  v_from timestamptz := '2026-11-21T22:02:11Z';
  v_until timestamptz := '9999-12-31T00:00:00Z';
begin
  if current_user <> 'postgres' or session_user <> 'postgres'
    or app.agent_platform_companion_public_key_digest(v_spki) <> v_digest
    or v_from > pg_catalog.clock_timestamp()
    or v_until <> '9999-12-31 00:00:00+00'::timestamptz
    or exists (
      select 1 from app.agent_platform_companion_server_signers
       where id = v_id or signer_key_id = v_key_id
          or public_key_spki = v_spki or public_key_spki_sha256 = v_digest
    )
  then
    raise exception 'Permanent Companion signer public trust preflight failed.';
  end if;

  insert into app.agent_platform_companion_server_signers (
    id, signer_key_id, public_key_spki, public_key_spki_sha256,
    signature_algorithm, signature_encoding, valid_from, valid_until
  ) values (
    v_id, v_key_id, v_spki, v_digest,
    'ecdsa-p256-sha256', 'ieee-p1363-base64url', v_from, v_until
  );
end;
$provision$;

commit;
