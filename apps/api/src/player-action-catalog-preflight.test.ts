import { describe, expect, it } from 'vitest';

import {
  PLAYER_ACTION_CATALOG_PREFLIGHT_SQL,
  playerActionCatalogPreflightPassed,
} from './player-action-catalog-preflight.js';

const passingRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  only_expected_direct_membership: true,
  group_usage_allowed_set_denied: true,
  group_only_expected_members: true,
  app_schema_boundary_allowed: true,
  no_app_base_object_access: true,
  exact_function_surface_allowed: true,
  allowed_functions_hardened: true,
  allowed_functions_execution_private: true,
  nonce_table_forced_rls_no_policies: true,
  default_function_execution_private: true,
} as const;

describe('Player-ID action catalog preflight', () => {
  it('passes only one complete all-true catalog row', async () => {
    await expect(
      playerActionCatalogPreflightPassed({
        query: async () => ({ rows: [passingRow] }),
      }),
    ).resolves.toBe(true);
  });

  it.each(Object.keys(passingRow))('fails closed when %s is false', async (field) => {
    await expect(
      playerActionCatalogPreflightPassed({
        query: async () => ({ rows: [{ ...passingRow, [field]: false }] }),
      }),
    ).resolves.toBe(false);
  });

  it('fails malformed or multiple rows and contains no DML', async () => {
    await expect(
      playerActionCatalogPreflightPassed({ query: async () => ({ rows: [] }) }),
    ).resolves.toBe(false);
    await expect(
      playerActionCatalogPreflightPassed({
        query: async () => ({ rows: [passingRow, passingRow] }),
      }),
    ).resolves.toBe(false);
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL.trimStart()).toMatch(/^select\b/iu);
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).not.toMatch(
      /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/imu,
    );
  });
});
