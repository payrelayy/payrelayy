import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { isProxy } from 'node:util/types';

import {
  CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE,
  type CbeBirrAuthoritativeReceiptInternalTransport,
  type CbeBirrAuthoritativeReceiptInternalTransportResult,
  type CbeBirrAuthoritativeReceiptTransportFailureReason,
  type SensitiveCbeBirrAuthoritativeReceiptRequestPlan,
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
} from './shared.js';

interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface CbeBirrNodeHttpsOpenOptions {
  readonly protocol: 'https:';
  readonly hostname: 'cbepay1.cbe.com.et';
  readonly servername: 'cbepay1.cbe.com.et';
  readonly port: 443;
  readonly method: 'GET';
  readonly path: string;
  readonly headers: Readonly<{
    accept: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE;
    'accept-encoding': 'identity';
    connection: 'close';
  }>;
  readonly agent: false;
  readonly rejectUnauthorized: true;
  readonly minVersion: 'TLSv1.2';
  readonly maxHeaderSize: number;
  readonly signal: AbortSignal;
  readonly pinnedAddress: string;
  readonly pinnedAddressFamily: 4 | 6;
}

export interface CbeBirrNodeHttpsRawResponse {
  readonly statusCode: unknown;
  readonly rawHeaders: unknown;
  readonly body: AsyncIterable<unknown>;
  destroy(): void;
}

interface TimerHandle {
  unref?(): void;
}

export interface CbeBirrNodeHttpsDependencies {
  readonly resolve: (hostname: string) => Promise<unknown>;
  readonly open: (options: CbeBirrNodeHttpsOpenOptions) => Promise<CbeBirrNodeHttpsRawResponse>;
  readonly scheduleTimeout: (callback: () => void, milliseconds: number) => TimerHandle;
  readonly cancelTimeout: (handle: TimerHandle) => void;
}

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
const allowedGlobalIpv6Addresses = new BlockList();

// IANA IPv6 Global Unicast Address Space registry, last updated 2025-10-10. The architectural
// 2000::/3 range is only assignable space; IANA reserves every part not listed as ALLOCATED.
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:200::', 23],
  ['2001:400::', 23],
  ['2001:600::', 23],
  ['2001:800::', 22],
  ['2001:c00::', 23],
  ['2001:e00::', 23],
  ['2001:1200::', 23],
  ['2001:1400::', 22],
  ['2001:1800::', 23],
  ['2001:1a00::', 23],
  ['2001:1c00::', 22],
  ['2001:2000::', 19],
  ['2001:4000::', 23],
  ['2001:4200::', 23],
  ['2001:4400::', 23],
  ['2001:4600::', 23],
  ['2001:4800::', 23],
  ['2001:4a00::', 23],
  ['2001:4c00::', 23],
  ['2001:5000::', 20],
  ['2001:8000::', 19],
  ['2001:a000::', 20],
  ['2001:b000::', 20],
  ['2002::', 16],
  ['2003::', 18],
  ['2400::', 12],
  ['2410::', 12],
  ['2600::', 12],
  ['2610::', 23],
  ['2620::', 23],
  ['2630::', 12],
  ['2800::', 12],
  ['2a00::', 12],
  ['2a10::', 12],
  ['2c00::', 12],
] as const) {
  allowedGlobalIpv6Addresses.addSubnet(network, prefix, 'ipv6');
}

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6');
}

function transportFailure(
  reasonCode: CbeBirrAuthoritativeReceiptTransportFailureReason,
): CbeBirrAuthoritativeReceiptInternalTransportResult {
  return Object.freeze({ ok: false as const, reasonCode });
}

