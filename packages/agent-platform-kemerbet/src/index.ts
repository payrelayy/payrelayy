import {
  AGENT_PLATFORM_CONTRACT_VERSION,
  ENROLLMENT_ONLY_CAPABILITY_POLICY,
  defineAgentPlatformEnrollmentAdapter,
  parseAgentPlatformAdapterManifest,
  parseAgentPlatformSessionPolicy,
  parseAgentSessionGenerationForManifest,
  type AgentPlatformPageClassification,
  type AgentSessionGeneration,
} from '@fetanagent/agent-platform-contracts';

export const KEMERBET_PLATFORM_CODE = 'kemerbet' as const;
export const KEMERBET_AGENT_WEB_ORIGIN = 'https://agentsystem.admindigi.com' as const;
export const KEMERBET_AGENT_API_ORIGIN = 'https://admin-api.agt-digi.com' as const;
export const KEMERBET_AGENT_PLAYER_LOOKUP_PATH = '/Player/GeneralInfoByExternalId' as const;
export const KEMERBET_AGENT_LOGIN_URL = 'https://agentsystem.admindigi.com/login' as const;
export const KEMERBET_AGENT_LOGIN_RETRY_URL =
  'https://agentsystem.admindigi.com/login?et=1' as const;
export const KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL =
  'https://agentsystem.admindigi.com/agents' as const;
export const KEMERBET_ENROLLMENT_ADAPTER_VERSION = 'kemerbet-enrollment-v1' as const;
export const KEMERBET_MAX_LOGIN_LIFETIME_SECONDS = 600 as const;
export const KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS = 43_200 as const;
export const KEMERBET_MAX_GENERATION_LIFETIME_SECONDS = 43_800 as const;
export const KEMERBET_LOCAL_IDENTITY_SELECTOR_CONTRACT_VERSION = 1 as const;
export const KEMERBET_LOCAL_IDENTITY_ROOT_SELECTOR =
  '.rt--header-actions-content:has(.rt--header-actions-name)' as const;
export const KEMERBET_LOCAL_IDENTITY_VALUE_SELECTOR = '.rt--header-actions-name' as const;
export const KEMERBET_LOCAL_SESSION_FAILURE_CAPTCHA_SELECTOR =
  'iframe[src*="recaptcha"][src*="/bframe"]' as const;
export const KEMERBET_LOCAL_SESSION_FAILURE_SIGN_IN_FORM_SELECTOR =
  'form.ant-form:has(input#userName):has(input#password[type="password"])' as const;

const KEMERBET_PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const KEMERBET_MAXIMUM_LOOKUP_JSON_BYTES = 64 * 1_024;

function plainLookupRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function boundedLookupIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/**
 * Validate the one reviewed KemerBet Player-ID response without returning an identity, internal
 * player key, balance, or response body to the caller. The raw bytes stay in local process memory
 * only long enough to prove the exact external ID and ETB response binding.
 */
export function validateKemerBetReadOnlyPlayerLookupResponse(input: {
  readonly body: Uint8Array;
  readonly requestedPlayerId: string;
  readonly statusCode: number;
}): boolean {
  if (
    input.statusCode !== 200 ||
    !(input.body instanceof Uint8Array) ||
    input.body.byteLength < 2 ||
    input.body.byteLength > KEMERBET_MAXIMUM_LOOKUP_JSON_BYTES ||
    !KEMERBET_PLAYER_ID_PATTERN.test(input.requestedPlayerId)
  ) {
    return false;
  }
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(input.body);
    if (/^\s*\ufeff/u.test(text) || /\0/u.test(text)) return false;
    parsed = JSON.parse(text) as unknown;
  } catch {
    return false;
  }
  if (!plainLookupRecord(parsed) || !plainLookupRecord(parsed.value)) return false;
  const value = parsed.value;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    value.externalId !== input.requestedPlayerId ||
    value.currencyCode !== 'ETB'
  ) {
    return false;
  }
  const identities = [...new Set([value.userName, value.email])].filter(boundedLookupIdentity);
  return identities.length >= 1 && identities.length <= 2;
}

export const KEMERBET_READ_ONLY_LOOKUP_RESPONSE_CONTRACT = Object.freeze({
  currencyCode: 'ETB' as const,
  maximumJsonBytes: KEMERBET_MAXIMUM_LOOKUP_JSON_BYTES,
  requiredValueFields: Object.freeze(['id', 'externalId', 'currencyCode'] as const),
  statusCode: 200 as const,
});

/**
 * SHA-256 of canonicalizeAgentPlatformAdapterManifest(manifest). Updating any
 * route, policy, or adapter version requires an explicit digest rotation.
 */
export const KEMERBET_ENROLLMENT_ADAPTER_DIGEST =
  'sha256:510f532e5e16f3d2fad8c7467f77dc2c8693f7739e417ab9e1fa0991d31540c2' as const;

