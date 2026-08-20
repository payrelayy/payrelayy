import type { CustomerDepositStatusProjection } from '@fetanagent/contracts';

export type CustomerWorkspaceDisplayStatus = 'checking' | 'ready' | 'needs_attention';
export type CustomerDepositProofProvider = 'cbe_birr' | 'telebirr';

export interface CustomerWorkspaceRegistration {
  readonly playerId: string;
  readonly status: CustomerWorkspaceDisplayStatus;
}

export type CustomerWorkspaceFailure = {
  readonly error: 'customer_workspace_unavailable';
  readonly ok: false;
};

export type CustomerWebRateLimitResult =
  | {
      readonly allowed: boolean;
      readonly currentCount: number;
      readonly ok: true;
      readonly retryAfterSeconds: number;
    }
  | CustomerWorkspaceFailure;

export type CustomerWorkspaceEnsureResult =
  | {
      readonly ok: true;
      readonly status: 'active';
    }
  | CustomerWorkspaceFailure;

export type CustomerWorkspaceListResult =
  | {
      readonly ok: true;
      readonly registrations: readonly CustomerWorkspaceRegistration[];
    }
  | CustomerWorkspaceFailure;

export type CustomerWorkspaceSubmitResult =
  | {
      readonly ok: true;
      readonly registration: CustomerWorkspaceRegistration;
    }
  | CustomerWorkspaceFailure;

export interface CustomerDepositInstructions {
  readonly amountMinor: string;
  readonly currencyCode: 'ETB';
  readonly customerInstruction: string;
  readonly depositIntentId: string;
  readonly paymentDeadline: string;
  readonly providerName: 'CBE Birr';
  readonly receiverAccountHolderName: string;
  readonly receiverAccountMasked: string;
  readonly replayed: boolean;
  readonly status: CustomerDepositStatusProjection;
}

export interface CustomerDepositSummary {
  readonly amountMinor: string;
  readonly createdAt: string;
  readonly currencyCode: 'ETB';
  readonly depositIntentId: string;
  readonly status: CustomerDepositStatusProjection;
  readonly updatedAt: string;
}

export type CustomerDepositOpenResult =
  | { readonly ok: true; readonly instructions: CustomerDepositInstructions }
  | CustomerWorkspaceFailure;

export type CustomerDepositCaptureResult =
  | {
      readonly ok: true;
      readonly depositIntentId: string;
      readonly replayed: boolean;
      readonly status: CustomerDepositStatusProjection;
      readonly submittedAt: string;
    }
  | CustomerWorkspaceFailure;

export type CustomerDryRunDepositProofCaptureResult =
  | {
      readonly ok: true;
      readonly provider: CustomerDepositProofProvider;
      readonly replayed: boolean;
      readonly status: 'proof_received';
      readonly submittedAt: string;
    }
  | CustomerWorkspaceFailure;

export type CustomerDepositListResult =
  | { readonly ok: true; readonly deposits: readonly CustomerDepositSummary[] }
  | CustomerWorkspaceFailure;

export interface CustomerWorkspacePort {
  captureDryRunDepositProof(input: {
    readonly authUserId: string;
    readonly ciphertext: string;
    readonly fingerprint: string;
    readonly keyVersion: 2;
    readonly masked: string;
    readonly playerId: string;
    readonly profileVersion: 2;
    readonly provider: CustomerDepositProofProvider;
    readonly requestKey: string;
  }): Promise<CustomerDryRunDepositProofCaptureResult>;
  captureDepositReference(input: {
    readonly authUserId: string;
    readonly ciphertext: string;
    readonly depositIntentId: string;
    readonly fingerprint: string;
    readonly keyVersion: 1;
    readonly masked: string;
    readonly requestKey: string;
  }): Promise<CustomerDepositCaptureResult>;
  consumeRateLimit(input: {
    readonly bucketKey: string;
    readonly maxRequests: number;
    readonly routeKey: string;
    readonly windowSeconds: number;
  }): Promise<CustomerWebRateLimitResult>;
  ensureAccount(input: { readonly authUserId: string }): Promise<CustomerWorkspaceEnsureResult>;
  listDeposits(input: {
    readonly authUserId: string;
    readonly limit: number;
  }): Promise<CustomerDepositListResult>;
  listPlayerRegistrations(input: {
    readonly authUserId: string;
    readonly limit: number;
  }): Promise<CustomerWorkspaceListResult>;
  openDeposit(input: {
    readonly amountMinor: string;
    readonly authUserId: string;
    readonly playerId: string;
    readonly requestKey: string;
  }): Promise<CustomerDepositOpenResult>;
  submitPlayerRegistration(input: {
    readonly authUserId: string;
    readonly playerId: string;
    readonly requestKey: string;
  }): Promise<CustomerWorkspaceSubmitResult>;
}

export interface CustomerWorkspaceRuntime extends CustomerWorkspacePort {
  close(): Promise<void>;
  ready(): Promise<boolean>;
}
