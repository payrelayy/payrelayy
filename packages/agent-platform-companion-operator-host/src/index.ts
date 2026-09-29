import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openProtectedOperatorQueryHost } from '@fetanagent/agent-platform-companion-activation-issuer/protected-operator-query-host';
import { createProtectedHandoffRequestHandler } from '@fetanagent/agent-platform-companion-activation-issuer/protected-handoff-request';
import { createProtectedOperatorBootstrapRequestHandler } from '@fetanagent/agent-platform-companion-activation-issuer/protected-operator-bootstrap-request';
import { PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256 } from '@fetanagent/agent-platform-companion-execution-contracts';
import pg from 'pg';

import {
  parseOperatorHostLaunchDocument,
  type OperatorHostLaunchDocument,
} from './launch-document.js';
import { verifyPublishedCompanionRelease } from './release-verification.js';

const { Client } = pg;
const PROJECT_REF = 'xzztugbgtulptnbpoelr';
const SIGNER_KEY_ID = 'companion-server-production-v1';
const EMERGENCY_SQL = '/workspace/infra/sql/production-companion-execution-emergency-disable.sql';
const EXECUTION_SIGNER_FILE = '/run/secrets/companion_execution_signer.pkcs8.der';
const MAX_INPUT_BYTES = 16 * 1024;
const PROBE_SQL = `select case when session_user = 'postgres'
  and current_user = 'postgres'
  and not pg_catalog.pg_is_in_recovery()
  and (select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid())
  then 1 else 0 end`;
const BACKEND_SQL = `select pg_catalog.pg_backend_pid() as backend_pid`;
const SIGNER_SQL = `select signer.public_key_spki, signer.public_key_spki_sha256
  from app.agent_platform_companion_server_signers signer
  left join app.agent_platform_companion_server_signer_revocations revoked
    on revoked.server_signer_id = signer.id
 where signer.signer_key_id = $1::text
   and signer.valid_from <= pg_catalog.clock_timestamp()
   and signer.valid_until > pg_catalog.clock_timestamp()
   and revoked.server_signer_id is null
 limit 2`;

type PsqlAction = 'probe' | 'disable';

async function readOneLaunchDocument(): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  let size = 0;
  const deadline = setTimeout(() => process.stdin.destroy(new Error()), 30_000);
  try {
    for await (const part of process.stdin) {
      const bytes = Buffer.from(part);
      size += bytes.byteLength;
      if (size > MAX_INPUT_BYTES) throw new Error();
      parts.push(bytes);
    }
    if (size === 0) throw new Error();
    const raw = Buffer.concat(parts);
    for (const part of parts) part.fill(0);
    return raw;
  } finally {
    clearTimeout(deadline);
  }
}

async function runPsql(
  action: PsqlAction,
  document: OperatorHostLaunchDocument,
  caPath: string,
): Promise<void> {
  const args =
    action === 'probe'
      ? ['-X', '-q', '-A', '-t', '-c', PROBE_SQL]
      : ['-X', '-q', '-f', EMERGENCY_SQL];
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: '/tmp',
    LANG: 'C',
    PGHOST: document.database.host,
    PGPORT: String(document.database.port),
    PGUSER: document.database.user,
    PGDATABASE: document.database.database,
    PGPASSWORD: document.database.password,
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: caPath,
    PGCONNECT_TIMEOUT: '5',
    PRODUCTION_PROJECT_REF: PROJECT_REF,
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/psql', args, {
      env,
      stdio: ['ignore', action === 'probe' ? 'pipe' : 'ignore', 'ignore'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 16) child.kill('SIGKILL');
    });
    const deadline = setTimeout(
      () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      },
      action === 'probe' ? 10_000 : 100_000,
    );
    child.once('error', () => {
      clearTimeout(deadline);
      reject(new Error('Independent database operation unavailable.'));
    });
    child.once('close', (code) => {
      clearTimeout(deadline);
      if (code === 0 && (action !== 'probe' || output.trim() === '1')) resolve();
      else reject(new Error('Independent database operation unavailable.'));
    });
  });
}

export function signerPublicKey(rows: readonly Record<string, unknown>[]): Uint8Array {
  if (rows.length !== 1) throw new Error();
  const encoded = rows[0]?.['public_key_spki'];
  const digest = rows[0]?.['public_key_spki_sha256'];
  if (
    typeof encoded !== 'string' ||
    !/^[A-Za-z0-9_-]{122}$/u.test(encoded) ||
    typeof digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(digest)
  )
    throw new Error();
  const key = Buffer.from(encoded, 'base64url');
  if (
    key.byteLength !== 91 ||
    key.toString('base64url') !== encoded ||
    `sha256:${createHash('sha256').update(key).digest('hex')}` !== digest
  )
    throw new Error();
  return key;
}

