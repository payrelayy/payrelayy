export const AGENT_PLATFORM_CONTRACT_VERSION = 1 as const;

export const AGENT_SESSION_STATES = [
  'sealed',
  'starting',
  'login_required',
  'authenticating',
  'authenticated_locked',
  'ready',
  'degraded',
  'closing',
  'closed',
] as const;

export type AgentSessionState = (typeof AGENT_SESSION_STATES)[number];

export const AGENT_PLATFORM_PAGE_KINDS = [
  'login',
  'authenticated_candidate',
  'unsupported',
] as const;

export type AgentPlatformPageKind = (typeof AGENT_PLATFORM_PAGE_KINDS)[number];

export interface AgentPlatformEnrollmentCapabilityPolicy {
  readonly providedCapability: 'page_classification_only';
  readonly credentialInputDecision: 'exact_manifest_url_only';
  readonly pageClassification: 'pure_declarative_url_rules';
  readonly profilePersistence: 'not_provided';
  readonly profilePersistenceAuthority: 'external_broker';
  readonly authenticationAttestation: 'not_provided';
  readonly authenticationAttestationAuthority: 'external_broker';
  readonly accountLookupAllowed: false;
  readonly accountMutationAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly transferAllowed: false;
}

export interface AgentPlatformSessionLifetimePolicy {
  readonly maxLoginLifetimeSeconds: number;
  readonly maxAuthenticatedLifetimeSeconds: number;
  readonly maxGenerationLifetimeSeconds: number;
}

export interface AgentPlatformAdapterManifest {
  readonly schemaVersion: typeof AGENT_PLATFORM_CONTRACT_VERSION;
  readonly adapterKind: 'enrollment';
  readonly platformCode: string;
  readonly displayName: string;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  readonly credentialInputUrls: readonly string[];
  readonly authenticatedCandidateUrls: readonly string[];
  readonly allowedWebOrigins: readonly string[];
  readonly capabilityPolicy: AgentPlatformEnrollmentCapabilityPolicy;
  readonly requiredExternalBrokerSessionPolicy: AgentPlatformSessionLifetimePolicy;
}

export interface AgentPlatformSessionPolicy {
  readonly schemaVersion: typeof AGENT_PLATFORM_CONTRACT_VERSION;
  readonly platformCode: string;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  readonly maxLoginLifetimeSeconds: number;
  readonly maxAuthenticatedLifetimeSeconds: number;
  readonly maxGenerationLifetimeSeconds: number;
}

/**
 * An immutable binding issued by the external session broker after it has
 * persisted one encrypted browser-profile revision. This syntax parser does
 * not provide or attest encryption. The object carries digests and ownership
 * identifiers, never profile bytes, cookies, credentials, or bearer tokens.
 */
export interface AgentSessionGeneration {
  readonly schemaVersion: typeof AGENT_PLATFORM_CONTRACT_VERSION;
  readonly generationId: string;
  readonly platformCode: string;
  readonly platformAgentAccountId: string;
  readonly profileRevision: number;
  readonly encryptedProfileDigest: string;
  readonly profileEncryptionKeyRevision: number;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  readonly createdAt: string;
  readonly absoluteExpiresAt: string;
}

/**
 * A proof produced by an out-of-process runtime probe. A URL match alone must
 * never be used to construct this proof.
 */
export interface AgentSessionAuthenticationProof {
  readonly schemaVersion: typeof AGENT_PLATFORM_CONTRACT_VERSION;
  readonly generationId: string;
  readonly platformAgentAccountId: string;
  readonly identityProbeDigest: string;
  readonly sessionProbeDigest: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly credentialInputLocked: true;
  readonly financialActionAllowed: false;
  readonly transferDisabled: true;
}

export interface AgentSessionSnapshot {
  readonly schemaVersion: typeof AGENT_PLATFORM_CONTRACT_VERSION;
  readonly generation: AgentSessionGeneration;
  readonly state: AgentSessionState;
  readonly stateRevision: number;
  readonly observedAt: string;
  readonly firstAuthenticatedAt: string | null;
  readonly authenticatedDeadline: string | null;
  readonly credentialInputAllowed: boolean;
  readonly accountMutationAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly transferDisabled: true;
  readonly authenticationProof: AgentSessionAuthenticationProof | null;
}

/**
 * `authenticated_candidate` means only that the URL matches the adapter's
 * post-login page. Consumers must obtain an AgentSessionAuthenticationProof
 * before transitioning to `authenticated_locked` or `ready`.
 */
export interface AgentPlatformPageClassification {
  readonly kind: AgentPlatformPageKind;
  readonly reason: string;
  readonly canonicalUrl: string | null;
  readonly credentialInputAllowed: boolean;
  readonly accountMutationAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly transferDisabled: true;
}

