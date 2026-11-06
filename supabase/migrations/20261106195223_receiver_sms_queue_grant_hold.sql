begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';

-- Keep the old broker's exact four-function permission surface valid until it is replaced.
-- The new count-reporting grant is enabled only after the replacement broker is healthy.
revoke execute on function app.record_receiver_sms_device_status_with_queue(
  text,text,text,timestamptz,text,text,integer)
  from fetanagent_receiver_sms_ingest;

commit;
