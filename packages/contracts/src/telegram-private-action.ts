import type { CustomerDepositStatusProjection } from './customer-deposit-status.js';

/**
 * Versioned, private bot-to-API action envelope. It is intentionally separate from the metadata
 * inbox transport: it has a different URL, MIME type, authentication headers, HMAC domain, and
 * nonce-digest domain. This contract does not enable a route or a customer-facing action.
 */
export const TELEGRAM_PRIVATE_ACTION_PATH = '/internal/v1/telegram/private-action';
export const TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE =
  'application/vnd.fetanagent.telegram-private-action+json';
export const TELEGRAM_PRIVATE_ACTION_KEY_ID = 'v1';
export const TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES = 16 * 1024;
export const TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS = 60;
export const TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS = 64;
export const TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH = 22;
export const TELEGRAM_PRIVATE_ACTION_REFERENCE_MIN_CODE_POINTS = 5;
export const TELEGRAM_PRIVATE_ACTION_REFERENCE_MAX_CODE_POINTS = 128;
export const TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MIN_CODE_POINTS = 8;
export const TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MAX_CODE_POINTS = 32;

export const DEPOSIT_PROOF_PROVIDER_CODES = ['cbe_birr', 'telebirr'] as const;
export type DepositProofProviderCode = (typeof DEPOSIT_PROOF_PROVIDER_CODES)[number];

export const TELEGRAM_PRIVATE_ACTION_HEADERS = {
  keyId: 'x-fetanagent-action-key-id',
  nonce: 'x-fetanagent-action-nonce',
  signature: 'x-fetanagent-action-signature',
  timestamp: 'x-fetanagent-action-timestamp',
} as const;

/**
 * A future durable nonce implementation must hash this exact domain-separated input, never store
 * the raw nonce, and never share the private-inbox nonce namespace.
 */
export const TELEGRAM_PRIVATE_ACTION_NONCE_DIGEST_DOMAIN =
  'fetanagent:telegram:private-action:nonce:v1';

export interface TelegramPrivateActionIdentity {
  readonly version: 1;
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly preferredLocale: 'en';
}

/**
 * These are the only customer action presentations this private contract understands. Raw
 * references are allowed only in the bounded deposit-reference command and must never be logged or
 * persisted without API-side protection. The envelope contains no attachment, raw database UUID,
 * or full Telegram Update.
 */
export type TelegramPrivateActionEnvelope =
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'root_menu';
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'player_registration_callback';
      /** Opaque, compact capability presentation; never log this raw value. */
      readonly callbackData: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'player_id_text';
      /** Customer input for a later reviewed database boundary; never log this raw value. */
      readonly playerId: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'deposit_intent_command';
      /** Explicit account selection prevents ambiguity when one customer owns several Player IDs. */
      readonly playerId: string;
      /** Canonical customer-entered ETB decimal, converted to minor units only by the API. */
      readonly amountEtb: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'deposit_reference_command';
      /** Compact opaque UUID presentation. It is not authority and is never logged. */
      readonly depositToken: string;
      /** Raw trusted-memory reference. It is encrypted and blinded before persistence. */
      readonly transactionReference: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'deposit_proof_command';
      /** Exact allowlisted payment-provider identity; never inferred from customer material. */
      readonly providerCode: DepositProofProviderCode;
      /** Destination selection only. The submitting customer need not own this Player ID. */
      readonly playerId: string;
      /** Raw trusted-memory candidate; the API protects it before any database call. */
      readonly transactionReference: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'deposit_proof_status_command';
      /** Compact proof UUID presentation; the API separately authorizes the submitting customer. */
      readonly proofToken: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'deposit_status_command';
      /** Compact opaque UUID presentation. It is not authority and is never logged. */
      readonly depositToken: string;
    });

