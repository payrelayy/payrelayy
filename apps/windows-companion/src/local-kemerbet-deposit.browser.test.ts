import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createLocalKemerBetDepositAuthorization,
  executeExactOneUseLocalKemerBetDeposit,
  executeRoutineOneUseLocalKemerBetDeposit,
  rehearseNoMoneyRoutineDepositPreflight,
  type LocalKemerBetRoutineFinalAction,
} from './local-kemerbet-deposit.js';
import { createLocalKemerBetLookupAuthorization } from './local-kemerbet-lookup.js';

const AGENTS_URL = 'https://agentsystem.admindigi.com/agents';
const API_ORIGIN = 'https://admin-api.agt-digi.com';
const DEPOSIT_URL = `${API_ORIGIN}/Wallet/PlayerEPOSDeposit`;
const LOOKUP_PATH = '/Player/GeneralInfoByExternalId';
const PLAYER_ID = 'ANY-ELIGIBLE-PLAYER';
const DIGEST = `sha256:${'a'.repeat(64)}`;

// Every request is fulfilled or aborted by the test. No route.fetch/fallback/continue, no
// existing browser profile, and no live provider/database/credentials are used by this fixture.
const fixtureHtml = `<!doctype html><meta charset="utf-8"><title>Deposit fixture</title>
<main id="surface"></main><script>
const surface = document.getElementById('surface');
function renderSearch() {
  surface.innerHTML = '<div class="ant-modal-content">' +
    '<span class="ant-select-selection-item">Player ID</span>' +
    '<div data-placeholder="Enter Player ID"><input></div><button id="find">Find</button></div>';
  document.getElementById('find').onclick = async () => {
    const externalId = surface.querySelector('input').value;
    const response = await fetch('${API_ORIGIN}${LOOKUP_PATH}?externalId=' + encodeURIComponent(externalId));
    const body = await response.json();
    surface.innerHTML = '<div class="ant-modal-content"><div class="rt--transfer-player-info">' +
      '<div class="rt--transfer-player-info-details">' +
      '<div class="rt--flex"><b>fixture-identity</b></div><div class="rt--flex"><b>ETB</b></div></div></div>' +
      '<div data-placeholder="Enter Amount"><input></div>' +
      '<div data-placeholder="Enter Notes"><textarea></textarea></div><button id="transfer">Transfer</button></div>';
    document.getElementById('transfer').onclick = async () => {
      const amount = surface.querySelector('[data-placeholder="Enter Amount"] input').value;
      await fetch('${DEPOSIT_URL}', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: body.value.id,
          amount: Number(amount),
          notes: surface.querySelector('textarea').value }) });
      surface.innerHTML = '<div class="ant-modal-content"><h2>Transfer Successful!</h2>' +
        '<p>Player Balance +' + Number(amount).toFixed(2) + ' ETB Success</p></div>';
    };
  };
}
renderSearch();
</script>`;

