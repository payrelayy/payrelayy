import type { ApiConfig } from '@fetanagent/config/api';
import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';

import { createTelegramActionSemanticHmac } from './telegram-action-capability.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SYNTHETIC_REFERENCE_PATTERN = /^FETANTEST[A-Z0-9]{4,20}$/u;

/** Not wired into the Player-action runtime and not granted to its database role. */
export const CAPTURE_TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_SQL = `
  select proof_request_id, provider_code, proof_status, submitted_at, request_replayed
  from app.capture_telegram_routine_telebirr_untrusted_proof(
    $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::smallint, $8::smallint, $9::text
  )
`;

export interface TelegramRoutineTelebirrCandidateDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

type CandidateAction = Extract<
  TelegramPrivateActionEnvelope,
  { readonly kind: 'deposit_proof_command' }
>;

export class TelegramRoutineTelebirrCandidateUnavailableError extends Error {
  constructor() {
    super('The routine Telegram TeleBirr candidate intake is unavailable.');
    this.name = 'TelegramRoutineTelebirrCandidateUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function captureInternal(
  database: TelegramRoutineTelebirrCandidateDatabase,
  originInboundEventId: string,
  action: CandidateAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  if (
    config.financialActionsMode !== 'dry_run' ||
    !config.telegramActionCapability.enabled ||
    !config.telegramPlayerActionRuntime.enabled ||
    config.telegramPlayerActionRuntime.deploymentTarget !== 'staging' ||
    config.telegramPlayerActionRuntime.telebirrReceiverReviewEnabled ||
    config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion !== 2 ||
    !UUID_PATTERN.test(originInboundEventId) ||
    action.kind !== 'deposit_proof_command' ||
    action.providerCode !== 'telebirr' ||
    !SYNTHETIC_REFERENCE_PATTERN.test(action.transactionReference)
  ) {
    throw new TelegramRoutineTelebirrCandidateUnavailableError();
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
    consumer: 'capture_telegram_routine_telebirr_untrusted_proof',
    originInboundEventId,
    playerId: action.playerId,
    providerCode: 'telebirr',
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    profileVersion: config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });
  const result = await database.query(CAPTURE_TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_SQL, [
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
    throw new TelegramRoutineTelebirrCandidateUnavailableError();
  }
  const row = result.rows[0];
  const expectedColumns = [
    'proof_request_id',
    'provider_code',
    'proof_status',
    'submitted_at',
    'request_replayed',
  ];
  if (
    Object.keys(row).length !== expectedColumns.length ||
    expectedColumns.some((column) => !Object.hasOwn(row, column)) ||
    typeof row.proof_request_id !== 'string' ||
    !UUID_PATTERN.test(row.proof_request_id) ||
    row.provider_code !== 'telebirr' ||
    row.proof_status !== 'untrusted_received' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime()) ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramRoutineTelebirrCandidateUnavailableError();
  }

  return {
    version: 1,
    outcome: 'telebirr_routine_candidate_recorded_no_money',
    providerCode: 'telebirr',
    providerName: 'TeleBirr',
    proofStatus: 'untrusted_received',
    verificationMode: 'not_started_no_money',
  };
}

export async function captureTelegramRoutineTelebirrCandidate(
  database: TelegramRoutineTelebirrCandidateDatabase,
  originInboundEventId: string,
  action: CandidateAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  try {
    return await captureInternal(database, originInboundEventId, action, config);
  } catch {
    // Never leak the candidate, Player ID, database, or receiver configuration.
    throw new TelegramRoutineTelebirrCandidateUnavailableError();
  }
}
