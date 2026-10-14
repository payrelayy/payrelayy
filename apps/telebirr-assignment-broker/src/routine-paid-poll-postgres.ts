import { isProxy } from 'node:util/types';

import type { RoutinePaidPollBrokerDatabase } from './routine-paid-poll-broker.js';

export interface RoutinePaidPollSqlClient {
  query(text: string, values: unknown[]): Promise<{ readonly rows: unknown[] }>;
}

const LOAD = 'select * from app.load_routine_telebirr_paid_poll_enrollment($1::uuid)';
const ISSUE =
  'select * from app.issue_routine_telebirr_paid_poll_assignment($1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid)';
const OBSERVATION = 'select * from app.load_routine_telebirr_paid_observation_material($1::uuid)';
const TERMINAL =
  'select app.classify_routine_telebirr_paid_upload_terminal($1::uuid,$2::text,$3::text) as terminal';
const STAGE =
  'select app.stage_routine_telebirr_paid_signed_observation($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::jsonb) as status';
const REJECT_TERMINAL =
  'select app.record_routine_telebirr_paid_terminal_result($1::uuid,$2::jsonb) as status';

export class RoutinePaidPollSqlUnavailableError extends Error {
  constructor() {
    super('The private routine paid poll database is unavailable.');
    this.name = 'RoutinePaidPollSqlUnavailableError';
  }
}

async function oneRow(client: RoutinePaidPollSqlClient, sql: string, values: unknown[]) {
  try {
    const result = await client.query(sql, values);
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) throw new Error();
    return result.rows[0];
  } catch {
    throw new RoutinePaidPollSqlUnavailableError();
  }
}

/** Exact parameterized paid calls, with no direct table or financial SQL surface. */
export function createRoutinePaidPollPostgresDatabase(
  client: RoutinePaidPollSqlClient,
): RoutinePaidPollBrokerDatabase {
  if (!client || typeof client.query !== 'function') throw new RoutinePaidPollSqlUnavailableError();
  return Object.freeze({
    loadEnrollment: (enrollmentId: string) => oneRow(client, LOAD, [enrollmentId]),
    issuePollAssignment: (
      input: Parameters<RoutinePaidPollBrokerDatabase['issuePollAssignment']>[0],
    ) =>
      oneRow(client, ISSUE, [
        input.enrollmentId,
        input.requestId,
        input.replayIdentity,
        input.requestExpiresAt,
        input.signerId,
      ]),
    loadObservationMaterial: (challengeId: string) => oneRow(client, OBSERVATION, [challengeId]),
    async classifyTerminal(
      input: Parameters<RoutinePaidPollBrokerDatabase['classifyTerminal']>[0],
    ) {
      const row = await oneRow(client, TERMINAL, [
        input.challengeId,
        input.challengeDigest,
        input.devicePublicKeySpkiSha256,
      ]);
      if (
        typeof row !== 'object' ||
        row === null ||
        Array.isArray(row) ||
        isProxy(row) ||
        Object.getPrototypeOf(row) !== Object.prototype ||
        Reflect.ownKeys(row).length !== 1 ||
        typeof Object.getOwnPropertyDescriptor(row, 'terminal')?.value !== 'boolean'
      )
        throw new RoutinePaidPollSqlUnavailableError();
      return Object.getOwnPropertyDescriptor(row, 'terminal')?.value as boolean;
    },
    async stageObservation(
      input: Parameters<RoutinePaidPollBrokerDatabase['stageObservation']>[0],
    ) {
      const row = await oneRow(client, STAGE, [
        input.challengeId,
        input.assignmentBodyDigest,
        input.observationBodyDigest,
        input.observationSignatureDigest,
        input.replayIdentity,
        JSON.stringify(input.signedObservation),
      ]);
      if (
        typeof row !== 'object' ||
        row === null ||
        Array.isArray(row) ||
        isProxy(row) ||
        Object.getPrototypeOf(row) !== Object.prototype ||
        Reflect.ownKeys(row).length !== 1
      )
        throw new RoutinePaidPollSqlUnavailableError();
      const status = Object.getOwnPropertyDescriptor(row, 'status');
      if (!status?.enumerable || !Object.hasOwn(status, 'value'))
        throw new RoutinePaidPollSqlUnavailableError();
      return status.value;
    },
    async recordTerminalRejection(
      input: Parameters<RoutinePaidPollBrokerDatabase['recordTerminalRejection']>[0],
    ) {
      const row = await oneRow(client, REJECT_TERMINAL, [
        input.challengeId,
        JSON.stringify(input.signedObservation),
      ]);
      if (
        typeof row !== 'object' ||
        row === null ||
        Array.isArray(row) ||
        isProxy(row) ||
        Object.getPrototypeOf(row) !== Object.prototype ||
        Reflect.ownKeys(row).length !== 1
      )
        throw new RoutinePaidPollSqlUnavailableError();
      const status = Object.getOwnPropertyDescriptor(row, 'status');
      if (!status?.enumerable || !Object.hasOwn(status, 'value'))
        throw new RoutinePaidPollSqlUnavailableError();
      return status.value;
    },
  });
}
