-- A terminal credit or Owner decision already determines the displayed status.
-- Skip the expensive duplicate lookup for those rows while preserving the
-- duplicate classification for every other submission.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'app.list_owner_submitted_payments(uuid,text,integer,integer)'::pg_catalog.regprocedure);
  v_old text := 'app.receiver_sms_duplicate_state(candidate.id) as duplicate_state,';
  v_new text := $replacement$case
          when intent.status = 'executed'
            or (owner_case.candidate_id = candidate.id
              and owner_case.status in ('manually_credited','rejected'))
            then 'none'::text
          else app.receiver_sms_duplicate_state(candidate.id)
        end as duplicate_state,$replacement$;
begin
  if v_definition is null
    or (pg_catalog.length(v_definition) -
      pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
        <> pg_catalog.length(v_old)
    or pg_catalog.strpos(v_definition,
      'and duplicate_state <> ''none'' then ''rejected''') = 0 then
    raise exception 'Owner submitted-payment classification changed before optimization.';
  end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end;
$patch$;

commit;
