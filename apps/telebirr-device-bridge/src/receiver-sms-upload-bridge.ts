import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  verifyReceiverSmsEvent,
  type ReceiverSmsVerifiedEvent,
  type ReceiverSmsVerifiedPayment,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';

export const RECEIVER_SMS_UPLOAD_PATH = '/v1/receiver-sms/events:upload' as const;
export const RECEIVER_SMS_UPLOAD_CONTENT_TYPE =
  'application/vnd.fetanagent.receiver-sms-event.v1+json' as const;
export const RECEIVER_SMS_UPLOAD_MAX_REQUEST_BYTES = 8 * 1_024;

const HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': RECEIVER_SMS_UPLOAD_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface ReceiverSmsUploadDependencies {
  readonly now: () => string;
  loadEnrollment(deviceId: string): Promise<unknown | undefined>;
  recordPayment(input: {
    readonly event: ReceiverSmsVerifiedEvent;
    readonly payment: ReceiverSmsVerifiedPayment;
    readonly devicePublicKeySpkiSha256: string;
    readonly publicKeySpki: string;
    readonly signedEvent: unknown;
  }): Promise<'recorded' | 'exact_replay' | 'conflict' | 'review' | 'retry'>;
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || isProxy(value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function exactRecord(value: unknown, keys: readonly string[]): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function parseCanonicalJson(bytes: Uint8Array): unknown {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!raw || raw.charCodeAt(0) === 0xfeff) return undefined;
    const value: unknown = JSON.parse(raw);
    return JSON.stringify(value) === raw ? value : undefined;
  } catch {
    return undefined;
  }
}

function publicKey(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86,684}$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength >= 64 &&
    decoded.byteLength <= 512 &&
    decoded.toString('base64url') === value
    ? decoded
    : undefined;
}

function validRequest(request: TelebirrDeviceBridgeHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    request.path !== RECEIVER_SMS_UPLOAD_PATH ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body) ||
    request.body.byteLength < 1 ||
    request.body.byteLength > RECEIVER_SMS_UPLOAD_MAX_REQUEST_BYTES ||
    !Array.isArray(request.headers) ||
    isProxy(request.headers)
  )
    return false;
  let contentTypeCount = 0;
  for (const header of request.headers) {
    if (
      !Array.isArray(header) ||
      isProxy(header) ||
      header.length !== 2 ||
      typeof header[0] !== 'string' ||
      typeof header[1] !== 'string'
    )
      return false;
    const name = header[0].toLowerCase();
    if (name === 'content-type') {
      contentTypeCount++;
      if (header[1] !== RECEIVER_SMS_UPLOAD_CONTENT_TYPE) return false;
    }
    if (name === 'content-encoding' || name === 'transfer-encoding') return false;
  }
  return contentTypeCount === 1;
}

function response(statusCode: number, body: unknown): TelebirrDeviceBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers: HEADERS,
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  });
}

function error(statusCode: number, code: string): TelebirrDeviceBridgeHttpResponse {
  return response(statusCode, { code });
}

/** Stores a signed phone fact. It never creates a claim, deposit job, or Player credit. */
export function createReceiverSmsUploadBridgeHandler(dependencies: ReceiverSmsUploadDependencies) {
  if (
    !dependencies ||
    typeof dependencies.now !== 'function' ||
    typeof dependencies.loadEnrollment !== 'function' ||
    typeof dependencies.recordPayment !== 'function'
  )
    throw new Error();
  return async (
    request: TelebirrDeviceBridgeHttpRequest,
  ): Promise<TelebirrDeviceBridgeHttpResponse> => {
    try {
      if (!validRequest(request)) return error(400, 'invalid_request');
      const parsed = parseCanonicalJson(request.body);
      if (!exactRecord(parsed, ['publicKeySpki', 'signedEvent']))
        return error(400, 'invalid_request');
      const key = publicKey(own(parsed, 'publicKeySpki'));
      const signedEvent = own(parsed, 'signedEvent');
      const deviceId = own(own(signedEvent, 'body'), 'deviceId');
      if (
        !key ||
        typeof deviceId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(deviceId)
      )
        return error(400, 'invalid_request');
      const trustedEnrollment = await dependencies.loadEnrollment(deviceId);
      if (!trustedEnrollment) return error(401, 'device_unavailable');
      let payment: ReceiverSmsVerifiedPayment | undefined;
      const verified = verifyReceiverSmsEvent(
        {
          assessedAt: dependencies.now(),
          trustedEnrollment,
          signedEvent,
        },
        key,
        (value) => {
          payment = value;
        },
      );
      if (verified.disposition !== 'verified_phone_sms' || !payment || !verified.event)
        return error(403, 'sms_event_review');
      const devicePublicKeySpkiSha256 = `sha256:${createHash('sha256').update(key).digest('hex')}`;
      const stored = await dependencies.recordPayment({
        event: verified.event,
        payment,
        devicePublicKeySpkiSha256,
        publicKeySpki: Buffer.from(key).toString('base64url'),
        signedEvent,
      });
      if (stored === 'retry') return error(503, 'temporarily_unavailable');
      if (stored === 'conflict' || stored === 'review') return error(409, 'sms_conflict');
      if (stored !== 'recorded' && stored !== 'exact_replay')
        return error(503, 'temporarily_unavailable');
      return response(202, {
        outcome: 'receiver_sms_recorded',
        advisoryOnly: true,
        pairedPhoneEvidenceVerified: true,
        sourceAuthenticationPerformed: false,
        financialActionAllowed: false,
      });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
  };
}
