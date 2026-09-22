import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const workflow = read('../.github/workflows/production-telebirr-receipt-shape-retry-preflight.yml');
const operation = read('./sql/production-telebirr-receipt-shape-retry-preflight.sql');

assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /RUN ONE NO WRITE TELEBIRR RECEIPT SHAPE RETRY PREFLIGHT/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /trap 'rm -f -- "\$ca_file"' EXIT/u);
assert.match(workflow, /source_count/u);
assert.match(workflow, /invoice_review_count/u);
assert.match(workflow, /no_money_boundary/u);
assert.match(workflow, /GITHUB_STEP_SUMMARY/u);
assert.doesNotMatch(workflow, /echo\s+"\$result"/u);

const executable = operation.replace(/^--.*$/gmu, '');
assert.match(executable, /^begin isolation level read committed;$/mu);
assert.match(executable, /^rollback;$/mu);
assert.equal((executable.match(/^rollback;$/gmu) ?? []).length, 1);
assert.match(executable, /private_telebirr_shadow_receipt_shape_diag_retries/u);
assert.match(executable, /private_telebirr_shadow_receipt_cell_opening_retry_is_valid/u);
assert.match(executable, /unknown_layout_invoice_number/u);
assert.match(executable, /observation_body_digest = source\.observation_body_digest/u);
assert.match(executable, /pilot\.expires_at > assessed\.at_time \+ interval '1 hour'/u);
assert.match(executable, /heartbeat\.status_code = 'no_assignment'/u);
assert.match(executable, /'identifiersRedacted', true/u);
assert.match(executable, /'noWrite', true/u);
assert.match(executable, /'rolledBack', true/u);
assert.doesNotMatch(
  executable,
  /\b(?:insert|update|delete|alter|create|drop|truncate|grant|execute|call)\b/iu,
);

console.log('Production receipt-shape retry no-write preflight contract verified.');
