import { describe, expect, it, vi } from 'vitest';

import {
  OwnerPrivateLivePilotRejectedError,
  OwnerPrivateLivePilotUnavailableError,
  PostgresOwnerPrivateLivePilotControl,
  type PreparePrivateLivePilotRequest,
  type PrivateLivePilotDatabase,
} from './owner-private-live-pilot.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-22aa-4bbb-8ccc-222222222222';
const pilotRevisionId = '33333333-3333-4333-8333-333333333333';

function preparation(
  overrides: Partial<PreparePrivateLivePilotRequest> = {},
): PreparePrivateLivePilotRequest {
  return {
    activeFrom: new Date('2026-08-21T20:00:00.000Z'),
    expiresAt: new Date('2026-08-21T22:00:00.000Z'),
    maximumAggregateMinor: 12_500,
    maximumPerDepositMinor: 2_500,
    maximumPerPlayerMinor: 2_500,
    maximumReservationCount: 5,
    minimumAmountMinor: 2_500,
    playerIds: ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
    providerCodes: ['telebirr'],
    requestId,
    submittingCustomerIds: ['44444444-4444-4444-8444-444444444444'],
    ...overrides,
  };
}

function statusRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configuration_digest: `sha256:${'a'.repeat(64)}`,
    contract_version: 1,
    expires_at: new Date('2026-08-21T22:00:00.000Z'),
    financially_active: false,
    maximum_aggregate_minor: '12500',
    maximum_reservation_count: 5,
    pilot_revision_id: pilotRevisionId,
    pilot_status: 'draft',
    player_count: 5,
    provider_count: 1,
    reserved_amount_minor: '0',
    reserved_deposit_count: 0,
    revision: 1,
    stop_reason_code: null,
    stopped_at: null,
    submitting_customer_count: 1,
    switch_mode: 'disabled',
    within_active_window: true,
    ...overrides,
  };
}

