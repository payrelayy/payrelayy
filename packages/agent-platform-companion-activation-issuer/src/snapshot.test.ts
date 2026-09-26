import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CompanionActivationSnapshotUnavailableError,
  loadCompanionActivationDatabaseSnapshot,
  type CompanionActivationSnapshotQuery,
} from './snapshot.js';

const requestKey = randomUUID();
const pilotRevisionId = randomUUID();
const certificateId = randomUUID();
const accountId = randomUUID();
const now = new Date('2026-09-26T18:00:00.000Z');

function row(): Record<string, unknown> {
  return {
    request_key: requestKey,
    request_pilot_revision_id: pilotRevisionId,
    request_activation_epoch: '1',
    request_certificate_id: certificateId,
    request_account_id: accountId,
    companion_release_sha: 'a'.repeat(40),
    companion_archive_sha256: `sha256:${'b'.repeat(64)}`,
    companion_installation_tree_sha256: `sha256:${'c'.repeat(64)}`,
    requested_at: now,
    request_expires_at: new Date(now.getTime() + 600_000),
    current_pilot_revision_id: pilotRevisionId,
    current_activation_epoch: '1',
    current_certificate_id: certificateId,
    current_account_id: accountId,
    certificate_body_digest: `sha256:${'d'.repeat(64)}`,
    device_key_id: 'device-key-123',
    device_public_key_spki: 'trusted-database-key',
    device_public_key_spki_sha256: `sha256:${'e'.repeat(64)}`,
    certificate_valid_from: now,
    certificate_valid_until: new Date(now.getTime() + 3_600_000),
  };
}

describe('companion activation issuer database snapshot', () => {
  it('parameterizes the request key and maps only database-returned evidence', async () => {
    let calls = 0;
    const administrator: CompanionActivationSnapshotQuery = {
      async query(sql, values) {
        calls += 1;
        expect(values).toEqual([requestKey]);
        expect(sql).toContain('request.request_key = $1::uuid');
        expect(sql).toContain("session_user = 'postgres'");
        expect(sql).not.toMatch(/for\s+(share|update)/iu);
        expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\b/iu);
        return { rows: [row()] };
      },
    };
    const snapshot = await loadCompanionActivationDatabaseSnapshot(requestKey, administrator);
    expect(calls).toBe(1);
    expect(snapshot.request.requestKey).toBe(requestKey);
    expect(snapshot.currentIdentity).toEqual({
      pilotRevisionId,
      activationEpoch: '1',
      certificateId,
      platformAgentAccountId: accountId,
    });
    expect(snapshot.certificate.devicePublicKeySpki).toBe('trusted-database-key');
    expect(snapshot.request.requestedAt).toBe(now.toISOString());
  });

  it('rejects malformed input without making a query', async () => {
    const administrator: CompanionActivationSnapshotQuery = {
      async query() {
        throw new Error('must not query');
      },
    };
    await expect(
      loadCompanionActivationDatabaseSnapshot("' OR true --", administrator),
    ).rejects.toBeInstanceOf(CompanionActivationSnapshotUnavailableError);
  });

  it('fails closed for missing, ambiguous, or malformed database rows', async () => {
    for (const rows of [[], [row(), row()], [{ ...row(), requested_at: 'not-a-date' }]]) {
      await expect(
        loadCompanionActivationDatabaseSnapshot(requestKey, {
          async query() {
            return { rows };
          },
        }),
      ).rejects.toBeInstanceOf(CompanionActivationSnapshotUnavailableError);
    }
  });

  it('does not leak database errors or row contents', async () => {
    await expect(
      loadCompanionActivationDatabaseSnapshot(requestKey, {
        async query() {
          throw new Error('database-secret');
        },
      }),
    ).rejects.toThrow('The companion activation database snapshot is unavailable.');
  });
});
