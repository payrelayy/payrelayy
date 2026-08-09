import { Client, type ClientConfig } from 'pg';
import { readFileSync } from 'node:fs';

const expectedHost = 'postgres';
const expectedMode = 'local-disposable';
const expectedMigrationsDirectory = '/workspace/supabase/migrations';
const expectedRunnerMarker = 'payreplayy-sql-integration-image-v1';
const expectedRunnerMarkerPath = '/usr/local/share/payreplayy/sql-integration-runner';

const forbiddenEnvironmentNames = [
  'DATABASE_URL',
  'NONCE_RETENTION_DATABASE_URL',
  'PGDATABASE',
  'PGHOST',
  'PGPASSWORD',
  'PGPORT',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGUSER',
];

function assertImageBakedRunnerAttestation(environment: NodeJS.ProcessEnv): void {
  if (environment.SQL_INTEGRATION_RUNNER_SENTINEL !== expectedRunnerMarker) {
    throw new Error('SQL integration tests may run only in the disposable runner image.');
  }

  let runnerMarker: string;
  try {
    runnerMarker = readFileSync(expectedRunnerMarkerPath, 'utf8').trim();
  } catch {
    throw new Error('SQL integration tests may run only in the disposable runner image.');
  }

  if (runnerMarker !== expectedRunnerMarker) {
    throw new Error('SQL integration tests may run only in the disposable runner image.');
  }
}

export interface SqlIntegrationEnvironment {
  readonly host: typeof expectedHost;
  readonly migrationsDirectory: typeof expectedMigrationsDirectory;
}

export function readSqlIntegrationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): SqlIntegrationEnvironment {
  for (const name of Object.keys(environment)) {
    if (forbiddenEnvironmentNames.includes(name) || /^PG[A-Z0-9_]*$/u.test(name.toUpperCase())) {
      throw new Error(`${name} is forbidden for the disposable SQL integration harness.`);
    }
  }

  assertImageBakedRunnerAttestation(environment);

  if (environment.SQL_INTEGRATION_MODE !== expectedMode) {
    throw new Error('SQL integration mode must be local-disposable.');
  }

  if (environment.SQL_INTEGRATION_POSTGRES_HOST !== expectedHost) {
    throw new Error('SQL integration must use only the internal postgres hostname.');
  }

  if (environment.SQL_INTEGRATION_MIGRATIONS_DIRECTORY !== expectedMigrationsDirectory) {
    throw new Error('SQL integration migrations directory must be the bundled checked-in source.');
  }

  return {
    host: expectedHost,
    migrationsDirectory: expectedMigrationsDirectory,
  };
}

export function createSqlIntegrationClient(environment: SqlIntegrationEnvironment): Client {
  const config: ClientConfig = {
    application_name: 'payreplayy_sql_integration',
    database: 'postgres',
    host: environment.host,
    port: 5432,
    ssl: false,
    user: 'postgres',
  };

  return new Client(config);
}
