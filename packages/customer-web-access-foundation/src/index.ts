import { isProxy } from 'node:util/types';

/**
 * Pure customer-web product-decision foundation. This package records reviewed intent only. It
 * does not create a web or PWA runtime, create an account, accept an email or password,
 * authenticate a customer, request or confirm recovery email, persist a session, link or merge
 * Telegram identity, or grant any financial capability. A blocked result is not runtime
 * readiness.
 */
export const CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION = 1 as const;
export const CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE =
  'fetanagent_customer_web_access_foundation_v1' as const;

export interface CustomerWebAccessFoundationRequest {
  readonly contractVersion: typeof CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION;
  readonly productProfile: typeof CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE;
  readonly surfaceMode: 'standalone_web_pwa_intent';
  readonly telegramRelationship: 'optional_link_without_identity_merge';
  readonly locale: 'en';
  readonly vocabularyProfile: 'neutral_customer_access';
  readonly accountAuthenticationIntent: 'email_password';
  readonly accountCreationIntent: 'self_service';
  readonly sessionIntent: 'persistent_until_explicit_sign_out_or_security_revocation';
  readonly emailIntent: 'recovery_confirmation_request_only';
  readonly additionalAuthenticationIntent: 'none_requested';
}

interface CustomerWebAccessDisabledCapabilities {
  readonly webRuntimeAllowed: false;
  readonly pwaInstallationAllowed: false;
  readonly serviceWorkerAllowed: false;
  readonly networkAllowed: false;
  readonly cookieAllowed: false;
  readonly browserStorageAllowed: false;
  readonly authProviderAllowed: false;
  readonly accountCreationAllowed: false;
  readonly credentialAcceptanceAllowed: false;
  readonly passwordAcceptanceAllowed: false;
  readonly emailCollectionAllowed: false;
  readonly emailAuthenticationAllowed: false;
  readonly recoveryEmailRequestAllowed: false;
  readonly recoveryEmailConfirmationAllowed: false;
  readonly sessionCreationAllowed: false;
  readonly sessionPersistenceAllowed: false;
  readonly telegramLinkingAllowed: false;
  readonly telegramIdentityMergeAllowed: false;
  readonly databaseAllowed: false;
  readonly persistenceAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly platformActionAllowed: false;
  readonly financialCapabilityAllowed: false;
}

export interface CustomerWebAccessFoundationBlockedResult
  extends CustomerWebAccessFoundationRequest, CustomerWebAccessDisabledCapabilities {
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly reasonCode: 'customer_web_access_runtime_not_implemented';
}

export interface CustomerWebAccessFoundationInvalidResult extends CustomerWebAccessDisabledCapabilities {
  readonly contractVersion: typeof CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION;
  readonly productProfile: typeof CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE;
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export type CustomerWebAccessFoundationResult =
  CustomerWebAccessFoundationBlockedResult | CustomerWebAccessFoundationInvalidResult;

export type RedactedCustomerWebAccessFoundationBlockedLogProjection =
  CustomerWebAccessFoundationBlockedResult;

export interface RedactedCustomerWebAccessFoundationInvalidLogProjection {
  readonly contractVersion: typeof CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION;
  readonly productProfile: typeof CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE;
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_result';
  readonly reasonCode: 'invalid_result';
}

export type RedactedCustomerWebAccessFoundationLogProjection =
  | RedactedCustomerWebAccessFoundationBlockedLogProjection
  | RedactedCustomerWebAccessFoundationInvalidLogProjection;

type UnknownRecord = Record<string, unknown>;

const requestKeys = [
  'contractVersion',
  'productProfile',
  'surfaceMode',
  'telegramRelationship',
  'locale',
  'vocabularyProfile',
  'accountAuthenticationIntent',
  'accountCreationIntent',
  'sessionIntent',
  'emailIntent',
  'additionalAuthenticationIntent',
] as const;

const disabledCapabilityKeys = [
  'webRuntimeAllowed',
  'pwaInstallationAllowed',
  'serviceWorkerAllowed',
  'networkAllowed',
  'cookieAllowed',
  'browserStorageAllowed',
  'authProviderAllowed',
  'accountCreationAllowed',
  'credentialAcceptanceAllowed',
  'passwordAcceptanceAllowed',
  'emailCollectionAllowed',
  'emailAuthenticationAllowed',
  'recoveryEmailRequestAllowed',
  'recoveryEmailConfirmationAllowed',
  'sessionCreationAllowed',
  'sessionPersistenceAllowed',
  'telegramLinkingAllowed',
  'telegramIdentityMergeAllowed',
  'databaseAllowed',
  'persistenceAllowed',
  'runtimeWiringAllowed',
  'platformActionAllowed',
  'financialCapabilityAllowed',
] as const;

const blockedResultKeys = [
  ...requestKeys,
  'advisoryOnly',
  'disposition',
  'reasonCode',
  ...disabledCapabilityKeys,
] as const;

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
    );
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function hasAllDisabledCapabilities(candidate: UnknownRecord): boolean {
  return disabledCapabilityKeys.every((key) => ownDataValue(candidate, key) === false);
}

