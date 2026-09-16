import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/supabase-staging-bootstrap.yml'),
  'utf8',
);
const readme = readFileSync(resolve(root, 'supabase/README.md'), 'utf8');
const transitionRunbook = readFileSync(
  resolve(root, 'infra/operations/fetanagent-vm-transition.md'),
  'utf8',
);
const stagingOperationalLedgerMarkerPaths = [
  'supabase/migrations/20260829153326_extend_staging_runtime_validity_for_kemerbet_quarantine_recovery_20260829.sql',
  'supabase/migrations/20260829154240_align_staging_player_action_validity_for_kemerbet_quarantine_recovery_20260829.sql',
];
const productionOperationalLedgerMarkerPaths = [
  'supabase/migrations/20260916131633_allow_telebirr_shadow_assignment_retry_transcripts.sql',
  'supabase/migrations/20260916134441_backdate_telebirr_shadow_assignment_assessment_clock.sql',
  'supabase/migrations/20260916134810_refresh_telebirr_shadow_runtime_retry.sql',
  'supabase/migrations/20260916134849_fix_refresh_telebirr_shadow_runtime_retry_least.sql',
  'supabase/migrations/20260916135027_extend_telebirr_shadow_runtime_review_cap.sql',
  'supabase/migrations/20260916141308_clamp_telebirr_shadow_assignment_assessment_clock.sql',
];
const productionCanonicalFinalizers = [
  [
    'supabase/migrations/20260916151200_allow_telebirr_shadow_assignment_retry_transcripts.sql',
    '20260916131633',
  ],
  [
    'supabase/migrations/20260916151300_backdate_telebirr_shadow_assignment_assessment_clock.sql',
    '20260916134441',
  ],
  [
    'supabase/migrations/20260916151500_refresh_telebirr_shadow_runtime_retry.sql',
    '20260916134810',
  ],
  [
    'supabase/migrations/20260916152000_extend_telebirr_shadow_runtime_review_cap.sql',
    '20260916135027',
  ],
  [
    'supabase/migrations/20260916152500_clamp_telebirr_shadow_assignment_assessment_clock.sql',
    '20260916141308',
  ],
];
const telegramProofStatusMigrationPath =
  'supabase/migrations/20260903140617_private_telegram_deposit_proof_status.sql';

const assertInOrder = (source, needles, message) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${needle}`);
    assert.ok(next > cursor, message);
    cursor = next;
  }
};

const validateTarget = /jobs:\s+validate-target:([\s\S]*?)\n  staging-migrations:/u.exec(
  workflow,
)?.[1];
assert.ok(validateTarget, 'The workflow must validate its target before the protected job.');

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s+contents: read/);
assert.match(
  workflow,
  /confirm_main_commit_sha:\s+description:[^\n]+\s+required: true\s+type: string/u,
);
assert.match(
  validateTarget,
  /CONFIRMED_MAIN_COMMIT_SHA: \$\{\{ inputs\.confirm_main_commit_sha \}\}/,
);
assert.doesNotMatch(validateTarget, /environment:|secrets\./);
assertInOrder(
  validateTarget,
  [
    `GITHUB_REF" != 'refs/heads/main'`,
    `REQUESTED_MODE" != 'plan'`,
    `STAGING_PROJECT_REF" == "$PRODUCTION_PROJECT_REF`,
    `CONFIRMED_STAGING_PROJECT_REF" != "$STAGING_PROJECT_REF`,
    `CONFIRMED_STAGING_PROJECT_REF" == "$PRODUCTION_PROJECT_REF`,
    `CONFIRMED_MAIN_COMMIT_SHA" =~ ^[0-9a-f]{40}$`,
    `CONFIRMED_MAIN_COMMIT_SHA" != "$GITHUB_SHA`,
  ],
  'Branch, mode, project, production, and exact-commit checks must stay ordered before protected work',
);
assert.match(validateTarget, /The confirmed commit does not match the exact workflow commit\./);

