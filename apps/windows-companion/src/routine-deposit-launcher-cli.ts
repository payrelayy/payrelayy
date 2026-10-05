import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { verifyCompanionLaunchProof } from '@fetanagent/agent-platform-companion-execution-contracts';

import { loadCompanionDeviceSigningRuntime } from './device-enrollment.js';
import { verifyWindowsCompanionInstallationTree } from './installation-tree.js';
import {
  COMPANION_ROUTINE_LOCAL_PERMIT_ACK_PREFIX,
  COMPANION_ROUTINE_LOCAL_PERMIT_PREFIX,
} from './launch-proof-channel.js';

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASE = /^[0-9a-f]{40}$/u;
const TREE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PIPE_PREFIX = '\\\\.\\pipe\\fetanagent-companion-launch-';
const MAX_PROOF_BYTES = 2_048;
const MAX_PROOF_WAIT_MS = 2 * 60_000;
const MAX_ACK_WAIT_MS = 10_000;
const MAX_PROCESS_CLOCK_SKEW_MS = 60_000;

export class RoutineDepositLauncherUnavailableError extends Error {
  constructor() {
    super('The protected routine-deposit launcher is unavailable.');
    this.name = 'RoutineDepositLauncherUnavailableError';
  }
}

function unavailable(): never {
  throw new RoutineDepositLauncherUnavailableError();
}

function safeWindowsEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'LOCALAPPDATA',
    'APPDATA',
    'USERPROFILE',
    'TEMP',
    'TMP',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramData',
  ]) {
    const value = source[key];
    if (value !== undefined) {
      if (value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) return unavailable();
      result[key] = value;
    }
  }
  const windowsRoot = result.SystemRoot ?? result.WINDIR;
  if (
    !windowsRoot ||
    !win32.isAbsolute(windowsRoot) ||
    !result.LOCALAPPDATA ||
    !result.USERPROFILE ||
    (result.SystemRoot &&
      result.WINDIR &&
      result.SystemRoot.toLowerCase() !== result.WINDIR.toLowerCase())
  ) {
    return unavailable();
  }
  result.PATH = `${windowsRoot}\\System32;${windowsRoot}`;
  return result;
}

