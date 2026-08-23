import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KemerBetProvisionServerUnavailableError,
  createKemerBetSessionProvisionServer,
  isAllowedKemerBetSessionRequest,
  removeStaleChromiumSingletonArtifacts,
} from './kemerbet-session-provision-server.js';

const LOGIN_PAGE = 'https://agentsystem.admindigi.com/login?et=1';
const AGENTS_PAGE = 'https://agentsystem.admindigi.com/agents';

describe('private KemerBet session provision server', () => {
  it('removes only the three exact stale Chromium profile-owner symlinks', async () => {
    const profilePath = resolve('validated-kemerbet-profile');
    const existing = new Set([
      resolve(profilePath, 'SingletonCookie'),
      resolve(profilePath, 'SingletonLock'),
      resolve(profilePath, 'SingletonSocket'),
    ]);
    const removed: string[] = [];
    const fileSystem = {
      lstat: async (path: string) => {
        if (!existing.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { isSymbolicLink: () => true };
      },
      unlink: async (path: string) => {
        removed.push(path);
        existing.delete(path);
      },
    };

    await removeStaleChromiumSingletonArtifacts(profilePath, fileSystem);
    await removeStaleChromiumSingletonArtifacts(profilePath, fileSystem);

    expect(removed.map((path) => basename(path))).toEqual([
      'SingletonCookie',
      'SingletonLock',
      'SingletonSocket',
    ]);
  });

  it('fails closed instead of deleting a non-symlink singleton entry', async () => {
    const removed: string[] = [];
    await expect(
      removeStaleChromiumSingletonArtifacts(resolve('validated-kemerbet-profile'), {
        lstat: async () => ({ isSymbolicLink: () => false }),
        unlink: async (path: string) => {
          removed.push(path);
        },
      }),
    ).rejects.toBeInstanceOf(KemerBetProvisionServerUnavailableError);
    expect(removed).toEqual([]);
  });

  it('uses the hardened container boundary instead of an incompatible nested Chromium sandbox', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/chromiumSandbox: false/u);
    expect(source).not.toMatch(/chromiumSandbox: true/u);
  });

  it('replaces the credential-entry deadline with bounded authenticated retention after sign-in', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/const LOGIN_LIFETIME_MS = 10 \* 60 \* 1_000/u);
    expect(source).toMatch(/const AUTHENTICATED_SESSION_LIFETIME_MS = 12 \* 60 \* 60 \* 1_000/u);
    expect(source).toMatch(/armExpiry\(LOGIN_LIFETIME_MS\)/u);
    expect(source).toMatch(
      /if \(signedIn && !signedInLogged\) \{[\s\S]*?armExpiry\(AUTHENTICATED_SESSION_LIFETIME_MS\)/u,
    );
    expect(source).not.toMatch(/const SESSION_LIFETIME_MS/u);
  });

  it('exposes only an aggregate one-time readiness seal on the current signed-in page', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/request\.url === '\/v1\/readiness\/seal'/u);
    expect(source).toMatch(/validPageUrl\(retainedPage\.url\(\)\) !== 'agents'/u);
    expect(source).toMatch(/FINANCIAL_ACTIONS_MODE: 'dry_run'/u);
    expect(source).toMatch(/KEMERBET_EXECUTOR_ENABLED: 'false'/u);
    expect(source).toMatch(/KEMERBET_FINAL_ACTION_ENABLED: 'false'/u);
    expect(source).toMatch(/playersChecked: 5/u);
    expect(source).toMatch(/transferDisabled: true/u);
    expect(source).toMatch(/moneyMoved: false/u);
    expect(source).toMatch(/identifiersRedacted: true/u);
    expect(source).toMatch(/error: 'session_unavailable', stage: failureStage/u);
    expect(source).toMatch(/readinessStage = stage/u);
  });

  it('always blocks the exact deposit endpoint and every post-login mutation', () => {
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
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
          isMainFrame: true,
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
        isMainFrame: true,
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
          isMainFrame: true,
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
          requestUrl,
        }),
      ).toBe(false);
    }
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: true,
        method: 'GET',
        pageUrl: LOGIN_PAGE,
        requestUrl: AGENTS_PAGE,
      }),
    ).toBe(true);
  });

  it('allows only exact reCAPTCHA subframe navigation while keeping top-level redirects blocked', () => {
    for (const requestUrl of [
      'https://www.google.com/recaptcha/api2/anchor?site-key=redacted',
      'https://www.google.com/recaptcha/api2/bframe?site-key=redacted',
      'https://www.recaptcha.net/recaptcha/api2/anchor?site-key=redacted',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          isMainFrame: false,
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
          requestUrl,
        }),
      ).toBe(true);
    }
    for (const candidate of [
      { isMainFrame: true, requestUrl: 'https://www.google.com/recaptcha/api2/anchor' },
      { isMainFrame: false, requestUrl: 'https://www.google.com/search?q=login' },
      { isMainFrame: false, requestUrl: 'https://evil.example/recaptcha/api2/anchor' },
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          ...candidate,
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
        }),
      ).toBe(false);
    }
  });

  it('rejects every live, executor, final-action, pilot, or wrong-user environment at construction', () => {
    const safe = {
      NODE_ENV: 'production',
      FINANCIAL_ACTIONS_MODE: 'dry_run',
      KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true',
      KEMERBET_EXECUTOR_ENABLED: 'false',
      KEMERBET_FINAL_ACTION_ENABLED: 'false',
      KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
      INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
    };
    for (const candidate of [
      { environment: { ...safe, FINANCIAL_ACTIONS_MODE: 'live' }, effectiveUserId: 10_001 },
      {
        environment: { ...safe, KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'false' },
        effectiveUserId: 10_001,
      },
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
