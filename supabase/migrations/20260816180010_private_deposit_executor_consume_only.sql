-- Restrict the production deposit executor to consume-only authority.
--
-- The enqueue primitive remains owner-internal so the SECURITY DEFINER verified-payment
-- settlement boundary can atomically create the payment claim and one execution command. No
-- runtime role may bypass that boundary by creating an execution command directly.

begin;

revoke execute on function app.enqueue_verified_deposit_execution(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

comment on function app.enqueue_verified_deposit_execution(uuid) is
  'Owner-internal enqueue primitive invoked only by the atomic verified-payment settlement boundary; no runtime role may create an execution command directly.';

comment on role fetanagent_deposit_executor is
  'FetanAgent consume-only deposit executor group. NOLOGIN; may lease and transition settlement-created execution work but cannot enqueue it.';

comment on role fetanagent_deposit_executor_runtime is
  'FetanAgent consume-only deposit executor runtime scaffold. NOLOGIN and unprovisioned; inherits only lease and execution-transition commands.';

commit;
