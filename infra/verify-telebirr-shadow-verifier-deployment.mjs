import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8');
const [
  dockerfile,
  compose,
  packageText,
  configSource,
  postgresSource,
  applicationSource,
  verifierSource,
  healthSource,
  mainSource,
  migrationSource,
  environmentExample,
  workflowSource,
  ownerStatusSource,
] = await Promise.all([
  read('Dockerfile'),
  read('infra/compose.telebirr-shadow-verifier.yaml'),
  read('apps/trusted-telebirr-verifier/package.json'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-config.ts'),
  read('apps/trusted-telebirr-verifier/src/postgres-telebirr-shadow-verifier.ts'),
  read('apps/trusted-telebirr-verifier/src/telebirr-shadow-verifier-application.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier.ts'),
  read('apps/trusted-telebirr-verifier/src/trusted-telebirr-verifier-health.ts'),
  read('apps/trusted-telebirr-verifier/src/telebirr-shadow-verifier-main.ts'),
  read('supabase/migrations/20260909220000_private_telebirr_shadow_verification.sql'),
  read('.env.example'),
  read('.github/workflows/telebirr-shadow-verifier-image-smoke.yml'),
  read('apps/admin/src/owner-telebirr-shadow-verification-status.ts'),
]);
const packageJson = JSON.parse(packageText);
const functionBody = (name) => {
  const escapedName = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = migrationSource.match(
    new RegExp(
      `create function app\\.${escapedName}\\([\\s\\S]*?\\)\\r?\\nreturns[\\s\\S]*?\\r?\\nas \\$\\$\\r?\\n([\\s\\S]*?)\\r?\\n\\$\\$;`,
      'u',
    ),
  );
  assert.ok(match?.[1], `missing SQL body for app.${name}`);
  return match[1];
};

assert.equal(
  packageJson.scripts['start:shadow'],
  'node dist/telebirr-shadow-verifier-main.js',
  'shadow entrypoint must remain distinct from live verification',
);

const image = dockerfile
  .split('FROM trusted-telebirr-verifier AS telebirr-shadow-verifier')[1]
  ?.split('# The executor uses the distribution-provided Chromium')[0];
assert.ok(image, 'missing dedicated TeleBirr shadow image target');
assert.match(image, /org\.opencontainers\.image\.title="fetanagent-telebirr-shadow-verifier"/u);
assert.match(image, /127\.0\.0\.1:8092\/readyz/u);
assert.match(
  image,
  /CMD \["node", "apps\/trusted-telebirr-verifier\/dist\/telebirr-shadow-verifier-main\.js"\]/u,
);
assert.doesNotMatch(image, /\bEXPOSE\b|docker\.sock|\/run\/(?:secrets|configs)/u);

assert.match(compose, /^\s{4}profiles: \[telebirr-shadow-verifier\]$/mu);
assert.match(compose, /repository@sha256 immutable image reference/u);
assert.match(compose, /^\s{4}user: '10001:10001'$/mu);
assert.match(compose, /^\s{4}read_only: true$/mu);
assert.match(compose, /^\s{6}- ALL$/mu);
assert.match(compose, /^\s{6}- no-new-privileges:true$/mu);
assert.match(compose, /^\s{6}FINANCIAL_ACTIONS_MODE: dry_run$/mu);
assert.match(compose, /^\s{6}TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'false'$/mu);
assert.match(compose, /^\s{6}KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false'$/mu);
assert.match(compose, /INTERNAL_TELEBIRR_SHADOW_VERIFIER_ENABLED: \$\{[^\r\n]+:\?[^\r\n]+\}/u);
assert.match(compose, /TELEBIRR_SHADOW_VERIFICATION_ENABLED: \$\{[^\r\n]+:\?[^\r\n]+\}/u);
assert.match(compose, /telebirr_shadow_verifier_database_url/u);
assert.match(compose, /telebirr_shadow_verifier_pins\.v1\.json/u);
assert.match(compose, /127\.0\.0\.1:8092\/readyz/u);
assert.match(compose, /mode: 0400/u);
assert.equal((compose.match(/mode: 0444/gu) ?? []).length, 2);
assert.doesNotMatch(
  compose,
  /^\s+(?:ports|expose|build|privileged|network_mode|pid|ipc):|docker\.sock|\/var\/run\/docker/imu,
  'shadow service must have no public/inherited ingress, build, privilege, or Docker control',
);
assert.doesNotMatch(
  compose,
  /TELEGRAM_BOT_TOKEN|service[_ -]?role|private[_ -]?key|provider[_ -]?(?:pin|otp)/iu,
);

for (const gate of [
  'INTERNAL_TELEBIRR_SHADOW_VERIFIER_ENABLED',
  'TELEBIRR_SHADOW_VERIFICATION_ENABLED',
]) {
  assert.match(environmentExample, new RegExp(`^${gate}=false$`, 'mu'));
}

assert.match(configSource, /FINANCIAL_ACTIONS_MODE/u);
assert.match(configSource, /environment\.FINANCIAL_ACTIONS_MODE !== 'dry_run'/u);
assert.match(configSource, /environment\.TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED/u);
assert.match(configSource, /environment\.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED/u);
assert.match(configSource, /fetanagent_telebirr_shadow_verifier_runtime/u);
assert.match(configSource, /telebirr_shadow_verifier_database_url/u);
assert.match(configSource, /telebirr_shadow_verifier_pins\.v1\.json/u);

assert.match(postgresSource, /load_next_private_telebirr_shadow_staged_evidence/u);
assert.match(postgresSource, /complete_private_telebirr_shadow_verification/u);
assert.match(postgresSource, /quarantine_private_telebirr_shadow_staged_evidence/u);
assert.match(postgresSource, /application_name: 'fetanagent_telebirr_shadow_verifier'/u);
assert.doesNotMatch(postgresSource, /complete_private_live_telebirr_verification/u);
assert.match(applicationSource, /loadTelebirrShadowVerifierConfig/u);
assert.match(applicationSource, /createTelebirrShadowPostgresRuntime/u);
assert.match(applicationSource, /createTelebirrShadowVerifier/u);
assert.match(applicationSource, /await exactRuntime\.ready\(\)/u);
assert.doesNotMatch(applicationSource, /\.verifyAndComplete\(/u);
assert.match(verifierSource, /createTelebirrVerifier\(database, pinnedKeys, 'shadow'\)/u);
assert.match(verifierSource, /settlement_created !== false/u);
assert.match(verifierSource, /row\.deposit_intent_id !== null/u);
assert.match(verifierSource, /row\.deposit_payment_claim_id !== null/u);
assert.match(verifierSource, /row\.execution_job_id !== null/u);
assert.match(verifierSource, /function shadowAdvisoryOutcome/u);
assert.match(verifierSource, /'shadow_not_completed'/u);
assert.match(verifierSource, /'would_verify'/u);
assert.match(verifierSource, /'would_review'/u);
assert.match(verifierSource, /'would_reject'/u);
assert.match(healthSource, /TELEBIRR_SHADOW_VERIFIER_HEALTH_PORT = 8092/u);
assert.match(healthSource, /fetanagent-telebirr-shadow-verifier/u);
assert.match(mainSource, /FetanAgent TeleBirr shadow verifier failed closed\./u);

const lockedGateBody = functionBody('require_private_telebirr_shadow_mode_ready');
assert.match(
  lockedGateBody,
  /pg_catalog\.current_setting\('transaction_isolation'\) <> 'read committed'/iu,
  'every shadow writer must reject snapshots that cannot see post-lock commits',
);
assert.match(lockedGateBody, /order by feature_switch\.feature_key\s+for share/iu);
assert.match(lockedGateBody, /get diagnostics locked_switch_count = row_count/iu);
assert.match(
  lockedGateBody,
  /from app\.private_live_deposit_pilot_revisions pilot[\s\S]*?for share/iu,
);
assert.match(lockedGateBody, /locked_switch_count <> 7/iu);
const postLockTimeBoundaries = new Map([
  [
    'capture_telegram_telebirr_shadow_proof',
    { timestamp: 'authority_at', finalCheck: 'authority_at >= profile.valid_until' },
  ],
  [
    'lease_private_telebirr_shadow_assignment',
    { timestamp: 'authority_at', finalCheck: 'or authority_at >= proof.expires_at' },
  ],
  [
    'persist_private_telebirr_shadow_assignment_signature',
    {
      timestamp: 'authority_at',
      finalCheck: 'where revocation.assignment_signer_id = signer.id',
    },
  ],
  [
    'stage_private_telebirr_shadow_device_evidence',
    { timestamp: 'authority_at', finalCheck: 'or authority_at >= attempt.expires_at' },
  ],
  [
    'complete_private_telebirr_shadow_verification',
    { timestamp: 'authority_at', finalCheck: 'or authority_at >= proof.expires_at' },
  ],
]);
for (const transition of [
  'capture_telegram_telebirr_shadow_proof',
  'lease_private_telebirr_shadow_assignment',
  'persist_private_telebirr_shadow_assignment_signature',
  'stage_private_telebirr_shadow_device_evidence',
  'complete_private_telebirr_shadow_verification',
  'quarantine_private_telebirr_shadow_staged_evidence',
]) {
  const body = functionBody(transition);
  assert.match(
    body,
    /app\.require_private_telebirr_shadow_mode_ready/u,
    `${transition} must hold the locked seven-gate assertion before writing`,
  );
  const firstWriteIndex = body.search(
    /\b(?:insert into|update|delete from) app\.(?:private_telebirr_shadow|telegram_telebirr_shadow)/iu,
  );
  assert.ok(
    firstWriteIndex > body.search(/app\.require_private_telebirr_shadow_mode_ready/u),
    `${transition} must assert and hold the seven gates before its first shadow write`,
  );

  const timeBoundary = postLockTimeBoundaries.get(transition);
  if (timeBoundary) {
    assert.match(
      body,
      new RegExp(`\\b${timeBoundary.timestamp}\\s+timestamptz\\s*;`, 'u'),
      `${transition} must not capture its authority timestamp at function entry`,
    );
    assert.doesNotMatch(
      body,
      new RegExp(`\\b${timeBoundary.timestamp}\\s+timestamptz\\s*:=`, 'u'),
      `${transition} must not initialize its authority timestamp before locking`,
    );
    assert.equal(
      body.match(
        new RegExp(
          `\\b${timeBoundary.timestamp}\\s*:=\\s*pg_catalog\\.clock_timestamp\\(\\)`,
          'gu',
        ),
      )?.length,
      2,
      `${transition} must refresh time after its initial locks and again at its final gate`,
    );

    const finalRefreshIndex = body.lastIndexOf(
      `${timeBoundary.timestamp} := pg_catalog.clock_timestamp()`,
    );
    const finalBlockingBoundaryIndex = Math.max(
      body.lastIndexOf('pg_advisory_xact_lock'),
      body.lastIndexOf('for share'),
      body.lastIndexOf('for update'),
      body.lastIndexOf('app.require_private_telebirr_shadow_mode_ready'),
    );
    const finalCheckIndex = body.lastIndexOf(timeBoundary.finalCheck);
    assert.ok(
      finalRefreshIndex > finalBlockingBoundaryIndex &&
        finalCheckIndex > finalRefreshIndex &&
        firstWriteIndex > finalCheckIndex,
      `${transition} must refresh and recheck time after its final blocking boundary and before writing`,
    );
  }
}
const captureBody = functionBody('capture_telegram_telebirr_shadow_proof');
assert.match(captureBody, /\bv_customer_id uuid;/u);
assert.match(captureBody, /\bv_customer_identity_id uuid;/u);
assert.doesNotMatch(captureBody, /(^|\s)customer_id uuid;/u);
assert.doesNotMatch(captureBody, /(^|\s)customer_identity_id uuid;/u);
for (const reader of [
  'load_next_private_telebirr_shadow_staged_evidence',
  'load_private_telebirr_shadow_verification_authority',
]) {
  assert.doesNotMatch(
    functionBody(reader),
    /date_trunc\('milliseconds',\s*pg_catalog\.clock_timestamp\(\)\)/iu,
    `${reader} must use a full-precision authority clock`,
  );
}
const quarantineBody = functionBody('quarantine_private_telebirr_shadow_staged_evidence');
const quarantineAttemptLockIndex = quarantineBody.indexOf('for update of attempt');
const quarantineOutcomeReferenceIndex = quarantineBody.indexOf(
  'app.private_telebirr_shadow_verification_outcomes',
  quarantineAttemptLockIndex,
);
const quarantineOutcomeCheckIndex = quarantineBody.lastIndexOf(
  'if exists (',
  quarantineOutcomeReferenceIndex,
);
const quarantineGateIndex = quarantineBody.indexOf(
  'app.require_private_telebirr_shadow_mode_ready',
);
assert.doesNotMatch(
  quarantineBody.slice(0, quarantineAttemptLockIndex),
  /private_telebirr_shadow_verification_outcomes/u,
  'quarantine must not take its outcome snapshot before waiting for the attempt lock',
);
assert.ok(
  quarantineAttemptLockIndex >= 0 &&
    quarantineOutcomeCheckIndex > quarantineAttemptLockIndex &&
    quarantineGateIndex > quarantineOutcomeCheckIndex,
  'quarantine must freshly reject a completed attempt after locking and before its gate or write',
);
assert.match(
  functionBody('lease_private_live_telebirr_assignment_broker'),
  /if not app\.private_telebirr_shadow_mode_is_ready\(enrollment\.pilot_revision_id\) then\s+return;\s+end if;/iu,
  'disabled broker polling must preserve the empty-queue contract',
);
const completionBody = functionBody('complete_private_telebirr_shadow_verification');
assert.match(completionBody, /app\.private_telebirr_shadow_evidence_quarantine/u);
for (const advisoryOutcome of ['would_verify', 'would_review', 'would_reject']) {
  assert.match(completionBody, new RegExp(`'${advisoryOutcome}'`, 'u'));
}
assert.match(ownerStatusSource, /would_verify_count/u);
assert.match(ownerStatusSource, /would_review_count/u);
assert.match(ownerStatusSource, /would_reject_count/u);
assert.doesNotMatch(ownerStatusSource, /review_required_count|definite_reject_count/u);

assert.match(workflowSource, /permissions:\s+contents: read/gu);
assert.match(workflowSource, /--target telebirr-shadow-verifier/u);
assert.match(workflowSource, /--network none/u);
assert.match(workflowSource, /--read-only/u);
assert.match(workflowSource, /--cap-drop ALL/u);
assert.match(workflowSource, /Config\.ExposedPorts/u);
assert.match(workflowSource, /INTERNAL_TELEBIRR_SHADOW_VERIFIER_ENABLED=false/u);
assert.match(workflowSource, /TELEBIRR_SHADOW_VERIFICATION_ENABLED=false/u);

for (const financialTable of [
  'app.deposit_intents',
  'app.deposit_submissions',
  'app.deposit_submission_files',
  'app.deposit_verification_attempts',
  'app.deposit_payment_claims',
  'app.deposit_review_cases',
  'app.deposit_jobs',
  'app.deposit_state_events',
  'app.deposit_execution_attempts',
  'app.execution_reconciliations',
  'app.provider_payment_evidence',
  'app.private_live_deposit_pilot_proofs',
  'app.private_live_deposit_pilot_reservations',
  'app.private_live_telebirr_verification_jobs',
  'app.private_live_telebirr_verification_attempts',
  'app.private_live_telebirr_assignment_transcripts',
  'app.private_live_telebirr_device_evidence_staging',
  'app.private_live_telebirr_verification_outcomes',
  'app.private_live_telebirr_settlement_receipts',
]) {
  assert.doesNotMatch(
    migrationSource,
    new RegExp(
      `(?:insert\\s+into|update|delete\\s+from)\\s+${financialTable.replaceAll('.', '\\.')}\\b`,
      'iu',
    ),
    `shadow migration must not mutate ${financialTable}`,
  );
}
assert.doesNotMatch(migrationSource, /(?:insert\s+into|update|delete\s+from)[^;]*kemerbet/iu);
assert.match(migrationSource, /'shadow_no_money'/u);
assert.match(migrationSource, /'verification_queued'/u);
assert.match(migrationSource, /null::uuid/u);
assert.match(migrationSource, /settlement_created[^\r\n]*false/iu);
assert.match(migrationSource, /from public, anon, authenticated, service_role/u);

console.log(
  'TeleBirr shadow verifier deployment artifacts verified: explicit dry-run-only profile, distinct runtime/entrypoint, no public ingress, exact shadow database surface, all financial gates off, and no financial ledger mutation',
);
