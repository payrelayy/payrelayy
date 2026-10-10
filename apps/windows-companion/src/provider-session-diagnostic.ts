import type { BrowserContext, Page } from 'playwright-core';

import {
  isReviewedAdminSessionWebSocketUrl,
  type ProviderSessionTransportEvent,
} from './provider-websocket.js';

const REFRESH_URL = 'https://admin-api.agt-digi.com/Account/RefreshToken';
const SIGNALR_RECORD_SEPARATOR = '\u001e';

export type ProviderSessionDiagnosticEvent =
  | ProviderSessionTransportEvent
  | 'admin_socket_browser_opened'
  | 'admin_socket_refresh_received'
  | 'admin_socket_logout_received'
  | 'admin_socket_closed'
  | 'refresh_http_succeeded'
  | 'refresh_http_rejected'
  | 'refresh_http_network_failed';

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
    if (response.url() !== REFRESH_URL || response.request().method() !== 'POST') return;
    reportDiagnostic(
      response.status() >= 200 && response.status() < 300
        ? 'refresh_http_succeeded'
        : 'refresh_http_rejected',
    );
  });
  context.on('requestfailed', (request) => {
    if (request.url() === REFRESH_URL && request.method() === 'POST') {
      reportDiagnostic('refresh_http_network_failed');
    }
  });
}
