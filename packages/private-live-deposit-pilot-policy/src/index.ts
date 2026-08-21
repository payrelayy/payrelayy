import { isProxy } from 'node:util/types';

export const PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION = 1 as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_REQUIRED_PLAYER_COUNT = 5 as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_MAX_CUSTOMER_COUNT = 5 as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_MAX_RESERVATION_COUNT = 5 as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_MAX_DURATION_SECONDS = 86_400 as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_PLATFORM_CODE = 'kemerbet' as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_CURRENCY_CODE = 'ETB' as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_MINIMUM_AMOUNT_MINOR = '2500' as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_ABSOLUTE_MAXIMUM_AMOUNT_MINOR = '2500000' as const;
export const PRIVATE_LIVE_DEPOSIT_PILOT_PROVIDERS = Object.freeze([
  'cbe_birr',
  'telebirr',
] as const);

export type PrivateLiveDepositPilotProvider = (typeof PRIVATE_LIVE_DEPOSIT_PILOT_PROVIDERS)[number];

export type PrivateLiveDepositPilotBlockReason =
  | 'invalid_input'
  | 'pilot_not_armed'
  | 'pilot_not_started'
  | 'pilot_expired'
  | 'provider_not_allowlisted'
  | 'customer_not_allowlisted'
  | 'player_not_allowlisted'
  | 'amount_below_minimum'
  | 'amount_above_per_deposit_cap'
  | 'player_cap_exceeded'
  | 'aggregate_cap_exceeded'
  | 'reservation_count_exceeded';

interface DisabledPilotCapabilities {
  readonly advisoryOnly: true;
  readonly sqlAuthorizationAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly reservationAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly blindRetryAllowed: false;
}

export interface PrivateLiveDepositPilotPolicy {
  readonly contractVersion: typeof PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION;
  readonly pilotRevisionId: string;
  readonly configurationDigest: string;
  readonly state: 'draft' | 'armed' | 'stopped';
  readonly platformCode: typeof PRIVATE_LIVE_DEPOSIT_PILOT_PLATFORM_CODE;
  readonly currencyCode: typeof PRIVATE_LIVE_DEPOSIT_PILOT_CURRENCY_CODE;
  readonly providerCodes: readonly PrivateLiveDepositPilotProvider[];
  readonly playerAccountIds: readonly string[];
  readonly submittingCustomerIds: readonly string[];
  readonly minimumAmountMinor: string;
  readonly maximumPerDepositMinor: string;
  readonly maximumPerPlayerMinor: string;
  readonly maximumAggregateMinor: string;
  readonly maximumReservations: number;
  readonly activeFrom: string;
  readonly expiresAt: string;
}

export interface PrivateLiveDepositPilotEvaluationInput {
  readonly contractVersion: typeof PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION;
  readonly evaluatedAt: string;
  readonly providerCode: PrivateLiveDepositPilotProvider;
  readonly submittingCustomerId: string;
  readonly playerAccountId: string;
  readonly amountMinor: string;
  readonly reservedForPlayerMinor: string;
  readonly reservedAggregateMinor: string;
  readonly reservationCount: number;
  readonly policy: PrivateLiveDepositPilotPolicy;
}

interface PrivateLiveDepositPilotDecisionBase extends DisabledPilotCapabilities {
  readonly contractVersion: typeof PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION;
  readonly providerCode: PrivateLiveDepositPilotProvider | 'unknown';
  readonly safeFactsOnly: true;
}

export interface PrivateLiveDepositPilotWouldAllow extends PrivateLiveDepositPilotDecisionBase {
  readonly disposition: 'would_allow';
  readonly reasonCode: 'exact_private_pilot_match';
}

export interface PrivateLiveDepositPilotWouldBlock extends PrivateLiveDepositPilotDecisionBase {
  readonly disposition: 'would_block';
  readonly reasonCode: PrivateLiveDepositPilotBlockReason;
}

export type PrivateLiveDepositPilotDecision =
  PrivateLiveDepositPilotWouldAllow | PrivateLiveDepositPilotWouldBlock;

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MINOR_PATTERN = /^(0|[1-9][0-9]{0,17})$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

const policyKeys = [
  'contractVersion',
  'pilotRevisionId',
  'configurationDigest',
  'state',
  'platformCode',
  'currencyCode',
  'providerCodes',
  'playerAccountIds',
  'submittingCustomerIds',
  'minimumAmountMinor',
  'maximumPerDepositMinor',
  'maximumPerPlayerMinor',
  'maximumAggregateMinor',
  'maximumReservations',
  'activeFrom',
  'expiresAt',
] as const;

const inputKeys = [
  'contractVersion',
  'evaluatedAt',
  'providerCode',
  'submittingCustomerId',
  'playerAccountId',
  'amountMinor',
  'reservedForPlayerMinor',
  'reservedAggregateMinor',
  'reservationCount',
  'policy',
] as const;

