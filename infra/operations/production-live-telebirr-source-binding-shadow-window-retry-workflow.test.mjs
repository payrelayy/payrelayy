import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL(
    '../../.github/workflows/production-live-telebirr-source-binding-shadow-window-retry.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL(
    '../sql/production-live-telebirr-source-binding-shadow-window-retry.sql',
    import.meta.url,
  ),
  'utf8',
);

test('source-binding shadow-window retry is exact, paired, redacted, and no-money', () => {
  assert.match(workflow, /refs\/heads\/main/u);
  assert.match(workflow, /require-production-ci\.mjs/u);
  assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR SHADOW WINDOW RETRY - NO MONEY/u);
  assert.match(workflow, /readyEnrollmentCount == 1/u);
  assert.match(workflow, /identifiersRedacted == true/u);
  assert.match(workflow, /\.moneyMoved == false/u);
  assert.match(operation, /sourceShadowAttemptCount/u);
  assert.match(operation, /replacementShadowAttemptCount/u);
  assert.match(operation, /private_live_deposit_pilot_reservations/u);
  assert.match(operation, /private_live_telebirr_settlement_receipts/u);
  assert.match(operation, /app\.deposit_jobs/u);
  assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
  assert.doesNotMatch(workflow, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true/u);
});
