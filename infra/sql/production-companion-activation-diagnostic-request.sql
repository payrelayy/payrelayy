-- Read only the existing untouched job's historical request; never prepare or consume.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH bounded_target AS (
  SELECT o.pilot_revision_id
  FROM app.deposit_jobs j
  JOIN app.deposit_intents i ON i.id = j.deposit_intent_id
  JOIN app.private_live_telebirr_verification_outcomes o ON o.id = i.private_live_telebirr_outcome_id
  WHERE j.job_kind::text = 'execute_deposit' AND j.status::text = 'queued'
    AND j.attempt_count = 0 AND j.lease_token IS NULL
    AND j.leased_by IS NULL AND j.lease_expires_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM app.deposit_execution_owner_approvals a WHERE a.execution_job_id = j.id
    )
), stored_request AS (
  SELECT r.request_key, r.companion_release_sha
  FROM app.agent_platform_companion_execution_activation_requests r
  JOIN bounded_target t ON t.pilot_revision_id = r.pilot_revision_id
  ORDER BY r.requested_at DESC LIMIT 1
)
SELECT pg_catalog.json_build_object(
  'requestKey', r.request_key, 'companionReleaseSha', r.companion_release_sha
)::text AS existing_request
FROM stored_request r
WHERE (SELECT count(*) FROM bounded_target) = 1
  AND (SELECT count(*) FROM app.deposit_jobs
    WHERE job_kind::text = 'execute_deposit' AND status::text = 'queued') = 1
  AND (SELECT control_state FROM app.agent_platform_companion_execution_control
    WHERE singleton) = 'disabled'
  AND (SELECT count(*) FROM app.feature_switches
    WHERE feature_key::text IN (
      'deposit_execution', 'payment_verification', 'withdrawal_collection',
      'withdrawal_validation', 'private_live_deposit_pilot',
      'cbe_birr_authoritative_verification', 'telebirr_authoritative_verification'
    ) AND mode::text = 'disabled') = 7
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname LIKE 'fetanagent%executor%' AND rolcanlogin)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
    WHERE usename LIKE 'fetanagent%executor%')
  AND session_user = 'postgres' AND current_user = 'postgres'
  AND current_setting('transaction_read_only') = 'on'
  AND NOT pg_catalog.pg_is_in_recovery()
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl
    WHERE pid = pg_catalog.pg_backend_pid() AND ssl);
ROLLBACK;
