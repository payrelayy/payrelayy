-- Allow a new, independently provisioned production Companion signer to issue
-- revocable identities without a calendar shutdown. The current v1 signer and
-- all historical trust records remain immutable.
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
        when signer.signer_key_id = 'companion-server-production-v2'
          and signer.valid_until = '9999-12-31 00:00:00+00'::timestamptz
          then signer.valid_until
        else least(p_assessed_at + interval '90 days', signer.valid_until)
      end$replacement$;
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

end;
$permanent_companion$;

commit;