const protectedJob = /\n  staging-migrations:([\s\S]*)$/u.exec(workflow)?.[1];
assert.ok(protectedJob, 'The protected migration job must exist.');
assert.match(protectedJob, /needs: validate-target/);
assert.match(protectedJob, /environment: staging/);
assert.match(protectedJob, /uses: actions\/checkout@[0-9a-f]{40}/);
assert.match(protectedJob, /ref: \$\{\{ github\.sha \}\}/);
assert.match(protectedJob, /persist-credentials: false/);
assertInOrder(
  protectedJob,
  [
    'Verify exact checked-out commit',
    `git rev-parse HEAD)" != "$GITHUB_SHA`,
    'Verify tooling and staging credentials',
    'Link only the staging project',
    'supabase migration list --linked',
    'supabase db push --linked --dry-run',
    "if: inputs.mode == 'apply'",
    'supabase db push --linked --yes',
  ],
  'Commit verification and dry-run must precede credentials, linking, and conditional apply',
);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.doesNotMatch(workflow, /service[_-]?role|seed\.sql|telegram|payment/i);

for (const document of [readme, transitionRunbook]) {
  assert.match(document, /confirm_main_commit_sha/);
  assert.match(document, /same full SHA/i);
}

const readCommentOnlyLedgerMarker = (markerPath) => {
  const marker = readFileSync(resolve(root, markerPath), 'utf8');
  const executableLines = marker
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('--'));
  const markerNarrative = marker.replace(/^--\s?/gmu, '').replace(/\s+/gu, ' ');
  assert.deepEqual(
    executableLines,
    [],
    `${markerPath} must remain a comment-only operational ledger marker`,
  );
  return markerNarrative;
};

for (const markerPath of stagingOperationalLedgerMarkerPaths) {
  const markerNarrative = readCommentOnlyLedgerMarker(markerPath);
  assert.match(markerNarrative, /Hosted staging-only operational migration ledger marker\./u);
  assert.match(markerNarrative, /no-op file preserves exact migration-history/u);
  assert.match(
    markerNarrative,
    /without creating a login, credential, schema object, feature switch/u,
  );
}

for (const markerPath of productionOperationalLedgerMarkerPaths) {
  const markerNarrative = readCommentOnlyLedgerMarker(markerPath);
  assert.match(markerNarrative, /Hosted production operational migration ledger marker\./u);
  assert.match(markerNarrative, /no-op marker preserves (?:the )?exact hosted history/u);
}

for (const [finalizerPath, hostedVersion] of productionCanonicalFinalizers) {
  const finalizer = readFileSync(resolve(root, finalizerPath), 'utf8');
  assert.match(finalizer, new RegExp(`hosted version ${hostedVersion}`, 'u'));
  assert.match(finalizer, /replay-safe canonical finalizer/u);
}

for (const supersededPath of [
  'supabase/migrations/20260916131500_allow_telebirr_shadow_assignment_retry_transcripts.sql',
  'supabase/migrations/20260916134500_backdate_telebirr_shadow_assignment_assessment_clock.sql',
]) {
  assert.equal(
    existsSync(resolve(root, supersededPath)),
    false,
    `${supersededPath} must not return ahead of its hosted ledger entry`,
  );
}

assert.equal(
  existsSync(
    resolve(root, 'supabase/migrations/20260902224258_private_telegram_deposit_proof_status.sql'),
  ),
  false,
  'The superseded local-only Telegram migration timestamp must not return.',
);
const telegramProofStatusMigration = readFileSync(
  resolve(root, telegramProofStatusMigrationPath),
  'utf8',
);
assert.match(telegramProofStatusMigration, /first reviewed under timestamp 20260902224258/u);
assert.match(telegramProofStatusMigration, /hosted version 20260903140617/u);
assert.match(
  telegramProofStatusMigration,
  /create function app\.get_telegram_customer_deposit_proof\(/u,
);

console.log(
  'Supabase staging bootstrap verified: manual staging-only dispatch, exact commit binding, hosted-ledger reconciliation, checked-out SHA verification, and dry-run before apply',
);
