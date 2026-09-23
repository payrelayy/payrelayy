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
const reviewWindowMigration = readFileSync(
  new URL(
    '../supabase/migrations/20260916164000_extend_direct_telebirr_shadow_review_window.sql',
    import.meta.url,
  ),
  'utf8',
);
const singleOutcomeLoaderMigration = readFileSync(
  new URL(
    '../supabase/migrations/20260916190000_stop_shadow_loader_after_proof_outcome.sql',
    import.meta.url,
  ),
  'utf8',
);
const verifierConfig = readFileSync(
  new URL(
    '../apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-config.ts',
    import.meta.url,
  ),
  'utf8',
);
const productionTunnel = readFileSync(
  new URL('./operations/fetanagent-production-direct-database-tunnel.sh', import.meta.url),
  'utf8',
);

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /PRODUCTION_DROPLET_ID: '593344964'/u);
assert.match(workflow, /PRODUCTION_DATABASE_DIRECT_HOST: db\.xzztugbgtulptnbpoelr\.supabase\.co/u);
assert.match(workflow, /PRODUCTION_DATABASE_TUNNEL_PORT: '5432'/u);
assert.match(workflow, /confirm_shadow_proof_request_id:/u);
assert.match(workflow, /TARGET_SHADOW_PROOF_REQUEST_ID/u);
assert.match(workflow, /resolve-authority-deadline-child/u);
assert.match(workflow, /resolve-reviewed-source-binding/u);
assert.match(workflow, /not-applicable for direct\/child shadow intake/u);
assert.match(workflow, /including an authority-deadline child-proof retry/u);
assert.match(
  workflow,
  /CONFIRMED_PROOF" == 'resolve-authority-deadline-child'[\s\S]*?CONFIRMED_SOURCE_JOB" == 'not-applicable'[\s\S]*?CONFIRMED_REQUEST_KEY" =~ \$uuid_v4/u,
);
assert.match(
  workflow,
  /CONFIRMED_SOURCE_JOB" == 'not-applicable'[\s\S]*?CONFIRMED_REQUEST_KEY" =~ \$uuid_v4/u,
);
assert.match(
  workflow,
  /CONFIRMED_SOURCE_JOB" =~ \$uuid[\s\S]*?CONFIRMED_PROOF" =~ \$uuid_v4[\s\S]*?CONFIRMED_REQUEST_KEY" =~ \$uuid_v4/u,
);
assert.match(workflow, /proof\.id = '\$TARGET_SHADOW_PROOF_REQUEST_ID'::uuid/u);
assert.match(workflow, /proof\.source_live_verification_job_id is null/u);
assert.match(workflow, /private_telebirr_shadow_policy_recoveries recovery/u);
assert.match(workflow, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.match(workflow, /private_telebirr_shadow_authority_deadline_retry_is_valid/u);
assert.match(workflow, /private_live_telebirr_source_recovery_is_valid/u);
assert.match(workflow, /private_live_telebirr_source_binding_shadow_recoveries/u);
assert.match(workflow, /private_live_telebirr_source_binding_shadow_recovery_is_valid/u);
assert.match(workflow, /private_telebirr_shadow_source_binding_window_retries/u);
assert.match(workflow, /private_telebirr_shadow_source_binding_window_retry_is_valid/u);
assert.match(workflow, /private_telebirr_shadow_receipt_shape_diag_retries/u);
assert.match(workflow, /private_telebirr_shadow_receipt_shape_diag_retry_is_valid/u);
assert.match(workflow, /-5 as priority/u);
assert.match(workflow, /'not-applicable'::text as source_live_verification_job_id/u);
assert.match(workflow, /::add-mask::\$resolved_pilot/u);
assert.match(workflow, /::add-mask::\$resolved_proof/u);
assert.match(workflow, /::add-mask::\$resolved_source_job/u);
assert.match(workflow, /::add-mask::\$resolved_request/u);
assert.match(
  workflow,
  /recovery\.recovery_request_key =[\s\S]*?nullif\('\$RECOVERY_REQUEST_KEY', 'not-applicable'\)::uuid/u,
);
assert.match(workflow, /recovery\.retry_expires_at = proof\.expires_at/u);
assert.match(workflow, /verifier_policy_fix_retry_no_credit/u);
assert.match(workflow, /nullif\('\$SOURCE_LIVE_VERIFICATION_JOB_ID', 'not-applicable'\)::uuid/u);
assert.match(workflow, /PGHOSTADDR: 127\.0\.0\.1/u);
assert.match(workflow, /PGUSER: postgres\s/u);
assert.match(workflow, /admin_login_ready=false/u);
assert.match(workflow, /current_user = 'postgres' and session_user = current_user/u);
assert.match(workflow, /"\$admin_login_ready" == 'true'/u);
assert.match(workflow, /private_telebirr_shadow_authority_deadline_retries retry/u);
assert.match(
  workflow,
  /retry\.retry_request_key = '\$RECOVERY_REQUEST_KEY'::uuid[\s\S]*?retry\.pilot_revision_id = '\$TARGET_PILOT_REVISION_ID'::uuid/u,
);
assert.match(
  workflow,
  /retry\.retry_expires_at > pg_catalog\.clock_timestamp\(\) \+ interval '60 seconds'/u,
);
assert.match(workflow, /proof\.authority_deadline_retry_source_id =/u);
assert.match(workflow, /::add-mask::\$resolved_target_shadow_proof_request_id/u);
assert.match(workflow, /export TARGET_SHADOW_PROOF_REQUEST_ID/u);
assert.ok(
  workflow.indexOf('::add-mask::$resolved_target_shadow_proof_request_id') <
    workflow.indexOf('TARGET_SHADOW_PROOF_REQUEST_ID="$resolved_target_shadow_proof_request_id"'),
  'the internally resolved child proof must be masked before it is assigned for later commands',
);
assert.match(workflow, /export PGSSLROOTCERT="\$protected\/supabase-ca\.crt"/u);
assert.match(workflow, /fetanagent-production-direct-database-tunnel\.sh/u);
assert.match(workflow, /fetanagent_open_production_direct_database_tunnel/u);
assert.match(workflow, /fetanagent_close_production_direct_database_tunnel/u);
assert.match(workflow, /PRODUCTION_VM_SSH_PRIVATE_KEY/u);
assert.match(workflow, /PRODUCTION_VM_KNOWN_HOSTS/u);
assert.match(workflow, /--add-host "\$PRODUCTION_DATABASE_DIRECT_HOST:127\.0\.0\.1"/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /--target telebirr-shadow-verifier/u);
assert.match(workflow, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(workflow, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false/u);
assert.match(workflow, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/u);
assert.match(workflow, /TELEBIRR_SHADOW_VERIFIER_DEPLOYMENT_TARGET=production/u);
assert.match(workflow, /--network host/u);
assert.match(workflow, /verifier_ready=false/u);
assert.match(workflow, /for launch_attempt in 1 2 3 4 5 6/u);
assert.match(workflow, /docker rm --force "\$container"/u);
assert.match(workflow, /"\$verifier_ready" == 'true'/u);
assert.match(workflow, /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full'/u);
assert.match(workflow, /--read-only/u);
assert.match(workflow, /--cap-drop ALL/u);
assert.match(workflow, /--security-opt no-new-privileges:true/u);
assert.match(workflow, /trap cleanup EXIT/u);
assert.match(workflow, /sudo chown 10001:10001 "\$protected\/database-url"/u);
assert.match(
  workflow,
  /sudo chown root:root "\$protected\/pins\.json" "\$protected\/supabase-ca\.crt"/u,
);
assert.match(workflow, /chmod 0444 "\$protected\/pins\.json" "\$protected\/supabase-ca\.crt"/u);
assert.ok(
  workflow.indexOf('chmod 0444 "$protected/pins.json" "$protected/supabase-ca.crt"') <
    workflow.indexOf('sudo chown root:root "$protected/pins.json" "$protected/supabase-ca.crt"'),
  'the runner must set public config modes before transferring ownership to root',
);
assert.doesNotMatch(workflow, /sudo chown 10001:10001[^\n]*(?:pins\.json|supabase-ca\.crt)/u);
assert.match(workflow, /production-telebirr-shadow-verifier-once-provision\.sql/u);
assert.match(workflow, /production-telebirr-shadow-verifier-once-disable\.sql/u);
assert.match(workflow, /enrollment\.pilot_revision_id = '\$TARGET_PILOT_REVISION_ID'::uuid/u);
assert.match(workflow, /enrollments\.length !== 1/u);
assert.match(workflow, /pin\.keyId === enrolled\.keyId/u);
assert.match(workflow, /fingerprint === enrolled\.publicKeySpkiSha256/u);
assert.match(
  workflow,
  /\(\.sourceLiveAttempts == 0 and \.sourceLiveOutcomes == 0\) or[\s\S]*?\.sourceLiveAttempts == 1 or \.sourceLiveAttempts == 4[\s\S]*?\.sourceLiveOutcomes == 1 and[\s\S]*?\.sourceUnavailableRecoveryValid == true/u,
);
assert.match(workflow, /\.sourceReservations == 0/u);
assert.match(workflow, /\.liveMoneySwitchCount == 0/u);
assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(workflow, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true/u);
assert.doesNotMatch(workflow, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=true/u);
assert.doesNotMatch(workflow, /--publish|-p [0-9]/u);
assert.doesNotMatch(workflow, /aws-0-eu-west-1\.pooler\.supabase\.com/u);
assert.match(
  verifierConfig,
  /databaseTarget\.host,[\s\S]*?TELEBIRR_SHADOW_VERIFIER_DATABASE_ROLE/u,
);
assert.doesNotMatch(verifierConfig, /SESSION_POOLER|pooler\.supabase\.com/u);
assert.match(productionTunnel, /db\.xzztugbgtulptnbpoelr\.supabase\.co/u);
assert.match(productionTunnel, /local_port" == '25432' \|\| "\$local_port" == '5432'/u);
assert.match(productionTunnel, /StrictHostKeyChecking=yes/u);
assert.match(productionTunnel, /ExitOnForwardFailure=yes/u);
assert.match(productionTunnel, /127\.0\.0\.1:\$local_port:\$database_host:5432/u);

assert.match(provision, /PRODUCTION_PROJECT_REF/u);
assert.match(provision, /xzztugbgtulptnbpoelr/u);
assert.match(provision, /TARGET_PILOT_REVISION_ID/u);
assert.match(provision, /TARGET_SHADOW_PROOF_REQUEST_ID/u);
assert.match(provision, /SOURCE_LIVE_VERIFICATION_JOB_ID/u);
assert.match(provision, /RECOVERY_REQUEST_KEY/u);
assert.match(provision, /review_direct_shadow_request/u);
assert.match(provision, /safe_direct_shadow/u);
assert.match(provision, /safe_reviewable_source_recovery/u);
assert.match(provision, /shadow_proof\.id = :'target_shadow_proof_request_id'::uuid/u);
assert.match(provision, /telegram_telebirr_shadow_proof_receipts/u);
assert.match(provision, /private_telebirr_shadow_device_evidence_staging/u);
assert.match(provision, /private_telebirr_shadow_policy_recoveries/u);
assert.match(provision, /private_telebirr_shadow_policy_recovery_digest/u);
assert.match(provision, /private_telebirr_shadow_source_unavailable_retry_is_valid/u);
assert.match(provision, /private_telebirr_shadow_authority_deadline_retry_is_valid/u);
assert.match(provision, /private_telebirr_shadow_authority_deadline_retries/u);
assert.match(provision, /private_live_telebirr_source_recovery_is_valid/u);
assert.match(provision, /review_source_binding_window_retry/u);
assert.match(provision, /private_telebirr_shadow_source_binding_window_retries/u);
assert.match(provision, /private_telebirr_shadow_source_binding_window_retry_is_valid/u);
assert.match(provision, /private_telebirr_shadow_receipt_shape_diag_retries/u);
assert.match(provision, /private_telebirr_shadow_receipt_shape_diag_retry_is_valid/u);
assert.match(provision, /private_telebirr_shadow_source_unavailable_retries/u);
assert.match(provision, /attempt\.attempt_number = recovery\.prior_attempt_count \+ 1/u);
assert.match(provision, /\) >= recovery\.prior_attempt_count \+ 1/u);
assert.match(provision, /staged\.staged_at >= recovery\.recovered_at/u);
assert.match(provision, /recovery\.retry_expires_at = shadow_proof\.expires_at/u);
assert.match(provision, /verifier_policy_fix_retry_no_credit/u);
assert.match(provision, /quarantine\.reason_code = 'trusted_evidence_invalid'/u);
assert.match(provision, /shadow_proof\.submitted_at \+ interval '12 hours'/u);
const directSubmissionWindows = [
  ...provision.matchAll(
    /pg_catalog\.clock_timestamp\(\) < shadow_proof\.submitted_at \+ interval '12 hours'/gu,
  ),
].map((match) => match.index);
assert.equal(directSubmissionWindows.length, 2);
for (const [index, start] of directSubmissionWindows.entries()) {
  const receiptGuard = provision.indexOf(
    'from app.telegram_telebirr_shadow_proof_receipts receipt',
    start,
  );
  assert.ok(
    receiptGuard > start && receiptGuard < (directSubmissionWindows[index + 1] ?? Infinity),
  );
  assert.match(
    provision.slice(start, receiptGuard),
    /or \(\s*\(\s*app\.private_telebirr_receipt_shape_network_source_is_valid\(\s*shadow_proof\.source_unavailable_retry_source_id\s*\)\s*or app\.private_telebirr_receipt_transport_diagnostic_source_is_valid\(\s*shadow_proof\.source_unavailable_retry_source_id\s*\)\s*\)\s*and app\.private_telebirr_shadow_source_unavailable_retry_is_valid\(\s*shadow_proof\.id,\s*nullif\(:'recovery_request_key', 'not-applicable'\)::uuid\s*\)\s*\)/u,
    `direct submission-window guard ${index + 1} must bind either reviewed network retry to its exact source`,
  );
}
assert.match(provision, /shadow_proof\.recovered_at \+ interval '12 hours'/u);
assert.match(provision, /reviewed_source_binding_source_unavailable_recovery_no_credit/u);
assert.match(provision, /staged\.staged_at < shadow_proof\.expires_at/u);
assert.match(provision, /staged\.staged_at < attempt\.expires_at/u);
assert.match(provision, /staged\.observed_at >= attempt\.issued_at/u);
assert.match(provision, /staged\.observed_at < attempt\.expires_at/u);
const transitionGate = provision.indexOf('\\if :shadow_request_transition_ready');
const evidenceGuardStarts = [
  ...provision.matchAll(/from app\.private_telebirr_shadow_device_evidence_staging staged/gu),
].map((match) => match.index);
assert.ok(evidenceGuardStarts[0] < transitionGate && transitionGate < evidenceGuardStarts[1]);
for (const [index, start] of evidenceGuardStarts.slice(0, 2).entries()) {
  const end = provision.indexOf(
    'from app.private_telebirr_shadow_verification_outcomes outcome',
    start,
  );
  assert.ok(end > start && end < evidenceGuardStarts[index + 1]);
  const guard = provision.slice(start, end);
  const openingAssociation = guard.match(
    /or \(\s*app\.private_telebirr_shadow_receipt_cell_opening_retry_is_valid\([\s\S]*?and exists \(\s*select 1\s*from app\.private_telebirr_shadow_receipt_cell_opening_retries retry[\s\S]*?retry\.replacement_shadow_proof_request_id = shadow_proof\.id\s*and staged\.staged_at >= retry\.authorized_at\s*\)\s*\)/u,
  );
  assert.ok(openingAssociation, `evidence guard ${index + 1} must bind the opening retry`);
  assert.match(
    openingAssociation[0],
    /retry\.retry_request_key =\s*nullif\(:'recovery_request_key', 'not-applicable'\)::uuid/u,
  );
  assert.equal(
    [...guard.matchAll(/from app\.private_telebirr_shadow_receipt_cell_opening_retries retry/gu)]
      .length,
    1,
    `evidence guard ${index + 1} must have exactly one opening-retry association`,
  );
  const diagnosticAssociation = guard.match(
    /or \(\s*app\.private_telebirr_shadow_receipt_shape_diag_retry_is_valid\([\s\S]*?and exists \(\s*select 1\s*from app\.private_telebirr_shadow_receipt_shape_diag_retries retry[\s\S]*?retry\.replacement_shadow_proof_request_id = shadow_proof\.id\s*and staged\.staged_at >= retry\.authorized_at\s*\)\s*\)/u,
  );
  assert.ok(diagnosticAssociation, `evidence guard ${index + 1} must bind the diagnostic retry`);
  assert.match(
    diagnosticAssociation[0],
    /retry\.retry_request_key =\s*nullif\(:'recovery_request_key', 'not-applicable'\)::uuid/u,
  );
  assert.equal(
    [...guard.matchAll(/from app\.private_telebirr_shadow_receipt_shape_diag_retries retry/gu)]
      .length,
    1,
    `evidence guard ${index + 1} must have exactly one diagnostic-retry association`,
  );
}
assert.match(provision, /from safe_reviewable_source_recovery reviewable/u);
assert.match(provision, /source_live_verification_job_id = job\.id/u);
assert.match(provision, /proof\.submitted_at \+ case/u);
assert.match(provision, /then interval '36 hours'/u);
assert.match(provision, /else interval '24 hours'/u);
assert.match(
  provision,
  /pg_catalog\.clock_timestamp\(\) < proof\.submitted_at \+ case[\s\S]*?else interval '24 hours'[\s\S]*?or app\.private_live_telebirr_source_recovery_is_valid\(/u,
);
assert.match(
  provision,
  /shadow_proof\.expires_at > pg_catalog\.clock_timestamp\(\) \+ interval '60 seconds'/u,
);
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
assert.match(
  provision,
  /recover_private_live_telebirr_source_to_shadow\(uuid,uuid,uuid,uuid,uuid,text\)/u,
);
assert.match(
  provision,
  /:'source_live_verification_job_id'[\s\S]*?and :'target_shadow_proof_request_id'[\s\S]*?\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4/u,
);
assert.match(
  provision,
  /retry_expired_private_telebirr_shadow_request\(uuid,uuid,uuid,uuid,text\)/u,
);
assert.match(
  provision,
  /retry_expired_private_telebirr_shadow_after_infrastructure_failure\(uuid,uuid,uuid,uuid,text\)/u,
);
assert.match(
  provision,
  /retry_expired_private_telebirr_shadow_after_runtime_startup_failure\(uuid,uuid,uuid,uuid,text\)/u,
);
assert.match(
  provision,
  /refresh_private_telebirr_shadow_runtime_retry\(uuid,uuid,uuid,uuid,text\)/u,
);
assert.match(
  provision,
  /recover_expired_private_live_telebirr_payment_to_shadow\([\s\S]+?'expired_pilot_recovery_no_credit'\s*\)\s*\\gset/u,
);
assert.match(
  provision,
  /recover_private_live_telebirr_source_to_shadow\([\s\S]+?'terminal_source_unavailable_recovery_no_credit'\s*\)\s*\\gset/u,
);
assert.match(provision, /no_terminal_source_unavailable_recovery/u);
assert.match(provision, /replay_terminal_source_unavailable_recovery/u);
assert.match(provision, /select false as shadow_request_transition_ready/u);
assert.match(
  provision,
  /retry_expired_private_telebirr_shadow_request\([\s\S]+?'expired_shadow_retry_no_credit'\s*\)\s*\\gset/u,
);
assert.match(
  provision,
  /retry_expired_private_telebirr_shadow_after_infrastructure_failure\([\s\S]+?'expired_shadow_infrastructure_retry_no_credit'\s*\)\s*\\gset/u,
);
assert.match(
  provision,
  /retry_expired_private_telebirr_shadow_after_runtime_startup_failure\([\s\S]+?'expired_shadow_runtime_startup_retry_no_credit'\s*\)\s*\\gset/u,
);
assert.match(
  provision,
  /refresh_private_telebirr_shadow_runtime_retry\([\s\S]+?'expired_shadow_runtime_startup_retry_no_credit'\s*\)\s*\\gset/u,
);
assert.match(provision, /begin transaction isolation level read committed/u);
assert.match(provision, /create_first_shadow_request/u);
assert.match(provision, /expired_shadow_retry_no_credit/u);
assert.match(provision, /safe_source_and_open_shadow/u);
assert.match(
  provision,
  /shadow_proof\.retry_request_key =[\s\S]*?nullif\(:'recovery_request_key', 'not-applicable'\)::uuid/u,
);
assert.match(
  provision,
  /shadow_proof\.infrastructure_retry_request_key =[\s\S]*?nullif\(:'recovery_request_key', 'not-applicable'\)::uuid/u,
);
assert.match(
  provision,
  /shadow_proof\.runtime_retry_request_key =[\s\S]*?nullif\(:'recovery_request_key', 'not-applicable'\)::uuid/u,
);
assert.match(
  workflow,
  /proof\.retry_request_key =[\s\S]*?nullif\('\$RECOVERY_REQUEST_KEY', 'not-applicable'\)::uuid/u,
);
assert.match(
  workflow,
  /proof\.infrastructure_retry_request_key =[\s\S]*?nullif\('\$RECOVERY_REQUEST_KEY', 'not-applicable'\)::uuid/u,
);
assert.match(
  workflow,
  /proof\.runtime_retry_request_key =[\s\S]*?nullif\('\$RECOVERY_REQUEST_KEY', 'not-applicable'\)::uuid/u,
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

assert.match(reviewWindowMigration, /captured_at \+ interval ''12 hours''/u);
assert.match(reviewWindowMigration, /proof\.submitted_at \+ interval ''12 hours''/u);
assert.match(reviewWindowMigration, /staged\.staged_at >= proof\.expires_at/u);
assert.match(reviewWindowMigration, /staged\.staged_at < proof\.expires_at/u);
assert.match(reviewWindowMigration, /captured_at < profile\.valid_until/u);
assert.match(reviewWindowMigration, /captured_at < enrollment\.valid_until/u);
assert.match(reviewWindowMigration, /captured_at < signer\.valid_until/u);
assert.match(reviewWindowMigration, /private_live_telebirr_device_revocations/u);
assert.match(reviewWindowMigration, /private_live_telebirr_assignment_signer_revocations/u);
assert.doesNotMatch(reviewWindowMigration, /insert into app\./u);
assert.doesNotMatch(reviewWindowMigration, /update app\./u);

assert.match(
  singleOutcomeLoaderMigration,
  /load_next_private_telebirr_shadow_staged_evidence\(\)/u,
);
assert.match(singleOutcomeLoaderMigration, /outcome\.shadow_proof_request_id = proof\.id/u);
assert.match(singleOutcomeLoaderMigration, /old_count = 1 and new_count = 0/u);
assert.match(singleOutcomeLoaderMigration, /old_count = 1 and new_count = 1/u);
assert.doesNotMatch(singleOutcomeLoaderMigration, /insert into app\./u);
assert.doesNotMatch(singleOutcomeLoaderMigration, /update app\./u);
assert.doesNotMatch(singleOutcomeLoaderMigration, /delete from app\./u);
