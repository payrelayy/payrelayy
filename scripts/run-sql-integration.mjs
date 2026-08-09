import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every invocation owns a fresh Compose project. This prevents cleanup from
// affecting a pre-existing disposable run if one was interrupted earlier.
const sqlIntegrationProjectName = `payreplayy-sql-integration-${randomBytes(12).toString('hex')}`;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const composeFile = resolve(repositoryRoot, 'infra', 'compose.sql-integration.yaml');
const composeEnvironmentFile =
  process.platform === 'win32'
    ? resolve(repositoryRoot, 'infra', 'sql-integration.empty.env')
    : '/dev/null';

const forbiddenEnvironmentNames = [
  'DATABASE_URL',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'NONCE_RETENTION_DATABASE_URL',
  'PGDATABASE',
  'PGHOST',
  'PGPASSWORD',
  'PGPORT',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGUSER',
];

const forbiddenComposeMarkers = [
  'ports:',
  'volumes:',
  'env_file:',
  'secrets:',
  'docker.sock',
  'database_url',
];

let activeDockerChild;
let cleanupStarted = false;
let receivedSignal;

function interruptionError() {
  return new Error(
    `Disposable SQL integration was interrupted by ${receivedSignal}; Compose cleanup was requested.`,
  );
}

function requestGracefulShutdown(signal) {
  if (receivedSignal !== undefined) {
    return;
  }

  receivedSignal = signal;
  process.stderr.write(`Received ${signal}; requesting disposable SQL integration cleanup.\n`);

  if (!cleanupStarted && activeDockerChild !== undefined && !activeDockerChild.killed) {
    try {
      activeDockerChild.kill('SIGTERM');
    } catch {
      // The child may already have exited. The finally block still performs Compose teardown.
    }
  }
}

process.on('SIGINT', () => requestGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => requestGracefulShutdown('SIGTERM'));

function throwIfInterrupted() {
  if (receivedSignal !== undefined) {
    throw interruptionError();
  }
}

function assertSafeInvocation() {
  if (process.argv.length !== 2) {
    throw new Error('test:sql does not accept arguments or Compose overrides.');
  }

  for (const name of forbiddenEnvironmentNames) {
    if (Object.hasOwn(process.env, name)) {
      throw new Error(`${name} must be unset before the disposable SQL integration harness runs.`);
    }
  }
}

async function assertStaticComposeBoundary() {
  await access(composeFile);
  const composeSource = (await readFile(composeFile, 'utf8')).toLowerCase();

  for (const marker of forbiddenComposeMarkers) {
    if (composeSource.includes(marker)) {
      throw new Error(`SQL integration Compose file contains forbidden marker: ${marker}`);
    }
  }

  if (!composeSource.includes('sql_integration_postgres_host: postgres')) {
    throw new Error('SQL integration Compose file must use only the internal postgres hostname.');
  }

  if (!composeSource.includes('internal: true')) {
    throw new Error('SQL integration Compose network must remain internal.');
  }

  if (composeEnvironmentFile !== '/dev/null') {
    await access(composeEnvironmentFile);
    const environmentSource = await readFile(composeEnvironmentFile, 'utf8');
    const configuredVariables = environmentSource
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

    if (configuredVariables.length > 0) {
      throw new Error('SQL integration Compose environment file must remain empty.');
    }
  }
}

function isLocalDockerEndpoint(endpoint) {
  return endpoint.startsWith('unix://') || endpoint.startsWith('npipe:////./pipe/');
}

function runDocker(
  argumentsList,
  { allowFailure = false, captureOutput = false, phase = 'docker' } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = '';
    let settled = false;
    const child = spawn('docker', argumentsList, {
      cwd: repositoryRoot,
      shell: false,
      stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });

    activeDockerChild = child;

    if (captureOutput) {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        output += chunk;
      });
    }

    const settle = (outcome) => {
      if (settled) {
        return;
      }

      settled = true;
      if (activeDockerChild === child) {
        activeDockerChild = undefined;
      }

      if (outcome instanceof Error) {
        if (allowFailure) {
          resolvePromise(outcome);
          return;
        }

        rejectPromise(outcome);
        return;
      }

      resolvePromise(captureOutput ? output.trim() : undefined);
    };

    child.once('error', (error) => {
      settle(new Error(`Unable to invoke Docker for ${phase}: ${error.message}`, { cause: error }));
    });

    child.once('close', (code, signal) => {
      if (code === 0) {
        settle(undefined);
        return;
      }

      settle(
        new Error(
          `Docker ${argumentsList.join(' ')} failed with ${
            signal === null ? `exit code ${code ?? 'unknown'}` : `signal ${signal}`
          }.`,
        ),
      );
    });
  });
}

function runDockerCompose(argumentsList, options) {
  return runDocker(
    [
      'compose',
      '--env-file',
      composeEnvironmentFile,
      '--project-name',
      sqlIntegrationProjectName,
      '--file',
      composeFile,
      ...argumentsList,
    ],
    { ...options, phase: options?.phase ?? 'docker-compose' },
  );
}

async function assertLocalDockerTarget() {
  const activeContext = await runDocker(['context', 'show'], {
    captureOutput: true,
    phase: 'docker-context-show',
  });
  if (activeContext !== 'default') {
    throw new Error('Disposable SQL integration requires the Docker default context.');
  }

  const endpoint = await runDocker(
    ['context', 'inspect', 'default', '--format', '{{ (index .Endpoints "docker").Host }}'],
    {
      captureOutput: true,
      phase: 'docker-context-inspect',
    },
  );
  if (!isLocalDockerEndpoint(endpoint)) {
    throw new Error(
      'Disposable SQL integration requires a local Unix socket or Windows named-pipe Docker endpoint.',
    );
  }
}

async function main() {
  assertSafeInvocation();
  await assertStaticComposeBoundary();
  throwIfInterrupted();
  await assertLocalDockerTarget();
  throwIfInterrupted();

  let primaryFailure;
  let cleanupFailure;

  try {
    await runDockerCompose(['config', '--quiet']);
    throwIfInterrupted();
    await runDockerCompose([
      'up',
      '--build',
      '--abort-on-container-exit',
      '--exit-code-from',
      'sql-integration',
    ]);
  } catch (error) {
    primaryFailure = error;
  } finally {
    cleanupStarted = true;

    try {
      const result = await runDockerCompose(['down', '--volumes'], {
        allowFailure: true,
        phase: 'docker-compose-cleanup',
      });

      if (result instanceof Error) {
        cleanupFailure = result;
      }
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (receivedSignal !== undefined && primaryFailure === undefined) {
    primaryFailure = interruptionError();
  }

  if (primaryFailure !== undefined) {
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        'Disposable SQL integration failed and cleanup did not complete.',
      );
    }

    throw primaryFailure;
  }

  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

await main();
