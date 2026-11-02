import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH,
  digestCompanionSessionStatusContent,
  type CompanionKemerBetSessionReportState,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionDeviceSigningRuntime } from './device-enrollment.js';

export interface CompanionSessionStatusSource {
  isSignedInVerified(): boolean;
  state(): CompanionKemerBetSessionReportState;
}

/** This no-money report never carries a KemerBet identity, cookie, or credential. */
export async function reportCompanionSessionStatusOnce(
  device: Pick<
    CompanionDeviceSigningRuntime,
    'certificate' | 'sessionStatusEndpoint' | 'createSignedHttpRequest'
  >,
  source: CompanionSessionStatusSource,
  platformAgentAccountId: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
): Promise<boolean> {
  const localState = source.state();
  const state =
    localState === 'review_paused'
      ? localState
      : source.isSignedInVerified()
        ? 'signed_in_verified'
        : localState;
  const digest = digestCompanionSessionStatusContent(
    device.certificate.bodyDigest,
    platformAgentAccountId,
    state,
  );
  if (!digest) return false;
  const httpRequest = device.createSignedHttpRequest(
    AGENT_PLATFORM_COMPANION_SESSION_STATUS_PATH,
    digest,
  );
  try {
    const response = await fetchImplementation(device.sessionStatusEndpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
      },
      body: JSON.stringify({
        certificate: device.certificate,
        httpRequest,
        platformAgentAccountId,
        state,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    return response.status === 204 && response.body === null;
  } catch {
    return false;
  }
}

export async function runCompanionSessionStatusReporter(options: {
  readonly device: Pick<
    CompanionDeviceSigningRuntime,
    'certificate' | 'sessionStatusEndpoint' | 'createSignedHttpRequest'
  >;
  readonly source: CompanionSessionStatusSource;
  readonly platformAgentAccountId: string;
  readonly signal: AbortSignal;
  readonly fetchImplementation?: typeof fetch;
  readonly intervalMs?: number;
}): Promise<void> {
  const intervalMs = options.intervalMs ?? 20_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000)
    throw new Error('Invalid session status interval');
  while (!options.signal.aborted) {
    await reportCompanionSessionStatusOnce(
      options.device,
      options.source,
      options.platformAgentAccountId,
      options.signal,
      options.fetchImplementation,
    ).catch(() => false);
    if (options.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        options.signal.removeEventListener('abort', onAbort);
        resolve();
      }, intervalMs);
      timeout.unref();
      options.signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
