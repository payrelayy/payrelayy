import { EventEmitter } from 'node:events';

import type { BrowserContext, Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import {
  classifyProviderSessionServerFrame,
  installProviderSessionPassiveDiagnostics,
  type ProviderSessionDiagnosticEvent,
} from './provider-session-diagnostic.js';

const SOCKET_URL = 'wss://admin-api.agt-digi.com/ws?accessToken=do-not-log-me&apiType=admin';
const REFRESH_URL = 'https://admin-api.agt-digi.com/Account/RefreshToken';
const SEPARATOR = '\u001e';

describe('passive provider session diagnostics', () => {
  it('classifies only bounded SignalR refresh and logout event names', () => {
    expect(
      classifyProviderSessionServerFrame(
        `{"type":1,"target":"RefreshToken","arguments":["do-not-log-me"]}${SEPARATOR}`,
      ),
    ).toBe('admin_socket_refresh_received');
    expect(classifyProviderSessionServerFrame(`{"type":1,"target":"Logout"}${SEPARATOR}`)).toBe(
      'admin_socket_logout_received',
    );
    expect(
      classifyProviderSessionServerFrame(`{"type":1,"target":"WalletCredit"}${SEPARATOR}`),
    ).toBeUndefined();
    expect(classifyProviderSessionServerFrame(Buffer.from('binary'))).toBeUndefined();
    expect(classifyProviderSessionServerFrame('not-json')).toBeUndefined();
  });

  it('observes only exact session transport and refresh outcomes without touching message bodies', () => {
    const context = new EventEmitter();
    const page = new EventEmitter();
    const events: ProviderSessionDiagnosticEvent[] = [];
    installProviderSessionPassiveDiagnostics(
      context as unknown as BrowserContext,
      page as unknown as Page,
      (event) => events.push(event),
    );

    const socket = new EventEmitter() as EventEmitter & { url: () => string };
    socket.url = () => SOCKET_URL;
    page.emit('websocket', socket);
    socket.emit('framereceived', {
      payload: `{"type":1,"target":"RefreshToken","arguments":["do-not-log-me"]}${SEPARATOR}`,
    });
    socket.emit('close');
    const unreadBody = vi.fn(() => {
      throw new Error('Diagnostics must not read provider data.');
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 200,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 401,
      body: unreadBody,
    });
    context.emit('requestfailed', { url: () => REFRESH_URL, method: () => 'POST' });
    expect(events).toEqual([
      'admin_socket_browser_opened',
      'admin_socket_refresh_received',
      'admin_socket_closed',
      'refresh_http_succeeded',
      'refresh_http_rejected',
      'refresh_http_network_failed',
    ]);
    expect(unreadBody).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain('do-not-log-me');
  });
});
