-- Login remains disabled until the separate, guarded production activation.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create role fetanagent_receiver_sms_ingest_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
grant fetanagent_receiver_sms_ingest to fetanagent_receiver_sms_ingest_runtime
  with inherit true, set false, admin false;

revoke all on schema app from fetanagent_receiver_sms_ingest_runtime;
revoke all privileges on all tables in schema app
  from fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime;

commit;
