import type { BrowserContext, Page, Response } from 'playwright-core';

import {
  isReviewedAdminSessionWebSocketUrl,
  type ProviderSessionTransportEvent,
} from './provider-websocket.js';

const REFRESH_URL = 'https://admin-api.agt-digi.com/Account/RefreshToken';
const ACCOUNT_INFO_ORIGIN = 'https://admin-api.agt-digi.com';
const SIGNALR_RECORD_SEPARATOR = '\u001e';
const MAX_REFRESH_ERROR_BODY_BYTES = 4_096;

const refreshErrorCodes = {
  invalid_grant: 'refresh_error_invalid_grant',
  invalid_request: 'refresh_error_invalid_request',
  invalid_token: 'refresh_error_invalid_token',
  invalid_refresh_token: 'refresh_error_invalid_token',
  refresh_token_invalid: 'refresh_error_invalid_token',
  refresh_token_is_invalid: 'refresh_error_invalid_token',
  expired_token: 'refresh_error_expired',
  token_expired: 'refresh_error_expired',
  refresh_token_expired: 'refresh_error_expired',
  refresh_token_is_expired: 'refresh_error_expired',
  expired_refresh_token: 'refresh_error_expired',
  session_expired: 'refresh_error_expired',
  session_is_expired: 'refresh_error_expired',
  revoked_token: 'refresh_error_revoked',
  token_revoked: 'refresh_error_revoked',
  refresh_token_revoked: 'refresh_error_revoked',
  session_revoked: 'refresh_error_revoked',
  session_is_revoked: 'refresh_error_revoked',
  session_conflict: 'refresh_error_session_conflict',
  concurrent_session: 'refresh_error_session_conflict',
  session_replaced: 'refresh_error_session_conflict',
  missing_refresh_token: 'refresh_error_missing_token',
  refresh_token_missing: 'refresh_error_missing_token',
} as const;

type RefreshErrorCodeEvent =
  | (typeof refreshErrorCodes)[keyof typeof refreshErrorCodes]
  | 'refresh_error_code_unrecognized'
  | 'refresh_error_code_missing'
  | 'refresh_error_body_unavailable';

export type ProviderSessionDiagnosticEvent =
  | ProviderSessionTransportEvent
  | 'admin_socket_browser_opened'
  | 'admin_socket_refresh_received'
  | 'admin_socket_logout_received'
  | 'admin_socket_closed'
  | 'refresh_http_succeeded'
  | 'refresh_http_auth_rejected'
  | 'refresh_http_bad_request'
  | 'refresh_http_conflict'
  | 'refresh_http_unprocessable'
  | 'refresh_http_rate_limited'
  | 'refresh_http_redirected'
  | 'refresh_http_server_error'
  | 'refresh_http_rejected'
  | 'refresh_http_network_failed'
  | RefreshErrorCodeEvent
  | 'account_info_auth_rejected'
  | 'account_info_server_error'
  | 'account_info_network_failed'
  | 'guarded_page_reload_started'
  | 'guarded_page_reload_committed'
  | 'guarded_page_reload_failed'
  | 'automatic_signin_started'
  | 'automatic_signin_submitted'
  | 'automatic_signin_unavailable'
  | 'automatic_signin_challenge'
  | 'automatic_signin_failed';

function isAccountInfoUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.origin === ACCOUNT_INFO_ORIGIN && url.pathname === '/Account/Info';
  } catch {
    return false;
  }
}

function classifyRefreshHttpStatus(status: number): ProviderSessionDiagnosticEvent {
  if (status >= 200 && status < 300) return 'refresh_http_succeeded';
  if (status === 401 || status === 403) return 'refresh_http_auth_rejected';
  if (status === 400) return 'refresh_http_bad_request';
  if (status === 409) return 'refresh_http_conflict';
  if (status === 422) return 'refresh_http_unprocessable';
  if (status === 429) return 'refresh_http_rate_limited';
  if (status >= 300 && status < 400) return 'refresh_http_redirected';
  if (status >= 500) return 'refresh_http_server_error';
  return 'refresh_http_rejected';
}

function knownRefreshErrorCode(value: unknown): RefreshErrorCodeEvent | undefined {
  if (typeof value !== 'string' || value.length > 80) return undefined;
  const normalized = value
    .trim()
    .replace(/[.!?]+$/u, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[\s-]+/gu, '_')
    .toLowerCase();
  if (!Object.hasOwn(refreshErrorCodes, normalized)) return undefined;
  return refreshErrorCodes[normalized as keyof typeof refreshErrorCodes];
}

