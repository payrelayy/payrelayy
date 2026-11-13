-- Preserve the distinction between an Owner's later manual credit and a
-- Companion credit confirmed from KemerBet History. This only changes the
-- Owner SMS inbox status; it does not initiate a money action or send a notice.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $patch$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'app.list_owner_receiver_sms_inbox_filtered(uuid,text,text,text,date,date,integer,integer)'::pg_catalog.regprocedure
  );
  v_old := $old$when intent.status = 'executed'
          or app.owner_history_approved_credit(intent.id) then 'auto_credited'$old$;
  v_new := $new$when app.owner_history_approved_credit(intent.id)
          and exists (
            select 1 from app.audit_events credit_audit
            where credit_audit.resource_type = 'deposit_intent'
              and credit_audit.resource_id = intent.id
              and credit_audit.action = 'deposit.owner_confirmed_kemerbet_history_approved'
              and credit_audit.metadata ->> 'manual_credit_attested_by_owner' = 'true'
          ) then 'manually_credited'
        when intent.status = 'executed'
          or app.owner_history_approved_credit(intent.id) then 'auto_credited'$new$;
  if v_definition is null or
     (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,''))) <> pg_catalog.length(v_old) then
    raise exception 'Owner SMS History credit classification changed unexpectedly.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end;
$patch$;

commit;
