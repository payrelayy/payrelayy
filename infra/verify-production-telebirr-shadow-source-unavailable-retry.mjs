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
