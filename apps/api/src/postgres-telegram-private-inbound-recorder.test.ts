import { describe, expect, it } from 'vitest';

import type { TelegramPrivateInboundRecord } from './telegram-ingress.js';
import {
  PostgresTelegramPrivateInboundRecorder,
  TelegramPrivateInboundRecorderUnavailableError,
  type TelegramPrivateInboundRecordingDatabase,
} from './postgres-telegram-private-inbound-recorder.js';

const input: TelegramPrivateInboundRecord = {
  event: {
    version: 1,
    updateId: '123456',
    telegramUserId: '28379330',
    privateChatId: '28379330',
    firstName: 'Example',
    lastName: null,
    username: 'example_user',
    preferredLocale: 'en',
  },
  payloadHmac: `hmac-sha256-v1:${'a'.repeat(64)}`,
};

function createDatabase(result: { readonly rows: readonly unknown[] } | Error): {
  readonly database: TelegramPrivateInboundRecordingDatabase;
  readonly calls: Array<{ readonly query: string; readonly values: readonly unknown[] }>;
} {
  const calls: Array<{ readonly query: string; readonly values: readonly unknown[] }> = [];

  return {
    database: {
      async query(query, values) {
        calls.push({ query, values });
        if (result instanceof Error) throw result;
        return result;
      },
    },
    calls,
  };
}

describe('Postgres Telegram private inbound recorder', () => {
  it('calls only the private inbox procedure with allowlisted parameters', async () => {
    const fake = createDatabase({
      rows: [
        {
          inbound_event_already_recorded: false,
          inbound_event_id: '7ab4d794-0f51-4a3b-a99e-99204b1df174',
        },
      ],
    });
    const recorder = new PostgresTelegramPrivateInboundRecorder(fake.database);

    await expect(recorder.record(input)).resolves.toBeUndefined();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.query).toContain('app.record_telegram_private_inbound_event');
    expect(fake.calls[0]?.query).toContain('inbound_event_id');
    expect(fake.calls[0]?.query).toContain('inbound_event_already_recorded');
    expect(fake.calls[0]?.query).not.toContain('select *');
    expect(fake.calls[0]?.query).toContain('$1::bigint');
    expect(fake.calls[0]?.query).toContain('$8::text');
    expect(fake.calls[0]?.values).toEqual([
      '123456',
      '28379330',
      '28379330',
      `hmac-sha256-v1:${'a'.repeat(64)}`,
      'Example',
      'example_user',
      null,
      'en',
    ]);
  });

  it('accepts an exact idempotent replay response without retrying the procedure', async () => {
    const fake = createDatabase({
      rows: [
        {
          inbound_event_already_recorded: true,
          inbound_event_id: '7ab4d794-0f51-4a3b-a99e-99204b1df174',
        },
      ],
    });
    const recorder = new PostgresTelegramPrivateInboundRecorder(fake.database);

    await expect(recorder.record(input)).resolves.toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects invalid in-memory input before it reaches the database', async () => {
    const fake = createDatabase({ rows: [] });
    const recorder = new PostgresTelegramPrivateInboundRecorder(fake.database);
    const malformedLocaleInput = {
      ...input,
      event: { ...input.event, preferredLocale: 'am' },
    } as unknown as TelegramPrivateInboundRecord;

    await expect(recorder.record(malformedLocaleInput)).rejects.toBeInstanceOf(
      TelegramPrivateInboundRecorderUnavailableError,
    );
    expect(fake.calls).toEqual([]);
  });

  it('normalizes database and malformed-result failures into a generic unavailable error', async () => {
    const failing = createDatabase(new Error('synthetic connection detail'));
    const failingRecorder = new PostgresTelegramPrivateInboundRecorder(failing.database);

    await expect(failingRecorder.record(input)).rejects.toEqual(
      expect.objectContaining({
        message: 'The private Telegram inbound recorder is unavailable.',
        name: 'TelegramPrivateInboundRecorderUnavailableError',
      }),
    );

    const malformed = createDatabase({ rows: [{ inbound_event_already_recorded: 'true' }] });
    const malformedRecorder = new PostgresTelegramPrivateInboundRecorder(malformed.database);

    await expect(malformedRecorder.record(input)).rejects.toBeInstanceOf(
      TelegramPrivateInboundRecorderUnavailableError,
    );
  });
});