function isExactRequest(candidate: unknown): candidate is CustomerWebAccessFoundationRequest {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, requestKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION &&
    ownDataValue(candidate, 'productProfile') === CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE &&
    ownDataValue(candidate, 'surfaceMode') === 'standalone_web_pwa_intent' &&
    ownDataValue(candidate, 'telegramRelationship') === 'optional_link_without_identity_merge' &&
    ownDataValue(candidate, 'locale') === 'en' &&
    ownDataValue(candidate, 'vocabularyProfile') === 'neutral_customer_access' &&
    ownDataValue(candidate, 'accountAuthenticationIntent') === 'email_password' &&
    ownDataValue(candidate, 'accountCreationIntent') === 'self_service' &&
    ownDataValue(candidate, 'sessionIntent') ===
      'persistent_until_explicit_sign_out_or_security_revocation' &&
    ownDataValue(candidate, 'emailIntent') === 'recovery_confirmation_request_only' &&
    ownDataValue(candidate, 'additionalAuthenticationIntent') === 'none_requested'
  );
}

function isExactBlockedResult(
  candidate: unknown,
): candidate is CustomerWebAccessFoundationBlockedResult {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, blockedResultKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION &&
    ownDataValue(candidate, 'productProfile') === CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE &&
    ownDataValue(candidate, 'surfaceMode') === 'standalone_web_pwa_intent' &&
    ownDataValue(candidate, 'telegramRelationship') === 'optional_link_without_identity_merge' &&
    ownDataValue(candidate, 'locale') === 'en' &&
    ownDataValue(candidate, 'vocabularyProfile') === 'neutral_customer_access' &&
    ownDataValue(candidate, 'accountAuthenticationIntent') === 'email_password' &&
    ownDataValue(candidate, 'accountCreationIntent') === 'self_service' &&
    ownDataValue(candidate, 'sessionIntent') ===
      'persistent_until_explicit_sign_out_or_security_revocation' &&
    ownDataValue(candidate, 'emailIntent') === 'recovery_confirmation_request_only' &&
    ownDataValue(candidate, 'additionalAuthenticationIntent') === 'none_requested' &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'disposition') === 'blocked' &&
    ownDataValue(candidate, 'reasonCode') === 'customer_web_access_runtime_not_implemented' &&
    hasAllDisabledCapabilities(candidate)
  );
}

