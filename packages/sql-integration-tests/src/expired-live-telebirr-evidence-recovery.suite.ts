import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';

export function registerExpiredLiveTelebirrEvidenceRecoverySqlTests(getClient: () => Client): void {
  describe('expired live TeleBirr evidence recovery', () => {
    it('compiles the historical arming guard without ambiguous local references', async () => {
      const client = getClient();
      const scramVerifier =
        `SCRAM-SHA-256$4096:${'A'.repeat(22)}==` + `$${'B'.repeat(43)}=:${'C'.repeat(43)}=`;

      await client.query('begin');
      try {
        let failure: unknown;
        try {
          await client.query(
            `select *
               from app.arm_private_live_telebirr_historical_completion(
                 $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text
               )`,
            [
              '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000002',
              '1',
              '00000000-0000-4000-8000-000000000003',
              scramVerifier,
              'expired_authority_staged_evidence_completion',
            ],
          );
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          'The expired TeleBirr evidence is not recoverable.',
        );
        expect((failure as Error).message).not.toContain('ambiguous');
      } finally {
        await client.query('rollback');
      }
    });
  });
}
