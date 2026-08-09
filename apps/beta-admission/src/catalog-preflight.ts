/**
 * The future beta-admission deployment boundary may inject the result of a separately reviewed,
 * catalog-only database preflight here. This module deliberately owns no connection, SQL text,
 * client, pool, CLI, or startup path.
 */
export interface BetaAdmissionPreflightRow {
  readonly runtime_login_identity_allowed: boolean;
  readonly runtime_login_is_safe: boolean;
  readonly beta_role_membership_shape_allowed: boolean;
  readonly beta_role_usage_allowed: boolean;
  readonly beta_role_set_denied: boolean;
  readonly no_other_direct_role_memberships: boolean;
  readonly beta_group_has_no_parent_roles: boolean;
  readonly beta_role_only_expected_members: boolean;
  readonly app_schema_usage_allowed: boolean;
  readonly app_schema_create_denied: boolean;
  readonly no_direct_base_object_access: boolean;
  readonly no_app_object_ownership: boolean;
  readonly redemption_execute_allowed: boolean;
  readonly nonce_reservation_execute_allowed: boolean;
  readonly admitted_inbox_recorder_execute_denied: boolean;
  readonly legacy_inbox_recorder_execute_denied: boolean;
  readonly generic_nonce_reservation_execute_denied: boolean;
  readonly beta_nonce_purge_execute_denied: boolean;
  readonly no_other_app_function_execute_allowed: boolean;
  readonly allowed_procedures_security_definer_safe_path: boolean;
  readonly allowed_procedures_execution_is_private: boolean;
  readonly beta_boundary_tables_forced_rls_no_policies: boolean;
  readonly default_function_execution_is_private: boolean;
}

export interface BetaAdmissionPreflightResult {
  readonly passed: boolean;
  readonly runtimeLoginIdentityAllowed: boolean;
  readonly runtimeLoginIsSafe: boolean;
  readonly betaRoleMembershipShapeAllowed: boolean;
  readonly betaRoleUsageAllowed: boolean;
  readonly betaRoleSetDenied: boolean;
  readonly noOtherDirectRoleMemberships: boolean;
  readonly betaGroupHasNoParentRoles: boolean;
  readonly betaRoleOnlyExpectedMembers: boolean;
  readonly appSchemaUsageAllowed: boolean;
  readonly appSchemaCreateDenied: boolean;
  readonly noDirectBaseObjectAccess: boolean;
  readonly noAppObjectOwnership: boolean;
  readonly redemptionExecuteAllowed: boolean;
  readonly nonceReservationExecuteAllowed: boolean;
  readonly admittedInboxRecorderExecuteDenied: boolean;
  readonly legacyInboxRecorderExecuteDenied: boolean;
  readonly genericNonceReservationExecuteDenied: boolean;
  readonly betaNoncePurgeExecuteDenied: boolean;
  readonly noOtherAppFunctionExecuteAllowed: boolean;
  readonly allowedProceduresSecurityDefinerSafePath: boolean;
  readonly allowedProceduresExecutionIsPrivate: boolean;
  readonly betaBoundaryTablesForcedRlsNoPolicies: boolean;
  readonly defaultFunctionExecutionIsPrivate: boolean;
}

function asBoolean(row: Record<string, unknown>, field: keyof BetaAdmissionPreflightRow): boolean {
  const value = row[field];
  if (typeof value !== 'boolean') {
    throw new Error('The beta-admission catalog preflight returned an invalid result.');
  }
  return value;
}

/**
 * Converts a caller-injected catalog result to a closed result object. Every missing, malformed,
 * or false capability fact fails the preflight; this parser performs no I/O of any kind.
 */
export function parseBetaAdmissionCatalogPreflightResult(
  row: unknown,
): BetaAdmissionPreflightResult {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('The beta-admission catalog preflight returned an invalid result.');
  }

  const catalogRow = row as Record<string, unknown>;
  const checks = {
    runtimeLoginIdentityAllowed: asBoolean(catalogRow, 'runtime_login_identity_allowed'),
    runtimeLoginIsSafe: asBoolean(catalogRow, 'runtime_login_is_safe'),
    betaRoleMembershipShapeAllowed: asBoolean(catalogRow, 'beta_role_membership_shape_allowed'),
    betaRoleUsageAllowed: asBoolean(catalogRow, 'beta_role_usage_allowed'),
    betaRoleSetDenied: asBoolean(catalogRow, 'beta_role_set_denied'),
    noOtherDirectRoleMemberships: asBoolean(catalogRow, 'no_other_direct_role_memberships'),
    betaGroupHasNoParentRoles: asBoolean(catalogRow, 'beta_group_has_no_parent_roles'),
    betaRoleOnlyExpectedMembers: asBoolean(catalogRow, 'beta_role_only_expected_members'),
    appSchemaUsageAllowed: asBoolean(catalogRow, 'app_schema_usage_allowed'),
    appSchemaCreateDenied: asBoolean(catalogRow, 'app_schema_create_denied'),
    noDirectBaseObjectAccess: asBoolean(catalogRow, 'no_direct_base_object_access'),
    noAppObjectOwnership: asBoolean(catalogRow, 'no_app_object_ownership'),
    redemptionExecuteAllowed: asBoolean(catalogRow, 'redemption_execute_allowed'),
    nonceReservationExecuteAllowed: asBoolean(catalogRow, 'nonce_reservation_execute_allowed'),
    admittedInboxRecorderExecuteDenied: asBoolean(
      catalogRow,
      'admitted_inbox_recorder_execute_denied',
    ),
    legacyInboxRecorderExecuteDenied: asBoolean(catalogRow, 'legacy_inbox_recorder_execute_denied'),
    genericNonceReservationExecuteDenied: asBoolean(
      catalogRow,
      'generic_nonce_reservation_execute_denied',
    ),
    betaNoncePurgeExecuteDenied: asBoolean(catalogRow, 'beta_nonce_purge_execute_denied'),
    noOtherAppFunctionExecuteAllowed: asBoolean(
      catalogRow,
      'no_other_app_function_execute_allowed',
    ),
    allowedProceduresSecurityDefinerSafePath: asBoolean(
      catalogRow,
      'allowed_procedures_security_definer_safe_path',
    ),
    allowedProceduresExecutionIsPrivate: asBoolean(
      catalogRow,
      'allowed_procedures_execution_is_private',
    ),
    betaBoundaryTablesForcedRlsNoPolicies: asBoolean(
      catalogRow,
      'beta_boundary_tables_forced_rls_no_policies',
    ),
    defaultFunctionExecutionIsPrivate: asBoolean(
      catalogRow,
      'default_function_execution_is_private',
    ),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    ...checks,
  };
}
