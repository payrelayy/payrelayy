import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}/${path}`, 'utf8');

const [
  compose,
  shadowCompose,
  shadowIntakeCompose,
  shadowReleaseMode,
  telebirrPilotBinding,
  operationalPromotionBinding,
  inertCompose,
  gatewayCaddyfile,
  workflow,
  helper,
  sudoers,
  cbeStoppedHelperRotation,
  cbeStoppedPhoneProofHelperRotation,
  ownerManualReviewHelperRotation,
  ownerPageClarityHelperRotation,
  ownerPaymentMethodsHelperRotation,
  unifiedDepositHelperRotation,
  shortDepositHelperRotation,
  copyNumbersHelperRotation,
  inlineNumbersHelperRotation,
  telebirrRevisionHelperRotation,
  pausedCreditHelperRotation,
  uncertainIsolationHelperRotation,
  customerCopyHelperRotation,
  playerIdHelperRotation,
  shortPlayerIdMenuHelperRotation,
  playerCreditSpeedHelperRotation,
  depositRangeHelperRotation,
  depositRangeReleaseRunbook,
  cbeReferenceHelperRotation,
  cbeReferenceReleaseRunbook,
  ownerFullStage1HelperRotation,
  ownerFullActivationHelperRotation,
  ownerFullHistoryFixHelperRotation,
  ownerFullPaymentReleaseRunbook,
  ownerOneClickHelperRotation,
  ownerOneClickReleaseRunbook,
  depositCopyHintHelperRotation,
  depositCopyHintReleaseRunbook,
  botExpiryMenuHelperRotation,
  ownerControlPanelHelperRotation,
  ownerEmergencyApprovalHelperRotation,
  ownerSmsInboxHelperRotation,
  telegramNaturalMessagesHelperRotation,
  telegramNaturalMessagesReleaseRunbook,
  shortCustomerCopyHelperRotation,
  shortCustomerCopyReleaseRunbook,
  releaseGuardRefreshHelperRotation,
  releaseGuardRefreshRunbook,
  predecessorHelper,
  predecessorSudoers,
  provisionSql,
  disableSql,
  stoppedSmsRestoreSql,
  assignmentRuntimeInputSql,
  shadowAssignmentRuntimeInputSql,
  inertPreflightSql,
  cbeLivePreflightSql,
  cbeStoppedPreflightSql,
  cbeLiveCutoverIdleSql,
  financialSwitchFingerprintSql,
  paidPollActivateSql,
  paidPollDisableSql,
  paidSettlementActivateSql,
  paidSettlementDisableSql,
  receiverSmsActivateSql,
  receiverSmsDisableSql,
  receiverSmsStopSql,
  assignmentBrokerContinuousRuntimeMigration,
  assignmentBrokerConfig,
  assignmentBrokerPostgres,
  referenceOpeningDeriver,
  postgresScramVerifier,
  directSqlTunnel,
  packageJson,
  quality,
] = await Promise.all([
  read('infra/compose.production.yaml'),
  read('infra/compose.production.shadow-review.yaml'),
  read('infra/compose.production.shadow-intake.yaml'),
  read('infra/production-shadow-release-mode'),
  read('infra/production-telebirr-pilot-binding'),
  read('infra/production-telebirr-operational-promotion.sha256'),
  read('infra/compose.production.inert-maintenance.yaml'),
  read('infra/gateway/Caddyfile'),
  read('.github/workflows/production-runtime.yml'),
  read('infra/operations/fetanagent-production-deploy-helper-v2.sh'),
  read('infra/operations/fetanagent-production-deploy-helper-v2.sudoers'),
  read('infra/operations/fetanagent-production-v2-cbe-stopped-helper-rotation-v2.sh'),
  read('infra/operations/fetanagent-production-v2-cbe-stopped-phone-proof-rotation-v3.sh'),
  read('infra/operations/fetanagent-production-v2-owner-manual-payment-review-rotation-v4.sh'),
  read('infra/operations/fetanagent-production-v2-owner-page-clarity-rotation-v5.sh'),
  read('infra/operations/fetanagent-production-v2-owner-payment-methods-rotation-v6.sh'),
  read('infra/operations/fetanagent-production-v2-unified-deposit-rotation-v7.sh'),
  read('infra/operations/fetanagent-production-v2-short-deposit-rotation-v8.sh'),
  read('infra/operations/fetanagent-production-v2-copy-numbers-rotation-v9.sh'),
  read('infra/operations/fetanagent-production-v2-inline-numbers-rotation-v10.sh'),
  read('infra/operations/fetanagent-production-v2-telebirr-revision-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-paused-credit-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-uncertain-isolation-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-customer-copy-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-player-id-auto-detect-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-short-player-id-menu-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-player-credit-speed-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-deposit-range-helper-rotation-v1.sh'),
  read('infra/operations/production-deposit-range-release.md'),
  read('infra/operations/fetanagent-production-v2-cbe-reference-helper-rotation-v1.sh'),
  read('infra/operations/production-cbe-reference-release.md'),
  read('infra/operations/fetanagent-production-v2-owner-full-stage1-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-owner-full-activation-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-owner-full-history-fix-helper-rotation-v1.sh'),
  read('infra/operations/production-owner-full-payment-identifiers-release.md'),
  read('infra/operations/fetanagent-production-v2-owner-one-click-helper-rotation-v1.sh'),
  read('infra/operations/production-owner-one-click-release.md'),
  read('infra/operations/fetanagent-production-v2-deposit-copy-hint-helper-rotation-v1.sh'),
  read('infra/operations/production-deposit-copy-hint-release.md'),
  read('infra/operations/fetanagent-production-v2-bot-expiry-menu-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-owner-control-panel-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-owner-emergency-approval-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-owner-sms-inbox-helper-rotation-v1.sh'),
  read('infra/operations/fetanagent-production-v2-telegram-natural-messages-helper-rotation-v1.sh'),
  read('infra/operations/production-telegram-natural-messages-release.md'),
  read('infra/operations/fetanagent-production-v2-short-customer-copy-helper-rotation-v1.sh'),
  read('infra/operations/production-short-customer-copy-release.md'),
  read('infra/operations/fetanagent-production-v2-release-guard-refresh-helper-rotation-v1.sh'),
  read('infra/operations/production-release-guard-refresh.md'),
  read('infra/operations/fetanagent-production-deploy-helper.sh'),
  read('infra/operations/fetanagent-production-deploy-helper.sudoers'),
  read('infra/sql/production-nonfinancial-runtimes-provision.sql'),
  read('infra/sql/production-nonfinancial-runtimes-disable.sql'),
  read('infra/sql/production-stopped-sms-runtime-restore.sql'),
  read('infra/sql/production-telebirr-assignment-runtime-input.sql'),
  read('infra/sql/production-telebirr-shadow-assignment-runtime-input.sql'),
  read('infra/sql/production-inert-runtime-preflight.sql'),
  read('infra/sql/production-cbe-live-runtime-preflight.sql'),
  read('infra/sql/production-cbe-stopped-runtime-preflight.sql'),
  read('infra/sql/production-cbe-live-cutover-idle.sql'),
  read('infra/sql/production-financial-switch-fingerprint.sql'),
  read('infra/sql/production-routine-paid-poll-activate.sql'),
  read('infra/sql/production-routine-paid-poll-disable.sql'),
  read('infra/sql/production-routine-paid-settlement-activate.sql'),
  read('infra/sql/production-routine-paid-settlement-disable.sql'),
  read('infra/sql/production-receiver-sms-runtimes-activate.sql'),
  read('infra/sql/production-receiver-sms-runtimes-disable.sql'),
  read('infra/sql/production-receiver-sms-runtimes-stop.sql'),
  read('supabase/migrations/20260916142230_telebirr_assignment_broker_continuous_runtime.sql'),
  read('apps/telebirr-assignment-broker/src/telebirr-assignment-broker-config.ts'),
  read('apps/telebirr-assignment-broker/src/postgres-telebirr-assignment-broker.ts'),
  read('infra/operations/derive-telebirr-reference-opening-key.mjs'),
  read('infra/operations/verify-postgres-scram-secret.mjs'),
  read('infra/operations/psql-over-production-direct-tunnel.sh'),
  read('package.json'),
  read('.github/workflows/quality.yml'),
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function topLevelSection(source, name) {
  const header = new RegExp(`^${escapeRegExp(name)}:\\s*$`, 'mu').exec(source);
  assert.ok(header, `missing top-level ${name} section`);
  const remainder = source.slice(header.index + header[0].length);
  const next = /^\S[^\r\n]*:\s*$/mu.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function childBlock(section, name) {
  const header = new RegExp(`^  ${escapeRegExp(name)}:\\s*$`, 'mu').exec(section);
  assert.ok(header, `missing ${name} block`);
  const remainder = section.slice(header.index + header[0].length);
  const next = /^  [a-z][a-z0-9_-]*:\s*$/mu.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

assert.match(
  telebirrPilotBinding,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\r?\n?$/u,
);
assert.match(operationalPromotionBinding, /^[0-9a-f]{64}\r?\n?$/u);
assert.equal(
  count(
    workflow,
    /REQUESTED_TELEBIRR_EPOCH: \$\{\{ inputs\.confirm_telebirr_activation_epoch \}\}/gu,
  ),
  2,
);
assert.equal(
  count(
    workflow,
    /operational_promotion_binding="\$\(<infra\/production-telebirr-operational-promotion\.sha256\)"/gu,
  ),
  2,
);
assert.equal(
  count(
    workflow,
    /expected_operational_binding="\$\(printf '%s:%s' "\$REQUESTED_TELEBIRR_PILOT" "\$REQUESTED_TELEBIRR_EPOCH" \| sha256sum \| cut -d ' ' -f 1\)"/gu,
  ),
  2,
);
assert.equal(
  count(
    workflow,
    /This exact production commit is not bound to the requested operational pilot and epoch\./gu,
  ),
  2,
);
assert.equal(
  count(workflow, /pilot_binding="\$\(<infra\/production-telebirr-pilot-binding\)"/gu),
  2,
);
assert.equal(
  count(
    workflow,
    /REQUESTED_TELEBIRR_PILOT: \$\{\{ inputs\.confirm_telebirr_pilot_revision_id \}\}/gu,
  ),
  2,
);
assert.equal(
  count(workflow, /This exact production commit is not bound to the requested TeleBirr pilot\./gu),
  2,
);

const services = topLevelSection(compose, 'services');
const serviceNames = [...services.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gmu)].map(
  (match) => match[1],
);
assert.deepEqual(serviceNames, [
  'owner-control',
  'customer-web',
  'api',
  'bot',
  'telebirr-assignment-broker',
  'telebirr-device-state-broker',
  'telebirr-device-bridge',
  'production-companion-device-bridge',
  'gateway',
]);

const applicationServices = serviceNames
  .slice(0, 4)
  .map((name) => [name, childBlock(services, name)]);
const gateway = childBlock(services, 'gateway');
for (const [name, service] of applicationServices) {
  assert.match(service, /image: fetanagent-[a-z-]+:\$\{FETANAGENT_IMAGE_TAG:\?/u, name);
  assert.match(service, /<<: \*runtime-defaults/u, name);
  assert.match(service, /NODE_ENV: production/u, name);
  if (name === 'api') {
    assert.match(service, /FINANCIAL_ACTIONS_MODE: live/u, name);
  } else {
    assert.match(service, /FINANCIAL_ACTIONS_MODE: dry_run/u, name);
  }
  assert.match(service, /KEMERBET_EXECUTOR_ENABLED: 'false'/u, name);
  assert.match(service, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u, name);
  assert.doesNotMatch(service, /password|token:\s*[^/\s$]/iu, `${name} contains inline authority`);
}
assert.equal(
  count(compose, /FINANCIAL_ACTIONS_MODE: live/gu),
  1,
  'only the guarded Telegram API may compose in live financial mode',
);
assert.match(shadowCompose, /^services:\s*\r?\n  api:/mu);
assert.match(shadowCompose, /FINANCIAL_ACTIONS_MODE: dry_run/u);
assert.match(shadowCompose, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'true'/u);
assert.equal(
  count(shadowCompose, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'true'/gu),
  1,
  'the shadow-review overlay must enable exactly one non-submittable receiver review gate',
);
assert.doesNotMatch(shadowCompose, /KEMERBET_|secrets:|configs:|networks:|volumes:/u);
assert.match(shadowIntakeCompose, /^services:\s*\r?\n  api:/mu);
assert.match(shadowIntakeCompose, /FINANCIAL_ACTIONS_MODE: dry_run/u);
assert.match(shadowIntakeCompose, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'false'/u);
assert.equal(
  count(shadowIntakeCompose, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'false'/gu),
  1,
  'the shadow-intake overlay must disable exactly one receiver-review gate',
);
assert.doesNotMatch(shadowIntakeCompose, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'true'/u);
assert.doesNotMatch(shadowIntakeCompose, /KEMERBET_|secrets:|configs:|networks:|volumes:/u);
assert.match(
  shadowReleaseMode,
  /^(receiver-review|shadow-intake)\r?\n$/u,
  'the exact commit must declare one canonical production shadow operation',
);

for (const invariant of [
  /profiles: \[production\]/u,
  /platform: linux\/amd64/u,
  /pull_policy: never/u,
  /user: '10001:10001'/u,
  /restart: unless-stopped/u,
  /read_only: true/u,
  /cap_drop:\s*\r?\n    - ALL/u,
  /no-new-privileges:true/u,
  /pids_limit: 128/u,
  /max-size: 10m/u,
  /max-file: '3'/u,
]) {
  assert.match(compose.slice(0, compose.indexOf('services:')), invariant);
}

const owner = childBlock(services, 'owner-control');
assert.match(owner, /OWNER_CONTROL_DEPLOYMENT_TARGET: production/u);
assert.match(owner, /INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true'/u);
assert.match(owner, /FINANCIAL_ACTIONS_MODE: dry_run/u);
assert.match(owner, /KEMERBET_EXECUTOR_ENABLED: 'false'/u);
assert.match(owner, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u);
assert.match(owner, /INTERNAL_OWNER_CBE_BIRR_LOOKUP_KEY_LOADING_ENABLED: 'true'/u);
assert.match(owner, /INTERNAL_OWNER_CBE_BIRR_V2_RECEIVER_ROTATION_ENABLED: 'true'/u);
assert.match(
  owner,
  /OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_FILE: \/run\/secrets\/owner_cbe_birr_lookup_encryption_master/u,
);
assert.match(
  owner,
  /OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_FILE: \/run\/secrets\/owner_cbe_birr_lookup_fingerprint_master/u,
);
assert.match(
  owner,
  /OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE: \/etc\/fetanagent\/owner-cbe-birr-receiver-lookup-profile\.v2\.json/u,
);
for (const name of ['encryption', 'fingerprint']) {
  assert.match(
    owner,
    new RegExp(
      `source: owner_cbe_birr_lookup_${name}_master\\s+target: owner_cbe_birr_lookup_${name}_master\\s+uid: '10001'\\s+gid: '10001'\\s+mode: 0400`,
      'u',
    ),
  );
}
assert.match(
  owner,
  /source: owner_cbe_birr_lookup_profile\s+target: \/etc\/fetanagent\/owner-cbe-birr-receiver-lookup-profile\.v2\.json\s+uid: '10001'\s+gid: '10001'\s+mode: 0444/u,
);
assert.match(
  owner,
  /source: kemerbet_readiness_control\s+target: \/run\/fetanagent-kemerbet-session-control/u,
);
assert.match(
  owner,
  /source: \/var\/lib\/fetanagent\/kemerbet-readiness-cohort-receipts\s+target: \/run\/fetanagent-kemerbet-readiness-cohort-receipts\s+read_only: true\s+bind:\s+create_host_path: false/u,
);
assert.equal(count(compose, /target: \/run\/fetanagent-kemerbet-session-control/gu), 1);
assert.equal(count(compose, /target: \/run\/fetanagent-kemerbet-readiness-cohort-receipts/gu), 1);
const readinessVolume = childBlock(
  topLevelSection(compose, 'volumes'),
  'kemerbet_readiness_control',
);
assert.match(
  readinessVolume,
  /^\s+external: true\r?\n    name: fetanagent-production-kemerbet-readiness-control-v1\r?\n?/u,
);
assert.match(
  owner,
  /OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID: \$\{FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID:\?/u,
);
assert.match(owner, /OWNER_COMPANION_SERVER_SIGNER_KEY_ID: companion-server-production-v1/u);
assert.match(
  owner,
  /OWNER_ROUTINE_ENROLLMENT_SIGNER_PRIVATE_KEY_FILE: \/run\/secrets\/owner_routine_enrollment_signer_pkcs8/u,
);
assert.match(
  owner,
  /source: owner_routine_enrollment_signer\s+target: owner_routine_enrollment_signer_pkcs8\s+uid: '10001'\s+gid: '10001'\s+mode: 0400/u,
);

const customer = childBlock(services, 'customer-web');
assert.match(customer, /CUSTOMER_WEB_DEPLOYMENT_TARGET: production/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED: 'true'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'false'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED: 'false'/u);

const api = childBlock(services, 'api');
assert.doesNotMatch(compose, /TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_PRODUCTION_ENABLED/u);
assert.match(api, /PLAYER_ACTION_DEPLOYMENT_TARGET: production/u);
assert.match(api, /INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true'/u);
assert.match(api, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true'/u);
assert.match(api, /INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true'/u);
assert.match(api, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'false'/u);
assert.match(api, /TELEGRAM_CBE_BIRR_BOUND_NO_MONEY_PRODUCTION_ENABLED: 'false'/u);
assert.equal(
  count(compose, /TELEGRAM_CBE_BIRR_BOUND_NO_MONEY_PRODUCTION_ENABLED: 'false'/gu),
  1,
  'the production CBE no-money test route must stay disabled',
);
assert.equal(
  count(compose, /TELEGRAM_TELEBIRR_RECEIVER_REVIEW_ENABLED: 'false'/gu),
  1,
  'the live proof-intake review override must be disabled only in the production API service',
);

const bot = childBlock(services, 'bot');
assert.match(bot, /TELEGRAM_BOT_ENABLED: 'true'/u);
assert.match(
  bot,
  /^      BOT_SUPPORT_CONTACT_URL: https:\/\/owner\.fetanagent\.com\/v1\/public\/support-contact\r?$/mu,
  'the production bot must use the exact public support-contact URL',
);
assert.equal(
  count(compose, /\bBOT_SUPPORT_CONTACT_URL\b/gu),
  1,
  'the public support-contact URL must occur only in the bot service',
);
assert.match(bot, /TELEGRAM_BETA_ADMISSION_ENABLED: 'false'/u);
assert.doesNotMatch(bot, /BOT_TO_BETA_ADMISSION_BASE_URL|BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE/u);
assert.match(bot, /BOT_TO_API_INGRESS_ENABLED: 'false'/u);
assert.doesNotMatch(bot, /BOT_TO_API_INGRESS_BASE_URL|BOT_TO_API_INGRESS_HMAC_SECRET/u);
assert.match(bot, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true'/u);
assert.match(bot, /INTERNAL_TELEGRAM_PLAYER_VALIDATION_INTAKE_ENABLED: 'true'/u);
assert.equal(
  count(compose, /\bINTERNAL_TELEGRAM_PLAYER_VALIDATION_INTAKE_ENABLED\b/gu),
  1,
  'automatic Player ID intake must be enabled only for the production bot',
);
assert.match(bot, /condition: service_healthy/u);
assert.match(
  bot,
  /healthcheck:\s*test: \['CMD', 'node', 'apps\/bot\/dist\/telegram-polling-healthcheck\.js'\]/u,
);
assert.match(bot, /interval: 15s\s*timeout: 3s\s*start_period: 45s\s*retries: 3/u);
assert.doesNotMatch(bot, /ports:|api\.telegram\.org/u);

const telebirrAssignment = childBlock(services, 'telebirr-assignment-broker');
const telebirrDeviceState = childBlock(services, 'telebirr-device-state-broker');
const telebirrBridge = childBlock(services, 'telebirr-device-bridge');
for (const [name, service] of [
  ['TeleBirr assignment broker', telebirrAssignment],
  ['TeleBirr device-state broker', telebirrDeviceState],
  ['TeleBirr device bridge', telebirrBridge],
]) {
  assert.match(service, /image: fetanagent-telebirr-[a-z-]+:\$\{FETANAGENT_IMAGE_TAG:\?/u, name);
  assert.match(service, /<<: \*runtime-defaults/u, name);
  assert.match(service, /NODE_ENV: production/u, name);
  assert.match(service, /FINANCIAL_ACTIONS_MODE: dry_run/u, name);
  assert.match(service, /KEMERBET_EXECUTOR_ENABLED: 'false'/u, name);
  assert.match(service, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u, name);
}
assert.match(telebirrAssignment, /TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: production/u);
for (const expression of [
  /TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE: \/run\/secrets\/telebirr_assignment_broker_database_url/u,
  /TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE: \/run\/secrets\/telebirr_assignment_broker_reference_opening_key\.v1\.json/u,
  /TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE: \/run\/secrets\/telebirr_assignment_broker_runtime_manifest\.v1\.json/u,
  /TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE: \/run\/secrets\/telebirr_assignment_broker_signer\.pkcs8\.der/u,
  /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/u,
  /telebirr_assignment_database_egress/u,
]) {
  assert.match(telebirrAssignment, expression);
}
assert.equal(count(telebirrAssignment, /- source: /gu), 5);
assert.doesNotMatch(telebirrAssignment, /ENROLLMENT_ONLY|network_mode: none/u);
assert.match(inertCompose, /^services:\s*$/mu);
const inertApi = childBlock(topLevelSection(inertCompose, 'services'), 'api');
assert.match(inertApi, /^\s+environment:\s*$/mu);
assert.match(inertApi, /TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_PRODUCTION_ENABLED: 'false'/u);
assert.match(inertApi, /TELEGRAM_RECEIVER_SMS_CANDIDATE_PRODUCTION_ENABLED: 'true'/u);
assert.equal(
  count(inertCompose, /TELEGRAM_RECEIVER_SMS_CANDIDATE_PRODUCTION_ENABLED: 'true'/gu),
  1,
);
assert.match(inertCompose, /BOT_RECEIVER_SMS_CANDIDATE_ENABLED: 'true'/u);
assert.doesNotMatch(inertApi, /FINANCIAL_ACTIONS_MODE|KEMERBET_|secrets:|configs:|networks:/u);
assert.match(inertCompose, /^  telebirr-assignment-broker:\s*$/mu);
assert.match(inertCompose, /environment: !override/u);
assert.match(inertCompose, /TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED: 'true'/u);
assert.match(inertCompose, /TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: production/u);
assert.match(inertCompose, /FINANCIAL_ACTIONS_MODE: dry_run/u);
assert.match(inertCompose, /KEMERBET_EXECUTOR_ENABLED: 'false'/u);
assert.match(inertCompose, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u);
assert.match(inertCompose, /INTERNAL_RECEIVER_SMS_BROKER_ENABLED: 'true'/u);
assert.match(inertCompose, /INTERNAL_RECEIVER_SMS_SETTLEMENT_ENABLED: 'true'/u);
assert.match(inertCompose, /INTERNAL_RECEIVER_SMS_BRIDGE_ENABLED: 'true'/u);
assert.match(
  inertCompose,
  /RECEIVER_SMS_DATABASE_URL_FILE: \/run\/secrets\/receiver_sms_ingest_database_url/u,
);
assert.match(inertCompose, /- source: receiver_sms_ingest_database_url/u);
assert.match(inertCompose, /- source: receiver_sms_settlement_database_url/u);
assert.match(inertCompose, /- source: deposit_proof_reference_fingerprint_master/u);
assert.match(inertCompose, /secrets: !override/u);
assert.match(inertCompose, /configs: !override/u);
assert.match(inertCompose, /networks: !override/u);
assert.match(inertCompose, /- telebirr_assignment_database_egress/u);
assert.doesNotMatch(inertCompose, /network_mode: none/u);
assert.doesNotMatch(
  inertCompose,
  /TELEBIRR_ASSIGNMENT_BROKER_(?:DATABASE_URL|REFERENCE_OPENING_KEY|RUNTIME_MANIFEST|SIGNER_PRIVATE_KEY)_FILE|NODE_EXTRA_CA_CERTS/u,
);
assert.equal(count(topLevelSection(inertCompose, 'services'), /^  [a-z][a-z0-9-]*:\s*$/gmu), 4);
assert.doesNotMatch(inertCompose, /INTERNAL_ROUTINE_(?:NO_MONEY|PAID)|routine-paid-settlement:/u);
assert.match(telebirrDeviceState, /TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET: production/u);
assert.match(telebirrDeviceState, /telebirr_device_state_database_egress/u);
assert.match(telebirrBridge, /TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET: production/u);
assert.match(telebirrBridge, /aliases:\s*\r?\n\s*- telebirr-device-bridge/u);
assert.match(telebirrBridge, /telebirr-assignment-broker:[\s\S]*?service_healthy/u);
assert.match(telebirrBridge, /telebirr-device-state-broker:[\s\S]*?service_healthy/u);

const companion = childBlock(services, 'production-companion-device-bridge');
for (const expression of [
  /image: fetanagent-companion-device-bridge:\$\{FETANAGENT_IMAGE_TAG:\?/u,
  /<<: \*runtime-defaults/u,
  /COMPANION_DEVICE_BRIDGE_DEPLOYMENT_TARGET: production/u,
  /COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED: 'true'/u,
  /FINANCIAL_ACTIONS_MODE: dry_run/u,
  /KEMERBET_EXECUTOR_ENABLED: 'false'/u,
  /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u,
  /companion_device_database_egress/u,
])
  assert.match(companion, expression);
assert.doesNotMatch(
  companion,
  /ports:|aliases:|public_application|private_application|OWNER_CONTROL_|SUPABASE_DB_PASSWORD|SERVICE_ROLE|ASSIGNMENT_SIGNER/u,
);
assert.equal(count(companion, /- source: /gu), 4);
assert.match(
  gateway,
  /FETANAGENT_COMPANION_BRIDGE_UPSTREAM: production-companion-device-bridge:8085/u,
);
assert.match(gateway, /production-companion-device-bridge:[\s\S]*?condition: service_healthy/u);

assert.match(gateway, /ports:\s*\r?\n      - '80:80\/tcp'\s*\r?\n      - '443:443\/tcp'/u);
assert.match(gateway, /cap_add:\s*\r?\n      - NET_BIND_SERVICE/u);
assert.match(gateway, /- companion_device_ingress\s*\r?\n      - telebirr_device_ingress/u);
assert.match(gateway, /telebirr-device-bridge:[\s\S]*?condition: service_healthy/u);
assert.match(
  gatewayCaddyfile,
  /@production_receiver_sms_upload \{[\s\S]*?method POST[\s\S]*?path \/v1\/receiver-sms\/events:upload[\s\S]*?application\/vnd\.fetanagent\.receiver-sms-event\.v1\+json[\s\S]*?X-FetanAgent-Deployment-Target\} == "production"/u,
);
assert.match(
  gatewayCaddyfile,
  /handle @production_receiver_sms_upload \{[\s\S]*?max_size 8KiB[\s\S]*?reverse_proxy telebirr-device-bridge:8084/u,
);
assert.doesNotMatch(gateway, /secrets:|docker\.sock/u);

assert.match(compose, /^name: fetanagent-production$/mu);
assert.doesNotMatch(compose, /fetanagent-staging|2026-09-0|shutdown|expires|systemd|timer/iu);
assert.doesNotMatch(compose, /deposit-executor|trusted-telebirr-verifier|target: executor/iu);
assert.equal(count(compose, /KEMERBET_EXECUTOR_ENABLED: 'false'/gu), 8);
assert.equal(count(compose, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/gu), 8);
assert.equal(count(compose, /restart: unless-stopped/gu), 1);

const networks = topLevelSection(compose, 'networks');
assert.match(
  networks,
  /companion_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-companion-device-ingress/u,
);
assert.match(
  networks,
  /telebirr_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-telebirr-device-ingress/u,
);
assert.match(
  networks,
  /telebirr_assignment_database_egress:\s*\r?\n    driver: bridge\s*\r?\n    enable_ipv6: true/u,
);
assert.match(
  networks,
  /telebirr_device_state_database_egress:\s*\r?\n    driver: bridge\s*\r?\n    enable_ipv6: true/u,
);
const configs = topLevelSection(compose, 'configs');
assert.equal(count(configs, /^  [a-z][a-z0-9_]*:\s*$/gmu), 7);
assert.equal(count(configs, /\$\{FETANAGENT_PRODUCTION_SECRET_DIR:\?/gu), 7);
const secrets = topLevelSection(compose, 'secrets');
assert.equal(count(secrets, /^  [a-z][a-z0-9_]*:\s*$/gmu), 33);
assert.equal(count(secrets, /\$\{FETANAGENT_PRODUCTION_SECRET_DIR:\?/gu), 33);
assert.match(
  secrets,
  /owner_routine_enrollment_signer:\s+file: \$\{FETANAGENT_PRODUCTION_SECRET_DIR:\?[^\n]+\}\/owner-routine-enrollment-signer-pkcs8/u,
);
assert.doesNotMatch(secrets, /sb_publishable_|postgresql:\/\/|[0-9a-f]{64}/u);

assert.match(workflow, /^name: Production application runtime$/mu);
assert.match(workflow, /^  workflow_dispatch:$/mu);
assert.doesNotMatch(workflow, /^  (?:push|pull_request|pull_request_target|schedule):/mu);
assert.match(workflow, /^permissions:\s*\r?\n  contents: read$/mu);
assert.match(
  workflow,
  /concurrency:\s*\r?\n  group: fetanagent-production-runtime\s*\r?\n  cancel-in-progress: false/u,
);
assert.match(workflow, /environment: production/u);
assert.match(
  workflow,
  /OWNER_ROUTINE_ENROLLMENT_SIGNER_PKCS8_BASE64URL: \$\{\{ secrets\.OWNER_ROUTINE_ENROLLMENT_SIGNER_PKCS8_BASE64URL \}\}/u,
);
assert.match(
  workflow,
  /TELEBIRR_ROUTINE_RECEIPT_SIGNER_PUBLIC_SPKI_SHA256: \$\{\{ vars\.TELEBIRR_ROUTINE_RECEIPT_SIGNER_PUBLIC_SPKI_SHA256 \}\}/u,
);
assert.match(workflow, /owner-routine-enrollment-signer-pkcs8/u);
for (const name of [
  'OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET',
  'OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET',
]) {
  assert.match(workflow, new RegExp(`secrets\\.${name}`, 'u'));
}
assert.match(workflow, /vars\.OWNER_CBE_BIRR_LOOKUP_PROFILE_V2_JSON/u);
assert.match(workflow, /'cbe_birr_receiver_lookup'/u);
assert.match(
  workflow,
  /PRODUCTION_DATABASE_ADMIN_POOLER_PORT: '6543'/u,
  'short-lived GitHub Actions administration must use the production transaction pooler',
);
assert.equal(
  count(workflow, /PGPORT: \$\{\{ env\.PRODUCTION_DATABASE_ADMIN_POOLER_PORT \}\}/gu),
  19,
  'all deployment preflight, manifest, activation, rollback, and stop steps must share the reviewed administrative pooler route',
);
assert.doesNotMatch(
  workflow,
  /PGPORT: '5432'/u,
  'GitHub-hosted administrative psql must not consume a long-lived session-pooler slot',
);
const runtimeJobs = topLevelSection(workflow, 'jobs');
const ciGate = childBlock(runtimeJobs, 'validate-ci');
const buildJob = childBlock(runtimeJobs, 'build');
const deployJob = childBlock(runtimeJobs, 'deploy');
const operateJob = childBlock(runtimeJobs, 'operate');
assert.match(
  ciGate,
  /if: inputs\.mode == 'deploy' \|\| inputs\.mode == 'deploy-shadow' \|\| inputs\.mode == 'deploy-shadow-intake' \|\| inputs\.mode == 'deploy-inert'/u,
);
assert.match(ciGate, /needs: validate-target/u);
assert.match(ciGate, /actions: read/u);
assert.match(ciGate, /node infra\/operations\/require-production-ci\.mjs/u);
assert.doesNotMatch(ciGate, /secrets\.|environment: production/u);
assert.match(buildJob, /needs: \[validate-target, validate-ci\]/u);
assert.match(
  buildJob,
  /always\(\) && !cancelled\(\) && needs\.validate-target\.result == 'success'/u,
);
assert.match(
  buildJob,
  /inputs\.mode == 'plan'[\s\S]*?inputs\.mode == 'deploy'[\s\S]*?inputs\.mode == 'deploy-shadow'[\s\S]*?inputs\.mode == 'deploy-shadow-intake'[\s\S]*?inputs\.mode == 'deploy-inert'[\s\S]*?needs\.validate-ci\.result == 'success'/u,
);
assert.match(deployJob, /needs: \[validate-target, validate-ci, build\]/u);
assert.match(
  deployJob,
  /if: inputs\.mode == 'deploy' \|\| inputs\.mode == 'deploy-shadow' \|\| inputs\.mode == 'deploy-shadow-intake' \|\| inputs\.mode == 'deploy-inert'/u,
);
assert.match(deployJob, /actions: read/u);
assert.match(deployJob, /node infra\/operations\/require-production-ci\.mjs/u);
assert.equal(
  count(workflow, /shadow_release_mode="\$\(<infra\/production-shadow-release-mode\)"/gu),
  2,
  'the pre-build and protected deploy gates must both read the commit-bound shadow operation',
);
for (const binding of ["'deploy-shadow:receiver-review'", "'deploy-shadow-intake:shadow-intake'"]) {
  assert.equal(
    count(workflow, new RegExp(escapeRegExp(binding), 'gu')),
    2,
    `${binding} must be enforced before build and before protected deployment`,
  );
}
assert.doesNotMatch(
  workflow,
  /'deploy-shadow:shadow-intake'|'deploy-shadow-intake:receiver-review'/u,
  'a production commit must never authorize both shadow operations',
);
assert.equal(
  count(
    workflow,
    /This exact production commit is not bound to the requested shadow operation\./gu,
  ),
  2,
);
assert.ok(
  deployJob.indexOf('node infra/operations/require-production-ci.mjs') <
    deployJob.indexOf('secrets.'),
  'production secrets must not be consumed before the fresh CI recheck',
);
assert.ok(
  deployJob.indexOf('Recheck the commit-bound shadow operation') < deployJob.indexOf('secrets.'),
  'the exact shadow-operation binding must be rechecked before production secrets',
);
const activationStep = deployJob
  .split('      - name: Atomically activate production and switch the public edge')[1]
  ?.split('      - name: ')[0];
assert.ok(activationStep, 'production activation step must exist');
assert.match(activationStep, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
assert.match(
  activationStep,
  /set -euo pipefail\s+node infra\/operations\/require-production-ci\.mjs/u,
);
assert.ok(
  activationStep.indexOf('node infra/operations/require-production-ci.mjs') <
    activationStep.indexOf("echo 'attempted=true'"),
  'the final CI check must precede the activation attempt marker',
);
assert.equal(count(workflow, /node infra\/operations\/require-production-ci\.mjs/gu), 3);
assert.match(operateJob, /needs: validate-target/u);
assert.doesNotMatch(operateJob, /validate-ci|actions: read|require-production-ci/u);
assert.equal(count(workflow, /actions: read/gu), 2);
assert.match(quality, /pnpm audit --prod --audit-level=high/u);
assert.match(quality, /node --test infra\/operations\/require-production-ci\.test\.mjs/u);
assert.match(quality, /node --test infra\/operations\/verify-postgres-scram-secret\.test\.mjs/u);
const dispatchModes =
  /      mode:\s+description:[^\r\n]*\s+required: true\s+default: plan\s+type: choice\s+options:\s+((?:- [a-z-]+\s*)+)/u.exec(
    workflow,
  )?.[1];
assert.ok(dispatchModes, 'production runtime dispatch modes must be explicit');
assert.deepEqual(
  [...dispatchModes.matchAll(/- ([a-z-]+)/gu)].map((match) => match[1]),
  ['plan', 'deploy-inert', 'status', 'stop'],
);
assert.doesNotMatch(workflow, /'deploy:DEPLOY PRODUCTION RUNTIME'/u);
assert.doesNotMatch(workflow, /'deploy-shadow:DEPLOY PRODUCTION SHADOW REVIEW RUNTIME'/u);
assert.doesNotMatch(
  workflow,
  /'deploy-shadow-intake:DEPLOY PRODUCTION SHADOW INTAKE RUNTIME - NO MONEY'/u,
);
assert.match(
  workflow,
  /if \[\[ "\$REQUESTED_MODE" == 'deploy-inert' && "\$sms_mode" != true \]\]; then\s+echo '::error::Only the receiver SMS production overlay may be deployed\.'/u,
);
assert.match(workflow, /'deploy-inert:DEPLOY INERT PRODUCTION RUNTIME'/u);
assert.match(workflow, /confirm_telebirr_pilot_revision_id:/u);
assert.match(workflow, /confirm_telebirr_activation_epoch:/u);
assert.match(
  workflow,
  /confirm_routine_deposit_transport:\s+description:[^\r\n]*\s+required: true\s+default: disabled\s+type: choice\s+options:\s+- disabled\s+- enabled/u,
);
assert.match(
  workflow,
  /"\$REQUESTED_MODE" != 'deploy-inert'[\s\S]*?"\$CONFIRMED_ROUTINE_TRANSPORT" == 'disabled'/u,
);
assert.match(workflow, /Build the exact active production TeleBirr assignment manifest/u);
assert.match(workflow, /if: inputs\.mode == 'deploy'\s+shell: bash/u);
assert.match(workflow, /Build the exact no-money production TeleBirr shadow assignment manifest/u);
assert.match(
  workflow,
  /if: inputs\.mode == 'deploy-shadow' \|\| inputs\.mode == 'deploy-shadow-intake'\s+shell: bash/u,
);
assert.match(workflow, /Prove the exact production payment boundary/u);
assert.match(workflow, /if: inputs\.mode == 'deploy-inert'\s+id: payment_profile\s+shell: bash/u);
assert.match(workflow, /production-inert-runtime-preflight\.sql/u);
assert.match(workflow, /production-cbe-live-runtime-preflight\.sql/u);
assert.match(workflow, /production-cbe-stopped-runtime-preflight\.sql/u);
assert.equal(
  count(
    workflow,
    /cbe-stopped-v1\) preflight=infra\/sql\/production-cbe-stopped-runtime-preflight\.sql/gu,
  ),
  3,
  'the stopped CBE profile must be checked before, immediately before, and after cutover',
);
assert.match(workflow, /production-cbe-live-cutover-idle\.sql/u);
assert.match(workflow, /production-financial-switch-fingerprint\.sql/u);
assert.match(
  workflow,
  /confirm_financial_switch_profile:\s+description:[^\r\n]*\s+required: true\s+default: disabled\s+type: choice\s+options:\s+- disabled\s+- cbe-live-v1\s+- cbe-stopped-v1/u,
);
assert.match(workflow, /DEPLOY SCREENSHOT READER WITH CBE LIVE/u);
assert.match(workflow, /DEPLOY CBE STOPPED PHONE PROOF/u);
assert.match(
  workflow,
  /"\$CONFIRMED_FINANCIAL_PROFILE" == 'cbe-live-v1'[\s\S]*?"\$CONFIRMED_ROUTINE_TRANSPORT" == 'enabled'/u,
);
assert.match(workflow, /"\$CONFIRMED_DATABASE_ROUTE" == 'pooler'/u);
assert.match(
  workflow,
  /steps\.protected\.outputs\.sms_mode == 'true' && inputs\.confirm_financial_switch_profile == 'disabled'/u,
);
assert.match(workflow, /The guarded CBE release requires existing SMS grants and logins/u);
assert.doesNotMatch(workflow, /app\.decide_owner_receiver_sms_old_payment/u);
assert.match(workflow, /false,false,false,false\) echo 'state=disabled'/u);
assert.match(workflow, /true,true,true,true\) echo 'state=enabled'/u);
for (const sql of [cbeLivePreflightSql, cbeStoppedPreflightSql]) {
  assert.match(sql, /app\.decide_owner_receiver_sms_old_payment\(uuid,uuid,text\)/u);
  for (const signature of [
    'app.list_owner_manual_payment_cases(uuid,text,integer,integer)',
    'app.list_owner_receiver_sms_inbox(uuid,integer,integer)',
    'app.decide_owner_manual_payment_case(uuid,uuid,text,text)',
    'app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)',
  ]) {
    assert.ok(sql.includes(signature), `CBE preflight must require ${signature}`);
  }
}
for (const sql of [receiverSmsActivateSql, receiverSmsDisableSql, receiverSmsStopSql]) {
  assert.doesNotMatch(sql, /app\.decide_owner_receiver_sms_old_payment/u);
}
assert.match(workflow, /The guarded CBE release requires the reviewed running predecessor/u);
assert.match(workflow, /Recheck guarded CBE payment state before activation/u);
assert.match(
  workflow,
  /inputs\.confirm_financial_switch_profile == 'cbe-live-v1' \|\| inputs\.confirm_financial_switch_profile == 'cbe-stopped-v1'/u,
);
assert.match(workflow, /Verify the payment switches remained unchanged/u);
assert.match(workflow, /steps\.payment_profile\.outputs\.fingerprint/u);
assert.equal(
  [...workflow.matchAll(/status '0c354ea06ff48c98122181c703467b442b52c1ca'/gu)].length,
  2,
  'both guarded CBE predecessor checks must target the running release',
);
assert.match(workflow, /activate '\$GITHUB_SHA' carry-routine-marker/u);
assert.match(
  helper,
  /readonly CBE_GUARDED_PREDECESSOR_SHA='0c354ea06ff48c98122181c703467b442b52c1ca'/u,
);
assert.match(helper, /handoff_routine_marker\(\)/u);
assert.match(helper, /restore_routine_marker_for_rollback\(\)/u);
assert.match(helper, /pending-\$sha\.routine-marker/u);
assert.match(
  helper,
  /if \[\[ "\$carry_routine_marker" == true \]\]; then\s+handoff_routine_marker/u,
);
assert.match(helper, /restore_routine_marker_for_rollback "\$sha" "\$previous"/u);
assert.match(quality, /sudo bash infra\/operations\/test-production-routine-marker-handoff\.sh/u);
assert.ok(
  helper.indexOf('rm -f -- "$STATE_ROOT/pending-$sha.previous"') <
    helper.indexOf('rm -f -- "$routine_receipt"'),
  'the handoff receipt must survive every fallible finalize cleanup step',
);
assert.ok(
  workflow.indexOf('Prove the exact production payment boundary') <
    workflow.indexOf('Transfer and install the sealed release'),
);
assert.ok(
  workflow.indexOf('Recheck CBE-live payment state before activation') <
    workflow.indexOf('Atomically activate production and switch the public edge'),
);
assert.ok(
  workflow.indexOf('Verify the payment switches remained unchanged') <
    workflow.indexOf('Attest and finalize the production cutover'),
);
assert.match(workflow, /runtime_deployment_mode='inert-maintenance'/u);
assert.match(
  workflow,
  /deploy-shadow\)\s+runtime_deployment_mode='shadow-review'\s+shadow_overlay_source='infra\/compose\.production\.shadow-review\.yaml'/u,
);
assert.match(
  workflow,
  /deploy-shadow-intake\)\s+runtime_deployment_mode='shadow-review'\s+shadow_overlay_source='infra\/compose\.production\.shadow-intake\.yaml'/u,
);
assert.match(workflow, /runtime-deployment-mode/u);
assert.match(workflow, /compose\.production\.shadow-review\.yaml/u);
assert.match(workflow, /compose\.production\.shadow-intake\.yaml/u);
assert.match(
  workflow,
  /install -m 0600 -- "\$shadow_overlay_source"[\s\S]*?"\$RUNNER_TEMP\/release\/compose\.production\.shadow-review\.yaml"/u,
);
assert.match(
  workflow,
  /cmp --silent -- "\$shadow_overlay_source"[\s\S]*?"\$RUNNER_TEMP\/release\/compose\.production\.shadow-review\.yaml"/u,
);
assert.equal(
  count(workflow, /"\$RUNNER_TEMP\/release\/compose\.production\.shadow-review\.yaml"/gu),
  3,
  'the selected shadow contract must be created, compared, and transferred exactly once',
);
assert.match(workflow, /compose\.production\.inert-maintenance\.yaml/u);
assert.match(workflow, /production-telebirr-assignment-runtime-input\.sql/u);
assert.match(workflow, /production-telebirr-shadow-assignment-runtime-input\.sql/u);
assert.match(workflow, /build-telebirr-assignment-runtime-manifest\.mjs/u);
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
assert.match(workflow, /"\$CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /"\$CONFIRMED_PROJECT" != "\$STAGING_PROJECT_REF"/u);
assert.match(workflow, /Verify restricted server boundary and storage/u);
assert.match(workflow, /current-state/u);
assert.match(workflow, /Verify the existing continuous least-privilege production credentials/u);
assert.doesNotMatch(deployJob, /production-nonfinancial-runtimes-provision\.sql/u);
assert.match(workflow, /steps\.boundary\.outputs\.current_state == 'absent'/u);
assert.match(
  workflow,
  /steps\.protected\.outputs\.sms_mode == 'true' && steps\.boundary\.outputs\.current_state == 'absent'/u,
);
assert.match(workflow, /production-stopped-sms-runtime-restore\.sql/u);
assert.match(workflow, /production-companion-bridge-runtime-enable-continuous\.sql/u);
assert.match(workflow, /steps\.stopped_recovery\.outputs\.attempted == 'true'/u);
assert.match(workflow, /select count\(\*\) = 5 and pg_catalog\.bool_and\(/u);
assert.match(workflow, /select count\(\*\) = 1 and pg_catalog\.bool_and\(not rolcanlogin\)/u);
assert.match(workflow, /\[\[ "\$no_money" == true \]\]/u);
assert.doesNotMatch(
  workflow,
  /\[\[ "\$no_money" == true && "\$paid_poll" == true && "\$paid_settlement" == true \]\]/u,
);
assert.match(workflow, /select count\(\*\) = 1 and pg_catalog\.bool_and\(/u);
assert.match(workflow, /where role\.rolname = 'fetanagent_routine_telebirr_no_money_runtime'/u);
assert.match(stoppedSmsRestoreSql, /mode = 'disabled' and settings = '\{\}'::jsonb/u);
assert.match(stoppedSmsRestoreSql, /where singleton and not enabled\)/u);
assert.doesNotMatch(stoppedSmsRestoreSql, /not enabled and cutover_at is null/u);
assert.match(stoppedSmsRestoreSql, /pg_catalog\.pg_terminate_backend\(pid, 1000\)/u);
assert.match(stoppedSmsRestoreSql, /count\(\*\) = 5 and pg_catalog\.bool_and\(rolcanlogin/u);
assert.doesNotMatch(
  stoppedSmsRestoreSql,
  /alter role fetanagent_(?:beta_admission|routine_telebirr_paid|routine_telebirr_no_money|receiver_sms)/u,
);
assert.match(workflow, /psql_with_connection_retry\(\)/u);
assert.match(workflow, /for attempt in 1 2 3 4; do/u);
assert.match(workflow, /"\$status" -eq 2 && "\$attempt" -lt 4/u);
assert.match(workflow, /sleep "\$\(\(attempt \* 2\)\)"/u);
assert.equal(count(workflow, /psql_with_connection_retry -X/gu), 5);
assert.doesNotMatch(workflow, /assignment_login_ready=false/u);
assert.doesNotMatch(workflow, /PGPORT=5432/u);
assert.match(workflow, /from pg_catalog\.pg_authid/u);
assert.match(workflow, /rolconnlimit = 1/u);
assert.match(workflow, /verify-postgres-scram-secret\.mjs/u);
assert.match(workflow, /POSTGRES_SCRAM_SECRET="\$TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_PASSWORD"/u);
assert.match(postgresScramVerifier, /pbkdf2Sync\(secret, salt, iterations, 32, 'sha256'\)/u);
assert.match(postgresScramVerifier, /update\('Client Key'\)/u);
assert.match(postgresScramVerifier, /update\('Server Key'\)/u);
assert.match(postgresScramVerifier, /timingSafeEqual\(storedKey, expectedStoredKey\)/u);
assert.doesNotMatch(postgresScramVerifier, /console\.|process\.stdout|process\.stderr/u);
assert.match(workflow, /Atomically activate production and switch the public edge/u);
assert.match(workflow, /Verify live public production services/u);
const routineTransportGate = workflow.indexOf('Verify requested signed Windows routine transport');
assert.ok(
  routineTransportGate >
    workflow.indexOf('Atomically activate production and switch the public edge'),
);
assert.ok(routineTransportGate < workflow.indexOf('Attest and finalize the production cutover'));
assert.match(workflow, /enabled\) expected_status=400/u);
assert.match(workflow, /disabled\) expected_status=503/u);
assert.match(workflow, /"\$status" == "\$expected_status"/u);
assert.match(workflow, /Private production control/u);
assert.match(workflow, /Attest and finalize the production cutover/u);
assert.match(workflow, /Roll back a failed production activation/u);
assert.match(workflow, /PREVIOUS_PRODUCTION_STATE/u);
assert.match(workflow, /cleanup-incoming/u);
assert.match(workflow, /production-nonfinancial-runtimes-disable\.sql/u);
assert.doesNotMatch(workflow, /^  schedule:|2026-09-0|systemctl|service[_-]?role/imu);
assert.doesNotMatch(workflow, /echo[^\r\n]*(?:PASSWORD|TOKEN|PRIVATE_KEY)/u);
assert.match(workflow, /confirm_database_route:[\s\S]*?default: pooler[\s\S]*?- direct/u);
assert.match(workflow, /direct\) \[\[ "\$REQUESTED_MODE" == 'deploy-inert' \]\]/u);
assert.match(workflow, /runtime_database_host="\$PRODUCTION_DATABASE_DIRECT_HOST"/u);
assert.match(workflow, /runtime_role_suffix=''/u);
assert.match(workflow, /runtime_database_host="\$PRODUCTION_DATABASE_POOLER_HOST"/u);
assert.match(workflow, /steps\.protected\.outputs\.sms_mode.*'true'/u);
assert.match(workflow, /psql-over-production-direct-tunnel\.sh/u);
assert.match(workflow, /printf '%s\\n' "\$SECRET_DIR" >>"\$GITHUB_PATH"/u);
assert.match(workflow, /production-inert-runtime-preflight\.sql/u);
assert.match(workflow, /Direct database recovery is allowed only for stopped production/u);
assert.ok(
  workflow.indexOf('Verify the stopped direct database route before any production SQL') <
    workflow.indexOf('Prove the exact production payment boundary'),
);
assert.ok(
  workflow.indexOf('[[ "$host_state" == \'absent\' ]]') <
    workflow.indexOf('Activate exact SMS grants and short-lived runtime logins'),
);
assert.match(
  directSqlTunnel,
  /PGHOST="\$direct_host" PGHOSTADDR=127\.0\.0\.1 PGPORT=55432 PGUSER=postgres/u,
);
assert.match(directSqlTunnel, /StrictHostKeyChecking=yes/u);
assert.match(directSqlTunnel, /UserKnownHostsFile="\$FETANAGENT_DIRECT_DB_KNOWN_HOSTS"/u);
assert.match(directSqlTunnel, /\[\[ "\$\{PGSSLMODE:-\}" == 'verify-full'/u);
assert.doesNotMatch(directSqlTunnel, /echo[^\n]*(?:PGPASSWORD|DATABASE_URL)/u);
assert.doesNotMatch(
  deployJob,
  /postgresql:\/\/[^\r\n]*\$PRODUCTION_DATABASE_ADMIN_POOLER_PORT/u,
  'deployed runtime DSNs must remain on their dedicated session-pooler route',
);
for (const roleVariable of [
  'OWNER_RUNTIME_ROLE',
  'CUSTOMER_WEB_RUNTIME_ROLE',
  'PLAYER_ACTION_RUNTIME_ROLE',
]) {
  assert.match(
    workflow,
    new RegExp(
      `"\\$${roleVariable}\\$runtime_role_suffix"[\\s\\S]*?"\\$runtime_database_host" >"\\$secret_dir/`,
      'u',
    ),
  );
}
for (const target of [
  'companion-device-bridge',
  'telebirr-assignment-broker',
  'telebirr-device-state-broker',
  'telebirr-device-bridge',
]) {
  assert.match(workflow, new RegExp(`docker build[\\s\\S]*?${target}`, 'u'));
  assert.match(workflow, new RegExp(`fetanagent-${target}:\\$tag`, 'u'));
}
for (const protectedName of [
  'TELEBIRR_ASSIGNMENT_SIGNER_ID',
  'TELEBIRR_ASSIGNMENT_SIGNER_PKCS8_BASE64',
  'TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_BASE64',
  'TELEBIRR_BRIDGE_SERVER_SIGNER_PKCS8_BASE64',
  'TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_V1_BASE64',
  'derive-telebirr-reference-opening-key.mjs',
  'telebirr-assignment-database-url',
  'telebirr-assignment-runtime-manifest.v1.json',
  'telebirr-assignment-signer.pkcs8.der',
  'telebirr-reference-opening-key.v1.json',
  'telebirr-device-state-database-url',
]) {
  assert.match(workflow, new RegExp(escapeRegExp(protectedName), 'u'));
}
assert.match(
  workflow,
  /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full' \\\s*"\$ASSIGNMENT_RUNTIME_ROLE\$runtime_role_suffix"[\s\S]*?"\$runtime_database_host"/u,
);
assert.match(
  workflow,
  /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full' \\\s*"fetanagent_telebirr_device_state_runtime\$runtime_role_suffix"[\s\S]*?"\$runtime_database_host"/u,
);
assert.doesNotMatch(
  workflow,
  /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full\\n' \\\s*"fetanagent_telebirr_device_state_runtime\$runtime_role_suffix"/u,
);
assert.match(workflow, /secrets\.TELEBIRR_ASSIGNMENT_SIGNER_PKCS8_BASE64/u);
assert.doesNotMatch(workflow, /secrets\.TELEBIRR_REFERENCE_OPENING_KEY_V2_BASE64/u);
assert.doesNotMatch(workflow, /vars\.TELEBIRR_REFERENCE_OPENING_KEY_ID/u);
assert.match(
  workflow,
  /derive-telebirr-reference-opening-key\.mjs[\s\S]*?deposit-proof-reference-encryption-master[\s\S]*?telebirr-reference-opening-key\.v1\.json/u,
);
assert.match(
  workflow,
  /TELEBIRR_REFERENCE_OPENING_KEY_ID: \$\{\{ steps\.protected\.outputs\.telebirr_reference_opening_key_id \}\}/u,
);
assert.match(referenceOpeningDeriver, /createHmac\('sha256', master\)/u);
assert.match(
  referenceOpeningDeriver,
  /fetanagent:deposit-proof-reference:encryption-key:v2\\nprovider:telebirr/u,
);
assert.match(referenceOpeningDeriver, /purpose: 'deposit-proof-reference-opening'/u);
assert.match(referenceOpeningDeriver, /writeFileSync\(outputPath, document,[\s\S]*?flag: 'wx'/u);

for (const action of [
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
  'actions/download-artifact',
]) {
  assert.match(workflow, new RegExp(`${escapeRegExp(action)}@[0-9a-f]{40}`, 'u'));
}
for (const secret of [
  'SUPABASE_DB_PASSWORD',
  'PRODUCTION_SUPABASE_PUBLISHABLE_KEY',
  'PRODUCTION_TELEGRAM_BOT_TOKEN',
  'PRODUCTION_VM_HOST',
  'PRODUCTION_VM_KNOWN_HOSTS',
  'PRODUCTION_VM_SSH_PRIVATE_KEY',
]) {
  assert.match(workflow, new RegExp(`secrets\\.${secret}`, 'u'));
}

assert.match(helper, /^set -euo pipefail$/mu);
assert.match(helper, /\[\[ "\$\(id -u\)" == '0' \]\]/u);
assert.match(helper, /readonly ROOT='\/srv\/fetanagent\/production'/u);
assert.match(
  helper,
  /readonly HELPER_PATH='\/usr\/local\/sbin\/fetanagent-production-deploy-helper-v2'/u,
);
assert.match(helper, /sha256sum "\$HELPER_PATH"/u);
assert.match(helper, /negative_receiver_sms_public_smoke\(\)/u);
assert.ok(
  helper.includes(
    'fetanagent_routine_deposit_broker_runtime\\.xzztugbgtulptnbpoelr:[0-9a-f]{64}@aws-0-eu-west-1\\.pooler\\.supabase\\.com:5432/postgres\\?sslmode=verify-full$',
  ),
);
assert.ok(
  helper.includes(
    'fetanagent_routine_deposit_broker_runtime:[0-9a-f]{64}@db\\.xzztugbgtulptnbpoelr\\.supabase\\.co:5432/postgres\\?sslmode=verify-full$',
  ),
);
assert.equal(count(helper, /negative_receiver_sms_public_smoke "\$release"/gu), 2);
assert.match(helper, /release_deployment_mode\(\)/u);
assert.match(helper, /operational\|shadow-review\|inert-maintenance/u);
assert.match(helper, /verify_api_financial_mode_for_release\(\)/u);
assert.match(helper, /shadow-review\) expected='dry_run'/u);
assert.match(helper, /operational\|inert-maintenance\) expected='live'/u);
assert.match(
  helper,
  /FINANCIAL_ACTIONS_MODE=\/\/p[\s\S]*?the production API financial mode does not match the sealed deployment mode/u,
);
assert.equal(count(helper, /verify_api_financial_mode_for_release "\$release"/gu), 2);
assert.match(
  helper,
  /compose_files\+=\(--file "\$release\/compose\.production\.shadow-review\.yaml"\)/u,
);
assert.doesNotMatch(helper, /shadow-intake|compose\.production\.shadow-intake\.yaml/u);
assert.match(
  helper,
  /compose_files\+=\(--file "\$release\/compose\.production\.inert-maintenance\.yaml"\)/u,
);
assert.match(helper, /current-state\)/u);
assert.match(helper, /check-release-mode\)/u);
assert.match(helper, /the exact commit is sealed in another deployment mode/u);
assert.match(workflow, /check-release-mode '\$GITHUB_SHA' '\$runtime_deployment_mode'/u);
assert.ok(
  workflow.indexOf("check-release-mode '$GITHUB_SHA' '$runtime_deployment_mode'") <
    workflow.indexOf(
      '- name: Verify the existing continuous least-privilege production credentials',
    ),
  'release-mode conflicts must fail before credential provisioning or release transfer',
);
assert.match(helper, /cleanup-incoming\)/u);
assert.match(helper, /rollback_transition/u);
assert.match(helper, /flock --nonblock 9/u);
assert.match(
  helper,
  /preflight\|prepare-incoming\|cleanup-incoming\|install\|activate\|finalize\|rollback\|stop\|check-rollback\)\s+acquire_operation_lock/u,
);
const rollbackTransition = helper.split('\nrollback_transition() {')[1]?.split('\n}\n')[0];
assert.ok(rollbackTransition, 'rollback transition must exist');
assert.ok(
  rollbackTransition.indexOf('validate_rollback_transition "$sha" "$release"') <
    rollbackTransition.indexOf('compose_release "$release" down'),
  'the complete pending transition must be validated before stopping production',
);
assert.match(helper, /stale rollback refused: production is outside this pending transition/u);
assert.match(
  helper,
  /stale rollback refused: a production container is outside this pending transition/u,
);
assert.match(
  helper,
  /check-rollback\)\s+[\s\S]*?validate_rollback_transition "\$sha" "\$release"/u,
);
const disableStagingBotToken = helper
  .split('\ndisable_staging_bot_token() {')[1]
  ?.split('\n}\n')[0];
