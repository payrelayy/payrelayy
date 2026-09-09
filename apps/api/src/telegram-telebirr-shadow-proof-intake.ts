import type { ApiConfig } from '@fetanagent/config/api';
import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';

import { createTelegramActionSemanticHmac } from './telegram-action-capability.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** This is the adapter's complete write surface. It has no live-proof or money-moving fallback. */
export const CAPTURE_TELEGRAM_TELEBIRR_SHADOW_PROOF_SQL = `
  select shadow_proof_request_id, shadow_verification_job_id,
         provider_code, proof_status, submitted_at, request_replayed
  from app.capture_telegram_telebirr_shadow_proof(
    $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::smallint, $8::smallint, $9::text
  )
`;

export interface TelegramTelebirrShadowProofDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export type TelegramTelebirrShadowProofAction = Extract<
  TelegramPrivateActionEnvelope,
  { readonly kind: 'deposit_proof_command' }
>;

export class TelegramTelebirrShadowProofIntakeUnavailableError extends Error {
  constructor() {
    super('The Telegram TeleBirr shadow proof intake is unavailable.');
    this.name = 'TelegramTelebirrShadowProofIntakeUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Protect and enqueue one TeleBirr reference in the no-money shadow lane. The unprotected Player
 * ID and reference remain local variables only; neither is returned, interpolated into SQL, nor
 * passed to a logger. PostgreSQL independently requires the armed dry-run authority and every
 * financial/live switch to remain disabled before it accepts this call.
 */
async function captureTelegramTelebirrShadowProofInternal(
  database: TelegramTelebirrShadowProofDatabase,
  originInboundEventId: string,
  action: TelegramTelebirrShadowProofAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  if (
    config.financialActionsMode !== 'dry_run' ||
    !config.telegramActionCapability.enabled ||
    !config.telegramPlayerActionRuntime.enabled ||
    action.kind !== 'deposit_proof_command' ||
    action.providerCode !== 'telebirr'
  ) {
    throw new TelegramTelebirrShadowProofIntakeUnavailableError();
  }

  const protectedReference = protectDepositProofReference({
    provider: 'telebirr',
    reference: action.transactionReference,
    secrets: {
      encryptionSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceEncryptionMasterSecret,
      fingerprintSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceFingerprintMasterSecret,
    },
  });
  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'capture_telegram_telebirr_shadow_proof',
    originInboundEventId,
    playerId: action.playerId,
    providerCode: 'telebirr',
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    profileVersion: config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });

  const result = await database.query(CAPTURE_TELEGRAM_TELEBIRR_SHADOW_PROOF_SQL, [
    originInboundEventId,
    action.playerId,
    'telebirr',
    protectedReference.ciphertext,
    protectedReference.fingerprint,
    protectedReference.masked,
    protectedReference.keyVersion,
    config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmac,
  ]);
  if (result.rows.length !== 1 || !isRecord(result.rows[0])) {
    throw new TelegramTelebirrShadowProofIntakeUnavailableError();
  }

  const row = result.rows[0];
  const expectedColumns = [
    'shadow_proof_request_id',
    'shadow_verification_job_id',
    'provider_code',
    'proof_status',
    'submitted_at',
    'request_replayed',
  ];
  if (
    Object.keys(row).length !== expectedColumns.length ||
    expectedColumns.some((column) => !Object.hasOwn(row, column)) ||
    typeof row.shadow_proof_request_id !== 'string' ||
    !UUID_PATTERN.test(row.shadow_proof_request_id) ||
    typeof row.shadow_verification_job_id !== 'string' ||
    !UUID_PATTERN.test(row.shadow_verification_job_id) ||
    row.provider_code !== 'telebirr' ||
    row.proof_status !== 'verification_queued' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime()) ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramTelebirrShadowProofIntakeUnavailableError();
  }

  // Deliberately omit both database UUIDs and every submitted identifier from the API response.
  return {
    version: 1,
    outcome: 'telebirr_shadow_verification_queued',
    providerCode: 'telebirr',
    providerName: 'TeleBirr',
    proofStatus: 'verification_queued',
    verificationMode: 'shadow_no_money',
  };
}

export async function captureTelegramTelebirrShadowProof(
  database: TelegramTelebirrShadowProofDatabase,
  originInboundEventId: string,
  action: TelegramTelebirrShadowProofAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  try {
    return await captureTelegramTelebirrShadowProofInternal(
      database,
      originInboundEventId,
      action,
      config,
    );
  } catch {
    // Never let protection, PostgreSQL, or private pilot details cross the API boundary.
    throw new TelegramTelebirrShadowProofIntakeUnavailableError();
  }
}
