import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createLocalKemerBetDepositAuthorization,
  exactKemerBetAmountInputMatches,
  exactKemerBetSuccessTableMatches,
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
          // Mirror KemerBet's request interceptor: empty string fields become null.
          notes: surface.querySelector('textarea').value || null }) });
      surface.innerHTML = '<div class="ant-modal-content"><h2>Transfer Successful!</h2>' +
        '<p>Player Balance +' + Number(amount).toFixed(2) + ' ETB Success</p></div>';
    };
  };
}
renderSearch();
</script>`;

const delayedNavigationHtml = fixtureHtml
  .replace(
    '<main id="surface"></main>',
    '<div role="menuitem">Deposit</div><main id="surface"></main>',
  )
  .replace(
    'renderSearch();\n</script>',
    `surface.innerHTML = '<div class="rt--header-right"><button class="rt--header-actions-content-icon">' +
    '<span class="icon-transfer"></span></button></div>';
  surface.querySelector('button').onclick = () => {
    setTimeout(() => {
      surface.insertAdjacentHTML('beforeend',
        '<div class="ant-dropdown rt--transfer-dropdown"><ul role="menu">' +
        '<li role="menuitem" aria-label="Open player deposit"><span hidden>Internal action</span><span>Deposit</span></li>' +
        '<li role="menuitem">Withdraw</li></ul></div>');
      surface.querySelector('.rt--transfer-dropdown li[role="menuitem"]').onclick = () => {
        setTimeout(() => {
          surface.innerHTML = '<button class="rt--transfer-item"><span class="icon-player"></span></button>';
          surface.querySelector('button').onclick = renderSearch;
        }, 150);
      };
    }, 150);
  };
