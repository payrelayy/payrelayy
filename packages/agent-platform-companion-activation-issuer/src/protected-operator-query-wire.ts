import { createHash } from 'node:crypto';

import type { ProtectedOperatorQueryName } from './protected-operator-query-catalog.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NONCE = /^[A-Za-z0-9_-]{43}$/u;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_VALUES = 14;

export type ProtectedOperatorWireOperation = ProtectedOperatorQueryName | 'open' | 'close';

export interface ProtectedOperatorWireCommand {
  readonly requestKey: string;
  readonly sequence: number;
  readonly name: ProtectedOperatorWireOperation;
  readonly values: readonly unknown[];
  readonly sessionNonce: string | null;
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validWireCommand(value: unknown): value is ProtectedOperatorWireCommand {
  if (!exactRecord(value, ['requestKey', 'sequence', 'name', 'values', 'sessionNonce']))
    return false;
  if (
    typeof value.requestKey !== 'string' ||
    !UUID_V4.test(value.requestKey) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.sequence as number) > 2_147_483_647 ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.values) ||
    value.values.length > MAX_VALUES ||
    !value.values.every(
      (entry) =>
        entry === null ||
        typeof entry === 'string' ||
        typeof entry === 'boolean' ||
        (typeof entry === 'number' && Number.isSafeInteger(entry)),
    )
  )
    return false;
  if (value.name === 'open') {
    return value.sequence === 0 && value.sessionNonce === null && value.values.length === 0;
  }
  return typeof value.sessionNonce === 'string' && NONCE.test(value.sessionNonce);
}

/** Domain-separated digest signed by the paired certificate for every query. */
export function digestProtectedOperatorWireCommand(value: ProtectedOperatorWireCommand): string {
  if (!validWireCommand(value)) throw new Error('Invalid protected operator command.');
  return `sha256:${createHash('sha256')
    .update('fetanagent:protected-operator-query:v1\n', 'utf8')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex')}`;
}

const dateColumns: Partial<Record<ProtectedOperatorQueryName, readonly string[]>> = {
  snapshot: [
    'requested_at',
    'request_expires_at',
    'certificate_valid_from',
    'certificate_valid_until',
  ],
  activate: ['valid_until'],
  watchdogRenew: ['lease_expires_at'],
};

/** Rebuild only the known Postgres timestamps expected by the existing issuer. */
export function decodeProtectedOperatorRows(
  name: ProtectedOperatorQueryName,
  value: unknown,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error();
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
    const decoded = { ...(row as Record<string, unknown>) };
    for (const column of dateColumns[name] ?? []) {
      const raw = decoded[column];
      if (typeof raw !== 'string' || !UTC_INSTANT.test(raw)) throw new Error();
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== raw) throw new Error();
      decoded[column] = date;
    }
    return decoded;
  });
}
