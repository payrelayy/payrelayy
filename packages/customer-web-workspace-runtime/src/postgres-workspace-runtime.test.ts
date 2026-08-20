import type { CustomerWebWorkspaceConfig } from '@fetanagent/config/customer-web';
import { describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_CUSTOMER_WEB_DEPOSIT_REFERENCE_SQL,
  CAPTURE_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_SQL,
  CONSUME_CUSTOMER_WEB_RATE_LIMIT_SQL,
  createCustomerWorkspacePoolConfig,
  createCustomerWorkspacePostgresRuntime,
  CustomerWorkspaceRuntimeUnavailableError,
  ENSURE_CUSTOMER_WEB_ACCOUNT_SQL,
  LIST_CUSTOMER_WEB_DEPOSITS_SQL,
  LIST_CUSTOMER_WEB_PLAYER_REGISTRATIONS_SQL,
  OPEN_CUSTOMER_WEB_DEPOSIT_INTENT_SQL,
  SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL,
  type CustomerWorkspaceDatabase,
} from './postgres-workspace-runtime.js';
import {
  CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL,
  customerWorkspaceCatalogPreflightPassed,
} from './workspace-catalog-preflight.js';

const authUserId = '018f1f58-91bd-7cc0-9e5a-5bda1d0c0184';
const requestKey = '4f8e2a44-58ef-4cb7-b274-6202e01ed341';
const depositIntentId = '018f1f58-91bd-7cc0-9e5a-5bda1d0c0185';
const depositProofRequestId = '018f1f58-91bd-7cc0-9e5a-5bda1d0c0186';
const createdAt = new Date('2026-08-15T12:00:00.000Z');

const config = {
  connection: {
    database: 'postgres',
    host: 'db.spzpiyxheappsfyswewl.supabase.co',
    password: 'test-password',
    port: 5432,
    user: 'fetanagent_customer_web_runtime',
  },
  enabled: true,
  projectReference: 'spzpiyxheappsfyswewl',
  stage: 'staging',
  tlsMode: 'verify-full',
} satisfies Extract<CustomerWebWorkspaceConfig, { readonly enabled: true }>;

const passingPreflightRow = Object.freeze({
  allowed_functions_execution_private: true,
  allowed_functions_hardened: true,
  app_schema_boundary_allowed: true,
  default_function_execution_private: true,
  exact_function_surface_allowed: true,
  group_has_no_upstream_membership: true,
  group_only_expected_members: true,
  group_role_is_safe: true,
  group_usage_allowed_set_denied: true,
  no_app_base_object_access: true,
  only_expected_direct_membership: true,
  runtime_only_trusted_members: true,
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
});

interface FakeDatabase extends CustomerWorkspaceDatabase {
  readonly end: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly emitError: (error?: Error) => void;
  readonly queries: { readonly query: string; readonly values: readonly unknown[] }[];
}