function exactInput(environment: NodeJS.ProcessEnv): {
  readonly accountId: string;
  readonly dataRoot: string;
  readonly releaseSha: string;
} {
  const accountId = environment.FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID;
  const dataRoot = environment.FETANAGENT_COMPANION_DATA_ROOT;
  const releaseSha = environment.FETANAGENT_COMPANION_RELEASE_SHA;
  if (
    !accountId ||
    !ACCOUNT_ID.test(accountId) ||
    !dataRoot ||
    !win32.isAbsolute(dataRoot) ||
    dataRoot.length > 220 ||
    /[\u0000-\u001f\u007f]/u.test(dataRoot) ||
    !releaseSha ||
    !RELEASE.test(releaseSha) ||
    environment.INTERNAL_COMPANION_EXECUTION_V2_ENABLED !== undefined ||
    environment.INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED !== undefined ||
    environment.NODE_OPTIONS !== undefined
  ) {
    return unavailable();
  }
  return Object.freeze({ accountId, dataRoot: win32.normalize(dataRoot), releaseSha });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.disconnect();
  const stopped = await Promise.race([
    new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
    new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 15_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) child.kill();
}

async function main(): Promise<void> {
  if (process.platform !== 'win32' || process.argv.length !== 2) return unavailable();
  const input = exactInput(process.env);
  const installationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const treeDigest = (
    await readFile(resolve(installationRoot, 'INSTALLATION_TREE_SHA256'), 'utf8')
  ).trim();
  if (!TREE_DIGEST.test(treeDigest)) return unavailable();
  await verifyWindowsCompanionInstallationTree(installationRoot, input.releaseSha, treeDigest);
  const device = await loadCompanionDeviceSigningRuntime({ dataRoot: input.dataRoot });
  const certificate = device.certificate;
  const challenge = randomBytes(32).toString('base64url');
  const pipePath = `${PIPE_PREFIX}${randomBytes(16).toString('hex')}`;
  const server = createServer();
  let socket: Socket | undefined;
  let child: ChildProcess | undefined;
  let stopping = false;
  const requestStop = () => {
    if (stopping) return;
    stopping = true;
    if (child) void stopChild(child);
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(pipePath, () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
    const childStartedAt = Date.now();
    child = fork(resolve(installationRoot, 'app', 'dist', 'index.js'), [], {
      cwd: resolve(installationRoot, 'app'),
      detached: false,
      env: {
        ...safeWindowsEnvironment(process.env),
        FETANAGENT_COMPANION_DATA_ROOT: input.dataRoot,
        FETANAGENT_COMPANION_RELEASE_SHA: input.releaseSha,
        INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true',
        FETANAGENT_COMPANION_ROUTINE_PLATFORM_AGENT_ACCOUNT_ID: input.accountId,
        FETANAGENT_COMPANION_LAUNCH_CHALLENGE: challenge,
        FETANAGENT_COMPANION_LAUNCH_PIPE: pipePath,
      },
      execArgv: [],
      execPath: process.execPath,
      silent: false,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.on('error', () => undefined);
    if (!Number.isInteger(child.pid) || child.pid === undefined || child.pid < 1)
      return unavailable();
    const childProcessId = child.pid;
    await new Promise<void>((resolveProof, rejectProof) => {
      let settled = false;
      let accepted = false;
      let received = Buffer.alloc(0);
      let permitSent = false;
      let expectedAcknowledgement = '';
      const fail = () => finish(new RoutineDepositLauncherUnavailableError());
      const failServer = () => fail();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(ackTimer);
        server.off('error', failServer);
        if (error) rejectProof(error);
        else resolveProof();
      };
      const timer = setTimeout(fail, MAX_PROOF_WAIT_MS);
      let ackTimer: NodeJS.Timeout | undefined;
      server.once('error', failServer);
      server.on('connection', (candidate) => {
        if (accepted) {
          candidate.destroy();
          return;
        }
        accepted = true;
        socket = candidate;
        candidate.on('data', (chunk: Buffer) => {
          if (settled) return;
          received = Buffer.concat([received, chunk]);
          if (received.byteLength > MAX_PROOF_BYTES) {
            fail();
            return;
          }
          const newline = received.indexOf(10);
          if (newline < 0) return;
          if (!permitSent) {
            if (newline !== received.byteLength - 1) {
              fail();
              return;
            }
            try {
              const serialized = received.subarray(0, -1).toString('utf8');
              const proof: unknown = JSON.parse(serialized);
              if (
                serialized !== JSON.stringify(proof) ||
                proof === null ||
                typeof proof !== 'object'
              ) {
                fail();
                return;
              }
              const body = (proof as { body?: Record<string, unknown> }).body;
              const startedAt = typeof body?.startedAt === 'string' ? body.startedAt : '';
              const observedAt = typeof body?.observedAt === 'string' ? body.observedAt : '';
              const startedAtMs = Date.parse(startedAt);
              const observedAtMs = Date.parse(observedAt);
              if (
                !Number.isFinite(startedAtMs) ||
                !Number.isFinite(observedAtMs) ||
                startedAtMs < childStartedAt - MAX_PROCESS_CLOCK_SKEW_MS ||
                startedAtMs > childStartedAt + MAX_PROCESS_CLOCK_SKEW_MS ||
                observedAtMs < startedAtMs ||
                observedAtMs < childStartedAt - MAX_PROCESS_CLOCK_SKEW_MS ||
                observedAtMs > Date.now() + MAX_PROCESS_CLOCK_SKEW_MS ||
                !verifyCompanionLaunchProof(proof, {
                  challenge,
                  certificateBodyDigest: certificate.bodyDigest,
                  deviceKeyId: certificate.body.deviceKeyId,
                  devicePublicKeySpki: certificate.body.devicePublicKeySpki,
                  releaseSha: input.releaseSha,
                  installationTreeSha256: treeDigest,
                  processId: childProcessId,
                  startedAt,
                  observedAt,
                })
              ) {
                fail();
                return;
              }
              const proofDigest = `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
              expectedAcknowledgement = `${COMPANION_ROUTINE_LOCAL_PERMIT_ACK_PREFIX}${proofDigest}\n`;
              permitSent = true;
              received.fill(0);
              received = Buffer.alloc(0);
              clearTimeout(timer);
              ackTimer = setTimeout(fail, MAX_ACK_WAIT_MS);
              candidate.write(`${COMPANION_ROUTINE_LOCAL_PERMIT_PREFIX}${proofDigest}\n`);
            } catch {
              fail();
            }
            return;
          }
          const acknowledgement = received.toString('utf8');
          if (acknowledgement !== expectedAcknowledgement) {
            fail();
            return;
          }
          received.fill(0);
          finish();
        });
        candidate.once('error', fail);
        candidate.once('end', () => {
          if (!settled) fail();
        });
        candidate.once('close', () => {
          if (!settled) fail();
        });
      });
      child!.once('exit', () => {
        if (!settled) fail();
      });
    });
    socket?.destroy();
    await closeServer(server);
    const exitCode = await new Promise<number | null>((resolveExit) => {
      if (child!.exitCode !== null) resolveExit(child!.exitCode);
      else child!.once('exit', (code) => resolveExit(code));
    });
    if (!stopping && exitCode !== 0) return unavailable();
  } finally {
    socket?.destroy();
    await closeServer(server).catch(() => undefined);
    if (child) await stopChild(child);
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch {
    console.error(
      JSON.stringify({
        component: 'fetanagent_routine_deposit_launcher',
        result: 'stopped',
        identifiersRedacted: true,
      }),
    );
    process.exitCode = 1;
  }
}
