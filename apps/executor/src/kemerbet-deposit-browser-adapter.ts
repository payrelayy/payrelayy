import {
  isKemerBetDepositAmountMinor,
  type KemerBetDepositExecutionLease,
  type KemerBetDepositPageObservation,
  type KemerBetDepositPreparedPage,
  type KemerBetDepositReconciliationLease,
} from './kemerbet-deposit-types.js';

export const KEMERBET_AGENT_ALLOWED_ORIGIN = 'https://agentsystem.admindigi.com' as const;

export interface KemerBetAgentLookupView {
  readonly playerId: string;
  readonly currencyCode: string;
}

export interface KemerBetAgentTransferResultView {
  readonly playerId: string;
  readonly creditEvidenceText: string;
}

export interface KemerBetAgentPreparedDepositView {
  readonly playerId: string;
  readonly amountText: string;
  readonly currencyCode: string;
}

export interface KemerBetAgentHistoryView {
  readonly stateLabel: string;
  readonly operationLabel: string;
  readonly paymentMethod: string;
  readonly playerId: string;
  readonly amountText: string;
  readonly currencyCode: string;
  readonly occurredAt: string;
  readonly externalReference: string;
}

/**
 * Narrow agent-system page surface expected from a browser driver. Implementations wrap an
 * already-provisioned agent session; the executor never obtains credentials, cookies, or storage
 * state and never opens a customer/player account session.
 */
export interface KemerBetBrowserPage {
  readonly sessionKey: string;
  goto(url: string): Promise<void>;
  currentUrl(): Promise<string>;
  openPlayerDeposit(): Promise<void>;
  lookupPlayer(playerId: string): Promise<void>;
  fillDeposit(amount: string, notes: string): Promise<void>;
  transferOnce(): Promise<void>;
  readAgentLookup(): Promise<KemerBetAgentLookupView>;
  readAgentPreparedDeposit(): Promise<KemerBetAgentPreparedDepositView>;
  readAgentTransferResult(): Promise<KemerBetAgentTransferResultView | null>;
  readAgentHistory(): Promise<readonly KemerBetAgentHistoryView[]>;
}

export interface KemerBetDepositBrowserRoutes {
  readonly agentDepositUrl: string;
  readonly agentHistoryUrl: string;
}

export interface KemerBetDepositBrowserDependencies {
  readonly platformAgentAccountId: string;
  readonly agentPage: KemerBetBrowserPage;
  readonly routes: KemerBetDepositBrowserRoutes;
  readonly now: () => Date;
  readonly fingerprintExternalReference: (rawReference: string) => string;
}

export interface KemerBetImmediateFinalActionResult {
  readonly response: 'success_dialog_observed' | 'response_lost' | 'response_uncertain';
  readonly exactPlayerCreditMatch: boolean;
}

export interface KemerBetDepositBrowser {
  readonly platformAgentAccountId: string;
  probePlayerLookup(target: { readonly playerId: string; readonly currencyCode: 'ETB' }): Promise<{
    readonly exactPlayerMatch: true;
    readonly exactCurrencyMatch: true;
    readonly transferDisabled: true;
  }>;
  prepare(lease: KemerBetDepositExecutionLease): Promise<KemerBetDepositPreparedPage>;
  submitOnceAfterFence(
    lease: KemerBetDepositExecutionLease,
    fence: { readonly firstFenceAcquired: true; readonly finalActionFencedAt: Date },
  ): Promise<KemerBetImmediateFinalActionResult>;
  reconcile(lease: KemerBetDepositReconciliationLease): Promise<KemerBetDepositPageObservation>;
}

export class KemerBetDepositBrowserUnavailableError extends Error {
  constructor() {
    super('The supervised KemerBet deposit browser is unavailable.');
    this.name = 'KemerBetDepositBrowserUnavailableError';
  }
}

function requireAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new KemerBetDepositBrowserUnavailableError();
  }
  if (
    url.origin !== KEMERBET_AGENT_ALLOWED_ORIGIN ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw new KemerBetDepositBrowserUnavailableError();
  }
  return url;
}

function requireInternalUuid(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    throw new KemerBetDepositBrowserUnavailableError();
  }
}

function strictDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
}