function parseResolvedAddresses(
  candidate: unknown,
):
  | { readonly kind: 'valid'; readonly addresses: readonly ResolvedAddress[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unsafe' } {
  if (
    !Array.isArray(candidate) ||
    isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Array.prototype ||
    candidate.length < 1 ||
    candidate.length > 8
  ) {
    return { kind: 'invalid' };
  }

  const addresses: ResolvedAddress[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < candidate.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value') ||
      !isPlainNonProxyRecord(descriptor.value) ||
      !hasExactEnumerableDataKeys(descriptor.value, ['address', 'family'])
    ) {
      return { kind: 'invalid' };
    }

    const address = ownDataValue(descriptor.value, 'address');
    const family = ownDataValue(descriptor.value, 'family');
    if (
      typeof address !== 'string' ||
      (family !== 4 && family !== 6) ||
      isIP(address) !== family ||
      seen.has(`${family}:${address}`)
    ) {
      return { kind: 'invalid' };
    }
    const addressBlocked =
      family === 4
        ? blockedIpv4Addresses.check(address, 'ipv4')
        : !allowedGlobalIpv6Addresses.check(address, 'ipv6') ||
          blockedIpv6Addresses.check(address, 'ipv6');
    if (addressBlocked) {
      return { kind: 'unsafe' };
    }
    seen.add(`${family}:${address}`);
    addresses.push(Object.freeze({ address, family }));
  }

  return { kind: 'valid', addresses: Object.freeze(addresses) };
}

function exactArrayDataValues(candidate: unknown): readonly unknown[] | undefined {
  if (
    !Array.isArray(candidate) ||
    isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Array.prototype
  ) {
    return undefined;
  }
  const values: unknown[] = [];
  for (let index = 0; index < candidate.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    values.push(descriptor.value as unknown);
  }
  const keys = Reflect.ownKeys(candidate);
  if (keys.length !== candidate.length + 1 || !keys.includes('length')) return undefined;
  return values;
}

interface ParsedHeaders {
  readonly contentLength: number | undefined;
}

function parseResponseHeaders(
  rawHeadersCandidate: unknown,
  plan: SensitiveCbeBirrAuthoritativeReceiptRequestPlan,
):
  | { readonly ok: true; readonly headers: ParsedHeaders }
  | { readonly ok: false; readonly reasonCode: CbeBirrAuthoritativeReceiptTransportFailureReason } {
  const rawHeaders = exactArrayDataValues(rawHeadersCandidate);
  if (!rawHeaders || rawHeaders.length % 2 !== 0 || rawHeaders.length / 2 > plan.maxHeaderPairs) {
    return { ok: false, reasonCode: 'response_headers_rejected' };
  }

  const values = new Map<string, string[]>();
  let headerBytes = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const nameCandidate = rawHeaders[index];
    const valueCandidate = rawHeaders[index + 1];
    if (
      typeof nameCandidate !== 'string' ||
      typeof valueCandidate !== 'string' ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(nameCandidate) ||
      /[\u0000-\u001F\u007F]/u.test(valueCandidate)
    ) {
      return { ok: false, reasonCode: 'response_headers_rejected' };
    }
    headerBytes += new TextEncoder().encode(`${nameCandidate}: ${valueCandidate}\r\n`).byteLength;
    if (headerBytes > plan.maxHeaderBytes) {
      return { ok: false, reasonCode: 'response_headers_rejected' };
    }
    const name = nameCandidate.toLowerCase();
    const existing = values.get(name) ?? [];
    existing.push(valueCandidate);
    values.set(name, existing);
  }

  const contentTypes = values.get('content-type');
  if (
    contentTypes?.length !== 1 ||
    contentTypes[0]!.trim().toLowerCase() !== CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE
  ) {
    return { ok: false, reasonCode: 'content_type_rejected' };
  }

  const contentEncodings = values.get('content-encoding');
  if (
    contentEncodings !== undefined &&
    (contentEncodings.length !== 1 || contentEncodings[0]?.trim().toLowerCase() !== 'identity')
  ) {
    return { ok: false, reasonCode: 'content_encoding_rejected' };
  }

  const contentDispositions = values.get('content-disposition');
  if (contentDispositions !== undefined && contentDispositions.length !== 1) {
    return { ok: false, reasonCode: 'response_headers_rejected' };
  }

  if (
    values.has('location') ||
    values.has('set-cookie') ||
    (values.has('content-length') && values.has('transfer-encoding'))
  ) {
    return { ok: false, reasonCode: 'response_headers_rejected' };
  }

  const contentLengths = values.get('content-length');
  let contentLength: number | undefined;
  if (contentLengths !== undefined) {
    if (contentLengths.length !== 1 || !/^(?:0|[1-9][0-9]{0,9})$/u.test(contentLengths[0]!)) {
      return { ok: false, reasonCode: 'response_headers_rejected' };
    }
    contentLength = Number(contentLengths[0]);
    if (!Number.isSafeInteger(contentLength)) {
      return { ok: false, reasonCode: 'response_headers_rejected' };
    }
    if (contentLength > plan.maxResponseBytes) {
      return { ok: false, reasonCode: 'response_too_large' };
    }
  }

  return { ok: true, headers: Object.freeze({ contentLength }) };
}

