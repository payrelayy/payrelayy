import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-live-telebirr-source-binding-shadow-recovery.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL('./sql/production-live-telebirr-source-binding-shadow-recovery.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260919205000_recover_reviewed_source_binding_to_shadow.sql',
    import.meta.url,
  ),
  'utf8',
);
const correctiveMigration = readFileSync(
  new URL(
    '../supabase/migrations/20260920003000_fix_reviewed_source_binding_shadow_consumption.sql',
    import.meta.url,
  ),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR SHADOW REQUEST - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /PGSERVICEFILE: \/dev\/null/u);
assert.match(workflow, /PGPASSFILE: \/dev\/null/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /identifiersRedacted == true/u);
assert.match(workflow, /disabledFinancialSwitches == 6/u);
assert.match(workflow, /dryRunPilotSwitches == 1/u);
assert.match(workflow, /activeTelebirrEpochs == 0/u);
assert.match(workflow, /executorLoginRoles == 0/u);
assert.match(workflow, /executorSessions == 0/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /::set-output/u);

assert.match(operation, /begin isolation level read committed/u);
assert.match(operation, /recover_reviewed_private_live_telebirr_source_binding_to_shadow/u);
assert.match(operation, /configured_window_seconds = 43200/u);
assert.match(operation, /remaining_seconds between 42601 and 43205/u);
assert.match(operation, /private_live_telebirr_source_binding_shadow_recovery_is_valid/u);
assert.match(operation, /verification_queued/u);
assert.match(operation, /private_live_deposit_pilot_reservations/u);
assert.match(operation, /private_live_telebirr_settlement_receipts/u);
assert.match(operation, /app\.deposit_jobs/u);
assert.match(operation, /role\.rolcanlogin/u);
assert.match(operation, /current_private_trusted_telebirr_activation_epoch/u);
assert.match(operation, /'identifiersRedacted', true/u);

assert.match(migration, /reviewed_source_binding_source_unavailable_recovery_no_credit/u);
assert.match(migration, /private_live_tbirr_binding_shadow_recoveries_immutable/u);
assert.match(migration, /private_live_tbirr_binding_shadow_recoveries_no_truncate/u);
assert.match(migration, /private_live_telebirr_source_recovery_legacy_is_valid/u);
assert.match(migration, /private_live_telebirr_source_recovery_is_valid/u);
assert.match(
  correctiveMigration,
  /private_live_telebirr_source_binding_nonsettlement_consumption_is_valid/u,
);
assert.match(
  correctiveMigration,
  /consumption\.verification_outcome_id = p_verification_outcome_id/u,
);
assert.match(correctiveMigration, /not consumption\.settlement_created/u);
assert.match(correctiveMigration, /consumption\.pilot_reservation_id is null/u);
assert.match(correctiveMigration, /consumption\.settlement_receipt_id is null/u);
assert.match(correctiveMigration, /consumption\.execution_job_id is null/u);
assert.match(correctiveMigration, /consumption\.consumed_at >= outcome\.created_at/u);
assert.match(correctiveMigration, /consumption\.consumed_at <= p_closed_at/u);
assert.match(correctiveMigration, /marker_count <> 2/u);
assert.match(correctiveMigration, /marker_count <> 3/u);
assert.match(correctiveMigration, /financial authority/u);
for (const source of [migration, correctiveMigration]) {
  assert.doesNotMatch(
    source,
    /insert into app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
  );
}

console.log('Production reviewed source-binding shadow recovery contract verified.');