assert.ok(disableStagingBotToken, 'the staging Telegram token disable boundary must exist');
for (const contract of [
  /container_for "\$STAGING_PROJECT" bot/u,
  /the staging Telegram bot must be stopped before disabling its token/u,
  /10001:10001:400:1/u,
  /telegram-disabled-until-separate-smoke/u,
  /sync -f "\$STAGING_BOT_TOKEN"/u,
]) {
  assert.match(disableStagingBotToken, contract);
}
assert.ok(
  rollbackTransition.indexOf('stop_if_running "$(container_for "$STAGING_PROJECT" bot)"') <
    rollbackTransition.indexOf('compose_release "$previous" up'),
  'rollback must stop the staging poller before restoring a production predecessor',
);
assert.ok(
  rollbackTransition.indexOf('mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"') <
    rollbackTransition.indexOf('disable_staging_bot_token'),
  'rollback must restore production before disabling the staging token',
);
const activateTransition = /\n  activate\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(activateTransition, 'production activation must exist');
assert.ok(
  activateTransition.indexOf('stop_if_running "$(container_for "$STAGING_PROJECT" bot)"') <
    activateTransition.indexOf('up --detach --no-build --wait --wait-timeout 120 bot gateway'),
  'every production activation must stop the staging poller before starting the production bot',
);
const finalizeTransition = /\n  finalize\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(finalizeTransition, 'production finalization must exist');
assert.ok(
  finalizeTransition.indexOf('stop_if_running "$(container_for "$STAGING_PROJECT" bot)"') <
    finalizeTransition.indexOf('disable_staging_bot_token'),
  'production finalization must stop the staging poller before disabling its token',
);
assert.match(helper, /chown 10001:10001 "\$incoming\/secrets"\/\*/u);
assert.match(helper, /'10001:10001:400'/u);
assert.match(helper, /'0:0:444'/u);
assert.match(helper, /compose_release "\$release" up --detach --no-build --wait/u);
assert.match(helper, /Private production control/u);
assert.match(helper, /quiesce_legacy_telebirr_bridge/u);
assert.match(helper, /restore_legacy_telebirr_bridge/u);
assert.match(helper, /negative_telebirr_public_smoke/u);
assert.match(helper, /negative_companion_public_smoke/u);
assert.match(helper, /start_release_services_with_session_handoff_retry\(\)/u);
assert.match(helper, /for attempt in 1 2 3; do/u);
assert.match(helper, /sleep "\$\(\(attempt \* 5\)\)"/u);
assert.match(
  helper,
  /start_release_services_with_session_handoff_retry "\$release" "\$\{core_services\[@\]\}"/u,
);
assert.match(
  helper,
  /start_release_services_with_session_handoff_retry "\$release" production-companion-device-bridge/u,
);
const transferBlock = /transfer_files=\(\n([\s\S]*?)\n          \)/u.exec(workflow)?.[1];
assert.ok(transferBlock, 'the production transfer inventory must exist');
const operationalTransferBlock =
  /deploy\|deploy-shadow\|deploy-shadow-intake\)\n\s+transfer_files\+=\(\n([\s\S]*?)\n\s+\)\n\s+;;/u.exec(
    workflow,
  )?.[1];