/** Parse in memory, but return only a fixed reason category. Never retain provider text. */
export function classifyRefreshErrorBody(body: Buffer): RefreshErrorCodeEvent {
  if (body.byteLength > MAX_REFRESH_ERROR_BODY_BYTES) return 'refresh_error_body_unavailable';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return 'refresh_error_body_unavailable';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'refresh_error_body_unavailable';
  }
  const object = parsed as Record<string, unknown>;
  const nestedError = object.error;
  const candidates = [
    object.errorCode,
    object.error_code,
    object.code,
    typeof nestedError === 'object' && nestedError !== null && !Array.isArray(nestedError)
      ? (nestedError as Record<string, unknown>).code
      : nestedError,
    object.message,
  ];
  for (const candidate of candidates) {
    const category = knownRefreshErrorCode(candidate);
    if (category) return category;
  }
  return candidates.some((candidate) => candidate !== undefined && candidate !== null)
    ? 'refresh_error_code_unrecognized'
    : 'refresh_error_code_missing';
}

async function reportRefreshErrorCode(
  response: Response,
  reportDiagnostic: (event: ProviderSessionDiagnosticEvent) => void,
): Promise<void> {
  let category: RefreshErrorCodeEvent = 'refresh_error_body_unavailable';
  try {
    const headers = response.headers();
    const mediaType = headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    const contentLength = headers['content-length'];
    if (
      (mediaType === 'application/json' || mediaType?.endsWith('+json')) &&
      (contentLength === undefined ||
        (/^\d{1,8}$/u.test(contentLength) && Number(contentLength) <= MAX_REFRESH_ERROR_BODY_BYTES))
    ) {
      category = classifyRefreshErrorBody(await response.body());
    }
  } catch {
    // Diagnostic reads must not interfere with the browser's refresh request.
  }
  try {
    reportDiagnostic(category);
  } catch {
    // Diagnostic reporting must not interfere with the browser session.
  }
}

/** Classify only a SignalR event name; never copy a provider frame or token into telemetry. */
export function classifyProviderSessionServerFrame(
  payload: string | Buffer,
): 'admin_socket_refresh_received' | 'admin_socket_logout_received' | undefined {
  if (
    typeof payload !== 'string' ||
    Buffer.byteLength(payload, 'utf8') > 4_096 ||
    !payload.endsWith(SIGNALR_RECORD_SEPARATOR)
  ) {
    return undefined;
  }
  for (const frame of payload.slice(0, -1).split(SIGNALR_RECORD_SEPARATOR)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const event = parsed as Record<string, unknown>;
    if (event.type === 1 && event.target === 'RefreshToken') {
      return 'admin_socket_refresh_received';
    }
    if (event.type === 1 && event.target === 'Logout') return 'admin_socket_logout_received';
  }
  return undefined;
}

/** Passive observers leave the guarded provider request and WebSocket routes unchanged. */
export function installProviderSessionPassiveDiagnostics(
  context: BrowserContext,
  page: Page,
  reportDiagnostic: (event: ProviderSessionDiagnosticEvent) => void,
): void {
  page.on('websocket', (websocket) => {
    if (!isReviewedAdminSessionWebSocketUrl(websocket.url())) return;
    reportDiagnostic('admin_socket_browser_opened');
    websocket.on('framereceived', ({ payload }) => {
      const event = classifyProviderSessionServerFrame(payload);
      if (event) reportDiagnostic(event);
    });
    websocket.on('close', () => reportDiagnostic('admin_socket_closed'));
  });
  context.on('response', (response) => {
    if (response.url() === REFRESH_URL && response.request().method() === 'POST') {
      reportDiagnostic(classifyRefreshHttpStatus(response.status()));
      if (response.status() === 400) {
        void reportRefreshErrorCode(response, reportDiagnostic);
      }
    } else if (isAccountInfoUrl(response.url()) && response.request().method() === 'GET') {
      if (response.status() === 401 || response.status() === 403) {
        reportDiagnostic('account_info_auth_rejected');
      } else if (response.status() >= 500) {
        reportDiagnostic('account_info_server_error');
      }
    }
  });
  context.on('requestfailed', (request) => {
    if (request.url() === REFRESH_URL && request.method() === 'POST') {
      reportDiagnostic('refresh_http_network_failed');
    } else if (isAccountInfoUrl(request.url()) && request.method() === 'GET') {
      reportDiagnostic('account_info_network_failed');
    }
  });
}
