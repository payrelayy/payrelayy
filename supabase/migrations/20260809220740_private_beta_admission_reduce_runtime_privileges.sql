-- PayReplayy Stage 15D: reduce the invite-only beta-admission capability surface.
--
-- This forward-only privilege reduction deliberately leaves the admitted-inbox recorder defined
-- but unreachable from the beta group and its future runtime scaffold. It creates no LOGIN role,
-- credential, connection, route, bot polling, scheduler, payment, or other activation path.

begin;

revoke all on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) from payreplayy_beta_admission, payreplayy_beta_admission_runtime;

comment on role payreplayy_beta_admission is
  'PayReplayy beta-admission group. NOLOGIN; only invite redemption and beta-admission nonce reservation are assigned. The admitted-inbox recorder remains intentionally ungranted.';

comment on function app.record_admitted_telegram_private_inbound_event(
  bigint, bigint, bigint, text, text
) is
  'Reserved admitted-inbox recorder. It remains defined for later review but is intentionally ungranted to the beta-admission group and runtime scaffold.';

commit;