const inertTransferBlock =
  /deploy-inert\)\s+if \[\[ '\$\{\{ steps\.protected\.outputs\.sms_mode \}\}' == 'true' \]\]; then\s+transfer_files\+=\(\n([\s\S]*?)\n\s+\)\n\s+if \[\[ '\$\{\{ steps\.protected\.outputs\.routine_proof_mode \}\}' == 'true' \]\]; then/u.exec(
    workflow,
  )?.[1];
const inertProofTransferBlock =
  /if \[\[ '\$\{\{ steps\.protected\.outputs\.routine_proof_mode \}\}' == 'true' \]\]; then\s+transfer_files\+=\(\n([\s\S]*?)\n\s+\)\n\s+fi\n\s+else/u.exec(
    workflow,
  )?.[1];
assert.ok(operationalTransferBlock, 'the operational transfer inventory must exist');
assert.ok(inertTransferBlock, 'the inert transfer inventory must exist');
assert.ok(inertProofTransferBlock, 'the CBE-stopped proof transfer inventory must exist');
const transferredNames = (block) =>
  block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const expansion = /\{([^}]+)\}/u.exec(line)?.[1];
      return expansion
        ? expansion.split(',')
        : [line.replace(/\\$/u, '').trim().replaceAll('"', '').split('/').at(-1)];
    });
