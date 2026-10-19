import type { ApiConfig } from '@fetanagent/config/api';
import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';

import {
  createTelegramActionSemanticHmac,
  decodeTelegramCapabilityId,
  encodeTelegramCapabilityId,
} from './telegram-action-capability.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Bound no-money route; PostgreSQL independently requires CBE verification disabled. */
export const CAPTURE_TELEGRAM_CBE_BIRR_BOUND_PROOF_SQL = `
  select deposit_proof_request_id, provider_code, proof_status,
         submitted_at, request_replayed
  from app.capture_telegram_cbe_birr_bound_dry_run_proof(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text,
    $7::smallint, $8::smallint, $9::text
  )
`;

export interface TelegramCbeBirrBoundProofDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export type TelegramCbeBirrBoundProofAction = Extract<
  TelegramPrivateActionEnvelope,
  { readonly kind: 'deposit_proof_command' }
> & { readonly instructionToken: string };

export class TelegramCbeBirrBoundProofIntakeUnavailableError extends Error {
  constructor() {
    super('The CBE Birr bound proof intake is unavailable.');
    this.name = 'TelegramCbeBirrBoundProofIntakeUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function captureInternal(
  database: TelegramCbeBirrBoundProofDatabase,
  originInboundEventId: string,
  action: TelegramCbeBirrBoundProofAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  if (
    !(
      (config.financialActionsMode === 'dry_run' &&
        config.telegramPlayerActionRuntime.enabled &&
        config.telegramPlayerActionRuntime.deploymentTarget === 'staging' &&
        config.telegramPlayerActionRuntime.cbeBirrBoundDryRunStagingEnabled) ||
      (config.financialActionsMode === 'live' &&
        config.telegramPlayerActionRuntime.enabled &&
        config.telegramPlayerActionRuntime.deploymentTarget === 'production' &&
        config.telegramPlayerActionRuntime.cbeBirrBoundNoMoneyProductionEnabled)
    ) ||
    !config.telegramActionCapability.enabled ||
    !config.telegramPlayerActionRuntime.enabled ||
    action.kind !== 'deposit_proof_command' ||
    action.providerCode !== 'cbe_birr'
  ) {
    throw new TelegramCbeBirrBoundProofIntakeUnavailableError();
  }
  const instructionId = decodeTelegramCapabilityId(action.instructionToken);
  if (!instructionId) throw new TelegramCbeBirrBoundProofIntakeUnavailableError();

  const protectedReference = protectDepositProofReference({
    provider: 'cbe_birr',
    reference: action.transactionReference,
    secrets: {
      encryptionSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceEncryptionMasterSecret,
      fingerprintSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceFingerprintMasterSecret,
    },
  });
  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'capture_telegram_cbe_birr_bound_dry_run_proof',
    originInboundEventId,
    instructionId,
    playerId: action.playerId,
    providerCode: 'cbe_birr',
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    profileVersion: config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });

  const result = await database.query(CAPTURE_TELEGRAM_CBE_BIRR_BOUND_PROOF_SQL, [
    instructionId,
    originInboundEventId,
    action.playerId,
    protectedReference.ciphertext,
    protectedReference.fingerprint,
    protectedReference.masked,
    protectedReference.keyVersion,
    config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmac,
  ]);
  if (result.rows.length !== 1 || !isRecord(result.rows[0])) {
    throw new TelegramCbeBirrBoundProofIntakeUnavailableError();
  }
  const row = result.rows[0];
  const expectedColumns = [
    'deposit_proof_request_id',
    'provider_code',
    'proof_status',
    'submitted_at',
    'request_replayed',
  ];
  if (
    Object.keys(row).length !== expectedColumns.length ||
    expectedColumns.some((column) => !Object.hasOwn(row, column)) ||
    typeof row.deposit_proof_request_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_proof_request_id) ||
    row.provider_code !== 'cbe_birr' ||
    row.proof_status !== 'proof_received' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime()) ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramCbeBirrBoundProofIntakeUnavailableError();
  }
  return {
    version: 1,
    outcome: 'deposit_proof_received',
    proofToken: encodeTelegramCapabilityId(row.deposit_proof_request_id),
    providerCode: 'cbe_birr',
    providerName: 'CBE Birr',
    proofStatus: 'proof_received',
    financialMode: 'dry_run',
  };
}

export async function captureTelegramCbeBirrBoundProof(
  database: TelegramCbeBirrBoundProofDatabase,
  originInboundEventId: string,
  action: TelegramCbeBirrBoundProofAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  try {
    return await captureInternal(database, originInboundEventId, action, config);
  } catch {
    throw new TelegramCbeBirrBoundProofIntakeUnavailableError();
  }
}
