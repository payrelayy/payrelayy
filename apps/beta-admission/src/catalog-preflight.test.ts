import { describe, expect, it } from 'vitest';

import {
  parseBetaAdmissionCatalogPreflightResult,
  type BetaAdmissionPreflightRow,
} from './catalog-preflight.js';

const passingRow: BetaAdmissionPreflightRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  beta_role_membership_shape_allowed: true,
  beta_role_usage_allowed: true,
  beta_role_set_denied: true,
  no_other_direct_role_memberships: true,
  beta_group_has_no_parent_roles: true,
  beta_role_only_expected_members: true,
  app_schema_usage_allowed: true,
  app_schema_create_denied: true,
  no_direct_base_object_access: true,
  no_app_object_ownership: true,
  redemption_execute_allowed: true,
  nonce_reservation_execute_allowed: true,
  admitted_inbox_recorder_execute_denied: true,
  legacy_inbox_recorder_execute_denied: true,
  generic_nonce_reservation_execute_denied: true,
  beta_nonce_purge_execute_denied: true,
  no_other_app_function_execute_allowed: true,
  allowed_procedures_security_definer_safe_path: true,
  allowed_procedures_execution_is_private: true,
  beta_boundary_tables_forced_rls_no_policies: true,
  default_function_execution_is_private: true,
};

describe('beta-admission catalog preflight contract', () => {
  it('maps a complete passing catalog result without performing I/O', () => {
    expect(parseBetaAdmissionCatalogPreflightResult(passingRow)).toMatchObject({
      passed: true,
      redemptionExecuteAllowed: true,
      nonceReservationExecuteAllowed: true,
      admittedInboxRecorderExecuteDenied: true,
      defaultFunctionExecutionIsPrivate: true,
    });
  });

  it('fails closed for every false capability fact', () => {
    for (const field of Object.keys(passingRow) as (keyof BetaAdmissionPreflightRow)[]) {
      const result = parseBetaAdmissionCatalogPreflightResult({ ...passingRow, [field]: false });

      expect(result.passed).toBe(false);
      expect(Object.values(result)).toContain(false);
    }
  });

  it('rejects missing, malformed, and non-single-row values with a generic error', () => {
    const { redemption_execute_allowed: _removedField, ...missingField } = passingRow;

    for (const malformed of [
      undefined,
      null,
      [],
      missingField,
      { ...passingRow, beta_role_usage_allowed: 'true' },
    ]) {
      expect(() => parseBetaAdmissionCatalogPreflightResult(malformed)).toThrow(
        'The beta-admission catalog preflight returned an invalid result.',
      );
    }
  });
});
