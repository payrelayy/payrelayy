import { createHash, createHmac, randomBytes } from 'node:crypto';

import {
  TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
  TELEGRAM_PRIVATE_ACTION_HEADERS,
  TELEGRAM_PRIVATE_ACTION_KEY_ID,
  TELEGRAM_PRIVATE_ACTION_PATH,
  isCustomerDepositStatusProjection,
  parseTelegramPlayerRegistrationCapabilityCallback,
  telegramPrivateActionSignatureInput,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';

export interface TelegramPrivateActionClientConfig {
  readonly baseUrl: string;
  readonly transportHmacSecret: string;
}

export interface TelegramPrivateActionClientDependencies {
  readonly now?: () => Date;
  readonly nonce?: () => string;
  readonly fetch?: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Pick<Response, 'status' | 'json'>>;
}

export class TelegramPrivateActionDeliveryError extends Error {
  constructor(readonly retryable: boolean) {
    super('The Telegram private action was not accepted.');
    this.name = 'TelegramPrivateActionDeliveryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResult(value: unknown): TelegramPrivateActionResult | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.outcome !== 'string')
    return undefined;
  const keys = Object.keys(value);
  if (value.outcome === 'menu') {
    return keys.length === 3 &&
      parseTelegramPlayerRegistrationCapabilityCallback(value.callbackData)
      ? { version: 1, outcome: 'menu', callbackData: value.callbackData as string }
      : undefined;
  }
  if (
    value.outcome === 'deposit_instructions' &&
    keys.length === 12 &&
    typeof value.depositToken === 'string' &&
    /^[A-Za-z0-9_-]{22}$/u.test(value.depositToken) &&
    typeof value.amountMinor === 'string' &&
    /^[1-9][0-9]*$/u.test(value.amountMinor) &&
    value.currencyCode === 'ETB' &&
    value.providerName === 'CBE Birr' &&
    typeof value.receiverAccountHolderName === 'string' &&
    typeof value.receiverAccountMasked === 'string' &&
    typeof value.customerInstruction === 'string' &&
    typeof value.paymentDeadline === 'string' &&
    !Number.isNaN(Date.parse(value.paymentDeadline)) &&
    isCustomerDepositStatusProjection(value.depositStatus) &&
    (value.financialMode === 'dry_run' || value.financialMode === 'live')
  ) {
    return value as unknown as TelegramPrivateActionResult;
  }
  if (
    value.outcome === 'deposit_reference_received' &&
    keys.length === 4 &&
    isCustomerDepositStatusProjection(value.depositStatus) &&
    (value.financialMode === 'dry_run' || value.financialMode === 'live')
  ) {
    return value as unknown as TelegramPrivateActionResult;
  }
  if (
    value.outcome === 'deposit_status' &&
    keys.length === 5 &&
    typeof value.amountMinor === 'string' &&
    /^[1-9][0-9]*$/u.test(value.amountMinor) &&
    value.currencyCode === 'ETB' &&
    isCustomerDepositStatusProjection(value.depositStatus)
  ) {
    return value as unknown as TelegramPrivateActionResult;
  }
  if (
    keys.length === 2 &&
    [
      'awaiting_player_id',
      'player_id_pending',
      'player_id_exists',
      'invalid_player_id',
      'restart_required',
      'menu_required',
      'deposit_input_invalid',
      'deposit_unavailable',
    ].includes(value.outcome)
  ) {
    return { version: 1, outcome: value.outcome } as TelegramPrivateActionResult;
  }
  return undefined;
}

function signature(secret: string, timestamp: string, nonce: string, rawBody: Buffer): string {
  const bodySha256 = createHash('sha256').update(rawBody).digest('hex');
  return `${TELEGRAM_PRIVATE_ACTION_KEY_ID}.${createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(
      telegramPrivateActionSignatureInput({
        timestamp,
        nonce,
        bodyByteLength: rawBody.byteLength,
        bodySha256,
      }),
      'utf8',
    )
    .digest('base64url')}`;
}

export async function deliverTelegramPrivateAction(
  action: TelegramPrivateActionEnvelope,
  config: TelegramPrivateActionClientConfig,
  dependencies: TelegramPrivateActionClientDependencies = {},
): Promise<TelegramPrivateActionResult> {
  const now = dependencies.now?.() ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1_000).toString();
  const nonce = dependencies.nonce?.() ?? randomBytes(24).toString('base64url');
  if (!/^[A-Za-z0-9_-]{32}$/u.test(nonce) || !/^[0-9a-f]{64}$/u.test(config.transportHmacSecret)) {
    throw new TelegramPrivateActionDeliveryError(false);
  }
  const rawBody = Buffer.from(JSON.stringify(action), 'utf8');
  let response: Pick<Response, 'status' | 'json'>;
  try {
    response = await (dependencies.fetch ?? fetch)(
      new URL(TELEGRAM_PRIVATE_ACTION_PATH, config.baseUrl),
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
          [TELEGRAM_PRIVATE_ACTION_HEADERS.keyId]: TELEGRAM_PRIVATE_ACTION_KEY_ID,
          [TELEGRAM_PRIVATE_ACTION_HEADERS.timestamp]: timestamp,
          [TELEGRAM_PRIVATE_ACTION_HEADERS.nonce]: nonce,
          [TELEGRAM_PRIVATE_ACTION_HEADERS.signature]: signature(
            config.transportHmacSecret,
            timestamp,
            nonce,
            rawBody,
          ),
        },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    throw new TelegramPrivateActionDeliveryError(true);
  }

  if (response.status !== 200) {
    throw new TelegramPrivateActionDeliveryError(
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  try {
    const result = parseResult(await response.json());
    if (!result) throw new TelegramPrivateActionDeliveryError(false);
    return result;
  } catch (error) {
    if (error instanceof TelegramPrivateActionDeliveryError) throw error;
    throw new TelegramPrivateActionDeliveryError(false);
  }
}

export async function deliverTelegramPrivateActionWithRetry(
  action: TelegramPrivateActionEnvelope,
  config: TelegramPrivateActionClientConfig,
  dependencies: TelegramPrivateActionClientDependencies = {},
): Promise<TelegramPrivateActionResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await deliverTelegramPrivateAction(action, config, dependencies);
    } catch (error) {
      if (
        !(error instanceof TelegramPrivateActionDeliveryError) ||
        !error.retryable ||
        attempt === 2
      ) {
        throw error;
      }
    }
  }
  throw new TelegramPrivateActionDeliveryError(false);
}