function amountMinor(value: string): number | null {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?\s*(?:ETB)?$/iu.exec(value.trim());
  if (!match?.[1]) return null;
  const fraction = `${match[2] ?? ''}00`.slice(0, 2);
  const parsed = Number(match[1]) * 100 + Number(fraction);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function exactCreditDeltaMinor(value: string): number | null {
  const match = /^Player Balance \+([0-9]+)\.([0-9]{2}) ETB Success$/u.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const parsed = Number(match[1]) * 100 + Number(match[2]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizedPaymentMethod(value: string): 'EPOS' | null {
  return value === 'EPOS' ? 'EPOS' : null;
}

async function navigateAllowed(page: KemerBetBrowserPage, rawUrl: string): Promise<void> {
  const url = requireAllowedUrl(rawUrl);
  await page.goto(url.href);
  requireAllowedUrl(await page.currentUrl());
}

async function requirePageStillAllowed(page: KemerBetBrowserPage): Promise<void> {
  requireAllowedUrl(await page.currentUrl());
}

export function createKemerBetDepositBrowser(
  dependencies: KemerBetDepositBrowserDependencies,
): KemerBetDepositBrowser {
  const { platformAgentAccountId, agentPage, routes, now, fingerprintExternalReference } =
    dependencies;
  requireInternalUuid(platformAgentAccountId);
  if (!agentPage.sessionKey) throw new KemerBetDepositBrowserUnavailableError();
  requireAllowedUrl(routes.agentDepositUrl);
  requireAllowedUrl(routes.agentHistoryUrl);

  const submittedAttemptIds = new Set<string>();

  function requireExactAgentBinding(lease: { readonly platformAgentAccountId: string }): void {
    if (lease.platformAgentAccountId !== platformAgentAccountId) {
      throw new KemerBetDepositBrowserUnavailableError();
    }
  }

  async function openAndVerifyPlayer(target: {
    readonly playerId: string;
    readonly currencyCode: 'ETB';
  }): Promise<void> {
    if (
      target.playerId.length < 1 ||
      target.playerId.length > 128 ||
      target.playerId !== target.playerId.trim() ||
      /\r|\n|\0/u.test(target.playerId) ||
      target.currencyCode !== 'ETB'
    ) {
      throw new KemerBetDepositBrowserUnavailableError();
    }
    await navigateAllowed(agentPage, routes.agentDepositUrl);
    await agentPage.openPlayerDeposit();
    await agentPage.lookupPlayer(target.playerId);
    await requirePageStillAllowed(agentPage);
    const lookup = await agentPage.readAgentLookup();
    if (lookup.playerId !== target.playerId || lookup.currencyCode !== target.currencyCode) {
      throw new KemerBetDepositBrowserUnavailableError();
    }
  }

  return {
    platformAgentAccountId,
    async probePlayerLookup(target) {
      await openAndVerifyPlayer(target);
      return {
        exactPlayerMatch: true,
        exactCurrencyMatch: true,
        transferDisabled: true,
      };
    },
    async prepare(lease) {
      requireExactAgentBinding(lease);
      if (!isKemerBetDepositAmountMinor(lease.target.amountMinor)) {
        throw new KemerBetDepositBrowserUnavailableError();
      }
      await openAndVerifyPlayer(lease.target);
      await agentPage.fillDeposit((lease.target.amountMinor / 100).toFixed(2), '');
      await requirePageStillAllowed(agentPage);
      const rendered = await agentPage.readAgentPreparedDeposit();
      if (
        rendered.playerId !== lease.target.playerId ||
        rendered.currencyCode !== lease.target.currencyCode ||
        amountMinor(rendered.amountText) !== lease.target.amountMinor
      ) {
        throw new KemerBetDepositBrowserUnavailableError();
      }
      return {
        exactPlayerMatch: true,
        exactCurrencyMatch: true,
        amountFilledMinor: lease.target.amountMinor,
        preparedAt: now(),
      };
    },

    async submitOnceAfterFence(lease, fence) {
      requireExactAgentBinding(lease);
      if (!fence.firstFenceAcquired || submittedAttemptIds.has(lease.executionAttemptId)) {
        throw new KemerBetDepositBrowserUnavailableError();
      }
      submittedAttemptIds.add(lease.executionAttemptId);
      await requirePageStillAllowed(agentPage);
      const rendered = await agentPage.readAgentPreparedDeposit();
      if (
        rendered.playerId !== lease.target.playerId ||
        rendered.currencyCode !== lease.target.currencyCode ||
        amountMinor(rendered.amountText) !== lease.target.amountMinor
      ) {
        // The attempt is already fenced, so page drift is uncertainty: do not click and do not
        // permit any retry. Reconciliation records the missing modal fact as fail-closed.
        return { response: 'response_uncertain', exactPlayerCreditMatch: false };
      }
      // This is the only browser call in the adapter that can move money.
      await agentPage.transferOnce();
      await requirePageStillAllowed(agentPage);
      try {
        const result = await agentPage.readAgentTransferResult();
        if (result === null) {
          return { response: 'response_lost', exactPlayerCreditMatch: false };
        }
        const exactPlayerCreditMatch =
          result.playerId === lease.target.playerId &&
          exactCreditDeltaMinor(result.creditEvidenceText) === lease.target.amountMinor;
        return {
          response: exactPlayerCreditMatch ? 'success_dialog_observed' : 'response_uncertain',
          exactPlayerCreditMatch,
        };
      } catch (error) {
        if (error instanceof KemerBetDepositBrowserUnavailableError) throw error;
        // Missing post-action evidence never means the transfer failed and never enables retry.
        return { response: 'response_lost', exactPlayerCreditMatch: false };
      }
    },

    async reconcile(lease) {
      requireExactAgentBinding(lease);
      const observedAt = now();
      const { finalActionFencedAt, reconciliationRequiredAt } = lease.recovery;
      if (
        observedAt.getTime() < reconciliationRequiredAt.getTime() ||
        reconciliationRequiredAt.getTime() < finalActionFencedAt.getTime()
      ) {
        return {
          observation: 'not_observed',
          evidence: null,
          reasonCode: 'history_unavailable',
        };
      }

      let rows: readonly KemerBetAgentHistoryView[];
      try {
        await navigateAllowed(agentPage, routes.agentHistoryUrl);
        rows = await agentPage.readAgentHistory();
      } catch (error) {
        if (error instanceof KemerBetDepositBrowserUnavailableError) throw error;
        return {
          observation: 'not_observed',
          evidence: null,
          reasonCode: 'history_unavailable',
        };
      }

      const approvedRows = rows.filter((row) => row.stateLabel === 'Approved');
      const sameTargetWindowRows = approvedRows.flatMap((row) => {
        const occurredAt = strictDate(row.occurredAt);
        const withinWindow =
          occurredAt !== null &&
          occurredAt.getTime() >= finalActionFencedAt.getTime() &&
          occurredAt.getTime() <= reconciliationRequiredAt.getTime();
        return row.playerId === lease.target.playerId && withinWindow && occurredAt !== null
          ? [{ row, occurredAt }]
          : [];
      });
      const exactRows = sameTargetWindowRows.filter(({ row }) => {
        if (
          row.operationLabel !== 'Player Epos Deposit' ||
          normalizedPaymentMethod(row.paymentMethod) !== 'EPOS' ||
          amountMinor(row.amountText) !== lease.target.amountMinor ||
          row.currencyCode !== lease.target.currencyCode
        ) {
          return false;
        }
        return true;
      });

      if (exactRows.length > 1) {
        return {
          observation: 'ambiguous',
          evidence: null,
          reasonCode: 'multiple_exact_history_rows',
        };
      }
      if (sameTargetWindowRows.length > 1) {
        return {
          observation: 'ambiguous',
          evidence: null,
          reasonCode: 'history_mismatch',
        };
      }
      if (exactRows.length === 0) {
        return sameTargetWindowRows.length === 0
          ? { observation: 'not_observed', evidence: null, reasonCode: 'history_missing' }
          : { observation: 'ambiguous', evidence: null, reasonCode: 'history_mismatch' };
      }
      if (!lease.recovery.exactPlayerCreditMatch) {
        return {
          observation: 'ambiguous',
          evidence: null,
          reasonCode: 'player_credit_mismatch',
        };
      }

      const exact = exactRows[0]!;
      if (
        exact.row.externalReference.length < 1 ||
        exact.row.externalReference.length > 256 ||
        exact.row.externalReference !== exact.row.externalReference.trim()
      ) {
        return {
          observation: 'ambiguous',
          evidence: null,
          reasonCode: 'history_mismatch',
        };
      }
      const fingerprint = fingerprintExternalReference(exact.row.externalReference);
      if (!/^hmac-sha256-v1:[0-9a-f]{64}$/u.test(fingerprint)) {
        return {
          observation: 'ambiguous',
          evidence: null,
          reasonCode: 'history_mismatch',
        };
      }
      return {
        observation: 'confirmed_executed',
        evidence: {
          keyedExternalReferenceFingerprint: fingerprint,
          approvedHistoryMatchCount: 1,
          normalizedOperationType: 'deposit',
          matchedHistoryOccurredAt: exact.occurredAt,
          exactPlayerMatch: true,
          exactAmountMatch: true,
          exactCurrencyMatch: true,
          exactPlayerCreditMatch: true,
        },
        reasonCode: 'exact_history_and_player_credit',
      };
    },
  };
}
