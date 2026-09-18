import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-telebirr-shadow-authority-deadline-status.yml',
    import.meta.url,
  ),
  'utf8',
);
const statusSql = readFileSync(
  new URL('./sql/production-telebirr-shadow-authority-deadline-status.sql', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /DIAGNOSE TELEBIRR SHADOW AUTHORITY RETRY - READ ONLY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /production-telebirr-shadow-authority-deadline-status\.sql/u);
assert.match(workflow, /\.minimumReviewWindowHours == 12/u);
assert.match(workflow, /\.inspectionOnly == true/u);
assert.match(workflow, /\.financialBoundary == "dry_run"/u);
assert.match(workflow, /\.kemerBetExecutionEnabled == false/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /production-telebirr-shadow-once-provision/u);
assert.doesNotMatch(workflow, /production-telebirr-shadow-authority-deadline-recovery\.sql/u);

assert.match(statusSql, /begin transaction isolation level repeatable read read only/u);
assert.match(statusSql, /current_user = 'postgres' and session_user = 'postgres'/u);
assert.match(statusSql, /load_next_private_telebirr_shadow_staged_evidence\(\)/u);
assert.match(statusSql, /private_telebirr_shadow_authority_deadline_retry_is_valid\(/u);
assert.match(statusSql, /proof\.submitted_at \+ interval '12 hours'/u);
assert.match(statusSql, /staged\.staged_at < staged\.attempt_expires_at/u);
assert.match(statusSql, /global_loader_returns_target/u);
assert.match(statusSql, /different_global_candidate_precedes_target/u);
assert.match(statusSql, /all_target_evidence_quarantined/u);
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

console.log('Production TeleBirr authority-retry loader status guard verified.');
