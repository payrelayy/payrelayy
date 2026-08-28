import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  OwnerKemerbetAgentProfileRejectedError,
  OwnerKemerbetAgentProfileUnavailableError,
  PostgresOwnerKemerbetAgentProfiles,
  type OwnerKemerbetAgentProfileDatabase,
} from './owner-kemerbet-agent-profile.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const claimId = '55555555-5555-4555-8555-555555555555';
const canonicalReceiptId = '66666666-6666-4666-8666-666666666666';
const recoveryMigrationSource = readFileSync(
  new URL(
    '../../../supabase/migrations/20260828171400_claim_bound_kemerbet_quarantine_recovery.sql',
    import.meta.url,
  ),
  'utf8',
);

function row(overrides: Record<string, unknown> = {}) {
  return {
    configured_at: new Date('2026-08-22T19:30:00.000Z'),
    configuration_reason: 'initial_configuration',
    platform_agent_account_id: '33333333-3333-4333-8333-333333333333',
    platform_code: 'kemerbet',
    profile_contract_version: 1,
    profile_label: 'Primary KemerBet agent revision 1',
    profile_revision: 1,
    profile_status: 'active',
    retired_at: null,
    ...overrides,
  };
}

describe('Owner KemerBet agent-profile PostgreSQL adapter', () => {
  it('prepares only an opaque database profile and returns the redacted projection', async () => {
    const query = vi.fn<OwnerKemerbetAgentProfileDatabase['query']>(async (sql, values) => {
      expect(sql).toContain('prepare_owner_kemerbet_agent_profile');
      expect(values).toEqual([authUserId, requestId, 'initial_configuration']);
      expect(JSON.stringify(values)).not.toMatch(/password|cookie|otp|session/iu);
      return { rows: [row()] };
    });
    const profiles = new PostgresOwnerKemerbetAgentProfiles({ query });

    await expect(
      profiles.prepare(authUserId, { configurationReason: 'initial_configuration', requestId }),
    ).resolves.toEqual({
      configuredAt: '2026-08-22T19:30:00.000Z',
      configurationReason: 'initial_configuration',
      platformAgentAccountId: '33333333-3333-4333-8333-333333333333',
      platformCode: 'kemerbet',
      profileContractVersion: 1,
      profileLabel: 'Primary KemerBet agent revision 1',
      profileRevision: 1,
      profileStatus: 'active',
    });
  });

  it('lists active and retired immutable revisions without credential references', async () => {
    const profiles = new PostgresOwnerKemerbetAgentProfiles({
      query: async () => ({
        rows: [
          row(),
          row({
            platform_agent_account_id: '44444444-4444-4444-8444-444444444444',
            profile_label: 'Primary KemerBet agent revision 2',
            profile_revision: 2,
            profile_status: 'inactive',
            retired_at: new Date('2026-08-22T20:30:00.000Z'),
          }),
        ],
      }),
    });
    const result = await profiles.list(authUserId);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      profileStatus: 'inactive',
      retiredAt: '2026-08-22T20:30:00.000Z',
    });
    expect(JSON.stringify(result)).not.toMatch(/credential|password|cookie|otp/iu);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('calls the dedicated claim-bound recovery RPC and accepts only its strictly fresh profile', async () => {
    const query = vi.fn<OwnerKemerbetAgentProfileDatabase['query']>(async (sql, values) => {
      expect(sql).toContain('app.recover_owner_kemerbet_quarantined_agent_profile');
      expect(sql).toContain('quarantined_platform_agent_account_id');
      expect(sql).toContain('quarantined_profile_revision');
      expect(sql).not.toContain('app.prepare_owner_kemerbet_agent_profile');
      expect(sql).not.toContain('app.record_owner_kemerbet_readiness_cohort_root_receipt');
      expect(values).toEqual([authUserId, claimId, requestId]);
      expect(JSON.stringify(values)).not.toMatch(/password|cookie|otp|session|player|amount/iu);
      return {
        rows: [
          row({
            configured_at: new Date('2026-08-28T15:00:00.000Z'),
            configuration_reason: 'security_recovery',
            platform_agent_account_id: '44444444-4444-4444-8444-444444444444',
            profile_label: 'Primary KemerBet agent revision 2',
            profile_revision: 2,
            quarantined_platform_agent_account_id: '33333333-3333-4333-8333-333333333333',
            quarantined_profile_revision: 1,
            recovered_claim_id: claimId,
            recovery_request_id: requestId,
            terminal_receipt_id: canonicalReceiptId,
            terminal_receipt_recorded_at: new Date('2026-08-28T14:59:59.000Z'),
          }),
        ],
      };
    });
    const profiles = new PostgresOwnerKemerbetAgentProfiles({ query });

    await expect(profiles.recover(authUserId, { claimId, receiptId: requestId })).resolves.toEqual({
      claimId,
      profile: {
        configuredAt: '2026-08-28T15:00:00.000Z',
        configurationReason: 'security_recovery',
        platformAgentAccountId: '44444444-4444-4444-8444-444444444444',
        platformCode: 'kemerbet',
        profileContractVersion: 1,
        profileLabel: 'Primary KemerBet agent revision 2',
        profileRevision: 2,
        profileStatus: 'active',
      },
      receiptId: canonicalReceiptId,
      recordedAt: '2026-08-28T14:59:59.000Z',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps lost-response retries claim-canonical without creating another profile revision', () => {
    expect(recoveryMigrationSource).toContain(
      'create table app.private_owner_kemerbet_quarantine_recovery_requests',
    );
    expect(recoveryMigrationSource).toContain('where recovery.claim_id = p_claim_id');
    expect(recoveryMigrationSource).toContain('canonical_recovery_request_id');
    expect(recoveryMigrationSource).toContain(
      'insert into app.private_owner_kemerbet_quarantine_recovery_requests',
    );
    expect(recoveryMigrationSource).toContain('select p_recovery_request_id,');
    expect(recoveryMigrationSource).not.toContain(
      'The exact KemerBet readiness claim is already bound to another recovery request.',
    );
    expect(recoveryMigrationSource).toContain(
      'create constraint trigger private_owner_kemerbet_security_recovery_claim_binding',
    );
    expect(recoveryMigrationSource).toContain(
      'A KemerBet security-recovery profile requires one exact claim-bound recovery.',
    );
    expect(recoveryMigrationSource).toContain(
      'recovery.recovered_profile_configuration_request_id = new.configuration_request_id',
    );
  });

  it('rejects the legacy unbound security-recovery preparation path before PostgreSQL', async () => {
    const query = vi.fn<OwnerKemerbetAgentProfileDatabase['query']>();
    const profiles = new PostgresOwnerKemerbetAgentProfiles({ query });

    await expect(
      profiles.prepare(authUserId, {
        configurationReason: 'security_recovery',
        requestId,
      }),
    ).rejects.toBeInstanceOf(OwnerKemerbetAgentProfileRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed if recovery reuses the quarantined identity or does not increase its revision', async () => {
    const baseRecoveryRow = {
      configured_at: new Date('2026-08-28T15:00:00.000Z'),
      configuration_reason: 'security_recovery',
      platform_agent_account_id: '44444444-4444-4444-8444-444444444444',
      profile_label: 'Primary KemerBet agent revision 2',
      profile_revision: 2,
      quarantined_platform_agent_account_id: '33333333-3333-4333-8333-333333333333',
      quarantined_profile_revision: 1,
      recovered_claim_id: claimId,
      recovery_request_id: requestId,
      terminal_receipt_id: canonicalReceiptId,
      terminal_receipt_recorded_at: new Date('2026-08-28T14:59:59.000Z'),
    };
    const sameIdentity = new PostgresOwnerKemerbetAgentProfiles({
      query: async () => ({
        rows: [
          row({
            ...baseRecoveryRow,
            platform_agent_account_id: baseRecoveryRow.quarantined_platform_agent_account_id,
          }),
        ],
      }),
    });
    await expect(
      sameIdentity.recover(authUserId, { claimId, receiptId: requestId }),
    ).rejects.toBeInstanceOf(OwnerKemerbetAgentProfileUnavailableError);

    const staleRevision = new PostgresOwnerKemerbetAgentProfiles({
      query: async () => ({
        rows: [
          row({
            ...baseRecoveryRow,
            profile_label: 'Primary KemerBet agent revision 1',
            profile_revision: 1,
          }),
        ],
      }),
    });
    await expect(
      staleRevision.recover(authUserId, { claimId, receiptId: requestId }),
    ).rejects.toBeInstanceOf(OwnerKemerbetAgentProfileUnavailableError);
  });

  it('rejects malformed input before PostgreSQL and fails closed on malformed rows', async () => {
    const query = vi.fn<OwnerKemerbetAgentProfileDatabase['query']>();
    const profiles = new PostgresOwnerKemerbetAgentProfiles({ query });
    await expect(
      profiles.prepare(authUserId, {
        configurationReason: 'initial_configuration',
        requestId: 'not-a-uuid',
      }),
    ).rejects.toBeInstanceOf(OwnerKemerbetAgentProfileRejectedError);
    await expect(
      profiles.recover(authUserId, { claimId, receiptId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(OwnerKemerbetAgentProfileRejectedError);
    expect(query).not.toHaveBeenCalled();

    const malformed = new PostgresOwnerKemerbetAgentProfiles({
      query: async () => ({ rows: [row({ profile_contract_version: 2 })] }),
    });
    await expect(malformed.list(authUserId)).rejects.toBeInstanceOf(
      OwnerKemerbetAgentProfileUnavailableError,
    );
  });
});