function statusCode(candidate: unknown): number | undefined {
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 100 &&
    candidate <= 599
    ? candidate
    : undefined;
}

function ownErrorCode(candidate: unknown): string | undefined {
  try {
    if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(candidate, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function requestFailureReason(error: unknown): CbeBirrAuthoritativeReceiptTransportFailureReason {
  const code = ownErrorCode(error);
  if (
    code !== undefined &&
    (code.startsWith('ERR_TLS_') ||
      code.startsWith('ERR_SSL_') ||
      new Set([
        'CERT_HAS_EXPIRED',
        'CERT_NOT_YET_VALID',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_GET_ISSUER_CERT',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      ]).has(code))
  ) {
    return 'tls_validation_failed';
  }
  return 'network_request_failed';
}

async function collectBody(
  response: CbeBirrNodeHttpsRawResponse,
  expectedLength: number | undefined,
  plan: SensitiveCbeBirrAuthoritativeReceiptRequestPlan,
  signal: AbortSignal,
): Promise<CbeBirrAuthoritativeReceiptInternalTransportResult> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for await (const chunk of response.body) {
      if (signal.aborted) {
        destroyResponse(response);
        return transportFailure('transport_timeout');
      }
      if (!(chunk instanceof Uint8Array) || isProxy(chunk)) {
        destroyResponse(response);
        return transportFailure('response_stream_failed');
      }
      byteLength += chunk.byteLength;
      if (byteLength > plan.maxResponseBytes) {
        destroyResponse(response);
        return transportFailure('response_too_large');
      }
      chunks.push(Uint8Array.from(chunk));
    }
  } catch {
    destroyResponse(response);
    return signal.aborted
      ? transportFailure('transport_timeout')
      : transportFailure('response_stream_failed');
  }

  if (expectedLength !== undefined && expectedLength !== byteLength) {
    destroyResponse(response);
    return transportFailure('response_stream_failed');
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Object.freeze({ ok: true as const, body });
}

function destroyResponse(response: CbeBirrNodeHttpsRawResponse): void {
  try {
    response.destroy();
  } catch {
    // A cleanup failure must not replace the already classified transport failure.
  }
}

async function executeWithinPolicy(
  plan: SensitiveCbeBirrAuthoritativeReceiptRequestPlan,
  dependencies: CbeBirrNodeHttpsDependencies,
  signal: AbortSignal,
): Promise<CbeBirrAuthoritativeReceiptInternalTransportResult> {
  let resolvedCandidate: unknown;
  try {
    resolvedCandidate = await dependencies.resolve(plan.host);
  } catch {
    return transportFailure('dns_resolution_failed');
  }
  if (signal.aborted) return transportFailure('transport_timeout');

  const resolved = parseResolvedAddresses(resolvedCandidate);
  if (resolved.kind === 'invalid') return transportFailure('dns_resolution_failed');
  if (resolved.kind === 'unsafe') return transportFailure('resolved_address_rejected');
  const pinned = resolved.addresses[0]!;

  let response: CbeBirrNodeHttpsRawResponse;
  try {
    response = await dependencies.open(
      Object.freeze({
        protocol: 'https:' as const,
        hostname: plan.host,
        servername: plan.host,
        port: plan.port,
        method: plan.method,
        path: plan.pathAndQuery,
        headers: plan.headers,
        agent: false as const,
        rejectUnauthorized: true as const,
        minVersion: 'TLSv1.2' as const,
        maxHeaderSize: plan.maxHeaderBytes,
        signal,
        pinnedAddress: pinned.address,
        pinnedAddressFamily: pinned.family,
      }),
    );
  } catch (error) {
    return signal.aborted
      ? transportFailure('transport_timeout')
      : transportFailure(requestFailureReason(error));
  }
  if (signal.aborted) {
    destroyResponse(response);
    return transportFailure('transport_timeout');
  }

  const responseStatus = statusCode(response.statusCode);
  if (responseStatus === undefined) {
    destroyResponse(response);
    return transportFailure('response_headers_rejected');
  }
  if (responseStatus >= 300 && responseStatus <= 399) {
    destroyResponse(response);
    return transportFailure('redirect_rejected');
  }
  if (responseStatus !== 200) {
    destroyResponse(response);
    return transportFailure('http_status_rejected');
  }

  const parsedHeaders = parseResponseHeaders(response.rawHeaders, plan);
  if (!parsedHeaders.ok) {
    destroyResponse(response);
    return transportFailure(parsedHeaders.reasonCode);
  }
  return collectBody(response, parsedHeaders.headers.contentLength, plan, signal);
}

/** Internal factory: package tests inject DNS/HTTPS primitives without touching the network. */
export function createCbeBirrNodeHttpsTransport(
  dependencies: CbeBirrNodeHttpsDependencies,
): CbeBirrAuthoritativeReceiptInternalTransport {
  return async (plan) => {
    const abortController = new AbortController();
    let timeoutHandle: TimerHandle | undefined;
    const timeoutResult = new Promise<CbeBirrAuthoritativeReceiptInternalTransportResult>(
      (resolve) => {
        timeoutHandle = dependencies.scheduleTimeout(() => {
          abortController.abort();
          resolve(transportFailure('transport_timeout'));
        }, plan.timeoutMs);
        timeoutHandle.unref?.();
      },
    );

    const operationResult = executeWithinPolicy(plan, dependencies, abortController.signal).catch(
      () => transportFailure('network_request_failed'),
    );
    const result = await Promise.race([operationResult, timeoutResult]);
    if (timeoutHandle !== undefined) dependencies.cancelTimeout(timeoutHandle);
    return result;
  };
}

const productionDependencies: CbeBirrNodeHttpsDependencies = {
  async resolve(hostname) {
    return dnsLookup(hostname, { all: true, verbatim: true });
  },
  open(options) {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        {
          protocol: options.protocol,
          hostname: options.hostname,
          servername: options.servername,
          port: options.port,
          method: options.method,
          path: options.path,
          headers: options.headers,
          agent: options.agent,
          rejectUnauthorized: options.rejectUnauthorized,
          minVersion: options.minVersion,
          maxHeaderSize: options.maxHeaderSize,
          signal: options.signal,
          family: options.pinnedAddressFamily,
          lookup(_hostname, _lookupOptions, callback) {
            callback(null, options.pinnedAddress, options.pinnedAddressFamily);
          },
        },
        (response) => {
          resolve({
            statusCode: response.statusCode,
            rawHeaders: response.rawHeaders,
            body: response,
            destroy() {
              response.destroy();
            },
          });
        },
      );
      request.maxHeadersCount = 32;
      request.once('error', reject);
      request.end();
    });
  },
  scheduleTimeout(callback, milliseconds) {
    return setTimeout(callback, milliseconds);
  },
  cancelTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export const cbeBirrNodeHttpsTransport = createCbeBirrNodeHttpsTransport(productionDependencies);
