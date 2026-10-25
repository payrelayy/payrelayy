import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ExactFivePlayerIds } from '@fetanagent/agent-platform-companion-contracts';

import {
  createLocalKemerBetLookupAuthorization,
  executeExactFiveLocalKemerBetLookup,
  executeSingleLocalKemerBetLookup,
} from './local-kemerbet-lookup.js';

const AGENTS_URL = 'https://agentsystem.admindigi.com/agents';
const API_ORIGIN = 'https://admin-api.agt-digi.com';
const LOOKUP_PATH = '/Player/GeneralInfoByExternalId';
const PLAYER_IDS = Object.freeze([
  'PLAYER-ALPHA',
  'PLAYER-BRAVO',
  'PLAYER-CHARLIE',
  'PLAYER-DELTA',
  'PLAYER-ECHO',
]) as ExactFivePlayerIds;

const delayedDepositFixture = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Delayed KemerBet fixture</title></head>
  <body>
    <div role="menuitem">Deposit</div>
    <div class="rt--header-right" id="header-right"></div>
    <main id="surface"></main>
    <script>
      const surface = document.getElementById('surface');
      const renderSearch = () => {
        surface.innerHTML = \`
          <div class="ant-modal-content">
            <span class="ant-select-selection-item">Player ID</span>
            <div data-placeholder="Enter Player ID"><input></div>
            <button id="find">Find</button>
          </div>
        \`;
        document.getElementById('find').addEventListener('click', async () => {
          const input = surface.querySelector('[data-placeholder="Enter Player ID"] input');
          const response = await fetch(
            '${API_ORIGIN}${LOOKUP_PATH}?externalId=' + encodeURIComponent(input.value),
          );
          await response.json();
          surface.innerHTML = \`
            <div class="ant-modal-content">
              <div class="rt--transfer-player-info">
                <div class="rt--transfer-player-info-details">
                  <div class="rt--flex"><b>fixture-identity</b></div>
                  <div class="rt--flex"><b>ETB</b></div>
                </div>
              </div>
              <div data-placeholder="Enter Amount"><input></div>
              <div data-placeholder="Enter Notes"><textarea></textarea></div>
              <button>Transfer</button>
            </div>
          \`;
        });
      };
      const openDepositMenu = () => {
        const existingMenu = surface.querySelector('.rt--transfer-dropdown');
        if (existingMenu) { existingMenu.remove(); return; }
        const dropdown = document.createElement('div');
        dropdown.className = 'rt--transfer-dropdown';
        const deposit = document.createElement('button');
        deposit.setAttribute('role', 'menuitem');
        deposit.setAttribute('aria-label', 'Open player deposit');
        deposit.innerHTML = '<span hidden>Internal action</span><span>Deposit</span>';
        deposit.addEventListener('click', () => {
          deposit.remove();
          window.setTimeout(() => {
            const tile = document.createElement('div');
            tile.className = 'rt--transfer-item';
            tile.innerHTML = '<i class="icon-player"></i><b>To Player</b>';
            tile.addEventListener('click', renderSearch);
            surface.replaceChildren(tile);
          }, 250);
        });
        dropdown.append(deposit);
        surface.replaceChildren(dropdown);
      };
      window.setTimeout(() => {
        const financialActions = document.createElement('button');
        financialActions.className = 'rt--header-actions-content-icon';
        financialActions.id = 'financial-actions';
        financialActions.innerHTML = '<i class="icon-transfer"></i>';
        financialActions.addEventListener('click', openDepositMenu);
        document.getElementById('header-right').replaceChildren(financialActions);
      }, 250);
      document.addEventListener('onTransferEposPlayerFoundEvent', (event) => {
        if (event.detail && event.detail.info === null) renderSearch();
      });
    </script>
  </body>
</html>`;

const missedFirstMenuFixture = delayedDepositFixture.replace(
  '      const openDepositMenu = () => {',
  `      let ignoredFirstMenuClick = false;
      const openDepositMenu = () => {
        document.body.dataset.menuClickCount = String(
          Number(document.body.dataset.menuClickCount || '0') + 1,
        );
        if (!ignoredFirstMenuClick) { ignoredFirstMenuClick = true; return; }`,
);

const delayedLookupControlsFixture = delayedDepositFixture
  .replace(
    '<div data-placeholder="Enter Amount"><input></div>\n              <div data-placeholder="Enter Notes"><textarea></textarea></div>\n              <button>Transfer</button>',
    '<div id="pending-controls"></div>',
  )
  .replace(
    '</body>',
    `<script>
      const pendingControls = new MutationObserver(() => {
        const slot = document.getElementById('pending-controls');
        if (!slot) return;
        pendingControls.disconnect();
        document.body.dataset.delayedControls = 'pending';
        window.setTimeout(() => {
          slot.outerHTML = '<div data-placeholder="Enter Amount"><input></div>' +
            '<div data-placeholder="Enter Notes"><textarea></textarea></div>' +
            '<button>Transfer</button>';
          document.body.dataset.delayedControls = 'rendered';
        }, 250);
      });
      pendingControls.observe(document.getElementById('surface'), { childList: true, subtree: true });
    </script></body>`,
  );

describe.skipIf(process.platform !== 'win32')(
  'local KemerBet lookup in real Windows Chrome (loopback responses only)',
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

    async function startSingleLookupFixture(html: string) {
      const requestedPlayerIds: string[] = [];
      const blockedMethods: string[] = [];
      context = await browser.newContext({ serviceWorkers: 'block' });
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
          url.searchParams.get('externalId') === PLAYER_IDS[0]
        ) {
          requestedPlayerIds.push(PLAYER_IDS[0]);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              value: {
                id: 1,
                externalId: PLAYER_IDS[0],
                currencyCode: 'ETB',
                userName: 'fixture-identity',
                email: null,
              },
            }),
          });
          return;
        }
        blockedMethods.push(request.method());
        await route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      await page.goto(AGENTS_URL, { waitUntil: 'domcontentloaded' });
      return { page, requestedPlayerIds, blockedMethods };
    }

    it('recovers a lost menu click before one read-only Player lookup', async () => {
      const { page, requestedPlayerIds, blockedMethods } =
        await startSingleLookupFixture(missedFirstMenuFixture);
      expect(
        await executeSingleLocalKemerBetLookup(
          page,
          PLAYER_IDS[0],
          createLocalKemerBetLookupAuthorization(),
        ),
      ).toBe('found');
      expect(requestedPlayerIds).toEqual([PLAYER_IDS[0]]);
      expect(blockedMethods).toEqual([]);
      expect(await page.locator('body').getAttribute('data-menu-click-count')).toBe('2');
    }, 30_000);

    it('waits for the whole rendered Player card and empty form', async () => {
      const { page, requestedPlayerIds, blockedMethods } = await startSingleLookupFixture(
        delayedLookupControlsFixture,
      );
      expect(
        await executeSingleLocalKemerBetLookup(
          page,
          PLAYER_IDS[0],
          createLocalKemerBetLookupAuthorization(),
        ),
      ).toBe('found');
      expect(requestedPlayerIds).toEqual([PLAYER_IDS[0]]);
      expect(blockedMethods).toEqual([]);
      expect(await page.locator('body').getAttribute('data-delayed-controls')).toBe('rendered');
      expect(await page.locator('[data-placeholder="Enter Amount"] input').count()).toBe(0);
    }, 30_000);

    it('waits for the asynchronous entry control and To Player tile before five Find-only lookups', async () => {
      const requestedPlayerIds: string[] = [];
      context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.href === AGENTS_URL) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: delayedDepositFixture,
          });
          return;
        }
        if (
          request.method() === 'GET' &&
          url.origin === API_ORIGIN &&
          url.pathname === LOOKUP_PATH &&
          [...url.searchParams.keys()].length === 1
        ) {
          const playerId = url.searchParams.get('externalId');
          if (!playerId || !PLAYER_IDS.includes(playerId)) {
            await route.abort('blockedbyclient');
            return;
          }
          requestedPlayerIds.push(playerId);
          await route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              value: {
                id: requestedPlayerIds.length,
                externalId: playerId,
                currencyCode: 'ETB',
                userName: 'fixture-identity',
                email: null,
              },
            }),
          });
          return;
        }
        await route.abort('blockedbyclient');
      });

      const page = await context.newPage();
      await page.goto(AGENTS_URL, { waitUntil: 'domcontentloaded' });
      const outcomes = await executeExactFiveLocalKemerBetLookup(
        page,
        PLAYER_IDS,
        createLocalKemerBetLookupAuthorization(),
      );

      expect(outcomes).toEqual(['found', 'found', 'found', 'found', 'found']);
      expect(requestedPlayerIds).toEqual(PLAYER_IDS);
    }, 30_000);

    it('accepts one exact successful Find from an already-open menu', async () => {
      const requestedPlayerIds: string[] = [];
      context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.href === AGENTS_URL) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: delayedDepositFixture,
          });
          return;
        }
        if (
          request.method() === 'GET' &&
          url.origin === API_ORIGIN &&
          url.pathname === LOOKUP_PATH
        ) {
          const playerId = url.searchParams.get('externalId');
          if (playerId !== PLAYER_IDS[0] || [...url.searchParams.keys()].length !== 1) {
            await route.abort('blockedbyclient');
            return;
          }
          requestedPlayerIds.push(playerId);
          await route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              value: {
                id: 1,
                externalId: playerId,
                currencyCode: 'ETB',
                userName: 'fixture-identity',
                email: null,
              },
            }),
          });
          return;
        }
        await route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      await page.goto(AGENTS_URL, { waitUntil: 'domcontentloaded' });
      await page.locator('#financial-actions').click();
      await page.locator('.rt--transfer-dropdown').waitFor({ state: 'visible' });
      expect(
        await executeSingleLocalKemerBetLookup(
          page,
          PLAYER_IDS[0],
          createLocalKemerBetLookupAuthorization(),
        ),
      ).toBe('found');
      expect(requestedPlayerIds).toEqual([PLAYER_IDS[0]]);
      expect(
        await page.locator('.ant-modal-content [data-placeholder="Enter Amount"] input').count(),
      ).toBe(0);
    }, 30_000);

    it('does not approve an inconclusive provider response for one Player ID', async () => {
      context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.href === AGENTS_URL) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: delayedDepositFixture,
          });
        } else if (url.origin === API_ORIGIN && url.pathname === LOOKUP_PATH) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              value: {
                id: 1,
                externalId: PLAYER_IDS[1],
                currencyCode: 'ETB',
                userName: 'fixture',
                email: null,
              },
            }),
          });
        } else {
          await route.abort('blockedbyclient');
        }
      });
      const page = await context.newPage();
      await page.goto(AGENTS_URL, { waitUntil: 'domcontentloaded' });
      expect(
        await executeSingleLocalKemerBetLookup(
          page,
          PLAYER_IDS[0],
          createLocalKemerBetLookupAuthorization(),
        ),
      ).toBe('review_required');
    }, 30_000);
  },
);
