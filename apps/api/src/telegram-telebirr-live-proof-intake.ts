import type { ApiConfig } from '@fetanagent/config/api';
import {
  projectCustomerDepositStatus,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';

import {
  createTelegramActionSemanticHmac,
  encodeTelegramCapabilityId,
} from './telegram-action-capability.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The live adapter can create only a protected pilot proof and its existing verifier job. */
export const CAPTURE_TELEGRAM_LIVE_TELEBIRR_PROOF_SQL = `
  select live_proof_id, live_verification_job_id,
         provider_code, proof_status, submitted_at, request_replayed
  from app.capture_telegram_live_telebirr_proof(
    $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::smallint, $8::smallint, $9::text
  )
`;

export interface TelegramLiveTelebirrProofDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export type TelegramLiveTelebirrProofAction = Extract<
  TelegramPrivateActionEnvelope,
  { readonly kind: 'deposit_proof_command' }
>;

export class TelegramLiveTelebirrProofIntakeUnavailableError extends Error {
  constructor() {
    super('The Telegram live TeleBirr proof intake is unavailable.');
    this.name = 'TelegramLiveTelebirrProofIntakeUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function captureTelegramLiveTelebirrProofInternal(
  database: TelegramLiveTelebirrProofDatabase,
  originInboundEventId: string,
  action: TelegramLiveTelebirrProofAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  if (
    config.financialActionsMode !== 'live' ||
    !config.telegramActionCapability.enabled ||
    !config.telegramPlayerActionRuntime.enabled ||
    config.telegramPlayerActionRuntime.telebirrReceiverReviewEnabled ||
    action.kind !== 'deposit_proof_command' ||
    action.providerCode !== 'telebirr'
  ) {
    throw new TelegramLiveTelebirrProofIntakeUnavailableError();
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
    consumer: 'capture_telegram_live_telebirr_proof',
    originInboundEventId,
    playerId: action.playerId,
    providerCode: 'telebirr',
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    profileVersion: config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });

  const result = await database.query(CAPTURE_TELEGRAM_LIVE_TELEBIRR_PROOF_SQL, [
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
    throw new TelegramLiveTelebirrProofIntakeUnavailableError();
  }

  const row = result.rows[0];
  const expectedColumns = [
    'live_proof_id',
    'live_verification_job_id',
    'provider_code',
    'proof_status',
    'submitted_at',
    'request_replayed',
  ];
  if (
    Object.keys(row).length !== expectedColumns.length ||
    expectedColumns.some((column) => !Object.hasOwn(row, column)) ||
    typeof row.live_proof_id !== 'string' ||
    !UUID_PATTERN.test(row.live_proof_id) ||
    typeof row.live_verification_job_id !== 'string' ||
    !UUID_PATTERN.test(row.live_verification_job_id) ||
    row.provider_code !== 'telebirr' ||
    row.proof_status !== 'verification_pending' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime()) ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramLiveTelebirrProofIntakeUnavailableError();
  }

  return {
    version: 1,
    outcome: 'telebirr_live_verification_queued',
    proofToken: encodeTelegramCapabilityId(row.live_proof_id),
    providerCode: 'telebirr',
    providerName: 'TeleBirr',
    depositStatus: projectCustomerDepositStatus('verification_pending'),
    financialMode: 'live',
  };
}

export async function captureTelegramLiveTelebirrProof(
  database: TelegramLiveTelebirrProofDatabase,
  originInboundEventId: string,
  action: TelegramLiveTelebirrProofAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  try {
    return await captureTelegramLiveTelebirrProofInternal(
      database,
      originInboundEventId,
      action,
      config,
    );
  } catch {
    // Never expose reference protection, PostgreSQL, pilot, receiver, or verifier details.
    throw new TelegramLiveTelebirrProofIntakeUnavailableError();
  }
}
