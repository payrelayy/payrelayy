import { describe, expect, it } from 'vitest';

import { decideLocalKemerBetRequest, isLocalKemerBetProviderUrl } from './request-guard.js';
import { routineHistoryReadAuthorization } from './routine-kemerbet-history.js';

describe('local KemerBet request guard', () => {
  it('allows only the exact provider login mutation during manual sign-in', () => {
    expect(
      decideLocalKemerBetRequest(
        'POST',
        'https://admin-api.agt-digi.com/Account/Login',
        'manual_login',
      ),
    ).toEqual({ action: 'allow', reason: 'exact_login' });
    expect(
      decideLocalKemerBetRequest(
        'POST',
        'https://admin-api.agt-digi.com/Account/Login',
        'signed_in_read_only',
      ),
    ).toEqual({ action: 'abort', reason: 'provider_mutation' });
    expect(
      decideLocalKemerBetRequest(
        'POST',
        'https://admin-api.agt-digi.com/Account/Login?retry=1',
        'manual_login',
      ),
    ).toEqual({ action: 'abort', reason: 'provider_mutation' });
  });

  it('blocks Transfer and every other provider mutation in every phase', () => {
    for (const phase of ['manual_login', 'signed_in_read_only'] as const) {
      expect(
        decideLocalKemerBetRequest(
          'POST',
          'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
          phase,
        ),
      ).toEqual({ action: 'abort', reason: 'transfer_endpoint' });
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(
          decideLocalKemerBetRequest(
            method,
            'https://admin-api.agt-digi.com/Wallet/AnythingElse',
            phase,
          ).action,
        ).toBe('abort');
      }
    }
  });

  it('allows only the exact non-financial session refresh mutation', () => {
    for (const phase of ['manual_login', 'signed_in_read_only'] as const) {
      expect(
        decideLocalKemerBetRequest(
          'POST',
          'https://admin-api.agt-digi.com/Account/RefreshToken',
          phase,
        ),
      ).toEqual({ action: 'allow', reason: 'exact_refresh' });
      expect(
        decideLocalKemerBetRequest(
          'POST',
          'https://admin-api.agt-digi.com/Account/RefreshToken?unexpected=1',
          phase,
        ).action,
      ).toBe('abort');
    }
  });

  it('allows provider reads and unrelated reCAPTCHA traffic without inspecting secrets', () => {
    expect(
      decideLocalKemerBetRequest(
        'GET',
        'https://admin-api.agt-digi.com/Account/Info?languageCode=en',
        'signed_in_read_only',
      ),
    ).toEqual({ action: 'allow', reason: 'provider_read' });
    expect(
      decideLocalKemerBetRequest(
        'POST',
        'https://www.google.com/recaptcha/api2/reload?k=redacted',
        'manual_login',
      ),
    ).toEqual({ action: 'allow', reason: 'outside_provider' });
  });

  it('allows one exact assigned Player-ID GET only in the signed-in read-only phase', () => {
    const url = 'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=28379330';
    expect(decideLocalKemerBetRequest('GET', url, 'signed_in_read_only')).toEqual({
      action: 'abort',
      reason: 'unreviewed_read',
    });
    expect(decideLocalKemerBetRequest('GET', url, 'signed_in_read_only', '28379330')).toEqual({
      action: 'allow',
      reason: 'exact_lookup',
    });
    expect(decideLocalKemerBetRequest('OPTIONS', url, 'signed_in_read_only', '28379330')).toEqual({
      action: 'allow',
      reason: 'exact_lookup_preflight',
    });
    expect(decideLocalKemerBetRequest('GET', url, 'manual_login', '28379330')).toEqual({
      action: 'abort',
      reason: 'unreviewed_read',
    });
    expect(decideLocalKemerBetRequest('GET', url, 'signed_in_read_only', '28379331')).toEqual({
      action: 'abort',
      reason: 'unreviewed_read',
    });
  });

  it('opens only the bounded deposit-history read during an explicit reconciliation scan', () => {
    const historyAuthorization = routineHistoryReadAuthorization('28379330', {
      from: '2026-10-12T18:33:14.000000Z',
      until: '2026-10-12T18:33:14.999999Z',
    });
    const query = new URLSearchParams([
      ['page', '1'],
      ['limit', '10'],
      ['orderBy', 'CreatedAt'],
      ['orderDirection', '2'],
      ['userNameOrId', ''],
      ['transactionId', ''],
      ['walletTransactionId', ''],
      ['paymentType', ''],
      ['playerExternalId', ''],
      ['state', ''],
      ['from', '2026-10-01T00:00:00.000Z'],
      ['to', '2026-10-13T00:00:00.000Z'],
      ['createdAtFrom', ''],
      ['createdAtTo', ''],
    ]).toString();
    const url = `https://admin-api.agt-digi.com/Transaction/DepositHistory?${query}`;
    expect(decideLocalKemerBetRequest('GET', url, 'signed_in_read_only')).toEqual({
      action: 'abort',
      reason: 'unreviewed_read',
    });
    expect(
      decideLocalKemerBetRequest(
        'GET',
        url,
        'signed_in_read_only',
        undefined,
        historyAuthorization,
      ),
    ).toEqual({
      action: 'allow',
      reason: 'provider_read',
    });
    expect(
      decideLocalKemerBetRequest(
        'OPTIONS',
        url,
        'signed_in_read_only',
        undefined,
        historyAuthorization,
      ),
    ).toEqual({ action: 'allow', reason: 'provider_read' });
    // Captured from KemerBet's read-only History Apply action. It is not the same key order or
    // field set as the page's initial unfiltered request.
    const filteredQuery = new URLSearchParams([
      ['page', '1'],
      ['limit', '10'],
      ['orderBy', 'CreatedAt'],
      ['orderDirection', '2'],
      ['transactionId', ''],
      ['walletTransactionId', ''],
      ['playerExternalId', '28379330'],
      ['paymentType', ''],
      ['state', ''],
      ['from', '2026-10-12T18:32:00.000Z'],
      ['to', '2026-10-12T18:35:00.000Z'],
      ['userNameOrId', ''],
    ]).toString();
    const filteredUrl = `https://admin-api.agt-digi.com/Transaction/DepositHistory?${filteredQuery}`;
    expect(
      decideLocalKemerBetRequest(
        'GET',
        filteredUrl,
        'signed_in_read_only',
        undefined,
        historyAuthorization,
      ),
    ).toEqual({
      action: 'allow',
      reason: 'provider_read',
    });
    for (const permitted of [
      ['OPTIONS', filteredUrl],
      ['GET', filteredUrl.replace('page=1', 'page=2')],
    ] as const) {
      expect(
        decideLocalKemerBetRequest(
          permitted[0],
          permitted[1],
          'signed_in_read_only',
          undefined,
          historyAuthorization,
        ),
      ).toEqual({ action: 'allow', reason: 'provider_read' });
    }
    for (const unsafeUrl of [
      filteredUrl.replace('28379330', '28379331'),
      filteredUrl.replace('18%3A32', '18%3A31'),
      filteredUrl.replace('18%3A35', '18%3A36'),
      filteredUrl.replace('page=1', 'page=21'),
      `${filteredUrl}&amount=25`,
      `${filteredUrl}&createdAtFrom=`,
      filteredUrl.replace(
        'transactionId=&walletTransactionId=',
        'walletTransactionId=&transactionId=',
      ),
      filteredUrl.replace('userNameOrId=', 'userNameOrId=another-agent'),
      url
        .replace('playerExternalId=', 'playerExternalId=28379330')
        .replace('2026-10-01T00%3A00%3A00.000Z', '2026-10-12T18%3A32%3A00.000Z')
        .replace('2026-10-13T00%3A00%3A00.000Z', '2026-10-12T18%3A35%3A00.000Z'),
    ]) {
      expect(
        decideLocalKemerBetRequest(
          'GET',
          unsafeUrl,
          'signed_in_read_only',
          undefined,
          historyAuthorization,
        ).action,
      ).toBe('abort');
    }
    expect(
      decideLocalKemerBetRequest('GET', url, 'manual_login', undefined, historyAuthorization)
        .action,
    ).toBe('abort');
    expect(
      decideLocalKemerBetRequest(
        'POST',
        url,
        'signed_in_read_only',
        undefined,
        historyAuthorization,
      ).action,
    ).toBe('abort');
    expect(
      decideLocalKemerBetRequest(
        'GET',
        `${url}&amount=25`,
        'signed_in_read_only',
        undefined,
        historyAuthorization,
      ).action,
    ).toBe('abort');
    expect(
      decideLocalKemerBetRequest(
        'GET',
        url.replace('2026-10-01', '2026-13-01'),
        'signed_in_read_only',
        undefined,
        historyAuthorization,
      ).action,
    ).toBe('abort');
  });

  it('classifies alternate provider transports then rejects them rather than allowing outside traffic', () => {
    for (const origin of [
      'http://admin-api.agt-digi.com',
      'https://admin-api.agt-digi.com:8443',
      'https://admin-api.agt-digi.com.',
      'ws://agentsystem.admindigi.com',
      'wss://agentsystem.admindigi.com.:8443',
    ]) {
      const url = new URL(`${origin}/Account/Login`);
      expect(isLocalKemerBetProviderUrl(url)).toBe(true);
      expect(decideLocalKemerBetRequest('POST', url.href, 'manual_login')).toEqual({
        action: 'abort',
        reason: 'invalid_transport',
      });
    }
    expect(
      isLocalKemerBetProviderUrl(new URL('https://admin-api.agt-digi.com.attacker.example/')),
    ).toBe(false);
  });

  it('blocks financial namespaces and ambiguous or encoded API paths before allowing reads', () => {
    for (const origin of ['https://admin-api.agt-digi.com', 'https://agentsystem.admindigi.com']) {
      for (const path of [
        '/wallet/playereposdeposit',
        '/Wallet/PlayerEPOSDeposit/',
        '/Wallet/Withdraw',
        '/%57allet/PlayerEPOSDeposit',
        '/Wallet%2fPlayerEPOSDeposit',
        '/%2557allet/PlayerEPOSDeposit',
        '//Wallet/PlayerEPOSDeposit',
        '/Wallet;alias/PlayerEPOSDeposit',
      ]) {
        for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST']) {
          expect(
            decideLocalKemerBetRequest(method, `${origin}${path}`, 'manual_login').action,
          ).toBe('abort');
        }
      }
    }
  });

  it('permits only reviewed API reads with bounded query shapes and session preflights', () => {
    for (const path of [
      '/Account/Info',
      '/Account/Info?languageCode=en-US',
      '/Account/Currencies',
      '/SystemLanguage/SystemAvailablePublished',
      '/SystemLanguage/AvailablePublished',
    ]) {
      expect(
        decideLocalKemerBetRequest('GET', `https://admin-api.agt-digi.com${path}`, 'manual_login')
          .action,
      ).toBe('allow');
    }
    for (const path of [
      '/Unknown/Read',
      '/Account/Info?languageCode=en&languageCode=am',
      '/Account/Info?unexpected=1',
      '/Account/Currencies?languageCode=en',
      '/Account/Login',
      '/Account/Info#x',
    ]) {
      expect(
        decideLocalKemerBetRequest('GET', `https://admin-api.agt-digi.com${path}`, 'manual_login')
          .action,
      ).toBe('abort');
    }
    expect(
      decideLocalKemerBetRequest(
        'OPTIONS',
        'https://admin-api.agt-digi.com/Account/Login',
        'manual_login',
      ).action,
    ).toBe('allow');
    expect(
      decideLocalKemerBetRequest(
        'GET',
        'https://agentsystem.admindigi.com/assets/app.js?v=1',
        'manual_login',
      ).action,
    ).toBe('allow');
  });

  it('rejects financial and method override query keys including encoded and case variants', () => {
    for (const query of [
      'action=transfer',
      '_METHOD=POST',
      '%61mount=25',
      '%2561mount=25',
      'operation=withdraw',
      'command=credit',
    ]) {
      expect(
        decideLocalKemerBetRequest(
          'GET',
          `https://agentsystem.admindigi.com/agents?${query}`,
          'manual_login',
        ),
      ).toEqual({ action: 'abort', reason: 'unsafe_query' });
    }
  });
});
