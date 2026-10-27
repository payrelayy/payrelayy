-- The compatible Owner and SMS broker accept these additional exact function
-- surfaces while their display feature remains disabled.
grant execute on function app.record_receiver_sms_payment_event_with_display(
  text,text,text,bigint,timestamptz,timestamptz,timestamptz,
  text,text,text,text,text,integer,text,text)
  to fetanagent_receiver_sms_ingest;
grant execute on function app.list_owner_submitted_payments_sensitive(
  uuid,text,integer,integer) to fetanagent_owner_control;
grant execute on function app.list_owner_receiver_sms_inbox_sensitive(
  uuid,text,text,text,date,date,integer,integer) to fetanagent_owner_control;
grant execute on function app.list_owner_provider_deposit_controls_sensitive(uuid)
  to fetanagent_owner_control;
grant execute on function app.list_owner_receiver_accounts_sensitive(uuid)
  to fetanagent_owner_control;
