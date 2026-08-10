import { describe, expect, it } from 'vitest';

import {
  BETA_ADMISSION_CATALOG_PREFLIGHT_SQL,
  parseBetaAdmissionCatalogPreflightResult,
  runBetaAdmissionCatalogPreflight,
  type BetaAdmissionPreflightRow,
} from './catalog-preflight.js';
import type { BetaAdmissionRuntimeConfig } from '@payreplayy/config/beta-admission';

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

const runtimeConfig = {
  enabled: true,
  stage: 'staging',
  projectReference: 'spzpiyxheappsfyswewl',
  connection: {
    database: 'postgres',
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    password: 'not-used-by-injected-pool',
    port: 5432,
    user: 'payreplayy_beta_admission_runtime.spzpiyxheappsfyswewl',
  },
  tlsMode: 'verify-full',
  transportHmacSecret: 'a'.repeat(64),
  payloadHmacSecret: 'b'.repeat(64),
} satisfies Extract<BetaAdmissionRuntimeConfig, { readonly enabled: true }>;

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

  it('fails closed when either managed creator/admin membership allowlist drifts', () => {
    const result = parseBetaAdmissionCatalogPreflightResult({
      ...passingRow,
      beta_role_only_expected_members: false,
    });

    expect(result.passed).toBe(false);
    expect(result.betaRoleOnlyExpectedMembers).toBe(false);
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain(
      "member_role.rolname not in ('payreplayy_beta_admission_runtime', 'postgres')",
    );
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain(
      "runtime_role.rolname = 'payreplayy_beta_admission_runtime'",
    );
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain('membership.admin_option');
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

  it('runs the catalog SELECT in an always-rolled-back read-only transaction', async () => {
    const queries: string[] = [];
    let releases = 0;
    let ends = 0;
    const result = await runBetaAdmissionCatalogPreflight(runtimeConfig, {
      pool: {
        connect: async () => ({
          query: async (query) => {
            queries.push(query);
            return { rows: query === BETA_ADMISSION_CATALOG_PREFLIGHT_SQL ? [passingRow] : [] };
          },
          release: () => {
            releases += 1;
          },
        }),
        end: async () => {
          ends += 1;
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(queries[0]).toBe('begin transaction read only');
    expect(queries).toContain('set local search_path = pg_catalog');
    expect(queries.at(-2)).toBe(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL);
    expect(queries.at(-1)).toBe('rollback');
    expect(releases).toBe(1);
    expect(ends).toBe(0);
  });

  it('proves only redemption and beta nonce execution while denying recorders and table access', () => {
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)',
    );
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.reserve_telegram_beta_invite_admission_nonce(text,timestamptz)',
    );
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain(
      'admitted_inbox_recorder_execute_denied',
    );
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain('no_direct_base_object_access');
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL).toContain(
      "routine.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]",
    );
    expect(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL.trimStart().startsWith('select')).toBe(true);
  });
});
