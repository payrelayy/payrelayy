import { createHash } from 'node:crypto';

import {
  verifyReceiverSmsStatus,
  type ReceiverSmsVerifiedStatus,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';

export const RECEIVER_SMS_STATUS_PATH = '/v1/receiver-sms/status:report' as const;
export const RECEIVER_SMS_STATUS_CONTENT_TYPE =
  'application/vnd.fetanagent.receiver-sms-status.v1+json' as const;

export interface ReceiverSmsStatusDependencies {
  readonly now: () => string;
  loadEnrollment(deviceId: string): Promise<unknown | undefined>;
  recordStatus(input: {
    readonly publicKeySpki: string;
    readonly signedStatus: unknown;
    readonly verified: ReceiverSmsVerifiedStatus;
    readonly devicePublicKeySpkiSha256: string;
  }): Promise<'recorded' | 'review'>;
}

function response(statusCode: number, body: unknown): TelebirrDeviceBridgeHttpResponse {
  return Object.freeze({
    statusCode,
    headers: Object.freeze({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'content-type': RECEIVER_SMS_STATUS_CONTENT_TYPE,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    }),
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  });
}

/** The public bridge verifies before forwarding to the independent private broker. */
export function createReceiverSmsStatusBridgeHandler(dependencies: ReceiverSmsStatusDependencies) {
  return async (
    request: TelebirrDeviceBridgeHttpRequest,
  ): Promise<TelebirrDeviceBridgeHttpResponse> => {
    try {
      if (
        request.method !== 'POST' ||
        request.path !== RECEIVER_SMS_STATUS_PATH ||
        request.body.byteLength < 1 ||
        request.body.byteLength > 4_096
      )
        return response(400, { code: 'invalid_request' });
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(request.body);
      const value: unknown = JSON.parse(raw);
      if (
        JSON.stringify(value) !== raw ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'publicKeySpki,signedStatus'
      )
        return response(400, { code: 'invalid_request' });
      const body = value as Record<string, unknown>;
      if (
        typeof body.publicKeySpki !== 'string' ||
        !/^[A-Za-z0-9_-]{86,684}$/u.test(body.publicKeySpki)
      )
        return response(400, { code: 'invalid_request' });
      const key = Buffer.from(body.publicKeySpki, 'base64url');
      const status = body.signedStatus as Record<string, unknown> | undefined;
      const signedBody = status?.body as Record<string, unknown> | undefined;
      if (
        key.toString('base64url') !== body.publicKeySpki ||
        typeof signedBody?.deviceId !== 'string'
      )
        return response(400, { code: 'invalid_request' });
      const enrollment = await dependencies.loadEnrollment(signedBody.deviceId);
      if (!enrollment) return response(401, { code: 'device_unavailable' });
      const verified = verifyReceiverSmsStatus(
        body.signedStatus,
        key,
        enrollment,
        dependencies.now(),
      );
      if (!verified) return response(403, { code: 'sms_event_review' });
      const result = await dependencies.recordStatus({
        publicKeySpki: body.publicKeySpki,
        signedStatus: body.signedStatus,
        verified,
        devicePublicKeySpkiSha256: `sha256:${createHash('sha256').update(key).digest('hex')}`,
      });
      if (result !== 'recorded') return response(409, { code: 'sms_conflict' });
      return response(202, {
        outcome: 'receiver_sms_status_recorded',
        advisoryOnly: true,
        financialActionAllowed: false,
      });
    } catch {
      return response(503, { code: 'temporarily_unavailable' });
    }
  };
}
