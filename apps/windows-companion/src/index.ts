import { pathToFileURL } from 'node:url';

import { loadWindowsCompanionConfig, redactedWindowsCompanionConfig } from './config.js';
import {
  startLocalKemerBetSession,
  type LocalKemerBetSessionEvent,
} from './local-kemerbet-session.js';

function report(event: LocalKemerBetSessionEvent): void {
  const messages: Record<LocalKemerBetSessionEvent['state'], string> = {
    starting: 'Opening the protected local KemerBet browser…',
    login_required: 'KemerBet is ready. Sign in directly in the Chrome window.',
    signed_in_candidate:
      'KemerBet returned an account-info response. This is a sign-in candidate, not verified account identity. Financial requests remain blocked.',
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
  const session = await startLocalKemerBetSession(config, report);
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
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runWindowsCompanion();
}
