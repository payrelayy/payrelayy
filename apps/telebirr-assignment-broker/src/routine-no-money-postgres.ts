import { isProxy } from 'node:util/types';

import type { RoutineNoMoneyBrokerDatabase } from './routine-no-money-broker.js';

/** Query boundary only. The caller must supply a separately preflighted no-money login. */
export interface RoutineNoMoneySqlClient {
  query(text: string, values: unknown[]): Promise<{ readonly rows: unknown[] }>;
}

const SQL = Object.freeze({
  enrollment: 'select * from app.load_routine_telebirr_no_money_enrollment($1::uuid)',
  issue:
    'select * from app.issue_routine_telebirr_no_money_poll_assignment($1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid)',
  observation: 'select * from app.load_routine_telebirr_no_money_observation_material($1::uuid)',
  stage:
    'select app.stage_routine_telebirr_no_money_observation_digest($1::uuid,$2::text,$3::text,$4::text,$5::text) as status',
});

export class RoutineNoMoneySqlUnavailableError extends Error {
  constructor() {
    super('The private routine no-money database is unavailable.');
    this.name = 'RoutineNoMoneySqlUnavailableError';
  }
}

async function oneRow(
  client: RoutineNoMoneySqlClient,
  sql: string,
  values: unknown[],
): Promise<unknown | undefined> {
  try {
    const result = await client.query(sql, values);
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) throw new Error();
    return result.rows[0];
  } catch {
    throw new RoutineNoMoneySqlUnavailableError();
  }
}

/** Exact parameterized calls: no table grants, dynamic SQL, writes other than digest-only staging. */
export function createRoutineNoMoneyPostgresDatabase(
  client: RoutineNoMoneySqlClient,
): RoutineNoMoneyBrokerDatabase {
  if (!client || typeof client.query !== 'function') throw new RoutineNoMoneySqlUnavailableError();
  const database: RoutineNoMoneyBrokerDatabase = Object.freeze({
    loadEnrollment: (enrollmentId: string) => oneRow(client, SQL.enrollment, [enrollmentId]),
    issuePollAssignment: (
      input: Parameters<RoutineNoMoneyBrokerDatabase['issuePollAssignment']>[0],
    ) =>
      oneRow(client, SQL.issue, [
        input.enrollmentId,
        input.requestId,
        input.replayIdentity,
        input.requestExpiresAt,
        input.signerId,
      ]),
    loadObservationMaterial: (challengeId: string) =>
      oneRow(client, SQL.observation, [challengeId]),
    async stageObservationDigest(
      input: Parameters<RoutineNoMoneyBrokerDatabase['stageObservationDigest']>[0],
    ) {
      const row = await oneRow(client, SQL.stage, [
        input.challengeId,
        input.assignmentBodyDigest,
        input.observationBodyDigest,
        input.observationSignatureDigest,
        input.replayIdentity,
      ]);
      if (
        typeof row !== 'object' ||
        row === null ||
        Array.isArray(row) ||
        isProxy(row) ||
        Object.getPrototypeOf(row) !== Object.prototype ||
        Reflect.ownKeys(row).length !== 1
      )
        throw new RoutineNoMoneySqlUnavailableError();
      const status = Object.getOwnPropertyDescriptor(row, 'status');
      if (!status?.enumerable || !Object.hasOwn(status, 'value')) {
        throw new RoutineNoMoneySqlUnavailableError();
      }
      return status.value;
    },
  });
  return database;
}
