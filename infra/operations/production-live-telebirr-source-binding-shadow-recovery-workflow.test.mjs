import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL(
    '../../.github/workflows/production-live-telebirr-source-binding-shadow-recovery.yml',
    import.meta.url,
  ),
  'utf8',
);
const operation = readFileSync(
  new URL('../sql/production-live-telebirr-source-binding-shadow-recovery.sql', import.meta.url),
  'utf8',
);

test('reviewed source-binding shadow workflow is exact, redacted, and no-money', () => {
  assert.match(workflow, /refs\/heads\/main/u);
  assert.match(workflow, /require-production-ci\.mjs/u);
  assert.match(workflow, /CREATE ONE REVIEWED TELEBIRR SHADOW REQUEST - NO MONEY/u);
  assert.match(workflow, /identifiersRedacted == true/u);
  assert.match(workflow, /\.moneyMoved == false/u);
  assert.match(operation, /shadowAttemptCount/u);
  assert.match(operation, /private_live_deposit_pilot_reservations/u);
  assert.match(operation, /private_live_telebirr_settlement_receipts/u);
  assert.match(operation, /app\.deposit_jobs/u);
  assert.doesNotMatch(workflow, /FINANCIAL_ACTIONS_MODE=live/u);
  assert.doesNotMatch(workflow, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true/u);
});
