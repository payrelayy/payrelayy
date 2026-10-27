-- The previous Owner runtime requires its exact function surface until the
-- compatible binary is deployed.
revoke execute on function app.list_owner_submitted_payments_sensitive(
  uuid,text,integer,integer) from fetanagent_owner_control;
revoke execute on function app.list_owner_receiver_sms_inbox_sensitive(
  uuid,text,text,text,date,date,integer,integer) from fetanagent_owner_control;
revoke execute on function app.list_owner_provider_deposit_controls_sensitive(uuid)
  from fetanagent_owner_control;
revoke execute on function app.list_owner_receiver_accounts_sensitive(uuid)
  from fetanagent_owner_control;
