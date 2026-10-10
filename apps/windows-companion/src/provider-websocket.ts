import type { BrowserContext, WebSocketRoute } from 'playwright-core';

import type { LocalKemerBetGuardPhase } from './request-guard.js';

const ADMIN_SESSION_SOCKET_ORIGIN = 'wss://admin-api.agt-digi.com';
const MAX_SESSION_SOCKET_FRAME_BYTES = 4_096;
const SIGNALR_RECORD_SEPARATOR = '\u001e';

function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function boundedIdentifier(value: unknown): boolean {
  return (
    (typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= 128 &&
      /^[A-Za-z0-9._:-]+$/u.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}

/** Only the session hub used by KemerBet's own refresh flow may leave this browser. */
export function isReviewedAdminSessionWebSocketUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    url.origin !== ADMIN_SESSION_SOCKET_ORIGIN ||
    url.pathname !== '/ws' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return false;
  }
  const query = [...url.searchParams.entries()];
  return (
    query.length === 2 &&
    query[0]?.[0] === 'accessToken' &&
    typeof query[0][1] === 'string' &&
    query[0][1].length >= 1 &&
    query[0][1].length <= 4_096 &&
    !/[\u0000-\u001f\u007f]/u.test(query[0][1]) &&
    query[1]?.[0] === 'apiType' &&
    query[1][1] === 'admin'
  );
}

/** SignalR's handshake, ping and one reviewed non-financial invocation are the entire allowance. */
export function isReviewedSessionWebSocketMessage(
  message: string | Buffer,
  handshakeComplete: boolean,
): boolean {
  if (typeof message !== 'string') return false;
  if (
    Buffer.byteLength(message, 'utf8') > MAX_SESSION_SOCKET_FRAME_BYTES ||
    !message.endsWith(SIGNALR_RECORD_SEPARATOR)
  ) {
    return false;
  }
  const frames = message.slice(0, -1).split(SIGNALR_RECORD_SEPARATOR);
  if (frames.length < 1 || frames.length > 4 || frames.some((frame) => frame.length === 0)) {
    return false;
  }
  for (const [index, frame] of frames.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame) as unknown;
    } catch {
      return false;
    }
    if (!plainRecord(parsed)) return false;
    if (!handshakeComplete && index === 0) {
      if (Object.keys(parsed).length !== 2 || parsed.protocol !== 'json' || parsed.version !== 1) {
        return false;
      }
      continue;
    }
    if (parsed.type === 6) {
      if (Object.keys(parsed).length !== 1) return false;
      continue;
    }
    if (
      parsed.type !== 1 ||
      parsed.target !== 'UpdateSession' ||
      !Array.isArray(parsed.arguments) ||
      parsed.arguments.length !== 3 ||
      !parsed.arguments.every(boundedIdentifier)
    ) {
      return false;
    }
    const names = Object.keys(parsed).sort();
    if (
      names.join(',') !== 'arguments,target,type' &&
      names.join(',') !== 'arguments,invocationId,target,type'
    ) {
      return false;
    }
    if (
      parsed.invocationId !== undefined &&
      (typeof parsed.invocationId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,32}$/u.test(parsed.invocationId))
    ) {
      return false;
    }
  }
  return true;
}

/** Keep KemerBet's own refresh event working without opening a generic provider socket lane. */
export async function installProviderSessionWebSocketBoundary(
  context: BrowserContext,
  phase: () => LocalKemerBetGuardPhase,
): Promise<void> {
  await context.routeWebSocket('**/*', (socket) => {
    if (phase() !== 'signed_in_read_only' || !isReviewedAdminSessionWebSocketUrl(socket.url())) {
      void socket
        .close({ code: 1008, reason: 'Unreviewed provider transport' })
        .catch(() => undefined);
      return;
    }
    const server: WebSocketRoute = socket.connectToServer();
    let handshakeComplete = false;
    socket.onMessage((message) => {
      if (
        phase() !== 'signed_in_read_only' ||
        !isReviewedSessionWebSocketMessage(message, handshakeComplete)
      ) {
        void socket
          .close({ code: 1008, reason: 'Unreviewed provider message' })
          .catch(() => undefined);
        return;
      }
      handshakeComplete = true;
      try {
        server.send(message);
      } catch {
        void socket
          .close({ code: 1011, reason: 'Provider session unavailable' })
          .catch(() => undefined);
      }
    });
  });
}
