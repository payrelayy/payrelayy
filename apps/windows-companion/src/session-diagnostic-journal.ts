import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LocalKemerBetSessionEvent } from './local-kemerbet-session.js';
import type { LocalKemerBetRoutinePreflightStage } from './local-kemerbet-deposit.js';
import type { ProviderSessionDiagnosticEvent } from './provider-session-diagnostic.js';

const LOG_DIRECTORY = 'diagnostics';
const LOG_FILE = 'kemerbet-session.jsonl';
const MAX_LOG_BYTES = 8 * 1_048_576;

const sessionStates: Record<LocalKemerBetSessionEvent['state'], true> = {
  starting: true,
  login_required: true,
  signed_in_candidate: true,
  verifying_identity: true,
  signed_in_verified: true,
  review_paused: true,
  stopping: true,
  stopped: true,
  failed: true,
};
const sessionReasons: Record<NonNullable<LocalKemerBetSessionEvent['reason']>, true> = {
  candidate_lifetime_complete: true,
  browser_closed: true,
  identity_binding_created: true,
  identity_binding_unavailable: true,
  identity_confirmation_required: true,
  identity_mismatch: true,
  login_lifetime_expired: true,
  mutation_attempt_blocked: true,
  profile_in_use: true,
  profile_path_unsafe: true,
  provider_request_failed: true,
  shutdown_unconfirmed: true,
  session_lifetime_complete: true,
  startup_failed: true,
  unexpected_page: true,
};
const providerStates: Record<ProviderSessionDiagnosticEvent, true> = {
  admin_socket_admitted: true,
  admin_socket_blocked_phase: true,
  admin_socket_blocked_url: true,
  admin_socket_handshake_forwarded: true,
  admin_socket_update_forwarded: true,
  admin_socket_frame_rejected: true,
  admin_socket_send_failed: true,
  admin_socket_browser_opened: true,
  admin_socket_refresh_received: true,
  admin_socket_logout_received: true,
  admin_socket_closed: true,
  refresh_http_succeeded: true,
  refresh_http_auth_rejected: true,
  refresh_http_bad_request: true,
  refresh_http_conflict: true,
  refresh_http_unprocessable: true,
  refresh_http_rate_limited: true,
  refresh_http_redirected: true,
  refresh_http_server_error: true,
  refresh_http_rejected: true,
  refresh_http_network_failed: true,
  refresh_error_invalid_grant: true,
  refresh_error_invalid_request: true,
  refresh_error_invalid_token: true,
  refresh_error_expired: true,
  refresh_error_revoked: true,
  refresh_error_session_conflict: true,
  refresh_error_missing_token: true,
  refresh_error_code_unrecognized: true,
  refresh_error_code_missing: true,
  refresh_error_body_unavailable: true,
  account_info_auth_rejected: true,
  account_info_server_error: true,
  account_info_network_failed: true,
  guarded_page_reload_started: true,
  guarded_page_reload_committed: true,
  guarded_page_reload_failed: true,
  automatic_signin_started: true,
  automatic_signin_submitted: true,
  automatic_signin_unavailable: true,
  automatic_signin_challenge: true,
  automatic_signin_failed: true,
};
const preflightStates: Record<LocalKemerBetRoutinePreflightStage, true> = {
  session_unavailable: true,
  preflight_started: true,
  preflight_retry_in_place: true,
  financial_actions_opened: true,
  financial_actions_page_unavailable: true,
  deposit_menu_unavailable: true,
  deposit_menu_ready: true,
  deposit_menu_click_failed: true,
  deposit_menu_selected: true,
  player_tile_selected: true,
  search_surface_ready: true,
  player_lookup_started: true,
  player_lookup_verified: true,
  amount_fields_filled: true,
  prepared_surface_verified: true,
  prepared_root_unavailable: true,
  prepared_controls_unavailable: true,
  prepared_identity_unavailable: true,
  prepared_identity_mismatch: true,
  prepared_currency_mismatch: true,
  prepared_amount_mismatch: true,
  prepared_notes_mismatch: true,
  prepared_transfer_disabled: true,
  prepared_surface_unavailable: true,
  amount_prepared: true,
  no_money_rehearsal_completed: true,
  final_action_requested: true,
  final_action_fenced: true,
  post_fence_surface_verified: true,
  final_action_expired: true,
  route_authorization_unavailable: true,
  transfer_click_requested: true,
  transfer_click_completed: true,
  transfer_click_uncertain: true,
  provider_route_submission_attempted: true,
  provider_route_uncertain: true,
  success_modal_confirmed: true,
  success_modal_unavailable: true,
};
type ProcessState = 'started' | 'parent_disconnected' | 'stop_requested' | 'exited';
const processStates: Record<ProcessState, true> = {
  started: true,
  parent_disconnected: true,
  stop_requested: true,
  exited: true,
};

