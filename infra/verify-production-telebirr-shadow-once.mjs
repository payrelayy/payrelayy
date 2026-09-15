import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/production-telebirr-shadow-once.yml', import.meta.url),
  'utf8',
);
const provision = readFileSync(
  new URL('./sql/production-telebirr-shadow-verifier-once-provision.sql', import.meta.url),
  'utf8',
);
const disable = readFileSync(
  new URL('./sql/production-telebirr-shadow-verifier-once-disable.sql', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /PRODUCTION_DROPLET_ID: '593344964'/u);
assert.match(workflow, /PRODUCTION_DATABASE_POOLER_HOST: aws-0-eu-west-1\.pooler\.supabase\.com/u);
assert.match(workflow, /PRODUCTION_DATABASE_ADMIN_POOLER_PORT: '6543'/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /admin_login_ready=false/u);
assert.match(workflow, /current_user = 'postgres' and session_user = current_user/u);
assert.match(workflow, /"\$admin_login_ready" == 'true'/u);
assert.match(workflow, /export PGSSLROOTCERT="\$protected\/supabase-ca\.crt"/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /--target telebirr-shadow-verifier/u);
assert.match(workflow, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(workflow, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false/u);
assert.match(workflow, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/u);
assert.match(workflow, /TELEBIRR_SHADOW_VERIFIER_DEPLOYMENT_TARGET=production/u);
assert.match(workflow, /--network host/u);
assert.match(workflow, /printf 'postgresql:\/\/%s\.%s:%s@%s:5432\/postgres\?sslmode=verify-full'/u);
assert.match(workflow, /--read-only/u);
assert.match(workflow, /--cap-drop ALL/u);
assert.match(workflow, /--security-opt no-new-privileges:true/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /production-telebirr-shadow-verifier-once-provision\.sql/u);
assert.match(workflow, /production-telebirr-shadow-verifier-once-disable\.sql/u);
assert.match(workflow, /enrollment\.pilot_revision_id = '\$TARGET_PILOT_REVISION_ID'::uuid/u);
assert.match(workflow, /enrollments\.length !== 1/u);
assert.match(workflow, /pin\.keyId === enrolled\.keyId/u);
assert.match(workflow, /fingerprint === enrolled\.publicKeySpkiSha256/u);
assert.match(workflow, /\.sourceLiveAttempts == 0/u);
assert.match(workflow, /\.sourceLiveOutcomes == 0/u);
assert.match(workflow, /\.sourceReservations == 0/u);
assert.match(workflow, /\.liveMoneySwitchCount == 0/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true/u);
assert.doesNotMatch(workflow, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=true/u);
assert.doesNotMatch(workflow, /--publish|-p [0-9]/u);
assert.doesNotMatch(workflow, /PRODUCTION_DATABASE_DIRECT_HOST|PGHOSTADDR|ssh .*?-L/u);

assert.match(provision, /PRODUCTION_PROJECT_REF/u);
assert.match(provision, /xzztugbgtulptnbpoelr/u);
assert.match(provision, /TARGET_PILOT_REVISION_ID/u);
assert.match(provision, /SOURCE_LIVE_VERIFICATION_JOB_ID/u);
assert.match(provision, /RECOVERY_REQUEST_KEY/u);
assert.match(provision, /source_live_verification_job_id = job\.id/u);
assert.match(provision, /proof\.submitted_at \+ interval '24 hours'/u);
assert.match(provision, /private_live_telebirr_verification_attempts/u);
assert.match(provision, /private_live_telebirr_verification_outcomes/u);
assert.match(provision, /feature_key <> 'private_live_deposit_pilot'/u);
assert.match(provision, /and mode = 'disabled'/u);
assert.match(provision, /mode = 'dry_run'/u);
assert.match(provision, /for share of feature_switch/u);
assert.doesNotMatch(provision, /for share of enrollment/u);
assert.match(provision, /active_target_enrollment/u);
assert.match(provision, /device_enrollment_id = enrollment\.id/u);
assert.match(provision, /count\(\*\) from active_target_enrollment\) = 1/u);
assert.match(
  provision,
  /recover_expired_private_live_telebirr_payment_to_shadow\(uuid,uuid,uuid,uuid,text\)/u,
);
assert.match(provision, /login noinherit nocreatedb nocreaterole noreplication nobypassrls/u);
assert.match(provision, /connection limit 1 password :'shadow_runtime_password'/u);
assert.match(provision, /interval '20 minutes'/u);
assert.match(provision, /bounded_20_minutes/u);
assert.doesNotMatch(provision, /deploymentTarget', 'staging'/u);
assert.doesNotMatch(provision, /update app\.feature_switches/u);
assert.doesNotMatch(provision, /insert into app\./u);

assert.match(disable, /PRODUCTION_PROJECT_REF/u);
assert.match(disable, /xzztugbgtulptnbpoelr/u);
assert.match(disable, /fetanagent:production:telebirr-shadow-verifier-runtime/u);
assert.match(disable, /nologin noinherit nocreatedb nocreaterole noreplication nobypassrls/u);
assert.match(disable, /connection limit 1 password null valid until 'infinity'/u);
assert.match(disable, /pg_catalog\.pg_terminate_backend/u);
assert.match(disable, /deploymentTarget', 'production'/u);
assert.match(disable, /'financialSwitchesChanged', false/u);
assert.doesNotMatch(disable, /update app\.feature_switches/u);