/** Safe bot-visible result. It never contains a raw database UUID, Player ID, raw callback token, or state. */
export type TelegramPrivateActionResult =
  | {
      readonly version: 1;
      readonly outcome: 'menu';
      readonly callbackData: string;
    }
  | {
      readonly version: 1;
      readonly outcome: 'awaiting_player_id';
    }
  | {
      readonly version: 1;
      readonly outcome: 'player_id_pending';
    }
  | {
      readonly version: 1;
      readonly outcome: 'player_id_exists';
    }
  | {
      readonly version: 1;
      readonly outcome: 'deposit_instructions';
      readonly depositToken: string;
      readonly amountMinor: string;
      readonly currencyCode: 'ETB';
      readonly providerName: 'CBE Birr';
      readonly receiverAccountHolderName: string;
      readonly receiverAccountMasked: string;
      readonly customerInstruction: string;
      readonly paymentDeadline: string;
      readonly depositStatus: CustomerDepositStatusProjection;
      readonly financialMode: 'dry_run' | 'live';
    }
  | {
      readonly version: 1;
      readonly outcome: 'deposit_reference_received';
      readonly depositStatus: CustomerDepositStatusProjection;
      readonly financialMode: 'dry_run' | 'live';
    }
  | {
      readonly version: 1;
      readonly outcome: 'deposit_proof_received';
      /** Compact opaque UUID presentation. It carries no reference, amount, or Player ID. */
      readonly proofToken: string;
      readonly providerCode: DepositProofProviderCode;
      readonly providerName: 'CBE Birr' | 'TeleBirr';
      readonly proofStatus: 'proof_received';
      readonly financialMode: 'dry_run';
    }
  | {
      readonly version: 1;
      readonly outcome: 'deposit_proof_status';
      /** Compact opaque UUID presentation. It carries no reference, amount, or Player ID. */
      readonly proofToken: string;
      readonly providerCode: DepositProofProviderCode;
      readonly providerName: 'CBE Birr' | 'TeleBirr';
      readonly proofStatus: 'proof_received';
      readonly financialMode: 'dry_run';
    }
  | {
      readonly version: 1;
      readonly outcome: 'deposit_status';
      readonly amountMinor: string;
      readonly currencyCode: 'ETB';
      readonly depositStatus: CustomerDepositStatusProjection;
    }
  | {
      readonly version: 1;
      readonly outcome:
        | 'invalid_player_id'
        | 'restart_required'
        | 'menu_required'
        | 'deposit_input_invalid'
        | 'deposit_status_unavailable'
        | 'deposit_unavailable';
    };

export interface TelegramPrivateActionSignatureInput {
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyByteLength: number;
  readonly bodySha256: string;
}

/**
 * This exact text is HMAC-signed by the future bot-side action transport and verified by the API.
 * The digest is calculated over the exact transmitted bytes, never a re-serialized JSON object.
 */
export function telegramPrivateActionSignatureInput(
  input: TelegramPrivateActionSignatureInput,
): string {
  return [
    'fetanagent-bot-api-private-action-v1',
    'POST',
    TELEGRAM_PRIVATE_ACTION_PATH,
    TELEGRAM_PRIVATE_ACTION_KEY_ID,
    input.timestamp,
    input.nonce,
    input.bodyByteLength.toString(),
    input.bodySha256,
  ].join('\n');
}

export function telegramPrivateActionNonceDigestInput(nonce: string): string {
  return `${TELEGRAM_PRIVATE_ACTION_NONCE_DIGEST_DOMAIN}\n${nonce}`;
}

/**
 * The transport's safe log projection intentionally excludes every customer-entered or opaque
 * action field. A caller must not substitute this for authorization or persistence.
 */
export function redactTelegramPrivateActionForLog(action: TelegramPrivateActionEnvelope): {
  readonly version: 1;
  readonly kind: TelegramPrivateActionEnvelope['kind'];
  readonly preferredLocale: 'en';
  readonly customerInputPresent: boolean;
} {
  return {
    version: action.version,
    kind: action.kind,
    preferredLocale: action.preferredLocale,
    customerInputPresent: action.kind !== 'root_menu',
  };
}