function fakeDatabase(
  resolve: (
    query: string,
    values: readonly unknown[],
    invocation: number,
  ) => readonly unknown[] | Promise<readonly unknown[]>,
): FakeDatabase {
  const queries: { readonly query: string; readonly values: readonly unknown[] }[] = [];
  const errorListeners: ((error: Error) => void)[] = [];
  let invocation = 0;
  return {
    end: vi.fn(async () => undefined),
    emitError(error = new Error('database pool error')) {
      for (const listener of errorListeners) listener(error);
    },
    on(event, listener) {
      if (event === 'error') errorListeners.push(listener);
      return this;
    },
    queries,
    async query(query, values) {
      queries.push({ query, values: [...values] });
      invocation += 1;
      return { rows: await resolve(query, values, invocation) };
    },
  };
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function expectAllOperationsUnavailableWithoutQueries(
  runtime: Awaited<ReturnType<typeof createCustomerWorkspacePostgresRuntime>>,
  database: FakeDatabase,
): Promise<void> {
  const queryCount = database.queries.length;
  const failure = { error: 'customer_workspace_unavailable', ok: false } as const;

  expect(await runtime.ensureAccount({ authUserId })).toEqual(failure);
  expect(
    await runtime.consumeRateLimit({
      bucketKey: 'a'.repeat(64),
      maxRequests: 8,
      routeKey: 'POST /sign-in',
      windowSeconds: 60,
    }),
  ).toEqual(failure);
  expect(await runtime.listDeposits({ authUserId, limit: 20 })).toEqual(failure);
  expect(await runtime.listPlayerRegistrations({ authUserId, limit: 20 })).toEqual(failure);
  expect(
    await runtime.openDeposit({
      amountMinor: '2500',
      authUserId,
      playerId: 'PLAYER-42',
      requestKey,
    }),
  ).toEqual(failure);
  expect(
    await runtime.captureDryRunDepositProof({
      authUserId,
      ciphertext: 'v2.cbe_birr.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAA',
      fingerprint: 'b'.repeat(64),
      keyVersion: 2,
      masked: '***AB12',
      playerId: 'PLAYER-42',
      profileVersion: 2,
      provider: 'cbe_birr',
      requestKey,
    }),
  ).toEqual(failure);
  expect(
    await runtime.captureDepositReference({
      authUserId,
      ciphertext: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAA',
      depositIntentId,
      fingerprint: 'a'.repeat(64),
      keyVersion: 1,
      masked: '***1234',
      requestKey,
    }),
  ).toEqual(failure);
  expect(
    await runtime.submitPlayerRegistration({
      authUserId,
      playerId: 'PLAYER-42',
      requestKey,
    }),
  ).toEqual(failure);
  expect(database.queries).toHaveLength(queryCount);
}

function databaseWithOperations(
  operation: (
    query: string,
    values: readonly unknown[],
  ) => readonly unknown[] | Promise<readonly unknown[]>,
): FakeDatabase {
  return fakeDatabase((query, values) =>
    query === CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL
      ? [passingPreflightRow]
      : operation(query, values),
  );
}

describe('dedicated customer workspace direct-Postgres runtime', () => {
  it('builds an exact verify-full, max-one pool with bounded client and server timeouts', () => {
    expect(createCustomerWorkspacePoolConfig(config)).toEqual({
      application_name: 'fetanagent-customer-web',
      connectionTimeoutMillis: 5_000,
      database: 'postgres',
      host: 'db.spzpiyxheappsfyswewl.supabase.co',
      idleTimeoutMillis: 10_000,
      idle_in_transaction_session_timeout: 5_000,
      lock_timeout: 1_000,
      max: 1,
      min: 0,
      password: 'test-password',
      port: 5432,
      query_timeout: 5_000,
      ssl: { rejectUnauthorized: true },
      statement_timeout: 5_000,
      user: 'fetanagent_customer_web_runtime',
    });

    expect(() =>
      createCustomerWorkspacePoolConfig({
        ...config,
        tlsMode: 'require',
      } as unknown as typeof config),
    ).toThrow(CustomerWorkspaceRuntimeUnavailableError);
    expect(() =>
      createCustomerWorkspacePoolConfig({
        ...config,
        connection: { ...config.connection, user: 'postgres' },
      } as unknown as typeof config),
    ).toThrow(CustomerWorkspaceRuntimeUnavailableError);
  });

  it('pins the catalog preflight to the exact role, membership, base-object, and function surface', () => {
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "current_user = 'fetanagent_customer_web_runtime'",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain('role.rolconnlimit = 2');
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain('membership.inherit_option');
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "where granted.rolname = 'fetanagent_customer_web_runtime'\n    ) as runtime_only_trusted_members",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "select count(*) <= 1 and coalesce(pg_catalog.bool_and(\n        member.rolname = 'postgres'\n        and not membership.inherit_option\n        and not membership.set_option\n        and membership.admin_option\n      ), true)",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      'not membership.set_option and not membership.admin_option',
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "count(*) filter (\n          where member.rolname = 'fetanagent_customer_web_runtime'",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "count(*) filter (where member.rolname = 'postgres') <= 1",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "member.rolname = 'postgres'\n            and not membership.inherit_option\n            and not membership.set_option\n            and membership.admin_option",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain('no_app_base_object_access');
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.ensure_customer_web_account(uuid)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.submit_customer_web_player_registration(uuid,uuid,text)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.list_customer_web_player_registrations(uuid,integer)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.open_customer_web_deposit_intent(uuid,uuid,text,bigint)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.capture_customer_web_deposit_reference(uuid,uuid,uuid,text,text,text,smallint)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.capture_customer_web_dry_run_deposit_proof(uuid,uuid,text,text,text,text,text,smallint,smallint)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.list_customer_web_deposits(uuid,integer)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "pg_catalog.to_regprocedure('app.consume_customer_web_rate_limit(bytea,text,integer,integer)')",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain(
      "routine.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]",
    );
    expect(CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL).toContain("owner.rolname = 'postgres'");
  });

  it('accepts only one exact all-true preflight row without invoking hostile accessors', async () => {
    const passing = fakeDatabase(() => [passingPreflightRow]);
    expect(await customerWorkspaceCatalogPreflightPassed(passing)).toBe(true);

    for (const row of [
      { ...passingPreflightRow, runtime_login_is_safe: false },
      { ...passingPreflightRow, group_only_expected_members: false },
      { ...passingPreflightRow, runtime_only_trusted_members: false },
      { ...passingPreflightRow, unexpected: true },
      Object.fromEntries(Object.entries(passingPreflightRow).slice(1)),
    ]) {
      const database = fakeDatabase(() => [row]);
      expect(await customerWorkspaceCatalogPreflightPassed(database)).toBe(false);
    }
    const getter = Object.defineProperty({}, 'runtime_login_identity_allowed', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });
    const hostile = fakeDatabase(() => [getter]);
    expect(await customerWorkspaceCatalogPreflightPassed(hostile)).toBe(false);
  });

  it('fails startup closed with one generic error and closes a failed preflight database', async () => {
    const database = fakeDatabase(() => [{ ...passingPreflightRow, runtime_login_is_safe: false }]);
    await expect(createCustomerWorkspacePostgresRuntime(config, { database })).rejects.toEqual(
      new CustomerWorkspaceRuntimeUnavailableError(),
    );
    expect(database.end).toHaveBeenCalledTimes(1);
  });

  it('rejects startup when a pool error interrupts a passing deferred initial preflight', async () => {
    const delayedPreflight = deferred<readonly unknown[]>();
    const database = fakeDatabase((query) => {
      if (query !== CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL) throw new Error();
      return delayedPreflight.promise;
    });
    const runtime = createCustomerWorkspacePostgresRuntime(config, { database });
    await vi.waitFor(() => expect(database.queries).toHaveLength(1));

    database.emitError();
    delayedPreflight.resolve([passingPreflightRow]);

    await expect(runtime).rejects.toEqual(new CustomerWorkspaceRuntimeUnavailableError());
    expect(database.queries).toHaveLength(1);
    expect(database.end).toHaveBeenCalledTimes(1);
  });

  it('uses only the eight exact parameterized function calls and returns customer-safe projections', async () => {
    const database = databaseWithOperations((query) => {
      if (query === ENSURE_CUSTOMER_WEB_ACCOUNT_SQL) {
        return [{ account_status: 'active', account_created: true }];
      }
      if (query === LIST_CUSTOMER_WEB_PLAYER_REGISTRATIONS_SQL) {
        return [
          {
            platform_code: 'kemerbet',
            submitted_player_id: 'PLAYER-42',
            request_status: 'checking',
            request_created_at: createdAt,
            request_updated_at: createdAt,
          },
        ];
      }
      if (query === SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL) {
        return [
          {
            platform_code: 'kemerbet',
            request_status: 'checking',
            existing_request_reused: false,
            request_key_already_used: false,
            request_created_at: createdAt,
          },
        ];
      }
      if (query === OPEN_CUSTOMER_WEB_DEPOSIT_INTENT_SQL) {
        return [
          {
            deposit_intent_id: depositIntentId,
            provider_code: 'cbe_birr',
            receiver_account_holder_name: 'FetanAgent',
            receiver_account_masked: '***1234',
            receiver_customer_instruction: 'Send the exact amount using CBE Birr.',
            expected_amount_minor: '2500',
            currency_code: 'ETB',
            payment_deadline_at: new Date('2026-08-15T12:30:00.000Z'),
            deposit_status: 'intake_received',
            request_key_already_used: false,
          },
        ];
      }
      if (query === CAPTURE_CUSTOMER_WEB_DEPOSIT_REFERENCE_SQL) {
        return [
          {
            result_deposit_intent_id: depositIntentId,
            submission_status: 'verification_enqueued',
            deposit_status: 'verification_pending',
            submitted_at: createdAt,
            request_key_already_used: false,
          },
        ];
      }
      if (query === CAPTURE_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_SQL) {
        return [
          {
            deposit_proof_request_id: depositProofRequestId,
            provider_code: 'cbe_birr',
            proof_status: 'proof_received',
            submitted_at: createdAt,
            request_replayed: false,
          },
        ];
      }
      if (query === LIST_CUSTOMER_WEB_DEPOSITS_SQL) {
        return [
          {
            deposit_intent_id: depositIntentId,
            expected_amount_minor: '2500',
            currency_code: 'ETB',
            deposit_status: 'verification_pending',
            created_at: createdAt,
            updated_at: createdAt,
          },
        ];
      }
      if (query === CONSUME_CUSTOMER_WEB_RATE_LIMIT_SQL) {
        return [{ allowed: true, retry_after_seconds: 0, current_count: 1 }];
      }
      throw new Error('unexpected query');
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });

    expect(await runtime.ensureAccount({ authUserId })).toEqual({ ok: true, status: 'active' });
    expect(
      await runtime.consumeRateLimit({
        bucketKey: 'a'.repeat(64),
        maxRequests: 8,
        routeKey: 'POST /deposits/proof',
        windowSeconds: 60,
      }),
    ).toEqual({ allowed: true, currentCount: 1, ok: true, retryAfterSeconds: 0 });
    expect(await runtime.listPlayerRegistrations({ authUserId, limit: 20 })).toEqual({
      ok: true,
      registrations: [{ playerId: 'PLAYER-42', status: 'checking' }],
    });
    const submitted = await runtime.submitPlayerRegistration({
      authUserId,
      playerId: 'PLAYER-42',
      requestKey,
    });
    expect(submitted).toEqual({
      ok: true,
      registration: { playerId: 'PLAYER-42', status: 'checking' },
    });
    expect(JSON.stringify(submitted)).not.toContain(authUserId);
    expect(JSON.stringify(submitted)).not.toContain(requestKey);
    const opened = await runtime.openDeposit({
      amountMinor: '2500',
      authUserId,
      playerId: 'PLAYER-42',
      requestKey,
    });
    expect(opened).toMatchObject({
      ok: true,
      instructions: {
        amountMinor: '2500',
        providerName: 'CBE Birr',
        status: { label: 'Ready to start', tone: 'neutral' },
      },
    });
    const captured = await runtime.captureDepositReference({
      authUserId,
      ciphertext: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAA',
      depositIntentId,
      fingerprint: 'a'.repeat(64),
      keyVersion: 1,
      masked: '***1234',
      requestKey,
    });
    expect(captured).toMatchObject({
      ok: true,
      status: { label: 'Checking payment', tone: 'working' },
    });
    const proofCaptured = await runtime.captureDryRunDepositProof({
      authUserId,
      ciphertext: 'v2.cbe_birr.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAA',
      fingerprint: 'b'.repeat(64),
      keyVersion: 2,
      masked: '***AB12',
      playerId: 'PLAYER-42',
      profileVersion: 2,
      provider: 'cbe_birr',
      requestKey,
    });
    expect(proofCaptured).toEqual({
      ok: true,
      provider: 'cbe_birr',
      replayed: false,
      status: 'proof_received',
      submittedAt: createdAt.toISOString(),
    });
    expect(JSON.stringify(proofCaptured)).not.toContain(depositProofRequestId);
    expect(JSON.stringify(proofCaptured)).not.toContain('PLAYER-42');
    expect(JSON.stringify(proofCaptured)).not.toContain('AB12');
    expect(await runtime.listDeposits({ authUserId, limit: 20 })).toEqual({
      ok: true,
      deposits: [
        {
          amountMinor: '2500',
          createdAt: createdAt.toISOString(),
          currencyCode: 'ETB',
          depositIntentId,
          status: { label: 'Checking payment', tone: 'working' },
          updatedAt: createdAt.toISOString(),
        },
      ],
    });

    expect(database.queries.slice(1).map(({ query }) => query)).toEqual([
      ENSURE_CUSTOMER_WEB_ACCOUNT_SQL,
      CONSUME_CUSTOMER_WEB_RATE_LIMIT_SQL,
      LIST_CUSTOMER_WEB_PLAYER_REGISTRATIONS_SQL,
      SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL,
      OPEN_CUSTOMER_WEB_DEPOSIT_INTENT_SQL,
      CAPTURE_CUSTOMER_WEB_DEPOSIT_REFERENCE_SQL,
      CAPTURE_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_SQL,
      LIST_CUSTOMER_WEB_DEPOSITS_SQL,
    ]);
    expect(database.queries[1]?.values).toEqual([authUserId]);
    expect(database.queries[2]?.values).toEqual(['a'.repeat(64), 'POST /deposits/proof', 8, 60]);
    expect(database.queries[3]?.values).toEqual([authUserId, 20]);
    expect(database.queries[4]?.values).toEqual([authUserId, requestKey, 'PLAYER-42']);
    expect(database.queries[5]?.values).toEqual([authUserId, requestKey, 'PLAYER-42', '2500']);
    expect(database.queries[6]?.values).toEqual([
      authUserId,
      requestKey,
      depositIntentId,
      'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAA',
      'a'.repeat(64),
      '***1234',
      1,
    ]);
    expect(database.queries[7]?.values).toEqual([
      authUserId,
      requestKey,
      'PLAYER-42',
      'cbe_birr',
      'v2.cbe_birr.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAA',
      'b'.repeat(64),
      '***AB12',
      2,
      2,
    ]);
    expect(database.queries[8]?.values).toEqual([authUserId, 20]);
    await runtime.close();
  });

  it('rejects malformed, cross-provider, extra, accessor, and proxy proof inputs before SQL', async () => {
    const database = databaseWithOperations((query) => {
      if (query !== CAPTURE_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_SQL) throw new Error();
      return [
        {
          deposit_proof_request_id: depositProofRequestId,
          provider_code: 'cbe_birr',
          proof_status: 'proof_received',
          submitted_at: createdAt,
          request_replayed: false,
        },
      ];
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });
    const validInput = {
      authUserId,
      ciphertext: 'v2.cbe_birr.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAA',
      fingerprint: 'b'.repeat(64),
      keyVersion: 2,
      masked: '***AB12',
      playerId: 'PLAYER-42',
      profileVersion: 2,
      provider: 'cbe_birr',
      requestKey,
    } as const;
    const accessor = Object.defineProperty({ ...validInput }, 'provider', {
      enumerable: true,
      get: () => 'cbe_birr',
    });
    const proxy = new Proxy({ ...validInput }, {});

    for (const input of [
      { ...validInput, unexpected: true },
      { ...validInput, provider: 'telebirr' },
      {
        ...validInput,
        ciphertext: 'v2.cbe_birr.AAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAA',
      },
      {
        ...validInput,
        ciphertext: 'v2.cbe_birr.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAA',
      },
      { ...validInput, keyVersion: 1 },
      { ...validInput, profileVersion: 1 },
      accessor,
      proxy,
    ]) {
      expect(await runtime.captureDryRunDepositProof(input as never)).toEqual({
        error: 'customer_workspace_unavailable',
        ok: false,
      });
    }
    expect(database.queries).toHaveLength(1);

    expect(await runtime.captureDryRunDepositProof(validInput)).toMatchObject({
      ok: true,
      provider: 'cbe_birr',
      status: 'proof_received',
    });
    expect(database.queries).toHaveLength(2);
    await runtime.close();
  });

  it('reuses the same server request key without producing a second public identity', async () => {
    let submission = 0;
    const database = databaseWithOperations((query) => {
      if (query !== SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL) throw new Error();
      submission += 1;
      return [
        {
          platform_code: 'kemerbet',
          request_status: 'checking',
          existing_request_reused: submission > 1,
          request_key_already_used: submission > 1,
          request_created_at: createdAt,
        },
      ];
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });
    const input = { authUserId, playerId: 'PLAYER-42', requestKey } as const;

    const first = await runtime.submitPlayerRegistration(input);
    const second = await runtime.submitPlayerRegistration(input);
    expect(first).toEqual(second);
    expect(database.queries.slice(1).map(({ values }) => values)).toEqual([
      [authUserId, requestKey, 'PLAYER-42'],
      [authUserId, requestKey, 'PLAYER-42'],
    ]);
    expect(JSON.stringify(second)).not.toContain(requestKey);
    await runtime.close();
  });

  it('maps invalid input and expected procedure errors generically without poisoning the queue', async () => {
    let invocation = 0;
    const database = databaseWithOperations((query) => {
      if (query !== ENSURE_CUSTOMER_WEB_ACCOUNT_SQL) throw new Error();
      invocation += 1;
      if (invocation === 1) throw new Error('private database detail');
      return [{ account_status: 'active', account_created: false }];
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });
    const invalid = await runtime.ensureAccount({ authUserId: 'spoofed-user' });
    const failed = await runtime.ensureAccount({ authUserId });
    const recovered = await runtime.ensureAccount({ authUserId });

    expect(invalid).toEqual({ error: 'customer_workspace_unavailable', ok: false });
    expect(failed).toEqual(invalid);
    expect(recovered).toEqual({ ok: true, status: 'active' });
    expect(JSON.stringify(failed)).not.toContain('private database detail');
    expect(database.queries).toHaveLength(3);
    expect(await runtime.ready()).toBe(true);
    await runtime.close();
  });

  it('rejects malformed and hostile database rows without leaking their fields', async () => {
    const cases: readonly {
      readonly invoke: (
        runtime: Awaited<ReturnType<typeof createCustomerWorkspacePostgresRuntime>>,
      ) => Promise<unknown>;
      readonly row: unknown;
      readonly sql: string;
    }[] = [
      {
        invoke: (runtime) =>
          runtime.captureDryRunDepositProof({
            authUserId,
            ciphertext: 'v2.cbe_birr.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAA',
            fingerprint: 'b'.repeat(64),
            keyVersion: 2,
            masked: '***AB12',
            playerId: 'PLAYER-42',
            profileVersion: 2,
            provider: 'cbe_birr',
            requestKey,
          }),
        row: {
          deposit_proof_request_id: depositProofRequestId,
          provider_code: 'cbe_birr',
          proof_status: 'verified',
          submitted_at: createdAt,
          request_replayed: false,
        },
        sql: CAPTURE_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_SQL,
      },
      {
        invoke: (runtime) =>
          runtime.consumeRateLimit({
            bucketKey: 'a'.repeat(64),
            maxRequests: 8,
            routeKey: 'POST /sign-in',
            windowSeconds: 60,
          }),
        row: { allowed: false, retry_after_seconds: 0, current_count: 9 },
        sql: CONSUME_CUSTOMER_WEB_RATE_LIMIT_SQL,
      },
      {
        invoke: (runtime) => runtime.ensureAccount({ authUserId }),
        row: { account_status: 'suspended', account_created: false },
        sql: ENSURE_CUSTOMER_WEB_ACCOUNT_SQL,
      },
      {
        invoke: (runtime) =>
          runtime.submitPlayerRegistration({ authUserId, playerId: 'P-1', requestKey }),
        row: {
          platform_code: 'kemerbet',
          request_status: 'pending_validation',
          existing_request_reused: false,
          request_key_already_used: false,
          request_created_at: createdAt,
        },
        sql: SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL,
      },
      {
        invoke: (runtime) => runtime.listPlayerRegistrations({ authUserId, limit: 20 }),
        row: {
          platform_code: 'kemerbet',
          submitted_player_id: '<script>',
          request_status: 'checking',
          request_created_at: createdAt,
          request_updated_at: 'private-time',
        },
        sql: LIST_CUSTOMER_WEB_PLAYER_REGISTRATIONS_SQL,
      },
    ];

    for (const testCase of cases) {
      const database = databaseWithOperations((query) => {
        if (query !== testCase.sql) throw new Error();
        return [testCase.row];
      });
      const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });
      const result = await testCase.invoke(runtime);
      expect(result).toEqual({ error: 'customer_workspace_unavailable', ok: false });
      expect(JSON.stringify(result)).not.toContain('pending_validation');
      expect(JSON.stringify(result)).not.toContain('private-time');
      expect(await runtime.ready()).toBe(false);
      await runtime.close();
    }
  });

  it('executes no operations after a catalog re-preflight makes the pool unhealthy', async () => {
    let now = 1_000;
    let preflightInvocation = 0;
    const database = fakeDatabase((query) => {
      if (query !== CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL) {
        throw new Error('operation query must not execute');
      }
      preflightInvocation += 1;
      return [
        preflightInvocation === 1
          ? passingPreflightRow
          : { ...passingPreflightRow, exact_function_surface_allowed: false },
      ];
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, {
      database,
      now: () => now,
    });

    now += 30_000;
    expect(await runtime.ready()).toBe(false);
    expect(database.queries).toHaveLength(2);
    await expectAllOperationsUnavailableWithoutQueries(runtime, database);
    await runtime.close();
  });

  it('blocks operations while one shared deferred catalog re-preflight is pending', async () => {
    let now = 1_000;
    let preflightInvocation = 0;
    const delayedPreflight = deferred<readonly unknown[]>();
    const database = fakeDatabase((query) => {
      if (query !== CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL) {
        throw new Error('operation query must not execute');
      }
      preflightInvocation += 1;
      return preflightInvocation === 1 ? [passingPreflightRow] : delayedPreflight.promise;
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, {
      database,
      now: () => now,
    });

    now += 30_000;
    const firstReady = runtime.ready();
    const secondReady = runtime.ready();
    await vi.waitFor(() => expect(database.queries).toHaveLength(2));

    expect(
      await runtime.submitPlayerRegistration({
        authUserId,
        playerId: 'PLAYER-42',
        requestKey,
      }),
    ).toEqual({ error: 'customer_workspace_unavailable', ok: false });
    expect(database.queries).toHaveLength(2);

    delayedPreflight.resolve([{ ...passingPreflightRow, exact_function_surface_allowed: false }]);
    expect(await Promise.all([firstReady, secondReady])).toEqual([false, false]);
    expect(preflightInvocation).toBe(2);
    expect(database.queries).toHaveLength(2);
    await runtime.close();
  });

  it('never revives health when a passing deferred preflight is interrupted', async () => {
    for (const interruption of ['pool_error', 'close'] as const) {
      let now = 1_000;
      let preflightInvocation = 0;
      const delayedPreflight = deferred<readonly unknown[]>();
      const database = fakeDatabase((query) => {
        if (query !== CUSTOMER_WORKSPACE_CATALOG_PREFLIGHT_SQL) {
          throw new Error('operation query must not execute');
        }
        preflightInvocation += 1;
        return preflightInvocation === 1 ? [passingPreflightRow] : delayedPreflight.promise;
      });
      const runtime = await createCustomerWorkspacePostgresRuntime(config, {
        database,
        now: () => now,
      });

      now += 30_000;
      const readiness = runtime.ready();
      await vi.waitFor(() => expect(database.queries).toHaveLength(2));
      if (interruption === 'pool_error') database.emitError();
      else await runtime.close();

      delayedPreflight.resolve([passingPreflightRow]);
      expect(await readiness).toBe(false);
      expect(await runtime.ready()).toBe(false);
      expect(database.queries).toHaveLength(2);
      await expectAllOperationsUnavailableWithoutQueries(runtime, database);

      if (interruption === 'pool_error') await runtime.close();
      expect(database.end).toHaveBeenCalledTimes(1);
    }
  });

  it('executes no operations after the database pool emits an error', async () => {
    const database = databaseWithOperations(() => {
      throw new Error('operation query must not execute');
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });

    database.emitError();
    expect(await runtime.ready()).toBe(false);
    expect(database.queries).toHaveLength(1);
    await expectAllOperationsUnavailableWithoutQueries(runtime, database);
    await runtime.close();
  });

  it('executes no further operations after a malformed successful result', async () => {
    const database = databaseWithOperations((query) => {
      if (query !== ENSURE_CUSTOMER_WEB_ACCOUNT_SQL) {
        throw new Error('operation query must not execute');
      }
      return [{ account_status: 'unexpected', account_created: true }];
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });

    expect(await runtime.ensureAccount({ authUserId })).toEqual({
      error: 'customer_workspace_unavailable',
      ok: false,
    });
    expect(await runtime.ready()).toBe(false);
    expect(database.queries).toHaveLength(2);
    await expectAllOperationsUnavailableWithoutQueries(runtime, database);
    await runtime.close();
  });

  it('rechecks health inside the serialized turn before a queued operation can execute', async () => {
    const delayedMalformedResult = deferred<readonly unknown[]>();
    const database = databaseWithOperations((query) => {
      if (query === ENSURE_CUSTOMER_WEB_ACCOUNT_SQL) return delayedMalformedResult.promise;
      throw new Error('queued operation query must not execute');
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, { database });

    const firstOperation = runtime.ensureAccount({ authUserId });
    await vi.waitFor(() => expect(database.queries).toHaveLength(2));
    const queuedOperation = runtime.submitPlayerRegistration({
      authUserId,
      playerId: 'PLAYER-42',
      requestKey,
    });
    expect(database.queries).toHaveLength(2);

    delayedMalformedResult.resolve([{ account_status: 'unexpected', account_created: true }]);
    expect(await firstOperation).toEqual({
      error: 'customer_workspace_unavailable',
      ok: false,
    });
    expect(await queuedOperation).toEqual({
      error: 'customer_workspace_unavailable',
      ok: false,
    });
    expect(database.queries).toHaveLength(2);
    expect(await runtime.ready()).toBe(false);
    await runtime.close();
  });

  it('latches a malformed result before a concurrently queued catalog preflight can run', async () => {
    let now = 1_000;
    const delayedMalformedResult = deferred<readonly unknown[]>();
    const database = databaseWithOperations((query) => {
      if (query === ENSURE_CUSTOMER_WEB_ACCOUNT_SQL) return delayedMalformedResult.promise;
      throw new Error('catalog re-preflight must not execute after malformed data');
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, {
      database,
      now: () => now,
    });

    const operation = runtime.ensureAccount({ authUserId });
    await vi.waitFor(() => expect(database.queries).toHaveLength(2));
    now += 30_000;
    const readiness = runtime.ready();
    expect(database.queries).toHaveLength(2);

    delayedMalformedResult.resolve([{ account_status: 'unexpected', account_created: true }]);
    expect(await operation).toEqual({
      error: 'customer_workspace_unavailable',
      ok: false,
    });
    expect(await readiness).toBe(false);
    expect(await runtime.ready()).toBe(false);
    expect(database.queries).toHaveLength(2);
    await runtime.close();
  });

  it('caches and coalesces readiness, closes once, and refuses all work after close', async () => {
    let now = 1_000;
    const database = databaseWithOperations((query) => {
      if (query === ENSURE_CUSTOMER_WEB_ACCOUNT_SQL) {
        return [{ account_status: 'active', account_created: false }];
      }
      throw new Error();
    });
    const runtime = await createCustomerWorkspacePostgresRuntime(config, {
      database,
      now: () => now,
    });
    expect(await runtime.ready()).toBe(true);
    expect(database.queries).toHaveLength(1);
    now += 29_999;
    expect(await Promise.all(Array.from({ length: 25 }, () => runtime.ready()))).toEqual(
      Array.from({ length: 25 }, () => true),
    );
    expect(database.queries).toHaveLength(1);
    now += 1;
    expect(await Promise.all(Array.from({ length: 25 }, () => runtime.ready()))).toEqual(
      Array.from({ length: 25 }, () => true),
    );
    expect(database.queries).toHaveLength(2);
    expect(await runtime.ready()).toBe(true);
    expect(database.queries).toHaveLength(2);
    await Promise.all([runtime.close(), runtime.close()]);
    expect(database.end).toHaveBeenCalledTimes(1);
    expect(await runtime.ready()).toBe(false);
    expect(await runtime.ensureAccount({ authUserId })).toEqual({
      error: 'customer_workspace_unavailable',
      ok: false,
    });
    expect(database.queries).toHaveLength(2);
  });
});