const baseTransferNames = transferredNames(transferBlock);
assert.ok(baseTransferNames.includes('bot-screenshot-reference-model-access-key'));
assert.match(compose, /BOT_SCREENSHOT_REFERENCE_READER_ENABLED: 'true'/u);
assert.match(
  compose,
  /BOT_SCREENSHOT_REFERENCE_MODEL_ACCESS_KEY_FILE: \/run\/secrets\/bot_screenshot_reference_model_access_key/u,
);
assert.match(workflow, /secrets\.PRODUCTION_SCREENSHOT_MODEL_ACCESS_KEY/u);
assert.match(helper, /required\+=\(bot-screenshot-reference-model-access-key\)/u);
const operationalTransferNames = [
  ...baseTransferNames,
  ...transferredNames(operationalTransferBlock),
];
const inertTransferNames = [...baseTransferNames, ...transferredNames(inertTransferBlock)];
const inertProofTransferNames = [
  ...inertTransferNames,
  ...transferredNames(inertProofTransferBlock),
];
assert.equal(new Set(operationalTransferNames).size, operationalTransferNames.length);
assert.equal(new Set(inertTransferNames).size, inertTransferNames.length);
assert.equal(new Set(inertProofTransferNames).size, inertProofTransferNames.length);
const coreRequiredBlock = /local -a required=\(\n([\s\S]*?)\n  \)/u.exec(helper)?.[1];
assert.ok(coreRequiredBlock, 'the helper required-secret inventory must exist');
for (const name of coreRequiredBlock.split('\n').map((line) => line.trim())) {
  assert.ok(baseTransferNames.includes(name), `production transfer omits required file ${name}`);
}
const helperBaseCount = Number(
  /local_count="\$\(find[^\n]+\n    expected_count=(\d+)/u.exec(helper)?.[1],
);
const helperCountBlock =
  /local_count="\$\(find[\s\S]*?\[\[ "\$local_count" -eq "\$expected_count"/u.exec(helper)?.[0];
