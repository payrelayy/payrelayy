import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  ACQUIRE_SQL,
  RELEASE_SQL,
} from '@fetanagent/agent-platform-companion-activation-issuer/guarded-operator-lifecycle-lock';

/** Real PostgreSQL coverage: mock rows cannot prove the exact parameterized SQL parses. */
export function registerOperatorLifecycleConnectionSqlTests(createClient: () => Client): void {
  describe('operator first-query SQL in a disposable read-only connection', () => {
    it('acquires once, refuses a stacked acquisition, and releases the exact session lock', async () => {
      const client = createClient();
      try {
        await client.connect();
        await client.query('begin read only');
        const backend = await client.query<{ backend_pid: number }>(
          'select pg_catalog.pg_backend_pid() as backend_pid',
        );
        const values = [1178682452, 1329885472, backend.rows[0]!.backend_pid];
        expect((await client.query(ACQUIRE_SQL, values)).rows).toEqual([{ acquired: true }]);
        expect((await client.query(ACQUIRE_SQL, values)).rows).toEqual([{ acquired: false }]);
        expect((await client.query(RELEASE_SQL, values)).rows).toEqual([{ released: true }]);
        expect((await client.query(RELEASE_SQL, values)).rows).toEqual([{ released: false }]);
        await client.query('rollback');
      } finally {
        // Closing this disposable connection also releases a lock if any assertion failed.
        await client.end();
      }
    });

    it('refuses a wrong backend without acquiring a session lock', async () => {
      const client = createClient();
      try {
        await client.connect();
        await client.query('begin read only');
        const backend = await client.query<{ backend_pid: number }>(
          'select pg_catalog.pg_backend_pid() as backend_pid',
        );
        const backendPid = backend.rows[0]!.backend_pid;
        expect(
          (await client.query(ACQUIRE_SQL, [1178682452, 1329885472, backendPid + 1])).rows,
        ).toEqual([{ acquired: false }]);
        expect(
          (await client.query(ACQUIRE_SQL, [1178682452, 1329885472, backendPid])).rows,
        ).toEqual([{ acquired: true }]);
        expect(
          (await client.query(RELEASE_SQL, [1178682452, 1329885472, backendPid])).rows,
        ).toEqual([{ released: true }]);
        await client.query('rollback');
      } finally {
        await client.end();
      }
    });
  });
}
