import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-telebirr-shadow-assessment-clock-status.yml',
    import.meta.url,
  ),
  'utf8',
);
const statusSql = readFileSync(
  new URL('./sql/production-telebirr-shadow-assessment-clock-status.sql', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /DIAGNOSE TELEBIRR ASSESSMENT RETRY DELIVERY - READ ONLY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /production-telebirr-shadow-assessment-clock-status\.sql/u);
assert.match(workflow, /\.minimumReviewWindowHours == 12/u);
assert.match(workflow, /\.inspectionOnly == true/u);
assert.match(workflow, /\.retry_history_valid == true/u);
assert.match(workflow, /deviceHeartbeatFresh: \.device_heartbeat_fresh/u);
assert.match(workflow, /deliveryState: \.delivery_state/u);
assert.match(workflow, /\.financialBoundary == "dry_run"/u);
assert.match(workflow, /\.kemerBetExecutionEnabled == false/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /production-telebirr-shadow-once-provision/u);
assert.doesNotMatch(workflow, /production-telebirr-shadow-assessment-clock-recovery\.sql/u);

assert.match(statusSql, /begin transaction isolation level repeatable read read only/u);
assert.match(statusSql, /current_user = 'postgres' and session_user = 'postgres'/u);
assert.match(statusSql, /private_telebirr_shadow_assessment_clock_retry_history_is_valid\(/u);
assert.doesNotMatch(statusSql, /private_telebirr_shadow_assessment_clock_retry_is_valid\(/u);
assert.doesNotMatch(statusSql, /current_private_trusted_telebirr_activation_epoch/u);
assert.doesNotMatch(statusSql, /\bfor\s+(?:no\s+key\s+update|update|key\s+share|share)\b/iu);
assert.match(statusSql, /private_live_telebirr_device_heartbeats/u);
assert.match(statusSql, /target_assignment_base_eligible/u);
assert.match(statusSql, /earlier_eligible_candidate_count/u);
assert.match(statusSql, /waiting_for_device_assignment/u);
assert.match(statusSql, /evidence_staged_waiting_for_shadow_verifier/u);
assert.match(statusSql, /signed_assignment_delivered_waiting_for_device_evidence/u);
assert.match(statusSql, /would_verify_exact_25_etb_match/u);
assert.match(statusSql, /outcome_reason_class/u);
assert.match(statusSql, /outcome\.principal_amount_minor = 2500/u);
assert.match(statusSql, /outcome\.protocol_reason_code = 'signed_evidence_verified'/u);
assert.match(statusSql, /'minimumReviewWindowHours', 12/u);
assert.match(statusSql, /'inspectionOnly', true/u);
assert.match(statusSql, /'financialBoundary', 'dry_run'/u);
assert.match(statusSql, /'kemerBetExecutionEnabled', false/u);
assert.match(statusSql, /'moneyMoved', false/u);
assert.match(statusSql, /rollback;/u);
assert.doesNotMatch(statusSql, /^\s*(?:insert|update|delete|truncate|alter|create|drop)\s/imu);
assert.doesNotMatch(statusSql, /set\s+role/iu);
assert.doesNotMatch(statusSql, /pg_catalog\.set_config/iu);
assert.doesNotMatch(
  statusSql,
  /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
);

console.log('Production TeleBirr assessment-retry delivery status guard verified.');
