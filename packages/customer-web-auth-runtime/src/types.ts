export interface CustomerWebRequestCookie {
  readonly name: string;
  readonly value: string;
}

export interface CustomerWebResponseCookie {
  readonly expires?: Date;
  readonly httpOnly: true;
  readonly maxAge?: number;
  readonly name: string;
  readonly path: '/';
  readonly sameSite: 'lax';
  readonly secure: true;
  readonly value: string;
}

export type CustomerWebAuthResponseHeaderName = 'cache-control' | 'expires' | 'pragma' | 'vary';

export interface CustomerWebCookiePort {
  readAll(): readonly CustomerWebRequestCookie[];
  appendSetCookie(cookie: CustomerWebResponseCookie): void;
  appendResponseHeader(name: CustomerWebAuthResponseHeaderName, value: string): void;
}

export interface CustomerWebAuthRequestContext {
  readonly cookies: CustomerWebCookiePort;
}

export interface CustomerWebEmailPasswordInput {
  readonly email: string;
  readonly password: string;
}

export interface CustomerWebEmailInput {
  readonly email: string;
}

export interface CustomerWebPasswordRecoveryInput {
  readonly code: string;
  readonly password: string;
}

export type CustomerWebAuthFailure = {
  readonly error: 'customer_auth_request_failed';
  readonly ok: false;
};

export type CustomerWebAuthActionResult<
  Status extends 'authenticated' | 'signed_out' | 'recovery_request_accepted' | 'password_updated',
> =
  | {
      readonly ok: true;
      readonly status: Status;
    }
  | CustomerWebAuthFailure;

export type CustomerWebCurrentCustomerResult =
  | {
      readonly account: {
        readonly email: string;
      };
      readonly ok: true;
      readonly status: 'authenticated';
    }
  | {
      readonly ok: true;
      readonly status: 'anonymous';
    }
  | CustomerWebAuthFailure;

export interface CustomerWebAuthPort {
  signUpWithEmailPassword(
    context: CustomerWebAuthRequestContext,
    input: CustomerWebEmailPasswordInput,
  ): Promise<CustomerWebAuthActionResult<'authenticated'>>;
  signInWithEmailPassword(
    context: CustomerWebAuthRequestContext,
    input: CustomerWebEmailPasswordInput,
  ): Promise<CustomerWebAuthActionResult<'authenticated'>>;
  signOut(
    context: CustomerWebAuthRequestContext,
  ): Promise<CustomerWebAuthActionResult<'signed_out'>>;
  requestPasswordRecovery(
    context: CustomerWebAuthRequestContext,
    input: CustomerWebEmailInput,
  ): Promise<CustomerWebAuthActionResult<'recovery_request_accepted'>>;
  completePasswordRecovery(
    context: CustomerWebAuthRequestContext,
    input: CustomerWebPasswordRecoveryInput,
  ): Promise<CustomerWebAuthActionResult<'password_updated'>>;
  getCurrentCustomer(
    context: CustomerWebAuthRequestContext,
  ): Promise<CustomerWebCurrentCustomerResult>;
}