const disabledCapabilities: DisabledPilotCapabilities = Object.freeze({
  advisoryOnly: true,
  sqlAuthorizationAllowed: false,
  databaseWriteAllowed: false,
  reservationAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
  blindRetryAllowed: false,
});

function plainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string') ||
    !keys.every((key) => actual.includes(key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function own(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function exactStringArray(
  value: unknown,
  minimum: number,
  maximum: number,
  validator: (item: string) => boolean,
): readonly string[] | undefined {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return undefined;
  }
  if (value.length < minimum || value.length > maximum) return undefined;
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      !validator(descriptor.value)
    ) {
      return undefined;
    }
    items.push(descriptor.value);
  }
  const expectedKeys = [...items.map((_, index) => String(index)), 'length'];
  if (Reflect.ownKeys(value).some((key) => !expectedKeys.includes(String(key)))) return undefined;
  if (new Set(items).size !== items.length) return undefined;
  return items;
}

function minor(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !MINOR_PATTERN.test(value)) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed <= 999_999_999_999_999_999n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function canonicalTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_PATTERN.test(value)) return undefined;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) return undefined;
  return epoch;
}

interface ParsedPolicy {
  readonly revisionId: string;
  readonly configurationDigest: string;
  readonly state: PrivateLiveDepositPilotPolicy['state'];
  readonly providers: readonly PrivateLiveDepositPilotProvider[];
  readonly players: readonly string[];
  readonly customers: readonly string[];
  readonly minimum: bigint;
  readonly maximumPerDeposit: bigint;
  readonly maximumPerPlayer: bigint;
  readonly maximumAggregate: bigint;
  readonly maximumReservations: number;
  readonly activeFrom: number;
  readonly expiresAt: number;
}

function parsePolicy(value: unknown): ParsedPolicy | undefined {
  if (!plainRecord(value) || !exactDataKeys(value, policyKeys)) return undefined;
  const revisionId = own(value, 'pilotRevisionId');
  const configurationDigest = own(value, 'configurationDigest');
  const state = own(value, 'state');
  const providers = exactStringArray(
    own(value, 'providerCodes'),
    1,
    2,
    (item) => item === 'cbe_birr' || item === 'telebirr',
  ) as readonly PrivateLiveDepositPilotProvider[] | undefined;
  const players = exactStringArray(
    own(value, 'playerAccountIds'),
    PRIVATE_LIVE_DEPOSIT_PILOT_REQUIRED_PLAYER_COUNT,
    PRIVATE_LIVE_DEPOSIT_PILOT_REQUIRED_PLAYER_COUNT,
    (item) => UUID_PATTERN.test(item),
  );
  const customers = exactStringArray(
    own(value, 'submittingCustomerIds'),
    1,
    PRIVATE_LIVE_DEPOSIT_PILOT_MAX_CUSTOMER_COUNT,
    (item) => UUID_PATTERN.test(item),
  );
  const minimum = minor(own(value, 'minimumAmountMinor'));
  const maximumPerDeposit = minor(own(value, 'maximumPerDepositMinor'));
  const maximumPerPlayer = minor(own(value, 'maximumPerPlayerMinor'));
  const maximumAggregate = minor(own(value, 'maximumAggregateMinor'));
  const maximumReservations = own(value, 'maximumReservations');
  const activeFrom = canonicalTime(own(value, 'activeFrom'));
  const expiresAt = canonicalTime(own(value, 'expiresAt'));
  if (
    own(value, 'contractVersion') !== PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION ||
    typeof revisionId !== 'string' ||
    !UUID_PATTERN.test(revisionId) ||
    typeof configurationDigest !== 'string' ||
    !SHA256_DIGEST_PATTERN.test(configurationDigest) ||
    (state !== 'draft' && state !== 'armed' && state !== 'stopped') ||
    own(value, 'platformCode') !== PRIVATE_LIVE_DEPOSIT_PILOT_PLATFORM_CODE ||
    own(value, 'currencyCode') !== PRIVATE_LIVE_DEPOSIT_PILOT_CURRENCY_CODE ||
    providers === undefined ||
    players === undefined ||
    customers === undefined ||
    minimum === undefined ||
    maximumPerDeposit === undefined ||
    maximumPerPlayer === undefined ||
    maximumAggregate === undefined ||
    typeof maximumReservations !== 'number' ||
    !Number.isSafeInteger(maximumReservations) ||
    maximumReservations < 1 ||
    maximumReservations > PRIVATE_LIVE_DEPOSIT_PILOT_MAX_RESERVATION_COUNT ||
    activeFrom === undefined ||
    expiresAt === undefined ||
    minimum !== BigInt(PRIVATE_LIVE_DEPOSIT_PILOT_MINIMUM_AMOUNT_MINOR) ||
    maximumPerDeposit > BigInt(PRIVATE_LIVE_DEPOSIT_PILOT_ABSOLUTE_MAXIMUM_AMOUNT_MINOR) ||
    maximumPerDeposit < minimum ||
    maximumPerPlayer < maximumPerDeposit ||
    maximumPerPlayer > BigInt(PRIVATE_LIVE_DEPOSIT_PILOT_ABSOLUTE_MAXIMUM_AMOUNT_MINOR) ||
    maximumAggregate < maximumPerPlayer ||
    maximumAggregate > maximumPerDeposit * BigInt(maximumReservations) ||
    expiresAt <= activeFrom ||
    expiresAt - activeFrom > PRIVATE_LIVE_DEPOSIT_PILOT_MAX_DURATION_SECONDS * 1000
  ) {
    return undefined;
  }
  return {
    revisionId,
    configurationDigest,
    state,
    providers,
    players,
    customers,
    minimum,
    maximumPerDeposit,
    maximumPerPlayer,
    maximumAggregate,
    maximumReservations,
    activeFrom,
    expiresAt,
  };
}

