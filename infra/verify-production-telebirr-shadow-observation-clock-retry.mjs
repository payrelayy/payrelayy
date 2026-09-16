import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../.github/workflows/production-telebirr-shadow-observation-clock-retry.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL('./sql/production-telebirr-shadow-observation-clock-retry.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260916223500_retry_telebirr_shadow_after_observation_clock_fix.sql',
    import.meta.url,
  ),
  'utf8',
);
const provision = readFileSync(
  new URL('./sql/production-telebirr-shadow-verifier-once-provision.sql', import.meta.url),
  'utf8',
);
const verifierWorkflow = readFileSync(
  new URL('../.github/workflows/production-telebirr-shadow-once.yml', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /PRODUCTION_DROPLET_ID: '593344964'/u);
assert.match(workflow, /RETRY OBSERVATION-CLOCK PRODUCTION TELEBIRR SHADOW - NO MONEY/u);
assert.match(workflow, /REVIEWED_MAIN_COMMIT_SHA:/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /export PGSSLROOTCERT="\$protected\/supabase-ca\.crt"/u);
assert.match(workflow, /production-telebirr-shadow-observation-clock-retry\.sql/u);
assert.match(workflow, /\.financialBoundary == "dry_run"/u);
assert.match(workflow, /\.moneyMoved == false/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /update app\.feature_switches/u);

assert.match(operation, /begin transaction isolation level read committed/u);
assert.match(operation, /current_user = 'postgres' and session_user = 'postgres'/u);
assert.match(operation, /retry_private_telebirr_shadow_after_observation_clock_fix\(/u);
assert.match(operation, /observation_clock_mismatch_retry_no_credit/u);
assert.match(operation, /private_telebirr_shadow_observation_clock_retry_is_valid\(/u);
assert.match(operation, /outcome\.reason_code = 'parser_uncertain'/u);
assert.match(operation, /outcome\.protocol_reason_code = 'receipt_semantics_incomplete'/u);
assert.match(operation, /outcome\.retrieved_at < outcome\.observed_at/u);
assert.match(operation, /interval '1 second'/u);
assert.match(operation, /not outcome\.would_verify/u);
assert.match(operation, /mode = 'disabled'/u);
assert.match(operation, /mode = 'dry_run'/u);
assert.match(operation, /'moneyMoved', false/u);
assert.doesNotMatch(operation, /update app\.feature_switches/u);
assert.doesNotMatch(operation, /delete from app\./u);

assert.match(migration, /add column observation_clock_retry_source_id uuid/u);
assert.match(migration, /create table app\.private_telebirr_shadow_observation_clock_retries/u);
assert.match(migration, /source_shadow_proof_request_id uuid not null unique/u);
assert.match(migration, /replacement_shadow_proof_request_id uuid not null unique/u);
assert.match(
  migration,
  /create function app\.retry_private_telebirr_shadow_after_observation_clock_fix/u,
);
assert.match(migration, /source_outcome\.reason_code is distinct from 'parser_uncertain'/u);
assert.match(
  migration,
  /source_outcome\.protocol_reason_code is distinct from 'receipt_semantics_incomplete'/u,
);
assert.match(migration, /mismatch_us not between 1 and 1000000/u);
assert.match(migration, /\(staged\.signed_observation #>> '\{body,observedAt\}'\)::timestamptz/u);
assert.match(migration, /source_proof\.submitted_at \+ interval '12 hours'/u);
assert.match(migration, /app\.require_private_telebirr_shadow_mode_ready/u);
assert.match(migration, /session_user <> 'postgres'/u);
assert.match(migration, /force row level security/u);
assert.match(migration, /revoke all on table/u);
assert.match(migration, /expected_source_sha256 constant text/u);
assert.doesNotMatch(migration, /grant .*fetanagent_/u);
assert.doesNotMatch(migration, /update app\.feature_switches/u);
assert.doesNotMatch(migration, /insert into app\.deposit_payment_claims/u);
assert.doesNotMatch(migration, /insert into app\.deposit_jobs/u);

assert.equal(
  (provision.match(/private_telebirr_shadow_observation_clock_retry_is_valid/g) ?? []).length,
  7,
);
assert.equal(
  (provision.match(/private_telebirr_shadow_observation_clock_retries retry/g) ?? []).length,
  2,
);
assert.match(provision, /staged\.staged_at >= retry\.authorized_at/u);
assert.match(
  provision,
  /app\.private_telebirr_shadow_observation_clock_retry_is_valid\(uuid,uuid\)/u,
);
assert.match(verifierWorkflow, /private_telebirr_shadow_observation_clock_retry_is_valid/u);
