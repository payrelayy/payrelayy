import type { RoutinePaidPollBrokerDatabase } from './routine-paid-poll-broker.js';

export interface RoutinePaidPollSqlClient {
  query(text: string, values: unknown[]): Promise<{ readonly rows: unknown[] }>;
}

const LOAD = 'select * from app.load_routine_telebirr_paid_poll_enrollment($1::uuid)';
const ISSUE =
  'select * from app.issue_routine_telebirr_paid_poll_assignment($1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid)';

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

/** Exact parameterized paid calls, with no observation or financial SQL surface. */
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
  });
}
