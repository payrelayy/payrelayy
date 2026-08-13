import { describe, expect, it } from 'vitest';

import {
  runNonceRetentionDatabasePreflight,
  type NonceRetentionDatabasePreflightClient,
  type NonceRetentionDatabasePreflightPool,
} from './database-preflight.js';

const enabledMaintenanceConfig = {
  enabled: true as const,
  connection: {
    database: 'postgres' as const,
    host: 'db.example.test',
    password: 'example-only',
    port: 5432 as const,
    user: 'fetanagent_nonce_retention_runtime',
  },
  tlsMode: 'verify-full' as const,
};

const passingRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  nonce_retention_group_shape_allowed: true,
  nonce_retention_group_has_no_parent_roles: true,
  nonce_retention_group_members_allowed: true,
  nonce_retention_runtime_members_allowed: true,
  nonce_retention_role_membership_shape_allowed: true,
  nonce_retention_role_usage_allowed: true,
  nonce_retention_role_set_denied: true,
  no_other_direct_role_memberships: true,
  app_schema_usage_allowed: true,
  app_schema_create_denied: true,
  app_relation_access_denied: true,
  app_sequence_access_denied: true,
  nonce_purge_execute_allowed: true,
  nonce_retention_group_purge_execute_allowed: true,
  nonce_purge_execution_is_private: true,
  nonce_purge_function_security_shape_allowed: true,
  nonce_reservation_execute_denied: true,
  runtime_has_no_direct_app_function_grants: true,
  only_nonce_purge_app_function_executable: true,
  public_app_function_execution_denied: true,
  default_public_function_execution_denied: true,
};

function createFakePool(options: {
  readonly row?: Record<string, boolean>;
  readonly rows?: readonly unknown[];
  readonly failOnCatalogQuery?: boolean;
}): {
  readonly pool: NonceRetentionDatabasePreflightPool;
  readonly queries: string[];
  readonly released: () => boolean;
  readonly ended: () => boolean;
} {
  const queries: string[] = [];
  let releaseCalled = false;
  let endCalled = false;

  const client: NonceRetentionDatabasePreflightClient = {
    async query(query) {
      queries.push(query);
      if (options.failOnCatalogQuery && query.includes('from pg_catalog.pg_roles')) {
        throw new Error('synthetic database failure');
      }
      return {
        rows: query.includes('from pg_catalog.pg_roles')
          ? (options.rows ?? [options.row ?? passingRow])
          : [],
      };
    },
    release() {
      releaseCalled = true;
    },
  };

  return {
    pool: {
      async connect() {
        return client;
      },
      async end() {
        endCalled = true;
      },
    },
    queries,
    released: () => releaseCalled,
    ended: () => endCalled,
  };
}

describe('nonce-retention database preflight', () => {
  it('checks only catalog capabilities inside a read-only transaction and rolls back', async () => {
    const fake = createFakePool({});

    const result = await runNonceRetentionDatabasePreflight(enabledMaintenanceConfig, {
      pool: fake.pool,
    });

    expect(result.passed).toBe(true);
    expect(result.noncePurgeExecuteAllowed).toBe(true);
    expect(result.onlyNoncePurgeAppFunctionExecutable).toBe(true);
    expect(result.nonceReservationExecuteDenied).toBe(true);
    expect(fake.queries[0]).toBe('begin transaction read only');
    expect(fake.queries).toContain("set local statement_timeout = '5s'");
    expect(fake.queries).toContain("set local lock_timeout = '1s'");
    expect(fake.queries).toContain('set local search_path = pg_catalog');
    const catalogQuery = fake.queries.find((query) => query.includes('from pg_catalog.pg_roles'));
    expect(catalogQuery).toContain('pg_catalog.aclexplode');
    expect(catalogQuery).not.toMatch(/has_function_privilege\(\s*'public'/);
    expect(fake.queries.at(-1)).toBe('rollback');
    expect(
      fake.queries.filter((query) => /^(insert|update|delete|truncate)\b/i.test(query.trim())),
    ).toEqual([]);
    expect(fake.released()).toBe(true);
    expect(fake.ended()).toBe(true);
  });

  it('fails closed for every individual privilege or identity mismatch', async () => {
    for (const checkName of Object.keys(passingRow)) {
      const fake = createFakePool({
        row: { ...passingRow, [checkName]: false },
      });

      const result = await runNonceRetentionDatabasePreflight(enabledMaintenanceConfig, {
        pool: fake.pool,
      });

      expect(result.passed).toBe(false);
      expect(Object.values(result)).toContain(false);
    }
  });

  it('fails closed for a malformed or non-singleton catalog result', async () => {
    const noRows = createFakePool({ rows: [] });
    await expect(
      runNonceRetentionDatabasePreflight(enabledMaintenanceConfig, { pool: noRows.pool }),
    ).rejects.toThrow('invalid result');
    expect(noRows.queries.at(-1)).toBe('rollback');
    expect(noRows.released()).toBe(true);
    expect(noRows.ended()).toBe(true);

    const malformed = createFakePool({
      rows: [{ ...passingRow, app_sequence_access_denied: 'true' }],
    });
    await expect(
      runNonceRetentionDatabasePreflight(enabledMaintenanceConfig, { pool: malformed.pool }),
    ).rejects.toThrow('invalid result');

    const duplicate = createFakePool({ rows: [passingRow, passingRow] });
    await expect(
      runNonceRetentionDatabasePreflight(enabledMaintenanceConfig, { pool: duplicate.pool }),
    ).rejects.toThrow('invalid result');
  });

  it('rolls back and closes the pool when the catalog check fails', async () => {
    const fake = createFakePool({ failOnCatalogQuery: true });

    await expect(
      runNonceRetentionDatabasePreflight(enabledMaintenanceConfig, { pool: fake.pool }),
    ).rejects.toThrow('synthetic database failure');

    expect(fake.queries.at(-1)).toBe('rollback');
    expect(fake.released()).toBe(true);
    expect(fake.ended()).toBe(true);
  });
});
