import { describe, expect, it } from 'vitest';

import {
  createCbeBirrNodeHttpsTransport,
  type CbeBirrNodeHttpsDependencies,
  type CbeBirrNodeHttpsOpenOptions,
  type CbeBirrNodeHttpsRawResponse,
} from './node-https-transport.js';
import { compileSensitiveRequestPlan, parseLookupInput } from './shared.js';
import {
  SYNTHETIC_PHONE,
  SYNTHETIC_REFERENCE,
  syntheticLookupInput,
  syntheticPdfEnvelope,
} from './test-helpers.js';

const plan = compileSensitiveRequestPlan(parseLookupInput(syntheticLookupInput)!);

function asyncChunks(...chunks: readonly unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function response(
  overrides: Partial<CbeBirrNodeHttpsRawResponse> = {},
): CbeBirrNodeHttpsRawResponse {
  return {
    statusCode: 200,
    rawHeaders: ['Content-Type', 'application/pdf'],
    body: asyncChunks(syntheticPdfEnvelope()),
    destroy() {},
    ...overrides,
  };
}

interface FakeState {
  resolvedHost?: string;
  openOptions?: CbeBirrNodeHttpsOpenOptions;
  openCalls: number;
  timeoutMilliseconds?: number;
  timeoutCancelled: number;
}

function dependencies(overrides: Partial<CbeBirrNodeHttpsDependencies> = {}): {
  readonly dependencies: CbeBirrNodeHttpsDependencies;
  readonly state: FakeState;
} {
  const state: FakeState = { openCalls: 0, timeoutCancelled: 0 };
  const defaults: CbeBirrNodeHttpsDependencies = {
    async resolve(hostname) {
      state.resolvedHost = hostname;
      return [
        { address: '8.8.8.8', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ];
    },
    async open(options) {
      state.openCalls += 1;
      state.openOptions = options;
      return response();
    },
    scheduleTimeout(_callback, milliseconds) {
      state.timeoutMilliseconds = milliseconds;
      return { unref() {} };
    },
    cancelTimeout() {
      state.timeoutCancelled += 1;
    },
  };
  return { dependencies: { ...defaults, ...overrides }, state };
}

describe('bounded Node HTTPS transport', () => {
  it('pins the first public DNS result and opens one exact certificate-validated HTTPS request', async () => {
    const fake = dependencies();
    const result = await createCbeBirrNodeHttpsTransport(fake.dependencies)(plan);

    expect(result).toEqual({ ok: true, body: syntheticPdfEnvelope() });
    expect(fake.state.resolvedHost).toBe('cbepay1.cbe.com.et');
    expect(fake.state.openCalls).toBe(1);
    expect(fake.state.timeoutMilliseconds).toBe(5_000);
    expect(fake.state.timeoutCancelled).toBe(1);
    expect(fake.state.openOptions).toMatchObject({
      protocol: 'https:',
      hostname: 'cbepay1.cbe.com.et',
      servername: 'cbepay1.cbe.com.et',
      port: 443,
      method: 'GET',
      path: `/aureceipt?TID=${SYNTHETIC_REFERENCE}&PH=${SYNTHETIC_PHONE}`,
      headers: {
        accept: 'application/pdf',
        'accept-encoding': 'identity',
        connection: 'close',
      },
      agent: false,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      maxHeaderSize: 8_192,
      pinnedAddress: '8.8.8.8',
      pinnedAddressFamily: 4,
    });
    expect(fake.state.openOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.isFrozen(fake.state.openOptions)).toBe(true);
  });

  it.each([
    ['0.0.0.1', 4],
    ['10.1.2.3', 4],
    ['100.64.0.1', 4],
    ['127.0.0.1', 4],
    ['169.254.1.1', 4],
    ['172.16.0.1', 4],
    ['192.0.2.1', 4],
    ['192.168.1.1', 4],
    ['192.88.99.1', 4],
    ['198.18.0.1', 4],
    ['198.51.100.1', 4],
    ['203.0.113.1', 4],
    ['224.0.0.1', 4],
    ['240.0.0.1', 4],
    ['::', 6],
    ['::1', 6],
    ['::ffff:192.168.1.1', 6],
    ['64:ff9b::a00:1', 6],
    ['100::1', 6],
    ['2001::1', 6],
    ['2001:db8::1', 6],
    ['2002:a00:1::1', 6],
    ['2003:4000::1', 6],
    ['2420::1', 6],
    ['2610:200::1', 6],
    ['2620:200::1', 6],
    ['2640::1', 6],
    ['2a20::1', 6],
    ['2c10::1', 6],
    ['2d00::1', 6],
    ['2e00::1', 6],
    ['3000::1', 6],
    ['3800::1', 6],
    ['3c00::1', 6],
    ['3e00::1', 6],
    ['3f00::1', 6],
    ['3ffe::1', 6],
    ['3fff::1', 6],
    ['5f00::1', 6],
    ['fc00::1', 6],
    ['fec0::1', 6],
    ['fe80::1', 6],
    ['ff00::1', 6],
    ['4000::1', 6],
    ['6000::1', 6],
  ] as const)('rejects non-public DNS address %s before HTTPS', async (address, family) => {
    const fake = dependencies({
      async resolve() {
        return [{ address, family }];
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'resolved_address_rejected',
    });
    expect(fake.state.openCalls).toBe(0);
  });

  it.each([
    '2001:200::1',
    '2001:3ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:400::1',
    '2001:600::1',
    '2001:800::1',
    '2001:c00::1',
    '2001:e00::1',
    '2001:1200::1',
    '2001:1400::1',
    '2001:1800::1',
    '2001:1a00::1',
    '2001:1c00::1',
    '2001:2000::1',
    '2001:3fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:4000::1',
    '2001:4200::1',
    '2001:4400::1',
    '2001:4600::1',
    '2001:4800::1',
    '2001:4a00::1',
    '2001:4c00::1',
    '2001:5000::1',
    '2001:8000::1',
    '2001:9fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:a000::1',
    '2001:b000::1',
    '2001:bfff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2003::1',
    '2003:3fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2400::1',
    '241f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2600::1',
    '260f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2610::1',
    '2610:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2620::1',
    '2620:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2630::1',
    '263f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2800::1',
    '280f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2a00::1',
    '2a1f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2c00::1',
    '2c0f:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ] as const)('accepts IANA-allocated IPv6 boundary %s', async (address) => {
    const fake = dependencies({
      async resolve() {
        return [{ address, family: 6 }];
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: true,
      body: syntheticPdfEnvelope(),
    });
    expect(fake.state.openCalls).toBe(1);
    expect(fake.state.openOptions).toMatchObject({
      pinnedAddress: address,
      pinnedAddressFamily: 6,
    });
  });

  it('rejects a mixed public/private answer rather than selecting around an unsafe DNS result', async () => {
    const fake = dependencies({
      async resolve() {
        return [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ];
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'resolved_address_rejected',
    });
    expect(fake.state.openCalls).toBe(0);
  });

  it.each([
    null,
    [],
    Array.from({ length: 9 }, () => ({ address: '8.8.8.8', family: 4 })),
    [{ address: 'not-an-ip', family: 4 }],
    [{ address: '8.8.8.8', family: 6 }],
    [{ address: '8.8.8.8', family: 4, extra: true }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ],
  ])('rejects malformed DNS result %# without opening HTTPS', async (resolved) => {
    const fake = dependencies({
      async resolve() {
        return resolved;
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'dns_resolution_failed',
    });
    expect(fake.state.openCalls).toBe(0);
  });

  it('redacts DNS, TLS, and network exceptions into fixed classes', async () => {
    const dns = dependencies({
      async resolve() {
        throw new Error(`${SYNTHETIC_REFERENCE} ${SYNTHETIC_PHONE}`);
      },
    });
    expect(await createCbeBirrNodeHttpsTransport(dns.dependencies)(plan)).toEqual({
      ok: false,
      reasonCode: 'dns_resolution_failed',
    });

    const tls = dependencies({
      async open() {
        throw Object.assign(new Error(SYNTHETIC_REFERENCE), { code: 'CERT_HAS_EXPIRED' });
      },
    });
    expect(await createCbeBirrNodeHttpsTransport(tls.dependencies)(plan)).toEqual({
      ok: false,
      reasonCode: 'tls_validation_failed',
    });

    const network = dependencies({
      async open() {
        throw Object.assign(new Error(SYNTHETIC_PHONE), { code: 'ECONNRESET' });
      },
    });
    expect(await createCbeBirrNodeHttpsTransport(network.dependencies)(plan)).toEqual({
      ok: false,
      reasonCode: 'network_request_failed',
    });
  });

  it.each([
    [300, 'redirect_rejected'],
    [301, 'redirect_rejected'],
    [302, 'redirect_rejected'],
    [307, 'redirect_rejected'],
    [308, 'redirect_rejected'],
    [199, 'http_status_rejected'],
    [204, 'http_status_rejected'],
    [404, 'http_status_rejected'],
    [500, 'http_status_rejected'],
  ] as const)('rejects status %i without following or retrying', async (statusCode, reasonCode) => {
    let destroyed = 0;
    const fake = dependencies({
      async open() {
        return response({
          statusCode,
          destroy() {
            destroyed += 1;
          },
        });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode,
    });
    expect(fake.state.openCalls).toBe(0);
    expect(destroyed).toBe(1);
  });

  it('rejects malformed status metadata', async () => {
    const fake = dependencies({
      async open() {
        return response({ statusCode: '200' });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_headers_rejected',
    });
  });

  it.each([
    [[], 'content_type_rejected'],
    [['Content-Type', 'application/json'], 'content_type_rejected'],
    [['Content-Type', 'text/html'], 'content_type_rejected'],
    [['Content-Type', 'application/pdf; charset=binary'], 'content_type_rejected'],
    [
      ['Content-Type', 'application/pdf', 'Content-Type', 'application/pdf'],
      'content_type_rejected',
    ],
    [['Content-Type', 'application/pdf', 'Content-Encoding', 'gzip'], 'content_encoding_rejected'],
    [
      ['Content-Type', 'application/pdf', 'Location', 'https://redirect.invalid'],
      'response_headers_rejected',
    ],
    [
      ['Content-Type', 'application/pdf', 'Set-Cookie', 'synthetic=value'],
      'response_headers_rejected',
    ],
    [
      [
        'Content-Type',
        'application/pdf',
        'Content-Disposition',
        'attachment',
        'Content-Disposition',
        'inline',
      ],
      'response_headers_rejected',
    ],
    [
      [
        'Content-Type',
        'application/pdf',
        'Content-Disposition',
        'attachment;\tfilename="synthetic.pdf"',
      ],
      'response_headers_rejected',
    ],
    [
      ['Content-Type', 'application/pdf', 'Content-Length', '1', 'Transfer-Encoding', 'chunked'],
      'response_headers_rejected',
    ],
    [['Content-Type', 'application/pdf', 'Content-Length', '01'], 'response_headers_rejected'],
    [['Content-Type', 'application/pdf', 'Content-Length', '-1'], 'response_headers_rejected'],
    [['Content-Type', 'application/pdf', 'Bad Header', 'value'], 'response_headers_rejected'],
    [['Content-Type', 'application/pdf', 'X-Test', 'bad\r\nvalue'], 'response_headers_rejected'],
  ] as const)('rejects unsafe response header case %#', async (rawHeaders, reasonCode) => {
    const fake = dependencies({
      async open() {
        return response({ rawHeaders: [...rawHeaders] });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode,
    });
  });

  it('accepts one bounded Content-Disposition value as ignored metadata', async () => {
    const fake = dependencies({
      async open() {
        return response({
          rawHeaders: [
            'Content-Type',
            'application/pdf',
            'Content-Disposition',
            'attachment; filename="synthetic-receipt.pdf"',
          ],
        });
      },
    });

    const result = await createCbeBirrNodeHttpsTransport(fake.dependencies)(plan);

    expect(result).toEqual({ ok: true, body: syntheticPdfEnvelope() });
    expect(result).not.toHaveProperty('headers');
  });

  it.each(['application/pdf', ' Application/PDF '])(
    'accepts only the exact semantic PDF content type (%s)',
    async (contentType) => {
      const fake = dependencies({
        async open() {
          return response({
            rawHeaders: ['Content-Type', contentType, 'Content-Encoding', 'Identity'],
          });
        },
      });
      await expect(createCbeBirrNodeHttpsTransport(fake.dependencies)(plan)).resolves.toMatchObject(
        {
          ok: true,
        },
      );
    },
  );

  it('bounds raw header pair count and encoded header bytes', async () => {
    const tooMany = ['Content-Type', 'application/pdf'];
    for (let index = 0; index < 32; index += 1) tooMany.push(`X-Synthetic-${index}`, 'x');
    const pairFake = dependencies({
      async open() {
        return response({ rawHeaders: tooMany });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(pairFake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_headers_rejected',
    });

    const byteFake = dependencies({
      async open() {
        return response({
          rawHeaders: ['Content-Type', 'application/pdf', 'X-Synthetic', 'x'.repeat(8_192)],
        });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(byteFake.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_headers_rejected',
    });
  });

  it('rejects an oversized declared or streamed body and destroys the response', async () => {
    let declaredDestroyed = 0;
    const declared = dependencies({
      async open() {
        return response({
          rawHeaders: ['Content-Type', 'application/pdf', 'Content-Length', '1048577'],
          destroy() {
            declaredDestroyed += 1;
          },
        });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(declared.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_too_large',
    });
    expect(declaredDestroyed).toBe(1);

    let streamedDestroyed = 0;
    const streamed = dependencies({
      async open() {
        return response({
          body: asyncChunks(new Uint8Array(1_048_576), new Uint8Array(1)),
          destroy() {
            streamedDestroyed += 1;
          },
        });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(streamed.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_too_large',
    });
    expect(streamedDestroyed).toBe(1);
  });

  it('enforces declared body length and byte-only stream chunks', async () => {
    let mismatchDestroyed = 0;
    const mismatch = dependencies({
      async open() {
        return response({
          rawHeaders: ['Content-Type', 'application/pdf', 'Content-Length', '1'],
          body: asyncChunks(new TextEncoder().encode('two')),
          destroy() {
            mismatchDestroyed += 1;
          },
        });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(mismatch.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_stream_failed',
    });
    expect(mismatchDestroyed).toBe(1);

    let destroyed = 0;
    const stringChunk = dependencies({
      async open() {
        return response({
          body: asyncChunks('not bytes'),
          destroy() {
            destroyed += 1;
          },
        });
      },
    });
    await expect(createCbeBirrNodeHttpsTransport(stringChunk.dependencies)(plan)).resolves.toEqual({
      ok: false,
      reasonCode: 'response_stream_failed',
    });
    expect(destroyed).toBe(1);
  });

  it('classifies response stream exceptions without exposing them', async () => {
    let destroyed = 0;
    const throwingBody: AsyncIterable<unknown> = {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode('%PDF-');
        throw new Error(`${SYNTHETIC_REFERENCE} ${SYNTHETIC_PHONE}`);
      },
    };
    const fake = dependencies({
      async open() {
        return response({
          body: throwingBody,
          destroy() {
            destroyed += 1;
          },
        });
      },
    });
    const result = await createCbeBirrNodeHttpsTransport(fake.dependencies)(plan);
    expect(result).toEqual({ ok: false, reasonCode: 'response_stream_failed' });
    expect(destroyed).toBe(1);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REFERENCE);
  });

  it('applies one fixed total timeout across DNS, connection, headers, and body', async () => {
    let timeoutCallback: (() => void) | undefined;
    let cancelled = 0;
    const fake = dependencies({
      resolve() {
        return new Promise(() => {});
      },
      scheduleTimeout(callback, milliseconds) {
        expect(milliseconds).toBe(5_000);
        timeoutCallback = callback;
        queueMicrotask(callback);
        return { unref() {} };
      },
      cancelTimeout() {
        cancelled += 1;
      },
    });
    const result = await createCbeBirrNodeHttpsTransport(fake.dependencies)(plan);
    expect(timeoutCallback).toBeTypeOf('function');
    expect(result).toEqual({ ok: false, reasonCode: 'transport_timeout' });
    expect(cancelled).toBe(1);
    expect(fake.state.openCalls).toBe(0);
  });
});