export interface AgentPlatformEnrollmentAdapter {
  readonly manifest: AgentPlatformAdapterManifest;
  readonly classifyPage: (rawUrl: string) => AgentPlatformPageClassification;
}

interface StandardUrl {
  readonly hash: string;
  readonly origin: string;
  readonly password: string;
  readonly pathname: string;
  readonly protocol: string;
  readonly search: string;
  readonly username: string;
  toString(): string;
}

const StandardUrlConstructor = (
  globalThis as unknown as { readonly URL: new (value: string) => StandardUrl }
).URL;

const enrollmentCapabilityPolicy: AgentPlatformEnrollmentCapabilityPolicy = Object.freeze({
  providedCapability: 'page_classification_only',
  credentialInputDecision: 'exact_manifest_url_only',
  pageClassification: 'pure_declarative_url_rules',
  profilePersistence: 'not_provided',
  profilePersistenceAuthority: 'external_broker',
  authenticationAttestation: 'not_provided',
  authenticationAttestationAuthority: 'external_broker',
  accountLookupAllowed: false,
  accountMutationAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
  transferAllowed: false,
});

export const ENROLLMENT_ONLY_CAPABILITY_POLICY = enrollmentCapabilityPolicy;

const transitions: Readonly<Record<AgentSessionState, ReadonlySet<AgentSessionState>>> = {
  sealed: new Set(['starting', 'closing']),
  starting: new Set(['login_required', 'authenticated_locked', 'degraded', 'closing']),
  login_required: new Set(['authenticating', 'degraded', 'closing']),
  authenticating: new Set(['login_required', 'authenticated_locked', 'degraded', 'closing']),
  authenticated_locked: new Set(['ready', 'degraded', 'closing']),
  ready: new Set(['degraded', 'closing']),
  degraded: new Set(['starting', 'closing']),
  closing: new Set(['closed']),
  closed: new Set(),
};

const manifestKeys = [
  'schemaVersion',
  'adapterKind',
  'platformCode',
  'displayName',
  'adapterVersion',
  'adapterDigest',
  'credentialInputUrls',
  'authenticatedCandidateUrls',
  'allowedWebOrigins',
  'capabilityPolicy',
  'requiredExternalBrokerSessionPolicy',
] as const;

const capabilityKeys = [
  'providedCapability',
  'credentialInputDecision',
  'pageClassification',
  'profilePersistence',
  'profilePersistenceAuthority',
  'authenticationAttestation',
  'authenticationAttestationAuthority',
  'accountLookupAllowed',
  'accountMutationAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'transferAllowed',
] as const;

const sessionPolicyKeys = [
  'schemaVersion',
  'platformCode',
  'adapterVersion',
  'adapterDigest',
  'maxLoginLifetimeSeconds',
  'maxAuthenticatedLifetimeSeconds',
  'maxGenerationLifetimeSeconds',
] as const;

const sessionLifetimePolicyKeys = [
  'maxLoginLifetimeSeconds',
  'maxAuthenticatedLifetimeSeconds',
  'maxGenerationLifetimeSeconds',
] as const;

const generationKeys = [
  'schemaVersion',
  'generationId',
  'platformCode',
  'platformAgentAccountId',
  'profileRevision',
  'encryptedProfileDigest',
  'profileEncryptionKeyRevision',
  'adapterVersion',
  'adapterDigest',
  'createdAt',
  'absoluteExpiresAt',
] as const;

const proofKeys = [
  'schemaVersion',
  'generationId',
  'platformAgentAccountId',
  'identityProbeDigest',
  'sessionProbeDigest',
  'verifiedAt',
  'expiresAt',
  'credentialInputLocked',
  'financialActionAllowed',
  'transferDisabled',
] as const;

const snapshotKeys = [
  'schemaVersion',
  'generation',
  'state',
  'stateRevision',
  'observedAt',
  'firstAuthenticatedAt',
  'authenticatedDeadline',
  'credentialInputAllowed',
  'accountMutationAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'transferDisabled',
  'authenticationProof',
] as const;

const classificationKeys = [
  'kind',
  'reason',
  'canonicalUrl',
  'credentialInputAllowed',
  'accountMutationAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'transferDisabled',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PLATFORM_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function requireString(value: unknown, label: string, pattern?: Readonly<RegExp>): string {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new TypeError(`${label} is invalid`);
  }

  return value;
}

function requireInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${label} must be an integer greater than or equal to ${minimum}`);
  }

  return value as number;
}

function requireBooleanLiteral<T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new TypeError(`${label} must be ${String(expected)}`);
  }

  return expected;
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }

  return timestamp;
}

function requireHttpsUrl(value: unknown, label: string): string {
  const rawUrl = requireString(value, label);
  let url: StandardUrl;
  try {
    url = new StandardUrlConstructor(rawUrl);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    rawUrl.includes('#') ||
    url.toString() !== rawUrl
  ) {
    throw new TypeError(`${label} must be a canonical credential-free HTTPS URL`);
  }

  return rawUrl;
}

function requireHttpsOrigin(value: unknown, label: string): string {
  const origin = requireString(value, label);
  let url: StandardUrl;
  try {
    url = new StandardUrlConstructor(origin);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.origin !== origin ||
    url.pathname !== '/' ||
    url.search !== ''
  ) {
    throw new TypeError(`${label} must be a canonical HTTPS origin`);
  }

  return origin;
}

function parseCapabilityPolicy(value: unknown): AgentPlatformEnrollmentCapabilityPolicy {
  const record = asRecord(value, 'capabilityPolicy');
  assertExactKeys(record, capabilityKeys, 'capabilityPolicy');
  if (
    record.providedCapability !== 'page_classification_only' ||
    record.credentialInputDecision !== 'exact_manifest_url_only' ||
    record.pageClassification !== 'pure_declarative_url_rules' ||
    record.profilePersistence !== 'not_provided' ||
    record.profilePersistenceAuthority !== 'external_broker' ||
    record.authenticationAttestation !== 'not_provided' ||
    record.authenticationAttestationAuthority !== 'external_broker'
  ) {
    throw new TypeError('capabilityPolicy has an unsupported enrollment mode');
  }
  requireBooleanLiteral(record.accountLookupAllowed, false, 'accountLookupAllowed');
  requireBooleanLiteral(record.accountMutationAllowed, false, 'accountMutationAllowed');
  requireBooleanLiteral(record.executionAllowed, false, 'executionAllowed');
  requireBooleanLiteral(record.financialActionAllowed, false, 'financialActionAllowed');
  requireBooleanLiteral(record.transferAllowed, false, 'transferAllowed');

  return enrollmentCapabilityPolicy;
}

function parseExactUrlArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const urls = value.map((url, index) => requireHttpsUrl(url, `${label}[${String(index)}]`));
  const sortedUrls = [...urls].sort();
  if (new Set(urls).size !== urls.length || urls.some((url, index) => url !== sortedUrls[index])) {
    throw new TypeError(`${label} must be unique and sorted`);
  }

  return Object.freeze(urls);
}

function parseSessionLifetimePolicy(
  value: unknown,
  label: string,
): AgentPlatformSessionLifetimePolicy {
  const record = asRecord(value, label);
  assertExactKeys(record, sessionLifetimePolicyKeys, label);
  const maxLoginLifetimeSeconds = requireInteger(
    record.maxLoginLifetimeSeconds,
    `${label}.maxLoginLifetimeSeconds`,
    1,
  );
  const maxAuthenticatedLifetimeSeconds = requireInteger(
    record.maxAuthenticatedLifetimeSeconds,
    `${label}.maxAuthenticatedLifetimeSeconds`,
    1,
  );
  const maxGenerationLifetimeSeconds = requireInteger(
    record.maxGenerationLifetimeSeconds,
    `${label}.maxGenerationLifetimeSeconds`,
    1,
  );
  if (maxGenerationLifetimeSeconds !== maxLoginLifetimeSeconds + maxAuthenticatedLifetimeSeconds) {
    throw new TypeError(
      `${label}.maxGenerationLifetimeSeconds must equal login plus authenticated lifetime`,
    );
  }

  return Object.freeze({
    maxLoginLifetimeSeconds,
    maxAuthenticatedLifetimeSeconds,
    maxGenerationLifetimeSeconds,
  });
}

export function parseAgentPlatformAdapterManifest(value: unknown): AgentPlatformAdapterManifest {
  const record = asRecord(value, 'adapter manifest');
  assertExactKeys(record, manifestKeys, 'adapter manifest');
  if (record.schemaVersion !== AGENT_PLATFORM_CONTRACT_VERSION) {
    throw new TypeError('adapter manifest schemaVersion is unsupported');
  }
  if (record.adapterKind !== 'enrollment') {
    throw new TypeError('adapterKind must be enrollment');
  }

  const platformCode = requireString(record.platformCode, 'platformCode', PLATFORM_CODE_PATTERN);
  const displayName = requireString(record.displayName, 'displayName');
  if (displayName.length > 128) {
    throw new TypeError('displayName is too long');
  }
  const adapterVersion = requireString(record.adapterVersion, 'adapterVersion', VERSION_PATTERN);
  const adapterDigest = requireString(record.adapterDigest, 'adapterDigest', SHA256_PATTERN);
  const credentialInputUrls = parseExactUrlArray(record.credentialInputUrls, 'credentialInputUrls');
  const authenticatedCandidateUrls = parseExactUrlArray(
    record.authenticatedCandidateUrls,
    'authenticatedCandidateUrls',
  );
  if (!Array.isArray(record.allowedWebOrigins) || record.allowedWebOrigins.length === 0) {
    throw new TypeError('allowedWebOrigins must be a non-empty array');
  }
  const allowedWebOrigins = record.allowedWebOrigins.map((origin, index) =>
    requireHttpsOrigin(origin, `allowedWebOrigins[${String(index)}]`),
  );
  const sortedOrigins = [...allowedWebOrigins].sort();
  if (
    new Set(allowedWebOrigins).size !== allowedWebOrigins.length ||
    allowedWebOrigins.some((origin, index) => origin !== sortedOrigins[index])
  ) {
    throw new TypeError('allowedWebOrigins must be unique and sorted');
  }
  const declaredUrls = [...credentialInputUrls, ...authenticatedCandidateUrls];
  if (new Set(declaredUrls).size !== declaredUrls.length) {
    throw new TypeError('credential and authenticated-candidate URLs must not overlap');
  }
  if (
    declaredUrls.some((url) => !allowedWebOrigins.includes(new StandardUrlConstructor(url).origin))
  ) {
    throw new TypeError('every declared page URL origin must be allowed');
  }

  return Object.freeze({
    schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
    adapterKind: 'enrollment',
    platformCode,
    displayName,
    adapterVersion,
    adapterDigest,
    credentialInputUrls,
    authenticatedCandidateUrls,
    allowedWebOrigins: Object.freeze(allowedWebOrigins),
    capabilityPolicy: parseCapabilityPolicy(record.capabilityPolicy),
    requiredExternalBrokerSessionPolicy: parseSessionLifetimePolicy(
      record.requiredExternalBrokerSessionPolicy,
      'requiredExternalBrokerSessionPolicy',
    ),
  });
}

export function canonicalizeAgentPlatformAdapterManifest(
  manifest: AgentPlatformAdapterManifest,
): string {
  const parsed = parseAgentPlatformAdapterManifest(manifest);
  return JSON.stringify({
    schemaVersion: parsed.schemaVersion,
    adapterKind: parsed.adapterKind,
    platformCode: parsed.platformCode,
    displayName: parsed.displayName,
    adapterVersion: parsed.adapterVersion,
    credentialInputUrls: parsed.credentialInputUrls,
    authenticatedCandidateUrls: parsed.authenticatedCandidateUrls,
    allowedWebOrigins: parsed.allowedWebOrigins,
    capabilityPolicy: parsed.capabilityPolicy,
    requiredExternalBrokerSessionPolicy: parsed.requiredExternalBrokerSessionPolicy,
  });
}

export function parseAgentSessionGeneration(value: unknown): AgentSessionGeneration {
  const record = asRecord(value, 'session generation');
  assertExactKeys(record, generationKeys, 'session generation');
  if (record.schemaVersion !== AGENT_PLATFORM_CONTRACT_VERSION) {
    throw new TypeError('session generation schemaVersion is unsupported');
  }

  const generationId = requireString(record.generationId, 'generationId', UUID_PATTERN);
  const platformCode = requireString(record.platformCode, 'platformCode', PLATFORM_CODE_PATTERN);
  const platformAgentAccountId = requireString(
    record.platformAgentAccountId,
    'platformAgentAccountId',
    UUID_PATTERN,
  );
  const profileRevision = requireInteger(record.profileRevision, 'profileRevision', 1);
  const encryptedProfileDigest = requireString(
    record.encryptedProfileDigest,
    'encryptedProfileDigest',
    SHA256_PATTERN,
  );
  const profileEncryptionKeyRevision = requireInteger(
    record.profileEncryptionKeyRevision,
    'profileEncryptionKeyRevision',
    1,
  );
  const adapterVersion = requireString(record.adapterVersion, 'adapterVersion', VERSION_PATTERN);
  const adapterDigest = requireString(record.adapterDigest, 'adapterDigest', SHA256_PATTERN);
  const createdAt = requireCanonicalTimestamp(record.createdAt, 'createdAt');
  const absoluteExpiresAt = requireCanonicalTimestamp(
    record.absoluteExpiresAt,
    'absoluteExpiresAt',
  );
  if (Date.parse(absoluteExpiresAt) <= Date.parse(createdAt)) {
    throw new TypeError('absoluteExpiresAt must be later than createdAt');
  }

  return Object.freeze({
    schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
    generationId,
    platformCode,
    platformAgentAccountId,
    profileRevision,
    encryptedProfileDigest,
    profileEncryptionKeyRevision,
    adapterVersion,
    adapterDigest,
    createdAt,
    absoluteExpiresAt,
  });
}

export function parseAgentPlatformSessionPolicy(value: unknown): AgentPlatformSessionPolicy {
  const record = asRecord(value, 'session policy');
  assertExactKeys(record, sessionPolicyKeys, 'session policy');
  if (record.schemaVersion !== AGENT_PLATFORM_CONTRACT_VERSION) {
    throw new TypeError('session policy schemaVersion is unsupported');
  }

  const lifetimePolicy = parseSessionLifetimePolicy(
    {
      maxLoginLifetimeSeconds: record.maxLoginLifetimeSeconds,
      maxAuthenticatedLifetimeSeconds: record.maxAuthenticatedLifetimeSeconds,
      maxGenerationLifetimeSeconds: record.maxGenerationLifetimeSeconds,
    },
    'session policy',
  );
  return Object.freeze({
    schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
    platformCode: requireString(record.platformCode, 'platformCode', PLATFORM_CODE_PATTERN),
    adapterVersion: requireString(record.adapterVersion, 'adapterVersion', VERSION_PATTERN),
    adapterDigest: requireString(record.adapterDigest, 'adapterDigest', SHA256_PATTERN),
    ...lifetimePolicy,
  });
}

export function parseAgentSessionGenerationForManifest(
  value: unknown,
  manifestValue: unknown,
  sessionPolicyValue: unknown,
): AgentSessionGeneration {
  const generation = parseAgentSessionGeneration(value);
  const manifest = parseAgentPlatformAdapterManifest(manifestValue);
  const sessionPolicy = parseAgentPlatformSessionPolicy(sessionPolicyValue);
  if (
    sessionPolicy.platformCode !== manifest.platformCode ||
    sessionPolicy.adapterVersion !== manifest.adapterVersion ||
    sessionPolicy.adapterDigest !== manifest.adapterDigest ||
    sessionPolicy.maxLoginLifetimeSeconds !==
      manifest.requiredExternalBrokerSessionPolicy.maxLoginLifetimeSeconds ||
    sessionPolicy.maxAuthenticatedLifetimeSeconds !==
      manifest.requiredExternalBrokerSessionPolicy.maxAuthenticatedLifetimeSeconds ||
    sessionPolicy.maxGenerationLifetimeSeconds !==
      manifest.requiredExternalBrokerSessionPolicy.maxGenerationLifetimeSeconds
  ) {
    throw new TypeError('session policy does not match the adapter manifest');
  }
  if (
    generation.platformCode !== manifest.platformCode ||
    generation.adapterVersion !== manifest.adapterVersion ||
    generation.adapterDigest !== manifest.adapterDigest
  ) {
    throw new TypeError('session generation does not match the adapter manifest');
  }

  const lifetimeMilliseconds =
    Date.parse(generation.absoluteExpiresAt) - Date.parse(generation.createdAt);
  if (lifetimeMilliseconds > sessionPolicy.maxGenerationLifetimeSeconds * 1_000) {
    throw new TypeError('session generation exceeds its maximum lifetime');
  }

  return generation;
}

export function parseAgentSessionAuthenticationProof(
  value: unknown,
): AgentSessionAuthenticationProof {
  const record = asRecord(value, 'authentication proof');
  assertExactKeys(record, proofKeys, 'authentication proof');
  if (record.schemaVersion !== AGENT_PLATFORM_CONTRACT_VERSION) {
    throw new TypeError('authentication proof schemaVersion is unsupported');
  }

  const generationId = requireString(record.generationId, 'generationId', UUID_PATTERN);
  const platformAgentAccountId = requireString(
    record.platformAgentAccountId,
    'platformAgentAccountId',
    UUID_PATTERN,
  );
  const identityProbeDigest = requireString(
    record.identityProbeDigest,
    'identityProbeDigest',
    SHA256_PATTERN,
  );
  const sessionProbeDigest = requireString(
    record.sessionProbeDigest,
    'sessionProbeDigest',
    SHA256_PATTERN,
  );
  const verifiedAt = requireCanonicalTimestamp(record.verifiedAt, 'verifiedAt');
  const expiresAt = requireCanonicalTimestamp(record.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(verifiedAt)) {
    throw new TypeError('authentication proof expiresAt must be later than verifiedAt');
  }
  requireBooleanLiteral(record.credentialInputLocked, true, 'credentialInputLocked');
  requireBooleanLiteral(record.financialActionAllowed, false, 'financialActionAllowed');
  requireBooleanLiteral(record.transferDisabled, true, 'transferDisabled');

  return Object.freeze({
    schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
    generationId,
    platformAgentAccountId,
    identityProbeDigest,
    sessionProbeDigest,
    verifiedAt,
    expiresAt,
    credentialInputLocked: true,
    financialActionAllowed: false,
    transferDisabled: true,
  });
}

export function canTransitionAgentSession(from: AgentSessionState, to: AgentSessionState): boolean {
  return transitions[from].has(to);
}

export function assertAgentSessionTransition(from: AgentSessionState, to: AgentSessionState): void {
  if (!canTransitionAgentSession(from, to)) {
    throw new TypeError(`agent session cannot transition from ${from} to ${to}`);
  }
}

export function parseAgentSessionSnapshot(value: unknown): AgentSessionSnapshot {
  const record = asRecord(value, 'session snapshot');
  assertExactKeys(record, snapshotKeys, 'session snapshot');
  if (record.schemaVersion !== AGENT_PLATFORM_CONTRACT_VERSION) {
    throw new TypeError('session snapshot schemaVersion is unsupported');
  }

  const generation = parseAgentSessionGeneration(record.generation);
  if (
    typeof record.state !== 'string' ||
    !AGENT_SESSION_STATES.includes(record.state as AgentSessionState)
  ) {
    throw new TypeError('session snapshot state is invalid');
  }
  const state = record.state as AgentSessionState;
  const stateRevision = requireInteger(record.stateRevision, 'stateRevision', 0);
  const observedAt = requireCanonicalTimestamp(record.observedAt, 'observedAt');
  const observedTime = Date.parse(observedAt);
  const generationCreatedTime = Date.parse(generation.createdAt);
  const generationExpiryTime = Date.parse(generation.absoluteExpiresAt);
  if (observedTime < generationCreatedTime) {
    throw new TypeError('observedAt cannot predate the generation');
  }
  if (observedTime >= generationExpiryTime && state !== 'closing' && state !== 'closed') {
    throw new TypeError('only closing or closed may be observed at or after generation expiry');
  }

  const firstAuthenticatedAt =
    record.firstAuthenticatedAt === null
      ? null
      : requireCanonicalTimestamp(record.firstAuthenticatedAt, 'firstAuthenticatedAt');
  const authenticatedDeadline =
    record.authenticatedDeadline === null
      ? null
      : requireCanonicalTimestamp(record.authenticatedDeadline, 'authenticatedDeadline');
  if ((firstAuthenticatedAt === null) !== (authenticatedDeadline === null)) {
    throw new TypeError(
      'firstAuthenticatedAt and authenticatedDeadline must both be null or both be set',
    );
  }
  if (firstAuthenticatedAt !== null && authenticatedDeadline !== null) {
    const firstAuthenticatedTime = Date.parse(firstAuthenticatedAt);
    const authenticatedDeadlineTime = Date.parse(authenticatedDeadline);
    if (
      firstAuthenticatedTime < generationCreatedTime ||
      firstAuthenticatedTime > observedTime ||
      firstAuthenticatedTime >= generationExpiryTime
    ) {
      throw new TypeError('firstAuthenticatedAt is outside the generation observation window');
    }
    if (
      authenticatedDeadlineTime <= firstAuthenticatedTime ||
      authenticatedDeadlineTime > generationExpiryTime
    ) {
      throw new TypeError('authenticatedDeadline is outside the generation lifetime');
    }
    if (observedTime >= authenticatedDeadlineTime && state !== 'closing' && state !== 'closed') {
      throw new TypeError(
        'only closing or closed may be observed at or after authenticated deadline',
      );
    }
  }
  if (state === 'sealed' && firstAuthenticatedAt !== null) {
    throw new TypeError('sealed session snapshot cannot have an authenticated lifetime binding');
  }

  const credentialInputAllowed = state === 'login_required';
  requireBooleanLiteral(
    record.credentialInputAllowed,
    credentialInputAllowed,
    'credentialInputAllowed',
  );
  requireBooleanLiteral(record.accountMutationAllowed, false, 'accountMutationAllowed');
  requireBooleanLiteral(record.executionAllowed, false, 'executionAllowed');
  requireBooleanLiteral(record.financialActionAllowed, false, 'financialActionAllowed');
  requireBooleanLiteral(record.transferDisabled, true, 'transferDisabled');

  const proof =
    record.authenticationProof === null
      ? null
      : parseAgentSessionAuthenticationProof(record.authenticationProof);
  const proofRequired = state === 'authenticated_locked' || state === 'ready';
  if (proofRequired !== (proof !== null)) {
    throw new TypeError(
      'authenticationProof is required only for authenticated_locked and ready states',
    );
  }
  if (proof) {
    if (firstAuthenticatedAt === null || authenticatedDeadline === null) {
      throw new TypeError('authenticationProof requires an authenticated lifetime binding');
    }
    if (
      proof.generationId !== generation.generationId ||
      proof.platformAgentAccountId !== generation.platformAgentAccountId
    ) {
      throw new TypeError('authenticationProof ownership does not match the generation');
    }
    if (
      Date.parse(proof.verifiedAt) < Date.parse(firstAuthenticatedAt) ||
      Date.parse(proof.verifiedAt) > observedTime ||
      Date.parse(proof.expiresAt) <= observedTime ||
      Date.parse(proof.expiresAt) > Date.parse(authenticatedDeadline)
    ) {
      throw new TypeError('authenticationProof is not valid at observedAt');
    }
  }

  return Object.freeze({
    schemaVersion: AGENT_PLATFORM_CONTRACT_VERSION,
    generation,
    state,
    stateRevision,
    observedAt,
    firstAuthenticatedAt,
    authenticatedDeadline,
    credentialInputAllowed,
    accountMutationAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    transferDisabled: true,
    authenticationProof: proof,
  });
}

/**
 * Validates a snapshot against the exact adapter manifest and external broker
 * policy. In addition to structural proof validation, this derives the login
 * and authenticated deadlines so a broker cannot extend either lease by
 * emitting a later proof.
 */
export function parseAgentSessionSnapshotForManifest(
  value: unknown,
  manifestValue: unknown,
  sessionPolicyValue: unknown,
): AgentSessionSnapshot {
  const snapshot = parseAgentSessionSnapshot(value);
  parseAgentSessionGenerationForManifest(snapshot.generation, manifestValue, sessionPolicyValue);
  const sessionPolicy = parseAgentPlatformSessionPolicy(sessionPolicyValue);
  const generationCreatedTime = Date.parse(snapshot.generation.createdAt);
  const generationExpiryTime = Date.parse(snapshot.generation.absoluteExpiresAt);
  const loginDeadlineTime = Math.min(
    generationCreatedTime + sessionPolicy.maxLoginLifetimeSeconds * 1_000,
    generationExpiryTime,
  );
  const cleanupOnly = snapshot.state === 'closing' || snapshot.state === 'closed';

  if (snapshot.firstAuthenticatedAt === null) {
    if (Date.parse(snapshot.observedAt) >= loginDeadlineTime && !cleanupOnly) {
      throw new TypeError('only closing or closed may be observed at or after login deadline');
    }
    return snapshot;
  }

  const firstAuthenticatedTime = Date.parse(snapshot.firstAuthenticatedAt);
  if (firstAuthenticatedTime >= loginDeadlineTime) {
    throw new TypeError('firstAuthenticatedAt must precede the login deadline');
  }
  const expectedAuthenticatedDeadline = new Date(
    Math.min(
      firstAuthenticatedTime + sessionPolicy.maxAuthenticatedLifetimeSeconds * 1_000,
      generationExpiryTime,
    ),
  ).toISOString();
  if (snapshot.authenticatedDeadline !== expectedAuthenticatedDeadline) {
    throw new TypeError('authenticatedDeadline does not match the immutable session policy');
  }

  return snapshot;
}

export function parseInitialAgentSessionSnapshot(value: unknown): AgentSessionSnapshot {
  const snapshot = parseAgentSessionSnapshot(value);
  if (
    snapshot.state !== 'sealed' ||
    snapshot.stateRevision !== 0 ||
    snapshot.observedAt !== snapshot.generation.createdAt ||
    snapshot.firstAuthenticatedAt !== null ||
    snapshot.authenticatedDeadline !== null ||
    snapshot.credentialInputAllowed ||
    snapshot.authenticationProof !== null
  ) {
    throw new TypeError(
      'initial session snapshot must be sealed revision zero at generation creation',
    );
  }

  return snapshot;
}

/**
 * Validates one compare-and-swap state advance. Session observations that do
 * not change state are not advances and must not increment stateRevision.
 */
function assertParsedAgentSessionSnapshotAdvance(
  previous: AgentSessionSnapshot,
  next: AgentSessionSnapshot,
): void {
  if (JSON.stringify(previous.generation) !== JSON.stringify(next.generation)) {
    throw new TypeError('session advance cannot change its immutable generation');
  }
  if (next.stateRevision !== previous.stateRevision + 1) {
    throw new TypeError('session advance stateRevision must increment by exactly one');
  }
  if (Date.parse(next.observedAt) <= Date.parse(previous.observedAt)) {
    throw new TypeError('session advance observedAt must increase');
  }
  assertAgentSessionTransition(previous.state, next.state);
  if (previous.firstAuthenticatedAt === null) {
    if (
      next.firstAuthenticatedAt !== null &&
      (next.state !== 'authenticated_locked' ||
        next.authenticationProof === null ||
        next.firstAuthenticatedAt !== next.authenticationProof.verifiedAt)
    ) {
      throw new TypeError(
        'first authenticated lifetime binding must be assigned once by its first proof',
      );
    }
  } else if (
    next.firstAuthenticatedAt !== previous.firstAuthenticatedAt ||
    next.authenticatedDeadline !== previous.authenticatedDeadline
  ) {
    throw new TypeError('session advance cannot change its authenticated lifetime binding');
  }
}

export function assertAgentSessionSnapshotAdvance(
  previousValue: unknown,
  nextValue: unknown,
): void {
  assertParsedAgentSessionSnapshotAdvance(
    parseAgentSessionSnapshot(previousValue),
    parseAgentSessionSnapshot(nextValue),
  );
}

/**
 * Validates an exact compare-and-swap advance under the same manifest-bound
 * broker policy on both sides of the transition.
 */
export function assertAgentSessionSnapshotAdvanceForManifest(
  previousValue: unknown,
  nextValue: unknown,
  manifestValue: unknown,
  sessionPolicyValue: unknown,
): void {
  assertParsedAgentSessionSnapshotAdvance(
    parseAgentSessionSnapshotForManifest(previousValue, manifestValue, sessionPolicyValue),
    parseAgentSessionSnapshotForManifest(nextValue, manifestValue, sessionPolicyValue),
  );
}

export function parseAgentPlatformPageClassification(
  value: unknown,
): AgentPlatformPageClassification {
  const record = asRecord(value, 'page classification');
  assertExactKeys(record, classificationKeys, 'page classification');
  if (
    typeof record.kind !== 'string' ||
    !AGENT_PLATFORM_PAGE_KINDS.includes(record.kind as AgentPlatformPageKind)
  ) {
    throw new TypeError('page classification kind is invalid');
  }
  const kind = record.kind as AgentPlatformPageKind;
  const reason = requireString(record.reason, 'reason', REASON_PATTERN);
  const canonicalUrl =
    record.canonicalUrl === null ? null : requireHttpsUrl(record.canonicalUrl, 'canonicalUrl');
  if (kind !== 'unsupported' && canonicalUrl === null) {
    throw new TypeError('supported page classifications require canonicalUrl');
  }
  const credentialInputAllowed = kind === 'login';
  requireBooleanLiteral(
    record.credentialInputAllowed,
    credentialInputAllowed,
    'credentialInputAllowed',
  );
  requireBooleanLiteral(record.accountMutationAllowed, false, 'accountMutationAllowed');
  requireBooleanLiteral(record.executionAllowed, false, 'executionAllowed');
  requireBooleanLiteral(record.financialActionAllowed, false, 'financialActionAllowed');
  requireBooleanLiteral(record.transferDisabled, true, 'transferDisabled');

  return Object.freeze({
    kind,
    reason,
    canonicalUrl,
    credentialInputAllowed,
    accountMutationAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    transferDisabled: true,
  });
}

export function defineAgentPlatformEnrollmentAdapter(
  value: AgentPlatformEnrollmentAdapter,
): AgentPlatformEnrollmentAdapter {
  const record = asRecord(value, 'enrollment adapter');
  assertExactKeys(record, ['manifest', 'classifyPage'], 'enrollment adapter');
  if (typeof record.classifyPage !== 'function') {
    throw new TypeError('enrollment adapter classifyPage must be a function');
  }

  const manifest = parseAgentPlatformAdapterManifest(record.manifest);
  const classifyPage = record.classifyPage as (rawUrl: string) => unknown;
  return Object.freeze({
    manifest,
    classifyPage(rawUrl: string): AgentPlatformPageClassification {
      if (typeof rawUrl !== 'string') {
        throw new TypeError('rawUrl must be a string');
      }
      const classification = parseAgentPlatformPageClassification(classifyPage(rawUrl));
      if (classification.kind === 'unsupported') return classification;

      const exactInputUrl = requireHttpsUrl(rawUrl, 'supported classification rawUrl');
      if (classification.canonicalUrl !== exactInputUrl) {
        throw new TypeError('supported classification URL must exactly match its input');
      }
      const origin = new StandardUrlConstructor(exactInputUrl).origin;
      if (!manifest.allowedWebOrigins.includes(origin)) {
        throw new TypeError('supported classification origin is not allowed by the manifest');
      }
      const exactUrls =
        classification.kind === 'login'
          ? manifest.credentialInputUrls
          : manifest.authenticatedCandidateUrls;
      if (!exactUrls.includes(exactInputUrl)) {
        throw new TypeError('supported classification URL is not declared by the manifest');
      }

      return classification;
    },
  });
}
