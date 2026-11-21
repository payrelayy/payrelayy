-- Keep the production Companion identity revocable without a calendar shutdown.
-- Short-lived signed requests, Owner policy, and one-use financial fences stay unchanged.
-- Existing certificates and broker activations retain their original deadlines;
-- a separately reviewed pairing and activation are required for the new identity.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $permanent_companion$
declare
  v_target regprocedure := pg_catalog.to_regprocedure(
    'app.claim_agent_platform_companion_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)'
  );
  v_definition text;
  v_old text := 'least(p_assessed_at + interval ''90 days'', signer.valid_until)';
  v_new text := $replacement$case
        when signer.signer_key_id = 'companion-server-production-v1'
          and signer.valid_until = '9999-12-31 00:00:00+00'::timestamptz
          then signer.valid_until
        else least(p_assessed_at + interval '90 days', signer.valid_until)
      end$replacement$;
  v_signer app.agent_platform_companion_server_signers%rowtype;
begin
  if v_target is null then
    raise exception 'Companion pairing issuer is missing; migration stopped.';
  end if;
  select pg_catalog.pg_get_functiondef(v_target) into v_definition;
  if pg_catalog.strpos(v_definition, v_old) = 0
    or pg_catalog.strpos(
      pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
      v_old
    ) <> 0
    or pg_catalog.strpos(v_definition, '''paymentAllowed'', false') = 0
    or pg_catalog.strpos(v_definition, '''moneyMovementAllowed'', false') = 0
  then
    raise exception 'Companion pairing issuer changed; migration stopped.';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);

  select signer.* into v_signer
  from app.agent_platform_companion_server_signers signer
  where signer.signer_key_id = 'companion-server-production-v1'
  for update;
  if v_signer.id is not null then
    if v_signer.valid_from > pg_catalog.clock_timestamp()
      or v_signer.valid_until <= pg_catalog.clock_timestamp() + interval '30 days'
      or exists (
        select 1 from app.agent_platform_companion_server_signer_revocations revocation
        where revocation.server_signer_id = v_signer.id
      )
      or not exists (
        select 1
        from app.routine_telebirr_runtime_events activation
        join app.agent_platform_companion_enrollment_certificates certificate
          on certificate.certificate_id = activation.certificate_id
        where activation.event_sequence = (
            select pg_catalog.max(latest.event_sequence)
            from app.routine_telebirr_runtime_events latest
          )
          and activation.event_kind = 'activate'
          and activation.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
          and activation.valid_until = certificate.valid_until
          and certificate.server_signer_id = v_signer.id
      )
    then
      raise exception 'Production Companion signer state changed; migration stopped.';
    end if;
    update app.agent_platform_companion_server_signers signer
      set valid_until = '9999-12-31 00:00:00+00'::timestamptz
      where signer.id = v_signer.id;
  end if;
end;
$permanent_companion$;

commit;
