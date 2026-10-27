import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = JSON.parse(readFileSync(0, 'utf8'));
const services = compose.services;
const broker = services['telebirr-assignment-broker'];
const bridge = services['telebirr-device-bridge'];
const api = services.api;
const bot = services.bot;

assert.equal(broker.environment.FINANCIAL_ACTIONS_MODE, 'dry_run');
assert.equal(broker.environment.TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED, 'true');
assert.equal(broker.environment.INTERNAL_ROUTINE_NO_MONEY_BROKER_ENABLED, 'true');
assert.equal(broker.environment.INTERNAL_RECEIVER_SMS_BROKER_ENABLED, 'true');
assert.equal(broker.environment.INTERNAL_RECEIVER_SMS_OWNER_DISPLAY_ENABLED, 'true');
assert.equal(broker.environment.INTERNAL_RECEIVER_SMS_SETTLEMENT_ENABLED, 'true');
assert.equal(broker.environment.INTERNAL_ROUTINE_PAID_POLL_BROKER_ENABLED, undefined);
assert.equal(broker.environment.KEMERBET_FINAL_ACTION_ENABLED, 'false');
assert.equal(bridge.environment.INTERNAL_ROUTINE_NO_MONEY_BRIDGE_ENABLED, 'true');
assert.equal(bridge.environment.INTERNAL_RECEIVER_SMS_BRIDGE_ENABLED, 'true');
assert.equal(bridge.environment.INTERNAL_ROUTINE_PAID_POLL_BRIDGE_ENABLED, undefined);
assert.equal(bridge.environment.INTERNAL_ROUTINE_PAID_UPLOAD_BRIDGE_ENABLED, undefined);
assert.equal(api.environment.TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_PRODUCTION_ENABLED, 'false');
assert.equal(api.environment.TELEGRAM_RECEIVER_SMS_CANDIDATE_PRODUCTION_ENABLED, 'true');
assert.equal(bot.environment.BOT_RECEIVER_SMS_CANDIDATE_ENABLED, 'true');
assert.equal(services['routine-paid-settlement'], undefined);

assert.deepEqual(
  broker.secrets.map(({ target }) => target).sort(),
  [
    'receiver_sms_ingest_database_url',
    'receiver_sms_owner_display_encryption_master',
    'receiver_sms_reference_fingerprint_master',
    'receiver_sms_settlement_database_url',
    'routine_no_money_database_url',
    'routine_no_money_lookup_signer.pkcs8.der',
    'routine_no_money_lookup_signer.v1.json',
    'routine_no_money_reference_opening_key.v1.json',
  ].sort(),
);

console.log('CBE-stopped phone proof and receiver SMS compose boundary verified.');
