import { request as httpRequest, type IncomingMessage } from 'node:http';

import {
  RECEIVER_SMS_LOCAL_CONTENT_TYPE,
  RECEIVER_SMS_LOCAL_MAX_BYTES,
  RECEIVER_SMS_LOCAL_PATH,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
} from '@fetanagent/telebirr-verification-foundation';

import type { ReceiverSmsUploadDependencies } from './receiver-sms-upload-bridge.js';

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function oneHeader(response: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    if (response.rawHeaders[index]?.toLowerCase() === name)
      values.push(response.rawHeaders[index + 1] ?? '');
  }
  return values.length === 1 ? values[0] : undefined;
}

async function exchange(operation: string, input: unknown): Promise<unknown> {
  const body = Buffer.from(JSON.stringify({ operation, input }), 'utf8');
  if (body.byteLength < 1 || body.byteLength > RECEIVER_SMS_LOCAL_MAX_BYTES) throw new Error();
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new Error('Private SMS broker unavailable'));
      }
    };
    const request = httpRequest(
      {
        agent: false,
        headers: {
          'content-length': String(body.byteLength),
          'content-type': RECEIVER_SMS_LOCAL_CONTENT_TYPE,
        },
        method: 'POST',
        path: RECEIVER_SMS_LOCAL_PATH,
        socketPath: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
        timeout: 5_000,
      },
      (response) => {
        const length = oneHeader(response, 'content-length');
        if (
          response.statusCode !== 200 ||
          oneHeader(response, 'content-type') !== RECEIVER_SMS_LOCAL_CONTENT_TYPE ||
          length === undefined ||
          !/^[1-9][0-9]{0,4}$/u.test(length) ||
          Number(length) > RECEIVER_SMS_LOCAL_MAX_BYTES ||
          response.headers['content-encoding'] !== undefined ||
          response.headers['transfer-encoding'] !== undefined
        ) {
          response.resume();
          fail();
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (part: Buffer | string) => {
          const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
          received += chunk.byteLength;
          if (received > Number(length)) {
            response.destroy();
            fail();
          } else chunks.push(chunk);
        });
        response.once('end', () => {
          if (settled || received !== Number(length)) {
            fail();
            return;
          }
          try {
            const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
              Buffer.concat(chunks, received),
            );
            if (!raw || raw.charCodeAt(0) === 0xfeff) {
              fail();
              return;
            }
            const value: unknown = JSON.parse(raw);
            if (JSON.stringify(value) !== raw) {
              fail();
              return;
            }
            settled = true;
            resolve(value);
          } catch {
            fail();
          }
        });
        response.once('aborted', fail);
        response.once('error', fail);
      },
    );
    request.once('timeout', () => {
      request.destroy();
      fail();
    });
    request.once('error', fail);
    request.end(body);
  });
}

/** Public bridge receives only metadata; the private broker rechecks the phone signature. */
export function createReceiverSmsUnixDependencies(
  now: () => string = () => new Date().toISOString(),
): ReceiverSmsUploadDependencies {
  return Object.freeze({
    now,
    async loadEnrollment(deviceId: string) {
      const result = await exchange('load_enrollment', { deviceId });
      if (exact(result, ['kind']) && result.kind === 'missing') return undefined;
      if (!exact(result, ['kind', 'enrollment']) || result.kind !== 'enrollment') throw new Error();
      return result.enrollment;
    },
    async recordPayment(input: Parameters<ReceiverSmsUploadDependencies['recordPayment']>[0]) {
      const result = await exchange('verify_and_record', {
        publicKeySpki: input.publicKeySpki,
        signedEvent: input.signedEvent,
      });
      if (
        !exact(result, ['kind']) ||
        (result.kind !== 'recorded' &&
          result.kind !== 'exact_replay' &&
          result.kind !== 'conflict' &&
          result.kind !== 'review')
      )
        throw new Error();
      return result.kind;
    },
  });
}
