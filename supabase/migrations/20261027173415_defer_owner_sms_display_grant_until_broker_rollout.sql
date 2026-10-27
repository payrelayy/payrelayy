-- The owner display schema reached production before the compatible SMS broker.
-- Keep the existing broker's exact function surface while rolling out its image.
revoke execute on function app.record_receiver_sms_payment_event_with_display(
  text,text,text,bigint,timestamptz,timestamptz,timestamptz,
  text,text,text,text,text,integer,text,text)
  from fetanagent_receiver_sms_ingest;
