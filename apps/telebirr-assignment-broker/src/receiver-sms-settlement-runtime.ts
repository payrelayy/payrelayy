import { createRequire } from 'node:module';

import {
  guardedCa,
  readGuardedText,
  type TelebirrAssignmentBrokerConfigDependencies,
} from './telebirr-assignment-broker-config.js';
import { ROUTINE_PAID_POLL_DATABASE_TARGETS } from './routine-paid-poll-runtime.js';
import { createSerializedPostgresLane } from './serialized-postgres-lane.js';

const target = ROUTINE_PAID_POLL_DATABASE_TARGETS.production;
const GROUP = 'fetanagent_receiver_sms_settlement';
const RUNTIME = 'fetanagent_receiver_sms_settlement_runtime';
const DATABASE_URL_FILE = '/run/secrets/receiver_sms_settlement_database_url';
const CA_FILE = '/run/configs/supabase_ca_certificate';
const FUNCTION = 'app.settle_next_receiver_sms_match()';

export const RECEIVER_SMS_SETTLEMENT_PREFLIGHT_SQL = `
  select
    current_user = '${RUNTIME}' and session_user = current_user as identity,
    exists (select 1 from pg_catalog.pg_roles role
      where role.rolname = current_user and role.rolcanlogin and not role.rolinherit
        and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 1 and role.rolvaliduntil is not null
        and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
        and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '30 days 5 minutes')
      as runtime_safe,
    exists (select 1 from pg_catalog.pg_roles role where role.rolname = '${GROUP}'
      and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
      and not role.rolcreatedb and not role.rolcreaterole and not role.rolbypassrls)
      as group_safe,
    (select count(*) = 1 and pg_catalog.bool_and(granted.rolname = '${GROUP}'
      and membership.inherit_option and not membership.set_option
      and not membership.admin_option)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where member.rolname = current_user) as membership_exact,
    pg_catalog.pg_has_role(current_user, '${GROUP}', 'USAGE') and
      not pg_catalog.pg_has_role(current_user, '${GROUP}', 'SET') as group_inherited,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE') and
      not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE') as schema_safe,
    not exists (select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app' and
        ((relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
          current_user, relation.oid, 'USAGE,SELECT,UPDATE')) or
         (relation.relkind in ('r','p','v','m','f') and
          (pg_catalog.has_table_privilege(current_user, relation.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') or
           pg_catalog.has_any_column_privilege(current_user, relation.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'))))) as no_base_access,
    exists (select 1 from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner on owner.oid = routine.proowner
      where routine.oid = pg_catalog.to_regprocedure('${FUNCTION}')
        and routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
        and owner.rolname = 'postgres') as function_hardened,
    pg_catalog.has_function_privilege(current_user,
      pg_catalog.to_regprocedure('${FUNCTION}'), 'EXECUTE')
      and not exists (select 1 from pg_catalog.pg_proc routine
        join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
        where namespace.nspname not in ('pg_catalog','information_schema')
          and namespace.nspname !~ '^pg_(toast|temp)'
          and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
          and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
          and routine.oid <> pg_catalog.to_regprocedure('${FUNCTION}'))
      as exact_function_surface
`;

const PREFLIGHT_KEYS = [
  'identity',
  'runtime_safe',
  'group_safe',
  'membership_exact',
  'group_inherited',
  'schema_safe',
  'no_base_access',
  'function_hardened',
  'exact_function_surface',
] as const;
const OUTCOMES = new Set(['disabled', 'empty', 'queued', 'held_review']);

export interface ReceiverSmsSettlementClient {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: () => void): void;
  removeListener(event: 'error' | 'end', listener: () => void): void;
}

export interface ReceiverSmsSettlementConnection {
  readonly host: string;
  readonly user: string;
  readonly password: string;
  readonly ca: string;
}

function connectionFromUrl(raw: string, ca: string): ReceiverSmsSettlementConnection {
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const direct = url.hostname === target.directHost && user === RUNTIME;
  const pooled =
    url.hostname === target.sessionPoolerHost && user === `${RUNTIME}.${target.projectReference}`;
  const params = [...url.searchParams.entries()];
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    (!direct && !pooled) ||
    (url.port !== '' && url.port !== '5432') ||
    decodeURIComponent(url.pathname.slice(1)) !== 'postgres' ||
    password.length < 16 ||
    /[\r\n\0]/u.test(password) ||
    url.hash !== '' ||
    params.length !== 1 ||
    params[0]?.[0] !== 'sslmode' ||
    params[0]?.[1] !== 'verify-full'
  )
    throw new Error('Receiver SMS settlement database unavailable');
  return { host: url.hostname, user, password, ca };
}

