import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
  ROUTINE_NO_MONEY_PREFLIGHT_KEYS,
  RoutineNoMoneyRuntimeUnavailableError,
  createRoutineNoMoneyPostgresRuntime,
  type RoutineNoMoneyConnectionConfig,
  type RoutineNoMoneyPostgresClient,
} from './routine-no-money-runtime.js';

const id = '44444444-4444-4444-8444-444444444444';
const goodPreflight = Object.fromEntries(ROUTINE_NO_MONEY_PREFLIGHT_KEYS.map((key) => [key, true]));
const connection: RoutineNoMoneyConnectionConfig = {
  target: 'production',
  host: 'db.xzztugbgtulptnbpoelr.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'fetanagent_routine_telebirr_no_money_runtime',
  password: 'a-separate-test-credential',
  ca: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n',
};

function fakeClient(
  options: {
    preflight?: Record<string, unknown>;
    failQuery?: boolean;
  } = {},
) {
  const events = new EventEmitter();
  const query = vi.fn(async (sql: string, _values: unknown[]) => {
    if (options.failQuery) throw new Error('sensitive database detail');
    if (sql === ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL) {
      return { rows: [options.preflight ?? goodPreflight] };
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client: RoutineNoMoneyPostgresClient = {
    connect,
    end,
    query,
    on: (event, listener) => {
      events.on(event, listener);
    },
    removeListener: (event, listener) => {
      events.removeListener(event, listener);
    },
  };
  return { client, query, connect, end, events };
}

describe('separate routine no-money PostgreSQL runtime', () => {
  it('rejects wrong target, role, host, pooler port, or credential before client construction', async () => {
    const createClient = vi.fn();
    const changes: Partial<RoutineNoMoneyConnectionConfig>[] = [
      { host: 'db.spzpiyxheappsfyswewl.supabase.co' },
      { user: 'postgres' },
      { port: 6543 as 5432 },
      { password: 'short' },
      { ca: 'not a certificate' },
    ];
    for (const change of changes) {
      await expect(
        createRoutineNoMoneyPostgresRuntime({ ...connection, ...change }, { createClient }),
      ).rejects.toBeInstanceOf(RoutineNoMoneyRuntimeUnavailableError);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('accepts only the matching session-pooler identity and pins TLS verification', async () => {
    const fake = fakeClient();
    const createClient = vi.fn(() => fake.client);
    const runtime = await createRoutineNoMoneyPostgresRuntime(
      {
        ...connection,
        host: 'aws-0-eu-west-1.pooler.supabase.com',
        user: 'fetanagent_routine_telebirr_no_money_runtime.xzztugbgtulptnbpoelr',
      },
      { createClient },
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'aws-0-eu-west-1.pooler.supabase.com',
        port: 5432,
        user: 'fetanagent_routine_telebirr_no_money_runtime.xzztugbgtulptnbpoelr',
        ssl: { ca: connection.ca, rejectUnauthorized: true },
      }),
    );
    expect(fake.query.mock.calls.map(([sql]) => sql)).toEqual([
      ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
    ]);
    expect(await runtime.ready()).toBe(true);
    await runtime.database.loadEnrollment(id);
    expect(fake.query.mock.calls.map(([sql]) => sql)).toEqual([
      ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
      ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
      ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
      'select * from app.load_routine_telebirr_no_money_enrollment($1::uuid)',
    ]);
    await runtime.close();
    expect(fake.end).toHaveBeenCalledOnce();
    expect(await runtime.ready()).toBe(false);
    await expect(runtime.database.loadEnrollment(id)).rejects.toThrow('unavailable');
  });

  it('fails closed on a false, missing, or extra preflight field', async () => {
    const badRows = [
      { ...goodPreflight, runtime_login_is_safe: false },
      Object.fromEntries(Object.entries(goodPreflight).slice(1)),
      { ...goodPreflight, extra: true },
    ];
    for (const preflight of badRows) {
      const fake = fakeClient({ preflight });
      await expect(
        createRoutineNoMoneyPostgresRuntime(connection, {
          createClient: () => fake.client,
        }),
      ).rejects.toBeInstanceOf(RoutineNoMoneyRuntimeUnavailableError);
      expect(fake.end).toHaveBeenCalledOnce();
    }
  });

  it('does not call a routine function after catalog authority changes', async () => {
    const fake = fakeClient();
    const runtime = await createRoutineNoMoneyPostgresRuntime(connection, {
      createClient: () => fake.client,
    });
    fake.query.mockImplementationOnce(async () => ({
      rows: [{ ...goodPreflight, exact_reachable_function_surface_allowed: false }],
    }));
    await expect(runtime.database.loadEnrollment(id)).rejects.toThrow('unavailable');
    expect(fake.query).toHaveBeenCalledTimes(2);
    expect(await runtime.ready()).toBe(false);
    await runtime.close();
  });

  it('fails closed and redacts a query failure or connection end', async () => {
    const fake = fakeClient();
    const runtime = await createRoutineNoMoneyPostgresRuntime(connection, {
      createClient: () => fake.client,
    });
    fake.events.emit('end');
    expect(await runtime.ready()).toBe(false);
    await expect(runtime.database.loadEnrollment(id)).rejects.toMatchObject({
      message: expect.not.stringContaining('sensitive database detail'),
    });
    await runtime.close();
    const failed = fakeClient({ failQuery: true });
    await expect(
      createRoutineNoMoneyPostgresRuntime(connection, {
        createClient: () => failed.client,
      }),
    ).rejects.toMatchObject({
      message: 'The private routine no-money database runtime is unavailable.',
    });
    expect(failed.end).toHaveBeenCalledOnce();
  });
});
