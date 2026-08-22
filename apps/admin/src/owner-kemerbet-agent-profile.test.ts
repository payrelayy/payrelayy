import { describe, expect, it, vi } from 'vitest';

import {
  OwnerKemerbetAgentProfileRejectedError,
  OwnerKemerbetAgentProfileUnavailableError,
  PostgresOwnerKemerbetAgentProfiles,
  type OwnerKemerbetAgentProfileDatabase,
} from './owner-kemerbet-agent-profile.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';

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

  it('rejects malformed input before PostgreSQL and fails closed on malformed rows', async () => {
    const query = vi.fn<OwnerKemerbetAgentProfileDatabase['query']>();
    const profiles = new PostgresOwnerKemerbetAgentProfiles({ query });
    await expect(
      profiles.prepare(authUserId, {
        configurationReason: 'initial_configuration',
        requestId: 'not-a-uuid',
      }),
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
