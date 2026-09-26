import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CompanionActivationAttestationRetentionUnavailableError,
  retainCompanionActivationAttestationRow,
  type CompanionActivationAttestationQuery,
} from './attestation-retention.js';

const requestKey = randomUUID();
const sha256 = (character: string) => `sha256:${character.repeat(64)}`;

function attestation() {
  return {
    requestKey,
    certificateBodyDigest: sha256('a'),
    companionReleaseSha: 'b'.repeat(40),
    companionArchiveSha256: sha256('c'),
    companionInstallationTreeSha256: sha256('d'),
    challengeDigest: sha256('e'),
    launchProofDigest: sha256('f'),
    executionHandoffSha256: sha256('0'),
    processId: 4242,
    processStartedAt: '2026-09-26T12:00:00.000Z',
    challengeIssuedAt: '2026-09-26T12:00:30.000Z',
    releaseObservedAt: '2026-09-26T12:00:10.000Z',
    processObservedAt: '2026-09-26T12:00:40.000Z',
    verifiedAt: '2026-09-26T12:00:50.000Z',
  };
}

describe('companion activation digest-only attestation retention adapter', () => {
  it('inserts only the bounded witness with a parameterized administrator statement', async () => {
    const query = vi.fn<CompanionActivationAttestationQuery['query']>(async (sql, values) => {
      expect(sql.trimStart()).toMatch(
        /^insert into app\.agent_platform_companion_execution_activation_attestations/iu,
      );
      expect(sql).toContain("session_user = 'postgres'");
      expect(sql).toContain("execution_control.control_state = 'disabled'");
      expect(sql).toContain('execution_handoff_sha256');
      expect(sql).toContain('request.expires_at > pg_catalog.clock_timestamp()');
      expect(sql).not.toMatch(/\b(update|delete|truncate|grant|alter|activate_agent_platform)\b/iu);
      expect(values).toEqual(Object.values(attestation()));
      return { rows: [{ request_key: requestKey }] };
    });
    await retainCompanionActivationAttestationRow(attestation(), { query });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed fields, additional payload, and invalid time ordering before SQL', async () => {
    const query = vi.fn<CompanionActivationAttestationQuery['query']>();
    for (const invalid of [
      { ...attestation(), executionHandoffSha256: 'raw-handoff' },
      { ...attestation(), signature: 'must-not-be-retained' },
      { ...attestation(), verifiedAt: '2026-09-26T12:00:20.000Z' },
      { ...attestation(), challengeIssuedAt: 'not-a-time' },
      { ...attestation(), processId: 2_147_483_648 },
    ]) {
      await expect(
        retainCompanionActivationAttestationRow(invalid, { query }),
      ).rejects.toBeInstanceOf(CompanionActivationAttestationRetentionUnavailableError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed for missing or ambiguous insertion and redacts database errors', async () => {
    for (const rows of [[], [{ request_key: requestKey }, { request_key: requestKey }]]) {
      await expect(
        retainCompanionActivationAttestationRow(attestation(), {
          async query() {
            return { rows };
          },
        }),
      ).rejects.toBeInstanceOf(CompanionActivationAttestationRetentionUnavailableError);
    }
    await expect(
      retainCompanionActivationAttestationRow(attestation(), {
        async query() {
          throw new Error('sensitive-database-detail');
        },
      }),
    ).rejects.toThrow('The companion activation attestation could not be retained.');
  });
});
