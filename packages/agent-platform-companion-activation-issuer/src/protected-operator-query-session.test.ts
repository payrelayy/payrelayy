import { describe, expect, it, vi } from 'vitest';

import { createGuardedOperatorQueryClient } from './guarded-operator-query-client.js';
import {
  protectedOperatorQueries,
  protectedOperatorQueryName,
} from './protected-operator-query-catalog.js';
import {
  createProtectedOperatorQuerySession,
  ProtectedOperatorQuerySessionUnavailableError,
} from './protected-operator-query-session.js';

const requestKey = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const digest = `sha256:${'a'.repeat(64)}`;
const instant = '2026-09-27T20:00:00.000Z';
const lockValues = [1178682452, 1329885472, 417];
const retained = [
  requestKey,
  digest,
  'b'.repeat(40),
  digest,
  digest,
  digest,
  digest,
  digest,
  123,
  instant,
  instant,
  instant,
  instant,
  instant,
];

function fixture(overrides?: {
  readonly activateResult?: { readonly rows: readonly Record<string, unknown>[] };
}) {
  const listeners = new Map<string, Set<() => void>>();
  const query = vi.fn(async (sql: string) => {
    if (sql === protectedOperatorQueries.acquire) return { rows: [{ acquired: true }] };
    if (sql === protectedOperatorQueries.release) return { rows: [{ released: true }] };
    if (sql === protectedOperatorQueries.snapshot)
      return { rows: [{ request_key: requestKey, request_activation_epoch: '42' }] };
    if (sql === protectedOperatorQueries.retain) return { rows: [{ request_key: requestKey }] };
    if (sql === protectedOperatorQueries.watchdogReady) return { rows: [{ ready: true }] };
    if (sql === protectedOperatorQueries.attestation) return { rows: [{ proof_digest: digest }] };
    if (sql === protectedOperatorQueries.activate)
      return (
        overrides?.activateResult ?? { rows: [{ valid_until: new Date(Date.now() + 60_000) }] }
      );
    if (sql === protectedOperatorQueries.watchdogRenew)
      return { rows: [{ lease_expires_at: new Date(Date.now() + 40_000) }] };
    if (sql === protectedOperatorQueries.approvedJob)
      return { rows: [{ job_id: jobId, approval_current: true, job_status: 'queued' }] };
    if (sql === protectedOperatorQueries.outcome) return { rows: [{ job_status: 'queued' }] };
    throw new Error('Unexpected SQL');
  });
  const administrator = {
    processID: 417,
    query,
    on(event: 'error' | 'end', listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: 'error' | 'end', listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  const disableDatabase = vi.fn(async () => undefined);
  const closeAdministrator = vi.fn(async () => undefined);
  const session = createProtectedOperatorQuerySession({
    administrator,
    requestKey,
    disableDatabase,
    closeAdministrator,
  });
  return {
    administrator,
    session,
    query,
    disableDatabase,
    closeAdministrator,
    lose: () => {
      for (const listener of listeners.get('end') ?? []) listener();
    },
  };
}

async function throughAttestation(session: ReturnType<typeof createProtectedOperatorQuerySession>) {
  await session.execute('acquire', lockValues);
  await session.execute('snapshot', [requestKey]);
  await session.execute('snapshot', [requestKey]);
  await session.execute('retain', retained);
  await session.execute('watchdogReady', []);
  await session.execute('attestation', [requestKey]);
}

describe('protected operator query boundary', () => {
  it('pins every query to a unique exact statement, with no arbitrary SQL fallback', () => {
    expect(Object.keys(protectedOperatorQueries)).toHaveLength(10);
    for (const [name, sql] of Object.entries(protectedOperatorQueries)) {
      expect(protectedOperatorQueryName(sql)).toBe(name);
      expect(protectedOperatorQueryName(`${sql} `)).toBeUndefined();
    }
    expect(protectedOperatorQueryName('select 1')).toBeUndefined();
  });

  it('permits only the bound one-job sequence and independently disables after activation', async () => {
    const { session, query, disableDatabase, closeAdministrator } = fixture();
    const client = createGuardedOperatorQueryClient(session);
    await throughAttestation(session);
    await client.administrator.query(protectedOperatorQueries.activate, [
      actor,
      requestKey,
      'f'.repeat(64),
    ]);
    await client.administrator.query(protectedOperatorQueries.watchdogRenew, ['42']);
    await client.administrator.query(protectedOperatorQueries.approvedJob, [requestKey]);
    await client.administrator.query(protectedOperatorQueries.outcome, [requestKey, jobId]);
    await client.administrator.query(protectedOperatorQueries.release, lockValues);
    await client.close();
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(11);
    expect(query.mock.calls.every(([sql]) => protectedOperatorQueryName(sql) !== undefined)).toBe(
      true,
    );
  });

  it('rejects direct activation without attestation and never sends it to Postgres', async () => {
    const { session, query, disableDatabase, closeAdministrator } = fixture();
    await session.execute('acquire', lockValues);
    await expect(
      session.execute('activate', [actor, requestKey, 'f'.repeat(64)]),
    ).rejects.toBeInstanceOf(ProtectedOperatorQuerySessionUnavailableError);
    await session.close();
    expect(query.mock.calls.some(([sql]) => sql === protectedOperatorQueries.activate)).toBe(false);
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });

  it('treats an invalid activation reply as a possible commit and stops independently', async () => {
    const { session, disableDatabase, closeAdministrator } = fixture({
      activateResult: { rows: [] },
    });
    await throughAttestation(session);
    await expect(
      session.execute('activate', [actor, requestKey, 'f'.repeat(64)]),
    ).rejects.toBeInstanceOf(ProtectedOperatorQuerySessionUnavailableError);
    await session.close();
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(closeAdministrator).toHaveBeenCalledTimes(1);
  });

  it('invalidates the client and invokes the protected stop if the database session is lost', async () => {
    const { session, lose, disableDatabase } = fixture();
    const client = createGuardedOperatorQueryClient(session);
    const onLoss = vi.fn();
    client.administrator.on('error', onLoss);
    await throughAttestation(session);
    await session.execute('activate', [actor, requestKey, 'f'.repeat(64)]);
    lose();
    await expect(session.lost).rejects.toBeInstanceOf(
      ProtectedOperatorQuerySessionUnavailableError,
    );
    await expect(
      client.administrator.query(protectedOperatorQueries.approvedJob, [requestKey]),
    ).rejects.toThrow();
    await session.close();
    expect(onLoss).toHaveBeenCalledTimes(1);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
  });

  it('never forwards unknown SQL through the Windows adapter', async () => {
    const { session, query } = fixture();
    const client = createGuardedOperatorQueryClient(session);
    await expect(client.administrator.query('select current_user', [])).rejects.toThrow();
    await session.close();
    expect(query).not.toHaveBeenCalled();
  });
});
