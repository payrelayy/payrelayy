begin;

-- These constraint triggers are intentionally deferred so each Player-ID procedure can write its
-- receipt and projection in one transaction before correspondence is checked. Deferred triggers
-- execute after the SECURITY DEFINER procedure has returned, under the runtime caller's security
-- context. The runtime correctly has no direct table privileges, so the trigger functions must
-- retain the database-owner security context while checking the private tables.
--
-- Every function below is owned by postgres, has a fixed trusted search path, is reachable only
-- from a trigger on a forced-RLS private table, and receives no arguments from the runtime.

alter function app.require_inbound_event_consumption_causal_result()
  security definer
  set search_path = pg_catalog, app, pg_temp;

alter function app.require_inbound_event_consumption_final_version()
  security definer
  set search_path = pg_catalog, app, pg_temp;

alter function app.require_bot_action_capability_receipt_correspondence()
  security definer
  set search_path = pg_catalog, app, pg_temp;

alter function app.require_bot_action_capability_terminal_rejection_correspondence()
  security definer
  set search_path = pg_catalog, app, pg_temp;

alter function app.require_bot_conversation_action_final_projection()
  security definer
  set search_path = pg_catalog, app, pg_temp;

alter function app.require_bot_conversation_action_receipt_correspondence()
  security definer
  set search_path = pg_catalog, app, pg_temp;

alter function app.require_player_registration_request_event_receipt_correspondenc()
  security definer
  set search_path = pg_catalog, app, pg_temp;

revoke all on function app.require_inbound_event_consumption_causal_result()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.require_inbound_event_consumption_final_version()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.require_bot_action_capability_receipt_correspondence()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.require_bot_action_capability_terminal_rejection_correspondence()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.require_bot_conversation_action_final_projection()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.require_bot_conversation_action_receipt_correspondence()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

revoke all on function app.require_player_registration_request_event_receipt_correspondenc()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime,
       payreplayy_player_actions, payreplayy_player_actions_runtime;

comment on function app.require_inbound_event_consumption_causal_result() is
  'Deferred private Player-ID receipt correspondence check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

comment on function app.require_inbound_event_consumption_final_version() is
  'Deferred private Player-ID version correspondence check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

comment on function app.require_bot_action_capability_receipt_correspondence() is
  'Deferred private Player-ID capability correspondence check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

comment on function app.require_bot_action_capability_terminal_rejection_correspondence() is
  'Deferred private terminal-capability correspondence check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

comment on function app.require_bot_conversation_action_final_projection() is
  'Deferred private Player-ID action projection check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

comment on function app.require_bot_conversation_action_receipt_correspondence() is
  'Deferred private Player-ID action receipt check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

comment on function app.require_player_registration_request_event_receipt_correspondenc() is
  'Deferred private Player-ID request-event correspondence check. SECURITY DEFINER is required because it runs after the narrow runtime procedure returns.';

commit;