export function loadReceiverSmsSettlementConfig(
  environment: NodeJS.ProcessEnv,
  dependencies: TelebirrAssignmentBrokerConfigDependencies = {},
): ReceiverSmsSettlementConnection | undefined {
  const flag = environment.INTERNAL_RECEIVER_SMS_SETTLEMENT_ENABLED;
  if (flag === undefined || flag === 'false') return undefined;
  if (
    flag !== 'true' ||
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET !== 'production' ||
    environment.TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED !== 'true' ||
    environment.RECEIVER_SMS_SETTLEMENT_DATABASE_URL_FILE !== DATABASE_URL_FILE ||
    environment.RECEIVER_SMS_SETTLEMENT_DATABASE_URL !== undefined ||
    environment.NODE_EXTRA_CA_CERTS !== undefined
  )
    throw new Error('Receiver SMS settlement configuration unavailable');
  const ca = guardedCa(readGuardedText(CA_FILE, dependencies, 'public_config'));
  return connectionFromUrl(readGuardedText(DATABASE_URL_FILE, dependencies, 'secret').trim(), ca);
}

async function assertCatalog(client: ReceiverSmsSettlementClient): Promise<void> {
  const result = await client.query(RECEIVER_SMS_SETTLEMENT_PREFLIGHT_SQL, []);
  if (
    result.rows.length !== 1 ||
    typeof result.rows[0] !== 'object' ||
    result.rows[0] === null ||
    Array.isArray(result.rows[0])
  )
    throw new Error();
  const row = result.rows[0] as Record<string, unknown>;
  if (
    Object.keys(row).length !== PREFLIGHT_KEYS.length ||
    !PREFLIGHT_KEYS.every((key) => row[key] === true)
  )
    throw new Error();
}

/** Serialized connection; each poll proves its one-function runtime boundary anew. */
export async function createReceiverSmsSettlementRuntime(
  connection: ReceiverSmsSettlementConnection,
  createClient?: (config: Readonly<Record<string, unknown>>) => ReceiverSmsSettlementClient,
) {
  const config = Object.freeze({
    host: connection.host,
    port: 5432,
    database: 'postgres',
    user: connection.user,
    password: connection.password,
    application_name: 'fetanagent_receiver_sms_settlement',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ssl: Object.freeze({ ca: connection.ca, rejectUnauthorized: true }),
  });
  const client =
    createClient?.(config) ??
    (() => {
      const require = createRequire(import.meta.url);
      const { Client } = require('pg') as {
        Client: new (config: Readonly<Record<string, unknown>>) => ReceiverSmsSettlementClient;
      };
      return new Client(config);
    })();
  const lane = createSerializedPostgresLane();
  let available = false;
  let closed = false;
  const unavailable = () => {
    available = false;
  };
  client.on('error', unavailable);
  client.on('end', unavailable);
  try {
    await client.connect();
    await assertCatalog(client);
    available = true;
  } catch {
    await client.end().catch(() => undefined);
    client.removeListener('error', unavailable);
    client.removeListener('end', unavailable);
    throw new Error('Receiver SMS settlement database unavailable');
  }
  return Object.freeze({
    async poll(): Promise<'disabled' | 'empty' | 'queued' | 'held_review'> {
      if (!available || closed) throw new Error('Receiver SMS settlement database unavailable');
      return lane.run(async () => {
        try {
          await assertCatalog(client);
          const result = await client.query(
            'select app.settle_next_receiver_sms_match() as outcome',
            [],
          );
          const row = result.rows[0];
          if (
            result.rows.length !== 1 ||
            typeof row !== 'object' ||
            row === null ||
            Array.isArray(row) ||
            Object.keys(row).length !== 1 ||
            !('outcome' in row) ||
            typeof row.outcome !== 'string' ||
            !OUTCOMES.has(row.outcome)
          )
            throw new Error();
          return row.outcome as 'disabled' | 'empty' | 'queued' | 'held_review';
        } catch {
          unavailable();
          throw new Error('Receiver SMS settlement database unavailable');
        }
      });
    },
    async ready() {
      if (!available || closed) return false;
      try {
        await lane.run(() => assertCatalog(client));
        return available && !closed;
      } catch {
        unavailable();
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      unavailable();
      await lane.drain();
      await client.end();
      client.removeListener('error', unavailable);
      client.removeListener('end', unavailable);
    },
  });
}
