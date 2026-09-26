import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI,
  PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
  loadWindowsCompanionConfig,
  redactedWindowsCompanionConfig,
} from './config.js';
import {
  ensureCompanionDeviceEnrollment,
  loadCompanionDeviceSigningRuntime,
  type CompanionDeviceEnrollmentResult,
} from './device-enrollment.js';
import { loadWindowsCompanionExecutionHandoff } from './execution-activation-handoff.js';
import {
  deliverCompanionExecutionLaunchProofAndAwaitPermit,
  deliverCompanionLaunchProof,
  takeCompanionLaunchProofRequest,
} from './launch-proof-channel.js';
import { verifyWindowsCompanionInstallationTree } from './installation-tree.js';
import {
  startLocalKemerBetSession,
  type LocalKemerBetSessionEvent,
} from './local-kemerbet-session.js';
import {
  runCompanionExecutionWorker,
  type CompanionExecutionWorkerEvent,
} from './execution-worker.js';
import { runCompanionLookupWorker, type CompanionLookupWorkerEvent } from './lookup-worker.js';

function report(event: LocalKemerBetSessionEvent): void {
  const messages: Record<LocalKemerBetSessionEvent['state'], string> = {
    starting: 'Opening the protected local KemerBet browser…',
    login_required: 'KemerBet is ready. Sign in directly in the Chrome window.',
    signed_in_candidate:
      'KemerBet agent page detected; account and session identity have not been verified. Financial requests remain blocked.',
    verifying_identity:
      'KemerBet agent page detected. Verifying the exact locally bound identity without uploading it…',
    signed_in_verified:
      'The exact locally bound KemerBet identity is verified. Financial actions remain disabled.',
    stopping: 'Stopping the local KemerBet browser…',
    stopped: 'The local KemerBet browser stopped.',
    failed: 'The local KemerBet browser could not continue. Financial requests remain blocked.',
  };
  console.info(
    JSON.stringify({
      component: 'fetanagent_windows_companion',
      event: 'session_state_changed',
      state: event.state,
      reason: event.reason,
      detailsRedacted: true,
      transferDisabled: true,
    }),
  );
  console.info(messages[event.state]);
  if (event.reason === 'mutation_attempt_blocked' || event.reason === 'provider_request_failed') {
    console.info(
      'An unapproved or failed provider request was stopped. The local browser remains available.',
    );
  }
  if (
    event.reason === 'identity_confirmation_required' ||
    event.reason === 'identity_binding_unavailable' ||
    event.reason === 'identity_mismatch'
  ) {
    console.info(
      'Local KemerBet identity verification failed closed. Reopen the reviewed companion and confirm the exact agent header locally.',
    );
  }
}

function reportEnrollment(result: CompanionDeviceEnrollmentResult | undefined): void {
  const state = result?.devicePaired
    ? 'paired'
    : result?.pairingRequired
      ? 'pairing_required'
      : 'failed';
  console.info(
    JSON.stringify({
      component: 'fetanagent_windows_companion',
      event: 'device_pairing_state_changed',
      state,
      detailsRedacted: true,
      transferDisabled: true,
      moneyMoved: false,
    }),
  );
  if (state === 'paired') {
    console.info(
      result?.alreadyPaired
        ? 'The local companion device certificate is verified. Signed exact-five read-only lookup is ready.'
        : 'The local companion device is paired with a signed no-money certificate. Signed exact-five read-only lookup is ready.',
    );
  } else if (state === 'pairing_required') {
    console.info(
      'Device pairing is required. Create a one-use Windows companion package on the authenticated Owner page, then restart this companion and paste it into the local launcher.',
    );
  } else {
    console.info(
      'Device pairing failed closed. The KemerBet browser remains local and every financial request remains blocked.',
    );
  }
}

function reportLookup(event: CompanionLookupWorkerEvent): void {
  console.info(
    JSON.stringify({
      component: 'fetanagent_windows_companion',
      event: 'exact_five_lookup_state_changed',
      state: event.state,
      ...(event.foundCount === undefined ? {} : { foundCount: event.foundCount }),
      ...(event.reviewRequiredCount === undefined
        ? {}
        : { reviewRequiredCount: event.reviewRequiredCount }),
      detailsRedacted: true,
      identifiersRedacted: true,
      transferDisabled: true,
      moneyMoved: false,
    }),
  );
}

function reportExecution(event: CompanionExecutionWorkerEvent): void {
  console.info(
    JSON.stringify({
      component: 'fetanagent_windows_companion',
      event: 'one_use_execution_state_changed',
      state: event.state,
      amountMinorUnits: event.amountMinorUnits,
      currencyCode: event.currencyCode,
      moneyMovedLocally: event.moneyMovedLocally,
      detailsRedacted: true,
      identifiersRedacted: true,
    }),
  );
}

