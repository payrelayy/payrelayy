import { pathToFileURL } from 'node:url';

import { loadWindowsCompanionConfig, redactedWindowsCompanionConfig } from './config.js';
import {
  ensureCompanionDeviceEnrollment,
  loadCompanionDeviceSigningRuntime,
  type CompanionDeviceEnrollmentResult,
} from './device-enrollment.js';
import {
  startLocalKemerBetSession,
  type LocalKemerBetSessionEvent,
} from './local-kemerbet-session.js';
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

export async function runWindowsCompanion(): Promise<void> {
  const config = loadWindowsCompanionConfig();
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
    try {
      const enrollment = await ensureCompanionDeviceEnrollment({
        dataRoot: config.dataRoot,
        releaseSha: config.releaseSha,
        ...(pairingPackage === undefined ? {} : { pairingPackage }),
      });
      reportEnrollment(enrollment);
      if (!enrollment.devicePaired) return;
      const device = await loadCompanionDeviceSigningRuntime({ dataRoot: config.dataRoot });
      await runCompanionLookupWorker({
        dataRoot: config.dataRoot,
        device,
        session,
        signal: lookupAbort.signal,
        report: reportLookup,
      });
    } catch {
      reportEnrollment(undefined);
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
