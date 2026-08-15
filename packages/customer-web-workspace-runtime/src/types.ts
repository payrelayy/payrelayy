export type CustomerWorkspaceDisplayStatus = 'checking' | 'ready' | 'needs_attention';

export interface CustomerWorkspaceRegistration {
  readonly playerId: string;
  readonly status: CustomerWorkspaceDisplayStatus;
}

export type CustomerWorkspaceFailure = {
  readonly error: 'customer_workspace_unavailable';
  readonly ok: false;
};

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

export interface CustomerWorkspacePort {
  ensureAccount(input: { readonly authUserId: string }): Promise<CustomerWorkspaceEnsureResult>;
  listPlayerRegistrations(input: {
    readonly authUserId: string;
    readonly limit: number;
  }): Promise<CustomerWorkspaceListResult>;
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