const disabledCapabilities: CustomerWebAccessDisabledCapabilities = {
  webRuntimeAllowed: false,
  pwaInstallationAllowed: false,
  serviceWorkerAllowed: false,
  networkAllowed: false,
  cookieAllowed: false,
  browserStorageAllowed: false,
  authProviderAllowed: false,
  accountCreationAllowed: false,
  credentialAcceptanceAllowed: false,
  passwordAcceptanceAllowed: false,
  emailCollectionAllowed: false,
  emailAuthenticationAllowed: false,
  recoveryEmailRequestAllowed: false,
  recoveryEmailConfirmationAllowed: false,
  sessionCreationAllowed: false,
  sessionPersistenceAllowed: false,
  telegramLinkingAllowed: false,
  telegramIdentityMergeAllowed: false,
  databaseAllowed: false,
  persistenceAllowed: false,
  runtimeWiringAllowed: false,
  platformActionAllowed: false,
  financialCapabilityAllowed: false,
};

/**
 * The sole result for the exact decision request. Its metadata records intent, while every
 * capability remains disabled. It does not mean a customer web runtime is ready or permitted.
 */
export const CUSTOMER_WEB_ACCESS_BLOCKED_RESULT: CustomerWebAccessFoundationBlockedResult =
  Object.freeze({
    contractVersion: CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION,
    productProfile: CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE,
    surfaceMode: 'standalone_web_pwa_intent' as const,
    telegramRelationship: 'optional_link_without_identity_merge' as const,
    locale: 'en' as const,
    vocabularyProfile: 'neutral_customer_access' as const,
    accountAuthenticationIntent: 'email_password' as const,
    accountCreationIntent: 'self_service' as const,
    sessionIntent: 'persistent_until_explicit_sign_out_or_security_revocation' as const,
    emailIntent: 'recovery_confirmation_request_only' as const,
    additionalAuthenticationIntent: 'none_requested' as const,
    advisoryOnly: true as const,
    disposition: 'blocked' as const,
    reasonCode: 'customer_web_access_runtime_not_implemented' as const,
    ...disabledCapabilities,
  });

/** A separate fixed, fail-closed decision for every malformed or hostile request. */
export const CUSTOMER_WEB_ACCESS_INVALID_RESULT: CustomerWebAccessFoundationInvalidResult =
  Object.freeze({
    contractVersion: CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION,
    productProfile: CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE,
    advisoryOnly: true as const,
    disposition: 'invalid_request' as const,
    reasonCode: 'invalid_request' as const,
    ...disabledCapabilities,
  });

const blockedLogProjection: RedactedCustomerWebAccessFoundationBlockedLogProjection = Object.freeze(
  { ...CUSTOMER_WEB_ACCESS_BLOCKED_RESULT },
);

const invalidLogProjection: RedactedCustomerWebAccessFoundationInvalidLogProjection = Object.freeze(
  {
    contractVersion: CUSTOMER_WEB_ACCESS_FOUNDATION_CONTRACT_VERSION,
    productProfile: CUSTOMER_WEB_ACCESS_PRODUCT_PROFILE,
    advisoryOnly: true as const,
    disposition: 'invalid_result' as const,
    reasonCode: 'invalid_result' as const,
  },
);

/** Evaluates untrusted metadata without accepting or echoing customer or runtime material. */
export function evaluateCustomerWebAccessFoundation(
  requestCandidate: unknown,
): CustomerWebAccessFoundationResult {
  try {
    return isExactRequest(requestCandidate)
      ? CUSTOMER_WEB_ACCESS_BLOCKED_RESULT
      : CUSTOMER_WEB_ACCESS_INVALID_RESULT;
  } catch {
    return CUSTOMER_WEB_ACCESS_INVALID_RESULT;
  }
}

/** Revalidates an untrusted result and emits only fixed, allowlisted decision metadata. */
export function redactedCustomerWebAccessFoundationForLog(
  resultCandidate: unknown,
): RedactedCustomerWebAccessFoundationLogProjection {
  try {
    return isExactBlockedResult(resultCandidate) ? blockedLogProjection : invalidLogProjection;
  } catch {
    return invalidLogProjection;
  }
}
