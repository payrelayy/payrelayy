import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/production-telebirr-shadow-policy-recovery.yml'),
  'utf8',
);
const operationSql = readFileSync(
  resolve(root, 'infra/sql/production-telebirr-shadow-policy-recovery.sql'),
  'utf8',
);
const migration = readFileSync(
  resolve(
    root,
    'supabase/migrations/20260916182000_recover_quarantined_telebirr_shadow_after_policy_fix.sql',
  ),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
assert.match(workflow, /"\$CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /RECOVER QUARANTINED TELEBIRR SHADOW AFTER POLICY FIX - NO MONEY/u);
assert.match(workflow, /node infra\/operations\/require-production-ci\.mjs/u);
assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /--file=infra\/sql\/production-telebirr-shadow-policy-recovery\.sql/u);
assert.match(workflow, /\.quarantinePreserved == true/u);
assert.match(workflow, /\.financialActionsEnabled == false/u);
assert.match(workflow, /\.kemerBetCreditEnabled == false/u);

assert.match(operationSql, /^begin;/mu);
assert.match(operationSql, /app\.retry_quarantined_private_telebirr_shadow_after_policy_fix\(/u);
assert.match(operationSql, /\\gset recovery_/u);
assert.match(operationSql, /as policy_recovery_postcondition_ok\s+\\gset/u);
assert.match(operationSql, /\\if :policy_recovery_postcondition_ok/u);
assert.match(operationSql, /select 1 \/ 0 as rejected;/u);
assert.match(operationSql, /'quarantinePreserved', true/u);
assert.match(operationSql, /'financialActionsEnabled', false/u);
assert.match(operationSql, /'kemerBetCreditEnabled', false/u);
assert.match(operationSql, /commit;\s*$/u);
assert.doesNotMatch(operationSql, /do \$[^$]+\$[\s\S]*?:'/iu);

assert.match(migration, /app\.private_telebirr_shadow_policy_recoveries/u);
assert.match(migration, /app\.private_telebirr_shadow_policy_recovery_digest\(/u);
assert.match(migration, /app\.retry_quarantined_private_telebirr_shadow_after_policy_fix\(/u);
assert.match(migration, /verifier_policy_fix_retry_no_credit/u);
assert.match(migration, /trusted_evidence_invalid/u);
assert.match(migration, /set expires_at = retry_until/u);
assert.doesNotMatch(migration, /update app\.feature_switches/iu);
assert.doesNotMatch(
  migration,
  /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
);

console.log(
  'Production TeleBirr shadow policy recovery verified: exact protected input, immutable quarantine lineage, psql-safe postconditions, and no money authority',
);