export type SessionDiagnosticJournalInput =
  | {
      readonly category: 'session';
      readonly state: LocalKemerBetSessionEvent['state'];
      readonly reason?: LocalKemerBetSessionEvent['reason'];
    }
  | { readonly category: 'provider'; readonly state: ProviderSessionDiagnosticEvent }
  | { readonly category: 'preflight'; readonly state: LocalKemerBetRoutinePreflightStage }
  | {
      readonly category: 'process';
      readonly state: ProcessState;
    };

export interface SessionDiagnosticJournal {
  record(input: SessionDiagnosticJournalInput): void;
  flush(): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Unsafe diagnostic file.');
    return file.size;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function appendRecord(path: string, line: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const folder = await lstat(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink()) {
    throw new Error('Unsafe diagnostic directory.');
  }
  const previousPath = `${path}.1`;
  const currentSize = await regularFileSize(path);
  if ((currentSize ?? 0) + Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES) {
    const previousSize = await regularFileSize(previousPath);
    if (previousSize !== undefined) await unlink(previousPath);
    if (currentSize !== undefined) await rename(path, previousPath);
  }
  const file = await open(path, 'a', 0o600);
  try {
    await file.writeFile(line, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Only fixed event names and reason codes enter this local, bounded diagnostic log. */
export function createSessionDiagnosticJournal(options: {
  readonly dataRoot: string;
  readonly releaseSha: string;
  readonly onFailure?: () => void;
}): SessionDiagnosticJournal {
  if (!/^(?:[0-9a-f]{40}|local-development)$/u.test(options.releaseSha)) {
    throw new Error('Invalid diagnostic release identity.');
  }
  const path = join(options.dataRoot, LOG_DIRECTORY, LOG_FILE);
  const launchId = randomUUID();
  const startedAt = performance.now();
  let queue: Promise<void> = Promise.resolve();
  let failureReported = false;
  const reportFailure = (): void => {
    if (failureReported) return;
    failureReported = true;
    try {
      if (options.onFailure) options.onFailure();
      else console.error('KemerBet session diagnostics could not be saved locally.');
    } catch {
      // A diagnostic warning must never interrupt a guarded payment operation.
    }
  };
  return {
    record(input) {
      let entry: Record<string, unknown>;
      if (input.category === 'session') {
        if (
          !Object.hasOwn(sessionStates, input.state) ||
          (input.reason !== undefined && !Object.hasOwn(sessionReasons, input.reason))
        )
          return;
        entry = {
          category: 'session',
          state: input.state,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        };
      } else if (input.category === 'provider') {
        if (!Object.hasOwn(providerStates, input.state)) return;
        entry = { category: 'provider', state: input.state };
      } else if (input.category === 'preflight') {
        if (!Object.hasOwn(preflightStates, input.state)) return;
        entry = { category: 'preflight', state: input.state };
      } else if (input.category === 'process') {
        if (!Object.hasOwn(processStates, input.state)) return;
        entry = { category: 'process', state: input.state };
      } else return;
      const line = `${JSON.stringify({
        version: 1,
        recordedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        launchId,
        releaseSha: options.releaseSha,
        ...entry,
      })}\n`;
      queue = queue.then(() => appendRecord(path, line)).catch(reportFailure);
    },
    async flush() {
      await queue;
    },
  };
}