export async function runWindowsCompanion(): Promise<void> {
  const config = loadWindowsCompanionConfig();
  const launchProofRequest = takeCompanionLaunchProofRequest(
    process.env,
    config.executionV2Enabled,
  );
  console.info(
    JSON.stringify({
      component: 'fetanagent_windows_companion',
      event: 'starting',
      config: redactedWindowsCompanionConfig(config),
    }),
  );
  const pairingPackage = config.takePairingPackage();
  const session = await startLocalKemerBetSession(config, report);
  const lookupAbort = new AbortController();
  void session.done.finally(() => lookupAbort.abort()).catch(() => undefined);
  const enrollmentPromise = session.verified.then(async (verified) => {
    if (!verified) return;
    let stage: 'pairing' | 'device_runtime' | 'execution_handoff' | 'launch_proof' | 'workers' =
      'pairing';
    try {
      const enrollment = await ensureCompanionDeviceEnrollment({
        dataRoot: config.dataRoot,
        releaseSha: config.releaseSha,
        ...(pairingPackage === undefined ? {} : { pairingPackage }),
      });
      reportEnrollment(enrollment);
      if (!enrollment.devicePaired) return;
      stage = 'device_runtime';
      const baseDevice = await loadCompanionDeviceSigningRuntime({ dataRoot: config.dataRoot });
      if (config.executionV2Enabled) stage = 'execution_handoff';
      const handoff = config.executionV2Enabled
        ? await loadWindowsCompanionExecutionHandoff(
            config.dataRoot,
            {
              certificateBodyDigest: baseDevice.certificate.bodyDigest,
              expectedAccountId: config.executionV2ExpectedPlatformAgentAccountId!,
              releaseSha: config.releaseSha,
            },
            resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
          )
        : undefined;
      if (launchProofRequest) {
        stage = 'launch_proof';
        const installationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
        const installationTreeSha256 = await readFile(
          resolve(installationRoot, 'INSTALLATION_TREE_SHA256'),
          'utf8',
        );
        await verifyWindowsCompanionInstallationTree(
          installationRoot,
          config.releaseSha,
          installationTreeSha256,
        );
        const processContext = {
          challenge: launchProofRequest.challenge,
          releaseSha: config.releaseSha,
          installationTreeSha256,
          processId: process.pid,
          startedAt: new Date(performance.timeOrigin).toISOString(),
          observedAt: new Date().toISOString(),
        };
        if (handoff) {
          const proof = baseDevice.createSignedExecutionLaunchProof({
            ...processContext,
            requestKey: handoff.requestKey,
            activationEpoch: handoff.activationEpoch,
            platformAgentAccountId: handoff.accountId,
            executionHandoffSha256: handoff.handoffSha256,
          });
          await deliverCompanionExecutionLaunchProofAndAwaitPermit(
            launchProofRequest,
            proof,
            lookupAbort.signal,
          );
        } else {
          const proof = baseDevice.createSignedLaunchProof(processContext);
          await deliverCompanionLaunchProof(launchProofRequest, proof);
        }
      }
      const device = handoff
        ? await loadCompanionDeviceSigningRuntime({
            dataRoot: config.dataRoot,
            execution: {
              expectedPlatformAgentAccountId: handoff.accountId,
              trustedExecutionSignerKeyId: PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID,
              trustedExecutionSignerPublicKeySpki:
                PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI,
              trustedExecutionSignerPublicKeySpkiSha256:
                PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256,
            },
          })
        : baseDevice;
      const remainingHandoffMs = handoff ? handoff.expiresAtMs - Date.now() : undefined;
      if (remainingHandoffMs !== undefined && remainingHandoffMs <= 0) {
        throw new Error('The signed Windows companion execution handoff expired.');
      }
      const handoffExpiryTimer =
        remainingHandoffMs === undefined
          ? undefined
          : setTimeout(() => lookupAbort.abort(), remainingHandoffMs);
      stage = 'workers';
      try {
        const workers: Promise<void>[] = [
          runCompanionLookupWorker({
            dataRoot: config.dataRoot,
            device,
            session,
            signal: lookupAbort.signal,
            report: reportLookup,
          }),
        ];
        if (handoff) {
          workers.push(
            runCompanionExecutionWorker({
              dataRoot: config.dataRoot,
              device,
              expectedActivationEpoch: handoff.activationEpoch,
              handoffExpiresAtMs: handoff.expiresAtMs,
              session,
              signal: lookupAbort.signal,
              report: reportExecution,
            }),
          );
        }
        await Promise.all(workers);
      } finally {
        if (handoffExpiryTimer) clearTimeout(handoffExpiryTimer);
      }
    } catch {
      if (stage === 'pairing' || stage === 'device_runtime') {
        reportEnrollment(undefined);
      } else {
        console.info(
          JSON.stringify({
            component: 'fetanagent_windows_companion',
            event:
              stage === 'execution_handoff'
                ? 'execution_startup_failed_closed'
                : stage === 'launch_proof'
                  ? 'launch_proof_failed_closed'
                  : 'companion_worker_failed_closed',
            reason:
              stage === 'execution_handoff'
                ? 'signed_handoff_or_installation_unavailable'
                : stage === 'launch_proof'
                  ? 'local_launch_proof_unavailable'
                  : 'companion_worker_unavailable',
            detailsRedacted: true,
            ...(stage === 'execution_handoff' || stage === 'launch_proof'
              ? { moneyMoved: false }
              : {}),
          }),
        );
        if (stage === 'launch_proof') await session.stop();
      }
    }
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    report({ state: 'stopping', transferDisabled: true, detailsRedacted: true });
    void session.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await session.done;
  lookupAbort.abort();
  await enrollmentPromise;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runWindowsCompanion();
}
