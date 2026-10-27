import { createHash } from 'node:crypto';

import { fingerprintDepositProofReference } from '@fetanagent/deposit-reference-protection';
import { protectReceiverSmsDisplayReference } from '@fetanagent/deposit-reference-protection/owner-payment-display';

import {
  verifyReceiverSmsEvent,
  type ReceiverSmsVerifiedEvent,
  type ReceiverSmsVerifiedPayment,
} from '@fetanagent/telebirr-verification-foundation';

export interface ReceiverSmsIngestDatabase {
  loadEnrollment(deviceId: string): Promise<unknown | undefined>;
  recordPayment(input: {
    readonly event: ReceiverSmsVerifiedEvent;
    readonly payment: ReceiverSmsVerifiedPayment;
    readonly devicePublicKeySpkiSha256: string;
    readonly referenceDigest: string;
    readonly referenceFingerprint: string;
    readonly displayReference?: {
      readonly ciphertext: string;
      readonly masked: string;
    };
  }): Promise<'recorded' | 'exact_replay' | 'conflict'>;
}

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SPKI = /^[A-Za-z0-9_-]{86,684}$/u;

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/** Rechecks the signed event against the private database enrollment before storing it. */
export function createReceiverSmsIngestBroker(
  database: ReceiverSmsIngestDatabase,
  now: () => string,
  fingerprintSecret: string,
  displayEncryptionSecret?: string,
) {
  if (
    !database ||
    typeof database.loadEnrollment !== 'function' ||
    typeof database.recordPayment !== 'function' ||
    typeof now !== 'function' ||
    !/^[0-9a-f]{64}$/u.test(fingerprintSecret) ||
    (displayEncryptionSecret !== undefined &&
      (!/^[0-9a-f]{64}$/u.test(displayEncryptionSecret) ||
        displayEncryptionSecret === fingerprintSecret))
  )
    throw new Error();
  return Object.freeze({
    async loadEnrollment(deviceId: string): Promise<unknown | undefined> {
      if (!DEVICE_ID.test(deviceId)) throw new Error();
      return database.loadEnrollment(deviceId);
    },
    async verifyAndRecord(input: {
      readonly publicKeySpki: string;
      readonly signedEvent: unknown;
    }): Promise<'recorded' | 'exact_replay' | 'conflict' | 'review'> {
      if (!SPKI.test(input.publicKeySpki)) return 'review';
      const key = Buffer.from(input.publicKeySpki, 'base64url');
      if (key.toString('base64url') !== input.publicKeySpki) return 'review';
      const body =
        input.signedEvent && typeof input.signedEvent === 'object' && 'body' in input.signedEvent
          ? input.signedEvent.body
          : undefined;
      const deviceId =
        body && typeof body === 'object' && 'deviceId' in body ? body.deviceId : undefined;
      if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) return 'review';
      const trustedEnrollment = await database.loadEnrollment(deviceId);
      if (!trustedEnrollment) return 'review';
      let payment: ReceiverSmsVerifiedPayment | undefined;
      const assessment = verifyReceiverSmsEvent(
        {
          assessedAt: now(),
          trustedEnrollment,
          signedEvent: input.signedEvent,
        },
        key,
        (value) => {
          payment = value;
        },
      );
      if (assessment.disposition !== 'verified_phone_sms' || !assessment.event || !payment)
        return 'review';
      const devicePublicKeySpkiSha256 = `sha256:${createHash('sha256').update(key).digest('hex')}`;
      return database.recordPayment({
        event: assessment.event,
        payment,
        devicePublicKeySpkiSha256,
        referenceDigest: digest(payment.transactionReference),
        referenceFingerprint: fingerprintDepositProofReference({
          provider: payment.providerCode,
          reference: payment.transactionReference,
          fingerprintSecret,
        }),
        ...(displayEncryptionSecret
          ? {
              displayReference: protectReceiverSmsDisplayReference({
                provider: payment.providerCode,
                reference: payment.transactionReference,
                encryptionSecret: displayEncryptionSecret,
              }),
            }
          : {}),
      });
    },
  });
}