describe('Owner private live-deposit pilot PostgreSQL adapter', () => {
  it('prepares with one UUID-v4 request key and returns only the redacted aggregate status', async () => {
    const query = vi.fn<PrivateLivePilotDatabase['query']>(async (sql, values) => {
      if (sql.includes('prepare_private_live_deposit_pilot')) {
        expect(values).toEqual([
          authUserId,
          requestId,
          ['telebirr'],
          ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
          ['44444444-4444-4444-8444-444444444444'],
          2_500,
          2_500,
          2_500,
          12_500,
          5,
          new Date('2026-08-21T20:00:00.000Z'),
          new Date('2026-08-21T22:00:00.000Z'),
        ]);
        return { rows: [{ pilot_revision_id: pilotRevisionId }] };
      }
      expect(sql).toContain('get_private_live_deposit_pilot_status');
      return {
        rows: [
          statusRow({
            player_id: 'PLAYER-SECRET',
            protected_payment_reference: 'RAW-REFERENCE-SECRET',
            submitting_customer_id: '77777777-7777-4777-8777-777777777777',
          }),
        ],
      };
    });
    const control = new PostgresOwnerPrivateLivePilotControl({ query });

    const result = await control.prepare(authUserId, preparation());

    expect(result).toEqual({
      configurationDigest: `sha256:${'a'.repeat(64)}`,
      contractVersion: 1,
      expiresAt: '2026-08-21T22:00:00.000Z',
      financiallyActive: false,
      maximumAggregateMinor: '12500',
      maximumReservationCount: 5,
      pilotRevisionId,
      pilotStatus: 'draft',
      playerCount: 5,
      providerCount: 1,
      reservedAmountMinor: '0',
      reservedDepositCount: 0,
      revision: 1,
      submittingCustomerCount: 1,
      switchMode: 'disabled',
      withinActiveWindow: true,
    });
    expect(JSON.stringify(result)).not.toContain('PLAYER-1');
    expect(JSON.stringify(result)).not.toContain('PLAYER-SECRET');
    expect(JSON.stringify(result)).not.toContain('RAW-REFERENCE-SECRET');
    expect(JSON.stringify(result)).not.toContain('44444444-4444-4444-8444-444444444444');
    expect(JSON.stringify(result)).not.toContain('77777777-7777-4777-8777-777777777777');
  });

  it('rejects malformed, duplicated, or over-cap preparation before the database', async () => {
    const query = vi.fn<PrivateLivePilotDatabase['query']>();
    const control = new PostgresOwnerPrivateLivePilotControl({ query });
    const invalid = preparation({
      maximumAggregateMinor: 12_501,
      playerIds: ['PLAYER-1', 'PLAYER-1', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'],
    });

    await expect(control.prepare(authUserId, invalid)).rejects.toBeInstanceOf(
      OwnerPrivateLivePilotRejectedError,
    );
    await expect(
      control.prepare(authUserId, preparation({ requestId: requestId.toUpperCase() })),
    ).rejects.toBeInstanceOf(OwnerPrivateLivePilotRejectedError);
    expect(query).not.toHaveBeenCalled();
  });

  it('treats an already-armed pilot as a replay without invoking arm again', async () => {
    const query = vi.fn<PrivateLivePilotDatabase['query']>(async (sql) => {
      expect(sql).toContain('get_private_live_deposit_pilot_status');
      return {
        rows: [statusRow({ pilot_status: 'armed', switch_mode: 'dry_run' })],
      };
    });
    const control = new PostgresOwnerPrivateLivePilotControl({ query });

    const result = await control.arm(authUserId, pilotRevisionId);

    expect(result.alreadyApplied).toBe(true);
    expect(result.status).toMatchObject({
      financiallyActive: false,
      pilotStatus: 'armed',
      switchMode: 'dry_run',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed instead of accepting a live armed state as an arm replay', async () => {
    const query = vi.fn<PrivateLivePilotDatabase['query']>(async () => ({
      rows: [statusRow({ financially_active: true, pilot_status: 'armed', switch_mode: 'live' })],
    }));
    const control = new PostgresOwnerPrivateLivePilotControl({ query });

    await expect(control.arm(authUserId, pilotRevisionId)).rejects.toBeInstanceOf(
      OwnerPrivateLivePilotUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('proves a first arm can produce only a dormant dry-run status', async () => {
    let call = 0;
    const query = vi.fn<PrivateLivePilotDatabase['query']>(async (sql) => {
      call += 1;
      if (call === 1) return { rows: [statusRow()] };
      if (call === 2) {
        expect(sql).toContain('arm_private_live_deposit_pilot');
        return { rows: [{}] };
      }
      return { rows: [statusRow({ pilot_status: 'armed', switch_mode: 'dry_run' })] };
    });
    const control = new PostgresOwnerPrivateLivePilotControl({ query });

    await expect(control.arm(authUserId, pilotRevisionId)).resolves.toMatchObject({
      alreadyApplied: false,
      status: { financiallyActive: false, pilotStatus: 'armed', switchMode: 'dry_run' },
    });
  });

  it('recovers an ambiguous arm failure only from a dormant dry-run postcondition', async () => {
    let call = 0;
    const query = vi.fn<PrivateLivePilotDatabase['query']>(async () => {
      call += 1;
      if (call === 1) return { rows: [statusRow()] };
      if (call === 2) return Promise.reject({ code: 'P0001' });
      return { rows: [statusRow({ pilot_status: 'armed', switch_mode: 'dry_run' })] };
    });
    const control = new PostgresOwnerPrivateLivePilotControl({ query });

    await expect(control.arm(authUserId, pilotRevisionId)).resolves.toMatchObject({
      alreadyApplied: true,
      status: { financiallyActive: false, pilotStatus: 'armed', switchMode: 'dry_run' },
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('attempts emergency stop before status and validates the disabled postcondition', async () => {
    const calls: string[] = [];
    const query = vi.fn<PrivateLivePilotDatabase['query']>(async (sql) => {
      calls.push(sql);
      if (sql.includes('stop_private_live_deposit_pilot')) return { rows: [{}] };
      return {
        rows: [
          statusRow({
            pilot_status: 'stopped',
            stop_reason_code: 'execution_uncertainty',
            stopped_at: new Date('2026-08-21T20:30:00.000Z'),
          }),
        ],
      };
    });
    const control = new PostgresOwnerPrivateLivePilotControl({ query });

    const result = await control.stop(authUserId, pilotRevisionId, 'execution_uncertainty');

    expect(calls[0]).toContain('stop_private_live_deposit_pilot');
    expect(calls[1]).toContain('get_private_live_deposit_pilot_status');
    expect(result).toMatchObject({
      financiallyActive: false,
      pilotStatus: 'stopped',
      stopReasonCode: 'execution_uncertainty',
      switchMode: 'disabled',
    });
  });

  it('fails closed on a malformed or internally inconsistent database projection', async () => {
    const control = new PostgresOwnerPrivateLivePilotControl({
      query: async () => ({
        rows: [statusRow({ financially_active: true, switch_mode: 'dry_run' })],
      }),
    });

    await expect(control.status(authUserId, pilotRevisionId)).rejects.toBeInstanceOf(
      OwnerPrivateLivePilotUnavailableError,
    );

    const inconsistent = new PostgresOwnerPrivateLivePilotControl({
      query: async () => ({
        rows: [statusRow({ maximum_reservation_count: 1, reserved_deposit_count: 2 })],
      }),
    });
    await expect(inconsistent.status(authUserId, pilotRevisionId)).rejects.toBeInstanceOf(
      OwnerPrivateLivePilotUnavailableError,
    );
  });

  it('redacts database failures into fixed operation errors', async () => {
    const control = new PostgresOwnerPrivateLivePilotControl({
      query: async () =>
        Promise.reject({
          code: '08006',
          detail: 'PLAYER-SECRET RAW-REFERENCE-SECRET',
        }),
    });

    const failure = await control.status(authUserId, pilotRevisionId).catch((error) => error);
    expect(failure).toBeInstanceOf(OwnerPrivateLivePilotUnavailableError);
    expect(String(failure)).not.toContain('PLAYER-SECRET');
    expect(String(failure)).not.toContain('RAW-REFERENCE-SECRET');
  });
});
