-- PayReplayy Stage 9: complete the private inbound-consumption foreign-key coverage.

begin;

create index inbound_event_consumptions_customer_identity_id_idx
  on app.inbound_event_consumptions (customer_identity_id);

commit;