assert.ok(helperCountBlock, 'the helper bundle count gate must exist');
const [
  ownerDisplayFiles,
  screenshotFiles,
  betaFiles,
  operationalFiles,
  routineFiles,
  paidPollFiles,
  paidSettlementFiles,
  combinedSmsFiles,
  smsFiles,
  companionFiles,
] = [...helperCountBlock.matchAll(/expected_count=\$\(\(expected_count \+ (\d+)\)\)/gu)].map(
  (match) => Number(match[1]),
);
assert.equal(ownerDisplayFiles, 1);
assert.equal(screenshotFiles, 1);
assert.ok(betaFiles > 0, 'legacy beta rollback accounting must remain explicit');
assert.match(compose, /^  production-companion-device-bridge:/mu);
assert.match(inertCompose, /INTERNAL_RECEIVER_SMS_BROKER_ENABLED: 'true'/u);
assert.match(inertCompose, /INTERNAL_RECEIVER_SMS_SETTLEMENT_ENABLED: 'true'/u);
assert.equal(
  helperBaseCount + ownerDisplayFiles + screenshotFiles + operationalFiles + companionFiles,
  operationalTransferNames.length,
  'the helper operational bundle count must match the flattened workflow transfer',
);
assert.equal(
  helperBaseCount + ownerDisplayFiles + screenshotFiles + smsFiles + companionFiles,
  inertTransferNames.length,
  'the helper inert bundle count must match the flattened workflow transfer',
);
assert.equal(
  helperBaseCount +
    ownerDisplayFiles +
    screenshotFiles +
    routineFiles +
    combinedSmsFiles +
    companionFiles,
  inertProofTransferNames.length,
  'the helper CBE-stopped proof bundle count must match the flattened workflow transfer',
);
assert.equal(routineFiles + paidPollFiles + paidSettlementFiles, 6);
assert.equal(smsFiles, 2);
assert.equal(combinedSmsFiles, 2);
assert.match(helper, /if grep -Fq '  beta-admission:' "\$incoming\/compose\.production\.yaml"/u);
assert.match(helper, /owner-cbe-birr-receiver-lookup-profile\.v2\.json/u);
assert.match(helper, /owner-routine-enrollment-signer-pkcs8/u);
assert.match(helper, /expected_count=\$\(\(expected_count \+ 4\)\)/u);
assert.equal((helper.match(/expected_count=\$\(\(expected_count \+ 4\)\)/gu) ?? []).length, 3);
assert.match(
  helper,
  /elif grep -Fq "INTERNAL_ROUTINE_NO_MONEY_BROKER_ENABLED: 'true'"[\s\S]*?routine-no-money-database-url[\s\S]*?routine-no-money-lookup-signer\.pkcs8\.der[\s\S]*?routine-no-money-lookup-signer\.v1\.json[\s\S]*?telebirr-reference-opening-key\.v1\.json/u,
);
assert.match(helper, /expected_count=\$\(\(expected_count \+ 5\)\)/u);
assert.match(helper, /expected_count=\$\(\(expected_count \+ 1\)\)/u);
assert.match(helper, /routine-paid-poll-database-url/u);
assert.match(helper, /routine-paid-settlement-database-url/u);
assert.match(helper, /services\+=\(routine-paid-settlement\)/u);
assert.match(helper, /routine-paid-settlement\s*$/mu);
assert.match(
  helper,
  /required\+=\(receiver-sms-ingest-database-url receiver-sms-settlement-database-url\)/u,
);
assert.match(workflow, /--file=infra\/sql\/production-receiver-sms-runtimes-activate\.sql/u);
assert.match(workflow, /--file=infra\/sql\/production-receiver-sms-runtimes-disable\.sql/u);
assert.match(workflow, /--file=infra\/sql\/production-receiver-sms-runtimes-stop\.sql/u);
assert.match(workflow, /steps\.sms_previous\.outputs\.state == 'disabled'/u);
const smsEnabledState = workflow.match(
  /^\s*(true(?:,true)+)\) echo 'state=enabled' >>"\$GITHUB_OUTPUT"/mu,
)?.[1];
assert.equal(smsEnabledState, 'true,true,true,true');
assert.ok(workflow.includes(`[[ "$state" == '${smsEnabledState}' ]]`));
for (const role of ['ingest', 'settlement']) {
  assert.match(
    receiverSmsActivateSql,
    new RegExp(`alter role fetanagent_receiver_sms_${role}_runtime\\s+login password :`, 'u'),
  );
  assert.match(
    receiverSmsDisableSql,
    new RegExp(`alter role fetanagent_receiver_sms_${role}_runtime nologin`, 'u'),
  );
  assert.match(
    receiverSmsStopSql,
    new RegExp(`alter role fetanagent_receiver_sms_${role}_runtime\\s+nologin`, 'u'),
  );
}
assert.match(receiverSmsActivateSql, /count\(\*\) = 7 from app\.feature_switches/u);
assert.match(receiverSmsActivateSql, /not control\.enabled/u);
assert.match(receiverSmsDisableSql, /not control\.enabled/u);
for (const sql of [receiverSmsActivateSql, receiverSmsDisableSql, receiverSmsStopSql]) {
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?app\./iu);
}
assert.match(
  workflow,
  /ROUTINE_PAID_POLL_RUNTIME_PASSWORD: \$\{\{ secrets\.ROUTINE_PAID_POLL_RUNTIME_PASSWORD \}\}/u,
);
assert.match(workflow, /--file=infra\/sql\/production-routine-paid-poll-activate\.sql/u);
assert.match(workflow, /-v expected_cbe_mode=disabled/u);
assert.match(workflow, /--file=infra\/sql\/production-routine-paid-poll-disable\.sql/u);
assert.match(workflow, /"\$SECRET_DIR"\/routine-paid-poll-database-url/u);
assert.match(
  workflow,
  /ROUTINE_PAID_SETTLEMENT_RUNTIME_PASSWORD: \$\{\{ secrets\.ROUTINE_PAID_SETTLEMENT_RUNTIME_PASSWORD \}\}/u,
);
assert.match(workflow, /--file=infra\/sql\/production-routine-paid-settlement-activate\.sql/u);
assert.match(workflow, /--file=infra\/sql\/production-routine-paid-settlement-disable\.sql/u);
assert.match(workflow, /"\$SECRET_DIR"\/routine-paid-settlement-database-url/u);
assert.match(
  paidPollActivateSql,
  /alter role fetanagent_routine_telebirr_paid_poll_runtime\s+login password :'runtime_password' valid until :'valid_until'/u,
);
for (const sql of [paidPollActivateSql, paidSettlementActivateSql]) {
  assert.match(sql, /:'expected_cbe_mode' in \('disabled', 'live'\)/u);
  assert.match(sql, /count\(\*\) = 7/u);
  assert.match(sql, /switch\.feature_key = 'cbe_birr_authoritative_verification'/u);
  assert.match(sql, /switch\.feature_key <> 'cbe_birr_authoritative_verification'/u);
  assert.match(sql, /\) = 6 as exact_stopped_switch_profile/u);
  assert.match(sql, /\\if :exact_stopped_switch_profile/u);
}
assert.match(paidPollActivateSql, /count\(\*\) = 4 and pg_catalog\.bool_and/u);
assert.doesNotMatch(
  paidPollActivateSql,
  /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?app\./iu,
);
assert.match(paidPollDisableSql, /nologin password null valid until '1970-01-01 00:00:00\+00'/u);
assert.match(
  paidSettlementActivateSql,
  /alter role fetanagent_routine_telebirr_paid_settlement_runtime\s+login password :'runtime_password' valid until :'valid_until'/u,
);
assert.match(paidSettlementActivateSql, /count\(\*\) = 2 and pg_catalog\.bool_and/u);
assert.match(
  paidSettlementDisableSql,
  /nologin password null valid until '1970-01-01 00:00:00\+00'/u,
);
assert.match(helper, /the inert production bundle unexpectedly contains \$name/u);
assert.match(helper, /runtime-deployment-mode/u);
assert.match(helper, /compose\.production\.shadow-review\.yaml/u);
assert.match(helper, /compose\.production\.inert-maintenance\.yaml/u);
for (const protectedFile of [
  'telebirr-assignment-database-url',
  'telebirr-assignment-runtime-manifest.v1.json',
  'telebirr-assignment-signer.pkcs8.der',
  'telebirr-reference-opening-key.v1.json',
]) {
  assert.match(helper, new RegExp(escapeRegExp(protectedFile), 'u'));
}
assert.match(helper, /images\+=\(companion-device-bridge\)/u);
assert.match(helper, /services\+=\(production-companion-device-bridge\)/u);
assert.match(
  helper,
  /if grep -Fq 'apps\/bot\/dist\/telegram-polling-healthcheck\.js' "\$release\/compose\.production\.yaml"; then[\s\S]*?die 'the Telegram bot has no recent successful polling check'/u,
);
assert.match(helper, /Legacy release: Telegram polling health is unverified/u);
assert.match(helper, /LEGACY_TELEBIRR_PROJECT='fetanagent-telebirr-device-pilot'/u);
assert.match(helper, /finalize\)/u);
assert.doesNotMatch(helper, /curl[^\r\n]*-k\b|StrictHostKeyChecking=no|2026-09-0/u);

