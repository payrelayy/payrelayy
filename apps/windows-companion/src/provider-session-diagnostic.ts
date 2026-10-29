import type { BrowserContext, Page } from 'playwright-core';

import {
  isReviewedAdminSessionWebSocketUrl,
  type ProviderSessionTransportEvent,
} from './provider-websocket.js';

const REFRESH_URL = 'https://admin-api.agt-digi.com/Account/RefreshToken';
const ACCOUNT_INFO_ORIGIN = 'https://admin-api.agt-digi.com';
const SIGNALR_RECORD_SEPARATOR = '\u001e';

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
  | 'account_info_auth_rejected'
  | 'account_info_server_error'
  | 'account_info_network_failed'
  | 'guarded_page_reload_started'
  | 'guarded_page_reload_committed'
  | 'guarded_page_reload_failed';

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
