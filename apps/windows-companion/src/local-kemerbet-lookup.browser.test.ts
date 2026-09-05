import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ExactFivePlayerIds } from '@fetanagent/agent-platform-companion-contracts';

import {
  createLocalKemerBetLookupAuthorization,
  executeExactFiveLocalKemerBetLookup,
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
    <div class="rt--header-right">
      <button class="rt--header-actions-content-icon" id="financial-actions">
        <i class="icon-transfer"></i>
      </button>
    </div>
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
                  <div class="rt--flex"><b>Fixture identity</b></div>
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
      document.getElementById('financial-actions').addEventListener('click', () => {
        const deposit = document.createElement('button');
        deposit.setAttribute('role', 'menuitem');
        deposit.textContent = 'Deposit';
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
        surface.replaceChildren(deposit);
      });
      document.addEventListener('onTransferEposPlayerFoundEvent', (event) => {
        if (event.detail && event.detail.info === null) renderSearch();
      });
    </script>
  </body>
</html>`;

describe.skipIf(process.platform !== 'win32')(
  'local KemerBet lookup in real Windows Chrome (loopback responses only)',
  () => {
    let browser: Browser;
    let context: BrowserContext | undefined;

    beforeAll(async () => {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    }, 30_000);

    afterEach(async () => {
      await context?.close();
      context = undefined;
    });

    afterAll(async () => {
      await browser?.close();
    });

    it('waits for the asynchronously rendered To Player tile before five Find-only lookups', async () => {
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
  },
);
