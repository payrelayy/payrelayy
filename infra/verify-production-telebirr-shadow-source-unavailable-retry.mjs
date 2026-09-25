import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-telebirr-shadow-source-unavailable-retry.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL('./sql/production-telebirr-shadow-source-unavailable-retry.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260916203000_retry_telebirr_shadow_after_source_unavailable.sql',
    import.meta.url,
  ),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /PRODUCTION_DROPLET_ID: '593344964'/u);
assert.match(workflow, /RETRY SOURCE-UNAVAILABLE PRODUCTION TELEBIRR SHADOW - NO MONEY/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /export PGSSLROOTCERT="\$protected\/supabase-ca\.crt"/u);
assert.match(workflow, /production-telebirr-shadow-source-unavailable-retry\.sql/u);
assert.match(workflow, /\.financialBoundary == "dry_run"/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /update app\.feature_switches/u);

assert.match(operation, /begin transaction isolation level read committed/u);
assert.match(operation, /current_user = 'postgres' and session_user = 'postgres'/u);
assert.match(operation, /retry_private_telebirr_shadow_after_source_unavailable\(/u);
assert.match(operation, /source_unavailable_review_retry_no_credit/u);
assert.match(operation, /private_telebirr_shadow_source_unavailable_retry_is_valid\(/u);
assert.match(operation, /outcome\.disposition = 'review_required'/u);
assert.match(operation, /outcome\.reason_code = 'source_unavailable'/u);
assert.match(operation, /not outcome\.would_verify/u);
assert.match(operation, /feature_switch\.mode/u);
assert.match(operation, /mode = 'disabled'/u);
assert.match(operation, /'moneyMoved', false/u);
assert.doesNotMatch(operation, /update app\.feature_switches/u);
assert.doesNotMatch(operation, /delete from app\./u);

assert.match(migration, /add column source_unavailable_retry_source_id uuid/u);
assert.match(migration, /drop constraint private_telebirr_shadow_provider_reference_key/u);
assert.match(
  migration,
  /create unique index private_tbirr_shadow_original_provider_reference_uidx/u,
);
assert.match(migration, /where source_unavailable_retry_source_id is null/u);
assert.match(migration, /create table app\.private_telebirr_shadow_source_unavailable_retries/u);
assert.match(migration, /source_shadow_proof_request_id uuid not null unique/u);
assert.match(migration, /replacement_shadow_proof_request_id uuid not null unique/u);
assert.match(
  migration,
  /create function app\.retry_private_telebirr_shadow_after_source_unavailable/u,
);
assert.match(migration, /source_outcome\.disposition is distinct from 'review_required'/u);
assert.match(migration, /source_outcome\.reason_code is distinct from 'source_unavailable'/u);
assert.match(migration, /source_outcome\.would_verify/u);
assert.match(migration, /source_outcome\.principal_amount_minor is not null/u);
assert.match(migration, /source_proof\.submitted_at \+ interval '12 hours'/u);
assert.match(migration, /app\.require_private_telebirr_shadow_mode_ready/u);
assert.match(migration, /session_user <> 'postgres'/u);
assert.match(migration, /force row level security/u);
assert.match(migration, /revoke all on table/u);
assert.doesNotMatch(migration, /grant .*fetanagent_/u);
assert.doesNotMatch(migration, /update app\.feature_switches/u);
assert.doesNotMatch(migration, /deposit_payment_claims/u);
assert.doesNotMatch(migration, /deposit_jobs/u);

// A direct, signed invoice-layout review may be retried once without changing
// the original source-unavailable lineage or granting any money authority.
const directBriefMigration = readFileSync(
  new URL(
    '../supabase/migrations/20260925155626_brief_receipt_direct_shadow_retry.sql',
    import.meta.url,
  ),
  'utf8',
);
const directBriefWorkflow = readFileSync(
  new URL('../.github/workflows/production-telebirr-direct-brief-retry.yml', import.meta.url),
  'utf8',
);
const directBriefOperation = readFileSync(
  new URL('./sql/production-telebirr-direct-brief-retry.sql', import.meta.url),
  'utf8',
);
const shadowWorkflow = readFileSync(
  new URL('../.github/workflows/production-telebirr-shadow-once.yml', import.meta.url),
  'utf8',
);
const shadowProvision = readFileSync(
  new URL('./sql/production-telebirr-shadow-verifier-once-provision.sql', import.meta.url),
  'utf8',
);

assert.match(
  directBriefMigration,
  /create function app\.private_telebirr_direct_brief_source_is_valid/u,
);
assert.match(directBriefMigration, /unknown_layout_invoice_number/u);
assert.match(directBriefMigration, /outcome\.observation_body_digest =/u);
assert.match(directBriefMigration, /private_telebirr_shadow_evidence_quarantine/u);
assert.match(directBriefMigration, /reviewed_direct_brief_receipt_retry_no_credit/u);
assert.match(directBriefMigration, /app\.private_live_deposit_pilot_sha256\(routine\.prosrc\)/u);
assert.match(directBriefMigration, /routine\.proacl is not distinct from original_acl/u);
assert.match(
  directBriefMigration,
  /revoke all on function app\.private_telebirr_direct_brief_source_is_valid/u,
);
assert.doesNotMatch(
  directBriefMigration,
  /update app\.private_telebirr_shadow_verification_outcomes/iu,
);
assert.doesNotMatch(directBriefMigration, /update app\.feature_switches/iu);
assert.doesNotMatch(directBriefMigration, /insert into app\.deposit_jobs/iu);

assert.match(directBriefWorkflow, /environment: production/u);
assert.match(directBriefWorkflow, /require-production-ci\.mjs/u);
assert.match(directBriefWorkflow, /RETRY ONE REVIEWED DIRECT BRIEF TELEBIRR RECEIPT - NO MONEY/u);
assert.match(directBriefWorkflow, /production-telebirr-direct-brief-retry\.sql/u);
assert.doesNotMatch(directBriefWorkflow, /confirm_source_shadow_proof_request_id/u);
assert.doesNotMatch(directBriefWorkflow, /confirm_pilot_revision_id/u);
assert.match(directBriefOperation, /app\.private_telebirr_direct_brief_source_is_valid/u);
assert.match(directBriefOperation, /0\.5\.11-evidence-only/u);
assert.match(directBriefOperation, /app\.retry_private_telebirr_shadow_after_source_unavailable/u);
assert.match(
  directBriefOperation,
  /app\.private_telebirr_shadow_source_unavailable_retry_is_valid/u,
);
assert.match(directBriefOperation, /'moneyMoved', false/u);
assert.doesNotMatch(directBriefOperation, /update app\.feature_switches/iu);
assert.doesNotMatch(directBriefOperation, /insert into app\.deposit_jobs/iu);
assert.match(shadowWorkflow, /reviewed_direct_brief_receipt_retry_no_credit/u);
assert.match(shadowWorkflow, /app\.private_telebirr_direct_brief_source_is_valid/u);
assert.equal(
  (shadowProvision.match(/app\.private_telebirr_direct_brief_source_is_valid\(/gu) ?? []).length,
  3,
);