function decision(
  providerCode: PrivateLiveDepositPilotProvider | 'unknown',
  disposition: PrivateLiveDepositPilotDecision['disposition'],
  reasonCode: PrivateLiveDepositPilotDecision['reasonCode'],
): PrivateLiveDepositPilotDecision {
  return Object.freeze({
    contractVersion: PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION,
    providerCode,
    safeFactsOnly: true,
    disposition,
    reasonCode,
    ...disabledCapabilities,
  }) as PrivateLiveDepositPilotDecision;
}

export function evaluatePrivateLiveDepositPilot(
  candidate: unknown,
): PrivateLiveDepositPilotDecision {
  try {
    if (!plainRecord(candidate) || !exactDataKeys(candidate, inputKeys)) {
      return decision('unknown', 'would_block', 'invalid_input');
    }
    const providerCode = own(candidate, 'providerCode');
    const policy = parsePolicy(own(candidate, 'policy'));
    const evaluatedAt = canonicalTime(own(candidate, 'evaluatedAt'));
    const customerId = own(candidate, 'submittingCustomerId');
    const playerId = own(candidate, 'playerAccountId');
    const amount = minor(own(candidate, 'amountMinor'));
    const playerReserved = minor(own(candidate, 'reservedForPlayerMinor'));
    const aggregateReserved = minor(own(candidate, 'reservedAggregateMinor'));
    const reservationCount = own(candidate, 'reservationCount');
    if (
      own(candidate, 'contractVersion') !== PRIVATE_LIVE_DEPOSIT_PILOT_POLICY_CONTRACT_VERSION ||
      (providerCode !== 'cbe_birr' && providerCode !== 'telebirr') ||
      policy === undefined ||
      evaluatedAt === undefined ||
      typeof customerId !== 'string' ||
      !UUID_PATTERN.test(customerId) ||
      typeof playerId !== 'string' ||
      !UUID_PATTERN.test(playerId) ||
      amount === undefined ||
      playerReserved === undefined ||
      aggregateReserved === undefined ||
      typeof reservationCount !== 'number' ||
      !Number.isSafeInteger(reservationCount) ||
      reservationCount < 0
    ) {
      return decision(
        providerCode === 'cbe_birr' || providerCode === 'telebirr' ? providerCode : 'unknown',
        'would_block',
        'invalid_input',
      );
    }
    if (policy.state !== 'armed') return decision(providerCode, 'would_block', 'pilot_not_armed');
    if (evaluatedAt < policy.activeFrom) {
      return decision(providerCode, 'would_block', 'pilot_not_started');
    }
    if (evaluatedAt >= policy.expiresAt)
      return decision(providerCode, 'would_block', 'pilot_expired');
    if (!policy.providers.includes(providerCode)) {
      return decision(providerCode, 'would_block', 'provider_not_allowlisted');
    }
    if (!policy.customers.includes(customerId)) {
      return decision(providerCode, 'would_block', 'customer_not_allowlisted');
    }
    if (!policy.players.includes(playerId)) {
      return decision(providerCode, 'would_block', 'player_not_allowlisted');
    }
    if (amount < policy.minimum) {
      return decision(providerCode, 'would_block', 'amount_below_minimum');
    }
    if (amount > policy.maximumPerDeposit) {
      return decision(providerCode, 'would_block', 'amount_above_per_deposit_cap');
    }
    if (playerReserved + amount > policy.maximumPerPlayer) {
      return decision(providerCode, 'would_block', 'player_cap_exceeded');
    }
    if (aggregateReserved + amount > policy.maximumAggregate) {
      return decision(providerCode, 'would_block', 'aggregate_cap_exceeded');
    }
    if (reservationCount >= policy.maximumReservations) {
      return decision(providerCode, 'would_block', 'reservation_count_exceeded');
    }
    return decision(providerCode, 'would_allow', 'exact_private_pilot_match');
  } catch {
    return decision('unknown', 'would_block', 'invalid_input');
  }
}

export function redactedPrivateLiveDepositPilotDecisionForLog(
  candidate: unknown,
): PrivateLiveDepositPilotDecision {
  const evaluated = evaluatePrivateLiveDepositPilot(candidate);
  return Object.freeze({ ...evaluated });
}
