import { EventEmitter } from 'node:events';

import type { BrowserContext, Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import {
  classifyRefreshErrorBody,
  classifyProviderSessionServerFrame,
  installProviderSessionPassiveDiagnostics,
  type ProviderSessionDiagnosticEvent,
} from './provider-session-diagnostic.js';

const SOCKET_URL = 'wss://admin-api.agt-digi.com/ws?accessToken=do-not-log-me&apiType=admin';
const REFRESH_URL = 'https://admin-api.agt-digi.com/Account/RefreshToken';
const SEPARATOR = '\u001e';

describe('passive provider session diagnostics', () => {
  it('reduces bounded refresh errors to fixed categories without exposing provider text', () => {
    expect(
      classifyRefreshErrorBody(
        Buffer.from('{"errorCode":"REFRESH_TOKEN_EXPIRED","accessToken":"private-token"}'),
      ),
    ).toBe('refresh_error_expired');
    expect(classifyRefreshErrorBody(Buffer.from('{"error":{"code":"invalid_grant"}}'))).toBe(
      'refresh_error_invalid_grant',
    );
    expect(
      classifyRefreshErrorBody(Buffer.from('{"code":400,"message":"Invalid refresh token."}')),
    ).toBe('refresh_error_invalid_token');
    expect(
      classifyRefreshErrorBody(Buffer.from('{"errorCode":"account-123456","message":"private"}')),
    ).toBe('refresh_error_code_unrecognized');
    expect(classifyRefreshErrorBody(Buffer.from('{"detail":"private"}'))).toBe(
      'refresh_error_code_missing',
    );
    expect(classifyRefreshErrorBody(Buffer.from('not json'))).toBe(
      'refresh_error_body_unavailable',
    );
    expect(classifyRefreshErrorBody(Buffer.alloc(4_097))).toBe('refresh_error_body_unavailable');
  });

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

  it('observes only exact session transport and refresh outcomes without touching unrelated bodies', async () => {
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
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 400,
      headers: () => ({ 'content-type': 'text/html' }),
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 409,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 422,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 503,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 429,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 302,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => REFRESH_URL,
      request: () => ({ method: () => 'POST' }),
      status: () => 404,
      body: unreadBody,
    });
    context.emit('requestfailed', { url: () => REFRESH_URL, method: () => 'POST' });
    context.emit('response', {
      url: () => 'https://admin-api.agt-digi.com/Account/Info?languageCode=en',
      request: () => ({ method: () => 'GET' }),
      status: () => 401,
      body: unreadBody,
    });
    context.emit('response', {
      url: () => 'https://admin-api.agt-digi.com/Account/Info',
      request: () => ({ method: () => 'GET' }),
      status: () => 503,
      body: unreadBody,
    });
    context.emit('requestfailed', {
      url: () => 'https://admin-api.agt-digi.com/Account/Info',
      method: () => 'GET',
    });
    await vi.waitFor(() => expect(events).toContain('refresh_error_body_unavailable'));
    expect(events).toEqual([
      'admin_socket_browser_opened',
      'admin_socket_refresh_received',
      'admin_socket_closed',
      'refresh_http_succeeded',
      'refresh_http_auth_rejected',
      'refresh_http_bad_request',
      'refresh_error_body_unavailable',
      'refresh_http_conflict',
      'refresh_http_unprocessable',
      'refresh_http_server_error',
      'refresh_http_rate_limited',
      'refresh_http_redirected',
      'refresh_http_rejected',
      'refresh_http_network_failed',
      'account_info_auth_rejected',
      'account_info_server_error',
      'account_info_network_failed',
    ]);
    expect(unreadBody).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain('do-not-log-me');
  });

  it('reads only the exact HTTP 400 refresh error and ignores oversized responses', async () => {
    const context = new EventEmitter();
    const events: ProviderSessionDiagnosticEvent[] = [];
    const body = vi.fn(async () =>
      Buffer.from('{"errorCode":"session_revoked","token":"never-record-this"}'),
    );
    installProviderSessionPassiveDiagnostics(
      context as unknown as BrowserContext,
      new EventEmitter() as unknown as Page,
      (event) => events.push(event),
    );
    const response = (status: number, url = REFRESH_URL, length?: string) => ({
      url: () => url,
      request: () => ({ method: () => 'POST' }),
      status: () => status,
      headers: () => ({
        'content-type': 'application/json; charset=utf-8',
        'content-length': length,
      }),
      body,
    });
    context.emit('response', response(200));
    context.emit('response', response(400, `${REFRESH_URL}?unexpected=1`));
    context.emit('response', response(400, REFRESH_URL, '4097'));
    context.emit('response', response(400, REFRESH_URL, '63'));
    await vi.waitFor(() => expect(events).toContain('refresh_error_revoked'));
    expect(body).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'refresh_http_succeeded',
      'refresh_http_bad_request',
      'refresh_error_body_unavailable',
      'refresh_http_bad_request',
      'refresh_error_revoked',
    ]);
    expect(JSON.stringify(events)).not.toContain('never-record-this');
  });
});
