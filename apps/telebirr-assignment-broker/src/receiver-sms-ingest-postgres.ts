import type { ReceiverSmsIngestDatabase } from './receiver-sms-ingest-broker.js';

export interface ReceiverSmsIngestSqlClient {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

const LOAD = 'select * from app.load_receiver_sms_device_enrollment($1::text)';
const RECORD = `select app.record_receiver_sms_payment_event(
  $1::text,$2::text,$3::text,$4::bigint,$5::timestamptz,$6::timestamptz,$7::timestamptz,
  $8::text,$9::text,$10::text,$11::text,$12::text,$13::integer) as status`;
const RECORD_WITH_DISPLAY = `select app.record_receiver_sms_payment_event_with_display(
  $1::text,$2::text,$3::text,$4::bigint,$5::timestamptz,$6::timestamptz,$7::timestamptz,
  $8::text,$9::text,$10::text,$11::text,$12::text,$13::integer,
  $14::text,$15::text) as status`;

function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? (value as Record<string, unknown>)
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime()) && date.toISOString() === value) return value;
  }
  return undefined;
}

/** Exact, parameterized calls; the runtime has no table access or credit grant. */
export function createReceiverSmsIngestPostgresDatabase(
  client: ReceiverSmsIngestSqlClient,
): ReceiverSmsIngestDatabase {
  if (!client || typeof client.query !== 'function') throw new Error();
  return Object.freeze({
    async loadEnrollment(deviceId: string) {
      const result = await client.query(LOAD, [deviceId]);
      if (!Array.isArray(result.rows) || result.rows.length > 1) throw new Error();
      if (result.rows.length === 0) return undefined;
      const value = row(result.rows[0]);
      if (
        !value ||
        Object.keys(value).length !== 6 ||
        value.device_id !== deviceId ||
        typeof value.key_id !== 'string' ||
        typeof value.public_key_spki_sha256 !== 'string' ||
        value.state !== 'active'
      )
        throw new Error();
      const validFrom = timestamp(value.valid_from);
      const validUntil = timestamp(value.valid_until);
      if (!validFrom || !validUntil) throw new Error();
      return {
        deviceId: value.device_id,
        keyId: value.key_id,
        publicKeySpkiSha256: value.public_key_spki_sha256,
        state: 'active',
        validFrom,
        validUntil,
      };
    },
    async recordPayment(input: Parameters<ReceiverSmsIngestDatabase['recordPayment']>[0]) {
      const { event, payment } = input;
      const result = await client.query(input.displayReference ? RECORD_WITH_DISPLAY : RECORD, [
        payment.providerCode,
        input.referenceDigest,
        input.referenceFingerprint,
        payment.amountMinor,
        payment.occurredAt,
        event.receivedAt,
        event.observedAt,
        event.sourceMessageDigest,
        event.eventBodyDigest,
        event.deviceId,
        event.keyId,
        input.devicePublicKeySpkiSha256,
        event.sourceSubscriptionId,
        ...(input.displayReference
          ? [input.displayReference.ciphertext, input.displayReference.masked]
          : []),
      ]);
      if (!Array.isArray(result.rows) || result.rows.length !== 1) throw new Error();
      const value = row(result.rows[0]);
      if (
        !value ||
        Object.keys(value).length !== 1 ||
        (value.status !== 'recorded' &&
          value.status !== 'exact_replay' &&
          value.status !== 'conflict')
      )
        throw new Error();
      return value.status;
    },
  });
}