const helperDigest = createHash('sha256').update(helper.replace(/\r\n/gu, '\n')).digest('hex');
assert.match(
  cbeStoppedHelperRotation,
  /readonly PREDECESSOR_SHA256='08fb54031bf6f1e11306c3ad1cd1f067fe39c6928b8baf944fdea60c0fdefe64'/u,
);
assert.match(cbeStoppedHelperRotation, /readonly EXPECTED_DROPLET_ID='593344964'/u);
assert.match(cbeStoppedHelperRotation, /readonly SOURCE_REVIEW='cbe-stopped-companion-repair-v2'/u);
assert.match(
  cbeStoppedHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='5c7943a96e4d895aaf5401680fabc6e1dd51a60b'/u,
);
assert.match(
  cbeStoppedHelperRotation,
  /readonly SUCCESSOR_SHA256='c43a22ccf97121f79c9b02183cb862b9db860c1f281d090978d135b3436a9402'/u,
);
assert.match(cbeStoppedHelperRotation, /require_current_release/u);
assert.match(cbeStoppedHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(
  cbeStoppedPhoneProofHelperRotation,
  /readonly PREDECESSOR_SHA256='c43a22ccf97121f79c9b02183cb862b9db860c1f281d090978d135b3436a9402'/u,
);
assert.match(
  cbeStoppedPhoneProofHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='0c78afd0cf706ce8c351c50134a9ac0aaf4ff48d'/u,
);
assert.match(
  cbeStoppedPhoneProofHelperRotation,
  /readonly SUCCESSOR_SHA256='584ed859f06e22191b908dcd5b2c6ec451dc78acf789181eadd69720365f600f'/u,
);
assert.match(cbeStoppedPhoneProofHelperRotation, /require_current_release/u);
assert.match(
  cbeStoppedPhoneProofHelperRotation,
  /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u,
);
assert.match(
  ownerManualReviewHelperRotation,
  /readonly PREDECESSOR_SHA256='584ed859f06e22191b908dcd5b2c6ec451dc78acf789181eadd69720365f600f'/u,
);
assert.match(
  ownerManualReviewHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='22f2ecfdb112d31b1807c148b021d9b7367e3134'/u,
);
assert.match(
  ownerManualReviewHelperRotation,
  /readonly SUCCESSOR_SHA256='af847321e9a8a31b5ba75bb42848b18d4462062762b87f5bdf57983219406345'/u,
);
assert.match(ownerManualReviewHelperRotation, /require_current_release/u);
assert.match(ownerManualReviewHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(
  ownerPageClarityHelperRotation,
  /readonly PREDECESSOR_SHA256='af847321e9a8a31b5ba75bb42848b18d4462062762b87f5bdf57983219406345'/u,
);
assert.match(
  ownerPageClarityHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='74f9591d9019a904f331c105bbe8167eef2148ff'/u,
);
assert.match(
  ownerPageClarityHelperRotation,
  /readonly SUCCESSOR_SHA256='563c2b05a3d15d474ad71bcf33ed7b68798aff65ee6700fa4ca49c65dac76e23'/u,
);
assert.match(ownerPageClarityHelperRotation, /require_current_release/u);
assert.match(ownerPageClarityHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(
  ownerPaymentMethodsHelperRotation,
  /readonly PREDECESSOR_SHA256='563c2b05a3d15d474ad71bcf33ed7b68798aff65ee6700fa4ca49c65dac76e23'/u,
);
assert.match(
  ownerPaymentMethodsHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='6b7fab30082f37f4d42ad8ed0958d77b75348929'/u,
);
assert.match(
  ownerPaymentMethodsHelperRotation,
  /readonly SUCCESSOR_SHA256='e00b5721a2b48cad8f5a7828081ebe9b05c239c6283a0123ac9f561e951ea1d2'/u,
);
assert.match(ownerPaymentMethodsHelperRotation, /require_current_release/u);
assert.match(
  ownerPaymentMethodsHelperRotation,
  /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u,
);
assert.match(
  unifiedDepositHelperRotation,
  /readonly PREDECESSOR_SHA256='e00b5721a2b48cad8f5a7828081ebe9b05c239c6283a0123ac9f561e951ea1d2'/u,
);
assert.match(
  unifiedDepositHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='aa5db75897ac63e29917836aa7d52843b4a69ef6'/u,
);
assert.match(
  unifiedDepositHelperRotation,
  /readonly SUCCESSOR_SHA256='255b545f55df67038bdc737eb3aeaade49ebafcee5edd054b25e1926cf391336'/u,
);
assert.match(unifiedDepositHelperRotation, /require_current_release/u);
assert.match(unifiedDepositHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(
  shortDepositHelperRotation,
  /readonly PREDECESSOR_SHA256='255b545f55df67038bdc737eb3aeaade49ebafcee5edd054b25e1926cf391336'/u,
);
assert.match(
  shortDepositHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='08420128eb114b33ef1b8fdaf8d41dc9fa3f4277'/u,
);
assert.match(
  shortDepositHelperRotation,
  /readonly SUCCESSOR_SHA256='a345584d30466ef0d2265e1347f5ea5d8bece054e1e2d98ad9ee842fa101dd1b'/u,
);
assert.match(shortDepositHelperRotation, /require_current_release/u);
assert.match(shortDepositHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(
  copyNumbersHelperRotation,
  /readonly PREDECESSOR_SHA256='a345584d30466ef0d2265e1347f5ea5d8bece054e1e2d98ad9ee842fa101dd1b'/u,
);
assert.match(
  copyNumbersHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='05de2df452f844bcd49f022d52559eb7aff8ab78'/u,
);
assert.match(
  copyNumbersHelperRotation,
  /readonly SUCCESSOR_SHA256='4df544545234de40bdb0a4fbf3f624e5938abbdc06619dd4b688088e2fac4329'/u,
);
assert.match(copyNumbersHelperRotation, /require_current_release/u);
assert.match(copyNumbersHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(
  inlineNumbersHelperRotation,
  /readonly PREDECESSOR_SHA256='4df544545234de40bdb0a4fbf3f624e5938abbdc06619dd4b688088e2fac4329'/u,
);
assert.match(
  inlineNumbersHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='e0a880a808477397c800986856de2fd2c94184f9'/u,
);
assert.match(
  inlineNumbersHelperRotation,
  /readonly SUCCESSOR_SHA256='7f775dee43c95aa9a044bacdcc10b2e8479c06165257e85c463545c5912c1c04'/u,
);
assert.match(inlineNumbersHelperRotation, /require_current_release/u);
assert.match(inlineNumbersHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(telebirrRevisionHelperRotation, /readonly EXPECTED_DROPLET_ID='593344964'/u);
assert.match(
  telebirrRevisionHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='ded01070ec1521af1ad940c4ab580abf47fc9d78'/u,
);
assert.match(
  telebirrRevisionHelperRotation,
  /readonly PREDECESSOR_SHA256='7f775dee43c95aa9a044bacdcc10b2e8479c06165257e85c463545c5912c1c04'/u,
);
assert.match(
  telebirrRevisionHelperRotation,
  /readonly SUCCESSOR_SHA256='455e3aa718e11d5d729861c02e507b3a1eb4f23905625c1f3bad8455a43dbd5e'/u,
);
assert.match(telebirrRevisionHelperRotation, /require_current_release/u);
assert.match(telebirrRevisionHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
assert.match(pausedCreditHelperRotation, /readonly EXPECTED_DROPLET_ID='593344964'/u);
assert.match(
  pausedCreditHelperRotation,
  /readonly EXPECTED_CURRENT_SHA='f86b00e8e566428c3b81303a012973f8adb53137'/u,
);
assert.match(
  pausedCreditHelperRotation,
  /readonly PREDECESSOR_SHA256='455e3aa718e11d5d729861c02e507b3a1eb4f23905625c1f3bad8455a43dbd5e'/u,
);
assert.match(
  pausedCreditHelperRotation,
  /readonly SUCCESSOR_SHA256='040cf1ceb65e514e4812503d6010e2f0c3a86506e764076d63d904fd6428e429'/u,
);
assert.match(pausedCreditHelperRotation, /require_current_release/u);
assert.match(pausedCreditHelperRotation, /require_sudoers "\$SUDOERS" "\$SUCCESSOR_SHA256"/u);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='0cf74de563b8e332cc84b57eea21d64b331e1f7c'",
  "readonly PREDECESSOR_SHA256='040cf1ceb65e514e4812503d6010e2f0c3a86506e764076d63d904fd6428e429'",
  "readonly SUCCESSOR_SHA256='be573f41360106411a4e121a7dc5a88a90944b87440b03712bbffea8ee255e85'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 UNCERTAIN ISOLATION HELPER V1',
]) {
  assert.ok(uncertainIsolationHelperRotation.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='45535eca31446b0d652850398b3777eefb345507'",
  "readonly PREDECESSOR_SHA256='be573f41360106411a4e121a7dc5a88a90944b87440b03712bbffea8ee255e85'",
  "readonly SUCCESSOR_SHA256='136f2a70767a1bc51e330f595116ded5f3af5eb7a9726b65ed38a4e4b695c620'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 CUSTOMER COPY HELPER V1',
]) {
  assert.ok(customerCopyHelperRotation.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='40dd8c1c02eb3f787d66d89ff7f9bd23d8fe518a'",
  "readonly PREDECESSOR_SHA256='136f2a70767a1bc51e330f595116ded5f3af5eb7a9726b65ed38a4e4b695c620'",
  "readonly SUCCESSOR_SHA256='01f94e178365dd2c237f9b2c79bea139193a57f2e5096e03dd4b731e5ee988f8'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 PLAYER ID AUTO DETECT HELPER V1',
]) {
  assert.ok(playerIdHelperRotation.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='b4f0449a3956256a4cf2345956476745a43f2ebc'",
  "readonly PREDECESSOR_SHA256='01f94e178365dd2c237f9b2c79bea139193a57f2e5096e03dd4b731e5ee988f8'",
  "readonly SUCCESSOR_SHA256='263535acea17f8c16fa2ef6cbc866989905a6134d7b7258ac091f1ec08ba67e4'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 SHORT PLAYER ID MENU HELPER V1',
]) {
  assert.ok(shortPlayerIdMenuHelperRotation.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='6fc3b00b492efb1b9ee7f6bbdad41d6225d62293'",
  "readonly PREDECESSOR_SHA256='263535acea17f8c16fa2ef6cbc866989905a6134d7b7258ac091f1ec08ba67e4'",
  "readonly SUCCESSOR_SHA256='64e976802d4f6719a4589ffe47e3029dba772d3690fa1f6762642d01cfb65e0e'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 PLAYER CREDIT SPEED HELPER V1',
]) {
  assert.ok(playerCreditSpeedHelperRotation.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='2fb198cf9a4f2a7a2ac8a3b22d3ad43130f02943'",
  "readonly PREDECESSOR_SHA256='64e976802d4f6719a4589ffe47e3029dba772d3690fa1f6762642d01cfb65e0e'",
  "readonly SUCCESSOR_SHA256='bf9f012fc93e16f8b4be7fe92a372751d56d69a0198e6c4679a57c10a612d6ad'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 BOT EXPIRY MENU HELPER V1',
]) {
  assert.ok(botExpiryMenuHelperRotation.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='0d3d6dafc55e1ae8d1fb4ff6ae74e089b9a39dbe'",
  "readonly PREDECESSOR_SHA256='bf9f012fc93e16f8b4be7fe92a372751d56d69a0198e6c4679a57c10a612d6ad'",
  "readonly SUCCESSOR_SHA256='238b1068123b434128def98334c01e367df2edb4912684b7cd57d8d7cb6932b7'",
  "readonly SOURCE_REVIEW='owner-control-panel-release-v1'",
  "readonly STAGED_HELPER='/root/fetanagent-production-v2-owner-control-panel-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'flock --nonblock 9',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER CONTROL PANEL HELPER V1',
]) {
  assert.ok(ownerControlPanelHelperRotation.includes(value));
}
const ownerRotationSteps = ownerControlPanelHelperRotation.slice(
  ownerControlPanelHelperRotation.indexOf('rotate() {'),
);
for (const [before, after] of [
  ['acquire_lock', 'install_record "$INTENT" intent_body'],
  ['install_record "$INTENT" intent_body', 'mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'],
  ['mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"', 'mv -T -- "$NEXT_HELPER" "$HELPER"'],
  ['mv -T -- "$NEXT_HELPER" "$HELPER"', 'mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'],
  [
    'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
    'install_record "$COMPLETE" complete_body',
  ],
]) {
  assert.ok(
    ownerRotationSteps.indexOf(before) >= 0 &&
      ownerRotationSteps.indexOf(before) < ownerRotationSteps.indexOf(after),
  );
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='97ff2764fed63679b102d2d7649650a4119c66a2'",
  "readonly PREDECESSOR_SHA256='238b1068123b434128def98334c01e367df2edb4912684b7cd57d8d7cb6932b7'",
  "readonly SUCCESSOR_SHA256='f9dff78b64bec9722e1170ac7e36fa084d6c01233dee15741f0cf5a5d2836027'",
  "readonly SOURCE_REVIEW='owner-emergency-approval-release-v1'",
  "readonly STAGED_HELPER='/root/fetanagent-production-v2-owner-emergency-approval-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'flock --nonblock 9',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER EMERGENCY APPROVAL HELPER V1',
]) {
  assert.ok(ownerEmergencyApprovalHelperRotation.includes(value));
}
const emergencyRotationSteps = ownerEmergencyApprovalHelperRotation.slice(
  ownerEmergencyApprovalHelperRotation.indexOf('rotate() {'),
);
for (const [before, after] of [
  ['acquire_lock', 'install_record "$INTENT" intent_body'],
  ['install_record "$INTENT" intent_body', 'mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'],
  ['mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"', 'mv -T -- "$NEXT_HELPER" "$HELPER"'],
  ['mv -T -- "$NEXT_HELPER" "$HELPER"', 'mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'],
  [
    'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
    'install_record "$COMPLETE" complete_body',
  ],
]) {
  assert.ok(
    emergencyRotationSteps.indexOf(before) >= 0 &&
      emergencyRotationSteps.indexOf(before) < emergencyRotationSteps.indexOf(after),
  );
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='03c65fe835f952a7b5e6ef628a60893ff7229caf'",
  "readonly PREDECESSOR_SHA256='f9dff78b64bec9722e1170ac7e36fa084d6c01233dee15741f0cf5a5d2836027'",
  "readonly SUCCESSOR_SHA256='9a45d0e999335b923fcc2506e7e985b063bc7e5d124cc67d4def8b4e50a209df'",
  "readonly SOURCE_REVIEW='owner-sms-inbox-release-v1'",
  "readonly STAGED_HELPER='/root/fetanagent-production-v2-owner-sms-inbox-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'flock --nonblock 9',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER SMS INBOX HELPER V1',
]) {
  assert.ok(ownerSmsInboxHelperRotation.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-owner-sms-inbox-helper-rotation-v1\.sh/u,
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='c1e9e91e209eb8d50563accafd7112bbbdafdc50'",
  "readonly PREDECESSOR_SHA256='9a45d0e999335b923fcc2506e7e985b063bc7e5d124cc67d4def8b4e50a209df'",
  "readonly SUCCESSOR_SHA256='6280df25be1900634a2fc50111fd1161105b73dc92b5ef187c931ae8580b2e43'",
  "readonly SOURCE_REVIEW='telegram-natural-messages-release-v1'",
  "readonly STAGED_HELPER='/root/fetanagent-production-v2-telegram-natural-messages-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'flock --nonblock 9',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 TELEGRAM NATURAL MESSAGES HELPER V1',
]) {
  assert.ok(telegramNaturalMessagesHelperRotation.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-telegram-natural-messages-helper-rotation-v1\.sh/u,
);
const naturalMessagesRotationSteps = telegramNaturalMessagesHelperRotation.slice(
  telegramNaturalMessagesHelperRotation.indexOf('rotate() {'),
);
for (const [before, after] of [
  ['acquire_lock', 'install_record "$INTENT" intent_body'],
  ['install_record "$INTENT" intent_body', 'mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'],
  ['mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"', 'mv -T -- "$NEXT_HELPER" "$HELPER"'],
  ['mv -T -- "$NEXT_HELPER" "$HELPER"', 'mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'],
  [
    'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
    'install_record "$COMPLETE" complete_body',
  ],
]) {
  assert.ok(
    naturalMessagesRotationSteps.indexOf(before) >= 0 &&
      naturalMessagesRotationSteps.indexOf(before) < naturalMessagesRotationSteps.indexOf(after),
  );
}
assert.doesNotMatch(
  telegramNaturalMessagesHelperRotation,
  /\b(?:docker|psql|rm|sed|chmod|chown)\s/u,
);
for (const value of [
  'c1e9e91e209eb8d50563accafd7112bbbdafdc50',
  '9a45d0e999335b923fcc2506e7e985b063bc7e5d124cc67d4def8b4e50a209df',
  '6280df25be1900634a2fc50111fd1161105b73dc92b5ef187c931ae8580b2e43',
  'cbe-live-v1',
  'ROTATE EXACT PRODUCTION V2 TELEGRAM NATURAL MESSAGES HELPER V1',
]) {
  assert.ok(telegramNaturalMessagesReleaseRunbook.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='4e4faa65ae2b536424a857b5003fbc675343b4c8'",
  "readonly PREDECESSOR_SHA256='6280df25be1900634a2fc50111fd1161105b73dc92b5ef187c931ae8580b2e43'",
  "readonly SUCCESSOR_SHA256='90778252cd69601243cb68e90b208cbac08e10eecd7ce95582c0686983516d1b'",
  "readonly SOURCE_REVIEW='short-customer-copy-release-v1'",
  "readonly STAGED_HELPER='/root/fetanagent-production-v2-short-customer-copy-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'flock --nonblock 9',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 SHORT CUSTOMER COPY HELPER V1',
]) {
  assert.ok(shortCustomerCopyHelperRotation.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-short-customer-copy-helper-rotation-v1\.sh/u,
);
const shortCustomerCopyRotationSteps = shortCustomerCopyHelperRotation.slice(
  shortCustomerCopyHelperRotation.indexOf('rotate() {'),
);
for (const [before, after] of [
  ['acquire_lock', 'install_record "$INTENT" intent_body'],
  ['install_record "$INTENT" intent_body', 'mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'],
  ['mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"', 'mv -T -- "$NEXT_HELPER" "$HELPER"'],
  ['mv -T -- "$NEXT_HELPER" "$HELPER"', 'mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'],
  [
    'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
    'install_record "$COMPLETE" complete_body',
  ],
]) {
  assert.ok(
    shortCustomerCopyRotationSteps.indexOf(before) >= 0 &&
      shortCustomerCopyRotationSteps.indexOf(before) <
        shortCustomerCopyRotationSteps.indexOf(after),
  );
}
assert.doesNotMatch(shortCustomerCopyHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '4e4faa65ae2b536424a857b5003fbc675343b4c8',
  '6280df25be1900634a2fc50111fd1161105b73dc92b5ef187c931ae8580b2e43',
  '90778252cd69601243cb68e90b208cbac08e10eecd7ce95582c0686983516d1b',
  'cbe-live-v1',
  'ROTATE EXACT PRODUCTION V2 SHORT CUSTOMER COPY HELPER V1',
]) {
  assert.ok(shortCustomerCopyReleaseRunbook.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='09cf011cd8d0cc381763ac63a65e3056533f032f'",
  "readonly PREDECESSOR_SHA256='90778252cd69601243cb68e90b208cbac08e10eecd7ce95582c0686983516d1b'",
  "readonly SUCCESSOR_SHA256='cceaf528b16b7084eb751488bd931c6fd4c69cd5df9b505304e0cfc42f141211'",
  "readonly SOURCE_REVIEW='release-guard-refresh-v1'",
  'flock --nonblock 9',
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 RELEASE GUARD REFRESH HELPER V1',
]) {
  assert.ok(releaseGuardRefreshHelperRotation.includes(value));
}
assert.doesNotMatch(releaseGuardRefreshHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-release-guard-refresh-helper-rotation-v1\.sh/u,
);
for (const value of [
  '09cf011cd8d0cc381763ac63a65e3056533f032f',
  '90778252cd69601243cb68e90b208cbac08e10eecd7ce95582c0686983516d1b',
  'cceaf528b16b7084eb751488bd931c6fd4c69cd5df9b505304e0cfc42f141211',
  'ROTATE EXACT PRODUCTION V2 RELEASE GUARD REFRESH HELPER V1',
]) {
  assert.ok(releaseGuardRefreshRunbook.includes(value));
}
const receiverSmsWindowHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-receiver-sms-window-helper-rotation-v1.sh',
);
const receiverSmsWindowReleaseRunbook = await read(
  'infra/operations/production-receiver-sms-window-release.md',
);
for (const value of [
  "readonly EXPECTED_CURRENT_SHA='08248f9865af52a4887d61e24b4540987b246f4e'",
  "readonly PREDECESSOR_SHA256='4041da029ce206492d8de5da3cb08add6e1ec85683705a21f8fc8fdc464c9888'",
  "readonly SUCCESSOR_SHA256='b2ca13921de2e66d079bb97439397127068782018fabf89fceb4aad9d7831a45'",
  "readonly SOURCE_REVIEW='receiver-sms-window-guard-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 RECEIVER SMS WINDOW GUARD HELPER V1',
]) {
  assert.ok(receiverSmsWindowHelperRotation.includes(value));
}
assert.doesNotMatch(receiverSmsWindowHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
const companionSessionDiagnosticsHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-companion-session-diagnostics-helper-rotation-v1.sh',
);
const companionSessionDiagnosticsReleaseRunbook = await read(
  'infra/operations/production-companion-session-diagnostics-release.md',
);
for (const value of [
  "readonly EXPECTED_CURRENT_SHA='b8eb1d2280613a355bb81dc71579c3b236b61d85'",
  "readonly PREDECESSOR_SHA256='b2ca13921de2e66d079bb97439397127068782018fabf89fceb4aad9d7831a45'",
  "readonly SUCCESSOR_SHA256='843230c82f4a7fb1401e0a7e6277b041935b8ec3601867b2f083604845271d06'",
  "readonly SOURCE_REVIEW='companion-session-diagnostics-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 COMPANION SESSION DIAGNOSTICS HELPER V1',
]) {
  assert.ok(companionSessionDiagnosticsHelperRotation.includes(value));
}
assert.doesNotMatch(
  companionSessionDiagnosticsHelperRotation,
  /\b(?:docker|psql|rm|sed|chmod|chown)\s/u,
);
for (const value of [
  'b8eb1d2280613a355bb81dc71579c3b236b61d85',
  'b2ca13921de2e66d079bb97439397127068782018fabf89fceb4aad9d7831a45',
  '843230c82f4a7fb1401e0a7e6277b041935b8ec3601867b2f083604845271d06',
  'ROTATE EXACT PRODUCTION V2 COMPANION SESSION DIAGNOSTICS HELPER V1',
]) {
  assert.ok(companionSessionDiagnosticsReleaseRunbook.includes(value));
}
const duplicateSubmissionHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-duplicate-submission-helper-rotation-v1.sh',
);
const duplicateSubmissionReleaseRunbook = await read(
  'infra/operations/production-duplicate-submission-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='20beb62d28aedc1e60873f9ad9ecec164fee9466'",
  "readonly PREDECESSOR_SHA256='843230c82f4a7fb1401e0a7e6277b041935b8ec3601867b2f083604845271d06'",
  "readonly SUCCESSOR_SHA256='2683e4c0a0f9c47ff6e3f4ae8dedcf439e6ac3d976baa523651f32621922477e'",
  "readonly SOURCE_REVIEW='duplicate-submission-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 DUPLICATE SUBMISSION HELPER V1',
]) {
  assert.ok(duplicateSubmissionHelperRotation.includes(value));
}
assert.doesNotMatch(duplicateSubmissionHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '20beb62d28aedc1e60873f9ad9ecec164fee9466',
  '843230c82f4a7fb1401e0a7e6277b041935b8ec3601867b2f083604845271d06',
  '2683e4c0a0f9c47ff6e3f4ae8dedcf439e6ac3d976baa523651f32621922477e',
  'ROTATE EXACT PRODUCTION V2 DUPLICATE SUBMISSION HELPER V1',
]) {
  assert.ok(duplicateSubmissionReleaseRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-duplicate-submission-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-duplicate-submission-helper-rotation-v1\.sh/u,
);
const botMessageClarityHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-bot-message-clarity-helper-rotation-v1.sh',
);
const botMessageClarityReleaseRunbook = await read(
  'infra/operations/production-bot-message-clarity-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='8b977d9169fb79bb42ffc076dfe975eb1f12f085'",
  "readonly PREDECESSOR_SHA256='2683e4c0a0f9c47ff6e3f4ae8dedcf439e6ac3d976baa523651f32621922477e'",
  "readonly SUCCESSOR_SHA256='c39f6648d2d0dc7127a9661cef8e7ecf8cc8edf4c96b8480af8fa97931020fbb'",
  "readonly SOURCE_REVIEW='bot-message-clarity-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 BOT MESSAGE CLARITY HELPER V1',
]) {
  assert.ok(botMessageClarityHelperRotation.includes(value));
}
assert.doesNotMatch(botMessageClarityHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '8b977d9169fb79bb42ffc076dfe975eb1f12f085',
  '2683e4c0a0f9c47ff6e3f4ae8dedcf439e6ac3d976baa523651f32621922477e',
  'c39f6648d2d0dc7127a9661cef8e7ecf8cc8edf4c96b8480af8fa97931020fbb',
  'ROTATE EXACT PRODUCTION V2 BOT MESSAGE CLARITY HELPER V1',
]) {
  assert.ok(botMessageClarityReleaseRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-bot-message-clarity-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-bot-message-clarity-helper-rotation-v1\.sh/u,
);
const telegramBrandMenuHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-telegram-brand-menu-helper-rotation-v1.sh',
);
const telegramBrandMenuReleaseRunbook = await read(
  'infra/operations/production-telegram-brand-menu-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='7fca3343a2a2057845634cc9aa684aed55603c0c'",
  "readonly PREDECESSOR_SHA256='c39f6648d2d0dc7127a9661cef8e7ecf8cc8edf4c96b8480af8fa97931020fbb'",
  "readonly SUCCESSOR_SHA256='e9496ec77d38ad36ab3645e18e2ecccb0cd584db686f2b70693e03d98c9aa000'",
  "readonly SOURCE_REVIEW='telegram-brand-menu-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 TELEGRAM BRAND MENU HELPER V1',
]) {
  assert.ok(telegramBrandMenuHelperRotation.includes(value));
}
assert.doesNotMatch(telegramBrandMenuHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '7fca3343a2a2057845634cc9aa684aed55603c0c',
  'c39f6648d2d0dc7127a9661cef8e7ecf8cc8edf4c96b8480af8fa97931020fbb',
  'e9496ec77d38ad36ab3645e18e2ecccb0cd584db686f2b70693e03d98c9aa000',
  'ROTATE EXACT PRODUCTION V2 TELEGRAM BRAND MENU HELPER V1',
]) {
  assert.ok(telegramBrandMenuReleaseRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-telegram-brand-menu-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-telegram-brand-menu-helper-rotation-v1\.sh/u,
);
const reviewNoticeBotHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-review-notice-bot-helper-rotation-v1.sh',
);
const reviewNoticeBotReleaseRunbook = await read(
  'infra/operations/production-review-notice-bot-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='781fa538102a5b7d490438d75d285882a71a8e68'",
  "readonly PREDECESSOR_SHA256='e9496ec77d38ad36ab3645e18e2ecccb0cd584db686f2b70693e03d98c9aa000'",
  "readonly SUCCESSOR_SHA256='002766a2e8e8736bf21e7361ce33c3ef8686a55d0d27e72f870365f0e8979349'",
  "readonly SOURCE_REVIEW='review-notice-bot-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 REVIEW NOTICE BOT HELPER V1',
]) {
  assert.ok(reviewNoticeBotHelperRotation.includes(value));
}
assert.doesNotMatch(reviewNoticeBotHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '781fa538102a5b7d490438d75d285882a71a8e68',
  'e9496ec77d38ad36ab3645e18e2ecccb0cd584db686f2b70693e03d98c9aa000',
  '002766a2e8e8736bf21e7361ce33c3ef8686a55d0d27e72f870365f0e8979349',
  'ROTATE EXACT PRODUCTION V2 REVIEW NOTICE BOT HELPER V1',
]) {
  assert.ok(reviewNoticeBotReleaseRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-review-notice-bot-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-review-notice-bot-helper-rotation-v1\.sh/u,
);
const pdfReceiptReferenceHelperRotation = await read(
  'infra/operations/fetanagent-production-v2-pdf-receipt-reference-helper-rotation-v1.sh',
);
const pdfReceiptReferenceReleaseRunbook = await read(
  'infra/operations/production-pdf-receipt-reference-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='82b0ccc7c618c201e77d452967132e5bc23367f9'",
  "readonly PREDECESSOR_SHA256='002766a2e8e8736bf21e7361ce33c3ef8686a55d0d27e72f870365f0e8979349'",
  "readonly SUCCESSOR_SHA256='b0c9115f3b14d74c38356923cbc68e95de6223dce2dd5e5c0cb7e2c77b01feb2'",
  "readonly SOURCE_REVIEW='pdf-receipt-reference-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 PDF RECEIPT REFERENCE HELPER V1',
]) {
  assert.ok(pdfReceiptReferenceHelperRotation.includes(value));
}
assert.doesNotMatch(pdfReceiptReferenceHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '82b0ccc7c618c201e77d452967132e5bc23367f9',
  '002766a2e8e8736bf21e7361ce33c3ef8686a55d0d27e72f870365f0e8979349',
  'b0c9115f3b14d74c38356923cbc68e95de6223dce2dd5e5c0cb7e2c77b01feb2',
  'ROTATE EXACT PRODUCTION V2 PDF RECEIPT REFERENCE HELPER V1',
]) {
  assert.ok(pdfReceiptReferenceReleaseRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-pdf-receipt-reference-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-pdf-receipt-reference-helper-rotation-v1\.sh/u,
);
const depositOutcomeButtonRotation = await read(
  'infra/operations/fetanagent-production-v2-deposit-outcome-button-helper-rotation-v1.sh',
);
const depositOutcomeButtonRunbook = await read(
  'infra/operations/production-deposit-outcome-button-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='842f1fb301de9a479c558b06cbc20fd67e3e45fc'",
  "readonly PREDECESSOR_SHA256='b0c9115f3b14d74c38356923cbc68e95de6223dce2dd5e5c0cb7e2c77b01feb2'",
  "readonly SUCCESSOR_SHA256='2c6d86b14144149b75acb1bb46718b92bda4813e8351f94086f1fec5d44dc47c'",
  "readonly SOURCE_REVIEW='deposit-outcome-button-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 DEPOSIT OUTCOME BUTTON HELPER V1',
]) {
  assert.ok(depositOutcomeButtonRotation.includes(value));
}
assert.doesNotMatch(depositOutcomeButtonRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '842f1fb301de9a479c558b06cbc20fd67e3e45fc',
  'b0c9115f3b14d74c38356923cbc68e95de6223dce2dd5e5c0cb7e2c77b01feb2',
  '2c6d86b14144149b75acb1bb46718b92bda4813e8351f94086f1fec5d44dc47c',
  'ROTATE EXACT PRODUCTION V2 DEPOSIT OUTCOME BUTTON HELPER V1',
]) {
  assert.ok(depositOutcomeButtonRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-deposit-outcome-button-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-deposit-outcome-button-helper-rotation-v1\.sh/u,
);
const paymentIntakeAckRotation = await read(
  'infra/operations/fetanagent-production-v2-payment-intake-ack-helper-rotation-v1.sh',
);
const paymentIntakeAckRunbook = await read(
  'infra/operations/production-payment-intake-ack-release.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='7d17b2c56f0583f96dbc2bacb15c2e0a54fa7732'",
  "readonly PREDECESSOR_SHA256='2c6d86b14144149b75acb1bb46718b92bda4813e8351f94086f1fec5d44dc47c'",
  "readonly SUCCESSOR_SHA256='37bfde8ed339a6ca911342458d0e954122d1e62fcc528b31b8b8fb2460575108'",
  "readonly SOURCE_REVIEW='payment-intake-ack-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 PAYMENT INTAKE ACK HELPER V1',
]) {
  assert.ok(paymentIntakeAckRotation.includes(value));
}
assert.doesNotMatch(paymentIntakeAckRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '7d17b2c56f0583f96dbc2bacb15c2e0a54fa7732',
  '2c6d86b14144149b75acb1bb46718b92bda4813e8351f94086f1fec5d44dc47c',
  '37bfde8ed339a6ca911342458d0e954122d1e62fcc528b31b8b8fb2460575108',
  'ROTATE EXACT PRODUCTION V2 PAYMENT INTAKE ACK HELPER V1',
]) {
  assert.ok(paymentIntakeAckRunbook.includes(value));
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-payment-intake-ack-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-payment-intake-ack-helper-rotation-v1\.sh/u,
);
const ownerHealthGuardRotation = await read(
  'infra/operations/fetanagent-production-v2-owner-health-release-guard-helper-rotation-v1.sh',
);
const ownerHealthGuardRunbook = await read(
  'infra/operations/production-owner-health-release-guard.md',
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='0c354ea06ff48c98122181c703467b442b52c1ca'",
  "readonly PREDECESSOR_SHA256='37bfde8ed339a6ca911342458d0e954122d1e62fcc528b31b8b8fb2460575108'",
  `readonly SUCCESSOR_SHA256='${helperDigest}'`,
  "readonly SOURCE_REVIEW='owner-health-release-guard-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER HEALTH RELEASE GUARD HELPER V1',
]) {
  assert.ok(ownerHealthGuardRotation.includes(value));
}
assert.doesNotMatch(ownerHealthGuardRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  '0c354ea06ff48c98122181c703467b442b52c1ca',
  '37bfde8ed339a6ca911342458d0e954122d1e62fcc528b31b8b8fb2460575108',
  helperDigest,
  'ROTATE EXACT PRODUCTION V2 OWNER HEALTH RELEASE GUARD HELPER V1',
]) {
  assert.ok(ownerHealthGuardRunbook.includes(value));
}
for (const source of [workflow, quality]) {
  assert.match(
    source,
    /bash -n infra\/operations\/fetanagent-production-v2-owner-health-release-guard-helper-rotation-v1\.sh/u,
  );
}
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-companion-session-diagnostics-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-companion-session-diagnostics-helper-rotation-v1\.sh/u,
);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-receiver-sms-window-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-receiver-sms-window-helper-rotation-v1\.sh/u,
);
for (const value of [
  '08248f9865af52a4887d61e24b4540987b246f4e',
  '4041da029ce206492d8de5da3cb08add6e1ec85683705a21f8fc8fdc464c9888',
  'b2ca13921de2e66d079bb97439397127068782018fabf89fceb4aad9d7831a45',
  'ROTATE EXACT PRODUCTION V2 RECEIVER SMS WINDOW GUARD HELPER V1',
]) {
  assert.ok(receiverSmsWindowReleaseRunbook.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='f169bb563a4fe0a69a3fb5052a3120416ad2f8fc'",
  "readonly PREDECESSOR_SHA256='cceaf528b16b7084eb751488bd931c6fd4c69cd5df9b505304e0cfc42f141211'",
  "readonly SUCCESSOR_SHA256='45d7b24b273372e3c2997cecc7c851d9aabd6a6bde5e0ca84d109f375bb2eb05'",
  "readonly SOURCE_REVIEW='deposit-range-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 DEPOSIT RANGE HELPER V1',
]) {
  assert.ok(depositRangeHelperRotation.includes(value));
}
assert.doesNotMatch(depositRangeHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-deposit-range-helper-rotation-v1\.sh/u,
);
for (const value of [
  'f169bb563a4fe0a69a3fb5052a3120416ad2f8fc',
  'cceaf528b16b7084eb751488bd931c6fd4c69cd5df9b505304e0cfc42f141211',
  '45d7b24b273372e3c2997cecc7c851d9aabd6a6bde5e0ca84d109f375bb2eb05',
  'ROTATE EXACT PRODUCTION V2 DEPOSIT RANGE HELPER V1',
]) {
  assert.ok(depositRangeReleaseRunbook.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='7e502c524fb71c738e1630b0898ed21fe59812a8'",
  "readonly PREDECESSOR_SHA256='45d7b24b273372e3c2997cecc7c851d9aabd6a6bde5e0ca84d109f375bb2eb05'",
  "readonly SUCCESSOR_SHA256='ab09aa773ba2eac7e7758ea3e02ab335fb5711c0031d0c7934a2afe27d2518d2'",
  "readonly SOURCE_REVIEW='cbe-reference-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 CBE REFERENCE HELPER V1',
]) {
  assert.ok(cbeReferenceHelperRotation.includes(value));
}
assert.doesNotMatch(cbeReferenceHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-cbe-reference-helper-rotation-v1\.sh/u,
);
for (const value of [
  '7e502c524fb71c738e1630b0898ed21fe59812a8',
  '45d7b24b273372e3c2997cecc7c851d9aabd6a6bde5e0ca84d109f375bb2eb05',
  'ab09aa773ba2eac7e7758ea3e02ab335fb5711c0031d0c7934a2afe27d2518d2',
  'ROTATE EXACT PRODUCTION V2 CBE REFERENCE HELPER V1',
]) {
  assert.ok(cbeReferenceReleaseRunbook.includes(value));
}
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='d6c1865b911a95a8242331410e9dd0d24292954c'",
  "readonly PREDECESSOR_SHA256='ab09aa773ba2eac7e7758ea3e02ab335fb5711c0031d0c7934a2afe27d2518d2'",
  "readonly SUCCESSOR_SHA256='94057ea1861e1df02461bc12d8d8053cb52a0a8be8cdb1b999eab00b14952806'",
  "readonly SOURCE_REVIEW='owner-full-stage1-release-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER FULL STAGE1 HELPER V1',
]) {
  assert.ok(ownerFullStage1HelperRotation.includes(value));
}
assert.doesNotMatch(ownerFullStage1HelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='8e6367b01383b53cb7135d62083e1dfcd37cbdd4'",
  "readonly PREDECESSOR_SHA256='94057ea1861e1df02461bc12d8d8053cb52a0a8be8cdb1b999eab00b14952806'",
  "readonly SUCCESSOR_SHA256='ba2bff461abc271e3650400fc3aa10d39fbd8bd6726a5abd9e6c599359107b49'",
  "readonly SOURCE_REVIEW='owner-full-activation-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER FULL ACTIVATION HELPER V1',
]) {
  assert.ok(ownerFullActivationHelperRotation.includes(value));
}
assert.doesNotMatch(ownerFullActivationHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-owner-full-activation-helper-rotation-v1\.sh/u,
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='7c17868edc0026a170c7630bce3cd4cb80e6dbd9'",
  "readonly PREDECESSOR_SHA256='ba2bff461abc271e3650400fc3aa10d39fbd8bd6726a5abd9e6c599359107b49'",
  "readonly SUCCESSOR_SHA256='c94d3871386ac8f7b5a948468bc345841a1576a6b536029b43badfd0ddeacee6'",
  "readonly SOURCE_REVIEW='owner-full-history-fix-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER FULL HISTORY FIX HELPER V1',
]) {
  assert.ok(ownerFullHistoryFixHelperRotation.includes(value));
}
assert.doesNotMatch(ownerFullHistoryFixHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-owner-full-history-fix-helper-rotation-v1\.sh/u,
);
assert.ok(
  ownerFullPaymentReleaseRunbook.includes(
    'c94d3871386ac8f7b5a948468bc345841a1576a6b536029b43badfd0ddeacee6',
  ),
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='8342305d6e4728dd3eccbbebaab3098509eb67ac'",
  "readonly PREDECESSOR_SHA256='c94d3871386ac8f7b5a948468bc345841a1576a6b536029b43badfd0ddeacee6'",
  "readonly SUCCESSOR_SHA256='6bca4a0883bfea3bf538bf1cc8b10d3daba3e38c518f1da3bc6b69a3a4a40e18'",
  "readonly SOURCE_REVIEW='owner-one-click-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 OWNER ONE CLICK HELPER V1',
]) {
  assert.ok(ownerOneClickHelperRotation.includes(value));
}
for (const value of [
  '593344964',
  '8342305d6e4728dd3eccbbebaab3098509eb67ac',
  'c94d3871386ac8f7b5a948468bc345841a1576a6b536029b43badfd0ddeacee6',
  '6bca4a0883bfea3bf538bf1cc8b10d3daba3e38c518f1da3bc6b69a3a4a40e18',
  'ROTATE EXACT PRODUCTION V2 OWNER ONE CLICK HELPER V1',
])
  assert.ok(ownerOneClickReleaseRunbook.includes(value));
