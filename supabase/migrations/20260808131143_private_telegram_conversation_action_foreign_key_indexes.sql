-- PayReplayy Stage 8: indexes for the private Telegram conversation-action foreign keys.
-- These cover parent lifecycle checks across all terminal and active rows. The Stage 7 tables
-- remain private and have no runtime table or procedure grants.

begin;

create index bot_action_capabilities_customer_identity_id_idx
  on app.bot_action_capabilities (customer_identity_id);

create index bot_action_capabilities_customer_id_idx
  on app.bot_action_capabilities (customer_id);

create index bot_action_capabilities_platform_id_idx
  on app.bot_action_capabilities (platform_id);

create index bot_conversation_actions_customer_identity_id_idx
  on app.bot_conversation_actions (customer_identity_id);

create index bot_conversation_actions_customer_id_idx
  on app.bot_conversation_actions (customer_id);

create index bot_conversation_actions_platform_id_idx
  on app.bot_conversation_actions (platform_id);

commit;
