import type { ApiConfig } from '@fetanagent/config/api';

import {
  createTelegramActionSemanticHmac,
  encodeTelegramCapabilityId,
} from './telegram-action-capability.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Candidate only: no application route imports this module and the SQL function is ungranted. */
export const ISSUE_TELEGRAM_CBE_BIRR_DRY_RUN_INSTRUCTION_SQL = `
  select instruction_id, issued_at, expires_at, request_replayed
  from app.issue_telegram_cbe_birr_dry_run_instruction(
    $1::uuid, $2::text, $3::text
  )
`;

export interface TelegramCbeBirrInstructionDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface TelegramCbeBirrDryRunInstructionPreview {
  readonly instructionToken: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly acceptsPayments: false;
}

export class TelegramCbeBirrInstructionUnavailableError extends Error {
  constructor() {
    super('The CBE Birr instruction issuer is unavailable.');
    this.name = 'TelegramCbeBirrInstructionUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function issueInternal(
  database: TelegramCbeBirrInstructionDatabase,
  originInboundEventId: string,
  playerId: string,
  config: ApiConfig,
): Promise<TelegramCbeBirrDryRunInstructionPreview> {
  if (
    config.financialActionsMode !== 'dry_run' ||
    !config.telegramActionCapability.enabled ||
    !config.telegramPlayerActionRuntime.enabled
  ) {
    throw new TelegramCbeBirrInstructionUnavailableError();
  }

  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'issue_telegram_cbe_birr_dry_run_instruction',
    originInboundEventId,
    playerId,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });
  const result = await database.query(ISSUE_TELEGRAM_CBE_BIRR_DRY_RUN_INSTRUCTION_SQL, [
    originInboundEventId,
    playerId,
    semanticHmac,
  ]);
  if (result.rows.length !== 1 || !isRecord(result.rows[0])) {
    throw new TelegramCbeBirrInstructionUnavailableError();
  }
  const row = result.rows[0];
  const expectedColumns = ['instruction_id', 'issued_at', 'expires_at', 'request_replayed'];
  if (
    Object.keys(row).length !== expectedColumns.length ||
    expectedColumns.some((column) => !Object.hasOwn(row, column)) ||
    typeof row.instruction_id !== 'string' ||
    !UUID_PATTERN.test(row.instruction_id) ||
    !(row.issued_at instanceof Date) ||
    Number.isNaN(row.issued_at.getTime()) ||
    !(row.expires_at instanceof Date) ||
    Number.isNaN(row.expires_at.getTime()) ||
    row.expires_at.getTime() - row.issued_at.getTime() !== 3_600_000 ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramCbeBirrInstructionUnavailableError();
  }

  return {
    instructionToken: encodeTelegramCapabilityId(row.instruction_id),
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    acceptsPayments: false,
  };
}

export async function issueTelegramCbeBirrDryRunInstruction(
  database: TelegramCbeBirrInstructionDatabase,
  originInboundEventId: string,
  playerId: string,
  config: ApiConfig,
): Promise<TelegramCbeBirrDryRunInstructionPreview> {
  try {
    return await issueInternal(database, originInboundEventId, playerId, config);
  } catch {
    throw new TelegramCbeBirrInstructionUnavailableError();
  }
}
