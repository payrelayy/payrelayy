import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  KemerBetProvisionServerUnavailableError,
  createKemerBetSessionProvisionServer,
  isAllowedKemerBetSessionRequest,
} from './kemerbet-session-provision-server.js';

const LOGIN_PAGE = 'https://agentsystem.admindigi.com/login?et=1';
const AGENTS_PAGE = 'https://agentsystem.admindigi.com/agents';

describe('private KemerBet session provision server', () => {
  it('uses the hardened container boundary instead of an incompatible nested Chromium sandbox', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/chromiumSandbox: false/u);
    expect(source).not.toMatch(/chromiumSandbox: true/u);
  });

  it('always blocks the exact deposit endpoint and every post-login mutation', () => {
    expect(
      isAllowedKemerBetSessionRequest({
        isNavigationRequest: false,
        method: 'POST',
        pageUrl: LOGIN_PAGE,
        requestUrl: 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
      }),
    ).toBe(false);
    for (const requestUrl of [
      'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit?unexpected=1',
      'https://admin-api.agt-digi.com/another-mutation',
      'https://agentsystem.admindigi.com/logout',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          isNavigationRequest: false,
          method: 'POST',
          pageUrl: AGENTS_PAGE,
          requestUrl,
        }),
      ).toBe(false);
    }
  });

  it('allows login transport but only exact login or agents top-level navigation', () => {
    expect(
      isAllowedKemerBetSessionRequest({
        isNavigationRequest: false,
        method: 'POST',
        pageUrl: LOGIN_PAGE,
        requestUrl: 'https://admin-api.agt-digi.com/Auth/Login',
      }),
    ).toBe(true);
    for (const requestUrl of [
      'https://evil.example/login',
      'https://agentsystem.admindigi.com/',
      'https://agentsystem.admindigi.com/login?unexpected=1',
      'https://agentsystem.admindigi.com/agents?unexpected=1',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
          requestUrl,
        }),
      ).toBe(false);
    }
    expect(
      isAllowedKemerBetSessionRequest({
        isNavigationRequest: true,
        method: 'GET',
        pageUrl: LOGIN_PAGE,
        requestUrl: AGENTS_PAGE,
      }),
    ).toBe(true);
  });

  it('rejects every live, executor, final-action, pilot, or wrong-user environment at construction', () => {
    const safe = {
      NODE_ENV: 'production',
      FINANCIAL_ACTIONS_MODE: 'dry_run',
      KEMERBET_EXECUTOR_ENABLED: 'false',
      KEMERBET_FINAL_ACTION_ENABLED: 'false',
      KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
      INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
    };
    for (const candidate of [
      { environment: { ...safe, FINANCIAL_ACTIONS_MODE: 'live' }, effectiveUserId: 10_001 },
      { environment: { ...safe, KEMERBET_EXECUTOR_ENABLED: 'true' }, effectiveUserId: 10_001 },
      { environment: { ...safe, KEMERBET_FINAL_ACTION_ENABLED: 'true' }, effectiveUserId: 10_001 },
      {
        environment: { ...safe, KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true' },
        effectiveUserId: 10_001,
      },
      {
        environment: { ...safe, INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true' },
        effectiveUserId: 10_001,
      },
      { environment: safe, effectiveUserId: 0 },
    ]) {
      expect(() => createKemerBetSessionProvisionServer(candidate)).toThrow(
        KemerBetProvisionServerUnavailableError,
      );
    }
  });
});