export function checkedExecutionSignerPrivateKey(
  raw: Buffer,
  expectedPublicKeyDigest = PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
): KeyObject {
  const key = createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' });
  if (
    key.asymmetricKeyType !== 'ec' ||
    `sha256:${createHash('sha256').update(publicKey).digest('hex')}` !== expectedPublicKeyDigest
  )
    throw new Error();
  return key;
}

async function executionSignerPrivateKey(): Promise<KeyObject> {
  const stat = await lstat(EXECUTION_SIGNER_FILE);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 100 || stat.size > 4096)
    throw new Error();
  const raw = await readFile(EXECUTION_SIGNER_FILE);
  try {
    return checkedExecutionSignerPrivateKey(raw);
  } finally {
    raw.fill(0);
  }
}

/** A container-private, one-shot process: no service unit and no credential at rest. */
export async function runOperatorHost(document: OperatorHostLaunchDocument): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'fetanagent-operator-host-'));
  const caPath = join(scratch, 'database-ca.crt');
  let client: pg.Client | undefined;
  let host: Awaited<ReturnType<typeof openProtectedOperatorQueryHost>> | undefined;
  let disablePromise: Promise<void> | undefined;
  const disableDatabase = (): Promise<void> => {
    disablePromise ??= runPsql('disable', document, caPath).catch((error: unknown) => {
      // A failed kill-switch attempt may be retried by the exact host-close
      // path; a successful attempt is never repeated just to close a session.
      disablePromise = undefined;
      throw error;
    });
    return disablePromise;
  };
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await writeFile(caPath, document.databaseCaPem, { mode: 0o600, flag: 'wx' });
    // The stop client is a separate psql process, never this session or a
    // transaction pooler. Prove it can connect before opening the listener.
    await runPsql('probe', document, caPath);
    client = new Client({
      ...document.database,
      ssl: {
        ca: document.databaseCaPem,
        rejectUnauthorized: true,
        servername: document.database.host,
      },
      connectionTimeoutMillis: 5_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
      application_name: 'fetanagent-protected-operator-host',
    });
    await client.connect();
    const probe = await client.query(PROBE_SQL);
    if (probe.rows.length !== 1 || probe.rows[0]?.case !== 1) throw new Error();
    const backend = await client.query(BACKEND_SQL);
    const backendPid: unknown = backend.rows[0]?.backend_pid;
    if (backend.rows.length !== 1 || !Number.isInteger(backendPid) || (backendPid as number) < 1)
      throw new Error();
    const signer = await client.query(SIGNER_SQL, [SIGNER_KEY_ID]);
    const publicKey = signerPublicKey(signer.rows);
    const executionSigner = await executionSignerPrivateKey();
    const administrator = {
      processID: backendPid as number,
      async query(sql: string, values: unknown[]) {
        const result = await client!.query(sql, values);
        return { rows: result.rows as readonly Record<string, unknown>[] };
      },
      on(event: 'error' | 'end', listener: () => void) {
        client!.on(event, listener);
      },
      off(event: 'error' | 'end', listener: () => void) {
        client!.off(event, listener);
      },
    };
    host = await openProtectedOperatorQueryHost({
      administrator,
      requestKey: document.requestKey,
      disableDatabase,
      closeAdministrator: () => client!.end(),
      trustedNoMoneySignerKeyId: SIGNER_KEY_ID,
      trustedNoMoneySignerPublicKeySpkiDer: publicKey,
      trustedNow: () => new Date(),
      bootstrapSession: createProtectedOperatorBootstrapRequestHandler({
        administrator,
        requestKey: document.requestKey,
        trustedNoMoneySignerKeyId: SIGNER_KEY_ID,
        trustedNoMoneySignerPublicKeySpkiDer: publicKey,
        trustedNow: () => new Date(),
      }),
      signHandoff: createProtectedHandoffRequestHandler({
        administrator,
        trustedNoMoneySignerKeyId: SIGNER_KEY_ID,
        trustedNoMoneySignerPublicKeySpkiDer: publicKey,
        signerPrivateKey: executionSigner,
        verifyPublishedRelease: (request) =>
          verifyPublishedCompanionRelease(request, document.releaseTag, () => new Date()),
        trustedNow: () => new Date(),
      }),
      signal: controller.signal,
    });
    await host.stopped;
  } catch {
    controller.abort();
    if (host) {
      try {
        await host.stop();
      } catch {
        // If the exact close is uncertain, make one independent stop attempt.
        await disableDatabase();
      }
    }
    throw new Error('Protected operator host unavailable; reconcile before activation.');
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (client && !host) await client.end().catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const raw = await readOneLaunchDocument();
  try {
    await runOperatorHost(parseOperatorHostLaunchDocument(raw));
  } finally {
    raw.fill(0);
  }
}

if (process.argv[1]?.endsWith('/agent-platform-companion-operator-host/dist/index.js')) {
  main().catch(() => {
    process.stderr.write('Protected operator host unavailable; reconcile before activation.\n');
    process.exitCode = 1;
  });
}
