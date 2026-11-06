begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
grant execute on function app.record_receiver_sms_device_status_with_queue(
  text,text,text,timestamptz,text,text,integer)
  to fetanagent_receiver_sms_ingest;
commit;
