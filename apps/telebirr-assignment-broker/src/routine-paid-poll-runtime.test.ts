import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { RoutinePaidPollSqlUnavailableError } from './routine-paid-poll-postgres.js';

import {
  ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL,
  ROUTINE_PAID_POLL_PREFLIGHT_KEYS,
  RoutinePaidPollRuntimeUnavailableError,
  createRoutinePaidPollPostgresRuntime,
  type RoutinePaidPollConnectionConfig,
  type RoutinePaidPollPostgresClient,
} from './routine-paid-poll-runtime.js';

const enrollmentId = '44444444-4444-4444-8444-444444444444';
const goodPreflight = Object.fromEntries(
  ROUTINE_PAID_POLL_PREFLIGHT_KEYS.map((key) => [key, true]),
);
const connection: RoutinePaidPollConnectionConfig = {
  target: 'production',
  host: 'db.xzztugbgtulptnbpoelr.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'fetanagent_routine_telebirr_paid_poll_runtime',
  password: 'a-separate-test-credential',
  ca: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n',
};

function fakeClient(preflight: Record<string, unknown> = goodPreflight) {
  const events = new EventEmitter();
  const query = vi.fn(async (sql: string, _values: unknown[]) =>
    sql === ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL ? { rows: [preflight] } : { rows: [] },
  );
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client: RoutinePaidPollPostgresClient = {
    query,
    connect,
    end,
    on: (event, listener) => {
      events.on(event, listener);
    },
    removeListener: (event, listener) => {
      events.removeListener(event, listener);
    },
  };
  return { client, query, connect, end, events };
}

describe('separate paid phone poll PostgreSQL runtime', () => {
  it('rejects the no-money role, wrong host, bad TLS, and short credentials before construction', async () => {
    const createClient = vi.fn();
    for (const change of [
      { user: 'fetanagent_routine_telebirr_no_money_runtime' },
      { user: 'postgres' },
      { host: 'db.spzpiyxheappsfyswewl.supabase.co' },
      { port: 6543 as 5432 },
      { password: 'short' },
      { ca: 'not a certificate' },
    ]) {
      await expect(
        createRoutinePaidPollPostgresRuntime({ ...connection, ...change }, { createClient }),
      ).rejects.toBeInstanceOf(RoutinePaidPollRuntimeUnavailableError);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('uses the exact paid database calls only after the live catalog preflight', async () => {
    const fake = fakeClient();
    const createClient = vi.fn(() => fake.client);
    const runtime = await createRoutinePaidPollPostgresRuntime(
      {
        ...connection,
        host: 'aws-0-eu-west-1.pooler.supabase.com',
        user: 'fetanagent_routine_telebirr_paid_poll_runtime.xzztugbgtulptnbpoelr',
      },
      { createClient },
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'fetanagent_routine_telebirr_paid_poll_runtime.xzztugbgtulptnbpoelr',
        ssl: { ca: connection.ca, rejectUnauthorized: true },
      }),
    );
    await runtime.database.loadEnrollment(enrollmentId);
    await runtime.database.issuePollAssignment({
      enrollmentId,
      requestId: enrollmentId,
      replayIdentity: `sha256:${'a'.repeat(64)}`,
      requestExpiresAt: '2026-10-08T18:50:00.000Z',
      signerId: enrollmentId,
    });
    const sql = fake.query.mock.calls.map(([text]) => text);
    expect(sql.filter((text) => text === ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL)).toHaveLength(3);
    expect(
      sql.filter((text) =>
        text.startsWith('select * from app.load_routine_telebirr_paid_poll_enrollment'),
      ),
    ).toHaveLength(1);
    expect(
      sql.filter((text) =>
        text.startsWith('select * from app.issue_routine_telebirr_paid_poll_assignment'),
      ),
    ).toHaveLength(1);
    expect(await runtime.ready()).toBe(true);
    await runtime.close();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('fails closed on any missing catalog assertion', async () => {
    const bad = fakeClient({ ...goodPreflight, exact_reachable_function_surface_allowed: false });
    await expect(
      createRoutinePaidPollPostgresRuntime(connection, {
        createClient: () => bad.client,
      }),
    ).rejects.toBeInstanceOf(RoutinePaidPollRuntimeUnavailableError);
    expect(bad.end).toHaveBeenCalledOnce();
  });

  it('stops after connection loss rather than retrying under a changed role', async () => {
    const fake = fakeClient();
    const runtime = await createRoutinePaidPollPostgresRuntime(connection, {
      createClient: () => fake.client,
    });
    fake.events.emit('error');
    expect(await runtime.ready()).toBe(false);
    await expect(runtime.database.loadEnrollment(enrollmentId)).rejects.toBeInstanceOf(
      RoutinePaidPollSqlUnavailableError,
    );
    await runtime.close();
  });
});
