export type FinancialActionsMode = 'dry_run' | 'live';

export class FinancialActionsDisabledError extends Error {
  public constructor(operation: string) {
    super(`Financial action '${operation}' is disabled while FINANCIAL_ACTIONS_MODE is dry_run.`);
    this.name = 'FinancialActionsDisabledError';
  }
}

/**
 * This guard belongs at every irreversible provider or platform action. A feature switch
 * is never an authorization record; future live code must still create an audit event and
 * durable execution attempt before calling an adapter.
 */
export function assertFinancialActionsEnabled(mode: FinancialActionsMode, operation: string): void {
  if (mode !== 'live') {
    throw new FinancialActionsDisabledError(operation);
  }
}