describe.skipIf(process.platform !== 'win32')(
  'routine deposit UI in isolated Windows Chrome',
  () => {
    let browser: Browser;
    let context: BrowserContext | undefined;

    beforeAll(async () => {
      browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 90_000 });
    }, 90_000);
    afterEach(async () => {
      await context?.close();
      context = undefined;
    });
    afterAll(async () => {
      await browser?.close();
    });

    async function startFixture() {
      const lookup = createLocalKemerBetLookupAuthorization();
      const deposit = createLocalKemerBetDepositAuthorization();
      const submitted: unknown[] = [];
      const blocked: string[] = [];
      context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.href === AGENTS_URL) {
          await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml });
          return;
        }
        if (
          request.method() === 'GET' &&
          url.origin === API_ORIGIN &&
          url.pathname === LOOKUP_PATH &&
          [...url.searchParams.keys()].length === 1 &&
          lookup.consume(url.searchParams.get('externalId') ?? '')
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              value: {
                id: 42,
                externalId: PLAYER_ID,
                currencyCode: 'ETB',
                userName: 'fixture-identity',
                email: null,
              },
            }),
          });
          return;
        }
        if (request.method() === 'OPTIONS' && url.href === DEPOSIT_URL) {
          await route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-methods': 'POST',
              'access-control-allow-headers': 'content-type',
            },
          });
          return;
        }
        if (url.href === DEPOSIT_URL) {
          const payload: unknown = request.postDataJSON();
          const allowed = deposit.consumeExactRequest(request.method(), url.href, payload);
          if (allowed && allowed.isFresh()) {
            submitted.push(payload);
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: '{"fixture":true}',
            });
            allowed.settle({ outcome: 'submission_attempted', providerResponseDigest: DIGEST });
            return;
          }
          blocked.push('deposit_blocked');
        }
        await route.abort('blockedbyclient');
      });
      await context.setOffline(false);
      const page = await context.newPage();
      await page.goto(AGENTS_URL, { waitUntil: 'domcontentloaded' });
      return { page, lookup, deposit, submitted, blocked };
    }

    async function amountText(page: Page) {
      return page.locator('[data-placeholder="Enter Amount"] input').inputValue();
    }

    it.each([
      [2500, '25.00'],
      [2501, '25.01'],
      [2500000, '25000.00'],
    ])(
      'prepares and submits the exact bound amount %s once',
      async (amount, text) => {
        const { page, lookup, deposit, submitted } = await startFixture();
        let fences = 0;
        const outcome = await executeRoutineOneUseLocalKemerBetDeposit(
          page,
          PLAYER_ID,
          amount as number,
          lookup,
          deposit,
          async () => {
            expect(await amountText(page)).toBe(text);
            expect(submitted).toEqual([]);
            fences += 1;
            return { playerId: PLAYER_ID, amountMinor: amount as number, isFresh: () => true };
          },
        );
        expect(outcome).toEqual({
          outcome: 'submission_attempted',
          providerResponseDigest: DIGEST,
          exactPlayerCreditMatch: true,
        });
        expect(submitted).toEqual([{ playerId: 42, amount: (amount as number) / 100, notes: '' }]);
        expect(fences).toBe(1);
      },
      15000,
    );

    it('rehearses the real preparation path without granting a transfer or submitting', async () => {
      const { page, lookup, deposit, submitted, blocked } = await startFixture();
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 2500, lookup, (stage) =>
        stages.push(stage),
      );
      expect(await amountText(page)).toBe('25.00');
      expect(stages).toEqual([
        'preflight_started',
        'search_surface_ready',
        'player_lookup_started',
        'player_lookup_verified',
        'amount_prepared',
        'no_money_rehearsal_completed',
      ]);
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
      expect(
        deposit.consumeExactRequest('POST', DEPOSIT_URL, {
          playerId: 42,
          amount: 25,
          notes: '',
        }),
      ).toBeUndefined();
    }, 15000);

    it('retains the existing pilot UI path at exactly 25 ETB', async () => {
      const { page, lookup, deposit, submitted } = await startFixture();
      const outcome = await executeExactOneUseLocalKemerBetDeposit(
        page,
        PLAYER_ID,
        lookup,
        deposit,
        async () => ({ isFresh: () => true }),
      );
      expect(outcome.outcome).toBe('submission_attempted');
      expect(submitted).toEqual([{ playerId: 42, amount: 25, notes: '' }]);
    }, 15000);

    it.each(['player', 'amount', 'stale', 'ui_tamper'])(
      'never submits if final authority or prepared UI is mismatched: %s',
      async (kind) => {
        const { page, lookup, deposit, submitted } = await startFixture();
        const acquire = async (): Promise<LocalKemerBetRoutineFinalAction> => {
          if (kind === 'ui_tamper')
            await page.locator('[data-placeholder="Enter Amount"] input').fill('25.00');
          return {
            playerId: kind === 'player' ? 'OTHER' : PLAYER_ID,
            amountMinor: kind === 'amount' ? 2500 : 2500000,
            isFresh: () => kind !== 'stale',
          };
        };
        await expect(
          executeRoutineOneUseLocalKemerBetDeposit(
            page,
            PLAYER_ID,
            2500000,
            lookup,
            deposit,
            acquire,
          ),
        ).rejects.toThrow();
        expect(submitted).toEqual([]);
      },
      15000,
    );
  },
);