</script>`,
  );

const toggleNavigationHtml = delayedNavigationHtml.replace(
  "  surface.querySelector('button').onclick = () => {\n    setTimeout(() => {",
  "  surface.querySelector('button').onclick = () => {\n    const existingMenu = surface.querySelector('.rt--transfer-dropdown');\n    if (existingMenu) { existingMenu.remove(); return; }\n    setTimeout(() => {",
);

const missedFirstMenuHtml = delayedNavigationHtml.replace(
  "  surface.querySelector('button').onclick = () => {\n    setTimeout(() => {",
  "  let ignoredFirstClick = false;\n  surface.querySelector('button').onclick = () => {\n    if (!ignoredFirstClick) { ignoredFirstClick = true; return; }\n    setTimeout(() => {",
);

const delayedPreparedHtml = fixtureHtml.replace(
  `    surface.innerHTML = '<div class="ant-modal-content"><div class="rt--transfer-player-info">' +`,
  `    await new Promise((resolve) => setTimeout(resolve, 250));
    surface.innerHTML = '<div class="ant-modal-content"><div class="rt--transfer-player-info">' +`,
);

const directionMarkedAmountHtml = fixtureHtml.replace(
  `    document.getElementById('transfer').onclick = async () => {`,
  `    surface.querySelector('[data-placeholder="Enter Amount"] input').addEventListener('input', (event) => {
      event.currentTarget.value = String.fromCharCode(0x200e) + event.currentTarget.value;
    });
    document.getElementById('transfer').onclick = async () => {`,
);

const groupedAmountHtml = fixtureHtml
  .replace(
    `    document.getElementById('transfer').onclick = async () => {`,
    `    surface.querySelector('[data-placeholder="Enter Amount"] input').addEventListener('input', (event) => {
      const input = event.currentTarget;
      const [whole, fraction] = input.value.replaceAll(',', '').split('.');
      input.value = whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') +
        (fraction === undefined ? '' : '.' + fraction);
    });
    document.getElementById('transfer').onclick = async () => {`,
  )
  .replaceAll('Number(amount)', "Number(amount.replaceAll(',', ''))")
  .replace(
    '.toFixed(2)',
    ".toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })",
  );

const spaceGroupedAmountHtml = fixtureHtml
  .replace(
    `    document.getElementById('transfer').onclick = async () => {`,
    `    surface.querySelector('[data-placeholder="Enter Amount"] input').addEventListener('input', (event) => {
      const input = event.currentTarget;
      const [whole, fraction] = input.value.replaceAll(' ', '').split('.');
      input.value = whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ') +
        (fraction === undefined ? '' : '.' + fraction);
    });
    document.getElementById('transfer').onclick = async () => {`,
  )
  .replaceAll('Number(amount)', "Number(amount.replaceAll(' ', ''))");

const successTableHtml = fixtureHtml.replace(
  `'<p>Player Balance +' + Number(amount).toFixed(2) + ' ETB Success</p></div>';`,
  `'<table><thead><tr><th>Name</th><th>Wallet Type</th><th>Amount</th><th>Message</th></tr></thead>' +
        '<tbody><tr><td>fixture-identity</td><td>Balance</td><td>' + Number(amount) + '</td><td>Success</td></tr>' +
        '<tr><td>fixture-agent</td><td>Balance</td><td>-' + Number(amount) + '</td><td>Success</td></tr>' +
        '<tr><td>PLAT</td><td>Balance</td><td>' + Number(amount) + '</td><td>Success</td></tr></tbody></table>' +
        '<button>Close</button></div>';`,
);

const successTableText = [
  'Transfer Successful!',
  'Name\tWallet Type\tAmount\tMessage',
  'fixture-identity\tBalance\t100\tSuccess',
  'fixture-agent\tBalance\t-100\tSuccess',
  'PLAT\tBalance\t100\tSuccess',
  'Close',
].join('\n');

describe('strict KemerBet success table', () => {
  it('matches the selected recipient and all three exact success rows', () => {
    expect(exactKemerBetSuccessTableMatches(successTableText, ['fixture-identity'], 10000)).toBe(
      true,
    );
    expect(
      exactKemerBetSuccessTableMatches(
        successTableText.replaceAll('\t100\t', '\t100.00\t').replace('\t-100\t', '\t-100.00\t'),
        ['fixture-identity'],
        10000,
      ),
    ).toBe(true);
  });

  it.each([
    ['wrong recipient', successTableText.replace('fixture-identity', 'someone-else')],
    ['wrong credit amount', successTableText.replace('\t100\tSuccess', '\t101\tSuccess')],
    ['wrong agent debit', successTableText.replace('\t-100\tSuccess', '\t-99\tSuccess')],
    ['failed credit', successTableText.replace('\t100\tSuccess', '\t100\tFailed')],
    [
      'duplicate row',
      successTableText.replace('\nClose', '\nfixture-identity\tBalance\t100\tSuccess\nClose'),
    ],
    ['missing title', successTableText.replace('Transfer Successful!', 'Transfer Pending')],
    ['missing close', successTableText.replace('\nClose', '')],
  ])('rejects %s', (_caseName, text) => {
    expect(exactKemerBetSuccessTableMatches(text, ['fixture-identity'], 10000)).toBe(false);
  });

  it('accepts only exact canonical grouped renderings of the leased amount', () => {
    expect(exactKemerBetAmountInputMatches('1,102.00', 110200)).toBe(true);
    expect(exactKemerBetAmountInputMatches('\u200e1,102', 110200)).toBe(true);
    for (const separator of [' ', '\u00a0', '\u202f']) {
      expect(exactKemerBetAmountInputMatches(`3${separator}000.00`, 300000)).toBe(true);
      expect(exactKemerBetAmountInputMatches(`3${separator}000`, 300000)).toBe(true);
      expect(exactKemerBetAmountInputMatches(`3${separator}000.01`, 300000)).toBe(false);
      expect(exactKemerBetAmountInputMatches(`30${separator}00.00`, 300000)).toBe(false);
    }
    expect(exactKemerBetAmountInputMatches('3\t000.00', 300000)).toBe(false);
    expect(exactKemerBetAmountInputMatches('3  000.00', 300000)).toBe(false);
    expect(exactKemerBetAmountInputMatches('1,102.01', 110200)).toBe(false);
    expect(exactKemerBetAmountInputMatches('11,02.00', 110200)).toBe(false);
    expect(exactKemerBetAmountInputMatches('1,102.00\u200e', 110200)).toBe(false);
    const groupedTable = successTableText
      .replaceAll('\t100\t', '\t1,102.00\t')
      .replace('\t-100\t', '\t-1,102.00\t');
    expect(exactKemerBetSuccessTableMatches(groupedTable, ['fixture-identity'], 110200)).toBe(true);
    expect(
      exactKemerBetSuccessTableMatches(
        groupedTable.replace('\t1,102.00\tSuccess', '\t1,102.01\tSuccess'),
        ['fixture-identity'],
        110200,
      ),
    ).toBe(false);
    const spaceGroupedTable = successTableText
      .replaceAll('\t100\t', '\t3 000.00\t')
      .replace('\t-100\t', '\t-3 000.00\t');
    expect(exactKemerBetSuccessTableMatches(spaceGroupedTable, ['fixture-identity'], 300000)).toBe(
      true,
    );
  });
});

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

    async function startFixture(html = fixtureHtml) {
      const lookup = createLocalKemerBetLookupAuthorization();
      const deposit = createLocalKemerBetDepositAuthorization();
      const submitted: unknown[] = [];
      const blocked: string[] = [];
      context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.href === AGENTS_URL) {
          await route.fulfill({ status: 200, contentType: 'text/html', body: html });
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
      [10000, '100.00'],
      [10001, '100.01'],
      [2500000, '25000.00'],
    ])(
      'prepares and submits the exact bound amount %s once',
      async (amount, text) => {
        const { page, lookup, deposit, submitted } = await startFixture();
        const stages: string[] = [];
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
          (stage) => stages.push(stage),
        );
        expect(outcome).toEqual({
          outcome: 'submission_attempted',
          providerResponseDigest: DIGEST,
          exactPlayerCreditMatch: true,
        });
        expect(submitted).toEqual([
          { playerId: 42, amount: (amount as number) / 100, notes: null },
        ]);
        expect(fences).toBe(1);
        expect(stages).toContain('post_fence_surface_verified');
        expect(stages).toContain('transfer_click_requested');
        expect(stages).toContain('provider_route_submission_attempted');
        expect(stages.at(-1)).toBe('success_modal_confirmed');
      },
      15000,
    );

    it('confirms the newer three-row success table without a second transfer', async () => {
      const { page, lookup, deposit, submitted } = await startFixture(successTableHtml);
      const stages: string[] = [];
      const outcome = await executeRoutineOneUseLocalKemerBetDeposit(
        page,
        PLAYER_ID,
        10000,
        lookup,
        deposit,
        async () => ({ playerId: PLAYER_ID, amountMinor: 10000, isFresh: () => true }),
        (stage) => stages.push(stage),
      );
      expect(await page.locator('.ant-modal-content table').count()).toBe(1);
      expect(await page.getByText('Player Balance +100.00 ETB Success').count()).toBe(0);
      expect(outcome).toEqual({
        outcome: 'submission_attempted',
        providerResponseDigest: DIGEST,
        exactPlayerCreditMatch: true,
      });
      expect(submitted).toEqual([{ playerId: 42, amount: 100, notes: null }]);
      expect(stages.at(-1)).toBe('success_modal_confirmed');
    }, 15000);

    it('reports a post-fence UI mismatch without clicking Transfer or exposing identifiers', async () => {
      const { page, lookup, deposit, submitted } = await startFixture();
      const stages: string[] = [];
      await expect(
        executeRoutineOneUseLocalKemerBetDeposit(
          page,
          PLAYER_ID,
          10000,
          lookup,
          deposit,
          async () => {
            await page.locator('[data-placeholder="Enter Amount"] input').fill('1.00');
            return { playerId: PLAYER_ID, amountMinor: 10000, isFresh: () => true };
          },
          (stage) => stages.push(stage),
        ),
      ).rejects.toThrow();
      expect(stages).toContain('final_action_fenced');
      expect(stages).toContain('prepared_amount_mismatch');
      expect(stages).not.toContain('transfer_click_requested');
      expect(submitted).toEqual([]);
      expect(JSON.stringify(stages)).not.toContain(PLAYER_ID);
    });

    it('rehearses the real preparation path without granting a transfer or submitting', async () => {
      const { page, lookup, deposit, submitted, blocked } = await startFixture();
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 10000, lookup, (stage) =>
        stages.push(stage),
      );
      expect(await amountText(page)).toBe('100.00');
      expect(stages).toEqual([
        'preflight_started',
        'search_surface_ready',
        'player_lookup_started',
        'player_lookup_verified',
        'amount_fields_filled',
        'prepared_surface_verified',
        'amount_prepared',
        'no_money_rehearsal_completed',
      ]);
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
      expect(
        deposit.consumeExactRequest('POST', DEPOSIT_URL, {
          playerId: 42,
          amount: 100,
          notes: '',
        }),
      ).toBeUndefined();
    }, 15000);

    it('uses the delayed Ant Financial Actions menu despite an unrelated Deposit item', async () => {
      const { page, lookup, submitted, blocked } = await startFixture(delayedNavigationHtml);
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 10000, lookup, (stage) =>
        stages.push(stage),
      );
      expect(stages).toEqual([
        'preflight_started',
        'financial_actions_opened',
        'deposit_menu_ready',
        'deposit_menu_selected',
        'player_tile_selected',
        'search_surface_ready',
        'player_lookup_started',
        'player_lookup_verified',
        'amount_fields_filled',
        'prepared_surface_verified',
        'amount_prepared',
        'no_money_rehearsal_completed',
      ]);
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
    }, 15000);

    it('uses an already-open Financial Actions menu without toggling it closed', async () => {
      const { page, lookup, submitted, blocked } = await startFixture(toggleNavigationHtml);
      await page.locator('.rt--header-actions-content-icon').click();
      await page.locator('.rt--transfer-dropdown').waitFor({ state: 'visible' });
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 10000, lookup, (stage) =>
        stages.push(stage),
      );
      expect(stages).toContain('deposit_menu_selected');
      expect(stages.at(-1)).toBe('no_money_rehearsal_completed');
      expect(stages).not.toContain('financial_actions_opened');
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
    }, 15000);

    it('reopens the Financial Actions menu when a first click is lost', async () => {
      const { page, lookup, submitted, blocked } = await startFixture(missedFirstMenuHtml);
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 10000, lookup, (stage) =>
        stages.push(stage),
      );
      expect(stages.filter((stage) => stage === 'financial_actions_opened')).toHaveLength(2);
      expect(stages.at(-1)).toBe('no_money_rehearsal_completed');
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
    }, 15000);

    it('prepares and confirms a grouped amount without changing the leased amount', async () => {
      const { page, lookup, deposit, submitted, blocked } = await startFixture(groupedAmountHtml);
      const stages: string[] = [];
      const outcome = await executeRoutineOneUseLocalKemerBetDeposit(
        page,
        PLAYER_ID,
        110200,
        lookup,
        deposit,
        async () => {
          expect(await amountText(page)).toBe('1,102.00');
          return { playerId: PLAYER_ID, amountMinor: 110200, isFresh: () => true };
        },
        (stage) => stages.push(stage),
      );
      expect(outcome.outcome).toBe('submission_attempted');
      expect(submitted).toEqual([{ playerId: 42, amount: 1102, notes: null }]);
      expect(blocked).toEqual([]);
      expect(stages.at(-1)).toBe('success_modal_confirmed');
    }, 15000);

    it('prepares and confirms a space-grouped 3,000 ETB amount once', async () => {
      const { page, lookup, deposit, submitted, blocked } =
        await startFixture(spaceGroupedAmountHtml);
      const stages: string[] = [];
      let fences = 0;
      const outcome = await executeRoutineOneUseLocalKemerBetDeposit(
        page,
        PLAYER_ID,
        300000,
        lookup,
        deposit,
        async () => {
          expect(await amountText(page)).toBe('3 000.00');
          expect(submitted).toEqual([]);
          fences += 1;
          return { playerId: PLAYER_ID, amountMinor: 300000, isFresh: () => true };
        },
        (stage) => stages.push(stage),
      );
      expect(outcome.outcome).toBe('submission_attempted');
      expect(submitted).toEqual([{ playerId: 42, amount: 3000, notes: null }]);
      expect(blocked).toEqual([]);
      expect(fences).toBe(1);
      expect(stages.at(-1)).toBe('success_modal_confirmed');
    }, 15000);

    it('waits for the exact prepared form after the verified read-only response', async () => {
      const { page, lookup, submitted, blocked } = await startFixture(delayedPreparedHtml);
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 10000, lookup, (stage) =>
        stages.push(stage),
      );
      expect(stages).toContain('prepared_surface_verified');
      expect(stages.at(-1)).toBe('no_money_rehearsal_completed');
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
    }, 15000);

    it('accepts the observed single direction mark on the exact amount without submitting', async () => {
      const { page, lookup, submitted, blocked } = await startFixture(directionMarkedAmountHtml);
      const stages: string[] = [];
      await rehearseNoMoneyRoutineDepositPreflight(page, PLAYER_ID, 10000, lookup, (stage) =>
        stages.push(stage),
      );
      expect(await amountText(page)).toBe('\u200e100.00');
      expect(stages.at(-1)).toBe('no_money_rehearsal_completed');
      expect(submitted).toEqual([]);
      expect(blocked).toEqual([]);
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
      expect(submitted).toEqual([{ playerId: 42, amount: 25, notes: null }]);
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
