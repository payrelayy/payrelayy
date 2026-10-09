import {
  guardedCa,
  readGuardedText,
  type TelebirrAssignmentBrokerConfigDependencies,
} from './telebirr-assignment-broker-config.js';
import { ROUTINE_NO_MONEY_CA_FILE } from './routine-no-money-config.js';
import { ROUTINE_PAID_POLL_DATABASE_TARGETS } from './routine-paid-poll-runtime.js';
import type { RoutinePaidSettlementConnectionConfig } from './routine-paid-settlement-runtime.js';

export const ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE =
  '/run/secrets/routine_paid_settlement_database_url';
const RUNTIME_ROLE = 'fetanagent_routine_telebirr_paid_settlement_runtime';
const target = ROUTINE_PAID_POLL_DATABASE_TARGETS.production;

export class RoutinePaidSettlementConfigError extends Error {
  constructor() {
    super('The private routine paid settlement configuration is unavailable.');
    this.name = 'RoutinePaidSettlementConfigError';
  }
}

function unavailable(): never {
  throw new RoutinePaidSettlementConfigError();
}

/** No broad environment URL fallback; only the exact protected production file. */
export function loadRoutinePaidSettlementConfig(
  environment: NodeJS.ProcessEnv,
  dependencies: TelebirrAssignmentBrokerConfigDependencies = {},
): RoutinePaidSettlementConnectionConfig {
  if (
    environment.INTERNAL_ROUTINE_PAID_SETTLEMENT_WORKER_ENABLED !== 'true' ||
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'live' ||
    environment.ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE !==
      ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE ||
    environment.NODE_EXTRA_CA_CERTS !== undefined ||
    environment.ROUTINE_PAID_SETTLEMENT_DATABASE_URL !== undefined
  )
    return unavailable();
  try {
    const value = readGuardedText(
      ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE,
      dependencies,
      'secret',
    ).trim();
    const ca = guardedCa(readGuardedText(ROUTINE_NO_MONEY_CA_FILE, dependencies, 'public_config'));
    const url = new URL(value);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = decodeURIComponent(url.pathname.slice(1));
    const direct = url.hostname === target.directHost && user === RUNTIME_ROLE;
    const pooled =
      url.hostname === target.sessionPoolerHost &&
      user === `${RUNTIME_ROLE}.${target.projectReference}`;
    const params = [...url.searchParams.entries()];
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      (!direct && !pooled) ||
      (url.port !== '' && url.port !== '5432') ||
      database !== 'postgres' ||
      password.length < 16 ||
      /[\r\n\0]/u.test(password) ||
      url.hash !== '' ||
      params.length !== 1 ||
      params[0]?.[0] !== 'sslmode' ||
      params[0]?.[1] !== 'verify-full'
    )
      return unavailable();
    return Object.freeze({
      target: 'production',
      host: direct ? target.directHost : target.sessionPoolerHost,
      port: 5432,
      database: 'postgres',
      user,
      password,
      ca,
    });
  } catch {
    return unavailable();
  }
}