assert.doesNotMatch(ownerOneClickHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-owner-one-click-helper-rotation-v1\.sh/u,
);
for (const value of [
  "readonly EXPECTED_DROPLET_ID='593344964'",
  "readonly EXPECTED_CURRENT_SHA='bc6905f906850a61230837ef5b7ed2303fb3f001'",
  "readonly PREDECESSOR_SHA256='6bca4a0883bfea3bf538bf1cc8b10d3daba3e38c518f1da3bc6b69a3a4a40e18'",
  "readonly SUCCESSOR_SHA256='4041da029ce206492d8de5da3cb08add6e1ec85683705a21f8fc8fdc464c9888'",
  "readonly SOURCE_REVIEW='deposit-copy-hint-v1'",
  'require_current_release',
  'require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  'ROTATE EXACT PRODUCTION V2 DEPOSIT COPY HINT HELPER V1',
]) {
  assert.ok(depositCopyHintHelperRotation.includes(value));
}
for (const value of [
  '593344964',
  'bc6905f906850a61230837ef5b7ed2303fb3f001',
  '6bca4a0883bfea3bf538bf1cc8b10d3daba3e38c518f1da3bc6b69a3a4a40e18',
  '4041da029ce206492d8de5da3cb08add6e1ec85683705a21f8fc8fdc464c9888',
  'ROTATE EXACT PRODUCTION V2 DEPOSIT COPY HINT HELPER V1',
])
  assert.ok(depositCopyHintReleaseRunbook.includes(value));