interface StandardUrl {
  readonly hash: string;
  readonly origin: string;
  readonly password: string;
  readonly pathname: string;
  readonly search: string;
  readonly username: string;
  toString(): string;
}

const StandardUrlConstructor = (
  globalThis as unknown as { readonly URL: new (value: string) => StandardUrl }
).URL;

export const KEMERBET_ENROLLMENT_ADAPTER_MANIFEST = parseAgentPlatformAdapterManifest({
  schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
  adapterKind: 'enrollment',
  platformCode: KEMERBET_PLATFORM_CODE,
  displayName: 'KemerBet',
  adapterVersion: KEMERBET_ENROLLMENT_ADAPTER_VERSION,
  adapterDigest: KEMERBET_ENROLLMENT_ADAPTER_DIGEST,
  credentialInputUrls: [KEMERBET_AGENT_LOGIN_URL, KEMERBET_AGENT_LOGIN_RETRY_URL],
  authenticatedCandidateUrls: [KEMERBET_AGENT_AUTHENTICATED_CANDIDATE_URL],
  allowedWebOrigins: [KEMERBET_AGENT_WEB_ORIGIN],
  capabilityPolicy: ENROLLMENT_ONLY_CAPABILITY_POLICY,
  requiredExternalBrokerSessionPolicy: {
    maxLoginLifetimeSeconds: KEMERBET_MAX_LOGIN_LIFETIME_SECONDS,
    maxAuthenticatedLifetimeSeconds: KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS,
    maxGenerationLifetimeSeconds: KEMERBET_MAX_GENERATION_LIFETIME_SECONDS,
  },
});

export const KEMERBET_SESSION_POLICY = parseAgentPlatformSessionPolicy({
  schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
  platformCode: KEMERBET_PLATFORM_CODE,
  adapterVersion: KEMERBET_ENROLLMENT_ADAPTER_VERSION,
  adapterDigest: KEMERBET_ENROLLMENT_ADAPTER_DIGEST,
  maxLoginLifetimeSeconds: KEMERBET_MAX_LOGIN_LIFETIME_SECONDS,
  maxAuthenticatedLifetimeSeconds: KEMERBET_MAX_AUTHENTICATED_LIFETIME_SECONDS,
  maxGenerationLifetimeSeconds: KEMERBET_MAX_GENERATION_LIFETIME_SECONDS,
});

function classification(
  kind: AgentPlatformPageClassification['kind'],
  reason: string,
  canonicalUrl: string | null,
): AgentPlatformPageClassification {
  return Object.freeze({
    kind,
    reason,
    canonicalUrl,
    credentialInputAllowed: kind === 'login',
    accountMutationAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    transferDisabled: true,
  });
}

/**
 * Mirrors the current KemerBet sign-in helper's exact main-page allowlist.
 * Matching `/agents` is only a URL candidate; it never proves authentication.
 */
export function classifyKemerBetEnrollmentPage(rawUrl: string): AgentPlatformPageClassification {
  let url: StandardUrl;
  try {
    url = new StandardUrlConstructor(rawUrl);
  } catch {
    return classification('unsupported', 'invalid_url', null);
  }

  if (url.origin !== KEMERBET_AGENT_WEB_ORIGIN) {
    return classification('unsupported', 'disallowed_origin', null);
  }
  if (url.username !== '' || url.password !== '') {
    return classification('unsupported', 'embedded_credentials', null);
  }
  if (url.hash !== '') {
    return classification('unsupported', 'fragment_not_allowed', null);
  }
  if (rawUrl.includes('#')) {
    return classification('unsupported', 'fragment_not_allowed', null);
  }
  if (rawUrl !== url.toString()) {
    return classification('unsupported', 'non_canonical_url', null);
  }
  if (KEMERBET_ENROLLMENT_ADAPTER_MANIFEST.credentialInputUrls.includes(rawUrl)) {
    return classification('login', 'login_page', rawUrl);
  }
  if (KEMERBET_ENROLLMENT_ADAPTER_MANIFEST.authenticatedCandidateUrls.includes(rawUrl)) {
    return classification('authenticated_candidate', 'authenticated_page_candidate', rawUrl);
  }

  return classification('unsupported', 'unsupported_route', null);
}

export const kemerBetEnrollmentAdapter = defineAgentPlatformEnrollmentAdapter({
  manifest: KEMERBET_ENROLLMENT_ADAPTER_MANIFEST,
  classifyPage: classifyKemerBetEnrollmentPage,
});

export function parseKemerBetSessionGeneration(value: unknown): AgentSessionGeneration {
  return parseAgentSessionGenerationForManifest(
    value,
    KEMERBET_ENROLLMENT_ADAPTER_MANIFEST,
    KEMERBET_SESSION_POLICY,
  );
}
