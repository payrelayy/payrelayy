import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'playwright-core';

import {
  installProviderSessionWebSocketBoundary,
  isReviewedAdminSessionWebSocketUrl,
  isReviewedSessionWebSocketMessage,
} from './provider-websocket.js';

const SESSION_SOCKET = 'wss://admin-api.agt-digi.com/ws?accessToken=local-test-token&apiType=admin';
const SEPARATOR = '\u001e';

describe('reviewed KemerBet session WebSocket', () => {
  it('admits only the exact admin session socket, without exposing the token in an event', () => {
    expect(isReviewedAdminSessionWebSocketUrl(SESSION_SOCKET)).toBe(true);
    for (const url of [
      'wss://admin-api.agt-digi.com/ws?apiType=admin&accessToken=local-test-token',
      'wss://admin-api.agt-digi.com/ws?accessToken=local-test-token&apiType=admin&x=1',
      'wss://admin-api.agt-digi.com/ws?accessToken=local-test-token&apiType=jobs',
      'wss://admin-api.agt-digi.com/ws?accessToken=&apiType=admin',
      'ws://admin-api.agt-digi.com/ws?accessToken=local-test-token&apiType=admin',
      'wss://job.agt-digi.com/ws?accessToken=local-test-token&apiType=admin',
      'wss://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit?accessToken=local-test-token&apiType=admin',
    ]) {
      expect(isReviewedAdminSessionWebSocketUrl(url)).toBe(false);
    }
  });

  it('admits only SignalR handshake, ping and the bounded UpdateSession invocation', () => {
    expect(
      isReviewedSessionWebSocketMessage(`{"protocol":"json","version":1}${SEPARATOR}`, false),
    ).toBe(true);
    expect(isReviewedSessionWebSocketMessage(`{"type":6}${SEPARATOR}`, true)).toBe(true);
    expect(
      isReviewedSessionWebSocketMessage(
        `{"type":1,"invocationId":"5","target":"UpdateSession","arguments":["session-1",42,"agent"]}${SEPARATOR}`,
        true,
      ),
    ).toBe(true);
    for (const message of [
      `{"type":1,"target":"PlayerEPOSDeposit","arguments":["1",25]}${SEPARATOR}`,
      `{"type":1,"target":"UpdateSession","arguments":[{},42,"agent"]}${SEPARATOR}`,
      `{"type":1,"target":"UpdateSession","arguments":["s",42,"agent"],"x":1}${SEPARATOR}`,
      `{"type":1,"target":"UpdateSession","arguments":["s",42,"agent"]}`,
      `{"protocol":"json","version":1}${SEPARATOR}`,
    ]) {
      expect(isReviewedSessionWebSocketMessage(message, true)).toBe(false);
    }
    expect(isReviewedSessionWebSocketMessage(Buffer.from('binary'), true)).toBe(false);
    expect(isReviewedSessionWebSocketMessage(`{"type":6}${SEPARATOR}`, false)).toBe(false);
  });

  it('forwards only reviewed session frames and closes on a financial or unknown message', async () => {
    let handler: ((route: unknown) => void) | undefined;
    const routeWebSocket = vi.fn(async (_matcher, callback) => {
      handler = callback;
    });
    let phase: 'signed_in_read_only' | 'manual_login' = 'signed_in_read_only';
    await installProviderSessionWebSocketBoundary(
      { routeWebSocket } as unknown as BrowserContext,
      () => phase,
    );
    expect(routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));

    const send = vi.fn();
    const close = vi.fn(async () => undefined);
    let onMessage: ((message: string | Buffer) => void) | undefined;
    handler?.({
      url: () => SESSION_SOCKET,
      connectToServer: () => ({ send }),
      onMessage: (callback: (message: string | Buffer) => void) => {
        onMessage = callback;
      },
      close,
    });
    const handshake = `{"protocol":"json","version":1}${SEPARATOR}`;
    const keepalive = `{"type":1,"invocationId":"1","target":"UpdateSession","arguments":["s",42,"agent"]}${SEPARATOR}`;
    onMessage?.(handshake);
    onMessage?.(keepalive);
    expect(send.mock.calls).toEqual([[handshake], [keepalive]]);

    onMessage?.(`{"type":1,"target":"WalletCredit","arguments":[]}${SEPARATOR}`);
    expect(close).toHaveBeenCalledWith(
      expect.objectContaining({ code: 1008, reason: 'Unreviewed provider message' }),
    );
    expect(send).toHaveBeenCalledTimes(2);

    phase = 'manual_login';
    onMessage?.(`{"type":6}${SEPARATOR}`);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not connect the admin socket before a signed-in candidate is visible', async () => {
    let handler: ((route: unknown) => void) | undefined;
    await installProviderSessionWebSocketBoundary(
      {
        routeWebSocket: vi.fn(async (_matcher, callback) => {
          handler = callback;
        }),
      } as unknown as BrowserContext,
      () => 'manual_login',
    );
    const close = vi.fn(async () => undefined);
    const connectToServer = vi.fn();
    handler?.({ url: () => SESSION_SOCKET, close, connectToServer });
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ code: 1008 }));
    expect(connectToServer).not.toHaveBeenCalled();
  });
});