assert.doesNotMatch(depositCopyHintHelperRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);
assert.match(
  workflow,
  /bash -n infra\/operations\/fetanagent-production-v2-deposit-copy-hint-helper-rotation-v1\.sh/u,
);
assert.match(
  quality,
  /bash -n infra\/operations\/fetanagent-production-v2-deposit-copy-hint-helper-rotation-v1\.sh/u,
);
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${helperDigest} /usr/local/sbin/fetanagent-production-deploy-helper-v2 *\n`,
  'sudoers must bind the restricted deploy account to this exact helper digest',
);
const predecessorDigest = createHash('sha256').update(predecessorHelper).digest('hex');
assert.equal(
  predecessorSudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${predecessorDigest} /usr/local/sbin/fetanagent-production-deploy-helper *\n`,
  'the predecessor production helper must remain digest pinned for rollback',
);
assert.match(
  workflow,
  /helper_sha="\$\(sha256sum infra\/operations\/fetanagent-production-deploy-helper-v2\.sh/u,
);
assert.match(
  workflow,
  /helper_sha=\$\(sha256sum infra\/operations\/fetanagent-production-deploy-helper-v2\.sh/u,
);
assert.match(workflow, /fetanagent-production-deploy-helper-v2 status '\$GITHUB_SHA'/u);
assert.match(workflow, /fetanagent-production-deploy-helper-v2 stop"/u);

for (const role of [
  'fetanagent_beta_admission_runtime',
  'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime',
  'fetanagent_telebirr_assignment_broker_runtime',
  'fetanagent_telebirr_device_state_runtime',
]) {
  assert.match(provisionSql, new RegExp(`alter role ${role} with login password`, 'u'));
  assert.match(disableSql, new RegExp(`alter role ${role} nologin password null`, 'u'));
}
assert.equal(count(provisionSql, /valid until 'infinity'/gu), 6);
assert.match(provisionSql, /count\(distinct credential\) = 6/u);
assert.doesNotMatch(provisionSql, /pg_catalog\.array\(/u);
assert.match(provisionSql, /rolvaliduntil = 'infinity'::timestamptz/u);
assert.match(provisionSql, /where mode <> 'disabled'/u);
assert.match(provisionSql, /Financial runtime logins must remain disabled/u);
assert.match(provisionSql, /begin transaction isolation level serializable/u);
assert.match(disableSql, /begin transaction isolation level serializable/u);
assert.doesNotMatch(`${provisionSql}\n${disableSql}`, /2026-09-0|interval '24 hours'/u);

assert.match(
  assignmentBrokerContinuousRuntimeMigration,
  /create or replace function app\.require_telebirr_assignment_broker_session\(\)/u,
);
assert.match(
  assignmentBrokerContinuousRuntimeMigration,
  /role\.rolname = 'fetanagent_telebirr_assignment_broker_runtime'/u,
);
assert.match(
  assignmentBrokerContinuousRuntimeMigration,
  /role\.rolvaliduntil = 'infinity'::timestamptz/u,
);
assert.match(
  assignmentBrokerContinuousRuntimeMigration,
  /role\.rolvaliduntil > pg_catalog\.clock_timestamp\(\) \+ interval '5 minutes'/u,
);
assert.match(
  assignmentBrokerContinuousRuntimeMigration,
  /role\.rolvaliduntil\s+<= pg_catalog\.clock_timestamp\(\) \+ interval '24 hours 5 minutes'/u,
);
assert.match(
  assignmentBrokerContinuousRuntimeMigration,
  /alter function app\.require_telebirr_assignment_broker_session\(\) owner to postgres/u,
);
assert.doesNotMatch(
  assignmentBrokerContinuousRuntimeMigration,
  /\b(?:grant|revoke|insert|update|delete|truncate|drop)\b/iu,
);
assert.match(
  assignmentBrokerConfig,
  /deploymentTarget === 'production' \? \('continuous' as const\) : \('bounded_24h' as const\)/u,
);
assert.match(assignmentBrokerPostgres, /\$1::text = 'bounded_24h'/u);
assert.match(assignmentBrokerPostgres, /\$1::text = 'continuous'/u);
assert.match(assignmentBrokerPostgres, /role\.rolvaliduntil = 'infinity'::timestamptz/u);
assert.match(
  assignmentBrokerPostgres,
  /assertTelebirrAssignmentBrokerCatalogPreflight\(guarded, runtimeCredentialValidity\)/u,
);

assert.match(
  assignmentRuntimeInputSql,
  /begin transaction isolation level serializable read only/u,
);
assert.match(assignmentRuntimeInputSql, /private_trusted_telebirr_activation_control/u);
assert.match(assignmentRuntimeInputSql, /private_trusted_telebirr_activation_epochs/u);
assert.match(assignmentRuntimeInputSql, /private_trusted_telebirr_emergency_disable_intents/u);
assert.match(assignmentRuntimeInputSql, /private_live_telebirr_device_enrollment_certificates/u);
assert.match(assignmentRuntimeInputSql, /private_live_telebirr_device_revocations/u);
assert.match(
  assignmentRuntimeInputSql,
  /pilot\.expires_at > pg_catalog\.clock_timestamp\(\) \+ interval '10 minutes'/u,
);
assert.match(
  assignmentRuntimeInputSql,
  /signer\.valid_until > pg_catalog\.clock_timestamp\(\) \+ interval '30 days'/u,
);
assert.match(assignmentRuntimeInputSql, /receiverAccountHolderNameSnapshot/u);
assert.match(assignmentRuntimeInputSql, /rollback;/u);
assert.doesNotMatch(
  assignmentRuntimeInputSql,
  /\b(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|execute|perform)\b|pg_(?:try_)?advisory/iu,
);

assert.match(
  shadowAssignmentRuntimeInputSql,
  /begin transaction isolation level serializable read only/u,
);
assert.match(shadowAssignmentRuntimeInputSql, /private_trusted_telebirr_activation_control/u);
assert.match(shadowAssignmentRuntimeInputSql, /private_trusted_telebirr_activation_epochs/u);
assert.match(
  shadowAssignmentRuntimeInputSql,
  /private_trusted_telebirr_emergency_disable_intents/u,
);
for (const feature of [
  'cbe_birr_authoritative_verification',
  'deposit_execution',
  'payment_verification',
  'telebirr_authoritative_verification',
  'withdrawal_collection',
  'withdrawal_validation',
]) {
  assert.match(shadowAssignmentRuntimeInputSql, new RegExp(escapeRegExp(feature), 'u'));
}
assert.match(shadowAssignmentRuntimeInputSql, /pilot_switch\.mode = 'dry_run'/u);
assert.match(shadowAssignmentRuntimeInputSql, /pilot\.minimum_amount_minor = 2500/u);
assert.match(shadowAssignmentRuntimeInputSql, /pilot\.maximum_aggregate_minor = 12500/u);
assert.match(shadowAssignmentRuntimeInputSql, /agent_platform_companion_execution_control/u);
assert.match(shadowAssignmentRuntimeInputSql, /execution_control\.control_state = 'disabled'/u);
assert.match(shadowAssignmentRuntimeInputSql, /fetanagent_trusted_telebirr_verifier_runtime/u);
assert.match(shadowAssignmentRuntimeInputSql, /fetanagent_deposit_executor_runtime/u);
assert.match(
  shadowAssignmentRuntimeInputSql,
  /private_live_telebirr_device_enrollment_certificates/u,
);
assert.match(shadowAssignmentRuntimeInputSql, /private_live_telebirr_device_revocations/u);
assert.match(
  shadowAssignmentRuntimeInputSql,
  /pilot\.expires_at > pg_catalog\.clock_timestamp\(\) \+ interval '10 minutes'/u,
);
assert.match(
  shadowAssignmentRuntimeInputSql,
  /signer\.valid_until > pg_catalog\.clock_timestamp\(\) \+ interval '30 days'/u,
);
assert.match(shadowAssignmentRuntimeInputSql, /receiverAccountHolderNameSnapshot/u);
assert.match(shadowAssignmentRuntimeInputSql, /rollback;/u);
assert.doesNotMatch(
  shadowAssignmentRuntimeInputSql,
  /\b(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|execute|perform)\b|pg_(?:try_)?advisory/iu,
);

assert.match(inertPreflightSql, /begin transaction isolation level serializable read only/u);
assert.match(inertPreflightSql, /private_trusted_telebirr_activation_control/u);
assert.match(inertPreflightSql, /private_trusted_telebirr_activation_epochs/u);
assert.match(inertPreflightSql, /private_live_deposit_pilot_revisions/u);
assert.match(inertPreflightSql, /private_trusted_telebirr_emergency_disable_intents/u);
assert.match(inertPreflightSql, /authority\.authority_state = 'active'/u);
assert.match(inertPreflightSql, /authority\.revoked_at is null/u);
assert.match(inertPreflightSql, /authority\.expires_at > pg_catalog\.clock_timestamp\(\)/u);
assert.doesNotMatch(inertPreflightSql, /current_private_trusted_telebirr_activation_epoch/u);
assert.match(inertPreflightSql, /count\(\*\) = 7 as exact_inert_feature_switches/u);
assert.match(
  inertPreflightSql,
  /feature_switch\.mode = 'disabled'\s+and feature_switch\.settings = '\{\}'::jsonb/u,
);
assert.doesNotMatch(inertPreflightSql, /feature_switch\.mode in \('disabled', 'dry_run'\)/u);
assert.match(inertPreflightSql, /exact_routine_candidate_grant/u);
assert.match(
  inertPreflightSql,
  /capture_telegram_routine_telebirr_untrusted_proof\(uuid,text,text,text,text,text,smallint,smallint,text\)/u,
);
assert.match(inertPreflightSql, /has_function_privilege\(/u);
assert.match(inertPreflightSql, /pg_catalog\.aclexplode\(/u);
for (const feature of [
  'cbe_birr_authoritative_verification',
  'deposit_execution',
  'payment_verification',
  'telebirr_authoritative_verification',
  'withdrawal_collection',
  'withdrawal_validation',
  'private_live_deposit_pilot',
]) {
  assert.match(inertPreflightSql, new RegExp(escapeRegExp(feature), 'u'));
}
assert.match(inertPreflightSql, /agent_platform_companion_execution_control/u);
assert.match(inertPreflightSql, /control_state = 'disabled'/u);
assert.match(inertPreflightSql, /fetanagent_trusted_telebirr_verifier_runtime/u);
assert.match(inertPreflightSql, /fetanagent_deposit_executor_runtime/u);
assert.match(inertPreflightSql, /not pg_catalog\.bool_or\(role\.rolcanlogin\)/u);
assert.match(inertPreflightSql, /pg_catalog\.pg_stat_activity/u);
assert.match(inertPreflightSql, /rollback;/u);
assert.match(cbeLivePreflightSql, /begin transaction isolation level serializable read only/u);
assert.match(cbeLivePreflightSql, /exact_cbe_live_feature_switches/u);
assert.match(cbeLivePreflightSql, /receiver_sms_route_enabled/u);
assert.match(cbeLivePreflightSql, /receiver_sms_logins_ready/u);
assert.match(cbeLivePreflightSql, /receiver_sms_grants_ready/u);
assert.match(cbeLivePreflightSql, /financial_runtime_sessions_absent/u);
assert.match(cbeLivePreflightSql, /rollback;/u);
assert.match(cbeStoppedPreflightSql, /begin transaction isolation level serializable read only/u);
assert.match(cbeStoppedPreflightSql, /exact_cbe_stopped_feature_switches/u);
assert.match(cbeStoppedPreflightSql, /receiver_sms_route_enabled/u);
assert.match(cbeStoppedPreflightSql, /receiver_sms_logins_ready/u);
assert.match(cbeStoppedPreflightSql, /receiver_sms_grants_ready/u);
assert.match(cbeStoppedPreflightSql, /financial_runtime_sessions_absent/u);
assert.match(cbeStoppedPreflightSql, /rollback;/u);
assert.match(cbeLiveCutoverIdleSql, /begin transaction isolation level serializable read only/u);
assert.match(cbeLiveCutoverIdleSql, /from app\.deposit_jobs job/u);
assert.match(cbeLiveCutoverIdleSql, /from app\.deposit_execution_attempts attempt/u);
assert.match(cbeLiveCutoverIdleSql, /rollback;/u);
for (const [feature, mode] of [
  ['cbe_birr_authoritative_verification', 'live'],
  ['deposit_execution', 'live'],
  ['payment_verification', 'live'],
  ['private_live_deposit_pilot', 'disabled'],
  ['telebirr_authoritative_verification', 'disabled'],
  ['withdrawal_collection', 'disabled'],
  ['withdrawal_validation', 'disabled'],
]) {
  assert.match(
    cbeLivePreflightSql,
    new RegExp(escapeRegExp("('" + feature + "', '" + mode + "')"), 'u'),
  );
}
for (const [feature, mode] of [
  ['cbe_birr_authoritative_verification', 'live'],
  ['deposit_execution', 'disabled'],
  ['payment_verification', 'disabled'],
  ['private_live_deposit_pilot', 'disabled'],
  ['telebirr_authoritative_verification', 'disabled'],
  ['withdrawal_collection', 'disabled'],
  ['withdrawal_validation', 'disabled'],
]) {
  assert.match(
    cbeStoppedPreflightSql,
    new RegExp(escapeRegExp("('" + feature + "', '" + mode + "')"), 'u'),
  );
}
assert.match(financialSwitchFingerprintSql, /pg_catalog\.md5\(pg_catalog\.string_agg\(/u);
assert.match(financialSwitchFingerprintSql, /feature_switch\.updated_at::text/u);
assert.doesNotMatch(
  financialSwitchFingerprintSql,
  /\b(?:insert|update|delete|alter|create|drop)\b/iu,
);
assert.doesNotMatch(
  inertPreflightSql.replace(/'[^']*'/gu, ''),
  /\b(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|execute|perform)\b|pg_(?:try_)?advisory/iu,
);

assert.match(packageJson, /node infra\/verify-production-runtime\.mjs/u);
assert.match(quality, /bash -n infra\/operations\/fetanagent-production-deploy-helper\.sh/u);
assert.match(quality, /--file infra\/compose\.production\.yaml/u);
assert.match(quality, /--file infra\/compose\.production\.inert-maintenance\.yaml/u);
assert.match(quality, /--profile production config --quiet/u);
assert.match(
  quality,
  /node --test infra\/operations\/prepare-production-companion-bundle\.test\.mjs/u,
);
assert.match(workflow, /node infra\/operations\/prepare-production-companion-bundle\.mjs/u);
assert.match(workflow, /COMPANION_PREVIOUS_LOGIN/u);
assert.match(workflow, /production-companion-runtime-disable\.sql/u);
assert.match(
  disableSql,
  /alter role fetanagent_companion_device_bridge_runtime nologin password null/u,
);
const companionTrust = await read('infra/sql/production-companion-server-signer-provision.sql');
const companionLogin = await read(
  'infra/sql/production-companion-bridge-runtime-enable-continuous.sql',
);
for (const sql of [companionTrust, companionLogin]) {
  assert.match(sql, /xzztugbgtulptnbpoelr/u);
  assert.match(sql, /begin transaction isolation level serializable/u);
  assert.match(sql, /financial_features_safe/u);
  assert.doesNotMatch(sql, /staging|spzpiyxheappsfyswewl|supabase_admin/u);
}
assert.match(companionTrust, /companion-server-production-v1/u);
assert.match(companionTrust, /exact_safe_replay/u);
assert.match(companionTrust, /server_signer_revocations/u);
assert.match(companionLogin, /rolconnlimit = 1/u);
assert.match(companionLogin, /not role\.rolbypassrls/u);
assert.match(companionLogin, /not membership\.set_option/u);
assert.match(companionLogin, /role\.rolvaliduntil = 'infinity'::timestamptz/u);

await import('./verify-production-rollback.mjs');

console.log(
  'Production runtime verified: production-only target binding, permanent least-privilege logins, sealed secrets, non-root web and Android enrollment services, fail-closed financial authority, atomic public cutover, and rollback.',
);
