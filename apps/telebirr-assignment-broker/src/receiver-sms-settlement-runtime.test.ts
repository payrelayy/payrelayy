import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  RECEIVER_SMS_SETTLEMENT_PREFLIGHT_SQL,
  createReceiverSmsSettlementRuntime,
  loadReceiverSmsSettlementConfig,
  type ReceiverSmsSettlementClient,
} from './receiver-sms-settlement-runtime.js';

const connection = {
  host: 'db.xzztugbgtulptnbpoelr.supabase.co',
  user: 'fetanagent_receiver_sms_settlement_runtime',
  password: 'synthetic-runtime-password',
  ca: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n',
};
const preflight = Object.fromEntries(
  [
    'identity',
    'runtime_safe',
    'group_safe',
    'membership_exact',
    'group_inherited',
    'schema_safe',
    'no_base_access',
    'function_hardened',
    'exact_function_surface',
  ].map((key) => [key, true]),
);

function fakeClient(outcome = 'empty', catalog = preflight) {
  const events = new EventEmitter();
  const query = vi.fn(async (sql: string) => ({
    rows: sql === RECEIVER_SMS_SETTLEMENT_PREFLIGHT_SQL ? [catalog] : [{ outcome }],
  }));
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client: ReceiverSmsSettlementClient = {
    query,
    connect,
    end,
    on: (event, listener) => {
      events.on(event, listener);
    },
    removeListener: (event, listener) => {
      events.removeListener(event, listener);
    },
  };
  return { client, query, connect, end, events };
}

describe('receiver SMS settlement runtime', () => {
  it('stays off without the explicit production flag', () => {
    expect(loadReceiverSmsSettlementConfig({})).toBeUndefined();
    expect(() =>
      loadReceiverSmsSettlementConfig({
        INTERNAL_RECEIVER_SMS_SETTLEMENT_ENABLED: 'true',
      }),
    ).toThrow(/unavailable/u);
  });

  it('requires an exact one-function catalog and serializes its polls', async () => {
    const fake = fakeClient('queued');
    const runtime = await createReceiverSmsSettlementRuntime(connection, () => fake.client);
    expect(await Promise.all([runtime.poll(), runtime.poll()])).toEqual(['queued', 'queued']);
    expect(
      fake.query.mock.calls.filter(
        ([sql]) => sql === 'select app.settle_next_receiver_sms_match() as outcome',
      ),
    ).toHaveLength(2);
    expect(await runtime.ready()).toBe(true);
    await runtime.close();
    expect(fake.end).toHaveBeenCalledOnce();
    await expect(runtime.poll()).rejects.toThrow(/unavailable/u);
  });

  it('fails closed on a changed catalog or response', async () => {
    const changed = fakeClient('queued', { ...preflight, exact_function_surface: false });
    await expect(
      createReceiverSmsSettlementRuntime(connection, () => changed.client),
    ).rejects.toThrow(/unavailable/u);
    expect(changed.end).toHaveBeenCalledOnce();
    const unexpected = fakeClient('credited');
    const runtime = await createReceiverSmsSettlementRuntime(connection, () => unexpected.client);
    await expect(runtime.poll()).rejects.toThrow(/unavailable/u);
    expect(await runtime.ready()).toBe(false);
    await runtime.close();
  });
});
