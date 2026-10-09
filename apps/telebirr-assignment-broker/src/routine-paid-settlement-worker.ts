export const ROUTINE_PAID_SETTLEMENT_BATCH_SIZE = 32;

export interface RoutinePaidSettlementCandidate {
  readonly challengeId: string;
  /** The signed phone observation's staging-complete time, not the transfer time. */
  readonly verificationCompletedAtUtc: string;
}

export interface RoutinePaidSettlementDatabase {
  listCandidates(
    cursor: RoutinePaidSettlementCandidate | undefined,
    limit: number,
  ): Promise<readonly RoutinePaidSettlementCandidate[]>;
  finalize(challengeId: string): Promise<'created' | 'already_finalized'>;
}

export interface RoutinePaidSettlementPass {
  readonly nextCursor: RoutinePaidSettlementCandidate | undefined;
  readonly examined: number;
  readonly created: number;
  readonly alreadyFinalized: number;
  readonly rejected: number;
}

/** One bounded page. A later pass resumes after its cursor, even when one row is rejected. */
export async function runRoutinePaidSettlementPass(
  database: RoutinePaidSettlementDatabase,
  cursor?: RoutinePaidSettlementCandidate,
): Promise<RoutinePaidSettlementPass> {
  const candidates = await database.listCandidates(cursor, ROUTINE_PAID_SETTLEMENT_BATCH_SIZE);
  if (candidates.length > ROUTINE_PAID_SETTLEMENT_BATCH_SIZE) {
    throw new Error('The routine paid settlement scan is unavailable.');
  }
  let created = 0;
  let alreadyFinalized = 0;
  let rejected = 0;
  for (const candidate of candidates) {
    try {
      const result = await database.finalize(candidate.challengeId);
      if (result === 'created') created++;
      else if (result === 'already_finalized') alreadyFinalized++;
      else throw new Error();
    } catch {
      rejected++;
    }
  }
  return Object.freeze({
    nextCursor:
      candidates.length === ROUTINE_PAID_SETTLEMENT_BATCH_SIZE
        ? candidates[candidates.length - 1]
        : undefined,
    examined: candidates.length,
    created,
    alreadyFinalized,
    rejected,
  });
}
