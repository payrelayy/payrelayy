import { describe, expect, it } from 'vitest';

import {
  runApiDatabasePreflight,
  type ApiDatabasePreflightClient,
  type ApiDatabasePreflightPool,
} from './database-preflight.js';

const enabledDatabaseConfig = {
  enabled: true as const,
  connection: {
    database: 'postgres' as const,
    host: 'db.example.test',
    password: 'example-only',
    port: 5432 as const,
    user: 'payreplayy_api_runtime',
  },
  tlsMode: 'verify-full' as const,
};

const passingRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  api_role_membership_shape_allowed: true,
  api_role_usage_allowed: true,
  api_role_set_denied: true,
  no_other_direct_role_memberships: true,
  app_schema_usage_allowed: true,
  app_schema_create_denied: true,
  inbox_recorder_execute_allowed: true,
  inbox_recorder_execution_is_private: true,
  nonce_reservation_execute_allowed: true,
  nonce_reservation_execution_is_private: true,
  private_telegram_boundary_table_access_denied: true,
  issue_player_registration_capability_denied: true,
  start_player_registration_action_denied: true,
  submit_player_registration_input_denied: true,
  expire_player_registration_action_denied: true,
};

function createFakePool(options: {
  readonly row?: Record<string, boolean>;
  readonly failOnCatalogQuery?: boolean;
}): {
  readonly pool: ApiDatabasePreflightPool;
  readonly queries: string[];
  readonly released: () => boolean;
  readonly ended: () => boolean;
} {
  const queries: string[] = [];
  let releaseCalled = false;
  let endCalled = false;

  const client: ApiDatabasePreflightClient = {
    async query(query) {
      queries.push(query);
      if (options.failOnCatalogQuery && query.includes('from pg_catalog.pg_roles')) {
        throw new Error('synthetic database failure');
      }
      return {
        rows: query.includes('from pg_catalog.pg_roles') ? [options.row ?? passingRow] : [],
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

describe('API database preflight', () => {
  it('checks only catalog capabilities inside a read-only transaction and rolls back', async () => {
    const fake = createFakePool({});

    const result = await runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool });

    expect(result.passed).toBe(true);
    expect(result.inboxRecorderExecuteAllowed).toBe(true);
    expect(result.inboxRecorderExecutionIsPrivate).toBe(true);
    expect(result.nonceReservationExecuteAllowed).toBe(true);
    expect(result.nonceReservationExecutionIsPrivate).toBe(true);
    expect(result.privateTelegramBoundaryTableAccessDenied).toBe(true);
    expect(result.submitPlayerRegistrationInputDenied).toBe(true);
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

  it('reports a least-privilege mismatch without treating the preflight as successful', async () => {
    const fake = createFakePool({
      row: { ...passingRow, start_player_registration_action_denied: false },
    });

    const result = await runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool });

    expect(result.passed).toBe(false);
    expect(result.startPlayerRegistrationActionDenied).toBe(false);
    expect(fake.queries.at(-1)).toBe('rollback');
    expect(fake.released()).toBe(true);
    expect(fake.ended()).toBe(true);
  });

  it('reports a missing nonce-reservation grant without treating the preflight as successful', async () => {
    const fake = createFakePool({
      row: { ...passingRow, nonce_reservation_execute_allowed: false },
    });

    const result = await runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool });

    expect(result.passed).toBe(false);
    expect(result.nonceReservationExecuteAllowed).toBe(false);
  });

  it('reports broad inbox-recorder execution without treating the preflight as successful', async () => {
    const fake = createFakePool({
      row: { ...passingRow, inbox_recorder_execution_is_private: false },
    });

    const result = await runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool });

    expect(result.passed).toBe(false);
    expect(result.inboxRecorderExecutionIsPrivate).toBe(false);
  });

  it('reports broad nonce-reservation execution without treating the preflight as successful', async () => {
    const fake = createFakePool({
      row: { ...passingRow, nonce_reservation_execution_is_private: false },
    });

    const result = await runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool });

    expect(result.passed).toBe(false);
    expect(result.nonceReservationExecutionIsPrivate).toBe(false);
  });

  it('fails when the connection does not resolve to the dedicated runtime login', async () => {
    const fake = createFakePool({
      row: { ...passingRow, runtime_login_identity_allowed: false },
    });

    const result = await runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool });

    expect(result.passed).toBe(false);
    expect(result.runtimeLoginIdentityAllowed).toBe(false);
  });

  it('rolls back and closes the pool when the catalog check fails', async () => {
    const fake = createFakePool({ failOnCatalogQuery: true });

    await expect(
      runApiDatabasePreflight(enabledDatabaseConfig, { pool: fake.pool }),
    ).rejects.toThrow('synthetic database failure');

    expect(fake.queries.at(-1)).toBe('rollback');
    expect(fake.released()).toBe(true);
    expect(fake.ended()).toBe(true);
  });
});
