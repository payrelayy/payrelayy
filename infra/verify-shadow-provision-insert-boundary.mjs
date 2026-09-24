import assert from 'node:assert/strict';

// Provisioning may mint one bounded phone-assignment authority, but no financial,
// provider, receipt, queue, or second proof row.
export function assertOnlyScopedShadowAssignmentInsert(provision) {
  assert.deepEqual(
    [...provision.matchAll(/\binsert\s+into\s+app\.([a-z_]+)/giu)].map((match) => match[1]),
    ['private_telebirr_shadow_assignment_authorizations'],
  );
}
