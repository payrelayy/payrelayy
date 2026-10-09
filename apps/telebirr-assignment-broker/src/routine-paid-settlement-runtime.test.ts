import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_PAID_SETTLEMENT_CATALOG_PREFLIGHT_SQL,
  ROUTINE_PAID_SETTLEMENT_PREFLIGHT_KEYS,
  RoutinePaidSettlementUnavailableError,
  createRoutinePaidSettlementRuntime,
  type RoutinePaidSettlementConnectionConfig,
  type RoutinePaidSettlementSqlClient,
} from './routine-paid-settlement-runtime.js';

const connection: RoutinePaidSettlementConnectionConfig = {
  target: 'production',
  host: 'db.xzztugbgtulptnbpoelr.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'fetanagent_routine_telebirr_paid_settlement_runtime',
  password: 'independent-test-credential',
  ca: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n',
};
const preflight = Object.fromEntries(
  ROUTINE_PAID_SETTLEMENT_PREFLIGHT_KEYS.map((key) => [key, true]),
);
const challengeId = '11111111-1111-4111-8111-111111111111';

function fakeClient(checks: Record<string, unknown> = preflight) {
  const events = new EventEmitter();
  const query = vi.fn(async (sql: string, _values: unknown[]) => {
    if (sql === ROUTINE_PAID_SETTLEMENT_CATALOG_PREFLIGHT_SQL) return { rows: [checks] };
    if (sql.startsWith('select * from app.list_routine'))
      return {
        rows: [{ challenge_id: challengeId, occurred_at_utc: '2026-10-09T10:00:00.123456Z' }],
      };
    return {
      rows: [
        {
          deposit_intent_id: challengeId,
          payment_claim_id: challengeId,
          execution_job_id: challengeId,
          already_finalized: false,
        },
      ],
    };
  });
  const end = vi.fn(async () => undefined);
  const client: RoutinePaidSettlementSqlClient = {
    query,
    connect: vi.fn(async () => undefined),
    end,
    on: (event, listener) => {
      events.on(event, listener);
    },
    removeListener: (event, listener) => {
      events.removeListener(event, listener);
    },
  };
  return { client, query, end, events };
}

describe('isolated routine paid settlement PostgreSQL runtime', () => {
  it('rejects the poll credential, wrong database target, and unverified TLS', async () => {
    const createClient = vi.fn();
    for (const change of [
      { user: 'fetanagent_routine_telebirr_paid_poll_runtime' },
      { user: 'postgres' },
      { host: 'db.spzpiyxheappsfyswewl.supabase.co' },
      { port: 6543 as 5432 },
      { ca: 'not a certificate' },
    ]) {
      await expect(
        createRoutinePaidSettlementRuntime({ ...connection, ...change }, { createClient }),
      ).rejects.toBeInstanceOf(RoutinePaidSettlementUnavailableError);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('uses exactly the scan and atomic claim after each catalog preflight', async () => {
    const fake = fakeClient();
    const runtime = await createRoutinePaidSettlementRuntime(connection, {
      createClient: () => fake.client,
    });
    const candidates = await runtime.database.listCandidates(undefined, 32);
    expect(candidates).toEqual([
      {
        challengeId,
        verificationCompletedAtUtc: '2026-10-09T10:00:00.123456Z',
      },
    ]);
    expect(await runtime.database.finalize(challengeId)).toBe('created');
    expect(
      fake.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql === ROUTINE_PAID_SETTLEMENT_CATALOG_PREFLIGHT_SQL),
    ).toHaveLength(3);
    expect(fake.query.mock.calls[2]?.[1]).toEqual([null, null, 32]);
    expect(fake.query.mock.calls[4]?.[1]).toEqual([challengeId]);
    await runtime.close();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('fails before any settlement call when a catalog grant changes', async () => {
    const fake = fakeClient({ ...preflight, only_two_functions: false });
    await expect(
      createRoutinePaidSettlementRuntime(connection, {
        createClient: () => fake.client,
      }),
    ).rejects.toBeInstanceOf(RoutinePaidSettlementUnavailableError);
    expect(fake.query).toHaveBeenCalledOnce();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('stops after the database connection closes', async () => {
    const fake = fakeClient();
    const runtime = await createRoutinePaidSettlementRuntime(connection, {
      createClient: () => fake.client,
    });
    fake.events.emit('end');
    expect(await runtime.ready()).toBe(false);
    await expect(runtime.database.listCandidates(undefined, 32)).rejects.toBeInstanceOf(
      RoutinePaidSettlementUnavailableError,
    );
    await runtime.close();
  });
});
