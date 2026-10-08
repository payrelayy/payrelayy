import {
  guardedCa,
  readGuardedText,
  type TelebirrAssignmentBrokerConfigDependencies,
} from './telebirr-assignment-broker-config.js';
import {
  ROUTINE_NO_MONEY_CA_FILE,
  ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE,
  ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE,
  ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE,
  loadRoutineLookupMaterial,
  type RoutineLookupMaterial,
} from './routine-no-money-config.js';
import {
  ROUTINE_PAID_POLL_DATABASE_TARGETS,
  type RoutinePaidPollConnectionConfig,
} from './routine-paid-poll-runtime.js';

export const ROUTINE_PAID_POLL_DATABASE_URL_FILE = '/run/secrets/routine_paid_poll_database_url';
export const ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY_FILE =
  ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE;
export const ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY_FILE = ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE;
export const ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE = ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE;
export const ROUTINE_PAID_POLL_CA_FILE = ROUTINE_NO_MONEY_CA_FILE;

const RUNTIME_ROLE = 'fetanagent_routine_telebirr_paid_poll_runtime';
const target = ROUTINE_PAID_POLL_DATABASE_TARGETS.production;

export interface RoutinePaidPollConfig extends RoutineLookupMaterial {
  readonly connection: RoutinePaidPollConnectionConfig;
}

export class RoutinePaidPollConfigError extends Error {
  constructor() {
    super('The private routine paid poll broker configuration is unavailable.');
    this.name = 'RoutinePaidPollConfigError';
  }
}

function unavailable(): never {
  throw new RoutinePaidPollConfigError();
}

function connectionFromUrl(value: string, ca: string): RoutinePaidPollConnectionConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable();
  }
  let user: string;
  let password: string;
  let database: string;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return unavailable();
  }
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
}

/** No credential is opened unless the independent paid mode is explicitly enabled. */
export function loadRoutinePaidPollConfig(
  environment: NodeJS.ProcessEnv,
  dependencies: TelebirrAssignmentBrokerConfigDependencies = {},
): RoutinePaidPollConfig | undefined {
  const flag = environment.INTERNAL_ROUTINE_PAID_POLL_BROKER_ENABLED;
  if (flag === undefined || flag === 'false') return undefined;
  if (
    flag !== 'true' ||
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET !== 'production' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED !== 'true' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED !== 'true' ||
    environment.NODE_EXTRA_CA_CERTS !== undefined ||
    environment.ROUTINE_PAID_POLL_DATABASE_URL_FILE !== ROUTINE_PAID_POLL_DATABASE_URL_FILE ||
    environment.ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY_FILE !==
      ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY_FILE ||
    environment.ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY_FILE !==
      ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY_FILE ||
    environment.ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE !== ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE ||
    [
      'ROUTINE_PAID_POLL_DATABASE_URL',
      'ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY',
      'ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY',
    ].some((name) => environment[name] !== undefined)
  )
    return unavailable();
  try {
    const ca = guardedCa(readGuardedText(ROUTINE_PAID_POLL_CA_FILE, dependencies, 'public_config'));
    const connection = connectionFromUrl(
      readGuardedText(ROUTINE_PAID_POLL_DATABASE_URL_FILE, dependencies, 'secret').trim(),
      ca,
    );
    return Object.freeze({ connection, ...loadRoutineLookupMaterial(dependencies) });
  } catch {
    return unavailable();
  }
}
