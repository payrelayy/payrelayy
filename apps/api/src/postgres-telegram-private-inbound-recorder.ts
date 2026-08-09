import type {
  TelegramPrivateInboundRecord,
  TelegramPrivateInboundRecorder,
} from './telegram-ingress.js';

const CANONICAL_TELEGRAM_IDENTIFIER_PATTERN = /^(?:0|[1-9][0-9]{0,15})$/;
const PAYLOAD_HMAC_PATTERN = /^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_TELEGRAM_PRIVATE_INBOUND_EVENT_SQL = `
  select
    inbound_event_id,
    inbound_event_already_recorded
  from app.record_telegram_private_inbound_event(
    $1::bigint,
    $2::bigint,
    $3::bigint,
    $4::text,
    $5::text,
    $6::text,
    $7::text,
    $8::text
  )
`;

type RecorderValues = [string, string, string, string, string, string | null, string | null, 'en'];

export interface TelegramPrivateInboundRecordingDatabase {
  query(query: string, values: RecorderValues): Promise<{ readonly rows: readonly unknown[] }>;
}

/**
 * A generic retryable recorder failure. It intentionally carries no database, request-body, or
 * Telegram-profile detail because the API route must return a generic 503 on uncertainty.
 */
export class TelegramPrivateInboundRecorderUnavailableError extends Error {
  constructor() {
    super('The private Telegram inbound recorder is unavailable.');
    this.name = 'TelegramPrivateInboundRecorderUnavailableError';
  }
}

function validTelegramIdentifier(value: unknown, permitsZero: boolean): value is string {
  if (typeof value !== 'string' || !CANONICAL_TELEGRAM_IDENTIFIER_PATTERN.test(value)) {
    return false;
  }

  return permitsZero || value !== '0';
}

function validProfileText(value: unknown, required: boolean): value is string | null {
  if (value === null) return !required;
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    value.trim().length > 0 &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function safeRecorderValues(input: TelegramPrivateInboundRecord): RecorderValues {
  const { event, payloadHmac } = input;
  if (
    !validTelegramIdentifier(event.updateId, true) ||
    !validTelegramIdentifier(event.telegramUserId, false) ||
    !validTelegramIdentifier(event.privateChatId, false) ||
    !PAYLOAD_HMAC_PATTERN.test(payloadHmac) ||
    !validProfileText(event.firstName, true) ||
    !validProfileText(event.lastName, false) ||
    (event.username !== null &&
      (typeof event.username !== 'string' || !USERNAME_PATTERN.test(event.username))) ||
    event.preferredLocale !== 'en'
  ) {
    throw new TelegramPrivateInboundRecorderUnavailableError();
  }

  return [
    event.updateId,
    event.telegramUserId,
    event.privateChatId,
    payloadHmac,
    event.firstName,
    event.username,
    event.lastName,
    'en',
  ];
}

function hasSafeReceiptShape(rows: readonly unknown[]): boolean {
  if (rows.length !== 1) return false;

  const row = rows[0] as
    | { readonly inbound_event_already_recorded?: unknown; readonly inbound_event_id?: unknown }
    | undefined;
  return (
    typeof row?.inbound_event_already_recorded === 'boolean' &&
    typeof row.inbound_event_id === 'string' &&
    UUID_PATTERN.test(row.inbound_event_id)
  );
}

/**
 * Adapter for the existing private inbox procedure. Stage 15A composes it only after all three
 * explicit ingress gates are enabled; the adapter neither creates a pool nor loads a credential.
 * Its caller must reserve the nonce in a separate committed operation before recording.
 */
export class PostgresTelegramPrivateInboundRecorder implements TelegramPrivateInboundRecorder {
  constructor(private readonly database: TelegramPrivateInboundRecordingDatabase) {}

  async record(input: TelegramPrivateInboundRecord): Promise<void> {
    try {
      const result = await this.database.query(
        RECORD_TELEGRAM_PRIVATE_INBOUND_EVENT_SQL,
        safeRecorderValues(input),
      );
      if (!hasSafeReceiptShape(result.rows)) {
        throw new TelegramPrivateInboundRecorderUnavailableError();
      }
    } catch (error) {
      if (error instanceof TelegramPrivateInboundRecorderUnavailableError) throw error;
      throw new TelegramPrivateInboundRecorderUnavailableError();
    }
  }
}
