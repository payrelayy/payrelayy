import type { BrowserContext, Route } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import { createLocalKemerBetDepositAuthorization } from './local-kemerbet-deposit.js';
import { installProviderMutationBoundary } from './provider-route.js';

const DEPOSIT_URL = 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit';

function fixture(status = 200, overrideHeader = false) {
  let handler: ((route: Route) => Promise<void>) | undefined;
  const context = {
    route: vi.fn(async (_matcher, selectedHandler: (route: Route) => Promise<void>) => {
      handler = selectedHandler;
    }),
  } as unknown as BrowserContext;
  const response = {
    status: () => status,
    url: () => DEPOSIT_URL,
    headers: () => ({ 'content-type': 'application/json', 'x-fixture': 'safe' }),
    body: vi.fn(async () => Buffer.from('{"accepted":true}', 'utf8')),
    dispose: vi.fn(async () => undefined),
  };
  const request = {
    method: () => 'POST',
    url: () => DEPOSIT_URL,
    postDataJSON: () => ({ playerId: 42, amount: 25, notes: '' }),
    headerValue: vi.fn(async (name: string) =>
      overrideHeader && name === 'x-http-method-override' ? 'DELETE' : null,
    ),
    isNavigationRequest: () => false,
  };
  const route = {
    request: () => request,
    fetch: vi.fn(async () => response),
    fulfill: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  } as unknown as Route;
  return {
    context,
    response,
    route,
    async dispatch() {
      if (!handler) throw new Error('route not installed');
      await handler(route);
    },
  };
}

describe('local KemerBet exact-deposit route boundary', () => {
  it('atomically consumes one exact payload and forwards it once without redirects or retries', async () => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const selected = fixture();
    const blocked: string[] = [];
    await installProviderMutationBoundary(
      selected.context,
      () => 'signed_in_read_only',
      (reason) => blocked.push(reason),
      undefined,
      authorization,
    );
    const outcome = authorization.begin(42, () => true);
    await selected.dispatch();
    await expect(outcome).resolves.toEqual({
      outcome: 'submission_attempted',
      providerResponseDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(selected.route.fetch).toHaveBeenCalledTimes(1);
    expect(selected.route.fetch).toHaveBeenCalledWith({
      maxRedirects: 0,
      maxRetries: 0,
      timeout: 15_000,
    });
    expect(selected.route.fulfill).toHaveBeenCalledTimes(1);
    expect(blocked).toEqual([]);

    await selected.dispatch();
    expect(selected.route.fetch).toHaveBeenCalledTimes(1);
    expect(selected.route.abort).toHaveBeenCalledTimes(1);
    expect(blocked).toEqual(['mutation_attempt_blocked']);
  });

  it('does not follow a provider redirect after the one-use POST becomes uncertain', async () => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const selected = fixture(307);
    await installProviderMutationBoundary(
      selected.context,
      () => 'signed_in_read_only',
      () => undefined,
      undefined,
      authorization,
    );
    const outcome = authorization.begin(42, () => true);
    await selected.dispatch();
    await expect(outcome).resolves.toMatchObject({ outcome: 'local_uncertain' });
    expect(selected.route.fetch).toHaveBeenCalledTimes(1);
    expect(selected.route.fulfill).not.toHaveBeenCalled();
    expect(selected.route.abort).toHaveBeenCalledTimes(1);
  });

  it('burns malformed, stale, or override-bearing allowances without provider dispatch', async () => {
    const malformed = createLocalKemerBetDepositAuthorization();
    const firstOutcome = malformed.begin(42, () => true);
    expect(
      malformed.consumeExactRequest('POST', DEPOSIT_URL, {
        playerId: 42,
        amount: 25,
        notes: '',
        extra: true,
      }),
    ).toBeUndefined();
    await expect(firstOutcome).resolves.toEqual({
      outcome: 'local_uncertain',
      providerResponseDigest: null,
    });

    const stale = createLocalKemerBetDepositAuthorization();
    const staleOutcome = stale.begin(42, () => false);
    expect(
      stale.consumeExactRequest('POST', DEPOSIT_URL, { playerId: 42, amount: 25, notes: '' }),
    ).toBeUndefined();
    await expect(staleOutcome).resolves.toMatchObject({ outcome: 'local_uncertain' });

    const overridden = createLocalKemerBetDepositAuthorization();
    const selected = fixture(200, true);
    await installProviderMutationBoundary(
      selected.context,
      () => 'signed_in_read_only',
      () => undefined,
      undefined,
      overridden,
    );
    const overrideOutcome = overridden.begin(42, () => true);
    await selected.dispatch();
    await expect(overrideOutcome).resolves.toMatchObject({ outcome: 'local_uncertain' });
    expect(selected.route.fetch).not.toHaveBeenCalled();
  });
});
